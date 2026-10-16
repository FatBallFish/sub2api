import React, { useMemo, useState } from "react";
import { Info, Lightning, MagnifyingGlass, SlidersHorizontal } from "@phosphor-icons/react";
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
  return formatCurrency(value * PER_MILLION, "USD");
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

function intervalRows(model: PlazaModel): PlazaPricingInterval[] {
  if (!model.pricing?.intervals?.length) return [];
  return model.pricing.intervals;
}

/** token 模型行：实付（后端已合成分组倍率）+ 官方参考。 */
function TokenModelRows({ model }: { model: PlazaModel }) {
  const { t } = useTranslation("public");
  const intervals = intervalRows(model);
  const official = model.official_pricing;
  return (
    <>
      <tr className="transition-colors hover:bg-zinc-50/50">
        <td className="px-6 py-4 font-mono text-sm font-medium text-zinc-900" rowSpan={Math.max(1, intervals.length)}>
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
      {intervals.map((iv) => (
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

/** 按次/图片/视频模型行。 */
function RequestModelRows({ model }: { model: PlazaModel }) {
  const { t } = useTranslation("public");
  const pricing = model.pricing;
  const tiers = pricing?.intervals?.filter((iv) => iv.per_request_price != null) ?? [];
  const flatPrice = pricing?.per_request_price ?? null;
  const official = model.official_pricing;
  return (
    <>
      {flatPrice != null ? (
        <tr className="transition-colors hover:bg-zinc-50/50">
          <td className="px-6 py-4 font-mono text-sm font-medium text-zinc-900">{model.name}</td>
          <td className="px-6 py-4 text-sm font-bold text-zinc-900">
            <span className="inline-flex items-center gap-1.5">
              <Lightning size={13} weight="fill" className="text-amber-500" />
              {formatUSD(flatPrice)}
            </span>
            <span className="ml-1.5 text-xs font-medium text-zinc-400">/ {t("modelPricing.perRequest")}</span>
          </td>
          <td className="px-6 py-4 text-sm text-zinc-400">-</td>
          <td className="px-6 py-4 font-mono text-sm text-zinc-500">-</td>
        </tr>
      ) : null}
      {tiers.map((iv) => (
        <tr key={`${model.name}-tier-${iv.tier_label || iv.min_tokens}`} className="transition-colors hover:bg-zinc-50/50">
          <td className="px-6 py-4 font-mono text-sm font-medium text-zinc-900">{model.name}</td>
          <td className="px-6 py-4 text-sm font-bold text-zinc-900">
            <span className="mr-2 inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-600">{iv.tier_label}</span>
            {formatUSD(iv.per_request_price ?? 0)}
            <span className="ml-1.5 text-xs font-medium text-zinc-400">/ {t("modelPricing.perRequest")}</span>
          </td>
          <td className="px-6 py-4 text-sm text-zinc-400">-</td>
          <td className="px-6 py-4 font-mono text-sm text-zinc-500">-</td>
        </tr>
      ))}
      {flatPrice == null && tiers.length === 0 ? (
        <tr className="transition-colors hover:bg-zinc-50/50">
          <td className="px-6 py-4 font-mono text-sm font-medium text-zinc-900">{model.name}</td>
          <td className="px-6 py-4 text-sm text-zinc-400">-</td>
          <td className="px-6 py-4 text-sm text-zinc-400">{official ? formatPairPerMillion(official.input_price, official.output_price) : "-"}</td>
          <td className="px-6 py-4 font-mono text-sm text-zinc-500">-</td>
        </tr>
      ) : null}
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
          {models.map((model) => (
            <TokenModelRows key={`${model.platform}-${model.name}`} model={model} />
          ))}
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

function FilterBar({
  platforms,
  groups,
  rates,
  filter,
  onChange,
}: {
  platforms: string[];
  groups: ModelPlazaGroup[];
  rates: number[];
  filter: FilterState;
  onChange: (next: FilterState) => void;
}) {
  const { t } = useTranslation("public");
  const selectClass =
    "rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-800 outline-none transition focus:border-zinc-400";
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
      <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">
        <SlidersHorizontal size={14} />
        {t("modelPricing.filter")}
      </span>
      <select
        className={selectClass}
        value={filter.platform}
        onChange={(e) => onChange({ ...filter, platform: e.target.value, groupId: "all" })}
      >
        <option value="all">{t("modelPricing.allPlatforms")}</option>
        {platforms.map((platform) => (
          <option key={platform} value={platform}>{platform}</option>
        ))}
      </select>
      <select
        className={selectClass}
        value={filter.groupId}
        onChange={(e) => onChange({ ...filter, groupId: e.target.value === "all" ? "all" : Number(e.target.value) })}
      >
        <option value="all">{t("modelPricing.allGroups")}</option>
        {groups
          .filter((g) => filter.platform === "all" || g.platform === filter.platform)
          .map((group) => (
            <option key={group.id} value={group.id}>
              {group.name} · {formatMultiplier(effectiveRate(group))}
            </option>
          ))}
      </select>
      <select
        className={selectClass}
        value={String(filter.rate)}
        onChange={(e) => onChange({ ...filter, rate: e.target.value === "all" ? "all" : Number(e.target.value) })}
      >
        <option value="all">{t("modelPricing.allRates")}</option>
        {rates.map((rate) => (
          <option key={rate} value={rate}>{formatMultiplier(rate)}</option>
        ))}
      </select>
      <div className="relative ml-auto">
        <MagnifyingGlass size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
        <input
          className="w-56 rounded-xl border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm text-zinc-800 outline-none transition placeholder:text-zinc-300 focus:border-zinc-400"
          placeholder={t("modelPricing.searchPlaceholder")}
          value={filter.search}
          onChange={(e) => onChange({ ...filter, search: e.target.value })}
        />
      </div>
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
  const rates = useMemo(
    () => [...new Set((data?.groups ?? []).map(effectiveRate))].sort((a, b) => a - b),
    [data],
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
                <FilterBar platforms={platforms} groups={data.groups ?? []} rates={rates} filter={filter} onChange={setFilter} />
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
