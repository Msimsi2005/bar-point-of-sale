vi.mock("./supabase", () => ({
  API_BASE: "https://api.example.test/functions/v1/server",
  SUPABASE_ANON_KEY: "anon-test-key",
}));

import { apiGetSales, apiLogin, apiSaveTenant } from "./api";
import { makeTenantSavePatch } from "../app/App";

const fetchMock = vi.fn();

describe("api helpers", () => {
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
