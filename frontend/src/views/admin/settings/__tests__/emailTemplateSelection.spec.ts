import { describe, expect, it } from "vitest";
import {
  resolveInitialEmailTemplateLocale,
  saveEmailTemplateLocale,
} from "../emailTemplateSelection";

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

describe("email template locale selection", () => {
  it("keeps the saved template locale instead of following the admin UI locale", () => {
    expect(resolveInitialEmailTemplateLocale(["zh", "en"], "zh-CN", "en")).toBe("en");
  });

  it("falls back to the UI language when the saved template locale is unavailable", () => {
    expect(resolveInitialEmailTemplateLocale(["zh", "en"], "zh-CN", "ja")).toBe("zh");
  });

  it("stores the selected template locale for the next page load", () => {
    const storage = createStorage();

    saveEmailTemplateLocale("en", storage);

    expect(resolveInitialEmailTemplateLocale(["zh", "en"], "zh-CN", storage.getItem("admin.emailTemplate.selectedLocale"))).toBe("en");
  });
});
