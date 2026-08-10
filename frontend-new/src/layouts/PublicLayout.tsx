import React from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getPublicSettings, type LoginAgreementDocument } from "../api/settings";
import { getStoredUser, isAuthenticated } from "../utils/authStorage";
import { agreementDocuments, findAgreementDocument, localizedAgreementTitle } from "../utils/loginAgreement";
import LanguageSwitcher from "../components/LanguageSwitcher";

export default function PublicLayout() {
  const { t } = useTranslation();
  const location = useLocation();
  const user = getStoredUser();
  const signedIn = isAuthenticated();
  const [legalDocuments, setLegalDocuments] = React.useState<LoginAgreementDocument[]>([]);

  React.useEffect(() => {
    let active = true;
    getPublicSettings()
      .then((settings) => {
        if (!active) return;
        setLegalDocuments(settings.login_agreement_enabled === true ? agreementDocuments(settings) : []);
      })
      .catch(() => {
        if (active) setLegalDocuments([]);
      });
    return () => {
      active = false;
    };
  }, []);

  const privacyDocument = findAgreementDocument(legalDocuments, "privacy");
  const termsDocument = findAgreementDocument(legalDocuments, "terms");

  return (
    <div className="min-h-screen flex flex-col bg-white text-zinc-900 selection:bg-zinc-900 selection:text-white">
      {/* Unified Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex h-16 items-center justify-between px-4 sm:px-8 bg-white/80 backdrop-blur-xl border-b border-zinc-100">
        <div className="flex items-center gap-8">
          <Link to="/" className="text-xl font-bold tracking-tighter text-zinc-900">Mikiko CC</Link>
          <div className="hidden md:flex items-center gap-6">
            <Link
              to="/pricing"
              className={`text-sm font-medium transition-colors ${location.pathname === '/pricing' ? 'text-zinc-900 underline underline-offset-4' : 'text-zinc-500 hover:text-zinc-900'}`}
            >
              Pricing
            </Link>
            <Link
              to="/model-pricing"
              className={`text-sm font-medium transition-colors ${location.pathname === '/model-pricing' ? 'text-zinc-900 underline underline-offset-4' : 'text-zinc-500 hover:text-zinc-900'}`}
            >
              Model Pricing
            </Link>
            <Link
              to="/blog"
              className={`text-sm font-medium transition-colors ${location.pathname.startsWith('/blog') ? 'text-zinc-900 underline underline-offset-4' : 'text-zinc-500 hover:text-zinc-900'}`}
            >
              Blog
            </Link>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          <LanguageSwitcher />
          {signedIn && user ? (
            <Link to="/console" className="hidden sm:flex items-center gap-2 text-sm font-medium text-zinc-600 hover:text-zinc-900 transition-colors">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-100 text-xs font-bold text-zinc-700">
                {(user.email || "U").slice(0, 1).toUpperCase()}
              </span>
              <span className="hidden sm:inline">{user.email}</span>
            </Link>
          ) : (
            <Link to="/login" className="hidden sm:inline text-sm font-medium text-zinc-500 hover:text-zinc-900 transition-colors">Sign in</Link>
          )}
          <Link to="/console" className="bg-zinc-900 text-white px-3 sm:px-4 py-2 rounded-full text-sm font-medium hover:bg-zinc-800 transition-all shadow-lg shadow-zinc-200">
            Open Console
          </Link>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1">
        <Outlet />
      </main>

      {/* Unified Footer */}
      <footer className="py-20 border-t border-zinc-100 px-8">
        <div className="max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-12">
          <div className="col-span-2 space-y-6">
            <Link to="/" className="text-xl font-bold tracking-tighter text-zinc-900">Mikiko CC</Link>
            <p className="text-sm text-zinc-400 max-w-xs leading-relaxed">
              Professional AI infrastructure for the next generation of developers.
              Reliable, transparent, and built for scale.
            </p>
            <span className="block text-[10px] text-zinc-300 font-bold uppercase tracking-widest">
              Owned and operated by Mikiko CC
            </span>
          </div>
          <div className="space-y-4">
            <h4 className="text-xs font-bold uppercase tracking-widest text-zinc-900">Product</h4>
            <nav className="flex flex-col gap-2">
              <Link to="/pricing" className="text-sm text-zinc-500 hover:text-zinc-900 transition-colors">Pricing</Link>
              <Link to="/model-pricing" className="text-sm text-zinc-500 hover:text-zinc-900 transition-colors">Model Pricing</Link>
              <Link to="/console" className="text-sm text-zinc-500 hover:text-zinc-900 transition-colors">Console</Link>
            </nav>
          </div>
          <div className="space-y-4">
            <h4 className="text-xs font-bold uppercase tracking-widest text-zinc-900">Company</h4>
            <nav className="flex flex-col gap-2">
              <Link to="/team" className="text-sm text-zinc-500 hover:text-zinc-900 transition-colors">Team</Link>
              <Link to="/blog" className="text-sm text-zinc-500 hover:text-zinc-900 transition-colors">Blog</Link>
              {privacyDocument?.content_md?.trim() ? (
                <Link to="/privacy" className="text-sm text-zinc-500 hover:text-zinc-900 transition-colors">{localizedAgreementTitle(privacyDocument, t)}</Link>
              ) : null}
              {termsDocument?.content_md?.trim() ? (
                <Link to="/terms" className="text-sm text-zinc-500 hover:text-zinc-900 transition-colors">{localizedAgreementTitle(termsDocument, t)}</Link>
              ) : null}
            </nav>
          </div>
        </div>
      </footer>
    </div>
  );
}
