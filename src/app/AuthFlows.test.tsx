import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StaffSelector, VenueLogin } from "./App";
import * as api from "../lib/api";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    apiLogin: vi.fn(),
    apiStartStaffSession: vi.fn(),
    apiUpdateTenantCredentials: vi.fn(),
  };
});

const tenant = {
  id: "tenant-1",
  email: "venue@example.com",
  password: "",
  plan: "starter",
  tenantToken: "token-1",
  businessInfo: {
    name: "Misty Venue",
    logo: null,
    address: "",
    phone: "",
    email: "venue@example.com",
    website: "",
    regNumber: "",
    vatNumber: "",
  },
  config: {
    defaultCurrencyCode: "ZAR",
    allowZeroSales: false,
    vatEnabled: true,
    vatRate: 15,
    currencies: [{ code: "ZAR", symbol: "R", name: "South African Rand", rate: 1, enabled: true }],
    paymentMethods: [],
    categories: [],
    printers: [],
    scanners: [],
    stockMovements: [],
  },
  menu: [],
  sales: [],
  customers: [],
  staff: [
    {
      id: "owner-1",
      name: "Owner",
      pin: "1234",
      role: "owner",
      permissions: {
        adminAccess: true,
        editProducts: true,
        editCategories: true,
        editPayments: true,
        editCurrencies: true,
        editVat: true,
        editBusiness: true,
        manageStaff: true,
        manageCustomers: true,
        viewSales: true,
        manageSystem: true,
        openTabs: true,
        editOrders: true,
        chargeTabs: true,
        useClientDisplay: true,
      },
    },
  ],
  createdAt: new Date("2026-07-05T00:00:00.000Z"),
} as const;

describe("VenueLogin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a validation error when credentials are missing", async () => {
    const user = userEvent.setup();
    render(<VenueLogin onLogin={vi.fn()} onBack={() => {}} />);

    await user.click(screen.getByRole("button", { name: "ACCESS MY POS" }));

    expect(await screen.findByText("Enter your email and password.")).toBeInTheDocument();
    expect(api.apiLogin).not.toHaveBeenCalled();
  });

  it("logs in and passes the mapped tenant plus token to the callback", async () => {
    const user = userEvent.setup();
    const onLogin = vi.fn();

    vi.mocked(api.apiLogin).mockResolvedValue({
      id: "tenant-1",
      email: "venue@example.com",
      tenantToken: "tenant-token-123",
      businessInfo: tenant.businessInfo,
      config: tenant.config,
      menu: [],
      sales: [],
      customers: [],
      staff: tenant.staff,
      createdAt: "2026-07-05T00:00:00.000Z",
    });

    render(<VenueLogin onLogin={onLogin} onBack={() => {}} />);

    await user.type(screen.getByPlaceholderText("owner@yourvenue.co.za"), " venue@example.com ");
    await user.type(screen.getByPlaceholderText("••••••••"), "secret123");
    await user.click(screen.getByRole("button", { name: "ACCESS MY POS" }));

    await waitFor(() => expect(api.apiLogin).toHaveBeenCalledWith("venue@example.com", "secret123"));
    await waitFor(() => expect(onLogin).toHaveBeenCalled());
    expect(onLogin.mock.calls[0]?.[1]).toBe("tenant-token-123");
    expect(onLogin.mock.calls[0]?.[0]).toMatchObject({
      email: "venue@example.com",
      businessInfo: { name: "Misty Venue" },
      tenantToken: "tenant-token-123",
    });
  });
});

describe("StaffSelector", () => {
  it("accepts the correct 4-digit PIN and selects the staff member", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(<StaffSelector tenant={tenant as never} onSelect={onSelect} onBack={() => {}} />);

    await user.click(screen.getByRole("button", { name: /Owner/i }));
    for (const digit of ["1", "2", "3", "4"]) {
      await user.click(screen.getByRole("button", { name: digit, exact: true }));
    }

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith("owner-1"));
  });

  it("keeps loaded sales when a new PIN replaces the default", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const loadedSale = { id: "sale-1", tabName: "Walk-in", total: 115 };
    const apiStaff = { ...tenant.staff[0], pin: undefined, pinMustChange: true };
    vi.mocked(api.apiStartStaffSession).mockResolvedValue({ staffToken: "staff-token", pinIsDefault: true, staff: apiStaff });
    vi.mocked(api.apiUpdateTenantCredentials).mockResolvedValue({
      ...tenant,
      sales: [],
      staff: [{ ...apiStaff, pinMustChange: false }],
      tenantToken: "tenant-token-new",
      createdAt: "2026-07-05T00:00:00.000Z",
    });

    render(<StaffSelector tenant={{ ...tenant, sales: [loadedSale], staff: [apiStaff] } as never} onSelect={onSelect} onBack={() => {}} />);
    await user.click(screen.getByRole("button", { name: /Owner/i }));
    for (const digit of ["1", "2", "3", "4"]) {
      await user.click(screen.getByRole("button", { name: digit, exact: true }));
    }
    expect(await screen.findByRole("button", { name: "Save new PIN" })).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText("New 4-digit PIN"), "4321");
    await user.click(screen.getByRole("button", { name: "Save new PIN" }));

    await waitFor(() => expect(onSelect).toHaveBeenCalled());
    expect(onSelect.mock.calls[0]?.[0]).toBe("owner-1");
    expect(onSelect.mock.calls[0]?.[1]).toBe("tenant-token-new");
    expect(onSelect.mock.calls[0]?.[2].sales).toEqual([loadedSale]);
  });
});
