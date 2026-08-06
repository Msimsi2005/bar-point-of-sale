import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("merges class names, removing duplicates", () => {
    expect(cn("px-4", "py-2")).toBe("px-4 py-2");
  });

  it("handles conditional classes", () => {
    expect(cn("base", false && "hidden", "visible")).toBe("base visible");
  });

  it("resolves tailwind conflicts (last wins)", () => {
    expect(cn("px-4", "px-6")).toBe("px-6");
  });

  it("accepts arrays of classes", () => {
    expect(cn(["a", "b"], "c")).toBe("a b c");
  });

  it("filters out falsy values", () => {
    expect(cn("a", undefined, null, "", "b")).toBe("a b");
  });
});