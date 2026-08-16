import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import PaymentResult from "./PaymentResult";

const originalFetch = globalThis.fetch;

function publicOrder(outTradeNo: string, status = "COMPLETED") {
  const result = {
    out_trade_no: outTradeNo,
    status,
    paid: status === "COMPLETED",
    created_at: "2026-08-10T00:00:00Z",
    expires_at: "2026-08-10T01:00:00Z",
  };
  return status === "COMPLETED"
    ? {
        ...result,
        paid_at: "2026-08-10T00:30:00Z",
        completed_at: "2026-08-10T00:31:00Z",
      }
    : result;
}

function fullOrder(outTradeNo: string) {
  return {
    id: 88,
    amount: 10,
    pay_amount: 72,
    fee_rate: 0,
    currency: "USD",
    amount_currency: "USD",
    payment_currency: "CNY",
    payment_type: "alipay",
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

it("renders the exact minimal public order response without absent financial details", async () => {
  await i18n.changeLanguage("ja");
  globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    success: true,
    data: publicOrder("ORDER-RAW-8"),
  }), { status: 200, headers: { "Content-Type": "application/json" } }));

  render(
    <MemoryRouter initialEntries={["/payment/result?out_trade_no=ORDER-RAW-8"]}>
      <PaymentResult />
    </MemoryRouter>,
  );

  expect(await screen.findByRole("heading", { name: "支払いが完了しました" })).toBeInTheDocument();
  expect(screen.getByText("完了")).toBeInTheDocument();
  expect(screen.getByText("注文番号")).toBeInTheDocument();
  expect(screen.getByText("ORDER-RAW-8")).toBeInTheDocument();
  expect(screen.getByText("作成日時")).toBeInTheDocument();
  expect(screen.getByText("有効期限")).toBeInTheDocument();
  expect(screen.getByText("支払日時")).toBeInTheDocument();
  expect(screen.getByText("完了日時")).toBeInTheDocument();
  expect(screen.getAllByText(/2026/)).toHaveLength(4);
  expect(screen.queryByText("金額")).not.toBeInTheDocument();
  expect(screen.queryByText("入金額")).not.toBeInTheDocument();
  expect(document.body).not.toHaveTextContent(/NaN|undefined/);
  expect(screen.getByRole("button", { name: "言語を切り替える" })).toBeInTheDocument();
  await waitFor(() => {
    expect(document.title).toBe("支払い完了 | Mikiko CC");
  });
});

it("keeps financial details for the signed resume-token response", async () => {
  await i18n.changeLanguage("en");
  globalThis.fetch = vi.fn().mockResolvedValue(response({
    success: true,
    data: fullOrder("ORDER-RESUME-88"),
  }));

  render(
    <MemoryRouter initialEntries={["/payment/result?resume_token=resume-88"]}>
      <PaymentResult />
    </MemoryRouter>,
  );

  expect(await screen.findByText("ORDER-RESUME-88")).toBeInTheDocument();
  expect(screen.getByText("Amount")).toBeInTheDocument();
  expect(screen.getByText("CN¥72")).toBeInTheDocument();
  expect(screen.getByText("Credited")).toBeInTheDocument();
  expect(screen.getByText("$10")).toBeInTheDocument();
  expect(globalThis.fetch).toHaveBeenCalledWith(
    "/api/v1/payment/public/orders/resolve",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ resume_token: "resume-88" }),
    }),
  );
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
    data: publicOrder("ORDER-PENDING-9", "PENDING"),
  }), { status: 200, headers: { "Content-Type": "application/json" } }));

  const view = render(
    <MemoryRouter initialEntries={["/payment/result?out_trade_no=ORDER-PENDING-9"]}>
      <PaymentResult />
    </MemoryRouter>,
  );

  expect(await screen.findByRole("heading", { name: "付款处理中" })).toBeInTheDocument();
  expect(screen.getByText("待付款")).toBeInTheDocument();
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

it("preserves an unknown future payment status", async () => {
  await i18n.changeLanguage("ja");
  globalThis.fetch = vi.fn().mockResolvedValue(response({
    success: true,
    data: publicOrder("ORDER-FUTURE", "PROVIDER_REVIEW"),
  }));

  render(
    <MemoryRouter initialEntries={["/payment/result?out_trade_no=ORDER-FUTURE"]}>
      <PaymentResult />
    </MemoryRouter>,
  );

  expect(await screen.findByText("PROVIDER_REVIEW")).toBeInTheDocument();
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
    data: publicOrder("ORDER-PUBLIC"),
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
      return Promise.resolve(response({ success: true, data: publicOrder("ORDER-A") }));
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
    return Promise.resolve(response({ success: true, data: publicOrder("ORDER-B") }));
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
    orderA.resolve(response({ success: true, data: publicOrder("ORDER-A") }));
    await orderA.promise;
  });
  expect(screen.getByText("ORDER-B")).toBeInTheDocument();
  expect(screen.queryByText("ORDER-A")).not.toBeInTheDocument();
});
