import { useEffect, useState, type FormEvent } from "react";
import {
  CheckCircle,
  CircleNotch,
  ClockCounterClockwise,
  Gift,
  Info,
  Lightning,
  Ticket,
  Wallet,
} from "@phosphor-icons/react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { getPublicSettings, type PublicSettings } from "../../api/settings";
import { getRedeemAccountProfile, getRedeemHistory, redeemCode } from "../../api/redeem";
import { usePageTitle } from "../../hooks/usePageTitle";
import type { RedeemAccountProfile, RedeemHistoryItem, RedeemResult } from "../../types/redeem";
import { formatCredits, formatDate, formatNumber } from "../../utils/format";
import {
  errorMessage,
  resolveLocalizedMessage,
  type LocalizedMessage,
} from "../../utils/localizedMessage";

function isBalanceType(type: string) {
  return type === "balance" || type === "admin_balance";
}

function isSubscriptionType(type: string) {
  return type === "subscription";
}

function isAdminAdjustment(type: string) {
  return type === "admin_balance" || type === "admin_concurrency";
}

function historyTitle(item: RedeemHistoryItem, t: TFunction<"console">) {
  switch (item.type) {
    case "balance":
      return t("redeem.history.balanceRedeem");
    case "admin_balance":
      return t(item.value >= 0 ? "redeem.history.balanceAdminAdded" : "redeem.history.balanceAdminDeducted");
    case "concurrency":
      return t("redeem.history.concurrencyRedeem");
    case "admin_concurrency":
      return t(item.value >= 0 ? "redeem.history.concurrencyAdminAdded" : "redeem.history.concurrencyAdminReduced");
    case "subscription":
      return t("redeem.history.subscriptionAssigned");
    default:
      return t("redeem.history.unknown");
  }
}

function historyValue(item: RedeemHistoryItem, locale: string, t: TFunction<"console">) {
  if (isBalanceType(item.type)) {
    return `${item.value >= 0 ? "+" : ""}${formatCredits(item.value, locale)}`;
  }
  if (isSubscriptionType(item.type)) {
    const days = item.validity_days ?? Math.round(item.value);
    return item.group?.name
      ? t("redeem.history.subscriptionValue", { days, group: item.group.name })
      : t("redeem.history.subscriptionDays", { days });
  }
  return t("redeem.history.concurrencyValue", {
    value: `${item.value >= 0 ? "+" : ""}${formatNumber(item.value, locale)}`,
  });
}

function resultDetail(result: RedeemResult, locale: string, t: TFunction<"console">) {
  if (result.type === "balance") {
    return t("redeem.result.balance", { amount: formatCredits(result.value, locale) });
  }
  if (result.type === "concurrency") {
    return t("redeem.result.concurrency", { count: result.value });
  }
  if (result.type === "subscription") {
    const details = [
      result.group_name,
      result.validity_days ? t("redeem.history.subscriptionDays", { days: result.validity_days }) : "",
    ].filter(Boolean).join(" · ");
    return t("redeem.result.subscription", { details });
  }
  return result.message;
}

