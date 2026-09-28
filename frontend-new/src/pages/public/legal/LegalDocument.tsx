import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import PublicMarkdownPage from "../PublicMarkdownPage";

export default function LegalDocument() {
  const { t } = useTranslation("public");
  const { documentId = "" } = useParams();
  return (
    <PublicMarkdownPage
      slug={documentId}
      fallbackTitle={t("legal.documentFallback")}
      requireAgreementEnabled
      exactDocumentId
    />
  );
}
