import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiKey, deleteApiKey, listApiKeys, revealApiKey, updateApiKey } from "./keys";

describe("keys API", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads API keys with pagination and filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        code: 0,
        message: "success",
        data: {
          items: [{ id: 100, name: "Production Gateway", key: "sk-live-prod", status: "active" }],
          total: 1,
          page: 1,
          page_size: 10,
          pages: 1,
        },
      }),
    });
    globalThis.fetch = fetchMock;

    await expect(listApiKeys({ page: 1, pageSize: 10, status: "active" })).resolves.toMatchObject({
      items: [{ id: 100, name: "Production Gateway" }],
      total: 1,
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/keys?page=1&page_size=10&status=active", expect.any(Object));
  });

  it("reveals a full API key for copy actions", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { key: "sk-live-full-value", expires_in_seconds: 60 },
      }),
    });
    globalThis.fetch = fetchMock;

    await expect(revealApiKey(100)).resolves.toEqual({
      key: "sk-live-full-value",
      expires_in_seconds: 60,
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/keys/100/reveal", expect.objectContaining({ method: "POST" }));
  });

  it("creates an API key with optional quota", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          id: 101,
          name: "Local Development",
          key: "sk-new-generated",
          group_id: null,
          status: "active",
          quota: 25,
          quota_used: 0,
          last_used_at: null,
          created_at: "2026-06-18T00:00:00Z",
          updated_at: "2026-06-18T00:00:00Z",
        },
      }),
    });
    globalThis.fetch = fetchMock;

    await expect(createApiKey({ name: "Local Development", quota: 25 })).resolves.toMatchObject({
      id: 101,
      name: "Local Development",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/keys",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "Local Development", quota: 25 }),
      }),
    );
  });

  it("updates an API key with PUT", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          id: 100,
          name: "Renamed Key",
          key: "sk-live-prod",
          group_id: null,
          status: "inactive",
          quota: 50,
          quota_used: 10,
          last_used_at: null,
          created_at: "2026-06-01T00:00:00Z",
          updated_at: "2026-06-18T00:00:00Z",
        },
      }),
    });
    globalThis.fetch = fetchMock;

    await expect(updateApiKey(100, { name: "Renamed Key", status: "inactive", quota: 50 })).resolves.toMatchObject({
      id: 100,
      name: "Renamed Key",
      status: "inactive",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/keys/100",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ name: "Renamed Key", status: "inactive", quota: 50 }),
      }),
    );
  });

  it("deletes an API key", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { message: "deleted" } }),
    });
    globalThis.fetch = fetchMock;

    await expect(deleteApiKey(100)).resolves.toEqual({ message: "deleted" });

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/keys/100", expect.objectContaining({ method: "DELETE" }));
  });
});
