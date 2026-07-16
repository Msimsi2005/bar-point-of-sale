import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PaymentModal, SalesSection } from "./App";

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
    paymentMethods: [
      { id: "cash", name: "Cash", icon: "cash", enabled: true },
      { id: "card", name: "Card", icon: "card", enabled: true },
    ],
    categories: [],
    printers: [],
    scanners: [],
    stockMovements: [],
  },
  menu: [],
  sales: [],
  customers: [],
  staff: [],
  createdAt: new Date("2026-07-05T00:00:00.000Z"),
} as const;

const tab = {
  id: "tab-1",
  name: "Walk-in",
  opened: new Date("2026-07-05T12:00:00.000Z"),
  orders: [
    {
      menuItem: {
        id: "item-1",
        name: "Black Label",
        category: "Beer",
        price: 100,
        description: "Beer",
        stock: 10,
      },
      qty: 1,
    },
  ],
} as const;

const customerTab = {
  ...tab,
  id: "tab-credit-1",
  customerId: "customer-1",
} as const;

const tenantWithCustomer = {
  ...tenant,
  customers: [{ id: "customer-1", name: "Alex", email: "", phone: "", totalSpent: 0, visits: 0, notes: "", creditBalance: -50 }],
} as const;

describe("PaymentModal", () => {
  it("requires enough cash before completing and sends the computed sale", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    const randomUuid = vi.spyOn(crypto, "randomUUID").mockReturnValue("sale-uuid-1");

    render(<PaymentModal tab={tab as never} tenant={tenant as never} staffId="staff-1" onClose={() => {}} onComplete={onComplete} />);

    const completeButton = screen.getByRole("button", { name: "COMPLETE CASH PAYMENT" });
    expect(completeButton).toBeDisabled();

    await user.type(screen.getByPlaceholderText("R0.00"), "115");
    expect(completeButton).toBeEnabled();

    await user.click(completeButton);

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({
      id: "sale-uuid-1",
      tabName: "Walk-in",
      total: 115,
      tax: 15,
      subtotal: 100,
      paymentMethod: "Cash",
      staffId: "staff-1",
      currencyCode: "ZAR",
      currencySymbol: "R",
    }));

    randomUuid.mockRestore();
  });

  it("allows card checkout without a cash amount", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    const randomUuid = vi.spyOn(crypto, "randomUUID").mockReturnValue("sale-uuid-2");

    render(<PaymentModal tab={tab as never} tenant={tenant as never} staffId="staff-1" onClose={() => {}} onComplete={onComplete} />);

    await user.click(screen.getByRole("button", { name: "Card" }));
    const chargeButton = screen.getByRole("button", { name: "CHARGE R115.00" });
    expect(chargeButton).toBeEnabled();

    await user.click(chargeButton);

    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({
      id: "sale-uuid-2",
      paymentMethod: "Card",
      change: undefined,
    })));

    randomUuid.mockRestore();
  });

  it("applies default currency conversion rate for checkout totals", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    const randomUuid = vi.spyOn(crypto, "randomUUID").mockReturnValue("sale-uuid-3");
    const zigTenant = {
      ...tenant,
      config: {
        ...tenant.config,
        defaultCurrencyCode: "ZIG",
        currencies: [
          tenant.config.currencies[0],
          { code: "ZIG", symbol: "ZiG", name: "Zimbabwe Gold", rate: 0.4, enabled: true },
        ],
      },
    };

    render(<PaymentModal tab={tab as never} tenant={zigTenant as never} staffId="staff-1" onClose={() => {}} onComplete={onComplete} />);

    await user.click(screen.getByRole("button", { name: "Card" }));
    const chargeButton = screen.getByRole("button", { name: /CHARGE ZiG46\.00/i });
    expect(chargeButton).toBeEnabled();

    await user.click(chargeButton);

    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({
      id: "sale-uuid-3",
      currencyCode: "ZIG",
      currencySymbol: "ZiG",
      totalConverted: 46,
    })));

    randomUuid.mockRestore();
  });

  it("creates on-account purchases that increase debt", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    const randomUuid = vi.spyOn(crypto, "randomUUID").mockReturnValue("sale-uuid-4");

    render(<PaymentModal tab={customerTab as never} tenant={tenantWithCustomer as never} staffId="staff-1" onClose={() => {}} onComplete={onComplete} />);

    await user.click(screen.getByRole("button", { name: "On Account" }));
    await user.click(screen.getByRole("button", { name: /POST R115\.00 TO ACCOUNT/i }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({
      id: "sale-uuid-4",
      accountAction: "on-account",
      customerId: "customer-1",
      totalConverted: 115,
      paymentMethod: "On Account",
    })));

    randomUuid.mockRestore();
  });

  it("allows linking a creditor in checkout before posting on account", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    const randomUuid = vi.spyOn(crypto, "randomUUID").mockReturnValue("sale-uuid-4b");

    render(<PaymentModal tab={tab as never} tenant={tenantWithCustomer as never} staffId="staff-1" onClose={() => {}} onComplete={onComplete} />);

    const onAccountButton = screen.getByRole("button", { name: "On Account" });
    expect(onAccountButton).toBeDisabled();

    await user.selectOptions(screen.getByLabelText("Link Creditor For This Checkout"), "customer-1");
    expect(onAccountButton).toBeEnabled();

    await user.click(onAccountButton);
    await user.click(screen.getByRole("button", { name: /POST R115\.00 TO ACCOUNT/i }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({
      id: "sale-uuid-4b",
      accountAction: "on-account",
      customerId: "customer-1",
      totalConverted: 115,
    })));

    randomUuid.mockRestore();
  });

  it("creates settlement transactions that reduce debt", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    const randomUuid = vi.spyOn(crypto, "randomUUID").mockReturnValue("sale-uuid-5");

    render(<PaymentModal tab={customerTab as never} tenant={tenantWithCustomer as never} staffId="staff-1" onClose={() => {}} onComplete={onComplete} />);

    await user.click(screen.getByRole("button", { name: "Settlement" }));
    await user.type(screen.getByLabelText(/Settlement Amount/i), "40");
    await user.click(screen.getByRole("button", { name: "Card" }));
    await user.click(screen.getByRole("button", { name: /SETTLE R40\.00/i }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({
      id: "sale-uuid-5",
      accountAction: "settlement",
      customerId: "customer-1",
      totalConverted: 40,
      accountAmount: 40,
      subtotal: 0,
      tax: 0,
      total: 0,
    })));

    randomUuid.mockRestore();
  });

  it("creates deposit top-ups that increase positive credit", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    const randomUuid = vi.spyOn(crypto, "randomUUID").mockReturnValue("sale-uuid-6");

    render(<PaymentModal tab={customerTab as never} tenant={tenantWithCustomer as never} staffId="staff-1" onClose={() => {}} onComplete={onComplete} />);

    await user.click(screen.getByRole("button", { name: "Deposit Top-up" }));
    await user.type(screen.getByLabelText(/Deposit Amount/i), "25");
    await user.click(screen.getByRole("button", { name: "Card" }));
    await user.click(screen.getByRole("button", { name: /TOP-UP R25\.00/i }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({
      id: "sale-uuid-6",
      accountAction: "deposit",
      customerId: "customer-1",
      totalConverted: 25,
      accountAmount: 25,
      subtotal: 0,
      tax: 0,
      total: 0,
    })));

    randomUuid.mockRestore();
  });
});

