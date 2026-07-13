import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { login, register, sendVerifyCode, startOAuth } from "./auth";

describe("auth API", () => {
  const originalFetch = globalThis.fetch;
  const originalLocation = window.location;

  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { href: "", pathname: "/login", search: "" },
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    localStorage.clear();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
    vi.restoreAllMocks();
  });

  it("logs in with email and password then stores returned tokens", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          access_token: "access-123",
          refresh_token: "refresh-123",
          expires_in: 3600,
          token_type: "Bearer",
          user: { id: 7, email: "dev@example.com", username: "dev" },
        },
      }),
    });
    globalThis.fetch = fetchMock;

    await expect(login({ email: "dev@example.com", password: "secret" })).resolves.toMatchObject({
      access_token: "access-123",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/auth/login",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "dev@example.com", password: "secret" }),
      }),
    );
    expect(localStorage.getItem("auth_token")).toBe("access-123");
    expect(localStorage.getItem("refresh_token")).toBe("refresh-123");
  });

  it("registers with verification code and optional invitation fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          access_token: "new-access",
          refresh_token: "new-refresh",
          expires_in: 3600,
          token_type: "Bearer",
          user: { id: 8, email: "new@example.com" },
        },
      }),
    });
    globalThis.fetch = fetchMock;

    await register({
      email: "new@example.com",
      password: "secret123",
      verify_code: "123456",
      invitation_code: "INVITE",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/auth/register",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          email: "new@example.com",
          password: "secret123",
          verify_code: "123456",
          invitation_code: "INVITE",
        }),
      }),
    );
    expect(localStorage.getItem("auth_token")).toBe("new-access");
  });

  it("sends a verification code for registration", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { message: "sent", countdown: 60 } }),
    });

    await expect(sendVerifyCode("new@example.com")).resolves.toEqual({ message: "sent", countdown: 60 });
  });

  it("redirects to OAuth start endpoint with console redirect", () => {
    startOAuth("google");

    expect(window.location.href).toBe("/api/v1/auth/oauth/google/start?redirect=%2Fconsole");
  });
});
