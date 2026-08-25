import { useEffect, useState } from "react";
import {
  Users,
  Gift,
  Copy,
  Check,
  HandHeart,
  CurrencyCircleDollar,
  ArrowLineDown,
} from "@phosphor-icons/react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { getConsoleReferral, transferAffiliateRewards } from "../../api/console";
import { usePageTitle } from "../../hooks/usePageTitle";
import type { ConsoleAffiliateTransfer, ConsoleReferral } from "../../types/console";
import { formatCredits, formatNumber } from "../../utils/format";
import { REFERRAL_INVITEE_STATUS_LABEL_KEYS } from "../../utils/statusLabels";
import {
  errorMessage,
  resolveLocalizedMessage,
  type LocalizedMessage,
} from "../../utils/localizedMessage";

function formatPercent(value: number, locale: string) {
  return formatNumber(value * 100, locale, { maximumFractionDigits: 1 });
}

function rewardCapRule(value: number, locale: string, t: TFunction<"console">) {
  if (value > 0) {
    return t("referral.rules.rewardCap", { credits: formatCredits(value, locale) });
  }
  return t("referral.rules.noRewardCap");
}

function relativeTime(value: string, t: TFunction<"console">) {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return t("referral.recently");
  const diffMinutes = Math.max(Math.round((Date.now() - timestamp) / 60000), 0);
  if (diffMinutes < 60) return t("referral.minutesAgo", { count: Math.max(diffMinutes, 1) });
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return t("referral.hoursAgo", { count: diffHours });
  return t("referral.daysAgo", { count: Math.round(diffHours / 24) });
}

function inviteeStatusLabel(status: string, t: TFunction<"console">) {
  const normalized = status.trim().toLowerCase();
  const key = REFERRAL_INVITEE_STATUS_LABEL_KEYS[normalized as keyof typeof REFERRAL_INVITEE_STATUS_LABEL_KEYS];
  return key ? t(key) : status;
}

