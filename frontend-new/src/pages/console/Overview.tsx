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
import { formatCredits } from "../../utils/format";

function formatNumber(value: number, options: Intl.NumberFormatOptions = {}) {
  return new Intl.NumberFormat("en-US", options).format(value);
}

function formatPercent(value: number) {
  if (value === 0) return "0";
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatNumber(value * 100, { maximumFractionDigits: 1 })}%`;
}

function relativeTime(value?: string) {
  if (!value) return "Never";
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "Recently";
  const diffMinutes = Math.max(Math.round((Date.now() - timestamp) / 60000), 0);
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.round(diffHours / 24)}d ago`;
}

type OverviewRange = "today" | "lastday" | "7d" | "30d";

function shortWeekday(date: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(new Date(date));
}

function shortHour(date: string) {
  return new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(new Date(date));
}

function usageTrendAxisLabel(point: ConsoleOverview["usage_trend"][number], range: OverviewRange) {
  return range === "today" || range === "lastday" ? shortHour(point.date) : shortWeekday(point.date);
}

function usageTrendLabel(point: ConsoleOverview["usage_trend"][number], range: OverviewRange) {
  return `${usageTrendAxisLabel(point, range)}: ${formatCredits(point.credits)} Credits, ${formatNumber(point.requests)} requests, ${formatNumber(point.tokens)} tokens`;
}

function formatResetTime(value?: string) {
  if (!value) return "No scheduled reset";
  const resetAt = new Date(value);
  if (Number.isNaN(resetAt.getTime())) return "Reset schedule unavailable";

  const diffMs = resetAt.getTime() - Date.now();
  if (diffMs <= 0) return "Reset pending";

  const hours = Math.ceil(diffMs / 3_600_000);
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(resetAt);
  const time = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(resetAt);

  if (days > 0) {
    return `Resets in ${days}d ${remainingHours}h (${weekday} ${time} UTC)`;
  }
  return `Resets in ${remainingHours}h (${weekday} ${time} UTC)`;
}

function defaultGlobalPlan(): ConsoleGlobalPlan {
  return {
    active: false,
    name: "Add-on Credits",
    quota_limit: 0,
    quota_used: 0,
    quota_remaining: 0,
    used_percent: 0,
  };
}

