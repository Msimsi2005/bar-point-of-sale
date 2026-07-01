import { API_BASE, SUPABASE_ANON_KEY } from "./supabase";

async function call(path: string, method = "GET", body?: unknown, token?: string, extraHeaders?: Record<string, string>) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token ?? SUPABASE_ANON_KEY}`,
      ...(extraHeaders ?? {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data;
}

// ── Superadmin ───────────────────────────────────────────────────────────────

export async function apiAdminLogin(email: string, password: string) {
  return call("/admin/login", "POST", { email, password });
}

export async function apiAdminListTenants(token: string) {
  return call("/admin/tenants", "GET", undefined, undefined, { "X-Superadmin-Token": token });
}

export async function apiAdminCreateTenant(token: string, data: {
  email: string; password: string; businessName: string;
}) {
  return call("/admin/tenants", "POST", data, undefined, { "X-Superadmin-Token": token });
}

export async function apiAdminUpdateTenant(token: string, email: string, patch: {
  password?: string;
}) {
  return call(`/admin/tenants/${encodeURIComponent(email)}`, "PATCH", patch, undefined, { "X-Superadmin-Token": token });
}

export async function apiAdminDeleteTenant(token: string, email: string) {
  return call(`/admin/tenants/${encodeURIComponent(email)}`, "DELETE", undefined, undefined, { "X-Superadmin-Token": token });
}

// ── Venue ────────────────────────────────────────────────────────────────────

export async function apiLogin(email: string, password: string) {
  return call("/auth/login", "POST", { email, password });
}

export async function apiGetTenant(email: string, tenantToken: string) {
  return call(`/tenant/${encodeURIComponent(email)}`, "GET", undefined, tenantToken);
}

export async function apiSaveTenant(email: string, patch: object, tenantToken: string) {
  return call(`/tenant/${encodeURIComponent(email)}`, "PUT", patch, tenantToken);
}

export async function apiAddSale(email: string, sale: object, tenantToken: string) {
  return call(`/tenant/${encodeURIComponent(email)}/sale`, "POST", sale, tenantToken);
}

export async function apiGetSales(email: string, tenantToken: string) {
  return call(`/tenant/${encodeURIComponent(email)}/sales`, "GET", undefined, tenantToken);
}

export async function apiExecuteSql(token: string, sql: string) {
  return call("/sql", "POST", { sql }, undefined, { "X-Superadmin-Token": token });
}
