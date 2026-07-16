import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewTabModal } from "./App";

const tenant = {
  id: "tenant-1",
  email: "venue@example.com",
  password: "",
  plan: "starter",
  tenantToken: "token",
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
  customers: [
    { id: "customer-1", name: "Alex", email: "alex@example.com", phone: "", totalSpent: 0, visits: 0, notes: "", creditBalance: -25 },
    { id: "customer-2", name: "Nandi", email: "nandi@example.com", phone: "", totalSpent: 0, visits: 0, notes: "", creditBalance: 10 },
  ],
  staff: [],
  createdAt: new Date("2026-07-05T00:00:00.000Z"),
} as const;

describe("NewTabModal", () => {
  it("supports table, guest, and walk-in tab flows", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();

    render(<NewTabModal tenant={tenant as never} onClose={() => {}} onCreate={onCreate} />);

    const openButton = screen.getByRole("button", { name: "Open Tab" });
    expect(openButton).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Walk-In" }));
    expect(screen.getByLabelText("Walk-In Name")).toBeInTheDocument();
    expect(openButton).toBeEnabled();

    await user.click(openButton);
    expect(onCreate).toHaveBeenCalledWith("Walk-in", undefined, undefined);

    onCreate.mockClear();
    await user.click(screen.getByRole("button", { name: "Guest" }));
    const guestInput = screen.getByLabelText("Guest Name *");
    expect(openButton).toBeDisabled();

    await user.type(guestInput, "Nandi");
    expect(openButton).toBeEnabled();

    await user.click(openButton);
    expect(onCreate).toHaveBeenCalledWith("Nandi", undefined, undefined);

    onCreate.mockClear();
    await user.click(screen.getByRole("button", { name: "Table" }));
    const tableInput = screen.getByLabelText("Table *");
    await user.clear(tableInput);
    expect(openButton).toBeDisabled();

    await user.type(tableInput, "12");
    await user.click(openButton);
    expect(onCreate).toHaveBeenCalledWith("12", undefined, undefined);
  });

  it("filters creditors via search and links selected customer to the new tab", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();

    render(<NewTabModal tenant={tenant as never} onClose={() => {}} onCreate={onCreate} />);

    await user.type(screen.getByPlaceholderText("Search customer by name, email, or phone"), "nandi");
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.selectOptions(screen.getByLabelText("Link Creditor (optional)"), "customer-2");

    const tableInput = screen.getByLabelText("Table *");
    await user.type(tableInput, "C-17");
    await user.click(screen.getByRole("button", { name: "Open Tab" }));

    expect(onCreate).toHaveBeenCalledWith("C-17", undefined, "customer-2");
  });
});
