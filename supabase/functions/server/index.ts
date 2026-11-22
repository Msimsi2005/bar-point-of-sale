import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import { createClient as createSupabaseClient } from "jsr:@supabase/supabase-js@2.49.8";

const app = new Hono();

app.use("*", logger(console.log));
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
app.use("/*", cors({
  origin: (origin) => {
    if (!ALLOWED_ORIGINS.length) return "*";
    return ALLOWED_ORIGINS.includes(origin) ? origin : "";
  },
  allowHeaders: ["Content-Type", "Authorization", "X-Superadmin-Token", "X-Tenant-Token"],
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  exposeHeaders: ["Content-Length"],
  maxAge: 600,
}));

// ── Superadmin credentials (server-only, no source fallback) ────────────────
const SUPERADMIN_EMAIL = normalizeEmail(Deno.env.get("SUPERADMIN_EMAIL") ?? "");
const SUPERADMIN_PASSWORDS = (Deno.env.get("SUPERADMIN_PASSWORDS") ?? Deno.env.get("SUPERADMIN_PASSWORD") ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter((value) => value.length > 0);

const RATE_LIMITS = {
  globalPerMinute: Number(Deno.env.get("RATE_LIMIT_GLOBAL_PER_MINUTE") ?? 240),
  loginPerMinute: Number(Deno.env.get("RATE_LIMIT_LOGIN_PER_MINUTE") ?? 15),
  authMaxFailures: Number(Deno.env.get("AUTH_MAX_FAILURES") ?? 5),
  authLockMinutes: Number(Deno.env.get("AUTH_LOCK_MINUTES") ?? 15),
};

const SECURITY_STATE_EMAIL = "__security__@mistypos.local";
const SECURITY_STATE_NAME = "MISTYPOS SECURITY STATE";
const SECURITY_STATE_PASSWORD_HASH = "system-security-state";

type RateBucket = { count: number; windowStart: number };
type RateBucketsMap = Record<string, RateBucket>;
const rateBuckets = new Map<string, RateBucket>();

type AuthFailureBucket = { failures: number; lockedUntil: number };
type AuthFailuresMap = Record<string, AuthFailureBucket>;
const authFailures = new Map<string, AuthFailureBucket>();

type AdminSession = { tokenHash: string; exp: number };

type SecurityState = {
  rateBuckets: RateBucketsMap;
  authFailures: AuthFailuresMap;
  adminSessions: AdminSession[];
};

function defaultSecurityState(): SecurityState {
  return {
    rateBuckets: {},
    authFailures: {},
    adminSessions: [],
  };
}

function sanitizeSecurityState(raw: any): SecurityState {
  const state = defaultSecurityState();
  if (!raw || typeof raw !== "object") return state;

  const now = Date.now();
  const maxBucketAgeMs = 5 * 60_000;
  const maxAuthAgeMs = Math.max(1, RATE_LIMITS.authLockMinutes) * 60_000 + 5 * 60_000;

  if (raw.rateBuckets && typeof raw.rateBuckets === "object") {
    for (const [key, value] of Object.entries(raw.rateBuckets)) {
      if (!value || typeof value !== "object") continue;
      const count = Number((value as any).count ?? 0);
      const windowStart = Number((value as any).windowStart ?? 0);
      if (!Number.isFinite(count) || !Number.isFinite(windowStart)) continue;
      if (windowStart <= 0 || now - windowStart > maxBucketAgeMs) continue;
      state.rateBuckets[key] = { count: Math.max(0, Math.trunc(count)), windowStart };
    }
  }

  if (raw.authFailures && typeof raw.authFailures === "object") {
    for (const [key, value] of Object.entries(raw.authFailures)) {
      if (!value || typeof value !== "object") continue;
      const failures = Number((value as any).failures ?? 0);
      const lockedUntil = Number((value as any).lockedUntil ?? 0);
      if (!Number.isFinite(failures) || !Number.isFinite(lockedUntil)) continue;
      if (lockedUntil > 0 && lockedUntil < now - maxAuthAgeMs) continue;
      if (failures <= 0 && lockedUntil <= 0) continue;
      state.authFailures[key] = { failures: Math.max(0, Math.trunc(failures)), lockedUntil: Math.max(0, Math.trunc(lockedUntil)) };
    }
  }

  if (Array.isArray(raw.adminSessions)) {
    const nowSec = Math.floor(Date.now() / 1000);
    for (const session of raw.adminSessions) {
      const tokenHash = String(session?.tokenHash ?? "");
      const exp = Number(session?.exp ?? 0);
      if (!/^[0-9a-f]{64}$/.test(tokenHash) || !Number.isFinite(exp) || exp <= nowSec) continue;
      state.adminSessions.push({ tokenHash, exp });
    }
  }

  return state;
}

function trimSecurityState(state: SecurityState) {
  const now = Date.now();
  for (const [key, bucket] of Object.entries(state.rateBuckets)) {
    if (now - bucket.windowStart > 5 * 60_000 || bucket.count <= 0) delete state.rateBuckets[key];
  }

  for (const [key, entry] of Object.entries(state.authFailures)) {
    if (entry.lockedUntil > 0 && entry.lockedUntil <= now) {
      delete state.authFailures[key];
      continue;
    }
    if (entry.failures <= 0 && entry.lockedUntil <= 0) delete state.authFailures[key];
  }

  const MAX_KEYS = 2000;
  const rateKeys = Object.keys(state.rateBuckets);
  if (rateKeys.length > MAX_KEYS) {
    const sorted = rateKeys.sort((a, b) => state.rateBuckets[b].windowStart - state.rateBuckets[a].windowStart);
    for (const key of sorted.slice(MAX_KEYS)) delete state.rateBuckets[key];
  }

  const authKeys = Object.keys(state.authFailures);
  if (authKeys.length > MAX_KEYS) {
    const sorted = authKeys.sort((a, b) => state.authFailures[b].lockedUntil - state.authFailures[a].lockedUntil);
    for (const key of sorted.slice(MAX_KEYS)) delete state.authFailures[key];
  }
}

async function loadSecurityStateRecord(supabase: any) {
  const { data, error } = await supabase
    .from("tenants")
    .select("config, updated_at")
    .eq("email", SECURITY_STATE_EMAIL)
    .maybeSingle();
  if (error) throw new Error(error.message);

  if (!data) {
    const systemRow = {
      id: crypto.randomUUID(),
      email: SECURITY_STATE_EMAIL,
      password_hash: SECURITY_STATE_PASSWORD_HASH,
      business_info: {
        name: SECURITY_STATE_NAME,
        logo: null,
        address: "",
        phone: "",
        email: SECURITY_STATE_EMAIL,
        website: "",
        regNumber: "",
        vatNumber: "",
      },
      config: { securityState: defaultSecurityState() },
      menu: [],
      customers: [],
      staff: [],
    };

    const { data: created, error: createError } = await supabase.from("tenants").insert(systemRow).select("updated_at").maybeSingle();
    if (createError) throw new Error(createError.message);
    return { config: systemRow.config, state: defaultSecurityState(), updatedAt: created?.updated_at ?? null };
  }

  const config = data?.config ?? {};
  const state = sanitizeSecurityState(config?.securityState ?? {});
  return { config, state, updatedAt: data?.updated_at ?? null };
}

async function commitSecurityMutation(supabase: any, mutate: (state: SecurityState) => void) {
  let lastError = "Failed to save security state";
  for (let attempt = 0; attempt < 5; attempt++) {
    const loaded = await loadSecurityStateRecord(supabase);
    const state = JSON.parse(JSON.stringify(loaded.state)) as SecurityState;
    mutate(state);
    trimSecurityState(state);
    const nextConfig = { ...(loaded.config ?? {}), securityState: state };
    let query = supabase.from("tenants").update({ config: nextConfig }).eq("email", SECURITY_STATE_EMAIL);
    if (loaded.updatedAt) query = query.eq("updated_at", loaded.updatedAt);
    const { data, error } = await query.select("updated_at").maybeSingle();
    if (error) {
      lastError = error.message;
      continue;
    }
    if (data) return { config: nextConfig, state, updatedAt: data.updated_at ?? loaded.updatedAt };
  }
  throw new Error(lastError);
}

function getClientIp(c: any): string {
  return c.req.header("cf-connecting-ip")
    ?? c.req.header("x-forwarded-for")?.split(",")?.[0]?.trim()
    ?? c.req.header("x-real-ip")
    ?? "unknown";
}

function isValidSuperAdminPassword(token: string): boolean {
  return SUPERADMIN_PASSWORDS.includes(token);
}

function checkRateLimit(scope: string, key: string, maxRequests: number, windowMs: number, state?: SecurityState) {
  const now = Date.now();
  const bucketKey = `${scope}:${key}`;
  if (state) {
    const bucket = state.rateBuckets[bucketKey];

    if (!bucket || now - bucket.windowStart >= windowMs) {
      state.rateBuckets[bucketKey] = { count: 1, windowStart: now };
      return { allowed: true, remaining: Math.max(maxRequests - 1, 0), retryAfterMs: 0 };
    }

    if (bucket.count >= maxRequests) {
      return { allowed: false, remaining: 0, retryAfterMs: windowMs - (now - bucket.windowStart) };
    }

    bucket.count += 1;
    state.rateBuckets[bucketKey] = bucket;
    return { allowed: true, remaining: Math.max(maxRequests - bucket.count, 0), retryAfterMs: 0 };
  }

  const bucket = rateBuckets.get(bucketKey);

  if (!bucket || now - bucket.windowStart >= windowMs) {
    rateBuckets.set(bucketKey, { count: 1, windowStart: now });
    return { allowed: true, remaining: Math.max(maxRequests - 1, 0), retryAfterMs: 0 };
  }

  if (bucket.count >= maxRequests) {
    return { allowed: false, remaining: 0, retryAfterMs: windowMs - (now - bucket.windowStart) };
  }

  bucket.count += 1;
  rateBuckets.set(bucketKey, bucket);
  return { allowed: true, remaining: Math.max(maxRequests - bucket.count, 0), retryAfterMs: 0 };
}

function authFailureKey(scope: "admin" | "tenant" | "pin", email: string, ip: string) {
  return `${scope}:${normalizeEmail(email)}:${ip}`;
}

function getAuthLockState(key: string, state?: SecurityState) {
  if (state) {
    const entry = state.authFailures[key];
    if (!entry) return { locked: false, retryAfterMs: 0 };

    const now = Date.now();
    if (entry.lockedUntil > now) {
      return { locked: true, retryAfterMs: entry.lockedUntil - now };
    }

    if (entry.lockedUntil > 0 && entry.lockedUntil <= now) {
      delete state.authFailures[key];
    }

    return { locked: false, retryAfterMs: 0 };
  }

  const entry = authFailures.get(key);
  if (!entry) return { locked: false, retryAfterMs: 0 };

  const now = Date.now();
  if (entry.lockedUntil > now) {
    return { locked: true, retryAfterMs: entry.lockedUntil - now };
  }

  if (entry.lockedUntil > 0 && entry.lockedUntil <= now) {
    authFailures.delete(key);
  }

  return { locked: false, retryAfterMs: 0 };
}

function recordAuthFailure(key: string, state?: SecurityState) {
  if (state) {
    const current = state.authFailures[key] ?? { failures: 0, lockedUntil: 0 };
    const failures = current.failures + 1;
    const shouldLock = failures >= Math.max(1, RATE_LIMITS.authMaxFailures);
    const lockedUntil = shouldLock ? Date.now() + Math.max(1, RATE_LIMITS.authLockMinutes) * 60_000 : 0;
    state.authFailures[key] = { failures, lockedUntil };
    return { failures, locked: shouldLock, retryAfterMs: shouldLock ? lockedUntil - Date.now() : 0 };
  }

  const current = authFailures.get(key) ?? { failures: 0, lockedUntil: 0 };
  const failures = current.failures + 1;
  const shouldLock = failures >= Math.max(1, RATE_LIMITS.authMaxFailures);
  const lockedUntil = shouldLock ? Date.now() + Math.max(1, RATE_LIMITS.authLockMinutes) * 60_000 : 0;
  authFailures.set(key, { failures, lockedUntil });
  return { failures, locked: shouldLock, retryAfterMs: shouldLock ? lockedUntil - Date.now() : 0 };
}

function clearAuthFailures(key: string, state?: SecurityState) {
  if (state) {
    delete state.authFailures[key];
    return;
  }
  authFailures.delete(key);
}

function auditEvent(c: any, event: string, status: "ok" | "denied" | "error", details: Record<string, unknown> = {}) {
  const payload = {
    event,
    status,
    ip: getClientIp(c),
    path: c.req.path,
    method: c.req.method,
    timestamp: new Date().toISOString(),
    details,
  };

  console.log(JSON.stringify({ audit: payload }));
}

app.use("/server/*", async (c, next) => {
  const ip = getClientIp(c);
  const result = checkRateLimit("global", ip, Math.max(1, RATE_LIMITS.globalPerMinute), 60_000);
  if (!result.allowed) {
    auditEvent(c, "rate_limit.global", "denied", { retryAfterMs: result.retryAfterMs });
    c.header("Retry-After", String(Math.ceil(result.retryAfterMs / 1000)));
    return c.json({ error: "Too many requests. Please retry shortly." }, 429);
  }
  await next();
});

function readAdminToken(c: any): string {
  const custom = c.req.header("X-Superadmin-Token") ?? "";
  if (custom) return custom;
  const auth = c.req.header("Authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : "";
}

async function isSuperAdmin(c: any): Promise<boolean> {
  const token = readAdminToken(c);
  if (!token) return false;
  try {
    const supabase = db();
    const record = await loadSecurityStateRecord(supabase);
    const tokenHash = await sha256Hex(token);
    const nowSec = Math.floor(Date.now() / 1000);
    return record.state.adminSessions.some((session) => session.tokenHash === tokenHash && session.exp > nowSec);
  } catch {
    return false;
  }
}

function db() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured");
  return createSupabaseClient(url, key);
}

// ── Health ──────────────────────────────────────────────────────────────────
app.get("/server/health", (c) => c.json({ status: "ok" }));

// ── SQL execution (superadmin only) ───────────────────────────────────────────
app.post("/server/sql", (c) => c.json({ error: "SQL endpoint is disabled." }, 410));

// ── Password helper ─────────────────────────────────────────────────────────
async function sha256Hex(value: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function bytesToB64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function b64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a[i] ^ b[i];
  return mismatch === 0;
}

async function pbkdf2Bytes(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2Bytes(pw, salt, 120000);
  return `pbkdf2$120000$${bytesToB64(salt)}$${bytesToB64(hash)}`;
}

async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  if (stored.startsWith("pbkdf2$")) {
    const [, iterationsRaw, saltB64, hashB64] = stored.split("$");
    const iterations = Number(iterationsRaw);
    if (!iterations || !saltB64 || !hashB64) return false;
    const actual = await pbkdf2Bytes(pw, b64ToBytes(saltB64), iterations);
    return timingSafeEqual(actual, b64ToBytes(hashB64));
  }
  if (/^[0-9a-f]{64}$/i.test(stored)) {
    const legacy = await sha256Hex(pw);
    return timingSafeEqual(new TextEncoder().encode(legacy), new TextEncoder().encode(stored.toLowerCase()));
  }
  return timingSafeEqual(new TextEncoder().encode(pw), new TextEncoder().encode(stored));
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function rateOf(currencies: any[] | undefined, code: string) {
  const found = (currencies ?? []).find((currency) => currency?.code === code);
  const rate = Number(found?.rate);
  return Number.isFinite(rate) && rate > 0 ? rate : 1;
}

function toBase(amount: number, currencyCode: string | undefined, currencies: any[] | undefined) {
  return amount / rateOf(currencies, currencyCode || "ZAR");
}

function fromBase(amount: number, currencyCode: string | undefined, currencies: any[] | undefined) {
  return amount * rateOf(currencies, currencyCode || "ZAR");
}

function splitVat(grossBase: number, config: any) {
  const gross = roundMoney(grossBase);
  if (!config?.vatEnabled) return { subtotal: gross, tax: 0, total: gross };
  const rate = Number(config.vatRate) || 0;
  if (config.vatPricesIncludeVat) {
    const tax = roundMoney(gross * rate / (100 + rate));
    return { subtotal: roundMoney(gross - tax), tax, total: gross };
  }
  const tax = roundMoney(gross * rate / 100);
  return { subtotal: gross, tax, total: roundMoney(gross + tax) };
}

const SERVER_CONFIG_KEYS = ["authVersion", "revokedJti", "processedSaleIds", "paused", "staffSessionVersion"];

function rolePermissions(role: string) {
  if (role === "owner") {
    return { adminAccess: true, editProducts: true, editCategories: true, editPayments: true, editCurrencies: true, editVat: true, editBusiness: true, manageStaff: true, manageCustomers: true, viewSales: true, manageSystem: true, openTabs: true, editOrders: true, chargeTabs: true, useClientDisplay: true };
  }
  if (role === "manager") {
    return { adminAccess: false, editProducts: true, editCategories: true, editPayments: false, editCurrencies: false, editVat: false, editBusiness: false, manageStaff: false, manageCustomers: true, viewSales: true, manageSystem: false, openTabs: true, editOrders: true, chargeTabs: true, useClientDisplay: true };
  }
  return { adminAccess: false, editProducts: false, editCategories: false, editPayments: false, editCurrencies: false, editVat: false, editBusiness: false, manageStaff: false, manageCustomers: false, viewSales: false, manageSystem: false, openTabs: true, editOrders: true, chargeTabs: true, useClientDisplay: true };
}

function tillOnlyPermissions() {
  return { adminAccess: false, editProducts: false, editCategories: false, editPayments: false, editCurrencies: false, editVat: false, editBusiness: false, manageStaff: false, manageCustomers: false, viewSales: true, manageSystem: false, openTabs: true, editOrders: true, chargeTabs: true, useClientDisplay: true };
}

function permissionsOf(member: any) {
  if (member?.pinMustChange) return tillOnlyPermissions();
  const defaults = rolePermissions(member?.role === "owner" || member?.role === "manager" ? member.role : "bartender");
  const raw = member?.permissions && typeof member.permissions === "object" ? member.permissions : {};
  const next: Record<string, boolean> = {};
  for (const key of Object.keys(defaults)) next[key] = typeof raw[key] === "boolean" ? raw[key] : defaults[key as keyof typeof defaults];
  return next;
}

function publicStaff(staff: any[]) {
  return (staff ?? []).map((member) => {
    const { pin: _pin, ...rest } = member ?? {};
    return { ...rest, hasPin: Boolean(member?.pin), pinMustChange: Boolean(member?.pinMustChange), permissions: permissionsOf(member) };
  });
}

async function mergeStaffPins(existing: any[], incoming: any[]) {
  const previous = new Map((existing ?? []).map((member) => [member?.id, member]));
  const next = [];
  const endedIds: string[] = [];
  for (const member of incoming ?? []) {
    const prior = previous.get(member?.id);
    const incomingPin = typeof member?.pin === "string" ? member.pin.trim() : "";
    const storedPin = String(prior?.pin ?? "");
    const pinChanged = Boolean(incomingPin)
      && !incomingPin.startsWith("pbkdf2$")
      && !(await verifyPassword(incomingPin, storedPin));
    const pin = pinChanged ? await hashPassword(incomingPin) : (prior?.pin || "");
    const { pin: _ignored, ...rest } = member ?? {};
    next.push({
      ...rest,
      pin,
      pinMustChange: pinChanged ? incomingPin === "1234" : Boolean(prior?.pinMustChange),
    });
    if (pinChanged && member?.id) endedIds.push(String(member.id));
  }
  const kept = new Set(next.map((member) => member?.id));
  for (const member of existing ?? []) {
    if (member?.id && !kept.has(member.id)) endedIds.push(String(member.id));
  }
  return { staff: next, endedIds };
}

function withEndedStaffSessions(config: any, staffIds: string[]) {
  const current = config ?? {};
  const versions = {
    ...(current.staffSessionVersion && typeof current.staffSessionVersion === "object" ? current.staffSessionVersion : {}),
  };
  for (const id of staffIds) {
    if (!id) continue;
    versions[id] = Number(versions[id] ?? 0) + 1;
  }
  return { ...current, staffSessionVersion: versions };
}

function mergeConfig(existing: any, incoming: any, permissions: Record<string, boolean>) {
  const next = { ...(existing ?? {}) };
  if ((permissions.openTabs || permissions.editOrders || permissions.chargeTabs || permissions.useClientDisplay) && incoming?.posState) {
    next.posState = incoming.posState;
  }
  if (permissions.editProducts && incoming?.stockMovements) next.stockMovements = incoming.stockMovements;
  if (permissions.editVat) {
    if (typeof incoming?.vatEnabled === "boolean") next.vatEnabled = incoming.vatEnabled;
    if (typeof incoming?.vatRate === "number") next.vatRate = incoming.vatRate;
    if (typeof incoming?.vatPricesIncludeVat === "boolean") next.vatPricesIncludeVat = incoming.vatPricesIncludeVat;
  }
  if (permissions.editPayments && incoming?.paymentMethods) next.paymentMethods = incoming.paymentMethods;
  if (permissions.editCurrencies) {
    if (incoming?.currencies) next.currencies = incoming.currencies;
    if (typeof incoming?.defaultCurrencyCode === "string") next.defaultCurrencyCode = incoming.defaultCurrencyCode;
  }
  if (permissions.editCategories && incoming?.categories) next.categories = incoming.categories;
  if (permissions.manageSystem || permissions.editBusiness) {
    for (const key of ["printers", "scanners", "defaultPrinterId", "defaultScannerId", "receiptTemplate", "allowZeroSales", "allowCredits"]) {
      if (incoming?.[key] !== undefined) next[key] = incoming[key];
    }
  }
  for (const key of SERVER_CONFIG_KEYS) next[key] = existing?.[key];
  return next;
}

function normalizeEmail(email: string) {
  return email.toLowerCase().trim();
}

function base64UrlEncode(value: string) {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return atob(padded);
}

async function signTokenPayload(payloadB64: string) {
  const secret = Deno.env.get("TENANT_TOKEN_SECRET") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret) throw new Error("TENANT_TOKEN_SECRET must be configured");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
  const bytes = String.fromCharCode(...new Uint8Array(sig));
  return base64UrlEncode(bytes);
}

