import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle, Clock, WarningCircle } from "@phosphor-icons/react";
import { resolvePaymentOrderByResumeToken, verifyPaymentOrder, verifyPaymentOrderPublic } from "../../api/payment";
import type { PaymentOrderResult } from "../../types/payment";

function formatMoney(value: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function normalizeStatus(status?: string) {
  return (status || "").trim().toUpperCase();
}

function isSuccess(status?: string) {
  const normalized = normalizeStatus(status);
  return normalized === "COMPLETED" || normalized === "PAID";
}

function titleForStatus(status?: string) {
  if (isSuccess(status)) return "Payment completed";
  if (normalizeStatus(status) === "PENDING") return "Payment is processing";
  return "Payment status";
}

function paymentCurrency(order: PaymentOrderResult) {
  return order.payment_currency || order.currency || "USD";
}

function amountCurrency(order: PaymentOrderResult) {
  if (!order.amount_currency && order.order_type === "balance" && Math.abs(order.pay_amount - order.amount) > 0.000001) {
    return "USD";
  }
  return order.amount_currency || order.currency || "USD";
}

function showCreditedAmount(order: PaymentOrderResult) {
  return order.order_type === "balance" && (
    Math.abs(order.pay_amount - order.amount) > 0.000001 ||
    paymentCurrency(order).toUpperCase() !== amountCurrency(order).toUpperCase()
  );
}

export default function PaymentResult() {
  const [params] = useSearchParams();
  const [order, setOrder] = useState<PaymentOrderResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const outTradeNo = useMemo(() => params.get("out_trade_no") || "", [params]);
  const resumeToken = useMemo(() => params.get("resume_token") || "", [params]);

  useEffect(() => {
    let active = true;

    async function resolveOrder() {
      setLoading(true);
      setError(null);
      try {
        let resolved: PaymentOrderResult | null = null;
        if (resumeToken) {
          resolved = await resolvePaymentOrderByResumeToken(resumeToken);
        } else if (outTradeNo) {
          try {
            resolved = await verifyPaymentOrder(outTradeNo);
          } catch {
            resolved = await verifyPaymentOrderPublic(outTradeNo);
          }
        }
        if (!active) return;
        if (resolved) {
          setOrder(resolved);
        } else {
          setError("Missing payment order reference.");
        }
      } catch (reason) {
        if (active) {
          setError(reason instanceof Error ? reason.message : "Unable to verify the payment order.");
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void resolveOrder();
    return () => {
      active = false;
    };
  }, [outTradeNo, resumeToken]);

  const status = normalizeStatus(order?.status);
  const Icon = loading ? Clock : isSuccess(status) ? CheckCircle : WarningCircle;

  return (
    <main className="min-h-screen bg-zinc-50 px-6 py-16">
      <div className="mx-auto max-w-xl rounded-[2rem] border border-zinc-200 bg-white p-8 shadow-sm">
        <div className="flex items-center gap-4">
          <div className={`rounded-2xl p-3 ${isSuccess(status) ? "bg-emerald-50 text-emerald-600" : "bg-zinc-100 text-zinc-500"}`}>
            <Icon size={28} weight="fill" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-zinc-950">{loading ? "Verifying payment" : titleForStatus(status)}</h1>
            <p className="mt-1 text-sm text-zinc-500">We are checking the provider result and refreshing your account balance.</p>
          </div>
        </div>

        {error ? (
          <p className="mt-6 rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm font-medium text-rose-700">{error}</p>
        ) : null}

        {order ? (
          <div className="mt-8 space-y-3 rounded-2xl border border-zinc-100 bg-zinc-50 p-5 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-zinc-500">Order</span>
              <span className="font-mono font-semibold text-zinc-900">{order.out_trade_no || `#${order.id}`}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-zinc-500">Status</span>
              <span className="font-bold text-zinc-900">{status}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-zinc-500">Amount</span>
              <span className="font-bold text-zinc-900">{formatMoney(order.pay_amount, paymentCurrency(order))}</span>
            </div>
            {showCreditedAmount(order) ? (
              <div className="flex justify-between gap-4">
                <span className="text-zinc-500">Credited</span>
                <span className="font-bold text-zinc-900">{formatMoney(order.amount, amountCurrency(order))}</span>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link to="/console/subscription-wallet" className="inline-flex flex-1 items-center justify-center rounded-xl bg-zinc-950 px-4 py-3 text-sm font-bold text-white">
            View billing
          </Link>
          <Link to="/console" className="inline-flex flex-1 items-center justify-center rounded-xl border border-zinc-200 px-4 py-3 text-sm font-bold text-zinc-700">
            Back to console
          </Link>
        </div>
      </div>
    </main>
  );
}
