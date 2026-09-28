import React from "react";
import { useTranslation } from "react-i18next";
import PublicMarkdownPage from "../PublicMarkdownPage";

export default function Terms() {
  const { t } = useTranslation("public");
  return <PublicMarkdownPage slug="terms" fallbackTitle={t("legal.termsFallback")} requireAgreementEnabled />;
}
