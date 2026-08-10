import { createInstance } from "i18next";
import { initReactI18next } from "react-i18next";
import {
  LOCALE_STORAGE_KEY,
  SUPPORTED_LOCALES,
  normalizeLocale,
  resolveInitialLocale,
  type SupportedLocale,
} from "./locales";
import en from "./resources/en";
import ja from "./resources/ja";
import zhCN from "./resources/zh-CN";
import zhTW from "./resources/zh-TW";

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readStoredLocale(storage: ReadableStorage | null = browserStorage()): string | null {
  try {
    return storage?.getItem(LOCALE_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function writeStoredLocale(
  locale: SupportedLocale,
  storage: WritableStorage | null = browserStorage(),
): void {
  try {
    storage?.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Language changes remain usable when browser storage is unavailable.
  }
}

function browserLocales(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  if (navigator.languages.length > 0) return navigator.languages;
  return navigator.language ? [navigator.language] : [];
}

export function detectInitialLocale(): SupportedLocale {
  return resolveInitialLocale({
    stored: readStoredLocale(),
    browser: browserLocales(),
  });
}

const i18n = createInstance();
let initialization: Promise<typeof i18n> | null = null;

i18n.on("languageChanged", (language) => {
  const locale = normalizeLocale(language) ?? "en";
  writeStoredLocale(locale);

  if (typeof document !== "undefined") {
    document.documentElement.lang = locale;
  }
});

export function initializeI18n(): Promise<typeof i18n> {
  if (i18n.isInitialized) return Promise.resolve(i18n);

  initialization ??= i18n
    .use(initReactI18next)
    .init({
      resources: {
        en,
        "zh-CN": zhCN,
        "zh-TW": zhTW,
        ja,
      },
      lng: detectInitialLocale(),
      fallbackLng: "en",
      supportedLngs: [...SUPPORTED_LOCALES],
      defaultNS: "common",
      ns: ["common", "public", "auth", "console", "errors"],
      returnNull: false,
      interpolation: {
        escapeValue: false,
      },
      react: {
        useSuspense: false,
      },
    })
    .then(() => i18n);

  return initialization;
}

export {
  LOCALE_STORAGE_KEY,
  SUPPORTED_LOCALES,
  normalizeLocale,
  resolveInitialLocale,
  type SupportedLocale,
};

export default i18n;
