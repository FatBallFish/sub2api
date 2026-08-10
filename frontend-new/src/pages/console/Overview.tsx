import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  TrendUp,
  TrendDown,
  Pulse,
  Clock,
  ChartLine,
  Gift,
  ArrowRight
} from "@phosphor-icons/react";
import { motion } from "motion/react";
import { getConsoleOverview } from "../../api/console";
import type { ConsoleGlobalPlan, ConsoleOverview } from "../../types/console";
import { formatCredits, formatNumber } from "../../utils/format";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { usePageTitle } from "../../hooks/usePageTitle";
import {
  errorMessage,
  resolveLocalizedMessage,
  type LocalizedMessage,
} from "../../utils/localizedMessage";

function formatPercent(value: number, locale: string) {
  if (value === 0) return "0";
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatNumber(value * 100, locale, { maximumFractionDigits: 1 })}%`;
}

function relativeTime(value: string | null | undefined, t: TFunction<"console">) {
  if (!value) return t("overview.never");
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return t("overview.recently");
  const diffMinutes = Math.max(Math.round((Date.now() - timestamp) / 60000), 0);
  if (diffMinutes < 1) return t("overview.justNow");
  if (diffMinutes < 60) return t("overview.minutesAgo", { count: diffMinutes });
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return t("overview.hoursAgo", { count: diffHours });
  return t("overview.daysAgo", { count: Math.round(diffHours / 24) });
}

type OverviewRange = "today" | "lastday" | "7d" | "30d";

function shortWeekday(date: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(new Date(date));
}

function shortHour(date: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(new Date(date));
}

function usageTrendAxisLabel(point: ConsoleOverview["usage_trend"][number], range: OverviewRange, locale: string) {
  return range === "today" || range === "lastday" ? shortHour(point.date, locale) : shortWeekday(point.date, locale);
}

function usageTrendLabel(
  point: ConsoleOverview["usage_trend"][number],
  range: OverviewRange,
  locale: string,
  t: TFunction<"console">,
) {
  return t("overview.usageTrendLabel", {
    axis: usageTrendAxisLabel(point, range, locale),
    credits: formatCredits(point.credits, locale),
    requests: formatNumber(point.requests, locale),
    tokens: formatNumber(point.tokens, locale),
  });
}

function formatResetTime(value: string | undefined, locale: string, t: TFunction<"console">) {
  if (!value) return t("overview.noScheduledReset");
  const resetAt = new Date(value);
  if (Number.isNaN(resetAt.getTime())) return t("overview.resetUnavailable");

  const diffMs = resetAt.getTime() - Date.now();
  if (diffMs <= 0) return t("overview.resetPending");

  const hours = Math.ceil(diffMs / 3_600_000);
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(resetAt);
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(resetAt);
  const date = `${weekday} ${time}`;

  if (days > 0) {
    return t("overview.resetsInDays", { days, hours: remainingHours, date });
  }
  return t("overview.resetsInHours", { hours: remainingHours, date });
}

function defaultGlobalPlan(t: TFunction<"console">): ConsoleGlobalPlan {
  return {
    active: false,
    name: t("overview.addOnCredits"),
    quota_limit: 0,
    quota_used: 0,
    quota_remaining: 0,
    used_percent: 0,
  };
}

export default function Overview() {
  const { t, i18n } = useTranslation("console");
  const locale = i18n.resolvedLanguage || i18n.language || "en";
  const [overview, setOverview] = useState<ConsoleOverview | null>(null);
  const [range, setRange] = useState<OverviewRange>("7d");
  const [error, setError] = useState<LocalizedMessage | null>(null);
  usePageTitle(t("overview.title"));

  useEffect(() => {
    let active = true;

    getConsoleOverview(range)
      .then((data) => {
        if (active) {
          setOverview(data);
          setError(null);
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(errorMessage(reason, "overviewLoadFailed"));
        }
      });

    return () => {
      active = false;
    };
  }, [range]);

  const stats = useMemo(() => {
    if (!overview) return [];
    return [
      {
        label: t("overview.availableCredits"),
        value: formatCredits(overview.stats.available_credits, locale),
        change: formatPercent(overview.stats.changes.available_credits, locale),
        trend: overview.stats.changes.available_credits > 0 ? "up" : overview.stats.changes.available_credits < 0 ? "down" : "neutral",
      },
      {
        label: t("overview.totalRequests"),
        value: formatNumber(overview.stats.total_requests, locale),
        change: formatPercent(overview.stats.changes.total_requests, locale),
        trend: overview.stats.changes.total_requests > 0 ? "up" : overview.stats.changes.total_requests < 0 ? "down" : "neutral",
      },
      {
        label: t("overview.activeApiKeys"),
        value: formatNumber(overview.stats.active_api_keys, locale),
        change: "0",
        trend: "neutral",
      },
      {
        label: t("overview.usageToday"),
        value: formatCredits(overview.stats.usage_today, locale),
        change: formatPercent(overview.stats.changes.usage_today, locale),
        trend: overview.stats.changes.usage_today > 0 ? "up" : overview.stats.changes.usage_today < 0 ? "down" : "neutral",
        suffix: t("overview.credits"),
      },
    ];
  }, [locale, overview, t]);

  const maxTrendCredits = Math.max(...(overview?.usage_trend.map((point) => point.credits) ?? [1]), 1);
  const globalPlan = overview?.global_plan ?? defaultGlobalPlan(t);
  const planUsedPercent = Math.max(0, Math.min(globalPlan.used_percent, 100));

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
        <h1 className="text-lg font-semibold text-rose-900">{t("overview.unavailable")}</h1>
        <p className="mt-2">{resolveLocalizedMessage(error)}</p>
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="flex min-h-[360px] items-center justify-center rounded-2xl border border-zinc-200 bg-white text-sm font-medium text-zinc-500">
        {t("overview.loading")}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">{t("overview.title")}</h1>
        <p className="text-zinc-500">{t("overview.description")}</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="p-6 bg-white border border-zinc-200 rounded-2xl shadow-sm hover:shadow-md transition-shadow"
          >
            <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{stat.label}</span>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-zinc-900">{stat.value} {stat.suffix && <span className="text-sm font-normal text-zinc-500">{stat.suffix}</span>}</span>
              <span className={`text-xs font-medium flex items-center gap-0.5 ${
                stat.trend === "up" ? "text-emerald-600" : stat.trend === "down" ? "text-rose-600" : "text-zinc-400"
              }`}>
                {stat.trend === "up" && <TrendUp size={12} />}
                {stat.trend === "down" && <TrendDown size={12} />}
                {stat.change}
              </span>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Usage Chart Placeholder & Referral Summary */}
        <div className="lg:col-span-2 space-y-8">
          <div className="p-6 bg-white border border-zinc-200 rounded-2xl shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <ChartLine size={20} className="text-zinc-400" />
                <h3 className="font-semibold text-zinc-900">{t("overview.usageAnalytics")}</h3>
              </div>
              <select
                aria-label={t("overview.usageRange")}
                value={range}
                onChange={(event) => setRange(event.target.value as OverviewRange)}
                className="text-xs bg-zinc-50 border border-zinc-200 rounded-md px-2 py-1 outline-none"
              >
                <option value="today">{t("overview.today")}</option>
                <option value="lastday">{t("overview.lastDay")}</option>
                <option value="7d">{t("overview.last7Days")}</option>
                <option value="30d">{t("overview.last30Days")}</option>
              </select>
            </div>
            <div className="h-64 flex items-end gap-2 px-2">
              {overview.usage_trend.length === 0 ? (
                <div className="flex h-full w-full items-center justify-center text-sm text-zinc-400">
                  {t("overview.noUsageData")}
                </div>
              ) : overview.usage_trend.map((point, i) => (
                <motion.div
                  key={`${point.date}-${i}`}
                  aria-label={usageTrendLabel(point, range, locale, t)}
                  title={usageTrendLabel(point, range, locale, t)}
                  initial={{ height: 0 }}
                  animate={{ height: `${Math.max((point.credits / maxTrendCredits) * 100, 4)}%` }}
                  transition={{ delay: 0.5 + i * 0.1, duration: 1, ease: "circOut" }}
                  className="group/bar relative flex-1 rounded-t-sm bg-zinc-900"
                >
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden min-w-36 -translate-x-1/2 rounded-lg bg-zinc-950 px-3 py-2 text-center text-xs text-white shadow-xl group-hover/bar:block">
                    <div className="font-semibold">{formatCredits(point.credits, locale)} {t("overview.credits")}</div>
                    <div className="mt-1 text-zinc-400">{formatNumber(point.requests, locale)} {t("overview.requests")}</div>
                    <div className="text-zinc-400">{formatNumber(point.tokens, locale)} {t("overview.tokens")}</div>
                  </div>
                </motion.div>
              ))}
            </div>
            <div className="mt-4 flex justify-between px-2 text-[10px] text-zinc-400 font-medium uppercase tracking-widest">
              {overview.usage_trend.map((point, i) => (
                <span key={`${point.date}-label-${i}`}>{usageTrendAxisLabel(point, range, locale)}</span>
              ))}
            </div>
          </div>

          {overview.affiliate_enabled !== false ? (
          <div className="p-6 bg-white border border-zinc-200 rounded-2xl shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <Gift size={20} className="text-zinc-400" />
                <h3 className="font-semibold text-zinc-900">{t("overview.referralProgram")}</h3>
              </div>
              <Link to="/console/referral" className="text-xs font-bold text-zinc-500 hover:text-zinc-900 transition-colors flex items-center gap-1 group">
                {t("overview.viewDetails")}
                <ArrowRight size={14} weight="bold" className="group-hover:translate-x-0.5 transition-transform" />
              </Link>
            </div>
            <div className="grid grid-cols-3 divide-x divide-zinc-100">
              <div className="px-2 lg:px-4 first:pl-0">
                 <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{t("overview.earnings")}</span>
                 <div className="text-xl font-bold text-zinc-900 mt-1">{formatCredits(overview.referral_summary.earnings, locale)} <span className="text-xs font-normal text-zinc-500">{t("overview.credits")}</span></div>
              </div>
              <div className="px-2 lg:px-4">
                 <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{t("overview.invited")}</span>
                 <div className="text-xl font-bold text-zinc-900 mt-1">{formatNumber(overview.referral_summary.invited, locale)}</div>
              </div>
              <div className="px-2 lg:px-4 last:pr-0">
                 <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{t("overview.orders")}</span>
                 <div className="text-xl font-bold text-zinc-900 mt-1">{formatNumber(overview.referral_summary.orders, locale)}</div>
              </div>
            </div>
          </div>
          ) : null}
        </div>

        {/* Quick Info */}
        <div className="space-y-6">
          <div className="p-6 bg-white border border-zinc-200 rounded-2xl shadow-sm">
            <span className="text-xs font-bold uppercase tracking-widest text-zinc-500">
              {t("overview.planQuota", { name: globalPlan.name })}
            </span>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-2xl font-bold text-zinc-900">{formatNumber(planUsedPercent, locale, { maximumFractionDigits: 1 })}% <span className="text-sm font-normal text-zinc-400">{t("overview.used")}</span></span>
              <div className="h-2 w-24 bg-zinc-100 rounded-full overflow-hidden">
                <div className="h-full bg-rose-500" style={{ width: `${planUsedPercent}%` }} />
              </div>
            </div>
            <p className="mt-4 text-[10px] text-zinc-400 uppercase tracking-tighter flex items-center gap-1">
              <Clock size={12} />
              {formatResetTime(globalPlan.current_period_end, locale, t)}
            </p>
          </div>

          <div className="console-inverted-panel p-6 bg-zinc-900 rounded-2xl text-white shadow-xl overflow-hidden relative group">
            <Pulse size={80} className="absolute -right-4 -bottom-4 text-white/5 group-hover:text-white/10 transition-colors duration-500" />
            <h3 className="text-sm font-medium text-zinc-400">{t("overview.primaryApiKey")}</h3>
            <p className="mt-1 text-xs font-semibold text-zinc-200">{overview.primary_key?.name ?? t("overview.noActiveKey")}</p>
            <div className="console-inverted-subtle mt-4 flex items-center gap-2 bg-white/5 rounded-lg p-3 border border-white/10 backdrop-blur-sm">
              <code className="console-inverted-code text-xs font-mono text-zinc-300">{overview.primary_key?.masked_key ?? t("overview.createFirstKey")}</code>
              <Link to="/console/install-guide" aria-label={t("overview.openInstallGuide")} className="ml-auto p-1.5 hover:bg-white/10 rounded-md transition-colors">
                <ArrowUpRight size={14} />
              </Link>
            </div>
            <p className="mt-4 text-[10px] text-zinc-500 leading-relaxed uppercase tracking-tighter">
              {t("overview.primaryKeyActivity", {
                count: overview.primary_key?.environments ?? 0,
                time: relativeTime(overview.primary_key?.last_used_at, t),
              })}
            </p>
          </div>

          <div className="p-6 bg-white border border-zinc-200 rounded-2xl shadow-sm">
            <h3 className="font-semibold text-zinc-900 mb-4">{t("overview.latestAnnouncements")}</h3>
            <div className="space-y-4">
              {overview.latest_announcements.length === 0 ? (
                <p className="text-sm text-zinc-400">{t("overview.noAnnouncements")}</p>
              ) : overview.latest_announcements.map((item) => (
                <div key={item.id} className="flex flex-col gap-1 pb-3 border-b border-zinc-100 last:border-0 last:pb-0">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-zinc-900 truncate">{item.title}</span>
                    <span className="text-[10px] text-zinc-400 whitespace-nowrap">{relativeTime(item.published_at, t)}</span>
                  </div>
                  <span className={`text-[9px] uppercase tracking-widest font-bold ${
                    item.type === "update" ? "text-emerald-600" : "text-amber-600"
                  }`}>
                    {item.type === "update"
                      ? t("overview.announcementUpdate")
                      : item.type === "notice"
                        ? t("overview.announcementNotice")
                        : item.type}
                  </span>
                </div>
              ))}
            </div>
            <Link to="/console/announcements" className="mt-6 block w-full rounded-lg border border-zinc-200 py-2 text-center text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-900">
              {t("overview.viewAllAnnouncements")}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
