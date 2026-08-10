import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import ModelPricing from "./ModelPricing";

describe("ModelPricing page", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders live and coming-soon products from the public model pricing API", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
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
            {
              id: "grok",
              label: "Grok",
              status: "coming_soon",
              description: "Pricing will be published after launch.",
              multiplier: "",
              rule_text: "",
              rows: [],
            },
          ],
        },
      }),
    });

    render(<ModelPricing />);

    expect(screen.getByText("Loading model pricing...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("claude-sonnet-4")).toBeInTheDocument();
    });

    expect(screen.getByText("$2.51 / $12.56")).toBeInTheDocument();
    expect(screen.getByText("$3 / $15")).toBeInTheDocument();
    expect(screen.getByText("$3.14 / $0.25")).toBeInTheDocument();
    expect(screen.getByText("0.837x official USD")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Grok" })).toBeInTheDocument();
  });

  it("renders console model pricing for the selected group", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          selected_group_id: 3,
          groups: [{ id: 3, name: "OpenAI Pro", platform: "openai", rate_multiplier: 0.6 }],
          products: [
            {
              id: "openai",
              label: "OpenAI",
              status: "live",
              description: "OpenAI family",
              multiplier: "0.6x",
              rule_text: "Actual price = official price x 0.6x",
              supported: true,
              rows: [
                {
                  model: "gpt-5.4",
                  input: { gateway: 1.5, official: 2.5 },
                  output: { gateway: 9, official: 15 },
                  cache_write: { gateway: 1.5, official: 2.5 },
                  cache_read: { gateway: 0.15, official: 0.25 },
                  availability: "available",
                  multiplier: 0.6,
                  multiplier_group_id: 3,
                  multiplier_group_name: "OpenAI Pro",
                },
              ],
            },
          ],
        },
      }),
    });
    globalThis.fetch = fetchMock;

    render(<ModelPricing isConsole />);

    await waitFor(() => {
      expect(screen.getByText("gpt-5.4")).toBeInTheDocument();
    });

    expect(screen.getByText("$1.50 / $9")).toBeInTheDocument();
    expect(screen.getByText("$2.50 / $15")).toBeInTheDocument();
    expect(screen.getByText("$1.50 / $0.15")).toBeInTheDocument();
    expect(screen.getByText("OpenAI Pro · 0.600x")).toBeInTheDocument();
    expect(screen.getByText("Official Rate × Multiplier × Tokens")).toHaveClass("console-formula-code");
    expect(screen.getByText("How we calculate consumption").closest(".console-formula-note")).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/model-pricing", expect.any(Object));
  });

  it("renders unsupported models and per-request tier prices without token columns", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          selected_group_id: 3,
          groups: [{ id: 3, name: "Image Pro", platform: "openai", rate_multiplier: 0.42 }],
          products: [{
            id: "image",
            label: "Image",
            status: "live",
            description: "Image models",
            supported: true,
            rows: [
              {
                model: "gpt-image-2",
                label: "GPT Image 2",
                billing_mode: "image",
                availability: "available",
                multiplier: 0.42,
                request_prices: [
                  { label: "1K", price: { official: 0.02, gateway: 0.0084 } },
                  { label: "4K", price: { official: 0.08, gateway: 0.0336 } },
                ],
              },
              {
                model: "gpt-5.4",
                label: "GPT 5.4",
                billing_mode: "token",
                availability: "unsupported",
                unsupported_reason: "This model is not supported by the selected group.",
              },
            ],
          }],
        },
      }),
    });

    render(<ModelPricing isConsole />);

    expect(await screen.findByText("GPT Image 2")).toBeInTheDocument();
    expect(screen.getByText("1K")).toBeInTheDocument();
    expect(screen.getByText("$0.01 / request")).toBeInTheDocument();
    expect(screen.getByText("4K")).toBeInTheDocument();
    expect(screen.getByText("Not supported by this group")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /official \(in\/out\)/i })).not.toBeInTheDocument();
  });

  it("localizes Traditional Chinese table and unsupported labels while preserving model data", async () => {
    await i18n.changeLanguage("zh-TW");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ success: true, data: {
        selected_group_id: 8,
        groups: [{ id: 8, name: "Backend Group", platform: "openai", rate_multiplier: 0.5 }],
        products: [{ id: "custom", label: "Backend Product", status: "live", description: "Backend Description", multiplier: "0.5x", rule_text: "Backend Rule", supported: true, rows: [
          { model: "backend-model", availability: "unsupported", unsupported_reason: "Backend unsupported reason" },
        ] }],
      } }),
    });

    render(<ModelPricing isConsole />);
    expect(screen.getByText("正在載入模型價格...")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "模型價格" })).toBeInTheDocument();
    expect(screen.getByText("不支援此模型")).toBeInTheDocument();
    expect(screen.getByText("backend-model")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Backend Group · openai · 0.500x" })).toBeInTheDocument();
    expect(document.title).toBe("模型價格 | Mikiko CC");
  });
});
