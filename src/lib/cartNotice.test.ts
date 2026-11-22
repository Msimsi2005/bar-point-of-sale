import { describe, expect, it } from "vitest";
import { cartAddedMessage } from "./cartNotice";

describe("cart added notice", () => {
  it("names one product", () => {
    expect(cartAddedMessage("Black Label", 1)).toBe("1 Black Label has been added to the cart.");
  });

  it("uses plural grammar for more than one", () => {
    expect(cartAddedMessage("Castle Lager", 3)).toBe("3 Castle Lager have been added to the cart.");
  });

  it("falls back when the product has no name", () => {
    expect(cartAddedMessage("  ", 1)).toBe("1 Product has been added to the cart.");
  });
});
