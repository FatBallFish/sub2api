import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ApiError, apiRequest } from "./client";

describe("apiRequest", () => {
  const originalFetch = globalThis.fetch;
  const originalLocation = window.location;

  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { href: "", pathname: "/console", search: "?tab=keys" },
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  it("unwraps successful API responses and sends same-origin credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { active: true } }),
    });
    globalThis.fetch = fetchMock;

    await expect(apiRequest<{ active: boolean }>("/console/bootstrap")).resolves.toEqual({ active: true });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/console/bootstrap",
      expect.objectContaining({
        credentials: "include",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
      }),
    );
  });

  it("attaches stored bearer token to authenticated requests", async () => {
    localStorage.setItem("auth_token", "stored-access-token");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { ok: true } }),
    });
    globalThis.fetch = fetchMock;

    await apiRequest("/console/bootstrap");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/console/bootstrap",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer stored-access-token" }),
      }),
    );
  });

  it("throws ApiError with response payload for non-OK responses", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ success: false, error: "GLOBAL_PLAN_USE_UPGRADE_FLOW", message: "upgrade required" }),
    });

    await expect(apiRequest("/payment/orders", { method: "POST" })).rejects.toMatchObject({
      name: "ApiError",
      status: 409,
      code: "GLOBAL_PLAN_USE_UPGRADE_FLOW",
      message: "upgrade required",
    } satisfies Partial<ApiError>);
  });

  it("uses the standard backend reason as the semantic error code", async () => {
    const payload = { code: 400, message: "user not found", reason: "INVALID_USER" };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => payload,
    });

    await expect(apiRequest("/auth/login", { method: "POST" })).rejects.toMatchObject({
      status: 400,
      code: "INVALID_USER",
      message: "user not found",
      payload,
    } satisfies Partial<ApiError>);
  });

  it("prefers reason over other semantic error identifiers", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        reason: "REASON_CODE",
        code: "STRING_CODE",
        error_code: "ERROR_CODE",
        error: { code: "NESTED_CODE", type: "NESTED_TYPE", message: "nested message" },
        message: "top-level message",
      }),
    });

    await expect(apiRequest("/test")).rejects.toMatchObject({
      code: "REASON_CODE",
      message: "top-level message",
    });
  });

  it.each([
    [{ code: "STRING_CODE", error_code: "ERROR_CODE", error: { code: "NESTED_CODE" } }, "STRING_CODE"],
    [{ code: 400, error_code: "ERROR_CODE", error: { code: "NESTED_CODE" } }, "ERROR_CODE"],
    [{ code: 400, error: { code: "NESTED_CODE", type: "NESTED_TYPE" } }, "NESTED_CODE"],
    [{ code: 400, error: { type: "NESTED_TYPE" } }, "NESTED_TYPE"],
    [{ code: 400, error: "LEGACY_ERROR" }, "LEGACY_ERROR"],
  ])("normalizes supported semantic identifier shape %#", async (shape, expectedCode) => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ message: "request rejected", ...shape }),
    });

    await expect(apiRequest("/test")).rejects.toMatchObject({ code: expectedCode });
  });

  it("does not treat a numeric envelope code or status as a semantic code", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ code: 422, status: 422, message: "invalid input" }),
    });

    await expect(apiRequest("/test")).rejects.toMatchObject({
      status: 422,
      code: undefined,
      message: "invalid input",
    } satisfies Partial<ApiError>);
  });

  it("preserves a nested error message with the raw response payload", async () => {
    const payload = {
      error: { type: "authorization_error", message: "Provider authorization was rejected" },
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => payload,
    });

    await expect(apiRequest("/test")).rejects.toMatchObject({
      status: 403,
      code: "authorization_error",
      message: "Provider authorization was rejected",
      payload,
    } satisfies Partial<ApiError>);
  });

  it("preserves leading and trailing whitespace in a useful backend message", async () => {
    const payload = { code: 409, message: "  exact backend detail  " };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => payload,
    });

    await expect(apiRequest("/test")).rejects.toMatchObject({
      message: "  exact backend detail  ",
      payload,
    } satisfies Partial<ApiError>);
  });

  it("redirects authenticated routes to login on 401", async () => {
    localStorage.setItem("auth_token", "expired-token");
    localStorage.setItem("auth_user", JSON.stringify({ id: 1, email: "user@example.com" }));
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ success: false, message: "unauthorized" }),
    });

    await expect(apiRequest("/console/bootstrap")).rejects.toMatchObject({ status: 401 });

    expect(window.location.href).toBe("/login?redirect=%2Fconsole%3Ftab%3Dkeys");
    expect(localStorage.getItem("auth_token")).toBeNull();
    expect(localStorage.getItem("auth_user")).toBeNull();
  });

  it("does not stack login redirects when a 401 happens on the login page", async () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { href: "", pathname: "/login", search: "?redirect=%2Fconsole%2Fsubscription-wallet" },
    });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ success: false, message: "unauthorized" }),
    });

    await expect(apiRequest("/console/bootstrap")).rejects.toMatchObject({ status: 401 });

    expect(window.location.href).toBe("");
  });
});
