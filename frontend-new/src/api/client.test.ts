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
