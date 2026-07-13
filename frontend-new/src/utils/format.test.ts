import { describe, expect, it } from "vitest";
import { formatCredits } from "./format";

describe("formatCredits", () => {
  it("renders credit counters with exactly six decimal places", () => {
    expect(formatCredits(0)).toBe("0.000000");
    expect(formatCredits(0.0543219)).toBe("0.054322");
    expect(formatCredits(42.91)).toBe("42.910000");
    expect(formatCredits(1234567.5)).toBe("1,234,567.500000");
  });
});
