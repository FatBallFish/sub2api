import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import Pricing from "./Pricing";

describe("Pricing page", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders plan, top-up, and FAQ data from the public pricing API", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          plans: [
            {
              id: 91,
              name: "Builder",
              price: 29,
              currency: "USD",
              billing_period: "month",
              weekly_credits: 35,
              monthly_max_credits: 140,
              badge: "Teams",
              features: ["Priority routing", "Usage analytics"],
              recommended: true,
            },
          ],
          topups: [{ amount: 25, credits: 27.5, currency: "USD" }],
          faq: [{ question: "Do credits roll over?", answer: "Add-on credits do not reset." }],
        },
      }),
    });

    render(
      <MemoryRouter>
        <Pricing />
      </MemoryRouter>,
    );

    expect(screen.getByText("Loading pricing...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Builder")).toBeInTheDocument();
    });

    expect(screen.getByText("$29")).toBeInTheDocument();
    expect(screen.getByText("35.000000")).toBeInTheDocument();
    expect(screen.getByText("140.000000")).toBeInTheDocument();
    expect(screen.getByText("Get 27.500000")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /buy \$25 top-up, get 27\.500000 credits/i })).toHaveAttribute(
      "href",
      "/login?topup=25",
    );
    expect(screen.getByText("Do credits roll over?")).toBeInTheDocument();
    expect(screen.getByText("Add-on credits do not reset.")).toBeInTheDocument();
  });

  it("localizes Japanese controls and loading copy while preserving configured content", async () => {
    await i18n.changeLanguage("ja");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ success: true, data: {
        plans: [{ id: 1, name: "Backend Builder", price: 29, currency: "USD", billing_period: "month", weekly_credits: 1234.5, monthly_max_credits: 5000, features: ["Backend Feature"] }],
        topups: [], faq: [{ question: "Backend Question", answer: "Backend Answer" }],
      } }),
    });

    render(<MemoryRouter><Pricing /></MemoryRouter>);
    expect(screen.getByText("料金を読み込んでいます...")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "サブスクリプションとクレジット" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Backend Builder を選択" })).toBeInTheDocument();
    expect(screen.getByText("Backend Feature")).toBeInTheDocument();
    expect(screen.getByText("Backend Question")).toBeInTheDocument();
    expect(screen.getByText("1,234.500000")).toBeInTheDocument();
    expect(document.title).toBe("料金 | Mikiko CC");
  });

  it("uses the localized fallback when the pricing request rejects without an error message", async () => {
    await i18n.changeLanguage("zh-CN");
    globalThis.fetch = vi.fn().mockRejectedValue(null);

    render(<MemoryRouter><Pricing /></MemoryRouter>);

    expect(await screen.findByText("无法加载价格信息。")).toBeInTheDocument();
  });

  it("updates an already-rendered currency value when the active language changes", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: {
        plans: [{ id: 2, name: "Runtime Plan", price: 29, currency: "USD", billing_period: "month", weekly_credits: 10, monthly_max_credits: 40, features: [] }],
        topups: [],
        faq: [],
      } }),
    });

    render(<MemoryRouter><Pricing /></MemoryRouter>);
    const price = await screen.findByText("$29");

    await act(async () => {
      await i18n.changeLanguage("zh-TW");
    });

    expect(screen.getByText("US$29")).toBe(price);
  });
});
