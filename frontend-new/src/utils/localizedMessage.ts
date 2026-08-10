import i18n from "../i18n";
import type { TranslationKey, ErrorFallbackKey } from "../i18n/resources/en";
import { localizedErrorMessage, type ErrorScope } from "./localizedError";

export type LocalizedMessage =
  | { kind: "translation"; key: TranslationKey }
  | { kind: "error"; error: unknown; fallbackKey: ErrorFallbackKey; scope?: ErrorScope }
  | { kind: "raw"; value: string };

export function translationMessage(key: TranslationKey): LocalizedMessage {
  return { kind: "translation", key };
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
  if (message.kind === "translation") return i18n.t(message.key);
  if (message.kind === "error") {
    return localizedErrorMessage(message.error, message.fallbackKey, { scope: message.scope });
  }
  return message.value;
}
