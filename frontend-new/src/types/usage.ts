export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface UsageApiKeySummary {
  id: number;
  name: string;
}

export interface UsageLog {
  id: number;
  api_key_id: number;
  request_id: string;
  model: string;
  inbound_endpoint?: string | null;
  upstream_endpoint?: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  total_cost: number;
  actual_cost: number;
  funding_source?: "balance" | "subscription" | "global_plan" | "mixed" | "free" | string;
  global_plan_subscription_id?: number | null;
  global_plan_cost?: number;
  balance_cost?: number;
  group_subscription_cost?: number;
  duration_ms?: number | null;
  first_token_ms?: number | null;
  billing_mode?: string | null;
  created_at: string;
  api_key?: UsageApiKeySummary | null;
}

export interface UsageStats {
  total_requests: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_tokens: number;
  total_tokens: number;
  total_cost: number;
  total_actual_cost: number;
  average_duration_ms: number;
}

export interface APIKeyUsageStats {
  api_key_id: number;
  today_actual_cost: number;
  total_actual_cost: number;
}

export interface APIKeysUsageStatsResponse {
  stats: Record<string, APIKeyUsageStats>;
}

export interface UsageQueryParams {
  page?: number;
  page_size?: number;
  search?: string;
  api_key_id?: number;
  start_date?: string;
  end_date?: string;
  sort_by?: string;
  sort_order?: "asc" | "desc";
}
