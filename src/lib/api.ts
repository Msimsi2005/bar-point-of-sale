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
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error ?? "Request failed") as Error & { status?: number };
    error.status = res.status;
    throw error;
  }
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
  paused?: boolean;
  receiptTemplate?: {
    headerLine1?: string;
    headerLine2?: string;
    footerLine?: string;
    showLogo?: boolean;
    showAddress?: boolean;
    showPhone?: boolean;
    showVatNumber?: boolean;
    showTabName?: boolean;
    showPaymentMethod?: boolean;
  };
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

export async function apiUpdateTenantCredentials(email: string, patch: {
  loginEmail?: string;
  password?: string;
  staffId: string;
  pin?: string;
}, tenantToken: string) {
  return call(`/tenant/${encodeURIComponent(email)}/credentials`, "PATCH", patch, tenantToken);
}

export async function apiAddSale(email: string, sale: object, tenantToken: string) {
  return call(`/tenant/${encodeURIComponent(email)}/sale`, "POST", sale, tenantToken);
}

export async function apiStartStaffSession(email: string, staffId: string, pin: string, tenantToken: string) {
  return call(`/tenant/${encodeURIComponent(email)}/staff/session`, "POST", { staffId, pin }, tenantToken);
}

export async function apiLogout(email: string, tenantToken: string) {
  return call(`/tenant/${encodeURIComponent(email)}/logout`, "POST", {}, tenantToken);
}

export async function apiGetSales(email: string, tenantToken: string) {
  return call(`/tenant/${encodeURIComponent(email)}/sales`, "GET", undefined, tenantToken);
}

