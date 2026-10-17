import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import ModelPricing from "./ModelPricing";

function plazaResponse(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    data: {
      description: "",
      groups: [
        {
          id: 1,
          name: "Standard",
          description: "Standard group",
          platform: "anthropic",
          subscription_type: "standard",
          rate_multiplier: 1.5,
          peak_rate_enabled: false,
          peak_start: "",
          peak_end: "",
          peak_rate_multiplier: 1,
          is_exclusive: false,
          image_rate_independent: false,
          image_rate_multiplier: 1,
          video_rate_independent: false,
          video_rate_multiplier: 1,
          long_context_pricing_enabled: true,
          models: [
            {
              name: "claude-sonnet-4",
              platform: "anthropic",
              pricing: {
                billing_mode: "token",
                input_price: 0.000003,
                output_price: 0.000015,
                cache_write_price: 0.00000375,
                cache_read_price: 0.0000003,
                image_input_price: null,
                image_output_price: null,
                per_request_price: null,
                intervals: [],
              },
              official_pricing: {
                input_price: 0.000003,
                output_price: 0.000015,
                cache_write_price: 0.00000375,
                cache_read_price: 0.0000003,
              },
            },
          ],
        },
      ],
      ...overrides,
    },
  };
}

describe("ModelPricing page", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  function signInForTest() {
    localStorage.setItem("auth_token", `test-token-${Math.random()}`);
    localStorage.setItem(
      "auth_user",
      JSON.stringify({ id: 1, email: "tester@example.com", name: "Tester", role: "user" }),
    );
  }

  it("renders plaza groups with paid and official prices when signed in", async () => {
    signInForTest();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => plazaResponse(),
    });

    render(<ModelPricing />);

    expect(screen.getByText("Loading model pricing...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("claude-sonnet-4")).toBeInTheDocument();
    });

    // paid = base × group rate (1.5x): 4.5 / 22.5 per million; official stays 3 / 15
    expect(screen.getByText("$4.50")).toBeInTheDocument();
    expect(screen.getByText("$22.50")).toBeInTheDocument();
    expect(screen.getAllByText("$3.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$15.00").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Standard", level: 3 })).toBeInTheDocument();
    expect(screen.getByText("Group multiplier: 1.5x")).toBeInTheDocument();
  });

  it("shows the anonymous lowest-price summary when the plaza requires auth", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () =>
        plazaResponse({
          groups: [],
          limited: true,
          summary: [
            { name: "claude-sonnet-4", platform: "anthropic", input_price: 0.000003, output_price: 0.000015 },
          ],
        }),
    });

    render(<ModelPricing />);

    await waitFor(() => {
      expect(screen.getByText("Site price (discounted)")).toBeInTheDocument();
    });
    expect(screen.getByText("claude-sonnet-4")).toBeInTheDocument();
    expect(screen.getByText("$3.00")).toBeInTheDocument();
    expect(screen.getByText("$15.00")).toBeInTheDocument();
    // groups/multipliers are not exposed in the anonymous view
    expect(screen.queryByText("Group multiplier")).not.toBeInTheDocument();
    expect(screen.queryByText("Multiplier")).not.toBeInTheDocument();
  });

  it("renders the anonymous flat view with lowest-rate prices when signed out", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () =>
        plazaResponse({
          groups: [
            {
              id: 1,
              name: "Expensive",
              description: "",
              platform: "anthropic",
              subscription_type: "standard",
              rate_multiplier: 1.5,
              peak_rate_enabled: false,
              peak_start: "",
              peak_end: "",
              peak_rate_multiplier: 1,
              is_exclusive: false,
              image_rate_independent: false,
              image_rate_multiplier: 1,
              video_rate_independent: false,
              video_rate_multiplier: 1,
              long_context_pricing_enabled: true,
              models: [
                {
                  name: "claude-sonnet-4",
                  platform: "anthropic",
                  pricing: {
                    billing_mode: "token",
                    input_price: 0.000003,
                    output_price: 0.000015,
                    cache_write_price: 0.00000375,
                    cache_read_price: 0.0000003,
                    image_input_price: null,
                    image_output_price: null,
                    per_request_price: null,
                    intervals: [],
                  },
                  official_pricing: null,
                },
              ],
            },
            {
              id: 2,
              name: "Cheap",
              description: "",
              platform: "anthropic",
              subscription_type: "standard",
              rate_multiplier: 0.5,
              peak_rate_enabled: false,
              peak_start: "",
              peak_end: "",
              peak_rate_multiplier: 1,
              is_exclusive: false,
              image_rate_independent: false,
              image_rate_multiplier: 1,
              video_rate_independent: false,
              video_rate_multiplier: 1,
              long_context_pricing_enabled: true,
              models: [
                {
                  name: "claude-sonnet-4",
                  platform: "anthropic",
                  pricing: {
                    billing_mode: "token",
                    input_price: 0.000003,
                    output_price: 0.000015,
                    cache_write_price: 0.00000375,
                    cache_read_price: 0.0000003,
                    image_input_price: null,
                    image_output_price: null,
                    per_request_price: null,
                    intervals: [],
                  },
                  official_pricing: {
                    input_price: 0.000003,
                    output_price: 0.000015,
                    cache_write_price: 0.00000375,
                    cache_read_price: 0.0000003,
                  },
                },
              ],
            },
          ],
        }),
    });

    render(<ModelPricing />);

    await waitFor(() => {
      expect(screen.getByText("Site price (discounted)")).toBeInTheDocument();
    });
    // 站点价取倍率最低的分组（0.5x）：1.5 / 7.5 per million
    expect(screen.getByText("$1.50")).toBeInTheDocument();
    expect(screen.getByText("$7.50")).toBeInTheDocument();
    expect(screen.getByText("$1.875 / $0.15")).toBeInTheDocument();
    // 不暴露分组与倍率
    expect(screen.queryByRole("heading", { name: "Cheap" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Expensive" })).not.toBeInTheDocument();
    expect(screen.queryByText("Group multiplier")).not.toBeInTheDocument();
    expect(screen.queryByText("Multiplier")).not.toBeInTheDocument();
    // 仅平台筛选（无分组/倍率筛选行）
    expect(screen.getByText("Platform")).toBeInTheDocument();
    expect(screen.queryByText("Group")).not.toBeInTheDocument();
  });

  it("shows the not-available state when the plaza is disabled (404)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ success: false, code: 404, message: "not found" }),
    });

    render(<ModelPricing />);

    await waitFor(() => {
      expect(screen.getByText("Model pricing is not available right now.")).toBeInTheDocument();
    });
  });
});