async function createTenantToken(email: string, extra: Record<string, unknown> = {}) {
  const payload = JSON.stringify({
    email,
    exp: Math.floor(Date.now() / 1000) + (60 * 60 * 12),
    ...extra,
  });
  const payloadB64 = base64UrlEncode(payload);
  const sig = await signTokenPayload(payloadB64);
  return `${payloadB64}.${sig}`;
}

async function verifyTenantToken(token: string, email: string) {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;
  const expectedSig = await signTokenPayload(payloadB64);
  if (expectedSig !== sig) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(payloadB64));
    if (!payload?.email || !payload?.exp) return null;
    if (normalizeEmail(String(payload.email)) !== normalizeEmail(email)) return null;
    if (Math.floor(Date.now() / 1000) > Number(payload.exp)) return null;
    return payload as { email: string; exp: number; staffId?: string; jti?: string; v?: number; sv?: number };
  } catch {
    return null;
  }
}

function toTenantSummary(row: any) {
  return {
    email: row.email,
    name: row.business_info?.name ?? "",
    logo: row.business_info?.logo ?? null,
    paused: row.config?.paused === true,
    receiptTemplate: {
      ...defaultReceiptTemplate(),
      ...(row.config?.receiptTemplate ?? {}),
    },
    createdAt: row.created_at ?? new Date().toISOString(),
  };
}

