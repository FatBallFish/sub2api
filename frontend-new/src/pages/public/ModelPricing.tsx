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
  type PlazaTimePricingPeriod,
} from "../../api/modelPlaza";
import { formatCurrency } from "../../utils/format";
import { localizedErrorMessage } from "../../utils/localizedError";
import { usePageTitle } from "../../hooks/usePageTitle";

const PER_MILLION = 1_000_000;

function formatUSD(value: number) {
  return formatCurrency(value, "USD");
}

/**
 * 价格展示：至少 2 位小数，必要时扩展位数（至多 6 位）避免把折扣价舍没。
 * 0.375 → $0.375；0.2 → $0.20；1.75 → $1.75。
 */
function formatPrice(value: number) {
  for (let digits = 2; digits <= 6; digits += 1) {
    const formatted = value.toFixed(digits);
    if (Number(formatted) === value) {
      return formatUSD(Number(formatted));
    }
  }
  return formatUSD(Number(value.toFixed(6)));
}

/** $/1M token 实付价：基础价 × 生效倍率。 */
function paidPerMillion(value: number | null | undefined, rate: number) {
  if (value == null) return "-";
  return formatPrice(value * rate * PER_MILLION);
}

/** 官方参考价（$/1M token），不乘倍率。 */
function officialPerMillion(value: number | null | undefined) {
  if (value == null) return "-";
  return formatPrice(value * PER_MILLION);
}

function formatMultiplier(value?: number) {
  if (value == null || Number.isNaN(value)) return "";
  return `${value}x`;
}

function effectiveRate(group: ModelPlazaGroup) {
  return group.user_rate_multiplier ?? group.rate_multiplier;
}

function isRequestBilled(model: PlazaModel) {
  const mode = model.pricing?.billing_mode;
  return mode === "per_request" || mode === "image" || mode === "video";
}

function isTokenBilled(model: PlazaModel) {
  return !isRequestBilled(model);
}

function tokenIntervals(model: PlazaModel): PlazaPricingInterval[] {
  return model.pricing?.intervals ?? [];
}

function officialIntervals(model: PlazaModel): PlazaPricingInterval[] {
  return model.official_pricing?.intervals ?? [];
}

function requestTiers(model: PlazaModel): PlazaPricingInterval[] {
  return model.pricing?.intervals?.filter((iv) => iv.per_request_price != null) ?? [];
}

function usesIndependentMediaRate(model: PlazaModel, group: ModelPlazaGroup) {
  const mode = model.pricing?.billing_mode;
  return (mode === "image" && group.image_rate_independent === true)
    || (mode === "video" && group.video_rate_independent === true);
}

/** 非 token 行的生效倍率：图片/视频可分别用独立倍率覆盖分组倍率。 */
function requestRate(model: PlazaModel, group: ModelPlazaGroup) {
  const mode = model.pricing?.billing_mode;
  if (mode === "video" && group.video_rate_independent === true) {
    return Math.max(0, group.video_rate_multiplier ?? 1);
  }
  if (mode === "image" && group.image_rate_independent === true) {
    return group.image_rate_multiplier ?? 1;
  }
  return effectiveRate(group);
}

function timePeriods(model: PlazaModel): PlazaTimePricingPeriod[] {
  return model.time_pricing?.periods ?? [];
}

/** 时段行生效倍率 = 分组生效倍率 × 时段倍率（去掉浮点噪声）。 */
function periodRate(group: ModelPlazaGroup, period: PlazaTimePricingPeriod) {
  return Math.round(effectiveRate(group) * period.multiplier * 1000) / 1000;
}

function tierLabel(iv: PlazaPricingInterval) {
  if (iv.tier_label) return iv.tier_label;
  return `≥${iv.min_tokens}`;
}

type ModelRowProps = {
  model: PlazaModel;
  group: ModelPlazaGroup;
  period: PlazaTimePricingPeriod | null;
};

function officialTokenCell(value: number | null | undefined, tiers: PlazaPricingInterval[], pick: (iv: PlazaPricingInterval) => number | null | undefined) {
  return (
    <td className="border-l border-zinc-100 px-4 py-4 align-middle font-mono text-sm text-zinc-400">
      {tiers.length ? (
        <div className="space-y-1">
          {tiers.map((iv, idx) => (
            <div key={`ot-${idx}`} className="whitespace-nowrap text-xs leading-5">
              <span className="mr-1.5 text-zinc-300">{tierLabel(iv)}</span>
              {officialPerMillion(pick(iv))}
            </div>
          ))}
        </div>
      ) : (
        officialPerMillion(value)
      )}
    </td>
  );
}

