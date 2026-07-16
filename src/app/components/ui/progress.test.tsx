import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Progress } from "./progress";

describe("Progress", () => {
  it("forwards value and max to the underlying progress root", () => {
    render(<Progress value={25} max={100} data-testid="progress" />);

    const progress = screen.getByTestId("progress");

    expect(progress).toHaveAttribute("aria-valuenow", "25");
    expect(progress).toHaveAttribute("aria-valuemax", "100");
  });
});
