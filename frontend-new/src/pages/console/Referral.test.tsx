import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import Referral from "./Referral";

describe("Referral", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders referral data from the console BFF endpoint and copies the invite link", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const fetchMock = vi.fn().mockResolvedValue(
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
    );
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

    await userEvent.click(screen.getByRole("button", { name: /copy invite link/i }));

    expect(writeText).toHaveBeenCalledWith("https://example.com/register?ref=pro-ref");
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/console/referral", expect.any(Object));
  });
});
