import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import { createClient } from "npm:@supabase/postgres-js";
import * as kv from "./kv_store.tsx";

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

// ── Health ──────────────────────────────────────────────────────────────────
app.get("/make-server-b88a7963/health", (c) => c.json({ status: "ok" }));

// ── SQL execution (superadmin only) ───────────────────────────────────────────
app.post("/make-server-b88a7963/sql", async (c) => {
  if (!isSuperAdmin(c)) return c.json({ error: "Unauthorized" }, 401);

  const { sql } = await c.req.json();
  if (!sql || typeof sql !== "string") return c.json({ error: "Missing SQL statement" }, 400);

  const dbUrl = Deno.env.get("SUPABASE_DB_URL");
  if (!dbUrl) return c.json({ error: "SUPABASE_DB_URL is not configured" }, 500);

  const client = createClient(dbUrl);
  const result = await client.query(sql);

  if (result.error) {
    return c.json({ error: result.error.message ?? "SQL execution failed" }, 400);
  }

  return c.json({ result: result.data ?? null, command: result.command ?? null, count: result.count ?? null });
});

// ── Password helper ─────────────────────────────────────────────────────────
async function hashPassword(pw: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pw));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function tenantKey(email: string) { return `tenant:${email.toLowerCase().trim()}`; }
function salesKey(email: string)  { return `sales:${email.toLowerCase().trim()}`; }
const INDEX_KEY = "tenant_index";

async function addToIndex(entry: object) {
  const index: any[] = (await kv.get(INDEX_KEY)) ?? [];
  index.push(entry);
  await kv.set(INDEX_KEY, index);
}

async function removeFromIndex(email: string) {
  const index: any[] = (await kv.get(INDEX_KEY)) ?? [];
  await kv.set(INDEX_KEY, index.filter((t: any) => t.email !== email.toLowerCase().trim()));
}

// ── SUPERADMIN: login ────────────────────────────────────────────────────────
app.post("/make-server-b88a7963/admin/login", async (c) => {
  const { email, password } = await c.req.json();
  if (email?.toLowerCase().trim() !== SUPERADMIN_EMAIL || password !== SUPERADMIN_PASSWORD) {
    return c.json({ error: "Invalid superadmin credentials" }, 401);
  }
  // Return the password as the bearer token (simple, server-verified on each request)
  return c.json({ token: SUPERADMIN_PASSWORD });
});

// ── VENUE: register ──────────────────────────────────────────────────────────
app.post("/make-server-b88a7963/auth/register", async (c) => {
  const { email, password, businessName } = await c.req.json();
  if (!email || !password || !businessName) return c.json({ error: "Missing fields" }, 400);

  const existing = await kv.get(tenantKey(email));
  if (existing) return c.json({ error: "Email already registered" }, 409);

  const passwordHash = await hashPassword(password);
  const staffOwnerId = crypto.randomUUID();

  const tenant = {
    id: crypto.randomUUID(),
    email: email.toLowerCase().trim(),
    passwordHash,
    plan: "starter",
    businessInfo: {
      name: businessName,
      logo: null,
      address: "",
      phone: "",
      email: email.toLowerCase().trim(),
      website: "",
      regNumber: "",
      vatNumber: "",
    },
    config: defaultConfig(),
    menu: [],
    customers: [],
    staff: [{ id: staffOwnerId, name: businessName, pin: "1234", role: "owner" }],
    createdAt: new Date().toISOString(),
  };

  await kv.set(tenantKey(email), tenant);
  await kv.set(salesKey(email), []);
  await addToIndex({ email: tenant.email, name: businessName, plan: tenant.plan, createdAt: tenant.createdAt });

  const { passwordHash: _, ...safe } = tenant;
  return c.json({ ...safe, sales: [] }, 201);
});

// ── SUPERADMIN: list all tenants ─────────────────────────────────────────────
app.get("/make-server-b88a7963/admin/tenants", async (c) => {
  if (!isSuperAdmin(c)) return c.json({ error: "Unauthorized" }, 401);
  const index = (await kv.get(INDEX_KEY)) ?? [];
  return c.json(index);
});

// ── SUPERADMIN: register a company ───────────────────────────────────────────
app.post("/make-server-b88a7963/admin/tenants", async (c) => {
  if (!isSuperAdmin(c)) return c.json({ error: "Unauthorized" }, 401);
  const { email, password, businessName, plan } = await c.req.json();
  if (!email || !password || !businessName) return c.json({ error: "Missing fields" }, 400);

  const existing = await kv.get(tenantKey(email));
  if (existing) return c.json({ error: "Email already registered" }, 409);

  const passwordHash = await hashPassword(password);
  const staffOwnerId = crypto.randomUUID();

  const tenant = {
    id: crypto.randomUUID(),
    email: email.toLowerCase().trim(),
    passwordHash,
    plan: plan ?? "starter",
    businessInfo: {
      name: businessName, logo: null, address: "", phone: "",
      email: email.toLowerCase().trim(), website: "", regNumber: "", vatNumber: "",
    },
    config: defaultConfig(),
    menu: [],
    customers: [],
    staff: [{ id: staffOwnerId, name: businessName, pin: "1234", role: "owner" }],
    createdAt: new Date().toISOString(),
  };

  await kv.set(tenantKey(email), tenant);
  await kv.set(salesKey(email), []);
  await addToIndex({ email: tenant.email, name: businessName, plan: tenant.plan, createdAt: tenant.createdAt });

  const { passwordHash: _, ...safe } = tenant;
  return c.json(safe, 201);
});

