import { clearAuthStorage } from "../utils/authStorage";

export class ApiError extends Error {
  status: number;
  code?: string;
  payload: unknown;

  constructor(message: string, status: number, payload: unknown, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
    this.code = code;
  }
}

interface APIEnvelope<T> {
  success?: boolean;
  data?: T;
  error?: string | {
    code?: unknown;
    type?: unknown;
    message?: unknown;
  };
  message?: string;
  detail?: string;
  reason?: unknown;
  code?: unknown;
  error_code?: unknown;
}

const API_PREFIX = "/api/v1";

function buildURL(path: string) {
  if (/^https?:\/\//.test(path)) return path;
  return `${API_PREFIX}${path.startsWith("/") ? path : `/${path}`}`;
}

function currentRedirectTarget() {
  return `${window.location.pathname}${window.location.search}`;
}

function isAuthRoute() {
  return window.location.pathname === "/login" || window.location.pathname === "/register";
}

function getStoredAccessToken() {
  try {
    return window.localStorage.getItem("auth_token");
  } catch {
    return null;
  }
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function semanticErrorCode(payload?: APIEnvelope<unknown>): string | undefined {
  if (!payload) return undefined;

  return nonEmptyString(payload.reason)
    ?? nonEmptyString(payload.code)
    ?? nonEmptyString(payload.error_code)
    ?? (typeof payload.error === "object" && payload.error !== null
      ? nonEmptyString(payload.error.code) ?? nonEmptyString(payload.error.type)
      : undefined)
    ?? nonEmptyString(payload.error);
}

function apiErrorMessage(payload: APIEnvelope<unknown> | undefined, status: number): string {
  return nonEmptyString(payload?.message)
    ?? nonEmptyString(payload?.detail)
    ?? nonEmptyString(payload?.error)
    ?? (typeof payload?.error === "object" && payload.error !== null
      ? nonEmptyString(payload.error.message)
      : undefined)
    ?? `Request failed with status ${status}`;
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.headers instanceof Headers) {
    options.headers.forEach((value, key) => {
      headers[key] = value;
    });
  } else if (Array.isArray(options.headers)) {
    for (const [key, value] of options.headers) {
      headers[key] = value;
    }
  } else if (options.headers) {
    Object.assign(headers, options.headers);
  }

  const token = getStoredAccessToken();
  if (token && !headers.Authorization) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(buildURL(path), {
    credentials: "include",
    ...options,
    headers,
  });

  let payload: APIEnvelope<T> | undefined;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }

  if (response.status === 401) {
    clearAuthStorage();
    if (!isAuthRoute()) {
      window.location.href = `/login?redirect=${encodeURIComponent(currentRedirectTarget())}`;
    }
  }

  if (!response.ok || payload?.success === false) {
    throw new ApiError(
      apiErrorMessage(payload, response.status),
      response.status,
      payload,
      semanticErrorCode(payload),
    );
  }

  return (payload && "data" in payload ? payload.data : payload) as T;
}

export function getJSON<T>(path: string, options: RequestInit = {}) {
  return apiRequest<T>(path, { ...options, method: options.method || "GET" });
}

export function postJSON<T>(path: string, body?: unknown, options: RequestInit = {}) {
  return apiRequest<T>(path, {
    ...options,
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function putJSON<T>(path: string, body?: unknown, options: RequestInit = {}) {
  return apiRequest<T>(path, {
    ...options,
    method: "PUT",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function deleteJSON<T>(path: string, options: RequestInit = {}) {
  return apiRequest<T>(path, { ...options, method: "DELETE" });
}
