import { describe, expect, it } from "vitest";
import { formatCredits, formatCurrency, formatDate, formatNumber } from "./format";

describe("formatCredits", () => {
  it("renders credit counters with exactly six decimal places", () => {
    expect(formatCredits(0)).toBe("0.000000");
    expect(formatCredits(0.0543219)).toBe("0.054322");
    expect(formatCredits(42.91)).toBe("42.910000");
    expect(formatCredits(1234567.5)).toBe("1,234,567.500000");
  });

  it("formats values with the requested locale without changing their numeric value", () => {
    expect(formatCredits(1234567.5, "de-DE")).toBe("1.234.567,500000");
    expect(formatNumber(1234567.5, "ja-JP", { maximumFractionDigits: 1 })).toBe("1,234,567.5");
    expect(formatCurrency(1234.5, "USD", "en-US")).toBe("$1,234.50");
    expect(formatCurrency(1234.5, "USD", "zh-CN")).toContain("1,234.50");
    expect(formatCurrency(1234.5, "USD", "zh-CN")).not.toBe(formatCurrency(1234.5, "USD", "en-US"));
    expect(formatDate("2026-06-19", "ja-JP", { timeZone: "UTC" })).toBe("2026年6月19日");
  });
});
