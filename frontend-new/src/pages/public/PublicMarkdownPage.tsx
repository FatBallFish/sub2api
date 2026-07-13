import React, { useEffect, useMemo, useState } from "react";
import { getPublicSettings, type LoginAgreementDocument } from "../../api/settings";
import { MarkdownContent } from "../../utils/markdown";

interface PublicMarkdownPageProps {
  slug: string;
  fallbackTitle: string;
  children: React.ReactNode;
}

function findDocument(documents: LoginAgreementDocument[], slug: string) {
  const normalized = slug.toLowerCase();
  return documents.find((doc) => {
    const id = doc.id.toLowerCase();
    const title = doc.title.toLowerCase();
    return id === normalized || id.includes(normalized) || title.includes(normalized);
  });
}

export default function PublicMarkdownPage({ slug, fallbackTitle, children }: PublicMarkdownPageProps) {
  const [document, setDocument] = useState<LoginAgreementDocument | null>(null);
  const [updatedAt, setUpdatedAt] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    getPublicSettings()
      .then((settings) => {
        if (!active) return;
        setDocument(findDocument(settings.login_agreement_documents || [], slug) || null);
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
  }, [slug]);

  const hasMarkdown = Boolean(document?.content_md?.trim());
  const title = document?.title || fallbackTitle;
  const formattedUpdatedAt = useMemo(() => {
    if (!updatedAt) return "";
    const date = new Date(updatedAt);
    if (Number.isNaN(date.getTime())) return updatedAt;
    return new Intl.DateTimeFormat("en-US", { month: "long", day: "2-digit", year: "numeric" }).format(date);
  }, [updatedAt]);

  if (!loaded || !hasMarkdown) {
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
