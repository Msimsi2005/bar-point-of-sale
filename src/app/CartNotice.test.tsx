import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { POSView } from "./App";

const receiptTemplate = {
  headerLine1: "",
  headerLine2: "",
  footerLine: "",
  showLogo: false,
  showAddress: false,
  showPhone: false,
  showVatNumber: false,
  showTabName: true,
  showPaymentMethod: true,
};

function till(stock = { black: 10, castle: 5, empty: 0 }, withTab = true) {
  return {
    id: "tenant-1",
    email: "venue@example.com",
    password: "",
    plan: "starter",
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
      allowCredits: false,
      vatEnabled: true,
      vatRate: 15,
      currencies: [{ code: "ZAR", symbol: "R", name: "South African Rand", rate: 1, enabled: true }],
      paymentMethods: [{ id: "cash", name: "Cash", icon: "cash", enabled: true }],
      categories: [{ name: "Beer", enabled: true, color: "" }],
      printers: [],
      scanners: [],
      receiptTemplate,
      stockMovements: [],
      posState: withTab
        ? { tabs: [{ id: "tab-1", name: "Walk-in", orders: [], opened: "2026-11-22T10:00:00.000Z" }], activeTabId: "tab-1" }
        : { tabs: [], activeTabId: null },
    },
    menu: [
      { id: "black", name: "Black Label", category: "Beer", price: 30, description: "Bottle", stock: stock.black },
      { id: "castle", name: "Castle Lager", category: "Beer", price: 28, description: "Bottle", stock: stock.castle },
      { id: "empty", name: "Empty Glass", category: "Beer", price: 5, description: "None", stock: stock.empty },
    ],
    sales: [],
    customers: [],
    staff: [{
      id: "staff-1",
      name: "Sam",
      role: "bartender",
      pin: "1234",
      permissions: {
        adminAccess: false,
        editProducts: false,
        editCategories: false,
        editPayments: false,
        editCurrencies: false,
        editVat: false,
        editBusiness: false,
        manageStaff: false,
        manageCustomers: false,
        viewSales: true,
        manageSystem: false,
        openTabs: true,
        editOrders: true,
        chargeTabs: true,
        useClientDisplay: true,
      },
    }],
    createdAt: new Date("2026-11-22T08:00:00.000Z"),
  };
}

function renderTill(stock?: { black: number; castle: number; empty: number }, withTab = true) {
  return render(
    <POSView
      tenant={till(stock, withTab) as never}
      staffId="staff-1"
      onTenantChange={() => {}}
      onSalePersisted={async () => {}}
      onAdmin={() => {}}
      onClient={() => {}}
      onLogout={() => {}}
    />,
  );
}

function addedNotes() {
  return screen.queryAllByText(/has been added to the cart\.|have been added to the cart\./);
}

describe("cart notifications", () => {
  it("confirms one product, a repeat add, a scan, and a second product", async () => {
    const user = userEvent.setup();
    renderTill();

    await user.click(screen.getByRole("button", { name: "Add Black Label" }));
    expect(screen.getByText("1 Black Label has been added to the cart.")).toBeInTheDocument();
    expect(screen.getByLabelText("Quantity 1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add Black Label" }));
    expect(screen.getAllByText("1 Black Label has been added to the cart.")).toHaveLength(2);
    expect(screen.queryByText(/2 Black Label have been added/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Quantity 2")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Scan product"), "Castle Lager{Enter}");
    expect(screen.getByText("1 Castle Lager has been added to the cart.")).toBeInTheDocument();
    expect(screen.getByLabelText("Quantity 1")).toBeInTheDocument();
  });

  it("keeps one notice per rapid add and does not report the full line quantity", async () => {
    const user = userEvent.setup();
    renderTill();
    const product = screen.getByRole("button", { name: "Add Black Label" });
    for (let i = 0; i < 4; i += 1) await user.click(product);
    expect(screen.getByLabelText("Quantity 4")).toBeInTheDocument();
    expect(screen.queryByText(/4 Black Label have been added/)).not.toBeInTheDocument();
    expect(addedNotes().every((node) => node.textContent?.startsWith("1 Black Label"))).toBe(true);
  });

  it("does not confirm a failed scan, an out-of-stock add, or a removal", async () => {
    const user = userEvent.setup();
    renderTill({ black: 1, castle: 5, empty: 0 });

    await user.type(screen.getByLabelText("Scan product"), "Not A Drink{Enter}");
    expect(screen.getByText("No product matches that scan.")).toBeInTheDocument();
    expect(addedNotes()).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Add Black Label" }));
    expect(screen.getByText("1 Black Label has been added to the cart.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Black Label" })).toBeDisabled();

    await user.type(screen.getByLabelText("Scan product"), "Black Label{Enter}");
    expect(screen.getByText("Black Label could not be added. Not enough stock.")).toBeInTheDocument();
    expect(screen.getAllByText("1 Black Label has been added to the cart.")).toHaveLength(1);
    expect(screen.getByLabelText("Quantity 1")).toBeInTheDocument();

    const beforeRemove = addedNotes().length;
    await user.click(screen.getByRole("button", { name: "Remove one Black Label" }));
    expect(screen.queryByLabelText("Quantity 1")).not.toBeInTheDocument();
    expect(addedNotes().length).toBeLessThanOrEqual(beforeRemove);

    await user.click(screen.getByRole("button", { name: "Add Castle Lager" }));
    await user.click(screen.getByRole("button", { name: "Add one Castle Lager" }));
    expect(screen.getByLabelText("Quantity 2")).toBeInTheDocument();
    expect(screen.getAllByText("1 Castle Lager has been added to the cart.")).toHaveLength(2);
    expect(screen.queryByText(/2 Castle Lager have been added/)).not.toBeInTheDocument();
  });

  it("does not confirm an add when no tab is open, and opening payment adds nothing", async () => {
    const user = userEvent.setup();
    const closed = renderTill(undefined, false);
    await user.type(screen.getByLabelText("Scan product"), "Castle Lager{Enter}");
    expect(screen.getByText("Open a tab before adding a product.")).toBeInTheDocument();
    expect(addedNotes()).toHaveLength(0);
    closed.unmount();

    renderTill();
    await user.click(screen.getByRole("button", { name: "Add Black Label" }));
    const beforePay = addedNotes().length;
    await user.click(screen.getByRole("button", { name: "CHARGE TAB" }));
    expect(screen.getByRole("button", { name: "COMPLETE CASH PAYMENT" })).toBeInTheDocument();
    expect(addedNotes().length).toBe(beforePay);
  });
});
