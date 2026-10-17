import type { TFunction } from "i18next";
import { ApiError } from "../api/client";
import i18n from "../i18n";
import en, { type ErrorFallbackKey, type ErrorTranslationKey } from "../i18n/resources/en";

export type ErrorScope = keyof typeof en.errors.scoped;

/** validation 命名空间（errors.validation.*）的叶子键。 */
export type ValidationMessageKey = string;

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
  "auth:PASSWORD_LOGIN_DISABLED": "scoped.auth.PASSWORD_LOGIN_DISABLED",
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

/** Binding-validation field labels covered by errors.validationFields.* (finite contract for the i18n scanner). */
export const VALIDATION_FIELD_KEYS = [
  "email", "password", "username", "notes", "role", "status", "balance", "concurrency",
  "page", "page_size", "id", "user_id", "user_ids", "group_id", "group_ids", "account_id",
  "api_key", "name", "title", "content", "amount", "model", "platform", "type", "code",
  "plan_id", "order_id", "rate_limits", "expires_in_days", "quota",
] as const;

/** Binding-validation rule labels covered by errors.validationTags.* (finite contract for the i18n scanner). */
export const VALIDATION_TAG_KEYS = [
  "required", "email", "min", "max", "minlength", "maxlength", "oneof", "uuid", "url", "uri",
  "datetime", "number", "boolean", "gt", "gte", "lt", "lte", "group_platform", "concrete_platform",
] as const;

interface APIEnvelopeLike {
  metadata?: Record<string, unknown>;
}

/**
 * Compose the localized message for binding/validation failures
 * (reason=VALIDATION_FAILED). The backend metadata carries the offending
 * field (JSON name) and the validator tag; both map to label tables under
 * the errors namespace. Malformed bodies without a field fall back to the
 * generic invalid-body phrasing.
 */
function localizedValidationMessage(payload: unknown, t: TFunction): string | null {
  const metadata = (payload as APIEnvelopeLike | undefined)?.metadata;
  const tag = typeof metadata?.tag === "string" ? metadata.tag : "";
  const field = typeof metadata?.field === "string" ? metadata.field : "";
  if (!field) {
    if (tag === "json" || tag === "json_type" || tag === "invalid") {
      return t("invalidBody", { ns: "validation" });
    }
    return null;
  }
  const fieldLabel = t(`fields.${field}` as ValidationMessageKey, { ns: "validation", defaultValue: field });
  const tagLabel = t(`tags.${tag}` as ValidationMessageKey, { ns: "validation", defaultValue: "" });
  if (!tagLabel) {
    return t("fieldOnly", { ns: "validation", field: fieldLabel });
  }
  return t("failed", { ns: "validation", field: fieldLabel, rule: tagLabel });
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

  if (error instanceof ApiError && error.code === "VALIDATION_FAILED") {
    const localized = localizedValidationMessage(error.payload, t);
    if (localized) return localized;
  }

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
