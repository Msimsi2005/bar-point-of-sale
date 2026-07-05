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

    render(<SalesSection sales={sales} />);

    expect(screen.getByText("2 transactions", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("R207.00")).toBeInTheDocument();
    expect(screen.getByText("black label", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Walk-in Cash/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Table 2 Card/i })).toBeInTheDocument();
  });
});