function toTenantResponse(row: any, sales: any[], tenantToken?: string) {
  return {
    id: row.id,
    email: row.email,
    tenantToken,
    businessInfo: row.business_info ?? {},
    config: row.config ?? defaultConfig(),
    menu: row.menu ?? [],
    customers: row.customers ?? [],
    staff: publicStaff(row.staff ?? []),
    createdAt: row.created_at ?? new Date().toISOString(),
    updatedAt: row.updated_at ?? null,
    sales,
  };
}

app.use("/server/tenant/*", async (c, next) => {
  const match = /^\/server\/tenant\/([^/]+)/.exec(c.req.path);
  const email = normalizeEmail(decodeURIComponent(match?.[1] ?? ""));
  const auth = c.req.header("Authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const headerToken = c.req.header("X-Tenant-Token") ?? "";
  const token = headerToken || bearer;
  const payload = token ? await verifyTenantToken(token, email) : null;

  if (!payload) {
    auditEvent(c, "tenant.auth", "denied", { email });
    return c.json({ error: "Unauthorized tenant access" }, 401);
  }

  const supabase = db();
  const { data: tenant, error } = await supabase
    .from("tenants")
    .select("config")
    .eq("email", email)
    .maybeSingle();
  if (error) return c.json({ error: error.message }, 400);
  if (!tenant) return c.json({ error: "Not found" }, 404);

  const version = Number(tenant.config?.authVersion ?? 0);
  const revoked = Array.isArray(tenant.config?.revokedJti) ? tenant.config.revokedJti : [];
  if (tenant.config?.paused === true) {
    return c.json({ error: "This business is paused. Contact superadmin." }, 403);
  }
  if (Number(payload.v ?? -1) !== version) {
    return c.json({ error: "Session expired. Sign in again." }, 401);
  }
  if (payload.staffId) {
    const staffVersions = tenant.config?.staffSessionVersion && typeof tenant.config.staffSessionVersion === "object"
      ? tenant.config.staffSessionVersion
      : {};
    if (Number(payload.sv ?? 0) !== Number(staffVersions[payload.staffId] ?? 0)) {
      return c.json({ error: "Session expired. Sign in again." }, 401);
    }
  }
  if (!payload.jti || revoked.includes(payload.jti)) {
    return c.json({ error: "Session expired. Sign in again." }, 401);
  }

  c.set("tenantAuth", payload);
  await next();
});

// ── SUPERADMIN: login ────────────────────────────────────────────────────────
app.post("/server/admin/login", async (c) => {
  const supabase = db();
  let securityRecord: { config: any; state: SecurityState };
  try {
    securityRecord = await loadSecurityStateRecord(supabase);
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : "Failed to load security state" }, 500);
  }

  const ip = getClientIp(c);
  let loginRate = { allowed: true, remaining: 0, retryAfterMs: 0 };
  try {
    await commitSecurityMutation(supabase, (state) => {
      loginRate = checkRateLimit("admin_login", ip, Math.max(1, RATE_LIMITS.loginPerMinute), 60_000, state);
    });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : "Failed to save security state" }, 500);
  }
  if (!loginRate.allowed) {
    auditEvent(c, "admin.login", "denied", { reason: "rate_limited", retryAfterMs: loginRate.retryAfterMs });
    c.header("Retry-After", String(Math.ceil(loginRate.retryAfterMs / 1000)));
    return c.json({ error: "Too many login attempts. Please retry shortly." }, 429);
  }

  const { email, password } = await c.req.json();
  const normalizedEmail = normalizeEmail(String(email ?? ""));
  const authKey = authFailureKey("admin", normalizedEmail, ip);
  const lockState = getAuthLockState(authKey, securityRecord.state);
  if (lockState.locked) {
    auditEvent(c, "admin.login", "denied", { reason: "locked", email: normalizedEmail, retryAfterMs: lockState.retryAfterMs });
    c.header("Retry-After", String(Math.ceil(lockState.retryAfterMs / 1000)));
    return c.json({ error: "Account temporarily locked due to repeated failures." }, 429);
  }

  if (!SUPERADMIN_EMAIL || SUPERADMIN_PASSWORDS.length === 0) {
    return c.json({ error: "Superadmin is not configured" }, 503);
  }

  if (normalizedEmail !== SUPERADMIN_EMAIL || !isValidSuperAdminPassword(String(password ?? ""))) {
    let failure = { failures: 0, locked: false, retryAfterMs: 0 };
    try {
      await commitSecurityMutation(supabase, (state) => {
        failure = recordAuthFailure(authKey, state);
      });
    } catch (e: unknown) {
      return c.json({ error: e instanceof Error ? e.message : "Failed to save security state" }, 500);
    }
    auditEvent(c, "admin.login", "denied", { reason: "invalid_credentials", email: normalizedEmail, failures: failure.failures, locked: failure.locked });
    if (failure.locked) {
      c.header("Retry-After", String(Math.ceil(failure.retryAfterMs / 1000)));
      return c.json({ error: "Account temporarily locked due to repeated failures." }, 429);
    }
    return c.json({ error: "Invalid superadmin credentials" }, 401);
  }

  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
  const tokenHash = await sha256Hex(token);
  const nowSec = Math.floor(Date.now() / 1000);
  try {
    await commitSecurityMutation(supabase, (state) => {
      clearAuthFailures(authKey, state);
      state.adminSessions = [
        ...state.adminSessions.filter((session) => session.exp > nowSec),
        { tokenHash, exp: nowSec + (60 * 60 * 12) },
      ].slice(-20);
    });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : "Failed to save security state" }, 500);
  }
  auditEvent(c, "admin.login", "ok", { email: normalizedEmail });
  return c.json({ token });
});

