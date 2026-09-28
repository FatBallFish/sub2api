import { describe, expect, it } from "vitest";
import { aliyunLocale, stripeLocale, turnstileLocale } from "./sdkLocale";

describe("SDK locale mappings", () => {
  it.each([
    ["en", "en", "en", "en"],
    ["zh-CN", "zh", "zh-CN", "cn"],
    ["zh-TW", "zh-TW", "zh-TW", "cn"],
    ["ja", "ja", "ja", "en"],
  ])("maps %s for Stripe, Turnstile, and Aliyun", (locale, stripe, turnstile, aliyun) => {
    expect(stripeLocale(locale)).toBe(stripe);
    expect(turnstileLocale(locale)).toBe(turnstile);
    expect(aliyunLocale(locale)).toBe(aliyun);
  });

  it("falls back unknown locales to English", () => {
    expect(stripeLocale("fr")).toBe("en");
    expect(turnstileLocale("fr")).toBe("en");
    expect(aliyunLocale("fr")).toBe("en");
  });
});
