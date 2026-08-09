import { useParams } from "react-router-dom";
import PublicMarkdownPage from "../PublicMarkdownPage";

export default function LegalDocument() {
  const { documentId = "" } = useParams();
  return (
    <PublicMarkdownPage
      slug={documentId}
      fallbackTitle="Legal Document"
      requireAgreementEnabled
      exactDocumentId
    />
  );
}
