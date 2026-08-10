import { normalizeLocale } from "../i18n";

export type StripeSdkLocale = "en" | "ja" | "zh" | "zh-TW";
export type TurnstileSdkLocale = "en" | "ja" | "zh-CN" | "zh-TW";
export type AliyunSdkLocale = "cn" | "en";

export function stripeLocale(locale?: string): StripeSdkLocale {
  const normalized = normalizeLocale(locale) ?? "en";
  if (normalized === "zh-CN") return "zh";
  return normalized;
}

export function turnstileLocale(locale?: string): TurnstileSdkLocale {
  return normalizeLocale(locale) ?? "en";
}

export function aliyunLocale(locale?: string): AliyunSdkLocale {
  const normalized = normalizeLocale(locale) ?? "en";
  return normalized === "zh-CN" || normalized === "zh-TW" ? "cn" : "en";
}
