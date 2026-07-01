import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import { createClient as createSupabaseClient } from "jsr:@supabase/supabase-js@2.49.8";

const app = new Hono();

app.use("*", logger(console.log));
app.use("/*", cors({
  origin: "*",
  allowHeaders: ["Content-Type", "Authorization"],
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  exposeHeaders: ["Content-Length"],
  maxAge: 600,
}));

// ── Superadmin credentials (server-only) ────────────────────────────────────
const SUPERADMIN_PASSWORD = "PourPOS@Admin2026";
const SUPERADMIN_EMAIL    = "superadmin@pourpos.co.za";

function isSuperAdmin(c: any): boolean {
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

function toTenantSummary(row: any) {
  return {
    email: row.email,
    name: row.business_info?.name ?? "",
    createdAt: row.created_at ?? new Date().toISOString(),
  };
}

function toTenantResponse(row: any, sales: any[]) {
  return {
    id: row.id,
    email: row.email,
    businessInfo: row.business_info ?? {},
    config: row.config ?? defaultConfig(),
    menu: row.menu ?? [],
    customers: row.customers ?? [],
    staff: row.staff ?? [],
    createdAt: row.created_at ?? new Date().toISOString(),
    sales,
  };
}

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
    .select("email, business_info, created_at")
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
  if (!body.password) return c.json({ ok: true });
  const passwordHash = await hashPassword(body.password);

  const { error } = await supabase
    .from("tenants")
    .update({ password_hash: passwordHash })
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
  return c.json(toTenantResponse(tenant, sales));
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
  const { error } = await supabase.from("sales").insert({
    id: crypto.randomUUID(),
    tenant_email: email,
    sale,
  });
  if (error) return c.json({ error: error.message }, 400);

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
