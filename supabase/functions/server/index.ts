import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import { createClient as createSupabaseClient } from "jsr:@supabase/supabase-js@2.49.8";

const app = new Hono();

app.use("*", logger(console.log));
app.use("/*", cors({
  origin: "*",
  allowHeaders: ["Content-Type", "Authorization", "X-Superadmin-Token", "X-Tenant-Token"],
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  exposeHeaders: ["Content-Length"],
  maxAge: 600,
}));

// ── Superadmin credentials (server-only) ────────────────────────────────────
const DEFAULT_SUPERADMIN_PASSWORD = "mistyWHY2012";
const SUPERADMIN_EMAIL = normalizeEmail(Deno.env.get("SUPERADMIN_EMAIL") ?? "msizimoyo24@gmail.com");
const SUPERADMIN_PASSWORDS = (Deno.env.get("SUPERADMIN_PASSWORDS") ?? Deno.env.get("SUPERADMIN_PASSWORD") ?? DEFAULT_SUPERADMIN_PASSWORD)
  .split(",")
  .map((value) => value.trim())
  .filter((value) => value.length > 0);

const RATE_LIMITS = {
  globalPerMinute: Number(Deno.env.get("RATE_LIMIT_GLOBAL_PER_MINUTE") ?? 240),
  loginPerMinute: Number(Deno.env.get("RATE_LIMIT_LOGIN_PER_MINUTE") ?? 15),
  authMaxFailures: Number(Deno.env.get("AUTH_MAX_FAILURES") ?? 5),
  authLockMinutes: Number(Deno.env.get("AUTH_LOCK_MINUTES") ?? 15),
};

type RateBucket = { count: number; windowStart: number };
const rateBuckets = new Map<string, RateBucket>();

type AuthFailureBucket = { failures: number; lockedUntil: number };
const authFailures = new Map<string, AuthFailureBucket>();

function getClientIp(c: any): string {
  return c.req.header("cf-connecting-ip")
    ?? c.req.header("x-forwarded-for")?.split(",")?.[0]?.trim()
    ?? c.req.header("x-real-ip")
    ?? "unknown";
}

function isValidSuperAdminPassword(token: string): boolean {
  return SUPERADMIN_PASSWORDS.includes(token);
}

