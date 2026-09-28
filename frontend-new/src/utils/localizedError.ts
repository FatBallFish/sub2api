import type { TFunction } from "i18next";
import { ApiError } from "../api/client";
import i18n from "../i18n";
import en, { type ErrorFallbackKey, type ErrorTranslationKey } from "../i18n/resources/en";

export type ErrorScope = keyof typeof en.errors.scoped;

export interface LocalizedErrorOptions {
  scope?: ErrorScope;
  t?: TFunction;
}

export const GLOBAL_ERROR_CODES = [
  "INVALID_CREDENTIALS",
  "USER_NOT_ACTIVE",
  "USER_INACTIVE",
  "EMAIL_EXISTS",
  "EMAIL_RESERVED",
  "INVALID_EMAIL",
  "PASSWORD_TOO_SHORT",
  "PASSWORD_REQUIRED",
  "EMAIL_VERIFY_REQUIRED",
  "EMAIL_SUFFIX_NOT_ALLOWED",
  "EMAIL_DOMAIN_REGISTRATION_LIMIT",
  "REGISTRATION_DISABLED",
  "INVITATION_CODE_REQUIRED",
  "INVITATION_CODE_INVALID",
  "OAUTH_INVITATION_REQUIRED",
  "CAPTCHA_PROVIDER_CONFLICT",
  "BACKEND_MODE_ADMIN_ONLY",
  "SERVICE_UNAVAILABLE",
  "INVALID_TOKEN",
  "TOKEN_EXPIRED",
  "ACCESS_TOKEN_EXPIRED",
  "TOKEN_REVOKED",
  "REFRESH_TOKEN_INVALID",
  "REFRESH_TOKEN_EXPIRED",
  "REFRESH_TOKEN_REUSED",
  "SESSION_BINDING_MISMATCH",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "PAYMENT_DISABLED",
  "BALANCE_PAYMENT_DISABLED",
  "PLAN_NOT_AVAILABLE",
  "PLAN_NOT_AVAILABLE_FOR_GROUPS",
  "ORDER_TYPE_MISMATCH",
  "GROUP_NOT_FOUND",
  "GROUP_TYPE_MISMATCH",
  "TOO_MANY_PENDING",
  "PAYMENT_GATEWAY_ERROR",
  "NO_AVAILABLE_INSTANCE",
  "PAYMENT_PROVIDER_MISCONFIGURED",
  "CANCEL_RATE_LIMITED",
  "GLOBAL_PLAN_USE_UPGRADE_FLOW",
  "API_KEY_NOT_FOUND",
  "GROUP_NOT_ALLOWED",
  "API_KEY_EXISTS",
  "API_KEY_TOO_SHORT",
  "API_KEY_INVALID_CHARS",
  "API_KEY_RATE_LIMITED",
  "API_KEY_AUTH_OVERLOADED",
  "INVALID_IP_PATTERN",
  "API_KEY_REQUIRED",
  "API_KEY_DISABLED",
  "API_KEY_INACTIVE",
  "API_KEY_EXPIRED",
  "API_KEY_QUOTA_EXHAUSTED",
  "API_KEY_RATE_5H_EXCEEDED",
  "API_KEY_RATE_1D_EXCEEDED",
  "API_KEY_RATE_7D_EXCEEDED",
  "INSUFFICIENT_BALANCE",
  "RATE_LIMITED",
  "USER_NOT_FOUND",
  "AUTH_REQUIRED",
  "PASSWORD_INCORRECT",
  "INSUFFICIENT_PERMISSIONS",
  "INVALID_API_KEY",
  "INVALID_AUTH_RATE_LIMITED",
  "INVALID_AUTH_HEADER",
  "EMPTY_TOKEN",
  "ACCESS_DENIED",
  "SUBSCRIPTION_NOT_FOUND",
  "NOTIFY_CODE_USER_RATE_LIMIT",
] as const satisfies readonly ErrorFallbackKey[];
type GlobalErrorCode = (typeof GLOBAL_ERROR_CODES)[number];

export const SCOPED_ERROR_KEYS = {
  "auth:INVALID_USER": "scoped.auth.INVALID_USER",
  "affiliate:INVALID_USER": "scoped.affiliate.INVALID_USER",
  "payment:DAILY_LIMIT_EXCEEDED": "scoped.payment.DAILY_LIMIT_EXCEEDED",
  "payment:INVALID_AMOUNT": "scoped.payment.INVALID_AMOUNT",
  "payment:INVALID_STATUS": "scoped.payment.INVALID_STATUS",
  "payment:NOT_FOUND": "scoped.payment.NOT_FOUND",
  "subscription:DAILY_LIMIT_EXCEEDED": "scoped.subscription.DAILY_LIMIT_EXCEEDED",
} as const satisfies Partial<Record<`${ErrorScope}:${string}`, ErrorTranslationKey>>;
const GLOBAL_ERROR_CODE_SET: ReadonlySet<string> = new Set(GLOBAL_ERROR_CODES);

function isGlobalErrorCode(code: string): code is GlobalErrorCode {
  return GLOBAL_ERROR_CODE_SET.has(code);
}

export function localizedErrorMessage(
  error: unknown,
  fallbackKey: ErrorFallbackKey,
  translatorOrOptions: TFunction | LocalizedErrorOptions = i18n.t,
): string {
  const options = typeof translatorOrOptions === "function"
    ? { t: translatorOrOptions }
    : translatorOrOptions;
  const t = options.t ?? i18n.t;

  if (error instanceof ApiError && error.code) {
    const scopedKey = options.scope
      ? (SCOPED_ERROR_KEYS as Partial<Record<`${ErrorScope}:${string}`, ErrorTranslationKey>>)[`${options.scope}:${error.code}`]
      : undefined;
    if (scopedKey) return t(scopedKey, { ns: "errors" });
    if (isGlobalErrorCode(error.code)) return t(error.code, { ns: "errors" });
  }

  if (error instanceof ApiError && error.messageSource === "synthetic") {
    return t(fallbackKey, { ns: "errors" });
  }

  if (error instanceof ApiError && error.messageSource === "response" && error.message.trim()) {
    return error.message;
  }

  return t(fallbackKey, { ns: "errors" });
}
