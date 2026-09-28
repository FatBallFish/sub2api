import i18n from "../i18n";

function activeLocale(locale?: string) {
  return locale || i18n.resolvedLanguage || i18n.language || "en";
}

export function formatNumber(value: number, locale?: string, options: Intl.NumberFormatOptions = {}) {
  return new Intl.NumberFormat(activeLocale(locale), options).format(Number.isFinite(value) ? value : 0);
}

export function formatCredits(value: number, locale?: string) {
  return formatNumber(value, locale, {
    minimumFractionDigits: 6,
    maximumFractionDigits: 6,
  });
}

export function formatCurrency(value: number, currency: string, locale?: string) {
  return formatNumber(value, locale, {
    style: "currency",
    currency,
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

export function formatDate(
  value: string | number | Date,
  locale?: string,
  options: Intl.DateTimeFormatOptions = {},
) {
  if (typeof value === "string" && !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) {
    return value;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(activeLocale(locale), {
    year: "numeric",
    month: "long",
    day: "numeric",
    ...options,
  }).format(date);
}
