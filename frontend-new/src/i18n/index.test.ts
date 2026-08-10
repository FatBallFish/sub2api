import { afterEach, describe, expect, it } from "vitest";
import i18n, {
  LOCALE_STORAGE_KEY,
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
    ["zh-SG", "zh-CN"],
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
});
