import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Billing from "./Billing";

function checkoutInfoResponse(methods = ["stripe"]) {
  return new Response(
    JSON.stringify({
      success: true,
      data: {
        methods: Object.fromEntries(methods.map((method) => [method, { payment_type: method, currency: "USD" }])),
        global_min: 1,
        global_max: 500,
        balance_recharge_multiplier: 1.05,
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("Billing", () => {
  let openMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    openMock = vi.spyOn(window, "open").mockImplementation(() => null);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders wallet, global plan, add-ons, and activity from the billing BFF endpoint", async () => {
    const fetchMock = vi.fn((url: RequestInfo | URL) => {
      const path = String(url);
      if (path === "/api/v1/payment/checkout-info") return Promise.resolve(checkoutInfoResponse());
      if (path === "/api/v1/console/billing") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              data: {
                wallet: { available_balance: 210.756789, add_on_credits: 42.5, currency: "USD" },
                active_global_plan: {
                  id: 9,
                  plan_id: 102,
                  name: "Pro",
                  status: "active",
                  quota_limit: 60,
                  quota_used: 30,
                  quota_remaining: 30,
                  period_start: "2026-06-15T00:00:00Z",
                  period_end: "2026-06-22T00:00:00Z",
                  expires_at: "2026-07-15T00:00:00Z",
                },
                plans: [
                  {
                    id: 101,
                    name: "Lite",
                    price: 19,
                    currency: "USD",
                    billing_period: "month",
                    weekly_credits: 20,
                    monthly_max_credits: 80,
                    features: ["Standard speed"],
                  },
                  {
                    id: 102,
                    name: "Pro",
                    price: 49,
                    currency: "USD",
                    billing_period: "month",
                    quota_period: "month",
                    quota_period_label: "Monthly Credits",
                    quota_per_period_usd: 240.123456,
                    weekly_credits: 60,
                    monthly_max_credits: 240,
                    features: ["Priority routing"],
                  },
                ],
                add_ons: [
                  { amount: 10, credits: 10.5, currency: "USD", preset: true },
                  { amount: 25, credits: 27.5, currency: "USD", preset: true },
                ],
                payment_methods: [],
                activity: [
                  {
                    id: 77,
                    date: "2026-06-15T00:00:00Z",
                    reference: "ORD-REAL-77",
                    type: "global_plan",
                    label: "Pro Subscription",
                    amount: 49,
                    currency: "USD",
                    status: "completed",
                    receipt_url: "/api/v1/payment/orders/77/receipt",
                  },
                ],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      return Promise.reject(new Error(`Unexpected request ${path}`));
    });
    globalThis.fetch = fetchMock;

    render(<Billing />);

    expect(screen.getByText("Loading billing...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("210.756789")).toBeInTheDocument();
    });

    expect(screen.getByText("Includes 42.500000 add-on credits")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getAllByText("Pro").length).toBeGreaterThan(0);
    expect(screen.getByText("Monthly Credits")).toBeInTheDocument();
    expect(screen.getByText("240.123456")).toBeInTheDocument();
    expect(screen.getByText("240.123456")).toHaveClass("console-inverted-strong");
    expect(screen.getByText("240.123456").closest(".console-inverted-panel")).not.toBeNull();
    expect(screen.getByText("ORD-REAL-77")).toBeInTheDocument();
    expect(screen.getByText("$25")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/console/billing", expect.any(Object));
  });

  it("creates a balance top-up order from the selected add-on amount", async () => {
    const fetchMock = vi.fn((url: RequestInfo | URL) => {
      const path = String(url);
      if (path === "/api/v1/payment/checkout-info") return Promise.resolve(checkoutInfoResponse());
      if (path === "/api/v1/console/billing") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              data: {
                wallet: { available_balance: 0, add_on_credits: 0, currency: "USD" },
                plans: [],
                add_ons: [
                  { amount: 10, credits: 10.5, currency: "USD", preset: true },
                  { amount: 25, credits: 27.5, currency: "USD", preset: true },
                ],
                payment_methods: [{ type: "stripe", available: true }],
                activity: [],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }

      if (path === "/api/v1/payment/orders") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              data: {
                order_id: 501,
                amount: 25,
                pay_amount: 25,
                currency: "USD",
                fee_rate: 0,
                payment_type: "stripe",
                pay_url: "https://checkout.example/pay/501",
                expires_at: "2026-06-18T10:00:00Z",
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }

      return Promise.reject(new Error(`Unexpected request ${path}`));
    });
    globalThis.fetch = fetchMock;

    render(<Billing />);

    await waitFor(() => {
      expect(screen.getByText("$25")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /\$2527\.500000 credits/i }));
    fireEvent.click(screen.getByRole("button", { name: /create payment order/i }));

    await waitFor(() => {
      expect(screen.getByText("Order #501 created")).toBeInTheDocument();
    });

    expect(
      screen
        .getAllByRole("link", { name: /continue payment/i })
        .some((link) => link.getAttribute("href") === "https://checkout.example/pay/501"),
    ).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/payment/orders",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          amount: 25,
          amount_currency: "USD",
          payment_type: "stripe",
          order_type: "balance",
          payment_source: "hosted_redirect",
          return_url: `${window.location.origin}/payment/result`,
          is_mobile: false,
        }),
      }),
    );
  });

  it("refreshes wallet and order activity immediately after creating a payment order", async () => {
    let billingLoads = 0;
    const fetchMock = vi.fn((url: RequestInfo | URL) => {
      const path = String(url);
      if (path === "/api/v1/payment/checkout-info") return Promise.resolve(checkoutInfoResponse());
      if (path === "/api/v1/console/billing") {
        billingLoads += 1;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              data: {
                wallet: { available_balance: 0, add_on_credits: 0, currency: "USD" },
                plans: [],
                add_ons: [{ amount: 10, credits: 10.5, currency: "USD", preset: true }],
                payment_methods: [{ type: "stripe", available: true }],
                activity: billingLoads > 1 ? [
                  {
                    id: 502,
                    date: "2026-06-18T10:00:00Z",
                    reference: "sub2_new_order",
                    type: "balance",
                    label: "Add-on Credits",
                    amount: 10,
                    currency: "USD",
                    pay_amount: 10,
                    payment_currency: "USD",
                    status: "PENDING",
                    pay_url: "https://checkout.example/pay/502",
                  },
                ] : [],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }

      if (path === "/api/v1/payment/orders") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              data: {
                order_id: 502,
                out_trade_no: "sub2_new_order",
                amount: 10,
                pay_amount: 10,
                currency: "USD",
                fee_rate: 0,
                payment_type: "stripe",
                pay_url: "https://checkout.example/pay/502",
                status: "PENDING",
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }

      return Promise.reject(new Error(`Unexpected request ${path}`));
    });
    globalThis.fetch = fetchMock;

    render(<Billing />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /create payment order/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /create payment order/i }));

    await waitFor(() => {
      expect(screen.getByText("sub2_new_order")).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/console/billing", expect.any(Object));
  });

  it("opens hosted redirect payments in a new tab and monitors the created order", async () => {
    const fetchMock = vi.fn((url: RequestInfo | URL) => {
      const path = String(url);
      if (path === "/api/v1/payment/checkout-info") return Promise.resolve(checkoutInfoResponse());
      if (path === "/api/v1/console/billing") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              data: {
                wallet: { available_balance: 0, add_on_credits: 0, currency: "USD" },
                plans: [],
                add_ons: [{ amount: 10, credits: 10.5, currency: "USD", preset: true }],
                payment_methods: [{ type: "stripe", available: true }],
                activity: [],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }

      if (path === "/api/v1/payment/orders") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              data: {
                order_id: 502,
                out_trade_no: "sub2_redirect_502",
                amount: 10,
                pay_amount: 10,
                currency: "USD",
                fee_rate: 0,
                payment_type: "stripe",
                pay_url: "https://checkout.example/pay/502",
                status: "PENDING",
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }

      if (path === "/api/v1/payment/orders/verify") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              data: {
                id: 502,
                amount: 10,
                pay_amount: 10,
                fee_rate: 0,
                currency: "USD",
                payment_type: "stripe",
                out_trade_no: "sub2_redirect_502",
                status: "COMPLETED",
                order_type: "balance",
                created_at: "2026-06-18T10:00:00Z",
                expires_at: "2026-06-18T11:00:00Z",
                refund_amount: 0,
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }

      return Promise.reject(new Error(`Unexpected request ${path}`));
    });
    globalThis.fetch = fetchMock;

    render(<Billing />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /create payment order/i })).toBeInTheDocument();
    });

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: /create payment order/i }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(openMock).toHaveBeenCalledWith("https://checkout.example/pay/502", "_blank", "noopener,noreferrer");
    expect(screen.getByRole("dialog", { name: /payment page opened/i })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/payment/orders/verify",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ out_trade_no: "sub2_redirect_502" }),
      }),
    );
    expect(screen.getByText(/payment confirmed/i)).toBeInTheDocument();
  });

  it("creates a custom top-up order with the selected checkout payment method", async () => {
    const fetchMock = vi.fn((url: RequestInfo | URL) => {
      const path = String(url);
      if (path === "/api/v1/payment/checkout-info") return Promise.resolve(checkoutInfoResponse(["alipay", "stripe"]));
      if (path === "/api/v1/console/billing") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              data: {
                wallet: { available_balance: 0, add_on_credits: 0, currency: "USD" },
                plans: [],
                add_ons: [{ amount: 10, credits: 10.5, currency: "USD", preset: true }],
                payment_methods: [{ type: "stripe", available: true }],
                activity: [],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }

      if (path === "/api/v1/payment/orders") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              data: {
                order_id: 601,
                amount: 33,
                pay_amount: 33,
                currency: "USD",
                fee_rate: 0,
                payment_type: "stripe",
                pay_url: "https://checkout.example/pay/601",
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }

      return Promise.reject(new Error(`Unexpected request ${path}`));
    });
    globalThis.fetch = fetchMock;

    render(<Billing />);

    await waitFor(() => {
      expect(screen.getByText("Payment Preview")).toBeInTheDocument();
    });
    expect(screen.getByText("Payment Preview").closest(".console-inverted-panel")).not.toBeNull();
    expect(screen.getByRole("button", { name: /create payment order/i })).toHaveClass("console-inverted-action");

    fireEvent.change(screen.getByPlaceholderText("Enter amount"), { target: { value: "33" } });
    fireEvent.change(screen.getByLabelText(/payment method/i), { target: { value: "stripe" } });
    fireEvent.click(screen.getByRole("button", { name: /create payment order/i }));

    await waitFor(() => {
      expect(screen.getByText("Order #601 created")).toBeInTheDocument();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/payment/orders",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          amount: 33,
          amount_currency: "USD",
          payment_type: "stripe",
          order_type: "balance",
          payment_source: "hosted_redirect",
          return_url: `${window.location.origin}/payment/result`,
          is_mobile: false,
        }),
      }),
    );
  });

  it("creates a subscription order when choosing a plan", async () => {
    const fetchMock = vi.fn((url: RequestInfo | URL) => {
      const path = String(url);
      if (path === "/api/v1/payment/checkout-info") return Promise.resolve(checkoutInfoResponse());
      if (path === "/api/v1/console/billing") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              data: {
                wallet: { available_balance: 15, add_on_credits: 15, currency: "USD" },
                active_global_plan: undefined,
                plans: [
                  {
                    id: 102,
                    name: "Pro",
                    price: 49,
                    currency: "USD",
                    billing_period: "month",
                    weekly_credits: 60,
                    monthly_max_credits: 240,
                    features: ["Priority routing"],
                  },
                ],
                add_ons: [],
                payment_methods: [{ type: "stripe", available: true }],
                activity: [],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }

      if (path === "/api/v1/payment/orders") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              data: {
                order_id: 702,
                amount: 49,
                pay_amount: 49,
                currency: "USD",
                fee_rate: 0,
                payment_type: "stripe",
                pay_url: "https://checkout.example/pay/702",
                expires_at: "2026-06-18T10:00:00Z",
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }

      return Promise.reject(new Error(`Unexpected request ${path}`));
    });
    globalThis.fetch = fetchMock;

    render(<Billing />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /upgrade to pro/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /upgrade to pro/i }));

    await waitFor(() => {
      expect(screen.getByText("Order #702 created")).toBeInTheDocument();
    });

    expect(
      screen
        .getAllByRole("link", { name: /continue payment/i })
        .some((link) => link.getAttribute("href") === "https://checkout.example/pay/702"),
    ).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/payment/orders",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          amount: 49,
          amount_currency: "USD",
          payment_type: "stripe",
          order_type: "global_plan",
          plan_id: 102,
          payment_source: "hosted_redirect",
          return_url: `${window.location.origin}/payment/result`,
          is_mobile: false,
        }),
      }),
    );
  });

  it("quotes and creates a global plan upgrade order when an active plan exists", async () => {
    const fetchMock = vi.fn((url: RequestInfo | URL) => {
      const path = String(url);
      if (path === "/api/v1/payment/checkout-info") return Promise.resolve(checkoutInfoResponse());
      if (path === "/api/v1/console/billing") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              data: {
                wallet: { available_balance: 15, add_on_credits: 15, currency: "USD" },
                active_global_plan: {
                  id: 90,
                  plan_id: 101,
                  name: "Lite",
                  status: "active",
                  quota_limit: 20,
                  quota_used: 4,
                  quota_remaining: 16,
                  period_start: "2026-06-15T00:00:00Z",
                  period_end: "2026-06-22T00:00:00Z",
                  expires_at: "2026-07-15T00:00:00Z",
                },
                plans: [
                  {
                    id: 101,
                    name: "Lite",
                    price: 19,
                    currency: "USD",
                    billing_period: "month",
                    weekly_credits: 20,
                    monthly_max_credits: 80,
                    features: ["Standard speed"],
                  },
                  {
                    id: 102,
                    name: "Pro",
                    price: 49,
                    currency: "USD",
                    billing_period: "month",
                    weekly_credits: 60,
                    monthly_max_credits: 240,
                    features: ["Priority routing"],
                  },
                ],
                add_ons: [],
                payment_methods: [{ type: "stripe", available: true }],
                activity: [],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }

      if (path === "/api/v1/payment/global-plans/upgrade-quote") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              data: {
                current_subscription_id: 90,
                from_plan_id: 101,
                to_plan_id: 102,
                remaining_seconds: 1728000,
                cycle_seconds: 2592000,
                current_plan_price: 19,
                target_plan_price: 49,
                upgrade_price: 20,
                currency: "USD",
                expires_at: "2026-07-15T00:00:00Z",
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }

      if (path === "/api/v1/payment/orders") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              data: {
                order_id: 803,
                amount: 20,
                pay_amount: 20,
                currency: "USD",
                fee_rate: 0,
                payment_type: "stripe",
                pay_url: "https://checkout.example/pay/803",
                expires_at: "2026-06-18T10:00:00Z",
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }

      return Promise.reject(new Error(`Unexpected request ${path}`));
    });
    globalThis.fetch = fetchMock;

    render(<Billing />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /upgrade to pro/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /upgrade to pro/i }));

    await waitFor(() => {
      expect(screen.getByText("Order #803 created")).toBeInTheDocument();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/payment/global-plans/upgrade-quote",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ target_plan_id: 102 }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/payment/orders",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          amount: 20,
          amount_currency: "USD",
          payment_type: "stripe",
          order_type: "global_plan_upgrade",
          plan_id: 102,
          payment_source: "hosted_redirect",
          return_url: `${window.location.origin}/payment/result`,
          is_mobile: false,
        }),
      }),
    );
  });

  it("blocks lower-tier global plans when the account already has a higher active plan", async () => {
    const fetchMock = vi.fn((url: RequestInfo | URL) => {
      const path = String(url);
      if (path === "/api/v1/payment/checkout-info") return Promise.resolve(checkoutInfoResponse());
      if (path === "/api/v1/console/billing") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              data: {
                wallet: { available_balance: 15, add_on_credits: 15, currency: "USD" },
                active_global_plan: {
                  id: 90,
                  plan_id: 102,
                  name: "Pro",
                  status: "active",
                  tier_rank: 20,
                  quota_limit: 60,
                  quota_used: 4,
                  quota_remaining: 56,
                  period_start: "2026-06-15T00:00:00Z",
                  period_end: "2026-06-22T00:00:00Z",
                  expires_at: "2026-07-15T00:00:00Z",
                },
                plans: [
                  {
                    id: 101,
                    name: "Lite",
                    price: 19,
                    currency: "USD",
                    billing_period: "month",
                    plan_scope: "global",
                    tier_rank: 10,
                    weekly_credits: 20,
                    monthly_max_credits: 80,
                    features: ["Standard speed"],
                  },
                  {
                    id: 102,
                    name: "Pro",
                    price: 49,
                    currency: "USD",
                    billing_period: "month",
                    plan_scope: "global",
                    tier_rank: 20,
                    weekly_credits: 60,
                    monthly_max_credits: 240,
                    features: ["Priority routing"],
                  },
                  {
                    id: 103,
                    name: "Ultra",
                    price: 89,
                    currency: "USD",
                    billing_period: "month",
                    plan_scope: "global",
                    tier_rank: 30,
                    weekly_credits: 120,
                    monthly_max_credits: 480,
                    features: ["Dedicated routing"],
                  },
                ],
                add_ons: [],
                payment_methods: [{ type: "stripe", available: true }],
                activity: [],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      return Promise.reject(new Error(`Unexpected request ${path}`));
    });
    globalThis.fetch = fetchMock;

    render(<Billing />);

    await waitFor(() => {
      expect(screen.getByText("Lite")).toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: /upgrade to lite/i })).not.toBeInTheDocument();
    expect(screen.getByText(/included in current plan/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /upgrade to ultra/i })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith("/api/v1/payment/orders", expect.anything());
  });

  it("keeps global plan tier blocking scoped to the same category and renders group scope copy", async () => {
    const fetchMock = vi.fn((url: RequestInfo | URL) => {
      const path = String(url);
      if (path === "/api/v1/payment/checkout-info") return Promise.resolve(checkoutInfoResponse());
      if (path === "/api/v1/console/billing") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              data: {
                wallet: { available_balance: 15, add_on_credits: 15, currency: "USD" },
                active_global_plans: [
                  {
                    id: 90,
                    plan_id: 102,
                    name: "Pro",
                    plan_category: "default",
                    status: "active",
                    tier_rank: 20,
                    quota_limit: 60,
                    quota_used: 4,
                    quota_remaining: 56,
                    period_start: "2026-06-15T00:00:00Z",
                    period_end: "2026-06-22T00:00:00Z",
                    expires_at: "2026-07-15T00:00:00Z",
                  },
                ],
                plans: [
                  {
                    id: 101,
                    name: "Lite",
                    price: 19,
                    currency: "USD",
                    billing_period: "month",
                    plan_scope: "global",
                    plan_category: "default",
                    tier_rank: 10,
                    weekly_credits: 20,
                    monthly_max_credits: 80,
                    features: ["Standard speed"],
                  },
                  {
                    id: 201,
                    name: "Image Lite",
                    price: 9,
                    currency: "USD",
                    billing_period: "month",
                    plan_scope: "global",
                    plan_category: "image",
                    applicable_group_mode: "whitelist",
                    applicable_groups: [{ id: 66, name: "Gemini Image", platform: "gemini" }],
                    tier_rank: 1,
                    weekly_credits: 10,
                    monthly_max_credits: 40,
                    features: ["Image routing"],
                  },
                ],
                add_ons: [],
                payment_methods: [{ type: "stripe", available: true }],
                activity: [],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      return Promise.reject(new Error(`Unexpected request ${path}`));
    });
    globalThis.fetch = fetchMock;

    render(<Billing />);

    await waitFor(() => {
      expect(screen.getByText("Image Lite")).toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: /upgrade to lite/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /upgrade to image lite/i })).toBeInTheDocument();
    expect(screen.getByText("Include Group")).toBeInTheDocument();
    expect(screen.getByText("gemini · Gemini Image")).toBeInTheDocument();
  });

  it("blocks lower-tier global plans by matching the active plan tier from the plan list", async () => {
    const fetchMock = vi.fn((url: RequestInfo | URL) => {
      const path = String(url);
      if (path === "/api/v1/payment/checkout-info") return Promise.resolve(checkoutInfoResponse());
      if (path === "/api/v1/console/billing") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              data: {
                wallet: { available_balance: 15, add_on_credits: 15, currency: "USD" },
                active_global_plan: {
                  id: 90,
                  plan_id: 102,
                  name: "Pro",
                  status: "active",
                  quota_limit: 60,
                  quota_used: 4,
                  quota_remaining: 56,
                  period_start: "2026-06-15T00:00:00Z",
                  period_end: "2026-06-22T00:00:00Z",
                  expires_at: "2026-07-15T00:00:00Z",
                },
                plans: [
                  {
                    id: 101,
                    name: "Lite",
                    price: 19,
                    currency: "USD",
                    billing_period: "month",
                    plan_scope: "global",
                    tier_rank: 10,
                    weekly_credits: 20,
                    monthly_max_credits: 80,
                    features: ["Standard speed"],
                  },
                  {
                    id: 102,
                    name: "Pro",
                    price: 49,
                    currency: "USD",
                    billing_period: "month",
                    plan_scope: "global",
                    tier_rank: 20,
                    weekly_credits: 60,
                    monthly_max_credits: 240,
                    features: ["Priority routing"],
                  },
                ],
                add_ons: [],
                payment_methods: [{ type: "stripe", available: true }],
                activity: [],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      return Promise.reject(new Error(`Unexpected request ${path}`));
    });
    globalThis.fetch = fetchMock;

    render(<Billing />);

    await waitFor(() => {
      expect(screen.getByText("Lite")).toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: /upgrade to lite/i })).not.toBeInTheDocument();
    expect(screen.getByText(/included in current plan/i)).toBeInTheDocument();
  });

  it("labels group plans and creates subscription orders for them", async () => {
    const fetchMock = vi.fn((url: RequestInfo | URL) => {
      const path = String(url);
      if (path === "/api/v1/payment/checkout-info") return Promise.resolve(checkoutInfoResponse());
      if (path === "/api/v1/console/billing") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              data: {
                wallet: { available_balance: 15, add_on_credits: 15, currency: "USD" },
                active_global_plan: {
                  id: 90,
                  plan_id: 101,
                  name: "Lite",
                  status: "active",
                  quota_limit: 20,
                  quota_used: 4,
                  quota_remaining: 16,
                  period_start: "2026-06-15T00:00:00Z",
                  period_end: "2026-06-22T00:00:00Z",
                  expires_at: "2026-07-15T00:00:00Z",
                },
                plans: [
                  {
                    id: 303,
                    name: "Claude Team",
                    price: 29,
                    currency: "USD",
                    billing_period: "22 days",
                    plan_scope: "group",
                    group_id: 66,
                    group_platform: "anthropic",
                    group_name: "Claude Subscription",
                    weekly_credits: 29,
                    monthly_max_credits: 116,
                    features: ["Claude routing"],
                  },
                ],
                add_ons: [],
                payment_methods: [{ type: "stripe", available: true }],
                activity: [],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }

      if (path === "/api/v1/payment/orders") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              data: {
                order_id: 904,
                amount: 29,
                pay_amount: 29,
                currency: "USD",
                fee_rate: 0,
                payment_type: "stripe",
                pay_url: "https://checkout.example/pay/904",
                expires_at: "2026-06-18T10:00:00Z",
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }

      return Promise.reject(new Error(`Unexpected request ${path}`));
    });
    globalThis.fetch = fetchMock;

    render(<Billing />);

    await waitFor(() => {
      expect(screen.getByLabelText(/group plan for anthropic · claude subscription/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /upgrade to claude team/i }));

    await waitFor(() => {
      expect(screen.getByText("Order #904 created")).toBeInTheDocument();
    });

    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/v1/payment/global-plans/upgrade-quote",
      expect.anything(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/payment/orders",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          amount: 29,
          amount_currency: "USD",
          payment_type: "stripe",
          order_type: "subscription",
          plan_id: 303,
          payment_source: "hosted_redirect",
          return_url: `${window.location.origin}/payment/result`,
          is_mobile: false,
        }),
      }),
    );
  });

  it("shows order status and actions for pending activity", async () => {
    const fetchMock = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      if (path === "/api/v1/payment/checkout-info") return Promise.resolve(checkoutInfoResponse());
      if (path === "/api/v1/console/billing") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              data: {
                wallet: { available_balance: 0, add_on_credits: 0, currency: "USD" },
                plans: [],
                add_ons: [],
                payment_methods: [{ type: "stripe", available: true }],
                activity: [
                  {
                    id: 77,
                    date: "2026-06-15T00:00:00Z",
                    reference: "sub2_pending",
                    type: "balance",
                    label: "Add-on Credits",
                    amount: 10,
                    currency: "USD",
                    pay_amount: 72,
                    payment_currency: "CNY",
                    status: "PENDING",
                    pay_url: "https://checkout.example/pay/77",
                  },
                ],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (path === "/api/v1/payment/orders/77/cancel") {
        return Promise.resolve(
          new Response(JSON.stringify({ success: true, data: { message: "cancelled" } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected request ${path} ${init?.method ?? "GET"}`));
    });
    globalThis.fetch = fetchMock;

    render(<Billing />);

    await waitFor(() => {
      expect(screen.getByText("sub2_pending")).toBeInTheDocument();
    });

    expect(screen.getByText("PENDING")).toBeInTheDocument();
    expect(screen.getByText("$10")).toBeInTheDocument();
    expect(screen.getByText("Paid CN¥72")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /pay again/i })).toHaveAttribute("href", "https://checkout.example/pay/77");

    fireEvent.click(screen.getByRole("button", { name: /cancel order sub2_pending/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/payment/orders/77/cancel",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });
});
