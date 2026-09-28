import { afterEach, describe, expect, it, vi } from "vitest";
import { getConsoleModelPricing, getModelPricing, getPublicPricing } from "./public";

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

  it("loads model pricing products", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          products: [
            {
              id: "claude",
              label: "Claude",
              status: "live",
              description: "Claude Code compatible routing",
              multiplier: "0.837x official USD",
              rule_text: "Gateway USD price = official USD rate x 0.837",
              rows: [
                {
                  model: "claude-sonnet-4",
                  input: { gateway: 2.51, official: 3 },
                  output: { gateway: 12.56, official: 15 },
                  cache_write: { gateway: 3.14, official: 3.75 },
                  cache_read: { gateway: 0.25, official: 0.3 },
                  availability: "available",
                },
              ],
            },
          ],
        },
      }),
    });
    globalThis.fetch = fetchMock;

    await expect(getModelPricing()).resolves.toMatchObject({
      products: [{ id: "claude", rows: [{ model: "claude-sonnet-4" }] }],
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/public/model-pricing", expect.any(Object));
  });

  it("loads console model pricing with selected group", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          selected_group_id: 2,
          groups: [{ id: 2, name: "Pro", rate_multiplier: 0.75 }],
          products: [],
        },
      }),
    });
    globalThis.fetch = fetchMock;

    await expect(getConsoleModelPricing(2)).resolves.toMatchObject({
      selected_group_id: 2,
      groups: [{ name: "Pro" }],
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/model-pricing?group_id=2", expect.any(Object));
  });
});