// ── SUPERADMIN: list all tenants ─────────────────────────────────────────────
app.get("/server/admin/tenants", async (c) => {
  if (!(await isSuperAdmin(c))) return c.json({ error: "Unauthorized" }, 401);
  const supabase = db();
  const { data, error } = await supabase
    .from("tenants")
    .select("email, business_info, config, created_at")
    .neq("email", SECURITY_STATE_EMAIL)
    .order("created_at", { ascending: false });
  if (error) return c.json({ error: error.message }, 400);
  return c.json((data ?? []).map(toTenantSummary));
});

// ── SUPERADMIN: register a company ───────────────────────────────────────────
app.post("/server/admin/tenants", async (c) => {
  if (!(await isSuperAdmin(c))) return c.json({ error: "Unauthorized" }, 401);
  const { email, password, businessName } = await c.req.json();
  if (!email || !password || !businessName) return c.json({ error: "Missing fields" }, 400);

  const supabase = db();
  const normalizedEmail = normalizeEmail(email);
  const { data: existing, error: existingError } = await supabase
    .from("tenants")
    .select("email")
    .eq("email", normalizedEmail)
    .maybeSingle();
  if (existingError) return c.json({ error: existingError.message }, 400);
  if (existing) return c.json({ error: "Email already registered" }, 409);

  const passwordHash = await hashPassword(password);
  const staffOwnerId = crypto.randomUUID();

  const tenantRow = {
    id: crypto.randomUUID(),
    email: normalizedEmail,
    password_hash: passwordHash,
    business_info: {
      name: businessName, logo: null, address: "", phone: "",
      email: normalizedEmail, website: "", regNumber: "", vatNumber: "",
    },
    config: defaultConfig(),
    menu: [],
    customers: [],
    staff: [{ id: staffOwnerId, name: businessName, pin: await hashPassword("1234"), role: "owner", pinMustChange: true }],
  };

  const { data: created, error: createError } = await supabase
    .from("tenants")
    .insert(tenantRow)
    .select("id, email, business_info, config, menu, customers, staff, created_at")
    .single();
  if (createError) return c.json({ error: createError.message }, 400);

  return c.json(toTenantResponse(created, []), 201);
});

