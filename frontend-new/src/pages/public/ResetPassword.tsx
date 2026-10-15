import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { resetPassword } from "../../api/auth";
import StandaloneLanguageSwitcher from "../../components/StandaloneLanguageSwitcher";
import { usePageTitle } from "../../hooks/usePageTitle";
import { errorMessage, resolveLocalizedMessage, type LocalizedMessage } from "../../utils/localizedMessage";

export default function ResetPassword() {
  const { t } = useTranslation("auth");
  usePageTitle(t("pageTitles.resetPassword"));
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token")?.trim() || "";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<LocalizedMessage | null>(null);

  const canSubmit = token !== "" && email.trim() !== "" && password.length >= 6 && password === confirmPassword;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting || !canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await resetPassword({ email: email.trim(), token, new_password: password });
      setDone(true);
    } catch (reason) {
      setError(errorMessage(reason, "authResetPasswordFailed", "auth"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-zinc-50 px-6 py-12">
      <StandaloneLanguageSwitcher />
      <section className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-zinc-950">{t("resetPassword.title")}</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-500">{t("resetPassword.description")}</p>

        {done ? (
          <div className="mt-6 space-y-4">
            <p role="status" className="rounded-lg bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
              {t("resetPassword.done")}
            </p>
            <button
              type="button"
              onClick={() => navigate("/login", { replace: true })}
              className="h-11 w-full rounded-md bg-zinc-950 text-sm font-semibold text-white"
            >
              {t("resetPassword.backToSignIn")}
            </button>
          </div>
        ) : !token ? (
          <div className="mt-6 space-y-4">
            <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {t("resetPassword.missingToken")}
            </p>
            <Link
              className="flex h-11 items-center justify-center rounded-md bg-zinc-950 px-5 text-sm font-semibold text-white"
              to="/forgot-password"
            >
              {t("forgotPassword.title")}
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
            <label className="block text-sm font-medium text-zinc-700">
              {t("newPassword")}
              <input
                autoComplete="new-password"
                className="mt-2 h-11 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-950"
                minLength={6}
                onChange={(event) => setPassword(event.target.value)}
                required
                type="password"
                value={password}
              />
            </label>
            <label className="block text-sm font-medium text-zinc-700">
              {t("confirmPassword")}
              <input
                autoComplete="new-password"
                className="mt-2 h-11 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-950"
                minLength={6}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
                type="password"
                value={confirmPassword}
              />
            </label>
            {error ? <p role="alert" className="text-sm text-red-600">{resolveLocalizedMessage(error)}</p> : null}
            <button
              className="h-11 w-full rounded-md bg-zinc-950 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
              disabled={submitting || !canSubmit}
              type="submit"
            >
              {submitting ? t("resetPassword.submitting") : t("resetPassword.submit")}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
