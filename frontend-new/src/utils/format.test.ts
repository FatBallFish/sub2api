import { describe, expect, it } from "vitest";
import i18n from "../i18n";
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

  it("uses the active i18n locale when no explicit locale is provided", async () => {
    const date = new Date(2026, 5, 19, 12);

    await i18n.changeLanguage("en");
    expect(formatCurrency(1234.5, "USD")).toBe("$1,234.50");
    expect(formatDate(date)).toBe("June 19, 2026");

    await i18n.changeLanguage("zh-TW");
    expect(formatCurrency(1234.5, "USD")).toBe("US$1,234.50");

    await i18n.changeLanguage("ja");
    expect(formatDate(date)).toBe("2026年6月19日");
  });

  it("keeps non-ISO string values unchanged", () => {
    expect(formatDate("release-42", "en")).toBe("release-42");
  });

  it("uses an explicit UTC timezone for calendar dates", () => {
    expect(formatDate("2026-08-10", "en", { timeZone: "America/Los_Angeles" })).toBe("August 9, 2026");
    expect(formatDate("2026-08-10", "en", { timeZone: "UTC" })).toBe("August 10, 2026");
  });
});
