import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
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
});
