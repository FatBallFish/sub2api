import { describe, expect, it, vi, afterEach } from "vitest";
import { getConsoleBilling, getConsoleBootstrap, getConsoleOverview, getConsoleReferral } from "./console";

describe("console API", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads console bootstrap from the BFF endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          user: { id: 1, email: "user@example.com", role: "user" },
          wallet: { available_balance: 120.5, add_on_credits: 10.5, currency: "USD" },
          global_plan: {
            active: true,
            name: "Pro Plan",
            quota_limit: 60,
            quota_used: 51,
            quota_remaining: 9,
            used_percent: 85,
            current_period_end: "2026-06-22T00:00:00Z",
            expires_at: "2026-07-15T00:00:00Z",
          },
          unread_announcements: 2,
        },
      }),
    });
    globalThis.fetch = fetchMock;

    await expect(getConsoleBootstrap()).resolves.toMatchObject({
      user: { email: "user@example.com" },
      wallet: { available_balance: 120.5 },
      global_plan: { active: true, name: "Pro Plan" },
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/console/bootstrap", expect.any(Object));
  });

  it("loads console overview with the selected range", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          stats: {
            available_credits: 88.25,
            total_requests: 2401,
            active_api_keys: 3,
            usage_today: 6.75,
            changes: {
              available_credits: 0.02,
              total_requests: 0.11,
              usage_today: -0.05,
            },
          },
          usage_trend: [{ date: "2026-06-18", requests: 180, credits: 6.75, tokens: 44200 }],
          primary_key: {
            id: 10,
            name: "Production Gateway",
            masked_key: "sk-....prod",
            last_used_at: "2026-06-18T08:00:00Z",
            environments: 2,
          },
          referral_summary: { earnings: 18.5, invited: 4, orders: 2 },
          latest_announcements: [
            { id: 1, title: "New model routes", type: "update", published_at: "2026-06-18T07:00:00Z" },
          ],
        },
      }),
    });
    globalThis.fetch = fetchMock;

    await expect(getConsoleOverview("30d")).resolves.toMatchObject({
      stats: { available_credits: 88.25, total_requests: 2401 },
      primary_key: { masked_key: "sk-....prod" },
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/console/overview?range=30d", expect.any(Object));
  });

  it("loads console billing summary", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          wallet: { available_balance: 210.75, add_on_credits: 42.5, currency: "USD" },
          active_global_plan: {
            id: 9,
            plan_id: 102,
            name: "Pro",
            status: "active",
            quota_limit: 60,
            quota_used: 30,
            quota_remaining: 30,
            period_start: "2026-06-15T00:00:00Z",
            period_end: "2026-06-22T00:00:00Z",
            expires_at: "2026-07-15T00:00:00Z",
          },
          plans: [],
          add_ons: [],
          payment_methods: [],
          activity: [],
        },
      }),
    });
    globalThis.fetch = fetchMock;

    await expect(getConsoleBilling()).resolves.toMatchObject({
      wallet: { available_balance: 210.75 },
      active_global_plan: { name: "Pro" },
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/console/billing", expect.any(Object));
  });

  it("loads console referral summary", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          invite_link: "https://example.com/register?ref=pro-ref",
          rules: { signup_bonus: 5, first_order_bonus: 10, rebate_rate: 0.1, add_on_excluded: true },
          stats: { total_invited: 8, credits_earned: 31.5, pending_rewards: 4 },
          recent_invitees: [],
        },
      }),
    });
    globalThis.fetch = fetchMock;

    await expect(getConsoleReferral()).resolves.toMatchObject({
      invite_link: "https://example.com/register?ref=pro-ref",
      stats: { total_invited: 8 },
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/console/referral", expect.any(Object));
  });
});
