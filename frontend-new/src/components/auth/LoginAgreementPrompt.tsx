import { Link } from "react-router-dom";
import { ShieldCheck, X } from "@phosphor-icons/react";
import type { LoginAgreementDocument } from "../../api/settings";
import { agreementDocumentPath } from "../../utils/loginAgreement";

interface LoginAgreementPromptProps {
  accepted: boolean;
  documents: LoginAgreementDocument[];
  mode: "modal" | "checkbox";
  open: boolean;
  updatedAt?: string;
  onAccept: () => void;
  onReject: () => void;
  onOpen: () => void;
}

function DocumentLinks({ documents }: { documents: LoginAgreementDocument[] }) {
  return (
    <>
      {documents.map((document, index) => (
        <span key={document.id || document.title}>
          {index > 0 ? ", " : null}
          <Link
            to={agreementDocumentPath(document)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-bold text-zinc-900 underline underline-offset-4"
          >
            {document.title}
          </Link>
        </span>
      ))}
    </>
  );
}

export default function LoginAgreementPrompt(props: LoginAgreementPromptProps) {
  const { accepted, documents, mode, open, updatedAt, onAccept, onReject, onOpen } = props;
  if (documents.length === 0) return null;

  return (
    <>
      {mode === "checkbox" ? (
        <label className="flex items-start gap-3 text-xs leading-5 text-zinc-500">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(event) => event.target.checked ? onAccept() : onReject()}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
          />
          <span>I have read and agree to <DocumentLinks documents={documents} />.</span>
        </label>
      ) : !accepted ? (
        <div className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600">
          <ShieldCheck size={18} className="shrink-0 text-zinc-500" />
          <span className="flex-1">Review and accept the service terms to continue.</span>
          <button type="button" onClick={onOpen} className="font-bold text-zinc-900 underline underline-offset-4">
            Review
          </button>
        </div>
      ) : null}

      {open ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-zinc-950/60 p-4 backdrop-blur-sm">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="login-agreement-title"
            className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            <header className="flex items-start gap-4 border-b border-zinc-100 px-6 py-5">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-700">
                <ShieldCheck size={24} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 id="login-agreement-title" className="text-lg font-bold text-zinc-900">Review service terms</h2>
                <p className="mt-1 text-sm leading-6 text-zinc-500">
                  Please review the current documents before signing in or creating an account.
                  {updatedAt ? ` Updated ${updatedAt}.` : ""}
                </p>
              </div>
              <button type="button" aria-label="Close agreement" onClick={onReject} className="text-zinc-400 hover:text-zinc-900">
                <X size={20} />
              </button>
            </header>
            <div className="grid gap-3 p-6 sm:grid-cols-2">
              {documents.map((document) => (
                <Link
                  key={document.id || document.title}
                  to={agreementDocumentPath(document)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-4 text-sm font-bold text-zinc-900 transition hover:border-zinc-400"
                >
                  {document.title}
                </Link>
              ))}
            </div>
            <footer className="grid grid-cols-2 gap-3 border-t border-zinc-100 bg-zinc-50 px-6 py-4">
              <button type="button" onClick={onReject} className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm font-bold text-zinc-600">
                Decline
              </button>
              <button type="button" onClick={onAccept} className="rounded-xl bg-zinc-900 px-4 py-3 text-sm font-bold text-white">
                Accept and continue
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}