// ── SUPERADMIN: update tenant (reset password) ───────────────────────────────
app.patch("/server/admin/tenants/:email", async (c) => {
  if (!(await isSuperAdmin(c))) return c.json({ error: "Unauthorized" }, 401);
  const email = normalizeEmail(decodeURIComponent(c.req.param("email")));
  const supabase = db();

  const body = await c.req.json();
  const updates: Record<string, unknown> = {};
  let existingConfig: any | null = null;

  async function ensureExistingConfig() {
    if (existingConfig) return existingConfig;
    const { data: existing, error: existingError } = await supabase
      .from("tenants")
      .select("config")
      .eq("email", email)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    existingConfig = existing?.config ?? defaultConfig();
    return existingConfig;
  }

  if (typeof body.password === "string" && body.password.trim().length > 0) {
    updates.password_hash = await hashPassword(body.password);
    try {
      const currentConfig = await ensureExistingConfig();
      const currentVersion = Number(currentConfig?.authVersion ?? 0);
      updates.config = { ...(updates.config as any ?? currentConfig), authVersion: currentVersion + 1 };
    } catch (e: unknown) {
      return c.json({ error: e instanceof Error ? e.message : "Failed to load tenant config" }, 400);
    }
  }

  if (typeof body.paused === "boolean") {
    try {
      const currentConfig = await ensureExistingConfig();
      const currentVersion = Number(currentConfig?.authVersion ?? 0);
      const plannedVersion = Number((updates.config as any)?.authVersion ?? currentVersion);
      updates.config = { ...(updates.config as any ?? currentConfig), paused: body.paused, authVersion: Math.max(plannedVersion, currentVersion + 1) };
    } catch (e: unknown) {
      return c.json({ error: e instanceof Error ? e.message : "Failed to load tenant config" }, 400);
    }
  }

  if (body.receiptTemplate && typeof body.receiptTemplate === "object") {
    try {
      const currentConfig = await ensureExistingConfig();
      const currentTemplate = {
        ...defaultReceiptTemplate(),
        ...(currentConfig?.receiptTemplate ?? {}),
      };
      const incoming = body.receiptTemplate;
      const nextTemplate = {
        ...currentTemplate,
        headerLine1: typeof incoming.headerLine1 === "string" ? incoming.headerLine1.slice(0, 120) : currentTemplate.headerLine1,
        headerLine2: typeof incoming.headerLine2 === "string" ? incoming.headerLine2.slice(0, 120) : currentTemplate.headerLine2,
        footerLine: typeof incoming.footerLine === "string" ? incoming.footerLine.slice(0, 180) : currentTemplate.footerLine,
        showLogo: typeof incoming.showLogo === "boolean" ? incoming.showLogo : currentTemplate.showLogo,
        showAddress: typeof incoming.showAddress === "boolean" ? incoming.showAddress : currentTemplate.showAddress,
        showPhone: typeof incoming.showPhone === "boolean" ? incoming.showPhone : currentTemplate.showPhone,
        showVatNumber: typeof incoming.showVatNumber === "boolean" ? incoming.showVatNumber : currentTemplate.showVatNumber,
        showTabName: typeof incoming.showTabName === "boolean" ? incoming.showTabName : currentTemplate.showTabName,
        showPaymentMethod: typeof incoming.showPaymentMethod === "boolean" ? incoming.showPaymentMethod : currentTemplate.showPaymentMethod,
      };
      updates.config = {
        ...(updates.config as any ?? currentConfig),
        receiptTemplate: nextTemplate,
      };
    } catch (e: unknown) {
      return c.json({ error: e instanceof Error ? e.message : "Failed to update receipt template" }, 400);
    }
  }

  if (Object.keys(updates).length === 0) return c.json({ ok: true });

  const { error } = await supabase
    .from("tenants")
    .update(updates)
    .eq("email", email);
  if (error) return c.json({ error: error.message }, 400);

  return c.json({ ok: true });
});

// ── SUPERADMIN: delete a company ─────────────────────────────────────────────
app.delete("/server/admin/tenants/:email", async (c) => {
  if (!(await isSuperAdmin(c))) return c.json({ error: "Unauthorized" }, 401);
  const email = normalizeEmail(decodeURIComponent(c.req.param("email")));
  const supabase = db();
  const { error } = await supabase.from("tenants").delete().eq("email", email);
  if (error) return c.json({ error: error.message }, 400);
  return c.json({ ok: true });
});

// ── VENUE: login ─────────────────────────────────────────────────────────────
app.post("/server/auth/login", async (c) => {
  const supabase = db();
  let securityRecord: { config: any; state: SecurityState };
  try {
    securityRecord = await loadSecurityStateRecord(supabase);
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : "Failed to load security state" }, 500);
  }

  const ip = getClientIp(c);
  let loginRate = { allowed: true, remaining: 0, retryAfterMs: 0 };
  try {
    await commitSecurityMutation(supabase, (state) => {
      loginRate = checkRateLimit("tenant_login", ip, Math.max(1, RATE_LIMITS.loginPerMinute), 60_000, state);
    });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : "Failed to save security state" }, 500);
  }
  if (!loginRate.allowed) {
    auditEvent(c, "tenant.login", "denied", { reason: "rate_limited", retryAfterMs: loginRate.retryAfterMs });
    c.header("Retry-After", String(Math.ceil(loginRate.retryAfterMs / 1000)));
    return c.json({ error: "Too many login attempts. Please retry shortly." }, 429);
  }

  const { email, password } = await c.req.json();
  if (!email || !password) return c.json({ error: "Missing fields" }, 400);

  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail === SECURITY_STATE_EMAIL) return c.json({ error: "Invalid email or password" }, 401);
  const authKey = authFailureKey("tenant", normalizedEmail, ip);
  const lockState = getAuthLockState(authKey, securityRecord.state);
  if (lockState.locked) {
    auditEvent(c, "tenant.login", "denied", { reason: "locked", email: normalizedEmail, retryAfterMs: lockState.retryAfterMs });
    c.header("Retry-After", String(Math.ceil(lockState.retryAfterMs / 1000)));
    return c.json({ error: "Account temporarily locked due to repeated failures." }, 429);
  }

  const { data: tenant, error } = await supabase
    .from("tenants")
    .select("id, email, password_hash, business_info, config, menu, customers, staff, created_at, updated_at")
    .eq("email", normalizedEmail)
    .maybeSingle();
  if (error) return c.json({ error: error.message }, 400);
  if (!tenant) {
    let failure = { failures: 0, locked: false, retryAfterMs: 0 };
    try {
      await commitSecurityMutation(supabase, (state) => {
        failure = recordAuthFailure(authKey, state);
      });
    } catch (e: unknown) {
      return c.json({ error: e instanceof Error ? e.message : "Failed to save security state" }, 500);
    }
    auditEvent(c, "tenant.login", "denied", { reason: "invalid_credentials", email: normalizedEmail, failures: failure.failures, locked: failure.locked });
    return c.json({ error: "Invalid email or password" }, failure.locked ? 429 : 401);
  }

  if (tenant.config?.paused === true) {
    auditEvent(c, "tenant.login", "denied", { reason: "paused", email: normalizedEmail });
    return c.json({ error: "This business is paused. Contact superadmin." }, 403);
  }

  const passwordOk = await verifyPassword(String(password), String(tenant.password_hash ?? ""));
  if (passwordOk && !String(tenant.password_hash ?? "").startsWith("pbkdf2$")) {
    await supabase.from("tenants").update({ password_hash: await hashPassword(String(password)) }).eq("email", normalizedEmail);
  }

  if (!passwordOk) {
    let failure = { failures: 0, locked: false, retryAfterMs: 0 };
    try {
      await commitSecurityMutation(supabase, (state) => {
        failure = recordAuthFailure(authKey, state);
      });
    } catch (e: unknown) {
      return c.json({ error: e instanceof Error ? e.message : "Failed to save security state" }, 500);
    }
    auditEvent(c, "tenant.login", "denied", { reason: "invalid_credentials", email: normalizedEmail, failures: failure.failures, locked: failure.locked });
    return c.json({ error: "Invalid email or password" }, failure.locked ? 429 : 401);
  }

  try {
    await commitSecurityMutation(supabase, (state) => {
      clearAuthFailures(authKey, state);
    });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : "Failed to save security state" }, 500);
  }
  auditEvent(c, "tenant.login", "ok", { email: normalizedEmail });

  const { data: salesRows, error: salesError } = await supabase
    .from("sales")
    .select("sale, saved_at")
    .eq("tenant_email", normalizedEmail)
    .order("saved_at", { ascending: false })
    .limit(500);
  if (salesError) return c.json({ error: salesError.message }, 400);

  const sales = (salesRows ?? []).map((row: any) => ({ ...(row.sale ?? {}), savedAt: row.saved_at }));
  const tenantToken = await createTenantToken(normalizedEmail, {
    jti: crypto.randomUUID(),
    v: Number(tenant.config?.authVersion ?? 0),
  });
  return c.json(toTenantResponse(tenant, sales, tenantToken));
});

