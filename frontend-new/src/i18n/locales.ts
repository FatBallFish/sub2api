export const SUPPORTED_LOCALES = ["en", "zh-CN", "zh-TW", "ja"] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_STORAGE_KEY = "sub2api.frontend.locale.v1";

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === "string" && SUPPORTED_LOCALES.includes(value as SupportedLocale);
}

export function normalizeLocale(value: string | null | undefined): SupportedLocale | null {
  if (!value) return null;

  try {
    const locale = new Intl.Locale(value.trim().replaceAll("_", "-"));
    if (locale.language === "en") return "en";
    if (locale.language === "ja") return "ja";
    if (locale.language === "zh") {
      if (locale.script === "Hant") return "zh-TW";
      if (locale.script === "Hans") return "zh-CN";
      if (["TW", "HK", "MO"].includes(locale.region ?? "")) return "zh-TW";
      return "zh-CN";
    }
  } catch {
    return null;
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
