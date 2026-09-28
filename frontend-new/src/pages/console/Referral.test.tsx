import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import Referral from "./Referral";

describe("Referral", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders referral data from the console BFF endpoint and copies the invite link", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            invite_link: "https://example.com/register?ref=pro-ref",
            rules: { signup_bonus: 5, first_order_bonus: 10, rebate_rate: 0.1, add_on_excluded: true },
            stats: { total_invited: 8, credits_earned: 31.5, pending_rewards: 4 },
            recent_invitees: [
              {
                id: 1,
                email: "al***@gmail.com",
                joined_at: "2026-06-18T00:00:00Z",
                status: "Active",
                earnings: 12.5,
              },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ));
    globalThis.fetch = fetchMock;

    render(<Referral />);

    expect(screen.getByText("Loading referral...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("https://example.com/register?ref=pro-ref")).toBeInTheDocument();
    });

    expect(screen.getByText("Limited Time Reward")).toHaveClass("console-inverted-label");
    expect(screen.getByText("https://example.com/register?ref=pro-ref")).toHaveClass("console-inverted-code");
    expect(screen.getByText("8 Users")).toBeInTheDocument();
    expect(screen.getByText("31.500000")).toBeInTheDocument();
    expect(screen.getByText("4.000000")).toBeInTheDocument();
    expect(screen.getByText("12.500000")).toBeInTheDocument();
    expect(screen.getByText("al***@gmail.com")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveClass("min-w-[640px]");
    expect(screen.getByRole("table").parentElement).toHaveClass("overflow-x-auto");

    await userEvent.click(screen.getByRole("button", { name: /copy invite link/i }));

    expect(writeText).toHaveBeenCalledWith("https://example.com/register?ref=pro-ref");
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/console/referral", expect.any(Object));
  });

  it("transfers pending rewards, blocks duplicate clicks, and refreshes referral data", async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
    let resolveTransfer!: (value: Response) => void;
    const transferResponse = new Promise<Response>((resolve) => {
      resolveTransfer = resolve;
    });
    let referralCalls = 0;
    let affiliateCalls = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === "/api/v1/user/aff/transfer") return transferResponse;
      if (url === "/api/v1/user/aff") {
        affiliateCalls += 1;
        return Promise.resolve(new Response(JSON.stringify({
          success: true,
          data: { aff_quota: affiliateCalls === 1 ? 4 : 0 },
        }), { status: 200, headers: { "Content-Type": "application/json" } }));
      }
      if (url === "/api/v1/console/referral") {
        referralCalls += 1;
        return Promise.resolve(new Response(JSON.stringify({
          success: true,
          data: {
            invite_link: "https://example.com/register?ref=TRANSFER",
            rules: {
              signup_bonus: 5,
              inviter_signup_reward: 10,
              inviter_signup_reward_cap: 0,
              first_order_bonus: 10,
              rebate_rate: 0.1,
              add_on_excluded: true,
            },
            stats: {
              total_invited: 2,
              credits_earned: 12,
              pending_rewards: referralCalls === 1 ? 4 : 0,
            },
            recent_invitees: [],
          },
        }), { status: 200, headers: { "Content-Type": "application/json" } }));
      }
      return Promise.reject(new Error(`Unexpected request ${url}`));
    });
    globalThis.fetch = fetchMock;

    render(<Referral />);

    const transferButton = await screen.findByRole("button", { name: "Transfer to balance" });
    expect(transferButton).toBeEnabled();
    await userEvent.click(transferButton);

    expect(screen.getByRole("button", { name: "Transferring..." })).toBeDisabled();
    expect(fetchMock.mock.calls.filter(([input]) => input.toString() === "/api/v1/user/aff/transfer")).toHaveLength(1);

    await act(async () => {
      resolveTransfer(new Response(JSON.stringify({
        success: true,
        data: { transferred_quota: 4, balance: 24 },
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    });

    expect(await screen.findByRole("status")).toHaveTextContent("Transferred 4.000000 credits to your balance. New balance: 24.000000.");
    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([input]) => input.toString() === "/api/v1/console/referral")).toHaveLength(2);
    });
    expect(screen.getByRole("button", { name: "Transfer to balance" })).toBeDisabled();
  });

  it("enables transfer from available quota even when frozen pending rewards are zero", async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === "/api/v1/user/aff") {
        return Promise.resolve(new Response(JSON.stringify({
          success: true,
          data: { aff_quota: 4 },
        }), { status: 200, headers: { "Content-Type": "application/json" } }));
      }
      if (url === "/api/v1/console/referral") {
        return Promise.resolve(new Response(JSON.stringify({
          success: true,
          data: {
            invite_link: "https://example.com/register?ref=AVAILABLE",
            rules: {
              signup_bonus: 0,
              inviter_signup_reward: 0,
              inviter_signup_reward_cap: 0,
              first_order_bonus: 0,
              rebate_rate: 0.1,
              add_on_excluded: true,
            },
            stats: { total_invited: 1, credits_earned: 4, pending_rewards: 0 },
            recent_invitees: [],
          },
        }), { status: 200, headers: { "Content-Type": "application/json" } }));
      }
      return Promise.reject(new Error(`Unexpected request ${url}`));
    });
    globalThis.fetch = fetchMock;

    render(<Referral />);

    expect(await screen.findByText("Available Rewards")).toBeInTheDocument();
    expect(screen.getAllByText("4.000000")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Transfer to balance" })).toBeEnabled();
  });

  it("shows the backend error when an affiliate transfer fails", async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (input.toString() === "/api/v1/console/referral") {
        return Promise.resolve(new Response(JSON.stringify({
          success: true,
          data: {
            invite_link: "https://example.com/register?ref=FAILED",
            rules: {
              signup_bonus: 0,
              inviter_signup_reward: 0,
              inviter_signup_reward_cap: 0,
              first_order_bonus: 0,
              rebate_rate: 0,
              add_on_excluded: true,
            },
            stats: { total_invited: 1, credits_earned: 5, pending_rewards: 5 },
            recent_invitees: [],
          },
        }), { status: 200, headers: { "Content-Type": "application/json" } }));
      }
      if (input.toString() === "/api/v1/user/aff") {
        return Promise.resolve(new Response(JSON.stringify({
          success: true,
          data: { aff_quota: 5 },
        }), { status: 200, headers: { "Content-Type": "application/json" } }));
      }
      return Promise.resolve(new Response(JSON.stringify({
        success: false,
        message: "Transfer temporarily unavailable",
      }), { status: 409, headers: { "Content-Type": "application/json" } }));
    });
    globalThis.fetch = fetchMock;

    render(<Referral />);
    await userEvent.click(await screen.findByRole("button", { name: "Transfer to balance" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Transfer temporarily unavailable");
    expect(screen.getByRole("button", { name: "Transfer to balance" })).toBeEnabled();
  });

  it("keeps a successful transfer result when the follow-up refresh fails", async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
    let referralCalls = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === "/api/v1/console/referral") {
        referralCalls += 1;
        if (referralCalls > 1) return Promise.reject(new Error("refresh offline"));
        return Promise.resolve(new Response(JSON.stringify({
          success: true,
          data: {
            invite_link: "https://example.com/register?ref=REFRESH",
            rules: {
              signup_bonus: 0,
              inviter_signup_reward: 0,
              inviter_signup_reward_cap: 0,
              first_order_bonus: 0,
              rebate_rate: 0,
              add_on_excluded: true,
            },
            stats: { total_invited: 1, credits_earned: 3, pending_rewards: 0 },
            recent_invitees: [],
          },
        }), { status: 200, headers: { "Content-Type": "application/json" } }));
      }
      if (url === "/api/v1/user/aff") {
        return Promise.resolve(new Response(JSON.stringify({ success: true, data: { aff_quota: 3 } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      }
      if (url === "/api/v1/user/aff/transfer") {
        return Promise.resolve(new Response(JSON.stringify({
          success: true,
          data: { transferred_quota: 3, balance: 30 },
        }), { status: 200, headers: { "Content-Type": "application/json" } }));
      }
      return Promise.reject(new Error(`Unexpected request ${url}`));
    });
    globalThis.fetch = fetchMock;

    render(<Referral />);
    await userEvent.click(await screen.findByRole("button", { name: "Transfer to balance" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Transferred 3.000000 credits to your balance.");
    await waitFor(() => expect(screen.getByRole("button", { name: "Transfer to balance" })).toBeDisabled());
    expect(screen.getByRole("alert")).toHaveTextContent("Rewards were transferred, but referral data could not be refreshed.");
    expect(screen.getByRole("alert")).not.toHaveTextContent("Unable to transfer referral rewards.");
  });

  it("renders Japanese referral copy and updates messages without refetching", async () => {
    await act(async () => {
      await i18n.changeLanguage("ja");
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            invite_link: "https://example.com/register?ref=TOKYO-CODE",
            rules: {
              signup_bonus: 5,
              inviter_signup_reward: 10,
              inviter_signup_reward_cap: 25,
              first_order_bonus: 10,
              rebate_rate: 0.125,
              add_on_excluded: true,
            },
            stats: { total_invited: 1234, credits_earned: 31.5, pending_rewards: 4 },
            recent_invitees: [
              {
                id: 1,
                email: "to***@example.jp",
                joined_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
                status: "rewarded",
                earnings: 12.5,
              },
              {
                id: 2,
                email: "ne***@example.jp",
                joined_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
                status: "joined",
                earnings: 0,
              },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ));
    globalThis.fetch = fetchMock;

    render(<Referral />);

    expect(screen.getByText("紹介プログラムを読み込んでいます...")).toBeInTheDocument();
    await screen.findByRole("heading", { name: "紹介プログラム" });

    expect(screen.getByText("期間限定特典")).toHaveClass("console-inverted-label");
    expect(screen.getByText("1,234 人")).toBeInTheDocument();
    expect(screen.getAllByText(/12\.5%/).length).toBeGreaterThan(0);
    expect(screen.getByText("2時間前")).toBeInTheDocument();
    expect(screen.getByText("特典付与済み")).toBeInTheDocument();
    expect(screen.getByText("参加済み")).toBeInTheDocument();
    expect(screen.getByText("to***@example.jp")).toBeInTheDocument();
    expect(screen.getByText("https://example.com/register?ref=TOKYO-CODE")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "招待リンクをコピー" }));
    expect(writeText).toHaveBeenCalledWith("https://example.com/register?ref=TOKYO-CODE");
    expect(screen.getByRole("button", { name: "招待リンクをコピーしました" })).toBeInTheDocument();

    await act(async () => {
      await i18n.changeLanguage("zh-TW");
    });

    expect(screen.getByRole("heading", { name: "推薦計畫" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "已複製邀請連結" })).toBeInTheDocument();
    expect(screen.getByText("已發放獎勵")).toBeInTheDocument();
    expect(screen.getByText("已加入")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("localizes the empty invitee state", async () => {
    await act(async () => {
      await i18n.changeLanguage("ja");
    });
    globalThis.fetch = vi.fn().mockImplementation(() => Promise.resolve(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            invite_link: "https://example.com/register?ref=EMPTY",
            rules: {
              signup_bonus: 0,
              inviter_signup_reward: 0,
              inviter_signup_reward_cap: 0,
              first_order_bonus: 0,
              rebate_rate: 0,
              add_on_excluded: false,
            },
            stats: { total_invited: 0, credits_earned: 0, pending_rewards: 0 },
            recent_invitees: [],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ));

    render(<Referral />);

    expect(await screen.findByText("最近参加したユーザーはいません。")).toBeInTheDocument();
    expect(screen.getByText("追加クレジットも対象です。")).toBeInTheDocument();
    expect(screen.getByText("登録紹介特典には現在上限がありません。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "残高に振り替える" })).toBeDisabled();
  });

  it("localizes referral loading failures", async () => {
    await act(async () => {
      await i18n.changeLanguage("ja");
    });
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("private upstream detail"));

    render(<Referral />);

    expect(await screen.findByRole("heading", { name: "紹介プログラムを利用できません" })).toBeInTheDocument();
    expect(screen.getByText("紹介プログラムを読み込めませんでした。")).toBeInTheDocument();
    expect(screen.queryByText("private upstream detail")).not.toBeInTheDocument();
  });
});
