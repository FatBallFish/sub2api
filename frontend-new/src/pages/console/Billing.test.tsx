import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import Billing from "./Billing";
import {
  classifyPaymentPollingStatus,
  hasCheckoutActions,
  PAYMENT_ORDER_STATUSES,
  type PaymentPollingClassification,
  type PaymentOrderStatus,
} from "../../utils/paymentStatus";

const backendPaymentStatuses = [
  { status: "PENDING", zhCN: "待付款", checkout: true, polling: "continue" },
  { status: "PAID", zhCN: "已付款", checkout: false, polling: "paid" },
  { status: "RECHARGING", zhCN: "充值入账中", checkout: false, polling: "continue" },
  { status: "COMPLETED", zhCN: "已完成", checkout: false, polling: "paid" },
  { status: "EXPIRED", zhCN: "已过期", checkout: false, polling: "terminal" },
  { status: "CANCELLED", zhCN: "已取消", checkout: false, polling: "terminal" },
  { status: "FAILED", zhCN: "失败", checkout: false, polling: "terminal" },
  { status: "REFUND_REQUESTED", zhCN: "已申请退款", checkout: false, polling: "refund" },
  { status: "REFUNDING", zhCN: "退款中", checkout: false, polling: "refund" },
  { status: "REFUND_PENDING", zhCN: "退款处理中", checkout: false, polling: "refund" },
  { status: "PARTIALLY_REFUNDED", zhCN: "部分退款", checkout: false, polling: "refund" },
  { status: "REFUNDED", zhCN: "已退款", checkout: false, polling: "refund" },
  { status: "REFUND_FAILED", zhCN: "退款失败", checkout: false, polling: "refund" },
] as const satisfies ReadonlyArray<{
  status: PaymentOrderStatus;
  zhCN: string;
  checkout: boolean;
  polling: PaymentPollingClassification;
}>;

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

