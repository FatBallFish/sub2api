export const SUPPORTED_LOCALES = ["en", "zh-CN", "zh-TW", "ja"] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_STORAGE_KEY = "sub2api.frontend.locale.v1";

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === "string" && SUPPORTED_LOCALES.includes(value as SupportedLocale);
}

export function normalizeLocale(value: string | null | undefined): SupportedLocale | null {
  if (!value) return null;

  const locale = value.trim().replaceAll("_", "-").toLowerCase();
  if (locale === "en" || locale.startsWith("en-")) return "en";
  if (locale === "ja" || locale.startsWith("ja-")) return "ja";
  if (locale === "zh" || locale === "zh-cn" || locale === "zh-sg" || locale.startsWith("zh-hans")) {
    return "zh-CN";
  }
  if (["zh-tw", "zh-hk", "zh-mo"].includes(locale) || locale.startsWith("zh-hant")) {
    return "zh-TW";
  }

  return null;
}

export function resolveInitialLocale({
  stored,
  browser,
}: {
  stored: string | null | undefined;
  browser: readonly string[];
}): SupportedLocale {
  if (isSupportedLocale(stored)) return stored;

  for (const locale of browser) {
    const normalized = normalizeLocale(locale);
    if (normalized) return normalized;
  }

  return "en";
}
