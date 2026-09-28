import React from "react";
import { useTranslation } from "react-i18next";
import PublicMarkdownPage from "../PublicMarkdownPage";

export default function Privacy() {
  const { t } = useTranslation("public");
  return <PublicMarkdownPage slug="privacy" fallbackTitle={t("legal.privacyFallback")} requireAgreementEnabled />;
}
