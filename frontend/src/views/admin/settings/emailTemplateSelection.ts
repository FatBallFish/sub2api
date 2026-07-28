const EMAIL_TEMPLATE_LOCALE_STORAGE_KEY = "admin.emailTemplate.selectedLocale";

function normalizeLocale(value: string): string {
  return value.trim().toLowerCase();
}

export function resolveInitialEmailTemplateLocale(
  locales: string[],
  uiLocale: string,
  savedLocale?: string | null,
): string {
  const normalizedSavedLocale = normalizeLocale(savedLocale || "");
  if (normalizedSavedLocale) {
    const savedMatch = locales.find(
      (availableLocale) => normalizeLocale(availableLocale) === normalizedSavedLocale,
    );
    if (savedMatch) return savedMatch;
  }

  const currentLocale = normalizeLocale(uiLocale);
  const exactMatch = locales.find(
    (availableLocale) => normalizeLocale(availableLocale) === currentLocale,
  );
  if (exactMatch) return exactMatch;

  const currentLanguage = currentLocale.split("-")[0];
  const languageMatch = locales.find(
    (availableLocale) => normalizeLocale(availableLocale).split("-")[0] === currentLanguage,
  );
  if (languageMatch) return languageMatch;

  return locales[0] || "";
}

export function readSavedEmailTemplateLocale(storage: Storage = window.localStorage): string {
  try {
    return storage.getItem(EMAIL_TEMPLATE_LOCALE_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export function saveEmailTemplateLocale(
  locale: string,
  storage: Storage = window.localStorage,
): void {
  const normalized = locale.trim();
  if (!normalized) return;
  try {
    storage.setItem(EMAIL_TEMPLATE_LOCALE_STORAGE_KEY, normalized);
  } catch {
    // Ignore storage failures; the editor can still operate without persistence.
  }
}
