import type { TFunction } from "i18next";
import type { LoginAgreementDocument, PublicSettings } from "../api/settings";

export const BUILT_IN_AGREEMENT_TITLE_KEYS = {
  terms: "legalDocuments.terms",
  "usage-policy": "legalDocuments.usagePolicy",
  "supported-regions": "legalDocuments.supportedRegions",
  "service-specific-terms": "legalDocuments.serviceSpecificTerms",
} as const;

export const LOGIN_AGREEMENT_STORAGE_KEY = "sub2api_login_agreement_consent";

export function agreementDocuments(settings?: PublicSettings | null) {
  return Array.isArray(settings?.login_agreement_documents)
    ? settings.login_agreement_documents.filter((document) => document.title?.trim())
    : [];
}

export function agreementRevision(settings: PublicSettings, documents: LoginAgreementDocument[]) {
  return settings.login_agreement_revision
    || `${settings.login_agreement_updated_at || ""}:${documents.map((document) => `${document.id}:${document.title}`).join("|")}`;
}

export function hasAcceptedAgreement(revision: string) {
  if (!revision) return false;
  try {
    const stored = JSON.parse(localStorage.getItem(LOGIN_AGREEMENT_STORAGE_KEY) || "{}") as { revision?: string };
    return stored.revision === revision;
  } catch {
    return false;
  }
}

export function storeAgreementConsent(revision: string) {
  if (!revision) return;
  localStorage.setItem(LOGIN_AGREEMENT_STORAGE_KEY, JSON.stringify({
    revision,
    accepted_at: new Date().toISOString(),
  }));
}

export function clearAgreementConsent() {
  localStorage.removeItem(LOGIN_AGREEMENT_STORAGE_KEY);
}

export function findAgreementDocument(documents: LoginAgreementDocument[], slug: "privacy" | "terms") {
  return documents.find((document) => {
    const id = document.id.toLowerCase();
    const title = document.title.toLowerCase();
    if (slug === "privacy") return id.includes("privacy") || title.includes("privacy") || title.includes("隐私");
    return id.includes("terms")
      || id.includes("service")
      || title.includes("terms")
      || title.includes("service")
      || title.includes("条款")
      || title.includes("协议")
      || title.includes("政策");
  });
}

export function agreementDocumentPath(document: LoginAgreementDocument) {
  return `/legal/${encodeURIComponent(document.id || document.title)}`;
}

export function localizedAgreementTitle(document: LoginAgreementDocument, t: TFunction) {
  const key = BUILT_IN_AGREEMENT_TITLE_KEYS[document.id as keyof typeof BUILT_IN_AGREEMENT_TITLE_KEYS];
  return key ? t(key) : document.title;
}
