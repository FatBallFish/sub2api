import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import PaymentResult from "./PaymentResult";

const originalFetch = globalThis.fetch;

function paymentOrder(outTradeNo: string, id: number) {
  return {
    id,
    amount: 10,
    pay_amount: 10,
    fee_rate: 0,
    currency: "USD",
    payment_type: "stripe",
    out_trade_no: outTradeNo,
    status: "COMPLETED",
    order_type: "balance",
    created_at: "2026-08-10T00:00:00Z",
    expires_at: "2026-08-10T01:00:00Z",
    refund_amount: 0,
  };
}

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function deferredResponse() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function NavigateButton({ to }: { to: string }) {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate(to)}>Navigate</button>;
}

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

it("preserves an unknown provider message from public verification", async () => {
  await i18n.changeLanguage("zh-CN");
  globalThis.fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      success: false,
      message: "Provider maintenance window",
    }), { status: 502, headers: { "Content-Type": "application/json" } }));

  render(
    <MemoryRouter initialEntries={["/payment/result?out_trade_no=ORDER-MISSING"]}>
      <PaymentResult />
    </MemoryRouter>,
  );

  expect(await screen.findByRole("alert")).toHaveTextContent("Provider maintenance window");
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
  await act(async () => {
    await i18n.changeLanguage("ja");
  });
  expect(screen.getByText("支払い注文番号がありません。")).toBeInTheDocument();
});

it("keeps an unknown payment provider message unchanged across locale changes", async () => {
  globalThis.fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      success: false,
      message: "Raw provider decline",
    }), { status: 502, headers: { "Content-Type": "application/json" } }));

  render(
    <MemoryRouter initialEntries={["/payment/result?out_trade_no=ORDER-RAW"]}>
      <PaymentResult />
    </MemoryRouter>,
  );
  expect(await screen.findByText("Raw provider decline")).toBeInTheDocument();
  await act(async () => {
    await i18n.changeLanguage("zh-TW");
  });
  expect(screen.getByText("Raw provider decline")).toBeInTheDocument();
});

it("verifies an anonymous order through only the public endpoint without redirecting to login", async () => {
  const fetchMock = vi.fn().mockResolvedValue(response({
    success: true,
    data: paymentOrder("ORDER-PUBLIC", 12),
  }));
  globalThis.fetch = fetchMock;

  render(
    <MemoryRouter initialEntries={["/payment/result?out_trade_no=ORDER-PUBLIC"]}>
      <PaymentResult />
    </MemoryRouter>,
  );

  expect(await screen.findByText("ORDER-PUBLIC")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/v1/payment/public/orders/verify",
    expect.objectContaining({ method: "POST" }),
  );
  expect(window.location.pathname).not.toBe("/login");
});

it("clears order A while order B loads and does not restore A when B fails", async () => {
  const orderB = deferredResponse();
  globalThis.fetch = vi.fn((_, options?: RequestInit) => {
    const body = JSON.parse(String(options?.body)) as { out_trade_no: string };
    if (body.out_trade_no === "ORDER-A") {
      return Promise.resolve(response({ success: true, data: paymentOrder("ORDER-A", 20) }));
    }
    return orderB.promise;
  });

  render(
    <MemoryRouter initialEntries={["/payment/result?out_trade_no=ORDER-A"]}>
      <NavigateButton to="/payment/result?out_trade_no=ORDER-B" />
      <PaymentResult />
    </MemoryRouter>,
  );

  expect(await screen.findByText("ORDER-A")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Navigate" }));
  await waitFor(() => expect(screen.queryByText("ORDER-A")).not.toBeInTheDocument());

  await act(async () => {
    orderB.resolve(response({ success: false, message: "Order B failed" }, 502));
    await orderB.promise;
  });
  expect(await screen.findByRole("alert")).toHaveTextContent("Order B failed");
  expect(screen.queryByText("ORDER-A")).not.toBeInTheDocument();
});

it("ignores a stale order A completion after order B succeeds", async () => {
  const orderA = deferredResponse();
  globalThis.fetch = vi.fn((_, options?: RequestInit) => {
    const body = JSON.parse(String(options?.body)) as { out_trade_no: string };
    if (body.out_trade_no === "ORDER-A") return orderA.promise;
    return Promise.resolve(response({ success: true, data: paymentOrder("ORDER-B", 31) }));
  });

  render(
    <MemoryRouter initialEntries={["/payment/result?out_trade_no=ORDER-A"]}>
      <NavigateButton to="/payment/result?out_trade_no=ORDER-B" />
      <PaymentResult />
    </MemoryRouter>,
  );

  fireEvent.click(screen.getByRole("button", { name: "Navigate" }));
  expect(await screen.findByText("ORDER-B")).toBeInTheDocument();

  await act(async () => {
    orderA.resolve(response({ success: true, data: paymentOrder("ORDER-A", 30) }));
    await orderA.promise;
  });
  expect(screen.getByText("ORDER-B")).toBeInTheDocument();
  expect(screen.queryByText("ORDER-A")).not.toBeInTheDocument();
});
