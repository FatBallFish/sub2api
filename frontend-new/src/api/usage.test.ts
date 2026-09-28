import { afterEach, describe, expect, it, vi } from "vitest";
import { getAPIKeysUsageStats, getUsageStats, listUsageLogs } from "./usage";

describe("usage api", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists usage logs through the legacy usage endpoint with query filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { items: [], total: 0, page: 2, page_size: 10 },
      }),
    });
    globalThis.fetch = fetchMock;

    await listUsageLogs({ page: 2, page_size: 10, search: "claude", sort_order: "asc" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/usage?page=2&page_size=10&model=claude&sort_by=created_at&sort_order=asc",
      expect.any(Object),
    );
  });

  it("gets usage stats with the selected date range", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { total_requests: 3, total_tokens: 99, total_actual_cost: 1.25, average_duration_ms: 450 },
      }),
    });
    globalThis.fetch = fetchMock;

    await getUsageStats({ start_date: "2026-06-01", end_date: "2026-06-18" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/usage/stats?start_date=2026-06-01&end_date=2026-06-18",
      expect.any(Object),
    );
  });

  it("gets batch API key usage stats for console key cards", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          stats: {
            "100": { api_key_id: 100, today_actual_cost: 1.25, total_actual_cost: 7.5 },
          },
        },
      }),
    });
    globalThis.fetch = fetchMock;

    await getAPIKeysUsageStats([100, 101]);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/usage/dashboard/api-keys-usage",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ api_key_ids: [100, 101] }),
      }),
    );
  });
});
