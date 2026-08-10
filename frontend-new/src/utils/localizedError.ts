import type { TFunction } from "i18next";
import { ApiError } from "../api/client";
import i18n from "../i18n";
import en from "../i18n/resources/en";

function translateQualifiedKey(t: TFunction, key: string): string {
  const separator = key.indexOf(".");
  const qualifiedKey = separator > 0
    ? `${key.slice(0, separator)}:${key.slice(separator + 1)}`
    : key;
  return t(qualifiedKey as never);
}

export function localizedErrorMessage(
  error: unknown,
  fallbackKey: string,
  t: TFunction = i18n.t,
): string {
  if (
    error instanceof ApiError
    && error.code
    && Object.prototype.hasOwnProperty.call(en.errors, error.code)
  ) {
    return t(error.code as keyof typeof en.errors, { ns: "errors" });
  }

  if (error instanceof ApiError && error.messageSource === "synthetic") {
    return translateQualifiedKey(t, fallbackKey);
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return translateQualifiedKey(t, fallbackKey);
}