// ── VENUE: get tenant ─────────────────────────────────────────────────────────
app.get("/server/tenant/:email", async (c) => {
  const email = normalizeEmail(decodeURIComponent(c.req.param("email")));
  const supabase = db();
  const { data: tenant, error } = await supabase
    .from("tenants")
    .select("id, email, business_info, config, menu, customers, staff, created_at, updated_at")
    .eq("email", email)
    .maybeSingle();
  if (error) return c.json({ error: error.message }, 400);
  if (!tenant) return c.json({ error: "Not found" }, 404);

  const { data: salesRows, error: salesError } = await supabase
    .from("sales")
    .select("sale, saved_at")
    .eq("tenant_email", email)
    .order("saved_at", { ascending: false })
    .limit(500);
  if (salesError) return c.json({ error: salesError.message }, 400);

  const sales = (salesRows ?? []).map((row: any) => ({ ...(row.sale ?? {}), savedAt: row.saved_at }));
  return c.json(toTenantResponse(tenant, sales));
});

async function loadTenant(supabase: any, email: string) {
  const { data, error } = await supabase
    .from("tenants")
    .select("id, email, business_info, config, menu, customers, staff, created_at, updated_at")
    .eq("email", email)
    .maybeSingle();
  return { data, error };
}

function requireStaff(c: any, tenant: any) {
  const auth = c.get("tenantAuth");
  if (!auth?.staffId) return null;
  const member = (tenant.staff ?? []).find((staff: any) => staff?.id === auth.staffId);
  return member ?? null;
}

// ── VENUE: staff PIN session ─────────────────────────────────────────────────
app.post("/server/tenant/:email/staff/session", async (c) => {
  const email = normalizeEmail(decodeURIComponent(c.req.param("email")));
  const auth = c.get("tenantAuth");
  if (auth?.staffId) return c.json({ error: "Use the venue login before choosing staff" }, 400);
  const { staffId, pin } = await c.req.json();
  const supabase = db();
  let securityRecord: { config: any; state: SecurityState };
  try {
    securityRecord = await loadSecurityStateRecord(supabase);
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : "Failed to load security state" }, 500);
  }
  const pinKey = authFailureKey("pin", `${email}:${String(staffId ?? "")}`, "staff");
  const lockState = getAuthLockState(pinKey, securityRecord.state);
  if (lockState.locked) {
    c.header("Retry-After", String(Math.ceil(lockState.retryAfterMs / 1000)));
    return c.json({ error: "Too many PIN attempts. Please retry shortly." }, 429);
  }
  const { data: tenant, error } = await loadTenant(supabase, email);
  if (error) return c.json({ error: error.message }, 400);
  if (!tenant) return c.json({ error: "Not found" }, 404);
  if (tenant.config?.paused === true) return c.json({ error: "This business is paused. Contact superadmin." }, 403);
  const member = (tenant.staff ?? []).find((staff: any) => staff?.id === staffId);
  const supplied = String(pin ?? "");
  if (!/^\d{4}$/.test(supplied) || !member || !(await verifyPassword(supplied, String(member.pin ?? "")))) {
    let failure = { failures: 0, locked: false, retryAfterMs: 0 };
    let pinRate = { allowed: true, remaining: 0, retryAfterMs: 0 };
    try {
      await commitSecurityMutation(supabase, (state) => {
        failure = recordAuthFailure(pinKey, state);
        pinRate = checkRateLimit("staff_pin_fail", `${email}:${String(staffId ?? "")}`, 8, 60_000, state);
      });
    } catch (e: unknown) {
      return c.json({ error: e instanceof Error ? e.message : "Failed to save security state" }, 500);
    }
    if (failure.locked || !pinRate.allowed) {
      const retryAfterMs = failure.locked ? failure.retryAfterMs : pinRate.retryAfterMs;
      c.header("Retry-After", String(Math.ceil(retryAfterMs / 1000)));
      return c.json({ error: "Too many PIN attempts. Please retry shortly." }, 429);
    }
    return c.json({ error: "Wrong PIN" }, 401);
  }
  try {
    await commitSecurityMutation(supabase, (state) => {
      clearAuthFailures(pinKey, state);
    });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : "Failed to save security state" }, 500);
  }
  const mustChange = supplied === "1234";
  if (!String(member.pin ?? "").startsWith("pbkdf2$") || (mustChange && member.pinMustChange !== true)) {
    const staff = (tenant.staff ?? []).map((staff: any) => staff?.id === member.id ? {
      ...staff,
      pin: String(staff.pin ?? "").startsWith("pbkdf2$") ? staff.pin : await hashPassword(supplied),
      pinMustChange: mustChange,
    } : staff);
    const { error: pinError } = await supabase.from("tenants").update({ staff }).eq("email", email);
    if (pinError) return c.json({ error: pinError.message }, 400);
    member.pinMustChange = mustChange;
  }
  const staffToken = await createTenantToken(email, {
    staffId: member.id,
    jti: crypto.randomUUID(),
    v: Number(tenant.config?.authVersion ?? 0),
    sv: Number(tenant.config?.staffSessionVersion?.[member.id] ?? 0),
  });
  return c.json({ staffToken, pinIsDefault: mustChange || member.pinMustChange === true, staff: publicStaff([member])[0] });
});

app.post("/server/tenant/:email/logout", async (c) => {
  const email = normalizeEmail(decodeURIComponent(c.req.param("email")));
  const auth = c.get("tenantAuth");
  if (!auth?.jti) return c.json({ ok: true });
  const supabase = db();
  const { data: tenant, error } = await loadTenant(supabase, email);
  if (error) return c.json({ error: error.message }, 400);
  if (!tenant) return c.json({ ok: true });
  const revoked = Array.isArray(tenant.config?.revokedJti) ? tenant.config.revokedJti : [];
  const next = [...revoked, auth.jti].slice(-200);
  const { error: updateError } = await supabase.from("tenants").update({ config: { ...tenant.config, revokedJti: next } }).eq("email", email);
  if (updateError) return c.json({ error: updateError.message }, 400);
  return c.json({ ok: true });
});

// ── VENUE: save tenant ────────────────────────────────────────────────────────
app.put("/server/tenant/:email", async (c) => {
  const email = normalizeEmail(decodeURIComponent(c.req.param("email")));
  const supabase = db();
  const { data: existing, error: existingError } = await loadTenant(supabase, email);
  if (existingError) return c.json({ error: existingError.message }, 400);
  if (!existing) return c.json({ error: "Not found" }, 404);
  const member = requireStaff(c, existing);
  if (!member) return c.json({ error: "Staff sign-in required" }, 403);
  const permissions = permissionsOf(member);

  const body = await c.req.json();
  const patch: any = {};
  let endedStaffIds: string[] = [];
  if (body.businessInfo !== undefined && permissions.editBusiness) patch.business_info = body.businessInfo;
  if (body.menu !== undefined && permissions.editProducts) patch.menu = body.menu;
  if (body.customers !== undefined && permissions.manageCustomers) patch.customers = body.customers;
  if (body.staff !== undefined && permissions.manageStaff) {
    const merged = await mergeStaffPins(existing.staff ?? [], body.staff);
    patch.staff = merged.staff;
    endedStaffIds = merged.endedIds;
  }
  if (body.config !== undefined) patch.config = mergeConfig(existing.config ?? {}, body.config, permissions);
  if (endedStaffIds.length > 0) patch.config = withEndedStaffSessions(patch.config ?? existing.config ?? {}, endedStaffIds);
  if (Object.keys(patch).length === 0) return c.json(toTenantResponse(existing, []));

  let query = supabase.from("tenants").update(patch).eq("email", email);
  if (body.updatedAt) query = query.eq("updated_at", body.updatedAt);
  const { data: updated, error: updateError } = await query
    .select("id, email, business_info, config, menu, customers, staff, created_at, updated_at")
    .maybeSingle();
  if (updateError) return c.json({ error: updateError.message }, 400);
  if (!updated) return c.json({ error: "Save conflict. Reload the latest data." }, 409);

  const actor = c.get("tenantAuth");
  const actorId = actor?.staffId ? String(actor.staffId) : "";
  let refreshedToken: string | undefined;
  if (actorId && endedStaffIds.includes(actorId)) {
    const versions = updated.config?.staffSessionVersion && typeof updated.config.staffSessionVersion === "object"
      ? updated.config.staffSessionVersion
      : {};
    refreshedToken = await createTenantToken(email, {
      staffId: actorId,
      jti: crypto.randomUUID(),
      v: Number(updated.config?.authVersion ?? 0),
      sv: Number(versions[actorId] ?? 0),
    });
  }
  return c.json(toTenantResponse(updated, [], refreshedToken));
});

