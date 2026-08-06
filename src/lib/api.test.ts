vi.mock("./supabase", () => ({
  API_BASE: "https://api.example.test/functions/v1/server",
  SUPABASE_ANON_KEY: "anon-test-key",
}));

import {
  apiGetSales, apiLogin, apiSaveTenant,
  apiAdminLogin, apiAdminListTenants, apiAdminCreateTenant,
  apiAdminUpdateTenant, apiAdminDeleteTenant,
  apiGetTenant, apiAddSale, apiUpdateTenantCredentials,
  apiExecuteSql,
} from "./api";
import { makeTenantSavePatch } from "../app/App";

const fetchMock = vi.fn();

describe("api helpers – venue auth & tenant", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("uses the anon key when logging in", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });

    await apiLogin("venue@example.com", "secret123");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/functions/v1/server/auth/login",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer anon-test-key",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ email: "venue@example.com", password: "secret123" }),
      }),
    );
  });

  it("uses the tenant token and serializes the save patch for tenant persistence", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });

    const patch = {
      businessInfo: { name: "Misty Venue" },
      config: { vatEnabled: true },
      menu: [{ id: "item-1" }],
      staff: [{ id: "staff-1" }],
      customers: [{ id: "customer-1" }],
    };

    await apiSaveTenant("venue+test@example.com", patch, "tenant-token-123");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/functions/v1/server/tenant/venue%2Btest%40example.com",
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({
          Authorization: "Bearer tenant-token-123",
        }),
        body: JSON.stringify(patch),
      }),
    );
  });

  it("returns sales for the tenant using the authenticated token", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ([{ id: "sale-1" }]),
    });

    const sales = await apiGetSales("venue@example.com", "tenant-token-123");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/functions/v1/server/tenant/venue%40example.com/sales",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer tenant-token-123" }),
      }),
    );
    expect(sales).toEqual([{ id: "sale-1" }]);
  });

  it("fetches a tenant by email with token auth", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "tenant-1", businessInfo: { name: "Misty" } }),
    });

    const data = await apiGetTenant("venue@example.com", "token-xyz");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/functions/v1/server/tenant/venue%40example.com",
      expect.objectContaining({ method: "GET" }),
    );
    expect(data.businessInfo.name).toBe("Misty");
  });

  it("posts a new sale record", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });

    const sale = { id: "sale-1", total: 115, paymentMethod: "Cash" };
    await apiAddSale("venue@example.com", sale, "token-abc");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/functions/v1/server/tenant/venue%40example.com/sale",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(sale),
      }),
    );
  });

  it("updates tenant credentials", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });

    await apiUpdateTenantCredentials("venue@example.com", { staffId: "staff-1", pin: "4321" }, "token-abc");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/functions/v1/server/tenant/venue%40example.com/credentials",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ staffId: "staff-1", pin: "4321" }),
      }),
    );
  });
});

describe("api helpers – superadmin", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("logs in as superadmin", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ token: "admin-token" }),
    });

    const res = await apiAdminLogin("admin@test.com", "admin-pass");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/functions/v1/server/admin/login",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "admin@test.com", password: "admin-pass" }),
      }),
    );
    expect(res.token).toBe("admin-token");
  });

  it("lists tenants with superadmin header", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ([{ email: "venue@test.com" }]),
    });

    await apiAdminListTenants("super-token");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/functions/v1/server/admin/tenants",
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Superadmin-Token": "super-token" }),
      }),
    );
  });

  it("creates a tenant with superadmin header", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });

    await apiAdminCreateTenant("super-token", {
      email: "new@venue.com",
      password: "pass",
      businessName: "New Venue",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/functions/v1/server/admin/tenants",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "X-Superadmin-Token": "super-token" }),
        body: JSON.stringify({ email: "new@venue.com", password: "pass", businessName: "New Venue" }),
      }),
    );
  });

  it("updates a tenant with superadmin header", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });

    await apiAdminUpdateTenant("super-token", "venue@test.com", { paused: true });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/functions/v1/server/admin/tenants/venue%40test.com",
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({ "X-Superadmin-Token": "super-token" }),
        body: JSON.stringify({ paused: true }),
      }),
    );
  });

  it("deletes a tenant with superadmin header", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });

    await apiAdminDeleteTenant("super-token", "venue@test.com");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/functions/v1/server/admin/tenants/venue%40test.com",
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({ "X-Superadmin-Token": "super-token" }),
      }),
    );
  });

  it("executes arbitrary SQL with superadmin header", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ rows: [] }),
    });

    const res = await apiExecuteSql("super-token", "SELECT * FROM tenants");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/functions/v1/server/sql",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "X-Superadmin-Token": "super-token" }),
        body: JSON.stringify({ sql: "SELECT * FROM tenants" }),
      }),
    );
    expect(res.rows).toEqual([]);
  });

  it("throws on non-ok responses", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Not authorized" }),
    });

    await expect(apiLogin("x", "y")).rejects.toThrow("Not authorized");
  });
});

describe("makeTenantSavePatch", () => {
  it("keeps only the tenant fields that are persisted", () => {
    const tenant = {
      id: "tenant-1",
      email: "venue@example.com",
      password: "secret",
      plan: "starter",
      tenantToken: "tenant-token-123",
      businessInfo: { name: "Misty Venue", logo: null, address: "", phone: "", email: "", website: "", regNumber: "", vatNumber: "" },
      config: { defaultCurrencyCode: "ZAR", allowZeroSales: false, vatEnabled: true, vatRate: 15, currencies: [], paymentMethods: [], categories: [], printers: [], scanners: [], stockMovements: [] },
      menu: [{ id: "item-1" }],
      sales: [{ id: "sale-1" }],
      customers: [{ id: "customer-1" }],
      staff: [{ id: "staff-1" }],
      createdAt: new Date("2026-07-05T00:00:00.000Z"),
    } as never;

    expect(makeTenantSavePatch(tenant)).toEqual({
      businessInfo: tenant.businessInfo,
      config: tenant.config,
      menu: tenant.menu,
      staff: tenant.staff,
      customers: tenant.customers,
    });
  });
});