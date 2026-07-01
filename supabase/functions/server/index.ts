import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import { createClient as createSupabaseClient } from "jsr:@supabase/supabase-js@2.49.8";

const app = new Hono();

app.use("*", logger(console.log));
app.use("/*", cors({
  origin: "*",
  allowHeaders: ["Content-Type", "Authorization", "X-Superadmin-Token", "X-Tenant-Token"],
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  exposeHeaders: ["Content-Length"],
  maxAge: 600,
}));

// ── Superadmin credentials (server-only) ────────────────────────────────────
const SUPERADMIN_PASSWORD = "PourPOS@Admin2026";
const SUPERADMIN_EMAIL    = "superadmin@pourpos.co.za";

function isSuperAdmin(c: any): boolean {
  const custom = c.req.header("X-Superadmin-Token") ?? "";
  if (custom && custom === SUPERADMIN_PASSWORD) return true;
  const auth = c.req.header("Authorization") ?? "";
  const token = auth.replace("Bearer ", "");
  return token === SUPERADMIN_PASSWORD;
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

  if (!allowed) return c.json({ error: "Unauthorized tenant access" }, 401);
  await next();
});

// ── SUPERADMIN: login ────────────────────────────────────────────────────────
app.post("/server/admin/login", async (c) => {
  const { email, password } = await c.req.json();
  if (email?.toLowerCase().trim() !== SUPERADMIN_EMAIL || password !== SUPERADMIN_PASSWORD) {
    return c.json({ error: "Invalid superadmin credentials" }, 401);
  }
  // Return the password as the bearer token (simple, server-verified on each request)
  return c.json({ token: SUPERADMIN_PASSWORD });
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

  if (typeof body.password === "string" && body.password.trim().length > 0) {
    updates.password_hash = await hashPassword(body.password);
  }

  if (typeof body.paused === "boolean") {
    const { data: existing, error: existingError } = await supabase
      .from("tenants")
      .select("config")
      .eq("email", email)
      .maybeSingle();
    if (existingError) return c.json({ error: existingError.message }, 400);
    const currentConfig = existing?.config ?? defaultConfig();
    updates.config = { ...currentConfig, paused: body.paused };
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
  const { email, password } = await c.req.json();
  if (!email || !password) return c.json({ error: "Missing fields" }, 400);

  const supabase = db();
  const normalizedEmail = normalizeEmail(email);
  const { data: tenant, error } = await supabase
    .from("tenants")
    .select("id, email, password_hash, business_info, config, menu, customers, staff, created_at")
    .eq("email", normalizedEmail)
    .maybeSingle();
  if (error) return c.json({ error: error.message }, 400);
  if (!tenant) return c.json({ error: "Invalid email or password" }, 401);

  if (tenant.config?.paused === true) {
    return c.json({ error: "This business is paused. Contact superadmin." }, 403);
  }

  const hash = await hashPassword(password);
  if (hash !== tenant.password_hash) return c.json({ error: "Invalid email or password" }, 401);

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
  };
}

app.all("*", (c) => c.json({ error: "Not Found", path: c.req.path }, 404));

Deno.serve(app.fetch);
