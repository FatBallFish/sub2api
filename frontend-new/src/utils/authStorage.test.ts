import { afterEach, describe, expect, it } from "vitest";
import { clearAuthStorage, isAuthenticated } from "./authStorage";

describe("authStorage", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("treats expired stored tokens as signed out and clears stale auth data", () => {
    localStorage.setItem("auth_token", "expired-token");
    localStorage.setItem("auth_user", JSON.stringify({ id: 7, email: "signed@example.com" }));
    localStorage.setItem("refresh_token", "refresh-token");
    localStorage.setItem("token_expires_at", String(Date.now() - 1000));

    expect(isAuthenticated()).toBe(false);
    expect(localStorage.getItem("auth_token")).toBeNull();
    expect(localStorage.getItem("auth_user")).toBeNull();
    expect(localStorage.getItem("refresh_token")).toBeNull();
    expect(localStorage.getItem("token_expires_at")).toBeNull();
  });

  it("keeps non-expired stored tokens authenticated", () => {
    localStorage.setItem("auth_token", "fresh-token");
    localStorage.setItem("auth_user", JSON.stringify({ id: 7, email: "signed@example.com" }));
    localStorage.setItem("token_expires_at", String(Date.now() + 60_000));

    expect(isAuthenticated()).toBe(true);

    clearAuthStorage();
    expect(isAuthenticated()).toBe(false);
  });
});
