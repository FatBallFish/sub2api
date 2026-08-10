import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  Wallet,
  Clock,
  Receipt,
  DownloadSimple,
  ArrowUpRight,
  Lightning,
  CheckCircle,
  CreditCard,
  XCircle
} from "@phosphor-icons/react";
import { getConsoleBilling } from "../../api/console";
import { cancelPaymentOrder, createPaymentOrder, getGlobalPlanUpgradeQuote, getPaymentCheckoutInfo, verifyPaymentOrder } from "../../api/payment";
import type { ConsoleBilling } from "../../types/console";
import type { CheckoutInfo, CreateOrderResult } from "../../types/payment";
import { formatCredits } from "../../utils/format";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import {
  classifyPaymentPollingStatus,
  hasCheckoutActions,
  isPendingOrder,
  normalizeOrderStatus,
  type PaymentOrderStatus,
} from "../../utils/paymentStatus";
import {
  errorMessage,
  resolveLocalizedMessage,
  translationMessage,
  type LocalizedMessage,
} from "../../utils/localizedMessage";

function formatMoney(value: number, currency = "USD", locale = "en") {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function currencySymbol(currency: string, locale: string) {
  return new Intl.NumberFormat(locale, { style: "currency", currency })
    .formatToParts(0)
    .find((part) => part.type === "currency")?.value ?? currency;
}

function formatDate(value: string | undefined, locale: string, t: TFunction<"console">) {
  if (!value) return t("billing.notScheduled");
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}

function quotaPercent(billing: ConsoleBilling) {
  const plan = billing.active_global_plan;
  if (!plan || plan.quota_limit <= 0) return 0;
  return Math.min(Math.max(Math.round((plan.quota_used / plan.quota_limit) * 100), 0), 100);
}

function isGroupPlan(plan: ConsoleBilling["plans"][number]) {
  return plan.plan_scope === "group";
}

function isHigherTierPlan(plan: ConsoleBilling["plans"][number], activePlan: NonNullable<ConsoleBilling["active_global_plan"]>) {
  if (typeof plan.tier_rank !== "number" || typeof activePlan.tier_rank !== "number") {
    return plan.id !== activePlan.plan_id;
  }
  return plan.tier_rank > activePlan.tier_rank;
}

function activePlanWithTier(
  activePlan: ConsoleBilling["active_global_plan"],
  plans: ConsoleBilling["plans"],
) {
  if (!activePlan || typeof activePlan.tier_rank === "number") return activePlan;
  const currentPlan = plans.find((plan) => plan.id === activePlan.plan_id);
  if (typeof currentPlan?.tier_rank !== "number") return activePlan;
  return { ...activePlan, tier_rank: currentPlan.tier_rank };
}

function normalizePlanCategory(category?: string) {
  const value = category?.trim();
  return value || "default";
}

function activeGlobalPlansWithTier(billing: ConsoleBilling) {
  const activePlans = billing.active_global_plans?.length
    ? billing.active_global_plans
    : billing.active_global_plan
      ? [billing.active_global_plan]
      : [];
  return activePlans
    .map((activePlan) => activePlanWithTier(activePlan, billing.plans))
    .filter((activePlan): activePlan is NonNullable<ConsoleBilling["active_global_plan"]> => Boolean(activePlan));
}

function activePlanForCategory(plan: ConsoleBilling["plans"][number], activePlans: Array<NonNullable<ConsoleBilling["active_global_plan"]>>) {
  const category = normalizePlanCategory(plan.plan_category);
  return activePlans.find((activePlan) => normalizePlanCategory(activePlan.plan_category) === category) ?? null;
}

function groupPlanRibbon(plan: ConsoleBilling["plans"][number], t: TFunction<"console">) {
  const platform = plan.group_platform?.trim();
  const name = plan.group_name?.trim();
  return [platform, name].filter(Boolean).join(" · ") || t("billing.groupPlan");
}

function planQuotaLabel(plan: ConsoleBilling["plans"][number], t: TFunction<"console">) {
  if (plan.quota_period_label?.trim()) return plan.quota_period_label;
  return plan.quota_period === "month" ? t("billing.monthlyCredits") : t("billing.weeklyCredits");
}

function planQuotaCredits(plan: ConsoleBilling["plans"][number]) {
  if (plan.quota_per_period_usd && plan.quota_per_period_usd > 0) {
    return plan.quota_per_period_usd;
  }
  if (plan.quota_period === "month" && plan.monthly_max_credits > 0) {
    return plan.monthly_max_credits;
  }
  return plan.weekly_credits;
}

function planScopeDescription(plan: ConsoleBilling["plans"][number], t: TFunction<"console">) {
  const mode = plan.applicable_group_mode;
  const groups = plan.applicable_groups ?? [];
  if (!mode || mode === "all" || groups.length === 0) return null;
  const names = groups.map((group) => [group.platform, group.name || t("billing.groupFallback", { id: group.id })].filter(Boolean).join(" · "));
  return {
    title: mode === "whitelist" ? t("billing.includeGroup") : t("billing.excludeGroup"),
    names,
  };
}

function checkoutPaymentMethods(checkoutInfo: CheckoutInfo | null, billing: ConsoleBilling | null) {
  const fromCheckout = Object.values(checkoutInfo?.methods ?? {})
    .map((method) => method.payment_type)
    .filter(Boolean);
  const methods = fromCheckout.length > 0 ? fromCheckout : (billing?.payment_methods ?? [])
    .filter((method) => method.available !== false)
    .map((method) => method.type);
  if ((checkoutInfo?.fixed_offers?.length ?? 0) > 0 && !methods.includes("creem")) methods.push("creem");
  return methods;
}

function parseExchangeRates(raw?: string) {
  return (raw || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce<Record<string, number>>((rates, item) => {
      const [pair, value] = item.split("=");
      const rate = Number(value);
      if (pair && Number.isFinite(rate) && rate > 0) rates[pair.trim().toUpperCase()] = rate;
      return rates;
    }, {});
}

function convertCurrencyAmount(amount: number, fromCurrency: string | undefined, toCurrency: string, rates: Record<string, number>) {
  const from = (fromCurrency || toCurrency).trim().toUpperCase();
  const to = toCurrency.trim().toUpperCase();
  if (!amount || from === to) return amount;
  const rate = rates[`${from}:${to}`];
  return rate && rate > 0 ? amount * rate : amount;
}

function topUpCredits(amount: number, selectedTopUp: ConsoleBilling["add_ons"][number] | undefined, multiplier: number) {
  if (selectedTopUp && selectedTopUp.amount === amount) return selectedTopUp.credits;
  return amount * multiplier;
}

function statusClass(status: string) {
  switch (normalizeOrderStatus(status)) {
    case "COMPLETED":
    case "PAID":
    case "REFUNDED":
      return "border-emerald-100 bg-emerald-50 text-emerald-700";
    case "PENDING":
    case "REFUND_PENDING":
      return "border-amber-100 bg-amber-50 text-amber-700";
    case "CANCELLED":
    case "EXPIRED":
      return "border-zinc-200 bg-zinc-50 text-zinc-500";
    case "FAILED":
    case "REFUND_FAILED":
      return "border-rose-100 bg-rose-50 text-rose-700";
    default:
      return "border-zinc-200 bg-zinc-50 text-zinc-600";
  }
}

function orderPaymentSummary(item: ConsoleBilling["activity"][number], locale: string, t: TFunction<"console">) {
  const paymentCurrency = item.payment_currency || item.currency;
  const payAmount = item.pay_amount ?? item.amount;
  if (!paymentCurrency || paymentCurrency === item.currency || payAmount === item.amount) return null;
  return t("billing.paidAmount", { amount: formatMoney(payAmount, paymentCurrency, locale) });
}

function billingPeriodLabel(period: string, t: TFunction<"console">) {
  const labels: Record<string, string> = {
    day: t("billing.billingPeriod.day"),
    week: t("billing.billingPeriod.week"),
    month: t("billing.billingPeriod.month"),
    year: t("billing.billingPeriod.year"),
  };
  return labels[period.toLowerCase()] ?? period;
}

function paymentMethodLabel(method: string, t: TFunction<"console">) {
  const labels: Record<string, string> = {
    stripe: t("billing.paymentMethods.stripe"),
    creem: t("billing.paymentMethods.creem"),
    alipay: t("billing.paymentMethods.alipay"),
    wechat: t("billing.paymentMethods.wechat"),
    paypal: t("billing.paymentMethods.paypal"),
  };
  return labels[method.toLowerCase()] ?? method;
}

function orderStatusLabel(status: string | undefined, t: TFunction<"console">) {
  const normalized = normalizeOrderStatus(status);
  const labelKeys = {
    PENDING: "billing.statuses.pending",
    PAID: "billing.statuses.paid",
    RECHARGING: "billing.statuses.recharging",
    COMPLETED: "billing.statuses.completed",
    EXPIRED: "billing.statuses.expired",
    CANCELLED: "billing.statuses.cancelled",
    FAILED: "billing.statuses.failed",
    REFUND_REQUESTED: "billing.statuses.refundRequested",
    REFUNDING: "billing.statuses.refunding",
    REFUND_PENDING: "billing.statuses.refundPending",
    PARTIALLY_REFUNDED: "billing.statuses.partiallyRefunded",
    REFUNDED: "billing.statuses.refunded",
    REFUND_FAILED: "billing.statuses.refundFailed",
  } as const satisfies Record<PaymentOrderStatus, `billing.statuses.${string}`>;
  const labelKey = labelKeys[normalized as PaymentOrderStatus];
  return labelKey ? t(labelKey) : (normalized || t("billing.statuses.unknown"));
}

type PaymentDialogNotice = {
  type: "success" | "info" | "error";
  title: LocalizedMessage;
  message: LocalizedMessage;
  status?: string;
  order?: CreateOrderResult;
};

export default function Billing() {
  const { t, i18n } = useTranslation("console");
  const locale = i18n.resolvedLanguage || i18n.language || "en";
  const [billing, setBilling] = useState<ConsoleBilling | null>(null);
  const [checkoutInfo, setCheckoutInfo] = useState<CheckoutInfo | null>(null);
  const [fatalError, setFatalError] = useState<LocalizedMessage | null>(null);
  const [refreshError, setRefreshError] = useState<LocalizedMessage | null>(null);
  const [selectedTopUpAmount, setSelectedTopUpAmount] = useState<number | null>(null);
  const [customTopUpAmount, setCustomTopUpAmount] = useState("");
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState("");
  const [selectedCreemOfferId, setSelectedCreemOfferId] = useState<number | null>(null);
  const [topUpLoading, setTopUpLoading] = useState(false);
  const [topUpError, setTopUpError] = useState<LocalizedMessage | null>(null);
  const [topUpOrder, setTopUpOrder] = useState<CreateOrderResult | null>(null);
  const [planLoadingId, setPlanLoadingId] = useState<number | null>(null);
  const [planError, setPlanError] = useState<LocalizedMessage | null>(null);
  const [planOrder, setPlanOrder] = useState<CreateOrderResult | null>(null);
  const [orderActionId, setOrderActionId] = useState<number | null>(null);
  const [orderActionError, setOrderActionError] = useState<LocalizedMessage | null>(null);
  const [paymentDialog, setPaymentDialog] = useState<PaymentDialogNotice | null>(null);
  const paymentPollRef = useRef<number | null>(null);
  const paymentPollGenerationRef = useRef(0);
  const hasBillingRef = useRef(false);
  usePageTitle(t("billing.title"));

  function stopPaymentPolling() {
    paymentPollGenerationRef.current += 1;
    if (paymentPollRef.current !== null) {
      window.clearTimeout(paymentPollRef.current);
      paymentPollRef.current = null;
    }
  }

  const loadBilling = useCallback(() => {
    return Promise.allSettled([getConsoleBilling(), getPaymentCheckoutInfo()])
      .then(([billingResult, checkoutResult]) => {
        if (billingResult.status === "rejected") {
          const message = errorMessage(
            billingResult.reason,
            hasBillingRef.current ? "billingRefreshFailed" : "billingLoadFailed",
            "payment",
          );
          if (hasBillingRef.current) setRefreshError(message);
          else setFatalError(message);
          return;
        }
        const data = billingResult.value;
        setBilling(data);
        hasBillingRef.current = true;
        setSelectedTopUpAmount((current) => current || data.add_ons[0]?.amount || 0);
        if (checkoutResult.status === "fulfilled") {
          setCheckoutInfo(checkoutResult.value);
          const methods = checkoutPaymentMethods(checkoutResult.value, data);
          setSelectedPaymentMethod((current) => current || methods[0] || "");
        } else {
          const methods = checkoutPaymentMethods(null, data);
          setSelectedPaymentMethod((current) => current || methods[0] || "");
        }
        setFatalError(null);
        setRefreshError(null);
      });
  }, []);

  useEffect(() => {
    let active = true;

    loadBilling()
      .catch((reason: unknown) => {
        if (active) {
          setFatalError(errorMessage(reason, "billingLoadFailed", "payment"));
        }
      });

    return () => {
      active = false;
      stopPaymentPolling();
    };
  }, [loadBilling]);

  function beginOrderStatusPolling(order: CreateOrderResult) {
    const outTradeNo = order.out_trade_no?.trim();
    if (!outTradeNo) return;
    stopPaymentPolling();
    const generation = paymentPollGenerationRef.current;

    let totalAttempts = 0;
    let consecutiveFailures = 0;
    const checkOrder = async () => {
      if (generation !== paymentPollGenerationRef.current) return;
      totalAttempts += 1;
      try {
        const current = await verifyPaymentOrder(outTradeNo);
        if (generation !== paymentPollGenerationRef.current) return;
        consecutiveFailures = 0;
        setTopUpOrder((order) => order?.out_trade_no?.trim() === outTradeNo
          ? { ...order, status: current.status }
          : order);
        setPlanOrder((order) => order?.out_trade_no?.trim() === outTradeNo
          ? { ...order, status: current.status }
          : order);
        setPaymentDialog((dialog) => dialog?.order?.out_trade_no?.trim() === outTradeNo
          ? { ...dialog, order: { ...dialog.order, status: current.status } }
          : dialog);
        const pollingClassification = classifyPaymentPollingStatus(current.status);
        if (pollingClassification === "paid") {
          stopPaymentPolling();
          setPaymentDialog((dialog) => ({
            ...dialog,
            type: "success",
            title: translationMessage("console:billing.dialog.paymentConfirmedTitle"),
            message: translationMessage("console:billing.dialog.paymentConfirmedMessage"),
          }));
          await loadBilling();
          return;
        }
        if (pollingClassification === "terminal") {
          stopPaymentPolling();
          setPaymentDialog((dialog) => ({
            ...dialog,
            type: "error",
            title: translationMessage("console:billing.dialog.paymentNotCompletedTitle"),
            message: translationMessage("console:billing.dialog.paymentNotCompletedMessage"),
            status: normalizeOrderStatus(current.status),
          }));
          await loadBilling();
          return;
        }
        if (pollingClassification === "refund") {
          stopPaymentPolling();
          setPaymentDialog((dialog) => ({
            ...dialog,
            type: "info",
            title: translationMessage("console:billing.dialog.orderStatusUpdatedTitle"),
            message: translationMessage("console:billing.dialog.orderStatusUpdatedMessage"),
            status: normalizeOrderStatus(current.status),
          }));
          await loadBilling();
          return;
        }
      } catch {
        if (generation !== paymentPollGenerationRef.current) return;
        consecutiveFailures += 1;
        if (consecutiveFailures >= 3) {
          stopPaymentPolling();
          setPaymentDialog((dialog) => ({
            ...dialog,
            type: "error",
            title: translationMessage("console:billing.dialog.statusUnavailableTitle"),
            message: translationMessage("console:billing.dialog.statusUnavailableMessage"),
          }));
          return;
        }
      }
      if (totalAttempts >= 100) {
        stopPaymentPolling();
        setPaymentDialog((dialog) => ({
          ...dialog,
          type: "info",
          title: translationMessage("console:billing.dialog.waitingTitle"),
          message: translationMessage("console:billing.dialog.waitingMessage"),
        }));
        return;
      }
      scheduleNextCheck();
    };

    function scheduleNextCheck() {
      if (generation !== paymentPollGenerationRef.current) return;
      paymentPollRef.current = window.setTimeout(() => {
        paymentPollRef.current = null;
        void checkOrder();
      }, 3000);
    }

    scheduleNextCheck();
  }

  async function handleCreatedPaymentOrder(order: CreateOrderResult, kind: "top_up" | "plan") {
    if (kind === "top_up") {
      setTopUpOrder(order);
    } else {
      setPlanOrder(order);
    }

    const checkoutAvailable = hasCheckoutActions(order.status);
    if (checkoutAvailable && order.client_secret) {
      sessionStorage.setItem(`stripe-payment:${order.order_id}`, JSON.stringify({
        clientSecret: order.client_secret,
        resumeToken: order.resume_token,
        outTradeNo: order.out_trade_no,
      }));
      window.location.assign(`/payment/stripe?order_id=${encodeURIComponent(String(order.order_id))}`);
      return;
    }

    if (checkoutAvailable && order.pay_url && order.payment_type === "creem") {
      window.location.assign(order.pay_url);
      return;
    } else if (checkoutAvailable && order.pay_url) {
      window.open(order.pay_url, "_blank", "noopener,noreferrer");
      setPaymentDialog({
        type: "info",
        title: translationMessage("console:billing.dialog.pageOpenedTitle"),
        message: translationMessage("console:billing.dialog.pageOpenedMessage"),
        order,
      });
    } else if (checkoutAvailable && order.qr_code) {
      setPaymentDialog({
        type: "info",
        title: translationMessage("console:billing.dialog.scanTitle"),
        message: translationMessage("console:billing.dialog.scanMessage"),
        order,
      });
    }

    await loadBilling();
    if (classifyPaymentPollingStatus(order.status) === "continue") beginOrderStatusPolling(order);
  }

  async function cancelActivityOrder(item: ConsoleBilling["activity"][number]) {
    if (!isPendingOrder(item.status)) return;
    setOrderActionId(item.id);
    setOrderActionError(null);
    try {
      await cancelPaymentOrder(item.id);
      await loadBilling();
    } catch (reason) {
      setOrderActionError(errorMessage(reason, "billingCancelOrderFailed", "payment"));
    } finally {
      setOrderActionId(null);
    }
  }

  if (fatalError && !billing) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
        <h1 className="text-lg font-semibold text-rose-900">{t("billing.unavailable")}</h1>
        <p className="mt-2">{resolveLocalizedMessage(fatalError)}</p>
      </div>
    );
  }

  if (!billing) {
    return (
      <div className="flex min-h-[360px] items-center justify-center rounded-2xl border border-zinc-200 bg-white text-sm font-medium text-zinc-500">
        {t("billing.loading")}
      </div>
    );
  }

  const billingData = billing;
  const walletCurrency = billingData.wallet.currency;
  const activePlans = activeGlobalPlansWithTier(billingData);
  const activePlan = activePlans[0] ?? activePlanWithTier(billingData.active_global_plan, billingData.plans);
  const usedPercent = quotaPercent(billingData);
  const paymentMethods = checkoutPaymentMethods(checkoutInfo, billingData);
  const defaultPaymentMethod = selectedPaymentMethod || paymentMethods[0] || "stripe";
  const isCreem = defaultPaymentMethod === "creem";
  const creemOffers = checkoutInfo?.fixed_offers ?? [];
  const creemBalanceOffers = creemOffers.filter((offer) => offer.target_type === "balance" && typeof offer.credited_amount === "number");
  const selectedCreemOffer = creemBalanceOffers.find((offer) => offer.offer_id === selectedCreemOfferId) ?? creemBalanceOffers[0];
  const customAmountValue = Number(customTopUpAmount);
  const customAmountValid = Number.isFinite(customAmountValue) && customAmountValue > 0;
  const selectedTopUp = billingData.add_ons.find((item) => item.amount === selectedTopUpAmount);
  const previewAmount = isCreem ? selectedCreemOffer?.credited_amount ?? 0 : customAmountValid ? customAmountValue : selectedTopUp?.amount ?? billingData.add_ons[0]?.amount ?? 0;
  const rechargeMultiplier = checkoutInfo?.balance_recharge_multiplier && checkoutInfo.balance_recharge_multiplier > 0
    ? checkoutInfo.balance_recharge_multiplier
    : 1;
  const previewCredits = isCreem ? selectedCreemOffer?.credited_amount ?? 0 : topUpCredits(previewAmount, selectedTopUp, rechargeMultiplier);
  const exchangeRates = parseExchangeRates(checkoutInfo?.currency_exchange_rates);
  const selectedMethodLimits = checkoutInfo?.methods?.[defaultPaymentMethod];
  const methodCurrency = isCreem ? selectedCreemOffer?.payment_currency || walletCurrency : selectedMethodLimits?.currency || walletCurrency;
  const rawCheckoutMin = selectedMethodLimits?.single_min ?? checkoutInfo?.global_min ?? 0;
  const rawCheckoutMax = selectedMethodLimits?.single_max ?? checkoutInfo?.global_max ?? 0;
  const checkoutMin = convertCurrencyAmount(rawCheckoutMin, methodCurrency, walletCurrency, exchangeRates);
  const checkoutMax = convertCurrencyAmount(rawCheckoutMax, methodCurrency, walletCurrency, exchangeRates);
  const topUpOutOfRange = previewAmount <= 0 || (!isCreem && ((checkoutMin > 0 && previewAmount < checkoutMin) || (checkoutMax > 0 && previewAmount > checkoutMax)));

  async function buyTopUp() {
    if (topUpOutOfRange || !defaultPaymentMethod) return;
    setTopUpLoading(true);
    setTopUpError(null);
    setTopUpOrder(null);

    try {
      const result = await createPaymentOrder({
        amount: previewAmount,
        amount_currency: walletCurrency,
        payment_type: defaultPaymentMethod,
		offer_id: isCreem ? selectedCreemOffer?.offer_id : undefined,
        order_type: "balance",
        payment_source: "hosted_redirect",
        return_url: `${window.location.origin}/payment/result`,
        is_mobile: false,
      });
      await handleCreatedPaymentOrder(result, "top_up");
    } catch (reason) {
      setTopUpError(errorMessage(reason, "billingCreateTopUpOrderFailed", "payment"));
    } finally {
      setTopUpLoading(false);
    }
  }

  async function buyPlan(plan: ConsoleBilling["plans"][number]) {
    const groupScoped = isGroupPlan(plan);
    const categoryActivePlan = groupScoped ? null : activePlanForCategory(plan, activePlans);
    if (!groupScoped && categoryActivePlan?.plan_id === plan.id) return;
    if (!groupScoped && categoryActivePlan && !isHigherTierPlan(plan, categoryActivePlan)) {
      setPlanError(translationMessage("console:billing.planCoveredError"));
      return;
    }
    setPlanLoadingId(plan.id);
    setPlanError(null);
    setPlanOrder(null);

    try {
	  const creemPlanOffer = isCreem ? creemOffers.find((offer) => offer.plan_id === plan.id && offer.target_type === (groupScoped ? "group_plan" : "global_plan")) : undefined;
	  if (isCreem && (!creemPlanOffer || categoryActivePlan)) {
        setPlanError(translationMessage("console:billing.planUnavailableCreemError"));
        return;
      }
      const upgradeQuote = !isCreem && !groupScoped && categoryActivePlan ? await getGlobalPlanUpgradeQuote(plan.id) : null;
      const orderAmount = upgradeQuote?.upgrade_price ?? plan.price;
      if (orderAmount <= 0) {
        setPlanError(translationMessage("console:billing.planCoveredError"));
        return;
      }
      const result = await createPaymentOrder({
        amount: orderAmount,
        amount_currency: plan.currency || walletCurrency,
        payment_type: defaultPaymentMethod,
		offer_id: creemPlanOffer?.offer_id,
        order_type: groupScoped ? "subscription" : upgradeQuote ? "global_plan_upgrade" : "global_plan",
        plan_id: plan.id,
        payment_source: "hosted_redirect",
        return_url: `${window.location.origin}/payment/result`,
        is_mobile: false,
      });
      await handleCreatedPaymentOrder(result, "plan");
    } catch (reason) {
      setPlanError(errorMessage(reason, "billingCreatePlanOrderFailed", "payment"));
    } finally {
      setPlanLoadingId(null);
    }
  }

  return (
    <div className="space-y-12">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">{t("billing.title")}</h1>
        <p className="text-zinc-500 text-sm">{t("billing.description")}</p>
      </div>

      {refreshError ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
          <span>{resolveLocalizedMessage(refreshError)}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadBilling()}
              className="rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-bold text-rose-800 hover:bg-rose-100"
            >
              {t("billing.retry")}
            </button>
            <button
              type="button"
              onClick={() => setRefreshError(null)}
              aria-label={t("billing.dismissRefreshError")}
              className="rounded-lg p-1.5 text-rose-600 hover:bg-rose-100"
            >
              <XCircle size={18} weight="bold" />
            </button>
          </div>
        </div>
      ) : null}

      {paymentDialog && (
        <PaymentStatusDialog
          notice={paymentDialog}
          onClose={() => setPaymentDialog(null)}
        />
      )}

      {/* Credits Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="p-6 bg-zinc-900 rounded-2xl text-white shadow-xl relative overflow-hidden group">
          <Wallet size={80} className="absolute -right-4 -bottom-4 text-white/5" />
          <span className="text-xs font-bold uppercase tracking-widest text-zinc-500">{t("billing.availableBalance")}</span>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold">{formatCredits(billingData.wallet.available_balance, locale)}</span>
            <span className="text-xs font-medium text-zinc-400 uppercase tracking-widest">{t("billing.credits")}</span>
          </div>
          <p className="mt-4 text-[10px] text-zinc-500 uppercase tracking-tighter">{t("billing.includesAddOnCredits", { credits: formatCredits(billingData.wallet.add_on_credits, locale) })}</p>
          <p className="mt-1 text-[10px] text-zinc-500 uppercase tracking-tighter">{t("billing.planExpires", { date: formatDate(activePlan?.expires_at, locale, t) })}</p>
        </div>

        <div className="p-6 bg-white border border-zinc-200 rounded-2xl shadow-sm">
          <span className="text-xs font-bold uppercase tracking-widest text-zinc-500">{t("billing.weeklyPlanQuota")}</span>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-2xl font-bold text-zinc-900">{usedPercent}% <span className="text-sm font-normal text-zinc-400">{t("billing.used")}</span></span>
            <div className="h-2 w-24 bg-zinc-100 rounded-full overflow-hidden" role="progressbar" aria-label={t("billing.quotaUsageA11y")} aria-valuenow={usedPercent} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full bg-rose-500" style={{ width: `${usedPercent}%` }} />
            </div>
          </div>
          <p className="mt-4 text-[10px] text-zinc-400 uppercase tracking-tighter flex items-center gap-1">
            <Clock size={12} />
            {t("billing.resetsOn", { date: formatDate(activePlan?.period_end, locale, t) })}
          </p>
        </div>

        <div className="p-6 bg-white border border-zinc-200 rounded-2xl shadow-sm">
          <span className="text-xs font-bold uppercase tracking-widest text-zinc-500">{t("billing.activePlan")}</span>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-2xl font-bold text-zinc-900">{activePlan?.name ?? t("billing.noPlan")}</span>
            <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold border border-emerald-100 uppercase tracking-widest">{t("billing.active")}</span>
          </div>
          <p className="mt-4 text-[10px] text-zinc-400 uppercase tracking-tighter italic">{t("billing.expiresOn", { date: formatDate(activePlan?.expires_at, locale, t) })}</p>
        </div>
      </div>

      {/* Subscription Plans */}
      <div className="space-y-6">
        <div>
          <h3 className="text-xl font-bold tracking-tight text-zinc-900">{t("billing.plansTitle")}</h3>
          <p className="text-sm text-zinc-500 mt-1">{t("billing.plansDescription")}</p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {billingData.plans.map(plan => {
            const groupScoped = isGroupPlan(plan);
            const scopeDescription = planScopeDescription(plan, t);
            const categoryActivePlan = groupScoped ? null : activePlanForCategory(plan, activePlans);
            const isCurrent = !groupScoped && categoryActivePlan?.plan_id === plan.id;
            const isCoveredByCurrentGlobalPlan = !groupScoped && !isCurrent && categoryActivePlan ? !isHigherTierPlan(plan, categoryActivePlan) : false;
			const creemPlanAvailable = !isCreem || (!categoryActivePlan && creemOffers.some((offer) => offer.plan_id === plan.id && offer.target_type === (groupScoped ? "group_plan" : "global_plan")));
            return (
            <div key={plan.id} className={`p-6 rounded-2xl border transition-all relative overflow-hidden ${isCurrent ? 'console-inverted-panel bg-zinc-900 text-white border-zinc-900 shadow-xl' : 'bg-white border-zinc-200 hover:border-zinc-300'}`}>
              {groupScoped && (
                <div
                  className="absolute -right-10 top-5 w-40 rotate-45 border-y border-white/30 bg-zinc-900 px-3 py-1 text-center text-[9px] font-bold uppercase tracking-[0.16em] text-white shadow-sm"
                  title={groupPlanRibbon(plan, t)}
                  aria-label={t("billing.groupPlanA11y", { name: groupPlanRibbon(plan, t) })}
                >
                  <span className="block truncate">{groupPlanRibbon(plan, t)}</span>
                </div>
              )}
              {isCurrent && (
                <span className="console-inverted-label mb-4 inline-flex bg-zinc-100 text-zinc-900 px-2 py-1 rounded text-[9px] font-bold uppercase tracking-widest border border-zinc-200">{t("billing.currentPlan")}</span>
              )}
              <h4 className="text-lg font-bold">{plan.name}</h4>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-3xl font-bold">{formatMoney(plan.price, plan.currency, locale)}</span>
                <span className={`text-xs ${isCurrent ? 'text-zinc-400' : 'text-zinc-500'}`}>/{billingPeriodLabel(plan.billing_period, t)}</span>
              </div>
              <div className="mt-6 space-y-3">
                <div className={`p-3 rounded-xl border ${isCurrent ? 'console-inverted-subtle bg-white/5 border-white/10' : 'bg-zinc-50 border-zinc-100'}`}>
                  <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest mb-1">
                    <span className={isCurrent ? 'text-zinc-400' : 'text-zinc-500'}>{planQuotaLabel(plan, t)}</span>
                    <span className={isCurrent ? 'console-inverted-strong text-white' : 'text-zinc-900'}>{formatCredits(planQuotaCredits(plan), locale)}</span>
                  </div>
                </div>
                {scopeDescription && (
                  <div className={`rounded-xl border p-3 text-xs ${isCurrent ? 'console-inverted-subtle border-white/10 bg-white/5 text-zinc-300' : 'border-zinc-100 bg-zinc-50 text-zinc-600'}`}>
                    <p className="font-bold">{scopeDescription.title}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {scopeDescription.names.map((name) => (
                        <span key={name} className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-widest ${isCurrent ? 'console-inverted-label bg-white/10 text-zinc-200' : 'bg-white text-zinc-500 border border-zinc-200'}`}>
                          {name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <ul className="mt-6 space-y-3">
                {plan.features.map(feature => (
                  <li key={feature} className="flex items-center gap-2 text-xs">
                    <CheckCircle size={16} weight="fill" className={isCurrent ? 'text-white/20' : 'text-zinc-200'} />
                    <span className={isCurrent ? 'text-zinc-300' : 'text-zinc-500'}>{feature}</span>
                  </li>
                ))}
              </ul>
              {isCurrent && activePlan?.expires_at && (
                <p className="console-inverted-subtle mt-5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-300">
                  {t("billing.expires", { date: formatDate(activePlan.expires_at, locale, t) })}
                </p>
              )}
              {isCoveredByCurrentGlobalPlan ? (
                <p className="mt-8 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-center text-sm font-bold text-zinc-500">
                  {t("billing.includedInCurrentPlan")}
                </p>
              ) : (
                <button
                  onClick={() => void buyPlan(plan)}
				  disabled={planLoadingId === plan.id || isCurrent || !creemPlanAvailable}
                  className={`mt-8 w-full rounded-xl py-2.5 text-sm font-bold transition-all disabled:cursor-not-allowed disabled:opacity-60 ${isCurrent ? 'bg-white text-zinc-900 hover:bg-zinc-100' : 'bg-zinc-900 text-white hover:bg-zinc-800'}`}
                >
				  {planLoadingId === plan.id ? t("billing.creatingOrder") : isCurrent ? t("billing.currentPlan") : !creemPlanAvailable ? t("billing.unavailableWithCreem") : t("billing.upgradeTo", { name: plan.name })}
                </button>
              )}
            </div>
          )})}
        </div>
        {planError && (
          <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-700">
            {resolveLocalizedMessage(planError)}
          </p>
        )}
        {planOrder && (
          <PaymentOrderNotice order={planOrder} currency={planOrder.currency || billingData.wallet.currency} locale={locale} />
        )}
      </div>

      {/* Add-on Top-up */}
      <div className="grid grid-cols-1 gap-6 border-t border-zinc-100 pt-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <div className="rounded-[2rem] border border-zinc-200 bg-white p-8 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="font-bold text-zinc-900">{t("billing.topUpTitle")}</h3>
              <p className="mt-1 text-xs text-zinc-500">{t("billing.topUpDescription")}</p>
            </div>
            {(checkoutMin > 0 || checkoutMax > 0) && (
              <p className="rounded-full bg-zinc-50 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                {checkoutMin > 0 ? t("billing.minimum", { amount: formatMoney(checkoutMin, billingData.wallet.currency, locale) }) : t("billing.noMinimum")}
                {" · "}
                {checkoutMax > 0 ? t("billing.maximum", { amount: formatMoney(checkoutMax, billingData.wallet.currency, locale) }) : t("billing.noMaximum")}
              </p>
            )}
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
			{(isCreem ? creemBalanceOffers : billingData.add_ons).map((item) => {
			  const amount = isCreem && "credited_amount" in item ? item.credited_amount ?? 0 : "amount" in item ? item.amount : 0;
			  const credits = isCreem && "credited_amount" in item ? item.credited_amount ?? 0 : "credits" in item ? item.credits : 0;
			  const selected = isCreem ? selectedCreemOffer?.offer_id === ("offer_id" in item ? item.offer_id : 0) : selectedTopUp?.amount === amount && !customAmountValid;
			  return (
              <button
				key={isCreem && "offer_id" in item ? item.offer_id : amount}
                onClick={() => {
				  if (isCreem && "offer_id" in item) setSelectedCreemOfferId(item.offer_id);
				  else setSelectedTopUpAmount(amount);
                  setCustomTopUpAmount("");
                  setTopUpError(null);
                  setTopUpOrder(null);
                }}
                className={`min-w-28 rounded-2xl border px-5 py-4 text-left font-bold transition-all ${
				  selected
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : "border-zinc-200 text-zinc-900 hover:border-zinc-900 hover:bg-zinc-50"
                }`}
              >
				<span className="block">{isCreem && "pay_amount" in item ? formatMoney(item.pay_amount, item.payment_currency, locale) : formatMoney(amount, "currency" in item ? item.currency : walletCurrency, locale)}</span>
				<span className={`mt-1 block text-[10px] uppercase tracking-widest ${selected ? "text-zinc-400" : "text-zinc-500"}`}>
				  {t("billing.creditAmount", { credits: formatCredits(credits, locale) })}
                </span>
              </button>
			)})}
			{!isCreem && <label className="min-w-56 flex-1 rounded-2xl border border-zinc-200 px-5 py-4 transition-all focus-within:border-zinc-900">
              <span className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500">{t("billing.customAmount")}</span>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-lg font-bold text-zinc-400">{currencySymbol(walletCurrency, locale)}</span>
                <input
                  value={customTopUpAmount}
                  onChange={(event) => {
                    setCustomTopUpAmount(event.target.value);
                    setTopUpError(null);
                    setTopUpOrder(null);
                  }}
                  inputMode="decimal"
                  placeholder={t("billing.enterAmount")}
                  className="w-full bg-transparent text-lg font-bold text-zinc-900 outline-none placeholder:text-zinc-300"
                />
              </div>
			</label>}
          </div>
        </div>

        <div className="console-inverted-panel console-payment-preview rounded-[2rem] border border-zinc-200 bg-zinc-950 p-8 text-white shadow-xl">
          <div className="flex items-center justify-between">
            <h3 className="font-bold">{t("billing.paymentPreview")}</h3>
            <CreditCard size={24} className="text-zinc-500" />
          </div>
          <div className="mt-6 space-y-4 text-sm">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <span className="text-zinc-400">{t("billing.item")}</span>
              <span className="font-bold">{t("billing.addOnCredits")}</span>
            </div>
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <span className="text-zinc-400">{t("billing.estimatedCredits")}</span>
              <span className="font-bold">{formatCredits(previewCredits, locale)}</span>
            </div>
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <span className="text-zinc-400">{t("billing.amountDue")}</span>
			  <span className="text-xl font-bold">{isCreem && selectedCreemOffer ? formatMoney(selectedCreemOffer.pay_amount, selectedCreemOffer.payment_currency, locale) : formatMoney(previewAmount, billingData.wallet.currency, locale)}</span>
            </div>
            <label className="block">
              <span className="text-xs font-bold uppercase tracking-widest text-zinc-500">{t("billing.paymentMethod")}</span>
              <select
                value={defaultPaymentMethod}
				onChange={(event) => {
				  setSelectedPaymentMethod(event.target.value);
				  if (event.target.value === "creem") setCustomTopUpAmount("");
				}}
                className="console-inverted-subtle mt-2 w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-bold text-white outline-none focus:border-white/30"
              >
                {paymentMethods.map((method) => (
                  <option key={method} value={method} className="text-zinc-900">
                    {paymentMethodLabel(method, t)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            onClick={buyTopUp}
            disabled={topUpOutOfRange || !defaultPaymentMethod || topUpLoading}
            className="console-inverted-action mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-white py-4 font-bold text-zinc-950 transition-all hover:bg-zinc-100 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
          >
            {topUpLoading ? t("billing.creatingOrder") : t("billing.createPaymentOrder")}
            <ArrowUpRight size={18} weight="bold" />
          </button>
          {topUpOutOfRange && (
            <p className="mt-3 text-xs font-medium text-amber-300">
              {t("billing.paymentRangeError")}
            </p>
          )}
          {topUpError && (
            <p className="mt-3 rounded-xl border border-rose-400/40 bg-rose-500/10 p-3 text-xs font-medium text-rose-200">
              {resolveLocalizedMessage(topUpError)}
            </p>
          )}
          {topUpOrder && (
            <div className="mt-4">
              <PaymentOrderNotice order={topUpOrder} currency={topUpOrder.currency || billingData.wallet.currency} locale={locale} />
            </div>
          )}
          <p className="mt-4 text-center text-[10px] uppercase tracking-widest text-zinc-500">
            {t("billing.securePaymentVia", { provider: defaultPaymentMethod ? paymentMethodLabel(defaultPaymentMethod, t) : t("billing.configuredProvider") })}
          </p>
        </div>
      </div>

      {/* Main Content Split */}
      <div className="grid grid-cols-1 gap-8 pt-2">
        <div className="space-y-8">
          {/* Billing Table */}
          <div className="bg-white border border-zinc-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-zinc-100 flex items-center justify-between">
              <h3 className="font-bold text-zinc-900">{t("billing.activityTitle")}</h3>
              <button className="text-xs font-bold text-zinc-500 hover:text-zinc-900 flex items-center gap-1.5">
                <DownloadSimple size={14} weight="bold" />
                {t("billing.exportCsv")}
              </button>
            </div>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-zinc-50/50 border-b border-zinc-200">
                  <th className="px-6 py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-[0.2em]">{t("billing.date")}</th>
                  <th className="px-6 py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-[0.2em]">{t("billing.reference")}</th>
                  <th className="px-6 py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-[0.2em]">{t("billing.type")}</th>
                  <th className="px-6 py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-[0.2em]">{t("billing.status")}</th>
                  <th className="px-6 py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-[0.2em]">{t("billing.amount")}</th>
                  <th className="px-6 py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-[0.2em] text-right">{t("billing.actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {billingData.activity.map((item) => (
                  <tr key={item.id} className="hover:bg-zinc-50/50 transition-colors">
                    <td className="px-6 py-4 text-sm text-zinc-500">{formatDate(item.date, locale, t)}</td>
                    <td className="px-6 py-4 text-sm font-mono text-zinc-400">{item.reference}</td>
                    <td className="px-6 py-4 text-sm font-medium text-zinc-900">{item.label}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest ${statusClass(item.status)}`}>
                        {orderStatusLabel(item.status, t)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm font-bold text-zinc-900">
                      <span>{formatMoney(item.amount, item.currency, locale)}</span>
                      {orderPaymentSummary(item, locale, t) ? (
                        <span className="mt-1 block text-[10px] font-semibold uppercase tracking-widest text-zinc-400">{orderPaymentSummary(item, locale, t)}</span>
                      ) : null}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex justify-end gap-2">
                      {isPendingOrder(item.status) && item.pay_url ? (
                        <a href={item.pay_url} className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-3 py-2 text-xs font-bold text-zinc-600 transition-all hover:border-zinc-900 hover:text-zinc-900">
                          {t("billing.payAgain")}
                          <ArrowUpRight size={14} weight="bold" />
                        </a>
                      ) : null}
                      {isPendingOrder(item.status) ? (
                        <button
                          type="button"
                          aria-label={t("billing.cancelOrderA11y", { reference: item.reference })}
                          onClick={() => void cancelActivityOrder(item)}
                          disabled={orderActionId === item.id}
                          className="inline-flex items-center gap-1 rounded-lg border border-rose-100 px-3 py-2 text-xs font-bold text-rose-600 transition-all hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <XCircle size={14} weight="bold" />
                          {t("billing.cancel")}
                        </button>
                      ) : null}
                      <button aria-label={t("billing.viewReceiptA11y", { reference: item.reference })} className="p-2 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-lg transition-all">
                        <Receipt size={18} />
                      </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {orderActionError && (
              <p className="border-t border-rose-100 bg-rose-50 px-6 py-3 text-xs font-medium text-rose-700">
                {resolveLocalizedMessage(orderActionError)}
              </p>
            )}
          </div>

          {/* FAQ or Info */}
          <div className="p-8 bg-zinc-50 border border-zinc-200 rounded-[2rem] flex items-start gap-6">
            <div className="p-3 bg-white rounded-xl border border-zinc-200 shadow-sm text-zinc-400">
              <Lightning size={24} weight="fill" className="text-amber-500" />
            </div>
            <div className="space-y-2">
              <h4 className="font-bold text-zinc-900">{t("billing.faqTitle")}</h4>
              <p className="text-sm text-zinc-500 leading-relaxed">
                {t("billing.faqBeforePlan")} <strong className="text-zinc-900">{t("billing.faqPlanCredits")}</strong>.
                {" "}{t("billing.faqBeforeWallet")} <strong className="text-zinc-900">{t("billing.faqWalletBalance")}</strong> {t("billing.faqAfterWallet")}
                {" "}{t("billing.faqLimits")}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PaymentOrderNotice({ order, currency, locale }: { order: CreateOrderResult; currency: string; locale: string }) {
  const { t } = useTranslation("console");
  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
      <p className="font-bold">{t("billing.orderNotice.created", { id: order.order_id })}</p>
      <p className="mt-1 text-xs text-emerald-700">{t("billing.orderNotice.amount", { amount: formatMoney(order.pay_amount, order.payment_currency || order.currency || currency, locale) })}</p>
      {hasCheckoutActions(order.status) && order.pay_url ? (
        <a href={order.pay_url} className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-emerald-900 underline">
          {t("billing.continuePayment")}
          <ArrowUpRight size={14} weight="bold" />
        </a>
      ) : hasCheckoutActions(order.status) && order.qr_code ? (
        <div className="mt-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-700">{t("billing.qrCodePayload")}</p>
          <p className="mt-1 break-all text-xs font-mono text-emerald-800">{order.qr_code}</p>
        </div>
      ) : hasCheckoutActions(order.status) ? (
        <p className="mt-3 text-xs text-emerald-700">{t("billing.orderNotice.classicPayment")}</p>
      ) : null}
    </div>
  );
}

function PaymentStatusDialog({ notice, onClose }: { notice: PaymentDialogNotice; onClose: () => void }) {
  const { t, i18n } = useTranslation("console");
  const locale = i18n.resolvedLanguage || i18n.language || "en";
  const toneClass = notice.type === "success"
    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
    : notice.type === "error"
      ? "border-rose-200 bg-rose-50 text-rose-900"
      : "border-zinc-200 bg-white text-zinc-900";
  const helperClass = notice.type === "error" ? "text-rose-700" : "text-zinc-600";
  const message = notice.status && notice.message.kind === "translation"
    ? resolveLocalizedMessage({
        ...notice.message,
        values: { ...notice.message.values, status: orderStatusLabel(notice.status, t) },
      })
    : resolveLocalizedMessage(notice.message);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useFocusTrap({
    active: true,
    containerRef: dialogRef,
    initialFocusRef: closeButtonRef,
    onEscape: onClose,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 px-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-status-title"
        tabIndex={-1}
        className={`w-full max-w-md rounded-[2rem] border p-6 shadow-2xl ${toneClass}`}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p id="payment-status-title" className="text-lg font-bold">{resolveLocalizedMessage(notice.title)}</p>
            <p className={`mt-2 text-sm leading-6 ${helperClass}`}>{message}</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-zinc-400 transition-all hover:bg-zinc-100 hover:text-zinc-900"
            aria-label={t("billing.dismissPaymentDialog")}
          >
            <XCircle size={22} weight="bold" />
          </button>
        </div>

        {notice.order ? (
          <div className="mt-5 rounded-2xl border border-black/5 bg-white/70 p-4 text-sm">
            <div className="flex items-center justify-between gap-4">
              <span className="text-zinc-500">{t("billing.order")}</span>
              <span className="font-mono font-bold text-zinc-900">#{notice.order.order_id}</span>
            </div>
            <div className="mt-3 flex items-center justify-between gap-4">
              <span className="text-zinc-500">{t("billing.amount")}</span>
              <span className="font-bold text-zinc-900">{formatMoney(notice.order.pay_amount, notice.order.payment_currency || notice.order.currency || "USD", locale)}</span>
            </div>
            {notice.type === "info" && hasCheckoutActions(notice.order.status) && notice.order.pay_url ? (
              <a
                href={notice.order.pay_url}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-zinc-900 px-4 py-3 text-sm font-bold text-white transition-all hover:bg-zinc-800"
              >
                {t("billing.continuePayment")}
                <ArrowUpRight size={16} weight="bold" />
              </a>
            ) : notice.type === "info" && hasCheckoutActions(notice.order.status) && notice.order.qr_code ? (
              <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
                <p className="text-xs font-bold uppercase tracking-widest text-zinc-400">{t("billing.qrCodePayload")}</p>
                <p className="mt-2 break-all font-mono text-xs text-zinc-700">{notice.order.qr_code}</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