/** 模型行：token 模型展示输入/输出/缓存三组子列；按次模型站点侧合并展示档位价。 */
function ModelRow({ model, group, period }: ModelRowProps) {
  const { t } = useTranslation("public");
  const rate = period ? periodRate(group, period) : effectiveRate(group);
  const official = model.official_pricing;
  const officialTiers = officialIntervals(model);

  const officialCacheCell = (
    <td className="px-4 py-4 align-middle font-mono text-xs text-zinc-400">
      {officialTiers.length
        ? officialTiers.some((iv) => iv.cache_write_price != null || iv.cache_read_price != null)
          ? officialTiers.map((iv, idx) => (
              <div key={`otc-${idx}`} className="whitespace-nowrap leading-5">
                {iv.cache_write_price != null || iv.cache_read_price != null ? (
                  <>
                    <span className="mr-1 text-zinc-300">{tierLabel(iv)}</span>
                    {officialPerMillion(iv.cache_write_price)}
                    <span className="mx-1 text-zinc-300">/</span>
                    {officialPerMillion(iv.cache_read_price)}
                  </>
                ) : null}
              </div>
            ))
          : null
        : official && (official.cache_write_price != null || official.cache_read_price != null)
          ? (
            <div className="whitespace-nowrap leading-5">
              {officialPerMillion(official.cache_write_price)}
              <span className="mx-1 text-zinc-300">/</span>
              {officialPerMillion(official.cache_read_price)}
            </div>
          )
          : "-"}
    </td>
  );

  const rateCell = (
    <td className="border-l border-zinc-100 py-4 pl-3 pr-5 text-right align-middle font-mono text-xs">
      {period ? (
        <span className="font-bold text-emerald-600">{formatMultiplier(rate)}</span>
      ) : usesIndependentMediaRate(model, group) ? (
        <span className="font-bold text-zinc-700">{formatMultiplier(requestRate(model, group))}</span>
      ) : group.user_rate_multiplier != null && group.user_rate_multiplier !== group.rate_multiplier ? (
        <span>
          <span className="mr-1.5 text-zinc-300 line-through">{formatMultiplier(group.rate_multiplier)}</span>
          <span className="font-bold text-emerald-600">{formatMultiplier(group.user_rate_multiplier)}</span>
        </span>
      ) : (
        <span className="font-bold text-zinc-700">{formatMultiplier(rate)}</span>
      )}
    </td>
  );

  return (
    <tr className="transition-colors hover:bg-zinc-50/50">
      <td className="border-r border-zinc-100 py-4 pl-5 pr-4 align-middle">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-sm font-medium text-zinc-900">{model.name}</span>
          {period ? (
            <span className="whitespace-nowrap rounded-md bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] font-medium text-zinc-500">
              {model.time_pricing?.weekdays_only ? `${t("modelPricing.weekdaysOnly")} ` : ""}
              {period.start_time}-{period.end_time}
            </span>
          ) : null}
          {!isTokenBilled(model) ? (
            <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500">{t("modelPricing.perRequestBadge")}</span>
          ) : null}
        </div>
      </td>

      {isTokenBilled(model) ? (
        <>
          <td className="px-4 py-4 align-middle font-mono text-sm font-semibold text-zinc-900">
            {tokenIntervals(model).length ? (
              <div className="space-y-1">
                {tokenIntervals(model).map((iv, idx) => (
                  <div key={`ti-${idx}`} className="whitespace-nowrap text-xs leading-5">
                    <span className="mr-1.5 text-zinc-400">{tierLabel(iv)}</span>
                    {paidPerMillion(iv.input_price, rate)}
                  </div>
                ))}
              </div>
            ) : (
              paidPerMillion(model.pricing?.input_price, rate)
            )}
          </td>
          <td className="px-4 py-4 align-middle font-mono text-sm font-semibold text-zinc-900">
            {tokenIntervals(model).length ? (
              <div className="space-y-1">
                {tokenIntervals(model).map((iv, idx) => (
                  <div key={`to-${idx}`} className="whitespace-nowrap text-xs leading-5">
                    {paidPerMillion(iv.output_price, rate)}
                  </div>
                ))}
              </div>
            ) : (
              paidPerMillion(model.pricing?.output_price, rate)
            )}
          </td>
          <td className="px-4 py-4 align-middle font-mono text-xs text-zinc-700">
            {tokenIntervals(model).some((iv) => iv.cache_write_price != null || iv.cache_read_price != null) ? (
              <div className="space-y-1">
                {tokenIntervals(model).map((iv, idx) => (
                  <div key={`tc-${idx}`} className="whitespace-nowrap leading-5">
                    {iv.cache_write_price != null || iv.cache_read_price != null ? (
                      <>
                        {paidPerMillion(iv.cache_write_price, rate)}
                        <span className="mx-1 text-zinc-300">/</span>
                        {paidPerMillion(iv.cache_read_price, rate)}
                      </>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : model.pricing && (model.pricing.cache_write_price != null || model.pricing.cache_read_price != null) ? (
              <div className="whitespace-nowrap leading-5">
                {paidPerMillion(model.pricing.cache_write_price, rate)}
                <span className="mx-1 text-zinc-300">/</span>
                {paidPerMillion(model.pricing.cache_read_price, rate)}
              </div>
            ) : (
              "-"
            )}
          </td>
        </>
      ) : (
        <td colSpan={3} className="px-4 py-4 align-middle">
          {requestTiers(model).length ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {requestTiers(model).map((iv, idx) => (
                <span key={`rt-${idx}`} className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-0.5 font-mono text-xs text-zinc-800">
                  <span className="text-zinc-400">{iv.tier_label}</span>
                  {formatPrice((iv.per_request_price ?? 0) * requestRate(model, group))}
                  <span className="text-zinc-400">/ {t("modelPricing.perRequest")}</span>
                </span>
              ))}
            </div>
          ) : model.pricing?.per_request_price != null ? (
            <span className="inline-flex items-center gap-1.5 font-mono text-sm font-semibold text-zinc-900">
              <Lightning size={13} weight="fill" className="text-amber-500" />
              {formatPrice(model.pricing.per_request_price * requestRate(model, group))}
              <span className="text-xs font-medium text-zinc-400">/ {t("modelPricing.perRequest")}</span>
            </span>
          ) : (
            "-"
          )}
        </td>
      )}

      {officialTokenCell(official?.input_price, officialTiers, (iv) => iv.input_price)}
      {officialTokenCell(official?.output_price, officialTiers, (iv) => iv.output_price)}
      {officialCacheCell}
      {rateCell}
    </tr>
  );
}

function GroupPricingTable({ group }: { group: ModelPlazaGroup }) {
  const { t } = useTranslation("public");
  const models = group.models ?? [];
  const rows = useMemo(() => {
    // token 模型在前（按官方输出价降序），按次/图片/视频沉底；每个模型一行标准价，
    // 配置了分时倍率的模型再按时段各加一行（价格与倍率列按时段倍率计）。
    const token = models.filter(isTokenBilled).sort((a, b) => {
      const ao = a.official_pricing?.output_price ?? -1;
      const bo = b.official_pricing?.output_price ?? -1;
      return bo - ao;
    });
    const request = models.filter(isRequestBilled);
    return [...token, ...request].flatMap((model) => {
      const base = { model, period: null as PlazaTimePricingPeriod | null };
      const periodRows = timePeriods(model).map((period) => ({ model, period }));
      return [base, ...periodRows];
    });
  }, [models]);

  if (models.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <table className="w-full min-w-[900px] border-collapse text-left">
        <thead>
          <tr className="border-b border-zinc-200 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">
            <th rowSpan={2} className="py-4 pl-5 pr-4 align-middle">{t("modelPricing.model")}</th>
            <th colSpan={3} className="border-l border-zinc-100 px-4 py-4 text-center align-middle text-zinc-900">
              {t("modelPricing.sitePrice")}
              <span className="ml-1.5 font-mono text-[9px] normal-case tracking-normal text-zinc-400">{t("modelPricing.unitPerMillion")}</span>
            </th>
            <th colSpan={3} className="border-l border-zinc-100 px-4 py-4 text-center align-middle">
              {t("modelPricing.officialPrice")}
              <span className="ml-1.5 font-mono text-[9px] normal-case tracking-normal text-zinc-400">{t("modelPricing.unitPerMillion")}</span>
            </th>
            <th rowSpan={2} className="border-l border-zinc-100 py-4 pl-3 pr-5 text-right align-middle">{t("modelPricing.colRate")}</th>
          </tr>
          <tr className="border-b border-zinc-200 bg-zinc-50/50 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">
            <th className="border-l border-zinc-100 px-4 py-3">{t("modelPricing.colInput")}</th>
            <th className="px-4 py-3">{t("modelPricing.colOutput")}</th>
            <th className="px-4 py-3">{t("modelPricing.colCache")}</th>
            <th className="border-l border-zinc-100 px-4 py-3">{t("modelPricing.colInput")}</th>
            <th className="px-4 py-3">{t("modelPricing.colOutput")}</th>
            <th className="px-4 py-3">{t("modelPricing.colCache")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <ModelRow key={`${row.model.platform}:${row.model.name}:${row.period ? row.period.start_time : "base"}:${idx}`} model={row.model} group={group} period={row.period} />
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

/** 未公开（要求登录）时的匿名最低价视图（价格已按分组倍率折算）。 */
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
            <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-900">
              {t("modelPricing.lowestPrice")}
              <span className="ml-1.5 font-mono text-[9px] normal-case tracking-normal text-zinc-400">{t("modelPricing.unitPerMillion")}</span>
            </th>
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
                  ? `${formatPrice(item.per_request_price)} / ${t("modelPricing.perRequest")}`
                  : `${paidPerMillion(item.input_price, 1)} / ${paidPerMillion(item.output_price, 1)}`}
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

// React key 常量（避免在 JSX 表达式里写字符串字面量，i18n 扫描器会误报）。
const KEY_PLATFORM_ALL = "platform-all";
const KEY_GROUP_ALL = "group-all";
const KEY_RATE_ALL = "rate-all";

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