// ── SUPERADMIN: update tenant (plan, reset password) ─────────────────────────
app.patch("/make-server-b88a7963/admin/tenants/:email", async (c) => {
  if (!isSuperAdmin(c)) return c.json({ error: "Unauthorized" }, 401);
  const email = decodeURIComponent(c.req.param("email"));
  const existing = await kv.get(tenantKey(email));
  if (!existing) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json();
  const patch: any = { ...existing };
  if (body.plan) patch.plan = body.plan;
  if (body.password) patch.passwordHash = await hashPassword(body.password);

  await kv.set(tenantKey(email), patch);

  // Update index entry
  const index: any[] = (await kv.get(INDEX_KEY)) ?? [];
  const updated = index.map((t: any) => t.email === email.toLowerCase() ? { ...t, plan: patch.plan } : t);
  await kv.set(INDEX_KEY, updated);

  return c.json({ ok: true });
});

// ── SUPERADMIN: delete a company ─────────────────────────────────────────────
app.delete("/make-server-b88a7963/admin/tenants/:email", async (c) => {
  if (!isSuperAdmin(c)) return c.json({ error: "Unauthorized" }, 401);
  const email = decodeURIComponent(c.req.param("email"));
  await kv.del(tenantKey(email));
  await kv.del(salesKey(email));
  await removeFromIndex(email);
  return c.json({ ok: true });
});

// ── VENUE: login ─────────────────────────────────────────────────────────────
app.post("/make-server-b88a7963/auth/login", async (c) => {
  const { email, password } = await c.req.json();
  if (!email || !password) return c.json({ error: "Missing fields" }, 400);

  const tenant = await kv.get(tenantKey(email));
  if (!tenant) return c.json({ error: "Invalid email or password" }, 401);

  const hash = await hashPassword(password);
  if (hash !== tenant.passwordHash) return c.json({ error: "Invalid email or password" }, 401);

  const sales = (await kv.get(salesKey(email))) ?? [];
  const { passwordHash: _, ...safe } = tenant;
  return c.json({ ...safe, sales });
});

// ── VENUE: get tenant ─────────────────────────────────────────────────────────
app.get("/make-server-b88a7963/tenant/:email", async (c) => {
  const email = decodeURIComponent(c.req.param("email"));
  const tenant = await kv.get(tenantKey(email));
  if (!tenant) return c.json({ error: "Not found" }, 404);
  const sales = (await kv.get(salesKey(email))) ?? [];
  const { passwordHash: _, ...safe } = tenant;
  return c.json({ ...safe, sales });
});

// ── VENUE: save tenant ────────────────────────────────────────────────────────
app.put("/make-server-b88a7963/tenant/:email", async (c) => {
  const email = decodeURIComponent(c.req.param("email"));
  const existing = await kv.get(tenantKey(email));
  if (!existing) return c.json({ error: "Not found" }, 404);
  const body = await c.req.json();
  const updated = { ...existing, ...body, passwordHash: existing.passwordHash, email: existing.email };
  await kv.set(tenantKey(email), updated);

  // Keep index name/plan in sync
  const index: any[] = (await kv.get(INDEX_KEY)) ?? [];
  const synced = index.map((t: any) =>
    t.email === email.toLowerCase()
      ? { ...t, name: updated.businessInfo?.name ?? t.name, plan: updated.plan ?? t.plan }
      : t
  );
  await kv.set(INDEX_KEY, synced);

  const { passwordHash: _, ...safe } = updated;
  return c.json(safe);
});

// ── VENUE: add sale ───────────────────────────────────────────────────────────
app.post("/make-server-b88a7963/tenant/:email/sale", async (c) => {
  const email = decodeURIComponent(c.req.param("email"));
  const sale = await c.req.json();
  const sales: any[] = (await kv.get(salesKey(email))) ?? [];
  sales.unshift({ ...sale, savedAt: new Date().toISOString() });
  if (sales.length > 500) sales.splice(500);
  await kv.set(salesKey(email), sales);
  return c.json({ ok: true });
});

// ── VENUE: get sales ──────────────────────────────────────────────────────────
app.get("/make-server-b88a7963/tenant/:email/sales", async (c) => {
  const email = decodeURIComponent(c.req.param("email"));
  const sales = (await kv.get(salesKey(email))) ?? [];
  return c.json(sales);
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

Deno.serve(app.fetch);
