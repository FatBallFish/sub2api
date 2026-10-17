import React, { useMemo, useState } from "react";
import { Info, Lightning, MagnifyingGlass, X } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import {
  getModelPlaza,
  type ModelPlazaGroup,
  type ModelPlazaResponse,
  type ModelPlazaSummaryItem,
  type PlazaModel,
  type PlazaPricingInterval,
} from "../../api/modelPlaza";
import { formatCurrency } from "../../utils/format";
import { localizedErrorMessage } from "../../utils/localizedError";
import { usePageTitle } from "../../hooks/usePageTitle";

const PER_MILLION = 1_000_000;

function formatUSD(value: number) {
  return formatCurrency(value, "USD");
}

function formatPerMillion(value: number | null | undefined) {
  if (value == null) return "-";
  return formatUSD(value * PER_MILLION);
}

function formatPairPerMillion(input: number | null | undefined, output: number | null | undefined) {
  if (input == null && output == null) return "-";
  return `${formatPerMillion(input)} / ${formatPerMillion(output)}`;
}

function formatMultiplier(value?: number) {
  if (value == null || Number.isNaN(value)) return "";
  return `${value.toFixed(3)}x`;
}

function effectiveRate(group: ModelPlazaGroup) {
  return group.user_rate_multiplier ?? group.rate_multiplier;
}

function isRequestBilled(model: PlazaModel) {
  const mode = model.pricing?.billing_mode;
  return mode === "per_request" || mode === "image" || mode === "video";
}

/** token 模型行：实付（后端已合成分组倍率）+ 官方参考；多档时模型格纵向合并。 */
function TokenModelRows({ model }: { model: PlazaModel }) {
  const { t } = useTranslation("public");
  const intervals = model.pricing?.intervals ?? [];
  const official = model.official_pricing;
  return (
    <>
      <tr className="transition-colors hover:bg-zinc-50/50">
        <td className="px-6 py-4 font-mono text-sm font-medium text-zinc-900" rowSpan={intervals.length + 1}>
          {model.name}
        </td>
        <td className="px-6 py-4 text-sm font-bold text-zinc-900">
          {formatPairPerMillion(model.pricing?.input_price, model.pricing?.output_price)}
        </td>
        <td className="px-6 py-4 text-sm text-zinc-400">
          {formatPairPerMillion(official?.input_price, official?.output_price)}
        </td>
        <td className="px-6 py-4 font-mono text-sm text-zinc-500">
          {formatPairPerMillion(model.pricing?.cache_write_price, model.pricing?.cache_read_price)}
        </td>
      </tr>
      {intervals.map((iv: PlazaPricingInterval) => (
        <tr key={`${model.name}-tier-${iv.min_tokens}`} className="bg-zinc-50/40 transition-colors hover:bg-zinc-50/70">
          <td className="px-6 py-3 text-xs" colSpan={4}>
            <span className="mr-3 inline-flex items-center rounded-full bg-zinc-200/70 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-600">
              {iv.tier_label || `≥${iv.min_tokens}`}
            </span>
            <span className="text-zinc-500">
              {t("modelPricing.paidInOut")}: <span className="font-semibold text-zinc-700">{formatPairPerMillion(iv.input_price, iv.output_price)}</span>
            </span>
            {iv.cache_write_price != null || iv.cache_read_price != null ? (
              <span className="ml-3 text-zinc-400">
                {t("modelPricing.cacheWriteRead")}: {formatPairPerMillion(iv.cache_write_price, iv.cache_read_price)}
              </span>
            ) : null}
          </td>
        </tr>
      ))}
    </>
  );
}

