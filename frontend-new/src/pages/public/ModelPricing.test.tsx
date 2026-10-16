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
  });

  it("renders plaza groups with paid and official prices", async () => {
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

    // paid in/out per million = 3 / 15 (paid and official columns both match this data)
    expect(screen.getAllByText("$3 / $15").length).toBeGreaterThan(0);
    expect(screen.getByText("Standard")).toBeInTheDocument();
    expect(screen.getByText("Group multiplier: 1.500x")).toBeInTheDocument();
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
      expect(screen.getByText("Current lowest price")).toBeInTheDocument();
    });
    expect(screen.getByText("claude-sonnet-4")).toBeInTheDocument();
    expect(screen.getByText("$3 / $15")).toBeInTheDocument();
    // groups/multipliers are not exposed in the limited view
    expect(screen.queryByText("Group multiplier")).not.toBeInTheDocument();
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
