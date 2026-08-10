import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle, Clock, WarningCircle } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { resolvePaymentOrderByResumeToken, verifyPaymentOrderPublic } from "../../api/payment";
import type { PaymentOrderResult, PublicOrderVerifyResult } from "../../types/payment";
import StandaloneLanguageSwitcher from "../../components/StandaloneLanguageSwitcher";
import { usePageTitle } from "../../hooks/usePageTitle";
import { formatDate } from "../../utils/format";
import {
  BILLING_STATUS_LABEL_KEYS,
  normalizeOrderStatus,
  type PaymentOrderStatus,
} from "../../utils/paymentStatus";
import {
  errorMessage,
  resolveLocalizedMessage,
  translationMessage,
  type LocalizedMessage,
} from "../../utils/localizedMessage";

type ResolvedOrder = PaymentOrderResult | PublicOrderVerifyResult;

function formatMoney(value: number, currency = "USD", locale = "en") {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function isSuccess(status?: string) {
  const normalized = normalizeOrderStatus(status);
  return normalized === "COMPLETED" || normalized === "PAID";
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

function hasAmountDetails(order: ResolvedOrder): order is PaymentOrderResult {
  return "amount" in order
    && typeof order.amount === "number"
    && "pay_amount" in order
    && typeof order.pay_amount === "number"
    && "currency" in order
    && typeof order.currency === "string"
    && "order_type" in order
    && typeof order.order_type === "string";
}

function formatTimestamp(value: string, locale?: string) {
  return formatDate(value, locale, {
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function PaymentResult() {
  const { i18n, t } = useTranslation("public");
  const [params] = useSearchParams();
  const [order, setOrder] = useState<ResolvedOrder | null>(null);
  const [error, setError] = useState<LocalizedMessage | null>(null);
  const [loading, setLoading] = useState(true);

  const outTradeNo = useMemo(() => params.get("out_trade_no") || "", [params]);
  const resumeToken = useMemo(() => params.get("resume_token") || "", [params]);

  useEffect(() => {
    let active = true;

    async function resolveOrder() {
      setLoading(true);
      setOrder(null);
      setError(null);
      try {
        let resolved: ResolvedOrder | null = null;
        if (resumeToken) {
          resolved = await resolvePaymentOrderByResumeToken(resumeToken);
        } else if (outTradeNo) {
          resolved = await verifyPaymentOrderPublic(outTradeNo);
        }
        if (!active) return;
        if (resolved) {
          setOrder(resolved);
        } else {
          setError(translationMessage("public:payment.missingReference"));
        }
      } catch (reason) {
        if (active) {
          setError(errorMessage(reason, "paymentVerifyFailed", "payment"));
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

  const status = normalizeOrderStatus(order?.status);
  const statusLabelKey = BILLING_STATUS_LABEL_KEYS[status as PaymentOrderStatus];
  const statusLabel = statusLabelKey
    ? i18n.t(statusLabelKey, { ns: "console" })
    : (order?.status?.trim() || status);
  const Icon = loading ? Clock : isSuccess(status) ? CheckCircle : WarningCircle;
  const title = isSuccess(status)
    ? t("payment.completed")
    : status === "PENDING"
      ? t("payment.processing")
      : t("payment.statusTitle");
  usePageTitle(isSuccess(status) ? t("payment.completedPageTitle") : t("payment.pageTitle"));

  return (
    <main className="relative min-h-screen bg-zinc-50 px-6 py-16">
      <StandaloneLanguageSwitcher />
      <div className="mx-auto max-w-xl rounded-[2rem] border border-zinc-200 bg-white p-8 shadow-sm">
        <div className="flex items-center gap-4">
          <div className={`rounded-2xl p-3 ${isSuccess(status) ? "bg-emerald-50 text-emerald-600" : "bg-zinc-100 text-zinc-500"}`}>
            <Icon size={28} weight="fill" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-zinc-950">{loading ? t("payment.verifying") : title}</h1>
            <p className="mt-1 text-sm text-zinc-500">{t("payment.description")}</p>
          </div>
        </div>

        {error ? (
          <p role="alert" className="mt-6 rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm font-medium text-rose-700">{resolveLocalizedMessage(error)}</p>
        ) : null}

        {order ? (
          <div className="mt-8 space-y-3 rounded-2xl border border-zinc-100 bg-zinc-50 p-5 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-zinc-500">{t("payment.order")}</span>
              <span className="font-mono font-semibold text-zinc-900">{order.out_trade_no}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-zinc-500">{t("payment.status")}</span>
              <span className="font-bold text-zinc-900">{statusLabel}</span>
            </div>
            {hasAmountDetails(order) ? (
              <>
                <div className="flex justify-between gap-4">
                  <span className="text-zinc-500">{t("payment.amount")}</span>
                  <span className="font-bold text-zinc-900">{formatMoney(order.pay_amount, paymentCurrency(order), i18n.resolvedLanguage)}</span>
                </div>
                {showCreditedAmount(order) ? (
                  <div className="flex justify-between gap-4">
                    <span className="text-zinc-500">{t("payment.credited")}</span>
                    <span className="font-bold text-zinc-900">{formatMoney(order.amount, amountCurrency(order), i18n.resolvedLanguage)}</span>
                  </div>
                ) : null}
              </>
            ) : null}
            <div className="flex justify-between gap-4">
              <span className="text-zinc-500">{t("payment.createdAt")}</span>
              <span className="text-right font-medium text-zinc-900">{formatTimestamp(order.created_at, i18n.resolvedLanguage)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-zinc-500">{t("payment.expiresAt")}</span>
              <span className="text-right font-medium text-zinc-900">{formatTimestamp(order.expires_at, i18n.resolvedLanguage)}</span>
            </div>
            {order.paid_at ? (
              <div className="flex justify-between gap-4">
                <span className="text-zinc-500">{t("payment.paidAt")}</span>
                <span className="text-right font-medium text-zinc-900">{formatTimestamp(order.paid_at, i18n.resolvedLanguage)}</span>
              </div>
            ) : null}
            {order.completed_at ? (
              <div className="flex justify-between gap-4">
                <span className="text-zinc-500">{t("payment.completedAt")}</span>
                <span className="text-right font-medium text-zinc-900">{formatTimestamp(order.completed_at, i18n.resolvedLanguage)}</span>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link to="/console/subscription-wallet" className="inline-flex flex-1 items-center justify-center rounded-xl bg-zinc-950 px-4 py-3 text-sm font-bold text-white">
            {t("payment.viewBilling")}
          </Link>
          <Link to="/console" className="inline-flex flex-1 items-center justify-center rounded-xl border border-zinc-200 px-4 py-3 text-sm font-bold text-zinc-700">
            {t("payment.backToConsole")}
          </Link>
        </div>
      </div>
    </main>
  );
}