/** 按次/图片/视频模型行：多档位时模型格纵向合并。 */
function RequestModelRows({ model }: { model: PlazaModel }) {
  const { t } = useTranslation("public");
  const pricing = model.pricing;
  const tiers = pricing?.intervals?.filter((iv) => iv.per_request_price != null) ?? [];
  const official = model.official_pricing;
  const modelCell = (rowSpan?: number) => (
    <td className="px-6 py-4 font-mono text-sm font-medium text-zinc-900" rowSpan={rowSpan}>
      {model.name}
    </td>
  );
  if (tiers.length === 0) {
    const flatPrice = pricing?.per_request_price ?? null;
    return (
      <tr className="transition-colors hover:bg-zinc-50/50">
        {modelCell()}
        <td className="px-6 py-4 text-sm font-bold text-zinc-900">
          {flatPrice != null ? (
            <span className="inline-flex items-center gap-1.5">
              <Lightning size={13} weight="fill" className="text-amber-500" />
              {formatUSD(flatPrice)}
              <span className="text-xs font-medium text-zinc-400">/ {t("modelPricing.perRequest")}</span>
            </span>
          ) : (
            "-"
          )}
        </td>
        <td className="px-6 py-4 text-sm text-zinc-400">{official ? formatPairPerMillion(official.input_price, official.output_price) : "-"}</td>
        <td className="px-6 py-4 font-mono text-sm text-zinc-500">-</td>
      </tr>
    );
  }
  return (
    <>
      {tiers.map((iv, index) => (
        <tr key={`${model.name}-tier-${iv.tier_label || iv.min_tokens}`} className="transition-colors hover:bg-zinc-50/50">
          {index === 0 ? modelCell(tiers.length) : null}
          <td className="px-6 py-4 text-sm font-bold text-zinc-900">
            {iv.tier_label ? (
              <span className="mr-2 inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-600">{iv.tier_label}</span>
            ) : null}
            {formatUSD(iv.per_request_price ?? 0)}
            <span className="ml-1.5 text-xs font-medium text-zinc-400">/ {t("modelPricing.perRequest")}</span>
          </td>
          <td className="px-6 py-4 text-sm text-zinc-400">-</td>
          <td className="px-6 py-4 font-mono text-sm text-zinc-500">-</td>
        </tr>
      ))}
    </>
  );
}

