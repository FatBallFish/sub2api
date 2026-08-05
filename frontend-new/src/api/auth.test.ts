import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearOAuthAffiliateCode,
  createPendingOAuthAccount,
  login,
  readOAuthAffiliateCode,
  register,
  sendPendingOAuthVerifyCode,
  sendVerifyCode,
  startOAuth,
} from "./auth";
import type { PendingOAuthSessionStatus } from "./auth";
import { captchaProofPayload } from "../components/auth/captcha";

describe("auth API", () => {
  const originalFetch = globalThis.fetch;
  const originalLocation = window.location;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { href: "", pathname: "/login", search: "" },
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    localStorage.clear();
    sessionStorage.clear();
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

  it("serializes Tencent captcha proofs with ticket and randstr", () => {
    expect(captchaProofPayload({
      provider: "tencent",
      ticket: "ticket",
      randstr: "@rand",
    })).toEqual({
      tencent_captcha_ticket: "ticket",
      tencent_captcha_randstr: "@rand",
    });
  });

  it("serializes Aliyun captcha proofs through the compatible token field", () => {
    expect(captchaProofPayload({ provider: "aliyun", token: "captcha-verify-param" })).toEqual({
      turnstile_token: "captcha-verify-param",
    });
  });

  it("sends Tencent proof fields with a verification-code request", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { message: "sent", countdown: 60 } }),
    });
    globalThis.fetch = fetchMock;

    await sendVerifyCode("new@example.com", {
      provider: "tencent",
      ticket: "ticket",
      randstr: "@rand",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/auth/send-verify-code",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          email: "new@example.com",
          tencent_captcha_ticket: "ticket",
          tencent_captcha_randstr: "@rand",
        }),
      }),
    );
  });

  it("sends a verification code for a pending OAuth registration", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { message: "sent", countdown: 60 } }),
    });
    globalThis.fetch = fetchMock;

    await expect(
      sendPendingOAuthVerifyCode("oauth@example.com", "challenge-token"),
    ).resolves.toEqual({ message: "sent", countdown: 60 });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/auth/oauth/pending/send-verify-code",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          email: "oauth@example.com",
          turnstile_token: "challenge-token",
        }),
      }),
    );
  });

  it("returns pending session status when send-code finds an existing account", async () => {
    const pendingStatus = {
      auth_result: "pending_session",
      provider: "google",
      intent: "login",
      step: "choose_account_action_required",
      email: "existing@example.com",
      resolved_email: "existing@example.com",
      adoption_required: true,
      force_email_on_signup: true,
      email_binding_required: true,
      existing_account_bindable: true,
    } satisfies PendingOAuthSessionStatus;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: pendingStatus }),
    });

    const result = await sendPendingOAuthVerifyCode("existing@example.com", "challenge-token");

    expect(result).toEqual(pendingStatus);
    expect("auth_result" in result ? result.auth_result : undefined).toBe("pending_session");
  });

  it("creates a pending OAuth account and stores returned tokens", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          access_token: "oauth-access",
          refresh_token: "oauth-refresh",
          expires_in: 3600,
          token_type: "Bearer",
          user: { id: 9, email: "oauth@example.com" },
        },
      }),
    });
    globalThis.fetch = fetchMock;

    await expect(
      createPendingOAuthAccount({
        email: "oauth@example.com",
        password: "secret123",
        verify_code: "123456",
        invitation_code: "INVITE",
        aff_code: "AFF123",
      }),
    ).resolves.toMatchObject({ access_token: "oauth-access" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/auth/oauth/pending/create-account",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          email: "oauth@example.com",
          password: "secret123",
          verify_code: "123456",
          invitation_code: "INVITE",
          aff_code: "AFF123",
        }),
      }),
    );
    expect(localStorage.getItem("auth_token")).toBe("oauth-access");
    expect(localStorage.getItem("refresh_token")).toBe("oauth-refresh");
  });

  it("returns pending session status without storing auth when account creation races", async () => {
    const pendingStatus = {
      auth_result: "pending_session",
      provider: "github",
      intent: "login",
      step: "choose_account_action_required",
      email: "existing@example.com",
      resolved_email: "existing@example.com",
      invitation_required: false,
      adoption_required: true,
      existing_account_bindable: true,
    } satisfies PendingOAuthSessionStatus;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: pendingStatus }),
    });

    const result = await createPendingOAuthAccount({
      email: "existing@example.com",
      password: "secret123",
      verify_code: "123456",
    });

    expect(result).toEqual(pendingStatus);
    expect("auth_result" in result ? result.auth_result : undefined).toBe("pending_session");
    expect(localStorage.getItem("auth_token")).toBeNull();
  });

  it.each(["google", "github"] as const)(
    "redirects to %s OAuth start endpoint with affiliate code",
    (provider) => {
      startOAuth(provider, "/console", " AFF123 ");

      expect(window.location.href).toBe(
        `/api/v1/auth/oauth/${provider}/start?redirect=%2Fconsole&aff_code=AFF123`,
      );
      expect(sessionStorage.getItem("oauth_aff_code")).toBe("AFF123");
    },
  );

  it.each(["google", "github"] as const)(
    "posts an action captcha proof before redirecting to %s OAuth",
    async (provider) => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { authorize_url: `https://identity.example/${provider}` },
        }),
      });
      globalThis.fetch = fetchMock;

      await startOAuth(provider, "/console", " AFF123 ", {
        provider: "tencent",
        ticket: "oauth-ticket",
        randstr: "@oauth-rand",
      });

      expect(fetchMock).toHaveBeenCalledWith(
        `/api/v1/auth/oauth/${provider}/start?redirect=%2Fconsole&aff_code=AFF123`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            tencent_captcha_ticket: "oauth-ticket",
            tencent_captcha_randstr: "@oauth-rand",
          }),
        }),
      );
      expect(window.location.href).toBe(`https://identity.example/${provider}`);
    },
  );

  it.each([undefined, "   "])(
    "clears stale OAuth affiliate context when starting without a valid code (%s)",
    (affiliateCode) => {
      sessionStorage.setItem("oauth_aff_code", "STALE");

      startOAuth("google", "/console", affiliateCode);

      expect(window.location.href).toBe("/api/v1/auth/oauth/google/start?redirect=%2Fconsole");
      expect(sessionStorage.getItem("oauth_aff_code")).toBeNull();
    },
  );

  it("reads normalized OAuth affiliate context and clears it", () => {
    sessionStorage.setItem("oauth_aff_code", "  AFF456  ");

    expect(readOAuthAffiliateCode()).toBe("AFF456");

    clearOAuthAffiliateCode();

    expect(readOAuthAffiliateCode()).toBe("");
    expect(sessionStorage.getItem("oauth_aff_code")).toBeNull();
  });

  it("tolerates OAuth affiliate storage exceptions", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    expect(readOAuthAffiliateCode()).toBe("");
    expect(() => clearOAuthAffiliateCode()).not.toThrow();
    expect(() => startOAuth("github", "/dashboard", " AFF789 ")).not.toThrow();
    expect(window.location.href).toBe(
      "/api/v1/auth/oauth/github/start?redirect=%2Fdashboard&aff_code=AFF789",
    );
  });

  it("clears a stale affiliate code before a replacement write fails", () => {
    sessionStorage.setItem("oauth_aff_code", "STALE");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    startOAuth("google", "/console", " NEW-CODE ");

    expect(sessionStorage.getItem("oauth_aff_code")).toBeNull();
    expect(window.location.href).toBe(
      "/api/v1/auth/oauth/google/start?redirect=%2Fconsole&aff_code=NEW-CODE",
    );
  });

  it("redirects to OAuth start endpoint with console redirect", () => {
    startOAuth("google");

    expect(window.location.href).toBe("/api/v1/auth/oauth/google/start?redirect=%2Fconsole");
  });
});
