import type { AuthUser } from "../api/auth";

const AUTH_KEYS = ["auth_token", "refresh_token", "token_expires_at", "auth_user"];

export function getStoredAccessToken() {
  try {
    return localStorage.getItem("auth_token");
  } catch {
    return null;
  }
}

export function getStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem("auth_user");
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

function isStoredTokenExpired() {
  try {
    const raw = localStorage.getItem("token_expires_at");
    if (!raw) return false;
    const expiresAt = Number(raw);
    return Number.isFinite(expiresAt) && expiresAt <= Date.now();
  } catch {
    return false;
  }
}

export function isAuthenticated() {
  if (isStoredTokenExpired()) {
    clearAuthStorage();
    return false;
  }
  return Boolean(getStoredAccessToken() && getStoredUser());
}

export function clearAuthStorage() {
  for (const key of AUTH_KEYS) {
    localStorage.removeItem(key);
  }
}
