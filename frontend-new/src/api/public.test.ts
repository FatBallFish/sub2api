import { afterEach, describe, expect, it, vi } from "vitest";
import { getPublicPricing } from "./public";

describe("public API", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads public pricing plans and top-ups", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          plans: [
            {
              id: 10,
              name: "Builder",
              price: 29,
              currency: "USD",
              billing_period: "month",
              weekly_credits: 35,
              monthly_max_credits: 140,
              features: ["Priority routing"],
            },
          ],
          topups: [{ amount: 25, credits: 27.5, currency: "USD" }],
          faq: [{ question: "What resets?", answer: "Plan credits reset weekly." }],
        },
      }),
    });
    globalThis.fetch = fetchMock;

    await expect(getPublicPricing()).resolves.toMatchObject({
      plans: [{ name: "Builder", weekly_credits: 35 }],
      topups: [{ amount: 25, credits: 27.5 }],
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/public/pricing", expect.any(Object));
  });


});
