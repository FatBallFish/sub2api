import { createInstance, type i18n as I18nInstance } from "i18next";
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
type LocaleStorage = ReadableStorage & WritableStorage;
type DocumentLanguage = { lang: string };

export interface I18nEnvironment {
  storage?: LocaleStorage | null;
  browser?: readonly string[];
  documentElement?: DocumentLanguage | null;
  initialLocale?: SupportedLocale;
}

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

function browserDocumentElement(): DocumentLanguage | null {
  return typeof document === "undefined" ? null : document.documentElement;
}

export function detectInitialLocale(environment: I18nEnvironment = {}): SupportedLocale {
  const storage = environment.storage === undefined ? browserStorage() : environment.storage;
  return resolveInitialLocale({
    stored: readStoredLocale(storage),
    browser: environment.browser ?? browserLocales(),
  });
}

const i18n = createInstance();
let initialization: Promise<I18nInstance> | null = null;

async function initializeInstance(
  instance: I18nInstance,
  environment: I18nEnvironment = {},
): Promise<I18nInstance> {
  const storage = environment.storage === undefined ? browserStorage() : environment.storage;
  const documentElement = environment.documentElement === undefined
    ? browserDocumentElement()
    : environment.documentElement;
  const languageChanged = (language: string) => {
    const locale = normalizeLocale(language) ?? "en";
    writeStoredLocale(locale, storage);
    if (documentElement) documentElement.lang = locale;
  };

  instance.on("languageChanged", languageChanged);

  try {
    await instance
      .use(initReactI18next)
      .init({
        resources: {
          en,
          "zh-CN": zhCN,
          "zh-TW": zhTW,
          ja,
        },
        lng: environment.initialLocale ?? detectInitialLocale(environment),
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
      });
  } catch (error) {
    instance.off("languageChanged", languageChanged);
    throw error;
  }

  return instance;
}

export function createI18nInstance(environment: I18nEnvironment = {}): Promise<I18nInstance> {
  return initializeInstance(createInstance(), environment);
}

export function initializeI18n(environment: I18nEnvironment = {}): Promise<I18nInstance> {
  if (i18n.isInitialized) return Promise.resolve(i18n);

  initialization ??= initializeInstance(i18n, environment).catch((error: unknown) => {
    initialization = null;
    throw error;
  });

  return initialization;
}

export async function activateEnglishFallback(): Promise<void> {
  try {
    if (i18n.isInitialized) {
      await i18n.changeLanguage("en");
    } else {
      await initializeI18n({ initialLocale: "en" });
    }
  } finally {
    const documentElement = browserDocumentElement();
    if (documentElement) documentElement.lang = "en";
  }
}

export {
  LOCALE_STORAGE_KEY,
  SUPPORTED_LOCALES,
  normalizeLocale,
  resolveInitialLocale,
  type SupportedLocale,
};

export default i18n;