function billingResponse({
  plans = [],
  addOns = [],
  activity = [],
}: {
  plans?: Array<Record<string, unknown>>;
  addOns?: Array<Record<string, unknown>>;
  activity?: Array<Record<string, unknown>>;
} = {}) {
  return new Response(
    JSON.stringify({
      success: true,
      data: {
        wallet: { available_balance: 15, add_on_credits: 15, currency: "USD" },
        plans,
        add_ons: addOns,
        payment_methods: [{ type: "stripe", available: true }],
        activity,
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function orderResponse(order: Record<string, unknown>) {
  return new Response(JSON.stringify({ success: true, data: order }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
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

  it("keeps the frontend payment status contract aligned with the backend enum", () => {
    expect(backendPaymentStatuses.map(({ status }) => status)).toEqual(PAYMENT_ORDER_STATUSES);
  });

  it.each([
    ...backendPaymentStatuses.map(({ status, checkout, polling }) => ({ status, checkout, polling })),
    { status: "", checkout: true, polling: "continue" as const },
    { status: "FUTURE_PROVIDER_STATE", checkout: false, polling: "continue" as const },
  ])("classifies $status checkout and polling safely", ({ status, checkout, polling }) => {
    expect(hasCheckoutActions(status)).toBe(checkout);
    expect(classifyPaymentPollingStatus(status)).toBe(polling);
  });

  it("localizes every fixed backend payment status without translating unknown future statuses", async () => {
    await i18n.changeLanguage("zh-CN");
    const activity = [
      ...backendPaymentStatuses.map(({ status }, index) => ({
        id: index + 1,
        date: "2026-06-15T00:00:00Z",
        reference: `order_${status.toLowerCase()}`,
        type: "balance",
        label: `Backend order ${index + 1}`,
        amount: 10,
        currency: "USD",
        status,
      })),
      {
        id: backendPaymentStatuses.length + 1,
        date: "2026-06-15T00:00:00Z",
        reference: "order_future_provider_state",
        type: "balance",
        label: "Backend future order",
        amount: 10,
        currency: "USD",
        status: "FUTURE_PROVIDER_STATE",
      },
    ];
    const fetchMock = vi.fn((url: RequestInfo | URL) => {
      const path = String(url);
      if (path === "/api/v1/payment/checkout-info") return Promise.resolve(checkoutInfoResponse());
      if (path === "/api/v1/console/billing") return Promise.resolve(billingResponse({ activity }));
      return Promise.reject(new Error(`Unexpected request ${path}`));
    });
    globalThis.fetch = fetchMock;

    render(<Billing />);
    await screen.findByText("order_pending");

    for (const { status, zhCN } of backendPaymentStatuses) {
      const row = screen.getByText(`order_${status.toLowerCase()}`).closest("tr");
      expect(row).not.toBeNull();
      expect(within(row!).getByText(zhCN)).toBeInTheDocument();
    }
    const futureRow = screen.getByText("order_future_provider_state").closest("tr");
    expect(within(futureRow!).getByText("FUTURE_PROVIDER_STATE")).toBeInTheDocument();
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

  it.each([
    { initialStatus: "PENDING", initialCheckout: true },
    { initialStatus: "RECHARGING", initialCheckout: false },
  ])("hides checkout while a $initialStatus order continues through recharging", async ({ initialStatus, initialCheckout }) => {
    let verificationCalls = 0;
    const fetchMock = vi.fn((url: RequestInfo | URL) => {
      const path = String(url);
      if (path === "/api/v1/payment/checkout-info") return Promise.resolve(checkoutInfoResponse());
      if (path === "/api/v1/console/billing") {
        return Promise.resolve(billingResponse({ addOns: [{ amount: 10, credits: 10.5, currency: "USD", preset: true }] }));
      }
      if (path === "/api/v1/payment/orders") {
        return Promise.resolve(orderResponse({
          order_id: 811,
          out_trade_no: "order-recharging-811",
          amount: 10,
          pay_amount: 10,
          currency: "USD",
          payment_type: "stripe",
          pay_url: "https://checkout.example/pay/811",
          status: initialStatus,
        }));
      }
      if (path === "/api/v1/payment/orders/verify") {
        verificationCalls += 1;
        return Promise.resolve(orderResponse({
          id: 811,
          out_trade_no: "order-recharging-811",
          amount: 10,
          pay_amount: 10,
          currency: "USD",
          payment_type: "stripe",
          status: "RECHARGING",
        }));
      }
      return Promise.reject(new Error(`Unexpected request ${path}`));
    });
    globalThis.fetch = fetchMock;

    render(<Billing />);
    const createButton = await screen.findByRole("button", { name: "Create payment order" });
    vi.useFakeTimers();
    fireEvent.click(createButton);
    await act(async () => void await vi.advanceTimersByTimeAsync(0));
    expect(screen.queryAllByRole("link", { name: "Continue payment" }).length > 0).toBe(initialCheckout);

    await act(async () => void await vi.advanceTimersByTimeAsync(3000));
    expect(screen.queryAllByRole("link", { name: "Continue payment" })).toHaveLength(0);
    expect(verificationCalls).toBe(1);

    await act(async () => void await vi.advanceTimersByTimeAsync(3000));
    expect(verificationCalls).toBe(2);
  });

  it.each([
    {
      name: "continues after an isolated third-attempt failure",
      outcomes: ["PENDING", "PENDING", "reject", "PENDING"] as const,
      advanceMs: 12_000,
      expectedCalls: 4,
      unavailable: false,
    },
    {
      name: "stops after three consecutive failures",
      outcomes: ["reject", "reject", "reject"] as const,
      advanceMs: 15_000,
      expectedCalls: 3,
      unavailable: true,
    },
  ])("$name", async ({ outcomes, advanceMs, expectedCalls, unavailable }) => {
    let verificationCalls = 0;
    const fetchMock = vi.fn((url: RequestInfo | URL) => {
      const path = String(url);
      if (path === "/api/v1/payment/checkout-info") return Promise.resolve(checkoutInfoResponse());
      if (path === "/api/v1/console/billing") {
        return Promise.resolve(billingResponse({ addOns: [{ amount: 10, credits: 10.5, currency: "USD", preset: true }] }));
      }
      if (path === "/api/v1/payment/orders") {
        return Promise.resolve(orderResponse({
          order_id: 812,
          out_trade_no: "order-retry-812",
          amount: 10,
          pay_amount: 10,
          currency: "USD",
          payment_type: "stripe",
          status: "PENDING",
        }));
      }
      if (path === "/api/v1/payment/orders/verify") {
        const outcome = outcomes[verificationCalls];
        verificationCalls += 1;
        if (outcome === "reject") return Promise.reject(new TypeError("verification unavailable"));
        return Promise.resolve(orderResponse({
          id: 812,
          out_trade_no: "order-retry-812",
          amount: 10,
          pay_amount: 10,
          currency: "USD",
          payment_type: "stripe",
          status: outcome ?? "PENDING",
        }));
      }
      return Promise.reject(new Error(`Unexpected request ${path}`));
    });
    globalThis.fetch = fetchMock;

    render(<Billing />);
    const createButton = await screen.findByRole("button", { name: "Create payment order" });
    vi.useFakeTimers();
    fireEvent.click(createButton);
    await act(async () => void await vi.advanceTimersByTimeAsync(0));
    await act(async () => void await vi.advanceTimersByTimeAsync(advanceMs));

    expect(verificationCalls).toBe(expectedCalls);
    if (unavailable) {
      expect(screen.getByText("Payment status unavailable")).toBeInTheDocument();
    } else {
      expect(screen.queryByText("Payment status unavailable")).not.toBeInTheDocument();
    }
  });

  it("stops after the total verification attempt limit", async () => {
    let verificationCalls = 0;
    const fetchMock = vi.fn((url: RequestInfo | URL) => {
      const path = String(url);
      if (path === "/api/v1/payment/checkout-info") return Promise.resolve(checkoutInfoResponse());
      if (path === "/api/v1/console/billing") {
        return Promise.resolve(billingResponse({ addOns: [{ amount: 10, credits: 10.5, currency: "USD", preset: true }] }));
      }
      if (path === "/api/v1/payment/orders") {
        return Promise.resolve(orderResponse({
          order_id: 813,
          out_trade_no: "order-timeout-813",
          amount: 10,
          pay_amount: 10,
          currency: "USD",
          payment_type: "stripe",
          status: "PENDING",
        }));
      }
      if (path === "/api/v1/payment/orders/verify") {
        verificationCalls += 1;
        return Promise.resolve(orderResponse({
          id: 813,
          out_trade_no: "order-timeout-813",
          amount: 10,
          pay_amount: 10,
          currency: "USD",
          payment_type: "stripe",
          status: "PENDING",
        }));
      }
      return Promise.reject(new Error(`Unexpected request ${path}`));
    });
    globalThis.fetch = fetchMock;

    render(<Billing />);
    const createButton = await screen.findByRole("button", { name: "Create payment order" });
    vi.useFakeTimers();
    fireEvent.click(createButton);
    await act(async () => void await vi.advanceTimersByTimeAsync(0));
    await act(async () => void await vi.advanceTimersByTimeAsync(300_000));

    expect(verificationCalls).toBe(100);
    expect(screen.getByText("Still waiting for payment")).toBeInTheDocument();
    await act(async () => void await vi.advanceTimersByTimeAsync(3000));
    expect(verificationCalls).toBe(100);
  });

  it("does not overlap payment verification and ignores a late response from an older order", async () => {
    const firstVerification = deferred<Response>();
    let createdOrders = 0;
    const verificationBodies: string[] = [];
    const fetchMock = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      if (path === "/api/v1/payment/checkout-info") return Promise.resolve(checkoutInfoResponse());
      if (path === "/api/v1/console/billing") {
        return Promise.resolve(billingResponse({ addOns: [{ amount: 10, credits: 10.5, currency: "USD", preset: true }] }));
      }
      if (path === "/api/v1/payment/orders") {
        createdOrders += 1;
        const id = createdOrders === 1 ? 901 : 902;
        return Promise.resolve(orderResponse({
          order_id: id,
          out_trade_no: `order-${id}`,
          amount: 10,
          pay_amount: 10,
          currency: "USD",
          payment_type: "stripe",
          pay_url: `https://checkout.example/pay/${id}`,
          status: "PENDING",
        }));
      }
      if (path === "/api/v1/payment/orders/verify") {
        verificationBodies.push(String(init?.body));
        if (String(init?.body).includes("order-901")) return firstVerification.promise;
        return Promise.resolve(orderResponse({
          id: 902,
          out_trade_no: "order-902",
          amount: 10,
          pay_amount: 10,
          currency: "USD",
          payment_type: "stripe",
          status: "PENDING",
        }));
      }
      return Promise.reject(new Error(`Unexpected request ${path}`));
    });
    globalThis.fetch = fetchMock;

    render(<Billing />);
    const createButton = await screen.findByRole("button", { name: "Create payment order" });
    vi.useFakeTimers();

    fireEvent.click(createButton);
    await act(async () => void await vi.advanceTimersByTimeAsync(0));
    await act(async () => void await vi.advanceTimersByTimeAsync(9000));
    expect(verificationBodies.filter((body) => body.includes("order-901"))).toHaveLength(1);

    fireEvent.click(createButton);
    await act(async () => void await vi.advanceTimersByTimeAsync(0));
    await act(async () => void await vi.advanceTimersByTimeAsync(3000));
    expect(verificationBodies.some((body) => body.includes("order-902"))).toBe(true);

    firstVerification.resolve(orderResponse({
      id: 901,
      out_trade_no: "order-901",
      amount: 10,
      pay_amount: 10,
      currency: "USD",
      payment_type: "stripe",
      status: "COMPLETED",
    }));
    await act(async () => void await Promise.resolve());

    expect(screen.getByText("#902")).toBeInTheDocument();
    expect(screen.queryByText("Payment confirmed")).not.toBeInTheDocument();
  });

  it("hides checkout actions for terminal created orders", async () => {
    const fetchMock = vi.fn((url: RequestInfo | URL) => {
      const path = String(url);
      if (path === "/api/v1/payment/checkout-info") return Promise.resolve(checkoutInfoResponse());
      if (path === "/api/v1/console/billing") {
        return Promise.resolve(billingResponse({ addOns: [{ amount: 10, credits: 10.5, currency: "USD", preset: true }] }));
      }
      if (path === "/api/v1/payment/orders") {
        return Promise.resolve(orderResponse({
          order_id: 903,
          out_trade_no: "order-903",
          amount: 10,
          pay_amount: 10,
          currency: "USD",
          payment_type: "stripe",
          pay_url: "https://checkout.example/pay/903",
          status: "PAID",
        }));
      }
      return Promise.reject(new Error(`Unexpected request ${path}`));
    });
    globalThis.fetch = fetchMock;

    render(<Billing />);
    fireEvent.click(await screen.findByRole("button", { name: "Create payment order" }));
    await screen.findByText("Order #903 created");

    expect(screen.queryAllByRole("link", { name: "Continue payment" })).toHaveLength(0);
    expect(openMock).not.toHaveBeenCalled();
  });

  it("traps focus in the payment dialog, closes on Escape, and restores the trigger", async () => {
    const fetchMock = vi.fn((url: RequestInfo | URL) => {
      const path = String(url);
      if (path === "/api/v1/payment/checkout-info") return Promise.resolve(checkoutInfoResponse());
      if (path === "/api/v1/console/billing") {
        return Promise.resolve(billingResponse({ addOns: [{ amount: 10, credits: 10.5, currency: "USD", preset: true }] }));
      }
      if (path === "/api/v1/payment/orders") {
        return Promise.resolve(orderResponse({
          order_id: 904,
          out_trade_no: "order-904",
          amount: 10,
          pay_amount: 10,
          currency: "USD",
          payment_type: "stripe",
          pay_url: "https://checkout.example/pay/904",
          status: "PENDING",
        }));
      }
      return Promise.reject(new Error(`Unexpected request ${path}`));
    });
    globalThis.fetch = fetchMock;

    render(<Billing />);
    const trigger = await screen.findByRole("button", { name: "Create payment order" });
    trigger.focus();
    fireEvent.click(trigger);

    const closeButton = await screen.findByRole("button", { name: "Dismiss payment dialog" });
    const continueLink = within(screen.getByRole("dialog")).getByRole("link", { name: "Continue payment" });
    await waitFor(() => expect(closeButton).toHaveFocus());
    await waitFor(() => expect(trigger).toBeEnabled());

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(continueLink).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(closeButton).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
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

    expect(screen.getByText("Pending")).toBeInTheDocument();
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

  it("renders fixed billing copy in Simplified Chinese while preserving configured content", async () => {
    await i18n.changeLanguage("zh-CN");
    const fetchMock = vi.fn((url: RequestInfo | URL) => {
      const path = String(url);
      if (path === "/api/v1/payment/checkout-info") return Promise.resolve(checkoutInfoResponse());
      if (path === "/api/v1/console/billing") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              data: {
                wallet: { available_balance: 210.75, add_on_credits: 42.5, currency: "USD" },
                active_global_plan: {
                  id: 9,
                  plan_id: 102,
                  name: "Enterprise Custom Plan",
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
                    id: 102,
                    name: "Enterprise Custom Plan",
                    price: 49,
                    currency: "USD",
                    billing_period: "month",
                    quota_period: "month",
                    weekly_credits: 60,
                    monthly_max_credits: 240,
                    features: ["Priority routing from backend"],
                  },
                ],
                add_ons: [{ amount: 25, credits: 27.5, currency: "USD", preset: true }],
                payment_methods: [{ type: "stripe", available: true }],
                activity: [
                  {
                    id: 77,
                    date: "2026-06-15T00:00:00Z",
                    reference: "sub2_pending",
                    type: "balance",
                    label: "Backend configured order label",
                    amount: 10,
                    currency: "USD",
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
      return Promise.reject(new Error(`Unexpected request ${path}`));
    });
    globalThis.fetch = fetchMock;

    render(<Billing />);

    expect(screen.getByText("正在加载账单...")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("heading", { name: "订阅与额度" })).toBeInTheDocument());

    expect(screen.getByText("可用余额")).toBeInTheDocument();
    expect(screen.getByText("订阅套餐")).toBeInTheDocument();
    expect(screen.getByText("附加额度充值")).toBeInTheDocument();
    expect(screen.getByText("付款预览")).toBeInTheDocument();
    expect(screen.getByText("钱包与订单记录")).toBeInTheDocument();
    expect(screen.getByText("待付款")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消订单 sub2_pending" })).toBeInTheDocument();
    expect(screen.getByText("额度与套餐如何使用")).toBeInTheDocument();
    expect(screen.getAllByText("Enterprise Custom Plan").length).toBeGreaterThan(0);
    expect(screen.getByText("Priority routing from backend")).toBeInTheDocument();
    expect(screen.getByText("Backend configured order label")).toBeInTheDocument();
    expect(screen.getByText("2026年6月15日")).toBeInTheDocument();
  });

  it("switches billing copy and Intl formatting to Japanese without replaying billing requests", async () => {
    const fetchMock = vi.fn((url: RequestInfo | URL) => {
      const path = String(url);
      if (path === "/api/v1/payment/checkout-info") return Promise.resolve(checkoutInfoResponse());
      if (path === "/api/v1/console/billing") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              data: {
                wallet: { available_balance: 100, add_on_credits: 0, currency: "USD" },
                plans: [],
                add_ons: [{ amount: 10, credits: 10.5, currency: "USD", preset: true }],
                payment_methods: [{ type: "stripe", available: true }],
                activity: [
                  {
                    id: 88,
                    date: "2026-06-15T00:00:00Z",
                    reference: "completed_order",
                    type: "balance",
                    label: "Configured activity",
                    amount: 1234.5,
                    currency: "USD",
                    status: "COMPLETED",
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
    await waitFor(() => expect(screen.getByRole("heading", { name: "Subscription & Credits" })).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      await i18n.changeLanguage("ja");
    });

    expect(screen.getByRole("heading", { name: "サブスクリプションとクレジット" })).toBeInTheDocument();
    expect(screen.getByText("支払いプレビュー")).toBeInTheDocument();
    expect(screen.getByText("完了")).toBeInTheDocument();
    expect(screen.getByText("2026年6月15日")).toBeInTheDocument();
    expect(screen.getByText("$1,234.50")).toBeInTheDocument();
    expect(screen.getByText("Configured activity")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("localizes billing load failures reactively without replaying requests", async () => {
    await i18n.changeLanguage("zh-CN");
    const fetchMock = vi.fn((url: RequestInfo | URL) => {
      const path = String(url);
      if (path === "/api/v1/payment/checkout-info") return Promise.resolve(checkoutInfoResponse());
      if (path === "/api/v1/console/billing") return Promise.reject(new TypeError("Failed to fetch"));
      return Promise.reject(new Error(`Unexpected request ${path}`));
    });
    globalThis.fetch = fetchMock;

    render(<Billing />);

    expect(await screen.findByText("无法加载账单信息。")).toBeInTheDocument();
    expect(screen.queryByText("出现错误，请稍后重试。")).not.toBeInTheDocument();
    const requestCount = fetchMock.mock.calls.length;

    await act(async () => {
      await i18n.changeLanguage("ja");
    });

    expect(screen.getByText("請求情報を読み込めませんでした。")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(requestCount);
  });

  it("preserves billing data when an action refresh fails and recovers on retry", async () => {
    await i18n.changeLanguage("en");
    let billingLoads = 0;
    const pendingOrder = {
      id: 77,
      date: "2026-06-15T00:00:00Z",
      reference: "refresh_pending",
      type: "balance",
      label: "Add-on Credits",
      amount: 10,
      currency: "USD",
      status: "PENDING",
    };
    const fetchMock = vi.fn((url: RequestInfo | URL) => {
      const path = String(url);
      if (path === "/api/v1/payment/checkout-info") return Promise.resolve(checkoutInfoResponse());
      if (path === "/api/v1/console/billing") {
        billingLoads += 1;
        return billingLoads === 2
          ? Promise.reject(new TypeError("refresh failed"))
          : Promise.resolve(billingResponse({ activity: [pendingOrder] }));
      }
      if (path === "/api/v1/payment/orders/77/cancel") {
        return Promise.resolve(new Response(JSON.stringify({ success: true, data: { message: "cancelled" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      }
      return Promise.reject(new Error(`Unexpected request ${path}`));
    });
    globalThis.fetch = fetchMock;

    render(<Billing />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel order refresh_pending" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to refresh billing information.");
    expect(screen.getByText("refresh_pending")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Subscription & Credits" })).toBeInTheDocument();

    const requestCount = fetchMock.mock.calls.length;
    await act(async () => void await i18n.changeLanguage("ja"));
    expect(screen.getByRole("alert")).toHaveTextContent("請求情報を更新できませんでした。");
    expect(fetchMock).toHaveBeenCalledTimes(requestCount);

    fireEvent.click(screen.getByRole("button", { name: "再試行" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByText("refresh_pending")).toBeInTheDocument();
  });

  it("uses a specific fallback when cancelling a payment order fails", async () => {
    await i18n.changeLanguage("en");
    const pendingOrder = {
      id: 77,
      date: "2026-06-15T00:00:00Z",
      reference: "cancel_pending",
      type: "balance",
      label: "Add-on Credits",
      amount: 10,
      currency: "USD",
      status: "PENDING",
    };
    const fetchMock = vi.fn((url: RequestInfo | URL) => {
      const path = String(url);
      if (path === "/api/v1/payment/checkout-info") return Promise.resolve(checkoutInfoResponse());
      if (path === "/api/v1/console/billing") return Promise.resolve(billingResponse({ activity: [pendingOrder] }));
      if (path === "/api/v1/payment/orders/77/cancel") return Promise.reject(new Error("socket reset"));
      return Promise.reject(new Error(`Unexpected request ${path}`));
    });
    globalThis.fetch = fetchMock;

    render(<Billing />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel order cancel_pending" }));

    expect(await screen.findByText("Unable to cancel the payment order.")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong.")).not.toBeInTheDocument();
  });

  it("uses a specific fallback when creating a top-up order fails", async () => {
    await i18n.changeLanguage("en");
    const fetchMock = vi.fn((url: RequestInfo | URL) => {
      const path = String(url);
      if (path === "/api/v1/payment/checkout-info") return Promise.resolve(checkoutInfoResponse());
      if (path === "/api/v1/console/billing") {
        return Promise.resolve(billingResponse({ addOns: [{ amount: 10, credits: 10.5, currency: "USD", preset: true }] }));
      }
      if (path === "/api/v1/payment/orders") return Promise.reject(new TypeError("Failed to fetch"));
      return Promise.reject(new Error(`Unexpected request ${path}`));
    });
    globalThis.fetch = fetchMock;

    render(<Billing />);
    fireEvent.click(await screen.findByRole("button", { name: "Create payment order" }));

    expect(await screen.findByText("Unable to create the top-up payment order.")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong.")).not.toBeInTheDocument();
  });

  it("uses a specific fallback for a code-less ApiError when creating a plan order fails", async () => {
    await i18n.changeLanguage("en");
    const plan = {
      id: 102,
      name: "Pro",
      price: 49,
      currency: "USD",
      billing_period: "month",
      weekly_credits: 60,
      monthly_max_credits: 240,
      features: [],
    };
    const fetchMock = vi.fn((url: RequestInfo | URL) => {
      const path = String(url);
      if (path === "/api/v1/payment/checkout-info") return Promise.resolve(checkoutInfoResponse());
      if (path === "/api/v1/console/billing") return Promise.resolve(billingResponse({ plans: [plan] }));
      if (path === "/api/v1/payment/orders") return Promise.resolve(new Response("", { status: 503 }));
      return Promise.reject(new Error(`Unexpected request ${path}`));
    });
    globalThis.fetch = fetchMock;

    render(<Billing />);
    fireEvent.click(await screen.findByRole("button", { name: "Upgrade to Pro" }));

    expect(await screen.findByText("Unable to create the subscription order.")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong.")).not.toBeInTheDocument();
  });

  it("uses the payment scope for top-up and plan order errors", async () => {
    await i18n.changeLanguage("zh-CN");
    const plan = {
      id: 102,
      name: "Pro",
      price: 49,
      currency: "USD",
      billing_period: "month",
      weekly_credits: 60,
      monthly_max_credits: 240,
      features: [],
    };
    const dailyLimitResponse = () => new Response(JSON.stringify({
      success: false,
      code: "DAILY_LIMIT_EXCEEDED",
      message: "raw daily limit",
    }), { status: 429, headers: { "Content-Type": "application/json" } });
    const fetchMock = vi.fn((url: RequestInfo | URL) => {
      const path = String(url);
      if (path === "/api/v1/payment/checkout-info") return Promise.resolve(checkoutInfoResponse());
      if (path === "/api/v1/console/billing") {
        return Promise.resolve(billingResponse({
          plans: [plan],
          addOns: [{ amount: 10, credits: 10.5, currency: "USD", preset: true }],
        }));
      }
      if (path === "/api/v1/payment/orders") return Promise.resolve(dailyLimitResponse());
      return Promise.reject(new Error(`Unexpected request ${path}`));
    });
    globalThis.fetch = fetchMock;

    render(<Billing />);
    fireEvent.click(await screen.findByRole("button", { name: "创建付款订单" }));
    expect(await screen.findByText("已达到每日支付限额。")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "升级到 Pro" }));
    await waitFor(() => {
      expect(screen.getAllByText("已达到每日支付限额。")).toHaveLength(2);
    });
    expect(screen.queryByText("已达到订阅的每日用量限额。")).not.toBeInTheDocument();
    expect(screen.queryByText("raw daily limit")).not.toBeInTheDocument();
  });

  it("preserves raw backend response messages for unmapped payment errors", async () => {
    await i18n.changeLanguage("en");
    const fetchMock = vi.fn((url: RequestInfo | URL) => {
      const path = String(url);
      if (path === "/api/v1/payment/checkout-info") return Promise.resolve(checkoutInfoResponse());
      if (path === "/api/v1/console/billing") {
        return Promise.resolve(billingResponse({ addOns: [{ amount: 10, credits: 10.5, currency: "USD", preset: true }] }));
      }
      if (path === "/api/v1/payment/orders") {
        return Promise.resolve(new Response(JSON.stringify({
          success: false,
          code: "PROCESSOR_MAINTENANCE",
          message: "Processor maintenance window",
        }), { status: 503, headers: { "Content-Type": "application/json" } }));
      }
      return Promise.reject(new Error(`Unexpected request ${path}`));
    });
    globalThis.fetch = fetchMock;

    render(<Billing />);
    fireEvent.click(await screen.findByRole("button", { name: "Create payment order" }));

    expect(await screen.findByText("Processor maintenance window")).toBeInTheDocument();
    expect(screen.queryByText("Unable to create the top-up payment order.")).not.toBeInTheDocument();
  });
});
