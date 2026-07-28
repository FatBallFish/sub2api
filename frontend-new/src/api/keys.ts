import { deleteJSON, getJSON, postJSON, putJSON } from "./client";
import type {
  ApiKey,
  ApiKeyListParams,
  ApiKeyReveal,
  CreateApiKeyRequest,
  PaginatedApiKeys,
  UpdateApiKeyRequest,
} from "../types/keys";

function buildQuery(params: ApiKeyListParams = {}) {
  const search = new URLSearchParams();
  search.set("page", String(params.page ?? 1));
  search.set("page_size", String(params.pageSize ?? 10));

  if (params.status && params.status !== "all") search.set("status", params.status);
  if (params.search) search.set("search", params.search);
  if (params.group_id !== undefined && params.group_id !== "") search.set("group_id", String(params.group_id));

  return search.toString();
}

export function listApiKeys(params: ApiKeyListParams = {}) {
  return getJSON<PaginatedApiKeys>(`/keys?${buildQuery(params)}`);
}

export function revealApiKey(id: number) {
  return postJSON<ApiKeyReveal>(`/keys/${id}/reveal`);
}

export function createApiKey(request: CreateApiKeyRequest) {
  return postJSON<ApiKey>("/keys", request);
}

export function updateApiKey(id: number, request: UpdateApiKeyRequest) {
  return putJSON<ApiKey>(`/keys/${id}`, request);
}

export function deleteApiKey(id: number) {
  return deleteJSON<{ message: string }>(`/keys/${id}`);
}
