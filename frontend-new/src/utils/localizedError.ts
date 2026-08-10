import type { TFunction } from "i18next";
import { ApiError } from "../api/client";
import i18n from "../i18n";
import en, { type ErrorFallbackKey, type ErrorTranslationKey } from "../i18n/resources/en";

export type ErrorScope = keyof typeof en.errors.scoped;

export interface LocalizedErrorOptions {
  scope?: ErrorScope;
  t?: TFunction;
}

type GlobalErrorCode = ErrorFallbackKey;

const SCOPED_ERROR_KEYS: Partial<Record<`${ErrorScope}:${string}`, ErrorTranslationKey>> = {
  "auth:INVALID_USER": "scoped.auth.INVALID_USER",
  "affiliate:INVALID_USER": "scoped.affiliate.INVALID_USER",
  "payment:DAILY_LIMIT_EXCEEDED": "scoped.payment.DAILY_LIMIT_EXCEEDED",
  "payment:INVALID_AMOUNT": "scoped.payment.INVALID_AMOUNT",
  "payment:INVALID_STATUS": "scoped.payment.INVALID_STATUS",
  "payment:NOT_FOUND": "scoped.payment.NOT_FOUND",
  "subscription:DAILY_LIMIT_EXCEEDED": "scoped.subscription.DAILY_LIMIT_EXCEEDED",
};
const ERROR_RESOURCES: Readonly<Record<string, unknown>> = en.errors;

function isGlobalErrorCode(code: string): code is GlobalErrorCode {
  return Object.prototype.hasOwnProperty.call(ERROR_RESOURCES, code)
    && typeof ERROR_RESOURCES[code] === "string";
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
      ? SCOPED_ERROR_KEYS[`${options.scope}:${error.code}`]
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
