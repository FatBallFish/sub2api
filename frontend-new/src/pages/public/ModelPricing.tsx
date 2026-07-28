import React, { useState } from "react";
import {
  Info,
  Calculator,
  Lightning
} from "@phosphor-icons/react";
import { motion } from "motion/react";
import { getConsoleModelPricing, getModelPricing } from "../../api/public";
import type { ConsoleModelPricingGroup, PublicModelPricing, PublicModelPricingProduct, PublicPricePair } from "../../types/public";

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
            All prices are shown in USD per 1M tokens. Our gateway applies transparent coefficients to official provider rates for subscription members.
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
        {activeProduct && activeProduct.supported === false ? (
          <div className="py-24 text-center border-2 border-dashed border-zinc-100 rounded-[2.5rem]">
            <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-50 text-zinc-300 mb-6">
              <Calculator size={32} />
            </div>
            <h3 className="text-xl font-bold text-zinc-900">This group does not support this model category</h3>
            <p className="mt-2 text-zinc-500 max-w-xs mx-auto text-sm leading-relaxed">
              {activeProduct.unsupported_reason || "Choose another group to view this category."}
            </p>
          </div>
        ) : activeProduct && activeProduct.rows.length > 0 ? (
          <div className="bg-white border border-zinc-200 rounded-[2rem] overflow-hidden shadow-sm">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-zinc-50/50 border-b border-zinc-200">
                  <th className="px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-[0.2em]">Model</th>
                  <th className="px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-[0.2em]">Official (In/Out)</th>
                  <th className="px-8 py-5 text-[10px] font-bold text-zinc-900 uppercase tracking-[0.2em]">
                    <div className="flex items-center gap-2">
                      <Lightning size={14} weight="fill" className="text-amber-500" />
                      Gateway Price
                    </div>
                  </th>
                  <th className="px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-[0.2em]">Cache Write/Read</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {activeProduct.rows.map((model) => (
                  <tr key={model.model} className="group hover:bg-zinc-50/30 transition-colors">
                    <td className="px-8 py-6">
                      <div className="font-bold text-zinc-900">{model.label || model.model}</div>
                      {model.label && model.label !== model.model && (
                        <div className="mt-1 text-xs font-medium text-zinc-400">{model.model}</div>
                      )}
                    </td>
                    <td className="px-8 py-6 text-sm text-zinc-400">
                      {formatOfficialPair(model.input, model.output)}
                    </td>
                    <td className="px-8 py-6">
                      <div className="flex flex-col">
                        <span className="text-sm font-bold text-zinc-900">{formatGatewayPair(model.input, model.output)}</span>
                        <span className="text-[9px] text-emerald-600 font-bold uppercase tracking-tighter mt-0.5">
                          {model.multiplier_group_name ? `${model.multiplier_group_name} · ` : ""}
                          {model.multiplier != null ? formatMultiplier(model.multiplier) : activeProduct.multiplier}
                        </span>
                      </div>
                    </td>
                    <td className="px-8 py-6 text-sm text-zinc-500 font-mono">
                      {formatPair(model.cache_write)} / {formatPair(model.cache_read)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
              All requests are billed based on the final token count returned by the upstream provider.
              The credit cost is calculated as: <code className="console-formula-code bg-zinc-200 px-1 rounded text-zinc-900">Official Rate × Multiplier × Tokens</code>.
              Public prices use the lowest multiplier among public groups. Console prices use the selected group multiplier.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
