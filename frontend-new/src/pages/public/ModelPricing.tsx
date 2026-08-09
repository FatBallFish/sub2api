import React, { useState } from "react";
import {
  Info,
  Calculator,
  Lightning
} from "@phosphor-icons/react";
import { motion } from "motion/react";
import { getConsoleModelPricing, getModelPricing } from "../../api/public";
import type { ConsoleModelPricingGroup, PublicModelPricing, PublicModelPricingProduct, PublicModelPricingRow, PublicPricePair } from "../../types/public";

function formatUSD(value: number) {
  const hasCents = !Number.isInteger(value);
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

function formatPair(pair?: PublicPricePair) {
  return pair ? formatUSD(pair.gateway) : "-";
}

function formatGatewayPair(input: PublicPricePair, output: PublicPricePair) {
  return `${formatUSD(input.gateway)} / ${formatUSD(output.gateway)}`;
}

function formatOfficialPair(input: PublicPricePair, output: PublicPricePair) {
  return `${formatUSD(input.official)} / ${formatUSD(output.official)}`;
}

function firstProduct(products: PublicModelPricingProduct[]) {
  return products[0]?.label || "";
}

function formatMultiplier(value?: number) {
  if (value == null || Number.isNaN(value)) return "";
  return `${value.toFixed(3)}x`;
}

function groupLabel(group: ConsoleModelPricingGroup) {
  return `${group.name}${group.platform ? ` · ${group.platform}` : ""}`;
}

function ModelName({ row }: { row: PublicModelPricingRow }) {
  return (
    <>
      <div className="font-bold text-zinc-900">{row.label || row.model}</div>
      {row.label && row.label !== row.model ? <div className="mt-1 text-xs font-medium text-zinc-400">{row.model}</div> : null}
    </>
  );
}

function TokenPricingTable({ product, rows }: { product: PublicModelPricingProduct; rows: PublicModelPricingRow[] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <table className="w-full min-w-[760px] border-collapse text-left">
        <thead><tr className="border-b border-zinc-200 bg-zinc-50/50">
          <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Model</th>
          <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Official (In/Out)</th>
          <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-900">Gateway Price</th>
          <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Cache Write/Read</th>
        </tr></thead>
        <tbody className="divide-y divide-zinc-100">
          {rows.map((row) => (
            <tr key={row.model} className="transition-colors hover:bg-zinc-50/30">
              <td className="px-6 py-5"><ModelName row={row} /></td>
              <td className="px-6 py-5 text-sm text-zinc-400">{row.input && row.output ? formatOfficialPair(row.input, row.output) : "-"}</td>
              <td className="px-6 py-5">
                <div className="flex flex-col">
                  <span className="text-sm font-bold text-zinc-900">{row.input && row.output ? formatGatewayPair(row.input, row.output) : "-"}</span>
                  <span className="mt-0.5 text-[9px] font-bold uppercase text-emerald-600">
                    {row.multiplier_group_name ? `${row.multiplier_group_name} · ` : ""}
                    {row.multiplier != null ? formatMultiplier(row.multiplier) : product.multiplier}
                  </span>
                </div>
              </td>
              <td className="px-6 py-5 font-mono text-sm text-zinc-500">{formatPair(row.cache_write)} / {formatPair(row.cache_read)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RequestPricingTable({ rows }: { rows: PublicModelPricingRow[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <table className="w-full border-collapse text-left">
        <thead><tr className="border-b border-zinc-200 bg-zinc-50/50">
          <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Model</th>
          <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Parameter</th>
          <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Official</th>
          <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-900"><span className="flex items-center gap-2"><Lightning size={14} weight="fill" className="text-amber-500" />Gateway Price</span></th>
        </tr></thead>
        <tbody className="divide-y divide-zinc-100">
          {rows.flatMap((row) => (row.request_prices || []).map((tier, index) => (
            <tr key={`${row.model}-${tier.label}`} className="transition-colors hover:bg-zinc-50/30">
              <td className="px-6 py-5">{index === 0 ? <ModelName row={row} /> : null}</td>
              <td className="px-6 py-5 text-sm font-bold text-zinc-700">{tier.label}</td>
              <td className="px-6 py-5 text-sm text-zinc-400">{formatUSD(tier.price.official)} / request</td>
              <td className="px-6 py-5 text-sm font-bold text-zinc-900">{formatUSD(tier.price.gateway)} / request</td>
            </tr>
          )))}
        </tbody>
      </table>
    </div>
  );
}

function ProductPricing({ product }: { product: PublicModelPricingProduct }) {
  const available = product.rows.filter((row) => row.availability !== "unsupported");
  const tokenRows = available.filter((row) => !row.billing_mode || row.billing_mode === "token");
  const requestRows = available.filter((row) => row.billing_mode === "per_request" || row.billing_mode === "image");
  const unsupportedRows = product.rows.filter((row) => row.availability === "unsupported");

  return (
    <div className="space-y-6">
      {tokenRows.length > 0 ? <TokenPricingTable product={product} rows={tokenRows} /> : null}
      {requestRows.length > 0 ? <RequestPricingTable rows={requestRows} /> : null}
      {unsupportedRows.length > 0 ? (
        <div className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white">
          {unsupportedRows.map((row) => (
            <div key={row.model} className="flex flex-col gap-2 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
              <ModelName row={row} />
              <span className="text-sm font-bold text-zinc-500">Not supported by this group</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function ModelPricing({ isConsole = false }: { isConsole?: boolean }) {
  const [pricing, setPricing] = React.useState<PublicModelPricing | null>(null);
  const [activeTab, setActiveTab] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState<number | undefined>(undefined);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;

    const request = isConsole ? getConsoleModelPricing(selectedGroupId) : getModelPricing();
    request
      .then((data) => {
        if (!active) return;
        setPricing(data);
        if (isConsole && data.selected_group_id && selectedGroupId !== data.selected_group_id) {
          setSelectedGroupId(data.selected_group_id);
        }
        setActiveTab((current) => data.products.some((product) => product.label === current) ? current : firstProduct(data.products));
        setError(null);
      })
      .catch((err: unknown) => {
        if (active) {
          setError(err instanceof Error ? err.message : "Unable to load model pricing.");
        }
      });

    return () => {
      active = false;
    };
  }, [isConsole, selectedGroupId]);

  const products = pricing?.products || [];
  const activeProduct = products.find((product) => product.label === activeTab) || products[0];
  const groups = pricing?.groups || [];

  return (
    <div className={isConsole ? "space-y-8" : "pt-32 pb-24 px-8 max-w-7xl mx-auto"}>
      <div>
        <div className="mb-12">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Model Pricing</h1>
          <p className="mt-2 text-zinc-500 max-w-2xl leading-relaxed">
            Token models are shown per 1M tokens. Per-request and image models are shown by their configured parameter tier.
          </p>
        </div>

        {isConsole && groups.length > 0 && (
          <div className="mb-8 flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Selected Group</div>
              <div className="mt-1 text-sm font-medium text-zinc-600">Prices below use the selected group multiplier.</div>
            </div>
            <select
              className="min-w-64 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm font-bold text-zinc-900 outline-none transition focus:border-zinc-400"
              value={selectedGroupId || ""}
              onChange={(event) => setSelectedGroupId(Number(event.target.value))}
            >
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {groupLabel(group)} · {formatMultiplier(group.rate_multiplier)}
                </option>
              ))}
            </select>
          </div>
        )}

        {error && (
          <div className="mb-8 rounded-2xl border border-red-100 bg-red-50 px-5 py-4 text-sm font-medium text-red-700">
            {error}
          </div>
        )}

        {!pricing ? (
          <div className="py-16 text-center text-sm font-bold uppercase tracking-widest text-zinc-400">
            Loading model pricing...
          </div>
        ) : (
          <>
        {/* Tabs */}
        <div className="flex items-center gap-2 border-b border-zinc-100 mb-8">
          {products.map((product) => (
            <button
              key={product.id}
              onClick={() => setActiveTab(product.label)}
              className={`px-6 py-3 text-sm font-bold transition-all relative ${
                activeProduct?.id === product.id ? "text-zinc-900" : "text-zinc-400 hover:text-zinc-600"
              }`}
            >
              {product.label}
              {activeProduct?.id === product.id && (
                <motion.div layoutId="modelTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-zinc-900" />
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        {activeProduct && activeProduct.rows.length > 0 ? (
          <ProductPricing product={activeProduct} />
        ) : activeProduct && activeProduct.supported === false ? (
          <div className="py-24 text-center border-2 border-dashed border-zinc-100 rounded-[2.5rem]">
            <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-50 text-zinc-300 mb-6">
              <Calculator size={32} />
            </div>
            <h3 className="text-xl font-bold text-zinc-900">This group does not support this model category</h3>
            <p className="mt-2 text-zinc-500 max-w-xs mx-auto text-sm leading-relaxed">
              {activeProduct.unsupported_reason || "Choose another group to view this category."}
            </p>
          </div>
        ) : (
          <div className="py-24 text-center border-2 border-dashed border-zinc-100 rounded-[2.5rem]">
            <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-50 text-zinc-300 mb-6">
              <Calculator size={32} />
            </div>
            <h3 className="text-xl font-bold text-zinc-900">{activeTab} Pricing Coming Soon</h3>
            <p className="mt-2 text-zinc-500 max-w-xs mx-auto text-sm leading-relaxed">
              {activeProduct?.description || "Pricing will be published after launch."}
            </p>
          </div>
        )}
        </>
        )}

        {/* Note */}
        <div className="console-formula-note mt-12 p-8 bg-zinc-50 rounded-[2rem] border border-zinc-100 flex items-start gap-6">
          <div className="p-3 bg-white rounded-xl border border-zinc-200 shadow-sm text-zinc-400">
            <Info size={24} />
          </div>
          <div className="space-y-2">
            <h4 className="font-bold text-zinc-900">How we calculate consumption</h4>
            <p className="text-sm text-zinc-500 leading-relaxed max-w-3xl">
              Token-priced requests use the final upstream token count: <code className="console-formula-code bg-zinc-200 px-1 rounded text-zinc-900">Official Rate × Multiplier × Tokens</code>.
              Per-request models use the displayed parameter tier price instead.
              Public prices use the lowest multiplier among public groups. Console prices use the selected group multiplier.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
