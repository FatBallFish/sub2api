import { describe, expect, it } from "vitest";
import {
  readSilentSsoRequest,
  sanitizeSilentSsoFallback,
  stripSilentSsoParam,
} from "./silentSso";

describe("readSilentSsoRequest", () => {
  it("detects the portal silent marker", () => {
    expect(readSilentSsoRequest("?sso=silent")).toBe(true);
    expect(readSilentSsoRequest("?foo=1&sso=silent")).toBe(true);
  });

  it("ignores other values and missing params", () => {
    expect(readSilentSsoRequest("")).toBe(false);
    expect(readSilentSsoRequest("?foo=1")).toBe(false);
    expect(readSilentSsoRequest("?sso=interactive")).toBe(false);
  });
});

describe("stripSilentSsoParam", () => {
  it("removes only the sso parameter and keeps the rest", () => {
    expect(stripSilentSsoParam("?sso=silent")).toBe("");
    expect(stripSilentSsoParam("?sso=silent&ref=mikiko")).toBe("?ref=mikiko");
    expect(stripSilentSsoParam("?ref=mikiko&sso=silent&lang=ja")).toBe("?ref=mikiko&lang=ja");
  });

  it("leaves unrelated searches untouched", () => {
    expect(stripSilentSsoParam("?ref=mikiko")).toBe("?ref=mikiko");
    expect(stripSilentSsoParam("")).toBe("");
  });
});

describe("sanitizeSilentSsoFallback", () => {
  it("accepts same-origin relative paths including /login", () => {
    expect(sanitizeSilentSsoFallback("/login")).toBe("/login");
    expect(sanitizeSilentSsoFallback("/")).toBe("/");
    expect(sanitizeSilentSsoFallback("/login?ref=mikiko")).toBe("/login?ref=mikiko");
  });

  it("decodes the double-encoded backend fragment before validating", () => {
    expect(sanitizeSilentSsoFallback("%2F")).toBe("/");
    expect(sanitizeSilentSsoFallback("%2Flogin")).toBe("/login");
    expect(sanitizeSilentSsoFallback("%252Flogin")).toBe("/login");
    expect(sanitizeSilentSsoFallback("%252Flogin%253Fref%253Dmikiko")).toBe("/login?ref=mikiko");
  });

  it("falls back to /login for unsafe values", () => {
    expect(sanitizeSilentSsoFallback(undefined)).toBe("/login");
    expect(sanitizeSilentSsoFallback("")).toBe("/login");
    expect(sanitizeSilentSsoFallback("https://evil.example.com/phish")).toBe("/login");
    expect(sanitizeSilentSsoFallback("//evil.example.com")).toBe("/login");
    expect(sanitizeSilentSsoFallback("\\evil")).toBe("/login");
    expect(sanitizeSilentSsoFallback("%2Fevil%09tab")).toBe("/login");
  });
});
