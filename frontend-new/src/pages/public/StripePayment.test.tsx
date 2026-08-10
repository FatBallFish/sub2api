import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import StripePayment from "./StripePayment";

const stripeHarness = vi.hoisted(() => ({
  confirmPayment: vi.fn(),
  loadStripe: vi.fn(),
}));

vi.mock("@stripe/react-stripe-js", async () => {
  const React = await import("react");
  return {
    Elements: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    PaymentElement: () => React.createElement("div", { "data-testid": "stripe-payment-element" }),
    useElements: () => ({}),
    useStripe: () => ({ confirmPayment: stripeHarness.confirmPayment }),
  };
});

vi.mock("@stripe/stripe-js", () => ({
  loadStripe: stripeHarness.loadStripe,
}));

const originalFetch = globalThis.fetch;

beforeEach(() => {
  sessionStorage.clear();
  stripeHarness.confirmPayment.mockReset();
  stripeHarness.loadStripe.mockReset().mockReturnValue(Promise.resolve({}));
});

afterEach(() => {
  sessionStorage.clear();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

it("localizes the missing-context recovery page and exposes the language switcher", async () => {
  await i18n.changeLanguage("zh-TW");

  render(
    <MemoryRouter initialEntries={["/payment/stripe"]}>
      <StripePayment />
    </MemoryRouter>,
  );

  expect(screen.getByRole("heading", { name: "付款暫時不可用" })).toBeInTheDocument();
  expect(screen.getByText(/安全付款資訊已失效/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "返回帳務" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "切換語言" })).toBeInTheDocument();
  expect(document.title).toBe("付款 | Mikiko CC");
});

it("localizes Stripe loading, ready, and submitting states while preserving a provider error", async () => {
  await i18n.changeLanguage("ja");
  let resolveCheckout!: (response: Response) => void;
  const checkout = new Promise<Response>((resolve) => {
    resolveCheckout = resolve;
  });
  globalThis.fetch = vi.fn().mockReturnValue(checkout);
  sessionStorage.setItem("stripe-payment:42", JSON.stringify({
    clientSecret: "secret-42",
    outTradeNo: "ORDER-42",
  }));
  let resolveConfirm!: (result: { error: { message: string } }) => void;
  stripeHarness.confirmPayment.mockReturnValue(new Promise((resolve) => {
    resolveConfirm = resolve;
  }));

  render(
    <MemoryRouter initialEntries={["/payment/stripe?order_id=42"]}>
      <StripePayment />
    </MemoryRouter>,
  );

  expect(screen.getByText("安全な支払いを読み込んでいます...")).toBeInTheDocument();
  await act(async () => {
    resolveCheckout(new Response(JSON.stringify({
      success: true,
      data: { stripe_publishable_key: "pk_test_42" },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await checkout;
  });

  expect(await screen.findByRole("heading", { name: "注文を完了" })).toBeInTheDocument();
  expect(screen.getByTestId("stripe-payment-element")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "今すぐ支払う" }));
  expect(screen.getByRole("button", { name: "確認中..." })).toBeDisabled();

  await act(async () => {
    resolveConfirm({ error: { message: "Raw Stripe provider decline" } });
  });
  expect(await screen.findByText("Raw Stripe provider decline")).toBeInTheDocument();

  await act(async () => {
    await i18n.changeLanguage("zh-CN");
  });
  expect(screen.getByRole("heading", { name: "完成订单" })).toBeInTheDocument();
  expect(screen.getByText("Raw Stripe provider decline")).toBeInTheDocument();
  expect(globalThis.fetch).toHaveBeenCalledTimes(1);
});

it("updates a frontend-owned Stripe confirmation fallback when the locale changes", async () => {
  await i18n.changeLanguage("ja");
  globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    success: true,
    data: { stripe_publishable_key: "pk_test_43" },
  }), { status: 200, headers: { "Content-Type": "application/json" } }));
  sessionStorage.setItem("stripe-payment:43", JSON.stringify({ clientSecret: "secret-43" }));
  stripeHarness.confirmPayment.mockResolvedValue({ error: { message: "" } });

  render(
    <MemoryRouter initialEntries={["/payment/stripe?order_id=43"]}>
      <StripePayment />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "今すぐ支払う" }));
  expect(await screen.findByText("支払いを確認できませんでした。")).toBeInTheDocument();

  await act(async () => {
    await i18n.changeLanguage("zh-CN");
  });
  expect(screen.getByText("无法确认付款。")).toBeInTheDocument();
  await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));
});