export default function Overview() {
  const [overview, setOverview] = useState<ConsoleOverview | null>(null);
  const [range, setRange] = useState<OverviewRange>("7d");
  const [error, setError] = useState<string | null>(null);

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
          setError(reason instanceof Error ? reason.message : "Unable to load overview.");
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
        label: "Available Credits",
        value: formatCredits(overview.stats.available_credits),
        change: formatPercent(overview.stats.changes.available_credits),
        trend: overview.stats.changes.available_credits > 0 ? "up" : overview.stats.changes.available_credits < 0 ? "down" : "neutral",
      },
      {
        label: "Total Requests",
        value: formatNumber(overview.stats.total_requests),
        change: formatPercent(overview.stats.changes.total_requests),
        trend: overview.stats.changes.total_requests > 0 ? "up" : overview.stats.changes.total_requests < 0 ? "down" : "neutral",
      },
      {
        label: "Active API Keys",
        value: formatNumber(overview.stats.active_api_keys),
        change: "0",
        trend: "neutral",
      },
      {
        label: "Usage Today",
        value: formatCredits(overview.stats.usage_today),
        change: formatPercent(overview.stats.changes.usage_today),
        trend: overview.stats.changes.usage_today > 0 ? "up" : overview.stats.changes.usage_today < 0 ? "down" : "neutral",
        suffix: "Credits",
      },
    ];
  }, [overview]);

  const maxTrendCredits = Math.max(...(overview?.usage_trend.map((point) => point.credits) ?? [1]), 1);
  const globalPlan = overview?.global_plan ?? defaultGlobalPlan();
  const planUsedPercent = Math.max(0, Math.min(globalPlan.used_percent, 100));

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
        <h1 className="text-lg font-semibold text-rose-900">Overview unavailable</h1>
        <p className="mt-2">{error}</p>
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="flex min-h-[360px] items-center justify-center rounded-2xl border border-zinc-200 bg-white text-sm font-medium text-zinc-500">
        Loading overview...
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Overview</h1>
        <p className="text-zinc-500">Welcome back. Here's what's happening with your gateway today.</p>
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
                <h3 className="font-semibold text-zinc-900">Usage Analytics</h3>
              </div>
              <select
                aria-label="Usage analytics range"
                value={range}
                onChange={(event) => setRange(event.target.value as OverviewRange)}
                className="text-xs bg-zinc-50 border border-zinc-200 rounded-md px-2 py-1 outline-none"
              >
                <option value="today">Today</option>
                <option value="lastday">Lastday</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
              </select>
            </div>
            <div className="h-64 flex items-end gap-2 px-2">
              {overview.usage_trend.map((point, i) => (
                <motion.div
                  key={`${point.date}-${i}`}
                  aria-label={usageTrendLabel(point, range)}
                  title={usageTrendLabel(point, range)}
                  initial={{ height: 0 }}
                  animate={{ height: `${Math.max((point.credits / maxTrendCredits) * 100, 4)}%` }}
                  transition={{ delay: 0.5 + i * 0.1, duration: 1, ease: "circOut" }}
                  className="group/bar relative flex-1 rounded-t-sm bg-zinc-900"
                >
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden min-w-36 -translate-x-1/2 rounded-lg bg-zinc-950 px-3 py-2 text-center text-xs text-white shadow-xl group-hover/bar:block">
                    <div className="font-semibold">{formatCredits(point.credits)} Credits</div>
                    <div className="mt-1 text-zinc-400">{formatNumber(point.requests)} requests</div>
                    <div className="text-zinc-400">{formatNumber(point.tokens)} tokens</div>
                  </div>
                </motion.div>
              ))}
            </div>
            <div className="mt-4 flex justify-between px-2 text-[10px] text-zinc-400 font-medium uppercase tracking-widest">
              {overview.usage_trend.map((point, i) => (
                <span key={`${point.date}-label-${i}`}>{usageTrendAxisLabel(point, range)}</span>
              ))}
            </div>
          </div>

          {overview.affiliate_enabled !== false ? (
          <div className="p-6 bg-white border border-zinc-200 rounded-2xl shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <Gift size={20} className="text-zinc-400" />
                <h3 className="font-semibold text-zinc-900">Referral Program</h3>
              </div>
              <Link to="/console/referral" className="text-xs font-bold text-zinc-500 hover:text-zinc-900 transition-colors flex items-center gap-1 group">
                View Details
                <ArrowRight size={14} weight="bold" className="group-hover:translate-x-0.5 transition-transform" />
              </Link>
            </div>
            <div className="grid grid-cols-3 divide-x divide-zinc-100">
              <div className="px-2 lg:px-4 first:pl-0">
                 <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Earnings</span>
                 <div className="text-xl font-bold text-zinc-900 mt-1">{formatCredits(overview.referral_summary.earnings)} <span className="text-xs font-normal text-zinc-500">Credits</span></div>
              </div>
              <div className="px-2 lg:px-4">
                 <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Invited</span>
                 <div className="text-xl font-bold text-zinc-900 mt-1">{formatNumber(overview.referral_summary.invited)}</div>
              </div>
              <div className="px-2 lg:px-4 last:pr-0">
                 <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Orders</span>
                 <div className="text-xl font-bold text-zinc-900 mt-1">{formatNumber(overview.referral_summary.orders)}</div>
              </div>
            </div>
          </div>
          ) : null}
        </div>

        {/* Quick Info */}
        <div className="space-y-6">
          <div className="p-6 bg-white border border-zinc-200 rounded-2xl shadow-sm">
            <span className="text-xs font-bold uppercase tracking-widest text-zinc-500">
              {globalPlan.name} quota
            </span>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-2xl font-bold text-zinc-900">{formatNumber(planUsedPercent, { maximumFractionDigits: 1 })}% <span className="text-sm font-normal text-zinc-400">used</span></span>
              <div className="h-2 w-24 bg-zinc-100 rounded-full overflow-hidden">
                <div className="h-full bg-rose-500" style={{ width: `${planUsedPercent}%` }} />
              </div>
            </div>
            <p className="mt-4 text-[10px] text-zinc-400 uppercase tracking-tighter flex items-center gap-1">
              <Clock size={12} />
              {formatResetTime(globalPlan.current_period_end)}
            </p>
          </div>

          <div className="console-inverted-panel p-6 bg-zinc-900 rounded-2xl text-white shadow-xl overflow-hidden relative group">
            <Pulse size={80} className="absolute -right-4 -bottom-4 text-white/5 group-hover:text-white/10 transition-colors duration-500" />
            <h3 className="text-sm font-medium text-zinc-400">Primary API Key</h3>
            <p className="mt-1 text-xs font-semibold text-zinc-200">{overview.primary_key?.name ?? "No active key"}</p>
            <div className="console-inverted-subtle mt-4 flex items-center gap-2 bg-white/5 rounded-lg p-3 border border-white/10 backdrop-blur-sm">
              <code className="console-inverted-code text-xs font-mono text-zinc-300">{overview.primary_key?.masked_key ?? "Create your first key"}</code>
              <Link to="/console/install-guide" aria-label="Open install guide" className="ml-auto p-1.5 hover:bg-white/10 rounded-md transition-colors">
                <ArrowUpRight size={14} />
              </Link>
            </div>
            <p className="mt-4 text-[10px] text-zinc-500 leading-relaxed uppercase tracking-tighter">
              Active in {overview.primary_key?.environments ?? 0} environments. Last used {relativeTime(overview.primary_key?.last_used_at)}.
            </p>
          </div>

          <div className="p-6 bg-white border border-zinc-200 rounded-2xl shadow-sm">
            <h3 className="font-semibold text-zinc-900 mb-4">Latest Announcements</h3>
            <div className="space-y-4">
              {overview.latest_announcements.map((item) => (
                <div key={item.id} className="flex flex-col gap-1 pb-3 border-b border-zinc-100 last:border-0 last:pb-0">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-zinc-900 truncate">{item.title}</span>
                    <span className="text-[10px] text-zinc-400 whitespace-nowrap">{relativeTime(item.published_at)}</span>
                  </div>
                  <span className={`text-[9px] uppercase tracking-widest font-bold ${
                    item.type === "update" ? "text-emerald-600" : "text-amber-600"
                  }`}>{item.type}</span>
                </div>
              ))}
            </div>
            <Link to="/console/announcements" className="mt-6 block w-full rounded-lg border border-zinc-200 py-2 text-center text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-900">
              View All Announcements
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