app.patch("/server/tenant/:email/credentials", async (c) => {
  const email = normalizeEmail(decodeURIComponent(c.req.param("email")));
  const supabase = db();
  const { data: existing, error: existingError } = await loadTenant(supabase, email);
  if (existingError) return c.json({ error: existingError.message }, 400);
  if (!existing) return c.json({ error: "Not found" }, 404);
  const member = requireStaff(c, existing);
  if (!member) return c.json({ error: "Staff sign-in required" }, 403);
  const permissions = permissionsOf(member);

  const body = await c.req.json();
  const updates: Record<string, unknown> = {};
  let nextEmail = email;

  if ((typeof body.loginEmail === "string" || (typeof body.password === "string" && body.password.trim().length > 0)) && !permissions.manageSystem) {
    return c.json({ error: "Not allowed" }, 403);
  }

  if (typeof body.loginEmail === "string") {
    const normalizedLoginEmail = normalizeEmail(body.loginEmail);
    if (!normalizedLoginEmail) return c.json({ error: "Login email is required" }, 400);
    if (normalizedLoginEmail !== email) {
      const { data: duplicate, error: duplicateError } = await supabase
        .from("tenants")
        .select("email")
        .eq("email", normalizedLoginEmail)
        .maybeSingle();
      if (duplicateError) return c.json({ error: duplicateError.message }, 400);
      if (duplicate) return c.json({ error: "Login email already registered" }, 409);
      updates.email = normalizedLoginEmail;
      nextEmail = normalizedLoginEmail;
    }
  }

  if (typeof body.password === "string") {
    const trimmedPassword = body.password.trim();
    if (trimmedPassword.length > 0) {
      if (trimmedPassword.length < 6) return c.json({ error: "Password must be at least 6 characters" }, 400);
      updates.password_hash = await hashPassword(trimmedPassword);
    }
  }

  let pinStaffId = "";
  if (typeof body.pin === "string") {
    if (!/^\d{4}$/.test(body.pin)) return c.json({ error: "PIN must be exactly 4 digits" }, 400);
    if (body.pin === "1234") return c.json({ error: "Choose a PIN other than 1234" }, 400);
    const staffId = typeof body.staffId === "string" ? body.staffId : "";
    if (!staffId) return c.json({ error: "Staff ID is required to update PIN" }, 400);
    const staff = Array.isArray(existing.staff) ? existing.staff : [];
    if (!staff.some((member: any) => member?.id === staffId)) return c.json({ error: "Staff member not found" }, 404);
    const actor = c.get("tenantAuth");
    if (staffId !== actor?.staffId && !permissions.manageStaff) return c.json({ error: "Not allowed" }, 403);
    pinStaffId = staffId;
    updates.staff = staff.map((entry: any) => entry?.id === staffId ? { ...entry, pin: await hashPassword(body.pin), pinMustChange: false } : entry);
  }

  if (Object.keys(updates).length === 0) return c.json({ error: "No credential changes supplied" }, 400);

  if (updates.password_hash || updates.email) {
    const currentConfig = existing.config ?? {};
    updates.config = { ...currentConfig, ...(updates.config as object ?? {}), authVersion: Number(currentConfig.authVersion ?? 0) + 1 };
  }

  if (pinStaffId) {
    const currentConfig = { ...(existing.config ?? {}), ...(updates.config as object ?? {}) };
    updates.config = withEndedStaffSessions(currentConfig, [pinStaffId]);
  }

  const { data: updated, error: updateError } = await supabase
    .from("tenants")
    .update(updates)
    .eq("email", email)
    .select("id, email, business_info, config, menu, customers, staff, created_at, updated_at")
    .single();
  if (updateError) {
    const message = String(updateError.message ?? "");
    if (/foreign key|violates/i.test(message) && updates.email) {
      return c.json({ error: "Email change is blocked until sales follow the new login email. Run src/lib/003_sales_email_on_update_cascade.sql, then try again." }, 409);
    }
    return c.json({ error: message }, 400);
  }

  const actor = c.get("tenantAuth");
  const tokenStaffId = actor?.staffId ? String(actor.staffId) : "";
  const staffVersions = updated.config?.staffSessionVersion && typeof updated.config.staffSessionVersion === "object"
    ? updated.config.staffSessionVersion
    : {};
  const tenantToken = await createTenantToken(nextEmail, {
    ...(tokenStaffId ? { staffId: tokenStaffId, sv: Number(staffVersions[tokenStaffId] ?? 0) } : {}),
    jti: crypto.randomUUID(),
    v: Number(updated.config?.authVersion ?? 0),
  });
  return c.json(toTenantResponse(updated, [], tenantToken));
});

function creditDelta(action: string | undefined, baseTotal: number, accountAmountBase: number) {
  if (action === "on-account") return -roundMoney(baseTotal);
  if (action === "settlement" || action === "deposit") return roundMoney(accountAmountBase);
  return 0;
}

async function insertSaleRow(supabase: any, row: Record<string, unknown>, sale: any) {
  const { error: baseError } = await supabase.from("sales").insert(row);
  if (!baseError) return { ok: true as const };
  const msg = String(baseError.message ?? "");
  if (/duplicate key|already exists/i.test(msg)) return { ok: true as const, duplicate: true };
  const lower = msg.toLowerCase();
  const isLegacyNotNull = lower.includes("violates not-null constraint") || lower.includes("null value in column");
  if (!isLegacyNotNull) return { ok: false as const, error: msg };

  const legacyInsert: Record<string, unknown> = {
    ...row,
    tab_name: sale?.tabName ?? "Walk-in",
    items: sale?.items ?? [],
    subtotal: Number(sale?.subtotal ?? 0),
    tax: Number(sale?.tax ?? 0),
    total: Number(sale?.total ?? 0),
    total_converted: Number(sale?.totalConverted ?? sale?.total ?? 0),
    payment_method: sale?.paymentMethod ?? "Unknown",
    currency_code: sale?.currencyCode ?? "ZAR",
    currency_symbol: sale?.currencySymbol ?? "R",
    staff_id: sale?.staffId ?? null,
    customer_id: sale?.customerId ?? null,
    prepaid: sale?.prepaid ?? null,
    change_amount: sale?.change ?? null,
    timestamp: sale?.timestamp ?? new Date().toISOString(),
    saved_at: new Date().toISOString(),
  };
  let legacyErrorMessage = "";
  for (let i = 0; i < 16; i++) {
    const { error: legacyError } = await supabase.from("sales").insert(legacyInsert);
    if (!legacyError) return { ok: true as const };
    legacyErrorMessage = String(legacyError.message ?? "Unknown legacy insert error");
    if (/duplicate key|already exists/i.test(legacyErrorMessage)) return { ok: true as const, duplicate: true };
    const missingCol = /Could not find the '([^']+)' column/.exec(legacyErrorMessage);
    if (missingCol?.[1]) {
      delete legacyInsert[missingCol[1]];
      continue;
    }
    break;
  }
  return { ok: false as const, error: `Sale save failed. ${msg}. Legacy retry: ${legacyErrorMessage}` };
}

