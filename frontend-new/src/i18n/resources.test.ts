import { describe, expect, it } from "vitest";
import en from "./resources/en";
import ja from "./resources/ja";
import zhCN from "./resources/zh-CN";
import zhTW from "./resources/zh-TW";

type ResourceTree = { readonly [key: string]: string | ResourceTree };

function flattenResources(resource: unknown, prefix = ""): Map<string, string> {
  if (!resource || typeof resource !== "object" || Array.isArray(resource)) {
    throw new TypeError(`${prefix || "<root>"}: expected a translation object`);
  }
  const flattened = new Map<string, string>();

  for (const [key, value] of Object.entries(resource as ResourceTree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      flattened.set(path, value);
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [childKey, childValue] of flattenResources(value, path)) {
        flattened.set(childKey, childValue);
      }
    } else {
      throw new TypeError(`${path}: expected a string translation leaf`);
    }
  }

  return flattened;
}

function interpolationVariables(value: string): string[] {
  return [...value.matchAll(/{{\s*([^},\s]+)[^}]*}}/g)]
    .map((match) => match[1])
    .sort();
}

describe("translation resources", () => {
  const english = flattenResources(en);
  const locales = [
    ["zh-CN", zhCN],
    ["zh-TW", zhTW],
    ["ja", ja],
  ] as const;

  it.each(locales)("keeps %s keys and interpolation variables in parity with English", (locale, resource) => {
    const translated = flattenResources(resource);
    const englishKeys = [...english.keys()].sort();
    const translatedKeys = [...translated.keys()].sort();

    expect(translatedKeys, `${locale} must have exactly the English resource keys`).toEqual(englishKeys);

    const emptyValues = translatedKeys.filter((key) => !translated.get(key)?.trim());
    expect(emptyValues, `${locale} has empty translation values`).toEqual([]);

    const mismatchedVariables = englishKeys.flatMap((key) => {
      const expected = interpolationVariables(english.get(key) ?? "");
      const actual = interpolationVariables(translated.get(key) ?? "");
      return expected.join("\0") === actual.join("\0")
        ? []
        : [`${key}: expected {{${expected.join(", ")}}}, received {{${actual.join(", ")}}}`];
    });
    expect(mismatchedVariables, `${locale} interpolation variables differ from English`).toEqual([]);
  });

  it("contains only non-empty string leaves in English", () => {
    const emptyValues = [...english].flatMap(([key, value]) => value.trim() ? [] : [key]);
    expect(emptyValues, "English has empty translation values").toEqual([]);
  });

  it("rejects non-string runtime leaves", () => {
    expect(() => flattenResources({ common: { invalid: 42 } })).toThrow(
      "common.invalid: expected a string translation leaf",
    );
  });
});
