import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import PaymentResult from "./PaymentResult";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

it("localizes a successful payment result and keeps the order reference raw", async () => {
  await i18n.changeLanguage("ja");
  globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    success: true,
    data: {
      id: 8,
      amount: 10,
      pay_amount: 10,
      fee_rate: 0,
      currency: "USD",
      payment_type: "stripe",
      out_trade_no: "ORDER-RAW-8",
      status: "COMPLETED",
      order_type: "balance",
      created_at: "2026-08-10T00:00:00Z",
      expires_at: "2026-08-10T01:00:00Z",
      refund_amount: 0,
    },
  }), { status: 200, headers: { "Content-Type": "application/json" } }));

  render(
    <MemoryRouter initialEntries={["/payment/result?out_trade_no=ORDER-RAW-8"]}>
      <PaymentResult />
    </MemoryRouter>,
  );

  expect(await screen.findByRole("heading", { name: "支払いが完了しました" })).toBeInTheDocument();
  expect(screen.getByText("注文番号")).toBeInTheDocument();
  expect(screen.getByText("ORDER-RAW-8")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "言語を切り替える" })).toBeInTheDocument();
  expect(document.title).toBe("支払い完了 | Mikiko CC");
});

it("preserves an unknown provider message after authenticated verification fallback", async () => {
  await i18n.changeLanguage("zh-CN");
  globalThis.fetch = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({
      success: false,
      reason: "NOT_FOUND",
      message: "backend not found",
    }), { status: 404, headers: { "Content-Type": "application/json" } }))
    .mockResolvedValueOnce(new Response(JSON.stringify({
      success: false,
      message: "Provider maintenance window",
    }), { status: 502, headers: { "Content-Type": "application/json" } }));

  render(
    <MemoryRouter initialEntries={["/payment/result?out_trade_no=ORDER-MISSING"]}>
      <PaymentResult />
    </MemoryRouter>,
  );

  expect(await screen.findByText("Provider maintenance window")).toBeInTheDocument();
});

it("localizes a stable payment error code in the public resume flow", async () => {
  await i18n.changeLanguage("zh-CN");
  globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    success: false,
    reason: "NOT_FOUND",
    message: "backend not found",
  }), { status: 404, headers: { "Content-Type": "application/json" } }));

  render(
    <MemoryRouter initialEntries={["/payment/result?resume_token=resume-token"]}>
      <PaymentResult />
    </MemoryRouter>,
  );

  expect(await screen.findByText("未找到对应的支付订单。")).toBeInTheDocument();
  expect(screen.queryByText("backend not found")).not.toBeInTheDocument();
});

it("localizes pending and missing-reference states", async () => {
  await i18n.changeLanguage("zh-CN");
  globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    success: true,
    data: {
      id: 9,
      amount: 20,
      pay_amount: 20,
      fee_rate: 0,
      currency: "USD",
      payment_type: "stripe",
      out_trade_no: "ORDER-PENDING-9",
      status: "PENDING",
      order_type: "balance",
      created_at: "2026-08-10T00:00:00Z",
      expires_at: "2026-08-10T01:00:00Z",
      refund_amount: 0,
    },
  }), { status: 200, headers: { "Content-Type": "application/json" } }));

  const view = render(
    <MemoryRouter initialEntries={["/payment/result?out_trade_no=ORDER-PENDING-9"]}>
      <PaymentResult />
    </MemoryRouter>,
  );

  expect(await screen.findByRole("heading", { name: "付款处理中" })).toBeInTheDocument();
  view.unmount();

  render(
    <MemoryRouter initialEntries={["/payment/result"]}>
      <PaymentResult />
    </MemoryRouter>,
  );
  expect(await screen.findByText("缺少付款订单编号。")).toBeInTheDocument();
});