// ── VENUE: add sale ───────────────────────────────────────────────────────────
app.post("/server/tenant/:email/sale", async (c) => {
  const email = normalizeEmail(decodeURIComponent(c.req.param("email")));
  const incoming = await c.req.json();
  const supabase = db();
  const saleId = String(incoming?.id ?? "");
  if (!/^[0-9a-f-]{16,}$/i.test(saleId)) return c.json({ error: "Sale id is required" }, 400);

  const { data: existingSale, error: existingSaleError } = await supabase.from("sales").select("id").eq("id", saleId).maybeSingle();
  if (existingSaleError) return c.json({ error: existingSaleError.message }, 400);

  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: tenant, error } = await loadTenant(supabase, email);
    if (error) return c.json({ error: error.message }, 400);
    if (!tenant) return c.json({ error: "Not found" }, 404);
    const member = requireStaff(c, tenant);
    if (!member) return c.json({ error: "Staff sign-in required" }, 403);
    if (!permissionsOf(member).chargeTabs) return c.json({ error: "Not allowed" }, 403);

    if (existingSale) {
      return c.json({ ok: true, duplicate: true, menu: tenant.menu ?? [], customers: tenant.customers ?? [], config: tenant.config ?? {}, updatedAt: tenant.updated_at ?? null });
    }

    const config = tenant.config ?? {};
    const currencies = config.currencies ?? [];
    const accountAction = incoming.accountAction;
    const creditAction = accountAction === "on-account" || accountAction === "settlement" || accountAction === "deposit";
    if (creditAction && config.allowCredits === false) return c.json({ error: "Customer credit is disabled" }, 403);
    if (creditAction && !incoming.customerId) return c.json({ error: "Customer is required" }, 400);
    const lines = accountAction === "settlement" || accountAction === "deposit"
      ? []
      : (Array.isArray(incoming.items) ? incoming.items : []);
    const menu = JSON.parse(JSON.stringify(tenant.menu ?? []));
    const priced: any[] = [];
    let grossBase = 0;
    for (const line of lines) {
      const qty = Math.trunc(Number(line?.qty ?? 0));
      if (qty < 1) return c.json({ error: "Quantity must be at least 1" }, 400);
      const product = menu.find((item: any) => item?.id === line?.menuItemId);
      if (!product) return c.json({ error: "Unknown product" }, 400);
      const stock = Number(product.stock);
      const tracked = Number.isFinite(stock) && stock !== -1;
      if (tracked && stock < qty) return c.json({ error: `${product.name} does not have enough stock` }, 409);
      const baseUnit = toBase(Number(product.price) || 0, product.currencyCode, currencies);
      grossBase += baseUnit * qty;
      priced.push({
        menuItem: {
          id: product.id,
          name: product.name,
          description: String(product.description ?? ""),
          category: String(product.category ?? ""),
          price: Number(product.price) || 0,
          cost: roundMoney(toBase(Number(product.cost ?? 0) || 0, product.currencyCode, currencies)),
          currencyCode: product.currencyCode || "ZAR",
          basePrice: roundMoney(baseUnit),
        },
        qty,
      });
      if (tracked) product.stock = stock - qty;
    }

    const tenderCode = String(incoming.currencyCode || config.defaultCurrencyCode || "ZAR");
    const parts = splitVat(grossBase, config);
    const accountAmountBase = toBase(Number(incoming.accountAmount ?? 0) || 0, tenderCode, currencies);
    const delta = creditDelta(accountAction, parts.total, accountAmountBase);
    const customers = JSON.parse(JSON.stringify(tenant.customers ?? []));
    const movesSpend = !accountAction || accountAction === "purchase" || accountAction === "on-account";
    if (incoming.customerId && (delta !== 0 || movesSpend || creditAction)) {
      const customer = customers.find((entry: any) => entry?.id === incoming.customerId);
      if (!customer) return c.json({ error: "Customer not found" }, 400);
      if (creditAction && customer.creditAllowed === false) return c.json({ error: "This customer is not allowed credit" }, 403);
      if (delta !== 0) {
        const currentCredit = Number(customer.creditBalance ?? customer.credit ?? 0);
        customer.creditBalance = roundMoney(currentCredit + delta);
      }
      if (movesSpend) {
        customer.totalSpent = roundMoney(Number(customer.totalSpent ?? 0) + parts.total);
        customer.visits = Number(customer.visits ?? 0) + 1;
      }
    }

    const rate = rateOf(currencies, tenderCode);
    const sale = {
      ...incoming,
      id: saleId,
      items: priced,
      subtotal: parts.subtotal,
      tax: parts.tax,
      total: parts.total,
      totalConverted: roundMoney(fromBase(parts.total, tenderCode, currencies)),
      rateSnapshot: rate,
      staffId: member.id,
      timestamp: incoming.timestamp ?? new Date().toISOString(),
    };

    const saved = await insertSaleRow(supabase, { id: saleId, tenant_email: email, sale }, sale);
    if (!saved.ok) return c.json({ error: saved.error }, 400);
    if (saved.duplicate) {
      return c.json({ ok: true, duplicate: true, menu: tenant.menu ?? [], customers: tenant.customers ?? [], config, updatedAt: tenant.updated_at ?? null });
    }

    const processed = Array.isArray(config.processedSaleIds) ? config.processedSaleIds : [];
    const nextConfig = { ...config, processedSaleIds: [...processed, saleId].slice(-200) };
    const { data: updated, error: updateError } = await supabase
      .from("tenants")
      .update({ menu, customers, config: nextConfig })
      .eq("email", email)
      .eq("updated_at", tenant.updated_at)
      .select("updated_at")
      .maybeSingle();
    if (updateError) {
      await supabase.from("sales").delete().eq("id", saleId);
      return c.json({ error: updateError.message }, 400);
    }
    if (!updated) {
      await supabase.from("sales").delete().eq("id", saleId);
      if (attempt < 2) continue;
      return c.json({ error: "Sale conflict. Retry the charge." }, 409);
    }
    return c.json({ ok: true, sale, menu, customers, config: nextConfig, updatedAt: updated.updated_at });
  }
  return c.json({ error: "Sale conflict. Retry the charge." }, 409);
});

// ── VENUE: get sales ──────────────────────────────────────────────────────────
app.get("/server/tenant/:email/sales", async (c) => {
  const email = normalizeEmail(decodeURIComponent(c.req.param("email")));
  const supabase = db();
  const { data, error } = await supabase
    .from("sales")
    .select("sale, saved_at")
    .eq("tenant_email", email)
    .order("saved_at", { ascending: false })
    .limit(500);
  if (error) return c.json({ error: error.message }, 400);
  return c.json((data ?? []).map((row: any) => ({ ...(row.sale ?? {}), savedAt: row.saved_at })));
});

// ── VENUE: cleanup is disabled so sales history cannot be deleted from the till
app.post("/server/tenant/:email/sales/cleanup", (c) => c.json({ error: "Sales cleanup is disabled." }, 410));

// ── Default config ────────────────────────────────────────────────────────────
function defaultConfig() {
  return {
    defaultCurrencyCode: "ZAR", vatEnabled: true, vatRate: 15,
    currencies: [
      { code: "ZAR", symbol: "R", name: "South African Rand", rate: 1, enabled: true },
      { code: "USD", symbol: "$", name: "US Dollar", rate: 0.054, enabled: true },
      { code: "EUR", symbol: "€", name: "Euro", rate: 0.050, enabled: false },
      { code: "GBP", symbol: "£", name: "British Pound", rate: 0.043, enabled: false },
      { code: "NAD", symbol: "N$", name: "Namibian Dollar", rate: 1.0, enabled: false },
      { code: "BWP", symbol: "P", name: "Botswana Pula", rate: 0.073, enabled: false },
      { code: "ZMW", symbol: "K", name: "Zambian Kwacha", rate: 1.42, enabled: false },
    ],
    paymentMethods: [
      { id: "cash", name: "Cash", icon: "cash", enabled: true },
      { id: "card", name: "Card", icon: "card", enabled: true },
      { id: "snapscan", name: "SnapScan", icon: "qr", enabled: true },
      { id: "zapper", name: "Zapper", icon: "qr", enabled: false },
      { id: "eft", name: "EFT", icon: "bank", enabled: false },
      { id: "applepay", name: "Apple Pay", icon: "mobile", enabled: false },
    ],
    categories: [
      { name: "Cocktails", enabled: true }, { name: "Beer", enabled: true },
      { name: "Spirits", enabled: true }, { name: "Wine", enabled: true },
      { name: "N/A", enabled: true }, { name: "Food", enabled: true },
    ],
    receiptTemplate: defaultReceiptTemplate(),
  };
}

function defaultReceiptTemplate() {
  return {
    headerLine1: "",
    headerLine2: "",
    footerLine: "Thank you for visiting {{businessName}}!",
    showLogo: true,
    showAddress: true,
    showPhone: true,
    showVatNumber: true,
    showTabName: true,
    showPaymentMethod: true,
  };
}

app.all("*", (c) => c.json({ error: "Not Found", path: c.req.path }, 404));

Deno.serve(app.fetch);
