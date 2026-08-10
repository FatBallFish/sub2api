import { afterEach, describe, expect, it } from "vitest";
import i18n, {
  LOCALE_STORAGE_KEY,
  createI18nInstance,
  initializeI18n,
  normalizeLocale,
  readStoredLocale,
  resolveInitialLocale,
  writeStoredLocale,
} from "./index";

describe("locale initialization", () => {
  afterEach(async () => {
    localStorage.clear();
    await i18n.changeLanguage("en");
  });

  it.each([
    ["zh-HK", "zh-TW"],
    ["zh-HK-u-ca-chinese", "zh-TW"],
    ["zh-SG", "zh-CN"],
    ["zh-CN-x-private", "zh-CN"],
    ["zh-Hans-HK", "zh-CN"],
    ["ja-JP", "ja"],
    ["fr-FR", null],
  ])("normalizes %s to %s", (locale, expected) => {
    expect(normalizeLocale(locale)).toBe(expected);
  });

  it("prefers a valid persisted locale over the browser locale", () => {
    expect(resolveInitialLocale({ stored: "ja", browser: ["zh-CN"] })).toBe("ja");
  });

  it("uses the first supported browser locale when no selection is stored", () => {
    expect(resolveInitialLocale({ stored: null, browser: ["fr-FR", "zh-TW"] })).toBe("zh-TW");
  });

  it("ignores invalid persisted values and falls back to English for unsupported browsers", () => {
    expect(resolveInitialLocale({ stored: "bad", browser: ["fr-FR"] })).toBe("en");
  });

  it("treats storage read and write errors as non-fatal", () => {
    const storage = {
      getItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
    };

    expect(readStoredLocale(storage)).toBeNull();
    expect(() => writeStoredLocale("zh-CN", storage)).not.toThrow();
  });

  it("synchronizes language changes to storage and the html lang attribute", async () => {
    await initializeI18n();
    await i18n.changeLanguage("zh-TW");

    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("zh-TW");
    expect(document.documentElement.lang).toBe("zh-TW");
  });

  it("initializes a fresh runtime from stored locale and synchronizes its document language", async () => {
    const values = new Map([[LOCALE_STORAGE_KEY, "ja"]]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const documentElement = { lang: "" };

    const freshI18n = await createI18nInstance({
      storage,
      browser: ["zh-CN"],
      documentElement,
    });

    expect(freshI18n.resolvedLanguage).toBe("ja");
    expect(documentElement.lang).toBe("ja");
  });

  it("initializes a fresh runtime from a normalized browser locale when none is stored", async () => {
    const documentElement = { lang: "" };

    const freshI18n = await createI18nInstance({
      storage: null,
      browser: ["zh-HK-u-ca-chinese"],
      documentElement,
    });

    expect(freshI18n.resolvedLanguage).toBe("zh-TW");
    expect(documentElement.lang).toBe("zh-TW");
  });
});

function assertTranslationKeyTypes() {
  i18n.t("languageSwitcher.triggerLabel");
  i18n.t("public:pageTitles.home");
  // @ts-expect-error Unknown translation keys must fail type checking.
  i18n.t("common:notARealKey");
}

void assertTranslationKeyTypes;