function GroupPricingTable({ group }: { group: ModelPlazaGroup }) {
  const { t } = useTranslation("public");
  const models = group.models ?? [];
  if (models.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <table className="w-full min-w-[760px] border-collapse text-left">
        <thead>
          <tr className="border-b border-zinc-200 bg-zinc-50/50">
            <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">{t("modelPricing.model")}</th>
            <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-900">
              <span className="flex items-center gap-2"><Lightning size={13} weight="fill" className="text-amber-500" />{t("modelPricing.gatewayPrice")}</span>
            </th>
            <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">{t("modelPricing.officialInOut")}</th>
            <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">{t("modelPricing.cacheWriteRead")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {models.map((model) =>
            isRequestBilled(model) ? (
              <RequestModelRows key={`${model.platform}-${model.name}`} model={model} />
            ) : (
              <TokenModelRows key={`${model.platform}-${model.name}`} model={model} />
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

function GroupSection({ group }: { group: ModelPlazaGroup }) {
  const { t } = useTranslation("public");
  const rate = effectiveRate(group);
  const timePricing = group.models?.find((m) => m.time_pricing)?.time_pricing;
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h3 className="text-lg font-bold tracking-tight text-zinc-900">{group.name}</h3>
        <span className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
          {t("modelPricing.groupMultiplier")}: {formatMultiplier(rate)}
        </span>
        {group.user_rate_multiplier != null ? (
          <span className="rounded-full bg-sky-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-sky-700">
            {t("modelPricing.userRateBadge")}
          </span>
        ) : null}
        {group.peak_rate_enabled ? (
          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-700">
            {t("modelPricing.peakRateBadge", { start: group.peak_start, end: group.peak_end, rate: formatMultiplier(group.peak_rate_multiplier) })}
          </span>
        ) : null}
        {timePricing ? (
          <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            {t("modelPricing.timePricingBadge", { timezone: timePricing.timezone })}
          </span>
        ) : null}
        {group.platform ? (
          <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500">{group.platform}</span>
        ) : null}
      </div>
      {group.description ? <p className="max-w-3xl text-sm leading-relaxed text-zinc-500">{group.description}</p> : null}
      <GroupPricingTable group={group} />
    </section>
  );
}

/** 未公开（要求登录）时的匿名最低价视图。 */
function LimitedSummaryTable({ summary }: { summary: ModelPlazaSummaryItem[] }) {
  const { t } = useTranslation("public");
  if (summary.length === 0) {
    return (
      <div className="border-2 border-dashed border-zinc-100 rounded-[2.5rem] py-20 text-center">
        <p className="text-sm text-zinc-400">{t("modelPricing.empty")}</p>
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-zinc-200 bg-zinc-50/50">
            <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">{t("modelPricing.model")}</th>
            <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-900">{t("modelPricing.lowestPrice")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {summary.map((item) => (
            <tr key={`${item.platform}-${item.name}`} className="transition-colors hover:bg-zinc-50/50">
              <td className="px-6 py-4">
                <span className="font-mono text-sm font-medium text-zinc-900">{item.name}</span>
                {item.platform ? <span className="ml-3 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">{item.platform}</span> : null}
              </td>
              <td className="px-6 py-4 text-sm font-bold text-zinc-900">
                {item.per_request_price != null
                  ? `${formatUSD(item.per_request_price)} / ${t("modelPricing.perRequest")}`
                  : formatPairPerMillion(item.input_price, item.output_price)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type FilterState = {
  platform: string;
  groupId: number | "all";
  rate: number | "all";
  search: string;
};

type FilterGroup = { id: number; name: string; platform: string; rate: number };

// React key 常量（避免在 JSX 表达式里写字符串字面量，i18n 扫描器会误报）。
const KEY_PLATFORM_ALL = "platform-all";
const KEY_GROUP_ALL = "group-all";
const KEY_RATE_ALL = "rate-all";

function chipClass(active: boolean) {
  return active
    ? "bg-zinc-900 text-white shadow-md shadow-zinc-300"
    : "bg-white text-zinc-600 ring-1 ring-inset ring-zinc-200 hover:ring-zinc-400 hover:text-zinc-900";
}

/**
 * 级联筛选（与老前端模型广场同款 facet 交互）：
 * 平台/分组/倍率三维互为约束——某选项可点 ⟺ 在其余两维当前选择下仍有分组命中；
 * 不可点项置灰而非隐藏，「全部」恒可点作为解除本维约束的出口。
 */
function FilterCascade({
  platforms,
  groups,
  rates,
  filter,
  onChange,
}: {
  platforms: string[];
  groups: FilterGroup[];
  rates: number[];
  filter: FilterState;
  onChange: (next: FilterState) => void;
}) {
  const { t } = useTranslation("public");

  const platformEnabled = (platform: string) =>
    groups.some(
      (g) =>
        g.platform === platform &&
        (filter.groupId === "all" || g.id === filter.groupId) &&
        (filter.rate === "all" || g.rate === filter.rate),
    );
  const groupEnabled = (g: FilterGroup) =>
    (filter.platform === "all" || g.platform === filter.platform) &&
    (filter.rate === "all" || g.rate === filter.rate);
  const rateEnabled = (rate: number) =>
    groups.some(
      (g) =>
        g.rate === rate &&
        (filter.platform === "all" || g.platform === filter.platform) &&
        (filter.groupId === "all" || g.id === filter.groupId),
    );

  const row = (label: string, children: React.ReactNode) => (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
      <span className="w-16 shrink-0 pt-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">{label}</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );

  const chip = (
    active: boolean,
    disabled: boolean,
    key: string,
    label: React.ReactNode,
    onClick: () => void,
    extraClass = "",
  ) => (
    <button
      key={key}
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${chipClass(active)} ${extraClass} ${
        disabled ? "cursor-not-allowed opacity-40 grayscale" : ""
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      {row(
        t("modelPricing.platformLabel"),
        <>
          {chip(filter.platform === "all", false, KEY_PLATFORM_ALL, t("modelPricing.allOption"), () =>
            onChange({ ...filter, platform: "all", groupId: "all" }),
          )}
          {platforms.map((platform) =>
            chip(
              filter.platform === platform,
              !platformEnabled(platform),
              `platform-${platform}`,
              platform,
              () => onChange({ ...filter, platform, groupId: "all" }),
              "font-mono",
            ),
          )}
        </>,
      )}
      {row(
        t("modelPricing.groupLabel"),
        <>
          {chip(filter.groupId === "all", false, KEY_GROUP_ALL, t("modelPricing.allOption"), () =>
            onChange({ ...filter, groupId: "all" }),
          )}
          {groups.map((g) =>
            chip(
              filter.groupId === g.id,
              !groupEnabled(g),
              `group-${g.id}`,
              <span title={`${g.platform} · ${formatMultiplier(g.rate)}`}>{g.name}</span>,
              () => onChange({ ...filter, groupId: filter.groupId === g.id ? "all" : g.id }),
            ),
          )}
        </>,
      )}
      {row(
        t("modelPricing.rateLabel"),
        <>
          {chip(filter.rate === "all", false, KEY_RATE_ALL, t("modelPricing.allOption"), () =>
            onChange({ ...filter, rate: "all" }),
          )}
          {rates.map((rate) =>
            chip(
              filter.rate === rate,
              !rateEnabled(rate),
              `rate-${rate}`,
              formatMultiplier(rate),
              () => onChange({ ...filter, rate: filter.rate === rate ? "all" : rate }),
              "font-mono",
            ),
          )}
        </>,
      )}
      {row(
        t("modelPricing.modelLabel"),
        <div className="relative w-full sm:w-72">
          <MagnifyingGlass size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            className="w-full rounded-full border border-zinc-200 bg-white py-1.5 pl-9 pr-9 text-sm text-zinc-800 outline-none transition placeholder:text-zinc-300 focus:border-zinc-400"
            placeholder={t("modelPricing.searchPlaceholder")}
            value={filter.search}
            onChange={(e) => onChange({ ...filter, search: e.target.value })}
          />
          {filter.search ? (
            <button
              type="button"
              aria-label={t("modelPricing.clearSearch")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 transition-colors hover:text-zinc-700"
              onClick={() => onChange({ ...filter, search: "" })}
            >
              <X size={13} weight="bold" />
            </button>
          ) : null}
        </div>,
      )}
    </div>
  );
}

export default function ModelPricing({ isConsole = false }: { isConsole?: boolean }) {
  const { t, i18n } = useTranslation("public");
  const [data, setData] = React.useState<ModelPlazaResponse | null>(null);
  const [error, setError] = React.useState<{ cause: unknown } | null>(null);
  const [filter, setFilter] = useState<FilterState>({ platform: "all", groupId: "all", rate: "all", search: "" });
  usePageTitle(t("modelPricing.heading"));

  React.useEffect(() => {
    let active = true;
    getModelPlaza()
      .then((plaza) => {
        if (!active) return;
        setData(plaza);
        setError(null);
      })
      .catch((err: unknown) => {
        if (active) setError({ cause: err });
      });
    return () => {
      active = false;
    };
  }, []);

  const platforms = useMemo(
    () => [...new Set((data?.groups ?? []).map((g) => g.platform).filter(Boolean))].sort(),
    [data],
  );
  const filterGroups = useMemo<FilterGroup[]>(
    () => (data?.groups ?? []).map((g) => ({ id: g.id, name: g.name, platform: g.platform, rate: effectiveRate(g) })),
    [data],
  );
  const rates = useMemo(
    () => [...new Set(filterGroups.map((g) => g.rate))].sort((a, b) => a - b),
    [filterGroups],
  );

  const filteredGroups = useMemo(() => {
    let groups = data?.groups ?? [];
    if (filter.platform !== "all") groups = groups.filter((g) => g.platform === filter.platform);
    if (filter.groupId !== "all") groups = groups.filter((g) => g.id === filter.groupId);
    if (filter.rate !== "all") groups = groups.filter((g) => effectiveRate(g) === filter.rate);
    const q = filter.search.trim().toLowerCase();
    if (q) {
      groups = groups
        .map((g) => ({ ...g, models: (g.models ?? []).filter((m) => m.name.toLowerCase().includes(q)) }))
        .filter((g) => (g.models ?? []).length > 0);
    }
    return [...groups].sort((a, b) => effectiveRate(a) - effectiveRate(b) || a.name.localeCompare(b.name));
  }, [data, filter]);

  const isNotFound = error !== null && (error.cause as { status?: number })?.status === 404;
  const isLimited = data?.limited === true;

  return (
    <div className={isConsole ? "space-y-8" : "pt-32 pb-24 px-8 max-w-7xl mx-auto"}>
      <div className="space-y-10">
        <div className="mb-2">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900">{t("modelPricing.heading")}</h1>
          <p className="mt-2 text-zinc-500 max-w-2xl leading-relaxed">
            {isLimited ? t("modelPricing.limitedDescription") : t("modelPricing.description")}
          </p>
        </div>

        {isLimited ? (
          <>
            <div className="flex items-start gap-4 rounded-2xl border border-zinc-100 bg-zinc-50/70 px-5 py-4">
              <Info size={20} className="mt-0.5 shrink-0 text-zinc-400" />
              <p className="text-sm leading-relaxed text-zinc-500">{t("modelPricing.limitedHint")}</p>
            </div>
            {data ? <LimitedSummaryTable summary={data.summary ?? []} /> : null}
          </>
        ) : (
          <>
            {error !== null && !isNotFound ? (
              <div className="rounded-2xl border border-red-100 bg-red-50 px-5 py-4 text-sm font-medium text-red-700">
                {localizedErrorMessage(error.cause, "modelPricingLoadFailed", i18n.t)}
              </div>
            ) : null}

            {isNotFound ? (
              <div className="border-2 border-dashed border-zinc-100 rounded-[2.5rem] py-20 text-center">
                <p className="text-sm font-medium text-zinc-400">{t("modelPricing.notAvailable")}</p>
              </div>
            ) : !data ? (
              <div className="py-16 text-center text-sm font-bold uppercase tracking-widest text-zinc-400">
                {t("modelPricing.loading")}
              </div>
            ) : (data.groups ?? []).length === 0 ? (
              <div className="border-2 border-dashed border-zinc-100 rounded-[2.5rem] py-20 text-center">
                <p className="text-sm text-zinc-400">{t("modelPricing.empty")}</p>
              </div>
            ) : (
              <>
                <FilterCascade platforms={platforms} groups={filterGroups} rates={rates} filter={filter} onChange={setFilter} />
                <div className="space-y-10">
                  {filteredGroups.map((group) => (
                    <GroupSection key={group.id} group={group} />
                  ))}
                </div>
              </>
            )}
          </>
        )}

        <div className="console-formula-note mt-4 p-8 bg-zinc-50 rounded-[2rem] border border-zinc-100 flex items-start gap-6">
          <div className="p-3 bg-white rounded-xl border border-zinc-200 shadow-sm text-zinc-400">
            <Info size={24} />
          </div>
          <div className="space-y-2">
            <h4 className="font-bold text-zinc-900">{t("modelPricing.calculationTitle")}</h4>
            <p className="text-sm text-zinc-500 leading-relaxed max-w-3xl">
              {t("modelPricing.calculationTokenPrefix")} <code className="console-formula-code bg-zinc-200 px-1 rounded text-zinc-900">{t("modelPricing.calculationFormula")}</code>. {t("modelPricing.calculationDescription")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
