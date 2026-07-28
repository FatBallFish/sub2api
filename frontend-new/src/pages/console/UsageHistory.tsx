import { useEffect, useMemo, useState } from "react";
import {
  ArrowClockwise,
  DownloadSimple,
  MagnifyingGlass,
  Info,
  SlidersHorizontal
} from "@phosphor-icons/react";
import { motion, AnimatePresence } from "motion/react";
import { listApiKeys } from "../../api/keys";
import { getUsageStats, listUsageLogs } from "../../api/usage";
import { getPublicSettings } from "../../api/settings";
import type { UsageLog, UsageStats } from "../../types/usage";
import { formatCredits } from "../../utils/format";

type ColumnKey = "API KEY" | "Model" | "EndPoint" | "Tokens" | "Credits" | "First" | "Duration" | "Time" | "IP";
type TimeRange = "7d" | "30d" | "today" | "lastday";

const ALL_COLUMNS: { key: ColumnKey, defaultVisible: boolean }[] = [
  { key: "API KEY", defaultVisible: true },
  { key: "Model", defaultVisible: true },
  { key: "EndPoint", defaultVisible: false },
  { key: "Tokens", defaultVisible: true },
  { key: "Credits", defaultVisible: true },
  { key: "First", defaultVisible: false },
  { key: "Duration", defaultVisible: true },
  { key: "Time", defaultVisible: true },
  { key: "IP", defaultVisible: false },
];

const USAGE_HISTORY_COLUMNS_STORAGE_KEY = "mikiko.usage-history.columns.v1";

function defaultVisibleColumns() {
  return new Set(ALL_COLUMNS.filter((column) => column.defaultVisible).map((column) => column.key));
}

function readVisibleColumns() {
  if (typeof window === "undefined") return defaultVisibleColumns();
  const raw = window.localStorage.getItem(USAGE_HISTORY_COLUMNS_STORAGE_KEY);
  if (!raw) return defaultVisibleColumns();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return defaultVisibleColumns();
    const validKeys = new Set(ALL_COLUMNS.map((column) => column.key));
    const restored = parsed.filter((key): key is ColumnKey => typeof key === "string" && validKeys.has(key as ColumnKey));
    return restored.length > 0 ? new Set(restored) : defaultVisibleColumns();
  } catch {
    return defaultVisibleColumns();
  }
}

function persistVisibleColumns(columns: Set<ColumnKey>) {
  if (typeof window === "undefined") return;
  const ordered = ALL_COLUMNS.map((column) => column.key).filter((key) => columns.has(key));
  window.localStorage.setItem(USAGE_HISTORY_COLUMNS_STORAGE_KEY, JSON.stringify(ordered));
}

function formatCompact(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: value >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1_000_000 ? 1 : 0,
  }).format(value);
}

