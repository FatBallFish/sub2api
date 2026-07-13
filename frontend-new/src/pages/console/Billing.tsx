import { useCallback, useEffect, useRef, useState } from "react";
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

function formatMoney(value: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(value?: string) {
  if (!value) return "Not scheduled";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(value));
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

function groupPlanRibbon(plan: ConsoleBilling["plans"][number]) {
  const platform = plan.group_platform?.trim();
  const name = plan.group_name?.trim();
  return [platform, name].filter(Boolean).join(" · ") || "Group Plan";
}

function planQuotaLabel(plan: ConsoleBilling["plans"][number]) {
  if (plan.quota_period_label?.trim()) return plan.quota_period_label;
  return plan.quota_period === "month" ? "Monthly Credits" : "Weekly Credits";
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

function planScopeDescription(plan: ConsoleBilling["plans"][number]) {
  const mode = plan.applicable_group_mode;
  const groups = plan.applicable_groups ?? [];
  if (!mode || mode === "all" || groups.length === 0) return null;
  const names = groups.map((group) => [group.platform, group.name || `Group ${group.id}`].filter(Boolean).join(" · "));
  return {
    title: mode === "whitelist" ? "Include Group" : "Exclude Group",
    names,
  };
}

function checkoutPaymentMethods(checkoutInfo: CheckoutInfo | null, billing: ConsoleBilling | null) {
  const fromCheckout = Object.values(checkoutInfo?.methods ?? {})
    .map((method) => method.payment_type)
    .filter(Boolean);
  if (fromCheckout.length > 0) return fromCheckout;
  return (billing?.payment_methods ?? [])
    .filter((method) => method.available !== false)
    .map((method) => method.type);
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

function normalizeOrderStatus(status?: string) {
  return (status || "").trim().toUpperCase();
}

function statusClass(status: string) {
  switch (normalizeOrderStatus(status)) {
    case "COMPLETED":
    case "PAID":
      return "border-emerald-100 bg-emerald-50 text-emerald-700";
    case "PENDING":
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

function isPendingOrder(status?: string) {
  return normalizeOrderStatus(status) === "PENDING";
}

function isPaidOrderStatus(status?: string) {
  const normalized = normalizeOrderStatus(status);
  return normalized === "COMPLETED" || normalized === "PAID";
}

function isTerminalOrderStatus(status?: string) {
  const normalized = normalizeOrderStatus(status);
  return normalized === "FAILED" || normalized === "CANCELLED" || normalized === "EXPIRED";
}

function orderPaymentSummary(item: ConsoleBilling["activity"][number]) {
  const paymentCurrency = item.payment_currency || item.currency;
  const payAmount = item.pay_amount ?? item.amount;
  if (!paymentCurrency || paymentCurrency === item.currency || payAmount === item.amount) return null;
  return `Paid ${formatMoney(payAmount, paymentCurrency)}`;
}

type PaymentDialogNotice = {
  type: "success" | "info" | "error";
  title: string;
  message: string;
  order?: CreateOrderResult;
};

export default function Billing() {
  const [billing, setBilling] = useState<ConsoleBilling | null>(null);
  const [checkoutInfo, setCheckoutInfo] = useState<CheckoutInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedTopUpAmount, setSelectedTopUpAmount] = useState<number | null>(null);
  const [customTopUpAmount, setCustomTopUpAmount] = useState("");
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState("");
  const [topUpLoading, setTopUpLoading] = useState(false);
  const [topUpError, setTopUpError] = useState<string | null>(null);
  const [topUpOrder, setTopUpOrder] = useState<CreateOrderResult | null>(null);
  const [planLoadingId, setPlanLoadingId] = useState<number | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planOrder, setPlanOrder] = useState<CreateOrderResult | null>(null);
  const [orderActionId, setOrderActionId] = useState<number | null>(null);
  const [orderActionError, setOrderActionError] = useState<string | null>(null);
  const [paymentDialog, setPaymentDialog] = useState<PaymentDialogNotice | null>(null);
  const paymentPollRef = useRef<number | null>(null);

  function stopPaymentPolling() {
    if (paymentPollRef.current !== null) {
      window.clearInterval(paymentPollRef.current);
      paymentPollRef.current = null;
    }
  }

  const loadBilling = useCallback(() => {
    return Promise.allSettled([getConsoleBilling(), getPaymentCheckoutInfo()])
      .then(([billingResult, checkoutResult]) => {
        if (billingResult.status === "rejected") {
          setError(billingResult.reason instanceof Error ? billingResult.reason.message : "Unable to load billing.");
          return;
        }
        const data = billingResult.value;
        setBilling(data);
        setSelectedTopUpAmount((current) => current || data.add_ons[0]?.amount || 0);
        if (checkoutResult.status === "fulfilled") {
          setCheckoutInfo(checkoutResult.value);
          const methods = checkoutPaymentMethods(checkoutResult.value, data);
          setSelectedPaymentMethod((current) => current || methods[0] || "");
        } else {
          const methods = checkoutPaymentMethods(null, data);
          setSelectedPaymentMethod((current) => current || methods[0] || "");
        }
        setError(null);
      });
  }, []);

  useEffect(() => {
    let active = true;

    loadBilling()
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : "Unable to load billing.");
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

    let attempts = 0;
    const checkOrder = async () => {
      attempts += 1;
      try {
        const current = await verifyPaymentOrder(outTradeNo);
        if (isPaidOrderStatus(current.status)) {
          stopPaymentPolling();
          setPaymentDialog((dialog) => ({
            ...dialog,
            type: "success",
            title: "Payment confirmed",
            message: "Your order is paid. Credits and subscriptions are being refreshed.",
          }));
          await loadBilling();
          return;
        }
        if (isTerminalOrderStatus(current.status)) {
          stopPaymentPolling();
          setPaymentDialog((dialog) => ({
            ...dialog,
            type: "error",
            title: "Payment not completed",
            message: `Order status changed to ${normalizeOrderStatus(current.status)}.`,
          }));
          await loadBilling();
          return;
        }
        if (attempts >= 100) {
          stopPaymentPolling();
          setPaymentDialog((dialog) => ({
            ...dialog,
            type: "info",
            title: "Still waiting for payment",
            message: "The order is still pending. You can use Pay again from the activity table later.",
          }));
        }
      } catch {
        if (attempts >= 3) {
          stopPaymentPolling();
          setPaymentDialog((dialog) => ({
            ...dialog,
            type: "error",
            title: "Payment status unavailable",
            message: "We could not refresh this order status. Please check the activity table later.",
          }));
        }
      }
    };

    paymentPollRef.current = window.setInterval(() => {
      void checkOrder();
    }, 3000);
  }

  async function handleCreatedPaymentOrder(order: CreateOrderResult, kind: "top_up" | "plan") {
    if (kind === "top_up") {
      setTopUpOrder(order);
    } else {
      setPlanOrder(order);
    }

    if (order.pay_url) {
      window.open(order.pay_url, "_blank", "noopener,noreferrer");
      setPaymentDialog({
        type: "info",
        title: "Payment page opened",
        message: "Complete payment in the new tab. This page will keep watching the order status.",
        order,
      });
    } else if (order.qr_code) {
      setPaymentDialog({
        type: "info",
        title: "Scan to pay",
        message: "Use your payment app to scan the QR code. This page will keep watching the order status.",
        order,
      });
    }

    await loadBilling();
    beginOrderStatusPolling(order);
  }

  async function cancelActivityOrder(item: ConsoleBilling["activity"][number]) {
    if (!isPendingOrder(item.status)) return;
    setOrderActionId(item.id);
    setOrderActionError(null);
    try {
      await cancelPaymentOrder(item.id);
      await loadBilling();
    } catch (reason) {
      setOrderActionError(reason instanceof Error ? reason.message : "Unable to cancel order.");
    } finally {
      setOrderActionId(null);
    }
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
        <h1 className="text-lg font-semibold text-rose-900">Billing unavailable</h1>
        <p className="mt-2">{error}</p>
      </div>
    );
  }

  if (!billing) {
    return (
      <div className="flex min-h-[360px] items-center justify-center rounded-2xl border border-zinc-200 bg-white text-sm font-medium text-zinc-500">
        Loading billing...
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
  const customAmountValue = Number(customTopUpAmount);
  const customAmountValid = Number.isFinite(customAmountValue) && customAmountValue > 0;
  const selectedTopUp = billingData.add_ons.find((item) => item.amount === selectedTopUpAmount);
  const previewAmount = customAmountValid ? customAmountValue : selectedTopUp?.amount ?? billingData.add_ons[0]?.amount ?? 0;
  const rechargeMultiplier = checkoutInfo?.balance_recharge_multiplier && checkoutInfo.balance_recharge_multiplier > 0
    ? checkoutInfo.balance_recharge_multiplier
    : 1;
  const previewCredits = topUpCredits(previewAmount, selectedTopUp, rechargeMultiplier);
  const exchangeRates = parseExchangeRates(checkoutInfo?.currency_exchange_rates);
  const selectedMethodLimits = checkoutInfo?.methods?.[defaultPaymentMethod];
  const methodCurrency = selectedMethodLimits?.currency || walletCurrency;
  const rawCheckoutMin = selectedMethodLimits?.single_min ?? checkoutInfo?.global_min ?? 0;
  const rawCheckoutMax = selectedMethodLimits?.single_max ?? checkoutInfo?.global_max ?? 0;
  const checkoutMin = convertCurrencyAmount(rawCheckoutMin, methodCurrency, walletCurrency, exchangeRates);
  const checkoutMax = convertCurrencyAmount(rawCheckoutMax, methodCurrency, walletCurrency, exchangeRates);
  const topUpOutOfRange = previewAmount <= 0 || (checkoutMin > 0 && previewAmount < checkoutMin) || (checkoutMax > 0 && previewAmount > checkoutMax);

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
        order_type: "balance",
        payment_source: "hosted_redirect",
        return_url: `${window.location.origin}/payment/result`,
        is_mobile: false,
      });
      await handleCreatedPaymentOrder(result, "top_up");
    } catch (reason) {
      setTopUpError(reason instanceof Error ? reason.message : "Unable to create payment order.");
    } finally {
      setTopUpLoading(false);
    }
  }

  async function buyPlan(plan: ConsoleBilling["plans"][number]) {
    const groupScoped = isGroupPlan(plan);
    const categoryActivePlan = groupScoped ? null : activePlanForCategory(plan, activePlans);
    if (!groupScoped && categoryActivePlan?.plan_id === plan.id) return;
    if (!groupScoped && categoryActivePlan && !isHigherTierPlan(plan, categoryActivePlan)) {
      setPlanError("This plan is already covered by your current global plan.");
      return;
    }
    setPlanLoadingId(plan.id);
    setPlanError(null);
    setPlanOrder(null);

    try {
      const upgradeQuote = !groupScoped && categoryActivePlan ? await getGlobalPlanUpgradeQuote(plan.id) : null;
      const orderAmount = upgradeQuote?.upgrade_price ?? plan.price;
      if (orderAmount <= 0) {
        throw new Error("This plan is already covered by your current global plan.");
      }
      const result = await createPaymentOrder({
        amount: orderAmount,
        amount_currency: plan.currency || walletCurrency,
        payment_type: defaultPaymentMethod,
        order_type: groupScoped ? "subscription" : upgradeQuote ? "global_plan_upgrade" : "global_plan",
        plan_id: plan.id,
        payment_source: "hosted_redirect",
        return_url: `${window.location.origin}/payment/result`,
        is_mobile: false,
      });
      await handleCreatedPaymentOrder(result, "plan");
    } catch (reason) {
      setPlanError(reason instanceof Error ? reason.message : "Unable to create subscription order.");
    } finally {
      setPlanLoadingId(null);
    }
  }

  return (
    <div className="space-y-12">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Subscription & Credits</h1>
        <p className="text-zinc-500 text-sm">Manage your billing, subscriptions, and wallet credits.</p>
      </div>

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
          <span className="text-xs font-bold uppercase tracking-widest text-zinc-500">Available Balance</span>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold">{formatCredits(billingData.wallet.available_balance)}</span>
            <span className="text-xs font-medium text-zinc-400 uppercase tracking-widest">Credits</span>
          </div>
          <p className="mt-4 text-[10px] text-zinc-500 uppercase tracking-tighter">Includes {formatCredits(billingData.wallet.add_on_credits)} add-on credits</p>
          <p className="mt-1 text-[10px] text-zinc-500 uppercase tracking-tighter">Plan expires {formatDate(activePlan?.expires_at)}</p>
        </div>

        <div className="p-6 bg-white border border-zinc-200 rounded-2xl shadow-sm">
          <span className="text-xs font-bold uppercase tracking-widest text-zinc-500">Weekly Plan Quota</span>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-2xl font-bold text-zinc-900">{usedPercent}% <span className="text-sm font-normal text-zinc-400">used</span></span>
            <div className="h-2 w-24 bg-zinc-100 rounded-full overflow-hidden">
              <div className="h-full bg-rose-500" style={{ width: `${usedPercent}%` }} />
            </div>
          </div>
          <p className="mt-4 text-[10px] text-zinc-400 uppercase tracking-tighter flex items-center gap-1">
            <Clock size={12} />
            Resets on {formatDate(activePlan?.period_end)}
          </p>
        </div>

        <div className="p-6 bg-white border border-zinc-200 rounded-2xl shadow-sm">
          <span className="text-xs font-bold uppercase tracking-widest text-zinc-500">Active Plan</span>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-2xl font-bold text-zinc-900">{activePlan?.name ?? "No Plan"}</span>
            <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold border border-emerald-100 uppercase tracking-widest">Active</span>
          </div>
          <p className="mt-4 text-[10px] text-zinc-400 uppercase tracking-tighter italic">Expires on {formatDate(activePlan?.expires_at)}</p>
        </div>
      </div>

      {/* Subscription Plans */}
      <div className="space-y-6">
        <div>
          <h3 className="text-xl font-bold tracking-tight text-zinc-900">Subscription Plans</h3>
          <p className="text-sm text-zinc-500 mt-1">Upgrade your gateway priority and weekly credit allowances.</p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {billingData.plans.map(plan => {
            const groupScoped = isGroupPlan(plan);
            const scopeDescription = planScopeDescription(plan);
            const categoryActivePlan = groupScoped ? null : activePlanForCategory(plan, activePlans);
            const isCurrent = !groupScoped && categoryActivePlan?.plan_id === plan.id;
            const isCoveredByCurrentGlobalPlan = !groupScoped && !isCurrent && categoryActivePlan ? !isHigherTierPlan(plan, categoryActivePlan) : false;
            return (
            <div key={plan.id} className={`p-6 rounded-2xl border transition-all relative overflow-hidden ${isCurrent ? 'console-inverted-panel bg-zinc-900 text-white border-zinc-900 shadow-xl' : 'bg-white border-zinc-200 hover:border-zinc-300'}`}>
              {groupScoped && (
                <div
                  className="absolute -right-10 top-5 w-40 rotate-45 border-y border-white/30 bg-zinc-900 px-3 py-1 text-center text-[9px] font-bold uppercase tracking-[0.16em] text-white shadow-sm"
                  title={groupPlanRibbon(plan)}
                  aria-label={`Group plan for ${groupPlanRibbon(plan)}`}
                >
                  <span className="block truncate">{groupPlanRibbon(plan)}</span>
                </div>
              )}
              {isCurrent && (
                <span className="console-inverted-label mb-4 inline-flex bg-zinc-100 text-zinc-900 px-2 py-1 rounded text-[9px] font-bold uppercase tracking-widest border border-zinc-200">Current Plan</span>
              )}
              <h4 className="text-lg font-bold">{plan.name}</h4>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-3xl font-bold">{formatMoney(plan.price, plan.currency)}</span>
                <span className={`text-xs ${isCurrent ? 'text-zinc-400' : 'text-zinc-500'}`}>/{plan.billing_period}</span>
              </div>
              <div className="mt-6 space-y-3">
                <div className={`p-3 rounded-xl border ${isCurrent ? 'console-inverted-subtle bg-white/5 border-white/10' : 'bg-zinc-50 border-zinc-100'}`}>
                  <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest mb-1">
                    <span className={isCurrent ? 'text-zinc-400' : 'text-zinc-500'}>{planQuotaLabel(plan)}</span>
                    <span className={isCurrent ? 'console-inverted-strong text-white' : 'text-zinc-900'}>{formatCredits(planQuotaCredits(plan))}</span>
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
                  Expires {formatDate(activePlan.expires_at)}
                </p>
              )}
              {isCoveredByCurrentGlobalPlan ? (
                <p className="mt-8 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-center text-sm font-bold text-zinc-500">
                  Included in current plan
                </p>
              ) : (
                <button
                  onClick={() => void buyPlan(plan)}
                  disabled={planLoadingId === plan.id || isCurrent}
                  className={`mt-8 w-full rounded-xl py-2.5 text-sm font-bold transition-all disabled:cursor-not-allowed disabled:opacity-60 ${isCurrent ? 'bg-white text-zinc-900 hover:bg-zinc-100' : 'bg-zinc-900 text-white hover:bg-zinc-800'}`}
                >
                  {planLoadingId === plan.id ? "Creating order..." : isCurrent ? 'Current Plan' : `Upgrade to ${plan.name}`}
                </button>
              )}
            </div>
          )})}
        </div>
        {planError && (
          <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-700">
            {planError}
          </p>
        )}
        {planOrder && (
          <PaymentOrderNotice order={planOrder} currency={planOrder.currency || billingData.wallet.currency} />
        )}
      </div>

      {/* Add-on Top-up */}
      <div className="grid grid-cols-1 gap-6 border-t border-zinc-100 pt-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <div className="rounded-[2rem] border border-zinc-200 bg-white p-8 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="font-bold text-zinc-900">Add-on Top-up</h3>
              <p className="mt-1 text-xs text-zinc-500">Buy non-expiring credits that act as a fallback.</p>
            </div>
            {(checkoutMin > 0 || checkoutMax > 0) && (
              <p className="rounded-full bg-zinc-50 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                {checkoutMin > 0 ? `Min ${formatMoney(checkoutMin, billingData.wallet.currency)}` : "No min"}
                {" · "}
                {checkoutMax > 0 ? `Max ${formatMoney(checkoutMax, billingData.wallet.currency)}` : "No max"}
              </p>
            )}
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            {billingData.add_ons.map(addOn => (
              <button
                key={addOn.amount}
                onClick={() => {
                  setSelectedTopUpAmount(addOn.amount);
                  setCustomTopUpAmount("");
                  setTopUpError(null);
                  setTopUpOrder(null);
                }}
                className={`min-w-28 rounded-2xl border px-5 py-4 text-left font-bold transition-all ${
                  selectedTopUp?.amount === addOn.amount && !customAmountValid
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : "border-zinc-200 text-zinc-900 hover:border-zinc-900 hover:bg-zinc-50"
                }`}
              >
                <span className="block">{formatMoney(addOn.amount, addOn.currency)}</span>
                <span className={`mt-1 block text-[10px] uppercase tracking-widest ${selectedTopUp?.amount === addOn.amount && !customAmountValid ? "text-zinc-400" : "text-zinc-500"}`}>
                  {formatCredits(addOn.credits)} credits
                </span>
              </button>
            ))}
            <label className="min-w-56 flex-1 rounded-2xl border border-zinc-200 px-5 py-4 transition-all focus-within:border-zinc-900">
              <span className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500">Custom amount</span>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-lg font-bold text-zinc-400">$</span>
                <input
                  value={customTopUpAmount}
                  onChange={(event) => {
                    setCustomTopUpAmount(event.target.value);
                    setTopUpError(null);
                    setTopUpOrder(null);
                  }}
                  inputMode="decimal"
                  placeholder="Enter amount"
                  className="w-full bg-transparent text-lg font-bold text-zinc-900 outline-none placeholder:text-zinc-300"
                />
              </div>
            </label>
          </div>
        </div>

        <div className="console-inverted-panel console-payment-preview rounded-[2rem] border border-zinc-200 bg-zinc-950 p-8 text-white shadow-xl">
          <div className="flex items-center justify-between">
            <h3 className="font-bold">Payment Preview</h3>
            <CreditCard size={24} className="text-zinc-500" />
          </div>
          <div className="mt-6 space-y-4 text-sm">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <span className="text-zinc-400">Item</span>
              <span className="font-bold">Add-on Credits</span>
            </div>
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <span className="text-zinc-400">Estimated credits</span>
              <span className="font-bold">{formatCredits(previewCredits)}</span>
            </div>
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <span className="text-zinc-400">Amount due</span>
              <span className="text-xl font-bold">{formatMoney(previewAmount, billingData.wallet.currency)}</span>
            </div>
            <label className="block">
              <span className="text-xs font-bold uppercase tracking-widest text-zinc-500">Payment method</span>
              <select
                value={defaultPaymentMethod}
                onChange={(event) => setSelectedPaymentMethod(event.target.value)}
                className="console-inverted-subtle mt-2 w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-bold text-white outline-none focus:border-white/30"
              >
                {paymentMethods.map((method) => (
                  <option key={method} value={method} className="text-zinc-900">
                    {method}
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
            {topUpLoading ? "Creating order..." : "Create payment order"}
            <ArrowUpRight size={18} weight="bold" />
          </button>
          {topUpOutOfRange && (
            <p className="mt-3 text-xs font-medium text-amber-300">
              Enter an amount within the supported payment range.
            </p>
          )}
          {topUpError && (
            <p className="mt-3 rounded-xl border border-rose-400/40 bg-rose-500/10 p-3 text-xs font-medium text-rose-200">
              {topUpError}
            </p>
          )}
          {topUpOrder && (
            <div className="mt-4">
              <PaymentOrderNotice order={topUpOrder} currency={topUpOrder.currency || billingData.wallet.currency} />
            </div>
          )}
          <p className="mt-4 text-center text-[10px] uppercase tracking-widest text-zinc-500">
            Secure payment via {defaultPaymentMethod || "configured provider"}
          </p>
        </div>
      </div>

      {/* Main Content Split */}
      <div className="grid grid-cols-1 gap-8 pt-2">
        <div className="space-y-8">
          {/* Billing Table */}
          <div className="bg-white border border-zinc-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-zinc-100 flex items-center justify-between">
              <h3 className="font-bold text-zinc-900">Wallet & Order Activity</h3>
              <button className="text-xs font-bold text-zinc-500 hover:text-zinc-900 flex items-center gap-1.5">
                <DownloadSimple size={14} weight="bold" />
                Export CSV
              </button>
            </div>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-zinc-50/50 border-b border-zinc-200">
                  <th className="px-6 py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-[0.2em]">Date</th>
                  <th className="px-6 py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-[0.2em]">Reference</th>
                  <th className="px-6 py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-[0.2em]">Type</th>
                  <th className="px-6 py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-[0.2em]">Status</th>
                  <th className="px-6 py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-[0.2em]">Amount</th>
                  <th className="px-6 py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-[0.2em] text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {billingData.activity.map((item) => (
                  <tr key={item.id} className="hover:bg-zinc-50/50 transition-colors">
                    <td className="px-6 py-4 text-sm text-zinc-500">{formatDate(item.date)}</td>
                    <td className="px-6 py-4 text-sm font-mono text-zinc-400">{item.reference}</td>
                    <td className="px-6 py-4 text-sm font-medium text-zinc-900">{item.label}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest ${statusClass(item.status)}`}>
                        {normalizeOrderStatus(item.status) || "UNKNOWN"}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm font-bold text-zinc-900">
                      <span>{formatMoney(item.amount, item.currency)}</span>
                      {orderPaymentSummary(item) ? (
                        <span className="mt-1 block text-[10px] font-semibold uppercase tracking-widest text-zinc-400">{orderPaymentSummary(item)}</span>
                      ) : null}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex justify-end gap-2">
                      {isPendingOrder(item.status) && item.pay_url ? (
                        <a href={item.pay_url} className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-3 py-2 text-xs font-bold text-zinc-600 transition-all hover:border-zinc-900 hover:text-zinc-900">
                          Pay again
                          <ArrowUpRight size={14} weight="bold" />
                        </a>
                      ) : null}
                      {isPendingOrder(item.status) ? (
                        <button
                          type="button"
                          aria-label={`Cancel order ${item.reference}`}
                          onClick={() => void cancelActivityOrder(item)}
                          disabled={orderActionId === item.id}
                          className="inline-flex items-center gap-1 rounded-lg border border-rose-100 px-3 py-2 text-xs font-bold text-rose-600 transition-all hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <XCircle size={14} weight="bold" />
                          Cancel
                        </button>
                      ) : null}
                      <button className="p-2 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-lg transition-all">
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
                {orderActionError}
              </p>
            )}
          </div>

          {/* FAQ or Info */}
          <div className="p-8 bg-zinc-50 border border-zinc-200 rounded-[2rem] flex items-start gap-6">
            <div className="p-3 bg-white rounded-xl border border-zinc-200 shadow-sm text-zinc-400">
              <Lightning size={24} weight="fill" className="text-amber-500" />
            </div>
            <div className="space-y-2">
              <h4 className="font-bold text-zinc-900">How Credits & Plans Work</h4>
              <p className="text-sm text-zinc-500 leading-relaxed">
                When you make an API call, we <strong className="text-zinc-900">prioritize your weekly Plan Credits</strong>.
                When your plan quota hits 100%, we automatically fallback to your <strong className="text-zinc-900">Add-on Wallet Balance</strong> to keep your services running.
                If both are exhausted, or if you exceed your plan's concurrency limits, your requests may be queued or rate-limited.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PaymentOrderNotice({ order, currency }: { order: CreateOrderResult; currency: string }) {
  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
      <p className="font-bold">Order #{order.order_id} created</p>
      <p className="mt-1 text-xs text-emerald-700">Amount: {formatMoney(order.pay_amount, order.payment_currency || order.currency || currency)}</p>
      {order.pay_url ? (
        <a href={order.pay_url} className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-emerald-900 underline">
          Continue payment
          <ArrowUpRight size={14} weight="bold" />
        </a>
      ) : order.qr_code ? (
        <p className="mt-3 break-all text-xs font-mono text-emerald-800">{order.qr_code}</p>
      ) : (
        <p className="mt-3 text-xs text-emerald-700">Open the classic payment page if your provider requires an embedded checkout.</p>
      )}
    </div>
  );
}

function PaymentStatusDialog({ notice, onClose }: { notice: PaymentDialogNotice; onClose: () => void }) {
  const toneClass = notice.type === "success"
    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
    : notice.type === "error"
      ? "border-rose-200 bg-rose-50 text-rose-900"
      : "border-zinc-200 bg-white text-zinc-900";
  const helperClass = notice.type === "error" ? "text-rose-700" : "text-zinc-600";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-status-title"
        className={`w-full max-w-md rounded-[2rem] border p-6 shadow-2xl ${toneClass}`}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p id="payment-status-title" className="text-lg font-bold">{notice.title}</p>
            <p className={`mt-2 text-sm leading-6 ${helperClass}`}>{notice.message}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-zinc-400 transition-all hover:bg-zinc-100 hover:text-zinc-900"
            aria-label="Dismiss payment dialog"
          >
            <XCircle size={22} weight="bold" />
          </button>
        </div>

        {notice.order ? (
          <div className="mt-5 rounded-2xl border border-black/5 bg-white/70 p-4 text-sm">
            <div className="flex items-center justify-between gap-4">
              <span className="text-zinc-500">Order</span>
              <span className="font-mono font-bold text-zinc-900">#{notice.order.order_id}</span>
            </div>
            <div className="mt-3 flex items-center justify-between gap-4">
              <span className="text-zinc-500">Amount</span>
              <span className="font-bold text-zinc-900">{formatMoney(notice.order.pay_amount, notice.order.payment_currency || notice.order.currency || "USD")}</span>
            </div>
            {notice.order.pay_url ? (
              <a
                href={notice.order.pay_url}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-zinc-900 px-4 py-3 text-sm font-bold text-white transition-all hover:bg-zinc-800"
              >
                Continue payment
                <ArrowUpRight size={16} weight="bold" />
              </a>
            ) : notice.order.qr_code ? (
              <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
                <p className="text-xs font-bold uppercase tracking-widest text-zinc-400">QR code payload</p>
                <p className="mt-2 break-all font-mono text-xs text-zinc-700">{notice.order.qr_code}</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
