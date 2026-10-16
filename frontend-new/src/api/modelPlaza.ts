import { getJSON } from "./client";

/** 官方参考价（USD per token，与计费目录同源；字段缺失 = 目录未覆盖）。 */
export interface PlazaOfficialPricing {
  input_price: number | null;
  output_price: number | null;
  cache_write_price: number | null;
  cache_write_1h_price?: number | null;
  cache_read_price: number | null;
  intervals?: PlazaPricingInterval[];
}

export interface PlazaPricingInterval {
  min_tokens: number;
  max_tokens: number | null;
  tier_label?: string;
  input_price: number | null;
  output_price: number | null;
  cache_write_price: number | null;
  cache_write_1h_price?: number | null;
  cache_read_price: number | null;
  per_request_price?: number | null;
}

/** 分时倍率时段：配置时区当天 [start_time, end_time) 内整单实付乘 multiplier。 */
export interface PlazaTimePricingPeriod {
  start_time: string;
  end_time: string;
  multiplier: number;
}

export interface PlazaTimePricing {
  timezone: string;
  weekdays_only?: boolean;
  periods: PlazaTimePricingPeriod[];
}

/** 实收口径的展示定价（后端已合成分组倍率；均为标准时段价）。 */
export interface PlazaModelPricing {
  billing_mode: "token" | "per_request" | "image" | "video" | string;
  input_price: number | null;
  output_price: number | null;
  cache_write_price: number | null;
  cache_write_1h_price?: number | null;
  cache_read_price: number | null;
  reasoning_effort_multipliers?: Record<string, number> | null;
  image_input_price: number | null;
  image_output_price: number | null;
  per_request_price: number | null;
  intervals: PlazaPricingInterval[];
}

export interface PlazaModel {
  name: string;
  platform: string;
  pricing: PlazaModelPricing | null;
  official_pricing: PlazaOfficialPricing | null;
  long_context_basis?: "whole_request" | "marginal" | string;
  time_pricing?: PlazaTimePricing;
}

export interface ModelPlazaGroup {
  id: number;
  name: string;
  description: string;
  platform: string;
  subscription_type: string;
  rate_multiplier: number;
  /** 登录且配了专属倍率时返回；生效倍率 = user_rate ?? rate_multiplier。 */
  user_rate_multiplier?: number;
  peak_rate_enabled: boolean;
  peak_start: string;
  peak_end: string;
  peak_rate_multiplier: number;
  is_exclusive: boolean;
  image_rate_independent: boolean;
  image_rate_multiplier: number;
  video_rate_independent: boolean;
  video_rate_multiplier: number;
  long_context_pricing_enabled: boolean;
  models: PlazaModel[];
}

/** 匿名摘要条目：未登录且广场要求登录时仅给出每个模型的当前最低价。 */
export interface ModelPlazaSummaryItem {
  name: string;
  platform: string;
  input_price?: number;
  output_price?: number;
  per_request_price?: number;
}

export interface ModelPlazaResponse {
  description: string;
  groups: ModelPlazaGroup[];
  /** true = 未登录且广场要求登录：groups 为空，价格仅以 summary 给出。 */
  limited?: boolean;
  summary?: ModelPlazaSummaryItem[];
}

/** 获取模型广场数据；登录态由客户端自动携带（专属分组/倍率）。 */
export function getModelPlaza(options?: { signal?: AbortSignal }) {
  return getJSON<ModelPlazaResponse>("/model-plaza", { signal: options?.signal });
}