export default function Redeem() {
  const { t, i18n } = useTranslation("console");
  const locale = i18n.resolvedLanguage || i18n.language || "en";
  const [profile, setProfile] = useState<RedeemAccountProfile | null>(null);
  const [history, setHistory] = useState<RedeemHistoryItem[]>([]);
  const [contactInfo, setContactInfo] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<LocalizedMessage | null>(null);
  const [submitError, setSubmitError] = useState<LocalizedMessage | null>(null);
  const [refreshError, setRefreshError] = useState<LocalizedMessage | null>(null);
  const [result, setResult] = useState<RedeemResult | null>(null);
  usePageTitle(t("redeem.title"));

  useEffect(() => {
    let active = true;
    Promise.all([
      getRedeemAccountProfile(),
      getRedeemHistory(),
      getPublicSettings().catch((): PublicSettings => ({})),
    ])
      .then(([nextProfile, nextHistory, settings]) => {
        if (!active) return;
        setProfile(nextProfile);
        setHistory(nextHistory);
        setContactInfo(settings.contact_info?.trim() || "");
        setLoadError(null);
      })
      .catch((reason: unknown) => {
        if (active) setLoadError(errorMessage(reason, "redeemLoadFailed"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const handleRedeem = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedCode = code.trim();
    if (!normalizedCode || submitting) return;
    setSubmitting(true);
    setResult(null);
    setSubmitError(null);
    setRefreshError(null);
    try {
      const nextResult = await redeemCode(normalizedCode);
      setResult(nextResult);
      setCode("");

      const [profileRefresh, historyRefresh] = await Promise.allSettled([
        getRedeemAccountProfile(),
        getRedeemHistory(),
      ]);
      if (profileRefresh.status === "fulfilled") setProfile(profileRefresh.value);
      if (historyRefresh.status === "fulfilled") setHistory(historyRefresh.value);
      if (profileRefresh.status === "rejected" || historyRefresh.status === "rejected") {
        setRefreshError(errorMessage(
          profileRefresh.status === "rejected" ? profileRefresh.reason : historyRefresh.status === "rejected" ? historyRefresh.reason : null,
          "redeemRefreshFailed",
        ));
      }
    } catch (reason: unknown) {
      setSubmitError(errorMessage(reason, "redeemSubmitFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[360px] items-center justify-center rounded-2xl border border-zinc-200 bg-white text-sm font-medium text-zinc-500">
        {t("redeem.loading")}
      </div>
    );
  }

  if (loadError || !profile) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
        <h1 className="text-lg font-semibold text-rose-900">{t("redeem.unavailable")}</h1>
        <p className="mt-2">{loadError ? resolveLocalizedMessage(loadError) : t("redeem.unavailable")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold text-zinc-900">{t("redeem.title")}</h1>
        <p className="mt-1 text-sm text-zinc-500">{t("redeem.description")}</p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2" aria-label={t("redeem.accountSummary")}>
        <div className="flex items-center gap-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
            <Wallet size={24} weight="duotone" aria-hidden="true" />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">{t("redeem.currentBalance")}</div>
            <div className="mt-1 text-2xl font-bold text-zinc-900">{formatCredits(profile.balance, locale)}</div>
          </div>
        </div>
        <div className="flex items-center gap-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
            <Lightning size={24} weight="duotone" aria-hidden="true" />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">{t("redeem.concurrency")}</div>
            <div className="mt-1 text-2xl font-bold text-zinc-900">{t("redeem.requests", { count: profile.concurrency })}</div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.8fr)]">
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600">
              <Ticket size={20} weight="duotone" aria-hidden="true" />
            </div>
            <div>
              <h2 className="font-bold text-zinc-900">{t("redeem.formTitle")}</h2>
              <p className="mt-1 text-sm text-zinc-500">{t("redeem.formDescription")}</p>
            </div>
          </div>

          <form className="mt-6 space-y-4" onSubmit={handleRedeem}>
            <div>
              <label htmlFor="redeem-code" className="text-xs font-bold text-zinc-700">{t("redeem.codeLabel")}</label>
              <input
                id="redeem-code"
                type="text"
                required
                disabled={submitting}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder={t("redeem.codePlaceholder")}
                className="mt-2 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 font-mono text-sm outline-none transition-colors focus:border-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
              />
              <p className="mt-2 text-xs text-zinc-500">{t("redeem.codeHint")}</p>
            </div>
            <button
              type="submit"
              disabled={submitting || !code.trim()}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-zinc-900 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
            >
              {submitting ? <CircleNotch size={18} className="animate-spin" aria-hidden="true" /> : <CheckCircle size={18} weight="bold" aria-hidden="true" />}
              {submitting ? t("redeem.submitting") : t("redeem.submit")}
            </button>
          </form>

          {result ? (
            <div role="status" className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
              <div className="font-bold text-emerald-900">{t("redeem.result.successTitle")}</div>
              <p className="mt-1">{resultDetail(result, locale, t)}</p>
              {result.new_balance !== undefined ? <p className="mt-2">{t("redeem.result.newBalance", { amount: formatCredits(result.new_balance, locale) })}</p> : null}
              {result.new_concurrency !== undefined ? <p>{t("redeem.result.newConcurrency", { count: result.new_concurrency })}</p> : null}
            </div>
          ) : null}
          {submitError ? (
            <div role="alert" className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
              <div className="font-bold text-rose-900">{t("redeem.result.failedTitle")}</div>
              <p className="mt-1">{resolveLocalizedMessage(submitError)}</p>
            </div>
          ) : null}
          {refreshError ? <p role="alert" className="mt-4 text-sm text-amber-700">{resolveLocalizedMessage(refreshError)}</p> : null}
        </section>

        <aside className="rounded-2xl border border-sky-200 bg-sky-50 p-6">
          <div className="flex items-center gap-2 text-sky-800">
            <Info size={20} weight="duotone" aria-hidden="true" />
            <h2 className="font-bold">{t("redeem.aboutTitle")}</h2>
          </div>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-sky-800">
            <li>{t("redeem.rules.singleUse")}</li>
            <li>{t("redeem.rules.codeTypes")}</li>
            <li>
              {t("redeem.rules.contactSupport")}
              {contactInfo ? <span className="mt-1 block font-semibold text-sky-950">{contactInfo}</span> : null}
            </li>
            <li>{t("redeem.rules.immediate")}</li>
          </ul>
        </aside>
      </div>

      <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-zinc-100 px-6 py-5">
          <ClockCounterClockwise size={21} className="text-zinc-400" aria-hidden="true" />
          <div>
            <h2 className="font-bold text-zinc-900">{t("redeem.historyTitle")}</h2>
            <p className="mt-0.5 text-xs text-zinc-500">{t("redeem.historyDescription")}</p>
          </div>
        </div>
        {history.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-zinc-500">{t("redeem.historyEmpty")}</div>
        ) : (
          <div className="divide-y divide-zinc-100">
            {history.map((item) => (
              <article key={item.id} className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${isBalanceType(item.type) ? "bg-emerald-50 text-emerald-600" : isSubscriptionType(item.type) ? "bg-violet-50 text-violet-600" : "bg-sky-50 text-sky-600"}`}>
                    {isBalanceType(item.type) ? <Wallet size={18} weight="duotone" /> : isSubscriptionType(item.type) ? <Gift size={18} weight="duotone" /> : <Lightning size={18} weight="duotone" />}
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-zinc-900">{historyTitle(item, t)}</h3>
                    <p className="mt-1 text-xs text-zinc-500">{formatDate(item.used_at, locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
                    {item.notes ? <p className="mt-1 truncate text-xs italic text-zinc-500">{item.notes}</p> : null}
                  </div>
                </div>
                <div className="text-left sm:text-right">
                  <div className="text-sm font-bold text-zinc-900">{historyValue(item, locale, t)}</div>
                  <div className="mt-1 font-mono text-xs text-zinc-500">
                    {isAdminAdjustment(item.type) ? t("redeem.history.adminAdjustment") : item.code ? `${item.code.slice(0, 8)}...` : "-"}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
