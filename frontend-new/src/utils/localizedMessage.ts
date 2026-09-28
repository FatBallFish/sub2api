import i18n from "../i18n";
import type { TranslationKey, ErrorFallbackKey } from "../i18n/resources/en";
import { localizedErrorMessage, type ErrorScope } from "./localizedError";

export type LocalizedMessage =
  | { kind: "translation"; key: TranslationKey; values?: Record<string, string | number> }
  | { kind: "error"; error: unknown; fallbackKey: ErrorFallbackKey; scope?: ErrorScope }
  | { kind: "raw"; value: string };

export function translationMessage(
  key: TranslationKey,
  values?: Record<string, string | number>,
): LocalizedMessage {
  return { kind: "translation", key, values };
}

export function errorMessage(
  error: unknown,
  fallbackKey: ErrorFallbackKey,
  scope?: ErrorScope,
): LocalizedMessage {
  return { kind: "error", error, fallbackKey, scope };
}

export function rawMessage(value: string): LocalizedMessage {
  return { kind: "raw", value };
}

export function resolveLocalizedMessage(message: LocalizedMessage): string {
  if (message.kind === "translation") {
    const translate = i18n.t as unknown as (
      key: TranslationKey,
      values?: Record<string, string | number>,
    ) => string;
    return translate(message.key, message.values);
  }
  if (message.kind === "error") {
    return localizedErrorMessage(message.error, message.fallbackKey, { scope: message.scope });
  }
  return message.value;
}
