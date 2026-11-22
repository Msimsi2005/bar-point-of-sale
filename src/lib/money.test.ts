import { describe, expect, it } from "vitest";
import { businessDateKey, customerCreditDelta, fromBase, splitVat, toBase } from "./money";

const rates = [
  { code: "ZAR", rate: 1 },
  { code: "USD", rate: 0.054 },
  { code: "ZIG", rate: 0.4 },
];

describe("money", () => {
  it("keeps a ZAR exclusive sale at 15 percent VAT", () => {
    const parts = splitVat(100, { vatEnabled: true, vatRate: 15 });
    expect(parts).toEqual({ subtotal: 100, tax: 15, total: 115 });
    expect(fromBase(parts.total, "ZIG", rates)).toBeCloseTo(46, 5);
  });

  it("extracts VAT when prices already include it", () => {
    const parts = splitVat(115, { vatEnabled: true, vatRate: 15, vatPricesIncludeVat: true });
    expect(parts.total).toBe(115);
    expect(parts.tax).toBe(15);
    expect(parts.subtotal).toBe(100);
  });

  it("converts a USD menu price into ZAR and back", () => {
    const base = toBase(10, "USD", rates);
    expect(fromBase(base, "USD", rates)).toBeCloseTo(10, 5);
    expect(base).toBeGreaterThan(10);
  });

  it("does not debit credit for a paid purchase", () => {
    expect(customerCreditDelta("purchase", 115, 0)).toBe(0);
    expect(customerCreditDelta(undefined, 115, 0)).toBe(0);
    expect(customerCreditDelta("on-account", 115, 0)).toBe(-115);
    expect(customerCreditDelta("settlement", 0, 40)).toBe(40);
    expect(customerCreditDelta("deposit", 0, 25)).toBe(25);
  });

  it("groups late Johannesburg sales on the local date", () => {
    expect(businessDateKey(new Date("2026-03-31T22:30:00.000Z"))).toBe("2026-04-01");
  });
});