function checkRateLimit(scope: string, key: string, maxRequests: number, windowMs: number) {
  const now = Date.now();
  const bucketKey = `${scope}:${key}`;
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

function authFailureKey(scope: "admin" | "tenant", email: string, ip: string) {
  return `${scope}:${normalizeEmail(email)}:${ip}`;
}

function getAuthLockState(key: string) {
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

function recordAuthFailure(key: string) {
  const current = authFailures.get(key) ?? { failures: 0, lockedUntil: 0 };
  const failures = current.failures + 1;
  const shouldLock = failures >= Math.max(1, RATE_LIMITS.authMaxFailures);
  const lockedUntil = shouldLock ? Date.now() + Math.max(1, RATE_LIMITS.authLockMinutes) * 60_000 : 0;
  authFailures.set(key, { failures, lockedUntil });
  return { failures, locked: shouldLock, retryAfterMs: shouldLock ? lockedUntil - Date.now() : 0 };
}

function clearAuthFailures(key: string) {
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

function isSuperAdmin(c: any): boolean {
  const custom = c.req.header("X-Superadmin-Token") ?? "";
  if (custom && isValidSuperAdminPassword(custom)) return true;
  const auth = c.req.header("Authorization") ?? "";
  const token = auth.replace("Bearer ", "");
  return isValidSuperAdminPassword(token);
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
app.post("/server/sql", async (c) => {
  if (!isSuperAdmin(c)) return c.json({ error: "Unauthorized" }, 401);

  return c.json({ error: "SQL endpoint is disabled in this deployment." }, 501);
});

// ── Password helper ─────────────────────────────────────────────────────────
async function hashPassword(pw: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pw));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
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
  const secret = Deno.env.get("TENANT_TOKEN_SECRET") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "fallback-tenant-secret";
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

async function createTenantToken(email: string) {
  const payload = JSON.stringify({
    email,
    exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24 * 7),
  });
  const payloadB64 = base64UrlEncode(payload);
  const sig = await signTokenPayload(payloadB64);
  return `${payloadB64}.${sig}`;
}

async function verifyTenantToken(token: string, email: string) {
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payloadB64, sig] = parts;
  const expectedSig = await signTokenPayload(payloadB64);
  if (expectedSig !== sig) return false;

  try {
    const payload = JSON.parse(base64UrlDecode(payloadB64));
    if (!payload?.email || !payload?.exp) return false;
    if (normalizeEmail(String(payload.email)) !== normalizeEmail(email)) return false;
    if (Math.floor(Date.now() / 1000) > Number(payload.exp)) return false;
    return true;
  } catch {
    return false;
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
    staff: row.staff ?? [],
    createdAt: row.created_at ?? new Date().toISOString(),
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
  const allowed = token ? await verifyTenantToken(token, email) : false;

  if (!allowed) {
    auditEvent(c, "tenant.auth", "denied", { email });
    return c.json({ error: "Unauthorized tenant access" }, 401);
  }
  await next();
});

// ── SUPERADMIN: login ────────────────────────────────────────────────────────
app.post("/server/admin/login", async (c) => {
  const ip = getClientIp(c);
  const loginRate = checkRateLimit("admin_login", ip, Math.max(1, RATE_LIMITS.loginPerMinute), 60_000);
  if (!loginRate.allowed) {
    auditEvent(c, "admin.login", "denied", { reason: "rate_limited", retryAfterMs: loginRate.retryAfterMs });
    c.header("Retry-After", String(Math.ceil(loginRate.retryAfterMs / 1000)));
    return c.json({ error: "Too many login attempts. Please retry shortly." }, 429);
  }

  const { email, password } = await c.req.json();
  const normalizedEmail = normalizeEmail(String(email ?? ""));
  const authKey = authFailureKey("admin", normalizedEmail, ip);
  const lockState = getAuthLockState(authKey);
  if (lockState.locked) {
    auditEvent(c, "admin.login", "denied", { reason: "locked", email: normalizedEmail, retryAfterMs: lockState.retryAfterMs });
    c.header("Retry-After", String(Math.ceil(lockState.retryAfterMs / 1000)));
    return c.json({ error: "Account temporarily locked due to repeated failures." }, 429);
  }

  if (normalizedEmail !== SUPERADMIN_EMAIL || !isValidSuperAdminPassword(String(password ?? ""))) {
    const failure = recordAuthFailure(authKey);
    auditEvent(c, "admin.login", "denied", { reason: "invalid_credentials", email: normalizedEmail, failures: failure.failures, locked: failure.locked });
    if (failure.locked) {
      c.header("Retry-After", String(Math.ceil(failure.retryAfterMs / 1000)));
      return c.json({ error: "Account temporarily locked due to repeated failures." }, 429);
    }
    return c.json({ error: "Invalid superadmin credentials" }, 401);
  }

  clearAuthFailures(authKey);
  auditEvent(c, "admin.login", "ok", { email: normalizedEmail });
  // Return the password that was validated as the bearer token (server re-verifies per request).
  return c.json({ token: String(password) });
});

// ── SUPERADMIN: list all tenants ─────────────────────────────────────────────
app.get("/server/admin/tenants", async (c) => {
  if (!isSuperAdmin(c)) return c.json({ error: "Unauthorized" }, 401);
  const supabase = db();
  const { data, error } = await supabase
    .from("tenants")
    .select("email, business_info, config, created_at")
    .order("created_at", { ascending: false });
  if (error) return c.json({ error: error.message }, 400);
  return c.json((data ?? []).map(toTenantSummary));
});

// ── SUPERADMIN: register a company ───────────────────────────────────────────
app.post("/server/admin/tenants", async (c) => {
  if (!isSuperAdmin(c)) return c.json({ error: "Unauthorized" }, 401);
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
    staff: [{ id: staffOwnerId, name: businessName, pin: "1234", role: "owner" }],
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
  if (!isSuperAdmin(c)) return c.json({ error: "Unauthorized" }, 401);
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
  }

  if (typeof body.paused === "boolean") {
    try {
      const currentConfig = await ensureExistingConfig();
      updates.config = { ...currentConfig, paused: body.paused };
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
  if (!isSuperAdmin(c)) return c.json({ error: "Unauthorized" }, 401);
  const email = normalizeEmail(decodeURIComponent(c.req.param("email")));
  const supabase = db();
  const { error } = await supabase.from("tenants").delete().eq("email", email);
  if (error) return c.json({ error: error.message }, 400);
  return c.json({ ok: true });
});

// ── VENUE: login ─────────────────────────────────────────────────────────────
app.post("/server/auth/login", async (c) => {
  const ip = getClientIp(c);
  const loginRate = checkRateLimit("tenant_login", ip, Math.max(1, RATE_LIMITS.loginPerMinute), 60_000);
  if (!loginRate.allowed) {
    auditEvent(c, "tenant.login", "denied", { reason: "rate_limited", retryAfterMs: loginRate.retryAfterMs });
    c.header("Retry-After", String(Math.ceil(loginRate.retryAfterMs / 1000)));
    return c.json({ error: "Too many login attempts. Please retry shortly." }, 429);
  }

  const { email, password } = await c.req.json();
  if (!email || !password) return c.json({ error: "Missing fields" }, 400);

  const supabase = db();
  const normalizedEmail = normalizeEmail(email);
  const authKey = authFailureKey("tenant", normalizedEmail, ip);
  const lockState = getAuthLockState(authKey);
  if (lockState.locked) {
    auditEvent(c, "tenant.login", "denied", { reason: "locked", email: normalizedEmail, retryAfterMs: lockState.retryAfterMs });
    c.header("Retry-After", String(Math.ceil(lockState.retryAfterMs / 1000)));
    return c.json({ error: "Account temporarily locked due to repeated failures." }, 429);
  }

  const { data: tenant, error } = await supabase
    .from("tenants")
    .select("id, email, password_hash, business_info, config, menu, customers, staff, created_at")
    .eq("email", normalizedEmail)
    .maybeSingle();
  if (error) return c.json({ error: error.message }, 400);
  if (!tenant) {
    const failure = recordAuthFailure(authKey);
    auditEvent(c, "tenant.login", "denied", { reason: "invalid_credentials", email: normalizedEmail, failures: failure.failures, locked: failure.locked });
    return c.json({ error: "Invalid email or password" }, failure.locked ? 429 : 401);
  }

  if (tenant.config?.paused === true) {
    auditEvent(c, "tenant.login", "denied", { reason: "paused", email: normalizedEmail });
    return c.json({ error: "This business is paused. Contact superadmin." }, 403);
  }

  const hash = await hashPassword(password);
  if (hash !== tenant.password_hash) {
    const failure = recordAuthFailure(authKey);
    auditEvent(c, "tenant.login", "denied", { reason: "invalid_credentials", email: normalizedEmail, failures: failure.failures, locked: failure.locked });
    return c.json({ error: "Invalid email or password" }, failure.locked ? 429 : 401);
  }

  clearAuthFailures(authKey);
  auditEvent(c, "tenant.login", "ok", { email: normalizedEmail });

  const { data: salesRows, error: salesError } = await supabase
    .from("sales")
    .select("sale, saved_at")
    .eq("tenant_email", normalizedEmail)
    .order("saved_at", { ascending: false })
    .limit(500);
  if (salesError) return c.json({ error: salesError.message }, 400);

  const sales = (salesRows ?? []).map((row: any) => ({ ...(row.sale ?? {}), savedAt: row.saved_at }));
  const tenantToken = await createTenantToken(normalizedEmail);
  return c.json(toTenantResponse(tenant, sales, tenantToken));
});

// ── VENUE: get tenant ─────────────────────────────────────────────────────────
app.get("/server/tenant/:email", async (c) => {
  const email = normalizeEmail(decodeURIComponent(c.req.param("email")));
  const supabase = db();
  const { data: tenant, error } = await supabase
    .from("tenants")
    .select("id, email, business_info, config, menu, customers, staff, created_at")
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

// ── VENUE: save tenant ────────────────────────────────────────────────────────
app.put("/server/tenant/:email", async (c) => {
  const email = normalizeEmail(decodeURIComponent(c.req.param("email")));
  const supabase = db();
  const { data: existing, error: existingError } = await supabase
    .from("tenants")
    .select("id, email")
    .eq("email", email)
    .maybeSingle();
  if (existingError) return c.json({ error: existingError.message }, 400);
  if (!existing) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json();

  const patch: any = {};
  if (body.businessInfo !== undefined) patch.business_info = body.businessInfo;
  if (body.config !== undefined) patch.config = body.config;
  if (body.menu !== undefined) patch.menu = body.menu;
  if (body.customers !== undefined) patch.customers = body.customers;
  if (body.staff !== undefined) patch.staff = body.staff;

  const { data: updated, error: updateError } = await supabase
    .from("tenants")
    .update(patch)
    .eq("email", email)
    .select("id, email, business_info, config, menu, customers, staff, created_at")
    .single();
  if (updateError) return c.json({ error: updateError.message }, 400);

  return c.json(toTenantResponse(updated, []));
});

app.patch("/server/tenant/:email/credentials", async (c) => {
  const email = normalizeEmail(decodeURIComponent(c.req.param("email")));
  const supabase = db();
  const { data: existing, error: existingError } = await supabase
    .from("tenants")
    .select("id, email, business_info, config, menu, customers, staff, created_at")
    .eq("email", email)
    .maybeSingle();
  if (existingError) return c.json({ error: existingError.message }, 400);
  if (!existing) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json();
  const updates: Record<string, unknown> = {};
  let nextEmail = email;

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

  if (typeof body.pin === "string") {
    if (!/^\d{4}$/.test(body.pin)) return c.json({ error: "PIN must be exactly 4 digits" }, 400);
    const staffId = typeof body.staffId === "string" ? body.staffId : "";
    if (!staffId) return c.json({ error: "Staff ID is required to update PIN" }, 400);
    const staff = Array.isArray(existing.staff) ? existing.staff : [];
    if (!staff.some((member: any) => member?.id === staffId)) return c.json({ error: "Staff member not found" }, 404);
    updates.staff = staff.map((member: any) => member?.id === staffId ? { ...member, pin: body.pin } : member);
  }

  if (Object.keys(updates).length === 0) return c.json({ error: "No credential changes supplied" }, 400);

  const { data: updated, error: updateError } = await supabase
    .from("tenants")
    .update(updates)
    .eq("email", email)
    .select("id, email, business_info, config, menu, customers, staff, created_at")
    .single();
  if (updateError) return c.json({ error: updateError.message }, 400);

  const tenantToken = await createTenantToken(nextEmail);
  return c.json(toTenantResponse(updated, [], tenantToken));
});

// ── VENUE: add sale ───────────────────────────────────────────────────────────
app.post("/server/tenant/:email/sale", async (c) => {
  const email = normalizeEmail(decodeURIComponent(c.req.param("email")));
  const sale = await c.req.json();
  const supabase = db();

  const baseInsert = {
    id: crypto.randomUUID(),
    tenant_email: email,
    sale,
  };

  const { error: baseError } = await supabase.from("sales").insert(baseInsert);

  if (baseError) {
    const msg = String(baseError.message ?? "").toLowerCase();
    const isLegacyNotNull = msg.includes("violates not-null constraint") || msg.includes("null value in column");

    if (!isLegacyNotNull) {
      return c.json({ error: baseError.message }, 400);
    }

    // Legacy compatibility path: older sales schemas may still enforce NOT NULL on denormalized columns.
    const legacyInsert: Record<string, unknown> = {
      ...baseInsert,
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
    let legacySaved = false;

    for (let i = 0; i < 16; i++) {
      const { error: legacyError } = await supabase.from("sales").insert(legacyInsert);
      if (!legacyError) {
        legacySaved = true;
        break;
      }

      legacyErrorMessage = String(legacyError.message ?? "Unknown legacy insert error");
      const missingCol = /Could not find the '([^']+)' column/.exec(legacyErrorMessage);
      if (missingCol?.[1]) {
        delete legacyInsert[missingCol[1]];
        continue;
      }

      break;
    }

    if (!legacySaved) {
      return c.json({ error: `Sale save failed. ${baseError.message}. Legacy retry: ${legacyErrorMessage}` }, 400);
    }
  }

  // Keep only the latest 500 sales per tenant.
  const { data: toTrim, error: trimReadError } = await supabase
    .from("sales")
    .select("id")
    .eq("tenant_email", email)
    .order("saved_at", { ascending: false })
    .range(500, 2000);
  if (trimReadError) return c.json({ error: trimReadError.message }, 400);
  const staleIds = (toTrim ?? []).map((row: any) => row.id);
  if (staleIds.length) {
    const { error: trimError } = await supabase.from("sales").delete().in("id", staleIds);
    if (trimError) return c.json({ error: trimError.message }, 400);
  }

  return c.json({ ok: true });
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

// ── VENUE: cleanup test sales (guarded) ─────────────────────────────────────
app.post("/server/tenant/:email/sales/cleanup", async (c) => {
  const email = normalizeEmail(decodeURIComponent(c.req.param("email")));
  const supabase = db();

  const body = await c.req.json().catch(() => ({}));
  const confirm = String(body?.confirm ?? "");
  const tabName = String(body?.tabName ?? "").trim();
  const matchMode = body?.matchMode === "prefix" ? "prefix" : "exact";
  const requestedMaxDelete = Number(body?.maxDelete ?? 5);
  const maxDelete = Number.isFinite(requestedMaxDelete)
    ? Math.min(Math.max(Math.trunc(requestedMaxDelete), 1), 20)
    : 5;

  if (confirm !== "DELETE_TEST_SALES") {
    return c.json({ error: "Cleanup requires explicit confirmation token." }, 400);
  }

  if (!tabName) {
    return c.json({ error: "tabName is required." }, 400);
  }

  // Guardrail: this endpoint is only for removing test rows, not production sales.
  if (!/(test|sync|qa)/i.test(tabName)) {
    return c.json({ error: "tabName must clearly identify test data (test/sync/qa)." }, 400);
  }

  const { data, error } = await supabase
    .from("sales")
    .select("id, sale, saved_at")
    .eq("tenant_email", email)
    .order("saved_at", { ascending: false })
    .limit(500);

  if (error) return c.json({ error: error.message }, 400);

  const candidates = (data ?? []).filter((row: any) => {
    const currentTabName = String(row?.sale?.tabName ?? "");
    return matchMode === "prefix"
      ? currentTabName.startsWith(tabName)
      : currentTabName === tabName;
  });

  const toDelete = candidates.slice(0, maxDelete);
  const ids = toDelete.map((row: any) => row.id).filter(Boolean);

  if (!ids.length) {
    return c.json({ ok: true, deletedCount: 0, matchedCount: candidates.length });
  }

  const { error: deleteError } = await supabase.from("sales").delete().in("id", ids);
  if (deleteError) return c.json({ error: deleteError.message }, 400);

  return c.json({
    ok: true,
    deletedCount: ids.length,
    matchedCount: candidates.length,
    deletedIds: ids,
  });
});

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
