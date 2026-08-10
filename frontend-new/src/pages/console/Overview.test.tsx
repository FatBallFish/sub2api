import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import Overview from "./Overview";
import i18n from "../../i18n";

describe("Overview", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders overview metrics from the console BFF endpoint", async () => {
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
          global_plan: {
            active: true,
            name: "Pro",
            quota_limit: 60,
            quota_used: 21,
            quota_remaining: 39,
            used_percent: 35,
            current_period_end: "2026-06-21T00:00:00Z",
          },
          usage_trend: [
            { date: "2026-06-12", requests: 120, credits: 2.1, tokens: 120000 },
            { date: "2026-06-13", requests: 180, credits: 4.2, tokens: 180000 },
            { date: "2026-06-14", requests: 90, credits: 1.4, tokens: 90000 },
          ],
          primary_key: {
            id: 10,
            name: "Production Gateway",
            masked_key: "sk-....prod",
            last_used_at: "2026-06-18T08:00:00Z",
            environments: 2,
          },
          referral_summary: { earnings: 18.5, invited: 4, orders: 2 },
          affiliate_enabled: true,
          latest_announcements: [
            { id: 1, title: "New model routes", type: "update", published_at: "2026-06-18T07:00:00Z" },
          ],
        },
      }),
    });
    globalThis.fetch = fetchMock;

    render(
      <MemoryRouter>
        <Overview />
      </MemoryRouter>,
    );

    expect(screen.getByText("Loading overview...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("88.250000")).toBeInTheDocument();
    });

    expect(screen.getByText("2,401")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("6.750000")).toBeInTheDocument();
    expect(screen.getByText("Production Gateway")).toBeInTheDocument();
    expect(screen.getByText("Primary API Key").closest(".console-inverted-panel")).not.toBeNull();
    expect(screen.getByText("sk-....prod")).toBeInTheDocument();
    expect(screen.getByText("sk-....prod")).toHaveClass("console-inverted-code");
    expect(screen.getByText("Pro quota")).toBeInTheDocument();
    expect(screen.getByText("35%")).toBeInTheDocument();
    expect(screen.queryByText("85%")).not.toBeInTheDocument();
    expect(screen.getByText("18.500000")).toBeInTheDocument();
    expect(screen.getByText("New model routes")).toBeInTheDocument();
    expect(screen.getByLabelText("Fri: 2.100000 Credits, 120 requests, 120,000 tokens")).toHaveAttribute(
      "title",
      "Fri: 2.100000 Credits, 120 requests, 120,000 tokens",
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/console/overview?range=7d", expect.any(Object));
  });

  it("hides the referral summary when affiliate is disabled", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          stats: {
            available_credits: 0,
            total_requests: 0,
            active_api_keys: 0,
            usage_today: 0,
            changes: { available_credits: 0, total_requests: 0, usage_today: 0 },
          },
          global_plan: { active: false, name: "Add-on Credits", quota_limit: 0, quota_used: 0, quota_remaining: 0, used_percent: 0 },
          usage_trend: [],
          referral_summary: { earnings: 0, invited: 0, orders: 0 },
          affiliate_enabled: false,
          latest_announcements: [],
        },
      }),
    });
    globalThis.fetch = fetchMock;

    render(
      <MemoryRouter>
        <Overview />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.queryByText("Loading overview...")).not.toBeInTheDocument();
    });
    expect(screen.queryByText("Referral Program")).not.toBeInTheDocument();
  });

  it("loads today analytics with hourly labels and visible hover values", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            stats: {
              available_credits: 10,
              total_requests: 2,
              active_api_keys: 1,
              usage_today: 1.5,
              changes: { available_credits: 0, total_requests: 0, usage_today: 0 },
            },
            global_plan: { active: false, name: "Add-on Credits", quota_limit: 0, quota_used: 0, quota_remaining: 10, used_percent: 0 },
            usage_trend: [{ date: "2026-06-22T09:00:00Z", requests: 2, credits: 1.5, tokens: 4000 }],
            referral_summary: { earnings: 0, invited: 0, orders: 0 },
            affiliate_enabled: false,
            latest_announcements: [],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            stats: {
              available_credits: 10,
              total_requests: 3,
              active_api_keys: 1,
              usage_today: 2.5,
              changes: { available_credits: 0, total_requests: 0, usage_today: 0 },
            },
            global_plan: { active: false, name: "Add-on Credits", quota_limit: 0, quota_used: 0, quota_remaining: 10, used_percent: 0 },
            usage_trend: [{ date: "2026-06-22T10:00:00Z", requests: 3, credits: 2.5, tokens: 5000 }],
            referral_summary: { earnings: 0, invited: 0, orders: 0 },
            affiliate_enabled: false,
            latest_announcements: [],
          },
        }),
      });
    globalThis.fetch = fetchMock;

    render(
      <MemoryRouter>
        <Overview />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/v1/console/overview?range=7d", expect.any(Object));
    });

    fireEvent.change(screen.getByLabelText("Usage analytics range"), { target: { value: "today" } });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/v1/console/overview?range=today", expect.any(Object));
    });
    expect(screen.getByText("10:00")).toBeInTheDocument();
    expect(screen.getByText("2.500000 Credits")).toBeInTheDocument();
    expect(screen.getByText("3 requests")).toBeInTheDocument();
    expect(screen.getByLabelText("10:00: 2.500000 Credits, 3 requests, 5,000 tokens")).toHaveAttribute(
      "title",
      "10:00: 2.500000 Credits, 3 requests, 5,000 tokens",
    );
  });

  it("renders Japanese copy and locale-aware values, then switches locale without refetching", async () => {
    await i18n.changeLanguage("ja");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          stats: {
            available_credits: 1234.5,
            total_requests: 2401,
            active_api_keys: 3,
            usage_today: 6.75,
            changes: { available_credits: 0.02, total_requests: 0.11, usage_today: -0.05 },
          },
          global_plan: {
            active: true,
            name: "Enterprise Tokyo",
            quota_limit: 60,
            quota_used: 21,
            quota_remaining: 39,
            used_percent: 35,
            current_period_end: "2099-06-21T00:00:00Z",
          },
          usage_trend: [{ date: "2026-06-12", requests: 1200, credits: 2.1, tokens: 120000 }],
          primary_key: {
            id: 10,
            name: "Production Gateway",
            masked_key: "sk-....prod",
            last_used_at: null,
            environments: 2,
          },
          referral_summary: { earnings: 18.5, invited: 4, orders: 2 },
          affiliate_enabled: true,
          latest_announcements: [
            { id: 1, title: "Backend configured announcement", type: "update", published_at: null },
          ],
        },
      }),
    });
    globalThis.fetch = fetchMock;

    render(
      <MemoryRouter>
        <Overview />
      </MemoryRouter>,
    );

    expect(screen.getByText("概要を読み込んでいます...")).toBeInTheDocument();
    await screen.findByText("利用可能なクレジット");

    expect(screen.getByRole("heading", { name: "概要" })).toBeInTheDocument();
    expect(screen.getByText("利用状況分析")).toBeInTheDocument();
    expect(screen.getByLabelText("利用状況分析の期間")).toBeInTheDocument();
    expect(screen.getByText("1,234.500000")).toBeInTheDocument();
    expect(screen.getByText("2,401")).toBeInTheDocument();
    expect(screen.getByText("Enterprise Tokyo のクォータ")).toBeInTheDocument();
    expect(screen.getByText("Production Gateway")).toBeInTheDocument();
    expect(screen.getByText("Backend configured announcement")).toBeInTheDocument();
    expect(screen.getByLabelText(/2\.100000 クレジット、1,200 件のリクエスト、120,000 トークン/)).toBeInTheDocument();
    expect(document.title).toBe("概要 | Mikiko CC");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await i18n.changeLanguage("zh-CN");
    });

    expect(screen.getByRole("heading", { name: "概览" })).toBeInTheDocument();
    expect(screen.getByText("1,234.500000")).toBeInTheDocument();
    expect(screen.getByText("Enterprise Tokyo 配额")).toBeInTheDocument();
    expect(document.title).toBe("概览 | Mikiko CC");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await i18n.changeLanguage("zh-TW");
    });

    expect(screen.getByText("可用額度")).toBeInTheDocument();
    expect(screen.getByLabelText(/2\.100000 額度、1,200 次請求、120,000 Token/)).toBeInTheDocument();
    expect(screen.getByText("Enterprise Tokyo 配額")).toBeInTheDocument();
    expect(document.title).toBe("概覽 | Mikiko CC");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("localizes network failures and empty overview sections", async () => {
    await i18n.changeLanguage("zh-CN");
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    const { unmount } = render(
      <MemoryRouter>
        <Overview />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "概览暂不可用" })).toBeInTheDocument();
    expect(screen.getByText("无法加载概览。请稍后重试。")).toBeInTheDocument();
    unmount();

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          stats: {
            available_credits: 0,
            total_requests: 0,
            active_api_keys: 0,
            usage_today: 0,
            changes: { available_credits: 0, total_requests: 0, usage_today: 0 },
          },
          global_plan: { active: false, name: "Configured Plan", quota_limit: 0, quota_used: 0, quota_remaining: 0, used_percent: 0 },
          usage_trend: [],
          referral_summary: { earnings: 0, invited: 0, orders: 0 },
          affiliate_enabled: false,
          latest_announcements: [],
        },
      }),
    });

    render(
      <MemoryRouter>
        <Overview />
      </MemoryRouter>,
    );

    expect(await screen.findByText("暂无用量数据")).toBeInTheDocument();
    expect(screen.getByText("暂无公告")).toBeInTheDocument();
    expect(screen.getByText("Configured Plan 配额")).toBeInTheDocument();
  });
});