function formatDuration(ms?: number | null) {
  if (!ms || ms <= 0) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function relativeTime(value: string) {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "Recently";
  const diffMinutes = Math.max(Math.round((Date.now() - timestamp) / 60000), 0);
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.round(diffHours / 24)}d ago`;
}

function tokenTotal(log: UsageLog) {
  return log.input_tokens + log.output_tokens + log.cache_read_tokens + log.cache_creation_tokens;
}

function cacheHitRate(log: UsageLog) {
  const total = tokenTotal(log);
  if (total <= 0) return "-";
  return `${Math.round((log.cache_read_tokens / total) * 100)}%`;
}

function fundingLabel(log: UsageLog) {
  switch (log.funding_source) {
    case "global_plan":
      return "Global Plan";
    case "mixed":
      return "Mixed funding";
    case "subscription":
      return "Subscription";
    case "free":
      return "Free";
    case "balance":
    default:
      return "Wallet";
  }
}

function fundingBreakdown(log: UsageLog) {
  if (log.funding_source === "mixed") {
    return `Plan ${formatCredits(log.global_plan_cost ?? 0)} + Wallet ${formatCredits(log.balance_cost ?? 0)}`;
  }
  if (log.funding_source === "global_plan") {
    return `Plan ${formatCredits(log.global_plan_cost ?? log.actual_cost)}`;
  }
  if (log.funding_source === "subscription") {
    return `Included ${formatCredits(log.group_subscription_cost ?? log.actual_cost)}`;
  }
  if (log.funding_source === "free") {
    return "No charge";
  }
  return `Wallet ${formatCredits(log.balance_cost ?? log.actual_cost)}`;
}

function escapeCSV(value: string | number) {
  const text = String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function rangeDates(range: TimeRange) {
  const now = new Date();
  const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (range === "lastday") {
    target.setUTCDate(target.getUTCDate() - 1);
  }
  if (range === "today" || range === "lastday") {
    const day = isoDate(target);
    return { start_date: day, end_date: day };
  }
  const start = new Date(target);
  start.setUTCDate(start.getUTCDate() - (range === "30d" ? 29 : 6));
  return { start_date: isoDate(start), end_date: isoDate(target) };
}

function normalizePageSizeOptions(options?: number[]) {
  const normalized = (options ?? [10, 20, 50, 100])
    .filter((value) => Number.isInteger(value) && value > 0)
    .sort((a, b) => a - b);
  return normalized.length > 0 ? normalized : [10, 20, 50, 100];
}

export default function UsageHistory() {
  const [usageLogs, setUsageLogs] = useState<UsageLog[]>([]);
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [pageSizeOptions, setPageSizeOptions] = useState([10, 20, 50, 100]);
  const [timeRange, setTimeRange] = useState<TimeRange>("7d");
  const [search, setSearch] = useState("");
  const [selectedApiKeyId, setSelectedApiKeyId] = useState("");
  const [apiKeyOptions, setApiKeyOptions] = useState<Array<{ id: number; name: string }>>([]);
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(() => readVisibleColumns());
  const [showColumnsMenu, setShowColumnsMenu] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    getPublicSettings()
      .then((settings) => {
        if (!active) return;
        const options = normalizePageSizeOptions(settings.table_page_size_options);
        const defaultPageSize = settings.table_default_page_size && options.includes(settings.table_default_page_size)
          ? settings.table_default_page_size
          : options.includes(20) ? 20 : options[0];
        setPageSizeOptions(options);
        setPageSize(defaultPageSize);
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    listApiKeys({ page: 1, pageSize: 100, status: "all" })
      .then((data) => {
        if (!active) return;
        setApiKeyOptions(data.items.map((key) => ({ id: key.id, name: key.name || `Key #${key.id}` })));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const dates = rangeDates(timeRange);
    const apiKeyId = selectedApiKeyId ? Number(selectedApiKeyId) : undefined;

    Promise.all([
      listUsageLogs({ page, page_size: pageSize, search: search.trim() || undefined, api_key_id: apiKeyId, ...dates }),
      getUsageStats({ api_key_id: apiKeyId, ...dates }),
    ])
      .then(([logsResponse, statsResponse]) => {
        if (active) {
          setLoading(false);
          setUsageLogs(logsResponse.items);
          setTotal(logsResponse.total);
          setStats(statsResponse);
          setError(null);
          setRefreshing(false);
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setLoading(false);
          setRefreshing(false);
          setError(reason instanceof Error ? reason.message : "Unable to load usage history.");
        }
      });

    return () => {
      active = false;
    };
  }, [page, pageSize, search, selectedApiKeyId, timeRange, refreshCounter]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const changeTimeRange = (nextRange: TimeRange) => {
    setTimeRange(nextRange);
    setPage(1);
  };

  const changePageSize = (nextPageSize: number) => {
    setPageSize(nextPageSize);
    setPage(1);
  };

  const changeApiKey = (nextApiKeyId: string) => {
    setSelectedApiKeyId(nextApiKeyId);
    setPage(1);
  };

  const metrics = useMemo(() => [
    { label: "Total Requests", value: formatCompact(stats?.total_requests ?? 0) },
    { label: "Token Volume", value: formatCompact(stats?.total_tokens ?? 0) },
    { label: "Total Credits", value: formatCredits(stats?.total_actual_cost ?? 0) },
    { label: "Avg Duration", value: formatDuration(stats?.average_duration_ms ?? 0) },
  ], [stats]);

  const apiKeyFilterOptions = useMemo(() => {
    const options = new Map(apiKeyOptions.map((key) => [key.id, key.name]));
    for (const log of usageLogs) {
      if (!options.has(log.api_key_id)) {
        options.set(log.api_key_id, log.api_key?.name ?? `Key #${log.api_key_id}`);
      }
    }
    return [...options.entries()].map(([id, name]) => ({ id, name }));
  }, [apiKeyOptions, usageLogs]);

  const toggleColumn = (key: ColumnKey) => {
    setVisibleColumns((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      persistVisibleColumns(next);
      return next;
    });
  };

  const refreshUsageHistory = () => {
    setRefreshing(true);
    setRefreshCounter((current) => current + 1);
  };

  const exportCSV = () => {
    const rows = [
      ["API Key", "Model", "Endpoint", "Input Tokens", "Output Tokens", "Cache Read", "Cache Create", "Credits", "Funding", "Global Plan Credits", "Wallet Credits", "Subscription Credits", "Duration", "Created At"],
      ...usageLogs.map((log) => [
        log.api_key?.name ?? `Key #${log.api_key_id}`,
        log.model,
        log.inbound_endpoint ?? "",
        log.input_tokens,
        log.output_tokens,
        log.cache_read_tokens,
        log.cache_creation_tokens,
        formatCredits(log.actual_cost),
        fundingLabel(log),
        formatCredits(log.global_plan_cost ?? 0),
        formatCredits(log.balance_cost ?? 0),
        formatCredits(log.group_subscription_cost ?? 0),
        formatDuration(log.duration_ms),
        log.created_at,
      ]),
    ];
    const csv = rows.map((row) => row.map(escapeCSV).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "usage-history.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
        <h1 className="text-lg font-semibold text-rose-900">Usage history unavailable</h1>
        <p className="mt-2">{error}</p>
      </div>
    );
  }

  if (loading && !stats) {
    return (
      <div className="flex min-h-[360px] items-center justify-center rounded-2xl border border-zinc-200 bg-white text-sm font-medium text-zinc-500">
        Loading usage history...
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-32">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Usage History</h1>
          <p className="text-zinc-500 text-sm">Audit your request logs, token consumption, and credit usage.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Refresh usage history"
            onClick={refreshUsageHistory}
            disabled={refreshing}
            className="flex items-center gap-2 bg-white border border-zinc-200 text-zinc-900 px-4 py-2 rounded-lg font-medium shadow-sm hover:bg-zinc-50 transition-colors disabled:cursor-wait disabled:text-zinc-400"
          >
            <ArrowClockwise size={18} weight="bold" className={refreshing ? "animate-spin" : ""} />
            Refresh
          </button>
          <button onClick={exportCSV} className="flex items-center gap-2 bg-white border border-zinc-200 text-zinc-900 px-4 py-2 rounded-lg font-medium shadow-sm hover:bg-zinc-50 transition-colors">
            <DownloadSimple size={18} weight="bold" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {metrics.map(m => (
          <div key={m.label} className="p-4 bg-white border border-zinc-200 rounded-xl">
            <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">{m.label}</span>
            <div className="text-xl font-bold text-zinc-900 mt-1">{m.value}</div>
          </div>
        ))}
      </div>

      {/* Filters & Search */}
      <div className="flex flex-col md:flex-row md:items-center gap-4 bg-white p-4 border border-zinc-200 rounded-2xl shadow-sm">
        <div className="relative flex-1">
          <MagnifyingGlass size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            placeholder="Search by model or endpoint..."
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            className="w-full pl-12 pr-4 py-2 bg-zinc-50 border border-zinc-100 rounded-xl text-sm outline-none focus:border-zinc-900 transition-colors"
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              onClick={() => setShowColumnsMenu(!showColumnsMenu)}
              className={`p-2 rounded-xl transition-colors border flex items-center gap-2 text-sm font-medium ${showColumnsMenu ? 'bg-zinc-100 border-zinc-200 text-zinc-900' : 'bg-white border-zinc-200 hover:bg-zinc-50'}`}
            >
              <SlidersHorizontal size={18} />
              Columns
            </button>
            <AnimatePresence>
              {showColumnsMenu && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className="absolute right-0 top-full mt-2 w-48 bg-white border border-zinc-200 rounded-xl shadow-xl z-50 py-2"
                >
                  {ALL_COLUMNS.map(col => (
                    <label key={col.key} className="flex items-center gap-3 px-4 py-2 hover:bg-zinc-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={visibleColumns.has(col.key)}
                        onChange={() => toggleColumn(col.key)}
                        className="rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                      />
                      <span className="text-sm text-zinc-700">{col.key}</span>
                    </label>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <select
            aria-label="API key"
            value={selectedApiKeyId}
            onChange={(event) => changeApiKey(event.target.value)}
            className="bg-zinc-50 border border-zinc-100 rounded-xl px-4 py-2 text-sm outline-none font-medium"
          >
            <option value="">All API Keys</option>
            {apiKeyFilterOptions.map((key) => (
              <option key={key.id} value={key.id}>{key.name}</option>
            ))}
          </select>
          <select
            aria-label="Time range"
            value={timeRange}
            onChange={(event) => changeTimeRange(event.target.value as TimeRange)}
            className="bg-zinc-50 border border-zinc-100 rounded-xl px-4 py-2 text-sm outline-none font-medium"
          >
            <option value="today">Today</option>
            <option value="lastday">Lastday</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </select>
        </div>
      </div>

      {/* Usage Table */}
      <div className="bg-white border border-zinc-200 rounded-2xl shadow-sm overflow-hidden overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-max">
          <thead>
            <tr className="bg-zinc-50/50 border-b border-zinc-200">
              {ALL_COLUMNS.map(col => visibleColumns.has(col.key) && (
                <th key={col.key} className="px-6 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-[0.2em] whitespace-nowrap">
                  {col.key}
                </th>
              ))}
              <th className="px-6 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-[0.2em] text-right">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {usageLogs.length === 0 && (
              <tr>
                <td colSpan={ALL_COLUMNS.length + 1} className="px-6 py-12 text-center text-sm text-zinc-500">
                  No usage records found.
                </td>
              </tr>
            )}
            {usageLogs.map((item) => (
              <tr key={item.id} className="hover:bg-zinc-50/50 transition-colors group">
                {visibleColumns.has("API KEY") && (
                  <td className="px-6 py-4">
                    <span className="text-sm font-bold text-zinc-900">{item.api_key?.name ?? `Key #${item.api_key_id}`}</span>
                  </td>
                )}
                {visibleColumns.has("Model") && (
                  <td className="px-6 py-4">
                    <span className="text-sm text-zinc-900 font-medium">{item.model}</span>
                  </td>
                )}
                {visibleColumns.has("EndPoint") && (
                  <td className="px-6 py-4">
                    <div className="flex flex-col">
                      <span className="text-xs text-zinc-900 font-mono">{item.inbound_endpoint ?? "-"}</span>
                      <span className="text-[10px] text-zinc-400 font-mono flex items-center gap-1">
                        &rarr; {item.upstream_endpoint ?? "-"}
                      </span>
                    </div>
                  </td>
                )}
                {visibleColumns.has("Tokens") && (
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-4 relative group/tokens">
                      <div className="flex flex-col">
                        <span className="text-[10px] text-zinc-400 uppercase font-bold tracking-widest">In/Out</span>
                        <span className="text-xs font-mono text-zinc-900">{item.input_tokens.toLocaleString("en-US")} / {item.output_tokens.toLocaleString("en-US")}</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[10px] text-zinc-400 uppercase font-bold tracking-widest">Cache Read</span>
                        <span className="text-xs font-mono text-emerald-600">{item.cache_read_tokens.toLocaleString("en-US")}</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[10px] text-zinc-400 uppercase font-bold tracking-widest">Hit Rate</span>
                        <span className="text-xs font-mono text-zinc-900">{cacheHitRate(item)}</span>
                      </div>

                      {/* Hover Popover */}
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-3 bg-zinc-900 text-white rounded-lg opacity-0 invisible group-hover/tokens:opacity-100 group-hover/tokens:visible transition-all shadow-xl z-10 pointer-events-none">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-zinc-400">Total Tokens</span>
                          <span className="font-mono font-bold">{tokenTotal(item).toLocaleString("en-US")}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-zinc-400">Cache Created</span>
                          <span className="font-mono">{item.cache_creation_tokens.toLocaleString("en-US")}</span>
                        </div>
                        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-zinc-900 rotate-45" />
                      </div>
                    </div>
                  </td>
                )}
                {visibleColumns.has("Credits") && (
                  <td className="px-6 py-4">
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-bold text-zinc-900">{formatCredits(item.actual_cost)}</span>
                      <span className="w-fit rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                        {fundingLabel(item)}
                      </span>
                      <span className="text-[10px] font-medium text-zinc-400">{fundingBreakdown(item)}</span>
                    </div>
                  </td>
                )}
                {visibleColumns.has("First") && (
                  <td className="px-6 py-4 text-sm text-zinc-500 font-mono">{formatDuration(item.first_token_ms)}</td>
                )}
                {visibleColumns.has("Duration") && (
                  <td className="px-6 py-4 text-sm text-zinc-500">{formatDuration(item.duration_ms)}</td>
                )}
                {visibleColumns.has("Time") && (
                  <td className="px-6 py-4 text-sm text-zinc-400">{relativeTime(item.created_at)}</td>
                )}
                {visibleColumns.has("IP") && (
                  <td className="px-6 py-4 text-xs text-zinc-400 font-mono">Hidden</td>
                )}
                <td className="px-6 py-4 text-right">
                  <button className="p-2 text-zinc-300 group-hover:text-zinc-900 transition-colors">
                    <Info size={18} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500 shadow-sm md:flex-row md:items-center md:justify-between">
        <span>
          Showing page <strong className="text-zinc-900">{page}</strong> of <strong className="text-zinc-900">{pageCount}</strong>
        </span>
        <span className="sr-only">Page {page} of {pageCount}</span>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2">
            <span>Rows</span>
            <select
              aria-label="Rows per page"
              value={pageSize}
              onChange={(event) => changePageSize(Number(event.target.value))}
              className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-medium text-zinc-900 outline-none"
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </label>
          <button
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            className="rounded-lg border border-zinc-200 px-3 py-2 font-medium text-zinc-900 disabled:cursor-not-allowed disabled:text-zinc-300"
          >
            Prev
          </button>
          <button
            aria-label="Next page"
            disabled={page >= pageCount}
            onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
            className="rounded-lg border border-zinc-200 px-3 py-2 font-medium text-zinc-900 disabled:cursor-not-allowed disabled:text-zinc-300"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
