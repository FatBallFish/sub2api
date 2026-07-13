import { getJSON, postJSON } from "./client";
import type {
  APIKeysUsageStatsResponse,
  PaginatedResponse,
  UsageLog,
  UsageQueryParams,
  UsageStats,
} from "../types/usage";

function queryString(params: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      query.set(key, String(value));
    }
  }
  const encoded = query.toString();
  return encoded ? `?${encoded}` : "";
}

export function listUsageLogs(params: UsageQueryParams = {}) {
  return getJSON<PaginatedResponse<UsageLog>>(
    `/usage${queryString({
      page: params.page ?? 1,
      page_size: params.page_size ?? 20,
      model: params.search,
      api_key_id: params.api_key_id,
      start_date: params.start_date,
      end_date: params.end_date,
      sort_by: params.sort_by ?? "created_at",
      sort_order: params.sort_order ?? "desc",
    })}`,
  );
}

export function getUsageStats(params: Pick<UsageQueryParams, "api_key_id" | "start_date" | "end_date"> = {}) {
  return getJSON<UsageStats>(
    `/usage/stats${queryString({
      api_key_id: params.api_key_id,
      start_date: params.start_date,
      end_date: params.end_date,
    })}`,
  );
}

export function getAPIKeysUsageStats(apiKeyIds: number[]) {
  if (apiKeyIds.length === 0) {
    return Promise.resolve({ stats: {} } satisfies APIKeysUsageStatsResponse);
  }
  return postJSON<APIKeysUsageStatsResponse>("/usage/dashboard/api-keys-usage", {
    api_key_ids: apiKeyIds,
  });
}
