import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate } from "react-router-dom";
import { getPublicSettings, type LoginAgreementDocument } from "../../api/settings";
import { MarkdownContent } from "../../utils/markdown";
import { findAgreementDocument, localizedAgreementTitle } from "../../utils/loginAgreement";

interface PublicMarkdownPageProps {
  slug: string;
  fallbackTitle: string;
  children?: React.ReactNode;
  requireAgreementEnabled?: boolean;
  exactDocumentId?: boolean;
}

function findDocument(documents: LoginAgreementDocument[], slug: string) {
  if (slug === "privacy" || slug === "terms") {
    return findAgreementDocument(documents, slug);
  }
  const normalized = slug.toLowerCase();
  return documents.find((doc) => {
    const id = doc.id.toLowerCase();
    const title = doc.title.toLowerCase();
    return id === normalized || id.includes(normalized) || title.includes(normalized);
  });
}

export default function PublicMarkdownPage({ slug, fallbackTitle, children, requireAgreementEnabled = false, exactDocumentId = false }: PublicMarkdownPageProps) {
  const { t } = useTranslation();
  const [document, setDocument] = useState<LoginAgreementDocument | null>(null);
  const [updatedAt, setUpdatedAt] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [agreementEnabled, setAgreementEnabled] = useState(false);

  useEffect(() => {
    let active = true;
    getPublicSettings()
      .then((settings) => {
        if (!active) return;
        setAgreementEnabled(settings.login_agreement_enabled === true);
        const documents = settings.login_agreement_documents || [];
        const matched = exactDocumentId
          ? documents.find((item) => item.id === slug || item.title === slug)
          : findDocument(documents, slug);
        setDocument(matched || null);
        setUpdatedAt(settings.login_agreement_updated_at || "");
      })
      .catch(() => {
        if (active) setDocument(null);
      })
      .finally(() => {
        if (active) setLoaded(true);
      });

    return () => {
      active = false;
    };
  }, [exactDocumentId, slug]);

  const hasMarkdown = Boolean(document?.content_md?.trim());
  const title = document ? localizedAgreementTitle(document, t) : fallbackTitle;
  const formattedUpdatedAt = useMemo(() => {
    if (!updatedAt) return "";
    const date = new Date(updatedAt);
    if (Number.isNaN(date.getTime())) return updatedAt;
    return new Intl.DateTimeFormat("en-US", { month: "long", day: "2-digit", year: "numeric" }).format(date);
  }, [updatedAt]);

  if (!loaded) {
    return null;
  }

  if (requireAgreementEnabled && (!agreementEnabled || !hasMarkdown)) {
    return <Navigate to="/" replace />;
  }

  if (!hasMarkdown) {
    return <>{children}</>;
  }

  return (
    <div className="pt-32 pb-24 px-8 max-w-4xl mx-auto space-y-8">
      <h1 className="text-4xl font-bold tracking-tight text-zinc-900">{title}</h1>
      {formattedUpdatedAt ? (
        <p className="text-xs text-zinc-400 font-bold uppercase tracking-widest">Last Updated: {formattedUpdatedAt}</p>
      ) : null}
      <MarkdownContent content={document?.content_md || ""} className="text-zinc-500 leading-relaxed" />
    </div>
  );
}