describe("SalesSection", () => {
  it("renders totals and transactions from the sales list", async () => {
    const sales = [
      {
        id: "sale-1",
        tabName: "Walk-in",
        items: [{ menuItem: tab.orders[0].menuItem, qty: 1 }],
        subtotal: 100,
        tax: 15,
        total: 115,
        totalConverted: 115,
        paymentMethod: "Cash",
        currencyCode: "ZAR",
        currencySymbol: "R",
        timestamp: new Date(),
        staffId: "staff-1",
      },
      {
        id: "sale-2",
        tabName: "Table 2",
        items: [{ menuItem: { ...tab.orders[0].menuItem, id: "item-2", name: "Savanna" }, qty: 2 }],
        subtotal: 80,
        tax: 12,
        total: 92,
        totalConverted: 92,
        paymentMethod: "Card",
        currencyCode: "ZAR",
        currencySymbol: "R",
        timestamp: new Date(Date.now() - 86400000),
        staffId: "staff-2",
      },
    ] as never;

    render(<SalesSection sales={sales} currency={tenant.config.currencies[0] as never} />);

    expect(screen.getByText("2 transactions", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("R207.00")).toBeInTheDocument();
    expect(screen.getByText("black label", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Walk-in Cash/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Table 2 Card/i })).toBeInTheDocument();
  });

  it("filters by month and opens print report", async () => {
    const user = userEvent.setup();
    const sales = [
      {
        id: "sale-jul",
        tabName: "Walk-in",
        items: [{ menuItem: tab.orders[0].menuItem, qty: 1 }],
        subtotal: 100,
        tax: 15,
        total: 115,
        totalConverted: 115,
        paymentMethod: "Cash",
        currencyCode: "ZAR",
        currencySymbol: "R",
        timestamp: new Date("2026-07-05T12:00:00.000Z"),
        staffId: "staff-1",
      },
      {
        id: "sale-jun",
        tabName: "Table 2",
        items: [{ menuItem: { ...tab.orders[0].menuItem, id: "item-2", name: "Savanna" }, qty: 2 }],
        subtotal: 80,
        tax: 12,
        total: 92,
        totalConverted: 92,
        paymentMethod: "Card",
        currencyCode: "ZAR",
        currencySymbol: "R",
        timestamp: new Date("2026-06-30T12:00:00.000Z"),
        staffId: "staff-2",
      },
    ] as never;

    const openSpy = vi.spyOn(window, "open").mockImplementation(() => ({
      document: {
        write: vi.fn(),
        close: vi.fn(),
      },
    }) as unknown as Window);

    render(<SalesSection sales={sales} currency={tenant.config.currencies[0] as never} />);

    await user.selectOptions(screen.getByLabelText("Report granularity"), "monthly");
    await user.selectOptions(screen.getByLabelText("Report period"), "2026-07");

    expect(screen.getByText("1 transactions", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Walk-in Cash/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Table 2 Card/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Print Report" }));
    expect(openSpy).toHaveBeenCalled();

    openSpy.mockRestore();
  });

  it("filters daily/monthly sales by specific cashier", async () => {
    const user = userEvent.setup();
    const sales = [
      {
        id: "sale-1",
        tabName: "Table 1",
        items: [{ menuItem: tab.orders[0].menuItem, qty: 1 }],
        subtotal: 100,
        tax: 15,
        total: 115,
        totalConverted: 115,
        paymentMethod: "Cash",
        currencyCode: "ZAR",
        currencySymbol: "R",
        timestamp: new Date("2026-07-05T12:00:00.000Z"),
        staffId: "staff-1",
      },
      {
        id: "sale-2",
        tabName: "Table 2",
        items: [{ menuItem: { ...tab.orders[0].menuItem, id: "item-2", name: "Savanna" }, qty: 1 }],
        subtotal: 60,
        tax: 9,
        total: 69,
        totalConverted: 69,
        paymentMethod: "Card",
        currencyCode: "ZAR",
        currencySymbol: "R",
        timestamp: new Date("2026-07-05T13:00:00.000Z"),
        staffId: "staff-2",
      },
    ] as never;

    const staff = [
      { id: "staff-1", name: "Alex", pin: "1111", role: "bartender", permissions: {} },
      { id: "staff-2", name: "Nandi", pin: "2222", role: "bartender", permissions: {} },
    ] as never;

    render(<SalesSection sales={sales} currency={tenant.config.currencies[0] as never} staff={staff} />);

    await user.selectOptions(screen.getByLabelText("Cashier filter"), "staff-1");

    expect(screen.getByText("1 transactions", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Table 1 Cash/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Table 2 Card/i })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Report granularity"), "monthly");
    await user.selectOptions(screen.getByLabelText("Report period"), "2026-07");

    expect(screen.getByText("1 transactions", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Table 1 Cash/i })).toBeInTheDocument();
  });

  it("applies custom date range and compares previous window for selected cashier", async () => {
    const user = userEvent.setup();
    const sales = [
      {
        id: "sale-current-1",
        tabName: "Table 1",
        items: [{ menuItem: tab.orders[0].menuItem, qty: 1 }],
        subtotal: 100,
        tax: 15,
        total: 115,
        totalConverted: 115,
        paymentMethod: "Cash",
        currencyCode: "ZAR",
        currencySymbol: "R",
        timestamp: new Date("2026-07-05T12:00:00.000Z"),
        staffId: "staff-1",
      },
      {
        id: "sale-current-2",
        tabName: "Table 3",
        items: [{ menuItem: { ...tab.orders[0].menuItem, id: "item-3", name: "Savanna" }, qty: 1 }],
        subtotal: 80,
        tax: 12,
        total: 92,
        totalConverted: 92,
        paymentMethod: "Card",
        currencyCode: "ZAR",
        currencySymbol: "R",
        timestamp: new Date("2026-07-06T12:00:00.000Z"),
        staffId: "staff-1",
      },
      {
        id: "sale-previous",
        tabName: "Table 2",
        items: [{ menuItem: { ...tab.orders[0].menuItem, id: "item-2", name: "Castle" }, qty: 1 }],
        subtotal: 50,
        tax: 7.5,
        total: 57.5,
        totalConverted: 57.5,
        paymentMethod: "Cash",
        currencyCode: "ZAR",
        currencySymbol: "R",
        timestamp: new Date("2026-07-03T12:00:00.000Z"),
        staffId: "staff-1",
      },
      {
        id: "sale-other-cashier",
        tabName: "Table 9",
        items: [{ menuItem: { ...tab.orders[0].menuItem, id: "item-9", name: "Hunters" }, qty: 1 }],
        subtotal: 40,
        tax: 6,
        total: 46,
        totalConverted: 46,
        paymentMethod: "Cash",
        currencyCode: "ZAR",
        currencySymbol: "R",
        timestamp: new Date("2026-07-05T13:00:00.000Z"),
        staffId: "staff-2",
      },
    ] as never;

    const staff = [
      { id: "staff-1", name: "Alex", pin: "1111", role: "bartender", permissions: {} },
      { id: "staff-2", name: "Nandi", pin: "2222", role: "bartender", permissions: {} },
    ] as never;

    render(<SalesSection sales={sales} currency={tenant.config.currencies[0] as never} staff={staff} />);

    await user.selectOptions(screen.getByLabelText("Cashier filter"), "staff-1");
    await user.type(screen.getByLabelText("Range from"), "2026-07-05");
    await user.type(screen.getByLabelText("Range to"), "2026-07-06");

    expect(screen.getByText("2 transactions", { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/Window Comparison \(Alex\)/i)).toBeInTheDocument();
    expect(screen.getAllByText("R207.00").length).toBeGreaterThan(0);
    expect(screen.getByText("R57.50")).toBeInTheDocument();
    expect(screen.getByText(/\+260\.0%/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Table 9 Cash/i })).not.toBeInTheDocument();
  });

  it("filters transactions by table name search", async () => {
    const user = userEvent.setup();
    const sales = [
      {
        id: "sale-1",
        tabName: "Table 12",
        items: [{ menuItem: tab.orders[0].menuItem, qty: 1 }],
        subtotal: 100,
        tax: 15,
        total: 115,
        totalConverted: 115,
        paymentMethod: "Cash",
        currencyCode: "ZAR",
        currencySymbol: "R",
        timestamp: new Date("2026-07-10T12:00:00.000Z"),
        staffId: "staff-1",
      },
      {
        id: "sale-2",
        tabName: "Walk-in",
        items: [{ menuItem: { ...tab.orders[0].menuItem, id: "item-2", name: "Savanna" }, qty: 1 }],
        subtotal: 50,
        tax: 7.5,
        total: 57.5,
        totalConverted: 57.5,
        paymentMethod: "Card",
        currencyCode: "ZAR",
        currencySymbol: "R",
        timestamp: new Date("2026-07-10T13:00:00.000Z"),
        staffId: "staff-2",
      },
    ] as never;

    render(<SalesSection sales={sales} currency={tenant.config.currencies[0] as never} />);

    await user.type(screen.getByLabelText("Search table name"), "table 12");

    expect(screen.getByText("1 transactions", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Table 12 Cash/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Walk-in Card/i })).not.toBeInTheDocument();
  });

  it("filters to negative sales only for quick manager review", async () => {
    const user = userEvent.setup();
    const sales = [
      {
        id: "sale-neg",
        tabName: "Table 4",
        items: [{ menuItem: { ...tab.orders[0].menuItem, id: "item-neg", name: "Stockout Lager", stock: -2 }, qty: 1 }],
        subtotal: 100,
        tax: 15,
        total: 115,
        totalConverted: 115,
        paymentMethod: "Cash",
        currencyCode: "ZAR",
        currencySymbol: "R",
        timestamp: new Date("2026-07-10T12:00:00.000Z"),
        staffId: "staff-1",
      },
      {
        id: "sale-ok",
        tabName: "Table 5",
        items: [{ menuItem: { ...tab.orders[0].menuItem, id: "item-ok", name: "Regular Ale", stock: 5 }, qty: 1 }],
        subtotal: 60,
        tax: 9,
        total: 69,
        totalConverted: 69,
        paymentMethod: "Card",
        currencyCode: "ZAR",
        currencySymbol: "R",
        timestamp: new Date("2026-07-10T13:00:00.000Z"),
        staffId: "staff-2",
      },
    ] as never;

    const menu = [
      { ...tab.orders[0].menuItem, id: "item-neg", name: "Stockout Lager", stock: -2 },
      { ...tab.orders[0].menuItem, id: "item-ok", name: "Regular Ale", stock: 5 },
    ] as never;

    render(<SalesSection sales={sales} currency={tenant.config.currencies[0] as never} menu={menu} />);

    expect(screen.getByText("Negative: 1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Switch to Negative Sales Only" }));

    expect(screen.getByText("1 transactions", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Table 4 Cash/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Table 5 Card/i })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Sales scope filter"), "negative-only");

    expect(screen.getByText("1 transactions", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Table 4 Cash/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Table 5 Card/i })).not.toBeInTheDocument();
  });

  it("shows gross profit metrics for quick month/year/day filters", async () => {
    const user = userEvent.setup();
    const nowYear = new Date().getFullYear();
    const sales = [
      {
        id: "sale-current-year",
        tabName: "Table 7",
        items: [{ menuItem: { ...tab.orders[0].menuItem, cost: 30 }, qty: 1 }],
        subtotal: 100,
        tax: 15,
        total: 115,
        totalConverted: 115,
        paymentMethod: "Cash",
        currencyCode: "ZAR",
        currencySymbol: "R",
        timestamp: new Date(`${nowYear}-07-05T12:00:00.000Z`),
        staffId: "staff-1",
      },
      {
        id: "sale-last-year",
        tabName: "Table 8",
        items: [{ menuItem: { ...tab.orders[0].menuItem, id: "old-item", cost: 80 }, qty: 1 }],
        subtotal: 200,
        tax: 30,
        total: 230,
        totalConverted: 230,
        paymentMethod: "Card",
        currencyCode: "ZAR",
        currencySymbol: "R",
        timestamp: new Date(`${nowYear - 1}-12-15T12:00:00.000Z`),
        staffId: "staff-1",
      },
    ] as never;

    render(<SalesSection sales={sales} currency={tenant.config.currencies[0] as never} />);

    expect(screen.getByLabelText("Gross Profit trend chart")).toBeInTheDocument();
    expect(screen.getByText(/Days plotted: 2/i)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Quick profit filter"), "this-year");

    expect(screen.getByText("1 transactions", { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/Days plotted: 1/i)).toBeInTheDocument();
    expect(screen.getAllByText("Gross Profit").length).toBeGreaterThan(0);
    expect(screen.getAllByText("R70.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Net Sales").length).toBeGreaterThan(0);
    expect(screen.getByText("R100.00")).toBeInTheDocument();
    expect(screen.getAllByText("COGS").length).toBeGreaterThan(0);
    expect(screen.getByText("R30.00")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Trend metric Net Sales" }));
    expect(screen.getByLabelText("Net Sales trend chart")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Trend metric COGS" }));
    expect(screen.getByLabelText("COGS trend chart")).toBeInTheDocument();
  });

  it("supports quick preset toggles for last 7 days, this week, and previous week", async () => {
    const user = userEvent.setup();
    const now = new Date();
    const dayMs = 86400000;
    const mondayOffset = (now.getDay() + 6) % 7;
    const thisWeekStart = new Date(now.getTime() - (mondayOffset * dayMs));
    const thisWeekMid = new Date(thisWeekStart.getTime() + (2 * dayMs));
    const previousWeekMid = new Date(thisWeekStart.getTime() - (3 * dayMs));
    const outsideLast7 = new Date(now.getTime() - (20 * dayMs));

    const sales = [
      {
        id: "sale-this-week",
        tabName: "Table 1",
        items: [{ menuItem: { ...tab.orders[0].menuItem, id: "item-this", name: "This Week Lager" }, qty: 1 }],
        subtotal: 100,
        tax: 15,
        total: 115,
        totalConverted: 115,
        paymentMethod: "Cash",
        currencyCode: "ZAR",
        currencySymbol: "R",
        timestamp: thisWeekMid,
        staffId: "staff-1",
      },
      {
        id: "sale-previous-week",
        tabName: "Table 2",
        items: [{ menuItem: { ...tab.orders[0].menuItem, id: "item-prev", name: "Previous Week Cider" }, qty: 1 }],
        subtotal: 60,
        tax: 9,
        total: 69,
        totalConverted: 69,
        paymentMethod: "Card",
        currencyCode: "ZAR",
        currencySymbol: "R",
        timestamp: previousWeekMid,
        staffId: "staff-1",
      },
      {
        id: "sale-old",
        tabName: "Table 3",
        items: [{ menuItem: { ...tab.orders[0].menuItem, id: "item-old", name: "Old Week Ale" }, qty: 1 }],
        subtotal: 40,
        tax: 6,
        total: 46,
        totalConverted: 46,
        paymentMethod: "Cash",
        currencyCode: "ZAR",
        currencySymbol: "R",
        timestamp: outsideLast7,
        staffId: "staff-1",
      },
    ] as never;

    render(<SalesSection sales={sales} currency={tenant.config.currencies[0] as never} />);

    await user.click(screen.getByRole("button", { name: "Preset Last 7 Days" }));
    expect(screen.getByText("2 transactions", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Table 1 Cash/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Table 2 Card/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Preset This Week" }));
    expect(screen.getByText("1 transactions", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Table 1 Cash/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Preset Previous Week" }));
    expect(screen.getByText("1 transactions", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Table 2 Card/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Table 1 Cash/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear preset filter" }));
    expect(screen.getByText("3 transactions", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Table 1 Cash/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Table 2 Card/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Table 3 Cash/i })).toBeInTheDocument();
  });
});
