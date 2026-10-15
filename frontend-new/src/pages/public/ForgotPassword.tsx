import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { forgotPassword } from "../../api/auth";
import { getPublicSettings, type PublicSettings } from "../../api/settings";
import CaptchaChallenge from "../../components/auth/CaptchaChallenge";
import { captchaProofPayload, resolveCaptchaProvider, type CaptchaProof } from "../../components/auth/captcha";
import StandaloneLanguageSwitcher from "../../components/StandaloneLanguageSwitcher";
import { usePageTitle } from "../../hooks/usePageTitle";
import { errorMessage, resolveLocalizedMessage, translationMessage, type LocalizedMessage } from "../../utils/localizedMessage";

export default function ForgotPassword() {
  const { t } = useTranslation("auth");
  usePageTitle(t("pageTitles.forgotPassword"));
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<LocalizedMessage | null>(null);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [captchaProof, setCaptchaProof] = useState<CaptchaProof | null>(null);

  useEffect(() => {
    let active = true;
    getPublicSettings()
      .then((data) => {
        if (active) setSettings(data);
      })
      .catch(() => {
        if (active) setSettings({});
      });
    return () => {
      active = false;
    };
  }, []);

  let captchaProvider: ReturnType<typeof resolveCaptchaProvider> = null;
  let captchaMisconfigured = false;
  try {
    captchaProvider = resolveCaptchaProvider(settings);
  } catch {
    captchaMisconfigured = true;
  }
  const turnstileRequired = captchaProvider?.provider === "turnstile";

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    if (captchaMisconfigured) {
      setError(translationMessage("auth:captcha.misconfiguredSupport"));
      return;
    }
    if (turnstileRequired && !captchaProof) {
      setError(translationMessage("auth:captchaRequiredError"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await forgotPassword({ email: email.trim(), ...captchaProofPayload(captchaProof) });
      setSent(true);
    } catch (reason) {
      setError(errorMessage(reason, "authForgotPasswordFailed", "auth"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-zinc-50 px-6 py-12">
      <StandaloneLanguageSwitcher />
      <section className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-zinc-950">{t("forgotPassword.title")}</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-500">{t("forgotPassword.description")}</p>

        {sent ? (
          <div className="mt-6 space-y-4">
            <p role="status" className="rounded-lg bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
              {t("forgotPassword.sent")}
            </p>
            <Link
              className="flex h-11 items-center justify-center rounded-md bg-zinc-950 px-5 text-sm font-semibold text-white"
              to="/login"
            >
              {t("forgotPassword.backToSignIn")}
            </Link>
          </div>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <label className="block text-sm font-medium text-zinc-700">
              {t("email")}
              <input
                autoComplete="email"
                className="mt-2 h-11 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-950"
                onChange={(event) => setEmail(event.target.value)}
                required
                type="email"
                value={email}
              />
            </label>
            <CaptchaChallenge
              settings={settings}
              onVerify={(proof) => {
                setCaptchaProof(proof);
                setError(null);
              }}
              onExpire={() => setCaptchaProof(null)}
              onInvalidate={() => setCaptchaProof(null)}
              onError={() => setCaptchaProof(null)}
            />
            {error ? <p role="alert" className="text-sm text-red-600">{resolveLocalizedMessage(error)}</p> : null}
            <button
              className="h-11 w-full rounded-md bg-zinc-950 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
              disabled={submitting || !email.trim()}
              type="submit"
            >
              {submitting ? t("forgotPassword.sending") : t("forgotPassword.submit")}
            </button>
            <Link
              className="flex h-11 items-center justify-center rounded-md border border-zinc-200 text-sm font-semibold text-zinc-500 transition hover:bg-zinc-50"
              to="/login"
            >
              {t("forgotPassword.backToSignIn")}
            </Link>
          </form>
        )}
      </section>
    </main>
  );
}