export default function Referral() {
  const { t, i18n } = useTranslation("console");
  const locale = i18n.resolvedLanguage || i18n.language || "en";
  const [referral, setReferral] = useState<ConsoleReferral | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<LocalizedMessage | null>(null);
  const [copyError, setCopyError] = useState<LocalizedMessage | null>(null);
  const [transferring, setTransferring] = useState(false);
  const [transferResult, setTransferResult] = useState<ConsoleAffiliateTransfer | null>(null);
  const [transferError, setTransferError] = useState<LocalizedMessage | null>(null);
  usePageTitle(t("referral.title"));

  useEffect(() => {
    let active = true;

    getConsoleReferral()
      .then((data) => {
        if (active) {
          setReferral(data);
          setError(null);
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(errorMessage(reason, "referralLoadFailed", "affiliate"));
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const copyLink = async () => {
    if (!referral) return;
    try {
      await navigator.clipboard.writeText(referral.invite_link);
      setCopied(true);
      setCopyError(null);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (reason: unknown) {
      setCopied(false);
      setCopyError(errorMessage(reason, "referralCopyFailed", "affiliate"));
    }
  };

  const transferRewards = async () => {
    if (!referral || referral.stats.pending_rewards <= 0 || transferring) return;
    setTransferring(true);
    setTransferResult(null);
    setTransferError(null);
    try {
      const result = await transferAffiliateRewards();
      setTransferResult(result);
      setReferral(await getConsoleReferral());
    } catch (reason: unknown) {
      setTransferError(errorMessage(reason, "referralTransferFailed", "affiliate"));
    } finally {
      setTransferring(false);
    }
  };

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
        <h1 className="text-lg font-semibold text-rose-900">{t("referral.unavailable")}</h1>
        <p className="mt-2">{resolveLocalizedMessage(error)}</p>
      </div>
    );
  }

  if (!referral) {
    return (
      <div className="flex min-h-[360px] items-center justify-center rounded-2xl border border-zinc-200 bg-white text-sm font-medium text-zinc-500">
        {t("referral.loading")}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">{t("referral.title")}</h1>
        <p className="text-zinc-500 text-sm">{t("referral.description")}</p>
      </div>

      {/* Hero Card */}
      <div className="console-inverted-panel p-12 bg-zinc-900 rounded-[2.5rem] text-white relative overflow-hidden group">
        <div className="absolute top-0 right-0 h-full w-1/3 bg-gradient-to-l from-white/5 to-transparent" />
        <HandHeart size={200} weight="thin" className="absolute -right-16 -bottom-16 text-white/5 group-hover:text-white/10 transition-colors duration-700" />

        <div className="relative z-10 max-w-xl space-y-6">
          <div className="console-inverted-label inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/20 text-[10px] font-bold uppercase tracking-widest text-zinc-300">
            <Gift size={12} weight="fill" className="text-rose-400" />
            {t("referral.rewardBadge")}
          </div>
          <h2 className="text-4xl font-bold tracking-tight">
            {t("referral.rewardHeadline", {
              give: formatCredits(referral.rules.signup_bonus, locale),
              get: formatCredits(referral.rules.inviter_signup_reward, locale),
            })}
          </h2>
          <p className="text-zinc-400 leading-relaxed">
            {t("referral.rewardDescription", {
              signupBonus: formatCredits(referral.rules.signup_bonus, locale),
              inviterReward: formatCredits(referral.rules.inviter_signup_reward, locale),
              rebateRate: formatPercent(referral.rules.rebate_rate, locale),
            })}
          </p>

          <div className="pt-4 flex flex-col sm:flex-row gap-4">
            <div className="console-inverted-subtle flex-1 bg-white/5 border border-white/10 rounded-2xl px-6 py-4 flex items-center justify-between backdrop-blur-sm group-hover:border-white/20 transition-colors">
              <div className="min-w-0 mr-4">
                <div className="console-inverted-label mb-1 text-[10px] font-bold uppercase tracking-widest text-zinc-500">{t("referral.inviteLink")}</div>
                <code className="console-inverted-code block truncate text-sm font-mono text-zinc-300">{referral.invite_link}</code>
              </div>
              <button
                onClick={() => void copyLink()}
                aria-label={copied ? t("referral.inviteLinkCopied") : t("referral.copyInviteLink")}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors shrink-0"
              >
                {copied ? <Check size={20} className="text-emerald-400" /> : <Copy size={20} />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {copyError && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {resolveLocalizedMessage(copyError)}
        </div>
      )}

      {transferResult ? (
        <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
          {t("referral.transferSuccess", {
            amount: formatCredits(transferResult.transferred_quota, locale),
            balance: formatCredits(transferResult.balance, locale),
          })}
        </div>
      ) : null}

      {transferError ? (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {resolveLocalizedMessage(transferError)}
        </div>
      ) : null}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          { icon: Users, label: t("referral.totalInvited"), value: t("referral.users", { count: referral.stats.total_invited, formattedCount: formatNumber(referral.stats.total_invited, locale) }) },
          { icon: CurrencyCircleDollar, label: t("referral.creditsEarned"), value: formatCredits(referral.stats.credits_earned, locale) },
        ].map(item => (
          <div key={item.label} className="p-6 bg-white border border-zinc-200 rounded-2xl shadow-sm flex items-center gap-4">
            <div className="p-3 bg-zinc-50 rounded-xl border border-zinc-100 text-zinc-400">
              <item.icon size={24} weight="duotone" />
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">{item.label}</span>
              <div className="text-xl font-bold text-zinc-900">{item.value}</div>
            </div>
          </div>
        ))}
        <div className="p-6 bg-white border border-zinc-200 rounded-2xl shadow-sm flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-zinc-50 rounded-xl border border-zinc-100 text-zinc-400">
              <Gift size={24} weight="duotone" />
            </div>
            <div className="min-w-0 flex-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">{t("referral.pendingRewards")}</span>
              <div className="text-xl font-bold text-zinc-900">{formatCredits(referral.stats.pending_rewards, locale)}</div>
            </div>
          </div>
          <button
            type="button"
            disabled={transferring || referral.stats.pending_rewards <= 0}
            onClick={() => void transferRewards()}
            className="flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-zinc-900 px-3 py-2 text-sm font-bold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500"
          >
            <ArrowLineDown size={17} weight="bold" aria-hidden="true" />
            {transferring ? t("referral.transferring") : t("referral.transferToBalance")}
          </button>
        </div>
      </div>

      {/* Table & Rules */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-white border border-zinc-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-100 font-bold text-zinc-900">{t("referral.recentlyJoined")}</div>
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-zinc-50/50 border-b border-zinc-200">
                <th className="px-6 py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-[0.2em]">{t("referral.invitee")}</th>
                <th className="px-6 py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-[0.2em]">{t("referral.joined")}</th>
                <th className="px-6 py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-[0.2em]">{t("referral.status")}</th>
                <th className="px-6 py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-[0.2em] text-right">{t("referral.earnings")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {referral.recent_invitees.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-10 text-center text-sm text-zinc-500">{t("referral.noRecentInvitees")}</td>
                </tr>
              )}
              {referral.recent_invitees.map((row) => (
                <tr key={row.id} className="hover:bg-zinc-50/50 transition-colors">
                  <td className="px-6 py-4 text-sm font-medium text-zinc-900">{row.email}</td>
                  <td className="px-6 py-4 text-sm text-zinc-500">{relativeTime(row.joined_at, t)}</td>
                  <td className="px-6 py-4">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">
                      {inviteeStatusLabel(row.status, t)}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm font-bold text-zinc-900 text-right">{formatCredits(row.earnings, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-6">
          <div className="p-8 bg-zinc-50 border border-zinc-200 rounded-[2rem] space-y-4">
            <h3 className="font-bold text-zinc-900">{t("referral.programRules")}</h3>
            <ul className="space-y-4">
              {[
                t("referral.rules.useUniqueLink"),
                t("referral.rules.inviteeBonus", { credits: formatCredits(referral.rules.signup_bonus, locale) }),
                t("referral.rules.inviterReward", { credits: formatCredits(referral.rules.inviter_signup_reward, locale) }),
                rewardCapRule(referral.rules.inviter_signup_reward_cap, locale, t),
                t("referral.rules.rebate", { rate: formatPercent(referral.rules.rebate_rate, locale) }),
                referral.rules.add_on_excluded ? t("referral.rules.addOnExcluded") : t("referral.rules.addOnIncluded"),
                t("referral.rules.instantEarnings"),
              ].map(rule => (
                <li key={rule} className="flex gap-3 text-sm text-zinc-500 leading-relaxed">
                  <div className="h-1.5 w-1.5 rounded-full bg-zinc-300 mt-2 shrink-0" />
                  {rule}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
