export interface ApiKeyGroupSummary {
  id: number;
  name: string;
  description?: string;
  platform?: string;
  rate_multiplier?: number;
  allow_messages_dispatch?: boolean;
}

export interface ApiKey {
  id: number;
  user_id?: number;
  key: string;
  name: string;
  group_id: number | null;
  group?: ApiKeyGroupSummary;
  status: "active" | "inactive" | "disabled" | "quota_exhausted" | "expired" | "exhausted";
  quota: number;
  quota_used: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaginatedApiKeys {
  items: ApiKey[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

export interface ApiKeyListParams {
  page?: number;
  pageSize?: number;
  status?: string;
  search?: string;
  group_id?: number | string;
}

export interface ApiKeyReveal {
  key: string;
  expires_in_seconds: number;
}

export interface CreateApiKeyRequest {
  name: string;
  group_id?: number | null;
  custom_key?: string;
  quota?: number;
  expires_in_days?: number;
  ip_whitelist?: string[];
  ip_blacklist?: string[];
  rate_limit_5h?: number;
  rate_limit_1d?: number;
  rate_limit_7d?: number;
}

export interface UpdateApiKeyRequest {
  name?: string;
  group_id?: number | null;
  status?: "active" | "inactive";
  quota?: number;
  reset_quota?: boolean;
  expires_at?: string;
  ip_whitelist?: string[];
  ip_blacklist?: string[];
  rate_limit_5h?: number;
  rate_limit_1d?: number;
  rate_limit_7d?: number;
  reset_rate_limit_usage?: boolean;
}
