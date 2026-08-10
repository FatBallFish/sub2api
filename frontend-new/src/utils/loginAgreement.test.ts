import { describe, expect, it } from "vitest";
import { createI18nInstance, type SupportedLocale } from "../i18n";
import type { LoginAgreementDocument } from "../api/settings";
import { localizedAgreementTitle } from "./loginAgreement";

const builtInDocuments: LoginAgreementDocument[] = [
  { id: "terms", title: "后台服务条款", content_md: "terms body" },
  { id: "usage-policy", title: "后台使用政策", content_md: "policy body" },
  { id: "supported-regions", title: "后台支持地区", content_md: "regions body" },
  { id: "service-specific-terms", title: "后台特定条款", content_md: "specific body" },
];

const expectedTitles: Record<SupportedLocale, string[]> = {
  en: ["Terms of Service", "Usage Policy", "Supported Countries and Regions", "Service-Specific Terms"],
  "zh-CN": ["服务条款", "使用政策", "支持的国家和地区", "服务特定条款"],
  "zh-TW": ["服務條款", "使用政策", "支援的國家和地區", "服務特定條款"],
  ja: ["利用規約", "利用ポリシー", "対応している国と地域", "サービス固有の規約"],
};

describe("localizedAgreementTitle", () => {
  it.each(Object.entries(expectedTitles) as [SupportedLocale, string[]][])(
    "localizes all built-in agreement IDs in %s",
    async (locale, expected) => {
      const { t } = await createI18nInstance({ initialLocale: locale, storage: null, documentElement: null });

      expect(builtInDocuments.map((document) => localizedAgreementTitle(document, t))).toEqual(expected);
    },
  );

  it("preserves backend-configured titles for custom and near-match IDs", async () => {
    const { t } = await createI18nInstance({ initialLocale: "ja", storage: null, documentElement: null });
    const documents: LoginAgreementDocument[] = [
      { id: "privacy", title: "Custom Privacy Notice", content_md: "privacy body" },
      { id: "TERMS", title: "Case-sensitive custom title", content_md: "custom body" },
      { id: "partner-terms", title: "Partner Contract", content_md: "partner body" },
    ];

    expect(documents.map((document) => localizedAgreementTitle(document, t))).toEqual([
      "Custom Privacy Notice",
      "Case-sensitive custom title",
      "Partner Contract",
    ]);
  });
});
