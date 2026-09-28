import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import StripePayment from "./StripePayment";

const stripeHarness = vi.hoisted(() => ({
  confirmPayment: vi.fn(),
  elementsOptions: null as { clientSecret: string; locale?: string } | null,
  loadStripe: vi.fn(),
}));

vi.mock("@stripe/react-stripe-js", async () => {
  const React = await import("react");
  return {
    Elements: ({ children, options }: { children: React.ReactNode; options: { clientSecret: string; locale?: string } }) => {
      stripeHarness.elementsOptions = options;
      return React.createElement(React.Fragment, null, children);
    },
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
  stripeHarness.elementsOptions = null;
  stripeHarness.loadStripe.mockReset().mockReturnValue(Promise.resolve({}));
});

function NavigateButton({ to }: { to: string }) {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate(to)}>Navigate</button>;
}

function checkoutResponse(publishableKey: string) {
  return new Response(JSON.stringify({
    success: true,
    data: { stripe_publishable_key: publishableKey },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

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
  expect(stripeHarness.elementsOptions).toMatchObject({ locale: "ja" });
  fireEvent.click(screen.getByRole("button", { name: "今すぐ支払う" }));
  expect(screen.getByRole("button", { name: "確認中..." })).toBeDisabled();

  await act(async () => {
    resolveConfirm({ error: { message: "Raw Stripe provider decline" } });
  });
  expect(await screen.findByRole("alert")).toHaveTextContent("Raw Stripe provider decline");

  await act(async () => {
    await i18n.changeLanguage("zh-CN");
  });
  expect(screen.getByRole("heading", { name: "完成订单" })).toBeInTheDocument();
  expect(screen.getByText("Raw Stripe provider decline")).toBeInTheDocument();
  expect(stripeHarness.elementsOptions).toMatchObject({ locale: "zh" });
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

it("ignores a stale checkout failure after a new order succeeds", async () => {
  await i18n.changeLanguage("en");
  const orderA = deferredResponse();
  globalThis.fetch = vi.fn()
    .mockReturnValueOnce(orderA.promise)
    .mockResolvedValueOnce(checkoutResponse("pk_order_b"));
  sessionStorage.setItem("stripe-payment:A", JSON.stringify({ clientSecret: "secret-a" }));
  sessionStorage.setItem("stripe-payment:B", JSON.stringify({ clientSecret: "secret-b" }));

  render(
    <MemoryRouter initialEntries={["/payment/stripe?order_id=A"]}>
      <NavigateButton to="/payment/stripe?order_id=B" />
      <StripePayment />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Navigate" }));

  expect(await screen.findByRole("heading", { name: "Complete your order" })).toBeInTheDocument();
  expect(stripeHarness.elementsOptions).toMatchObject({ clientSecret: "secret-b" });
  await act(async () => {
    orderA.resolve(new Response(null, { status: 503 }));
    await orderA.promise;
  });

  expect(screen.getByRole("heading", { name: "Complete your order" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Payment unavailable" })).not.toBeInTheDocument();
});

it("recovers from an earlier checkout failure when the order changes", async () => {
  await i18n.changeLanguage("en");
  globalThis.fetch = vi.fn()
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(checkoutResponse("pk_order_b"));
  sessionStorage.setItem("stripe-payment:A", JSON.stringify({ clientSecret: "secret-a" }));
  sessionStorage.setItem("stripe-payment:B", JSON.stringify({ clientSecret: "secret-b" }));

  render(
    <MemoryRouter initialEntries={["/payment/stripe?order_id=A"]}>
      <NavigateButton to="/payment/stripe?order_id=B" />
      <StripePayment />
    </MemoryRouter>,
  );
  expect(await screen.findByRole("heading", { name: "Payment unavailable" })).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("Unable to load Stripe.");

  fireEvent.click(screen.getByRole("button", { name: "Navigate" }));

  expect(await screen.findByRole("heading", { name: "Complete your order" })).toBeInTheDocument();
  expect(stripeHarness.elementsOptions).toMatchObject({ clientSecret: "secret-b" });
  expect(screen.queryByRole("heading", { name: "Payment unavailable" })).not.toBeInTheDocument();
});

it("clears the prior checkout while the next order loads", async () => {
  await i18n.changeLanguage("en");
  const orderB = deferredResponse();
  globalThis.fetch = vi.fn()
    .mockResolvedValueOnce(checkoutResponse("pk_order_a"))
    .mockReturnValueOnce(orderB.promise);
  sessionStorage.setItem("stripe-payment:A", JSON.stringify({ clientSecret: "secret-a" }));
  sessionStorage.setItem("stripe-payment:B", JSON.stringify({ clientSecret: "secret-b" }));

  render(
    <MemoryRouter initialEntries={["/payment/stripe?order_id=A"]}>
      <NavigateButton to="/payment/stripe?order_id=B" />
      <StripePayment />
    </MemoryRouter>,
  );
  expect(await screen.findByRole("heading", { name: "Complete your order" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Navigate" }));

  expect(await screen.findByText("Loading secure payment...")).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Complete your order" })).not.toBeInTheDocument();
  await act(async () => {
    orderB.resolve(checkoutResponse("pk_order_b"));
    await orderB.promise;
  });
  expect(await screen.findByRole("heading", { name: "Complete your order" })).toBeInTheDocument();
});
