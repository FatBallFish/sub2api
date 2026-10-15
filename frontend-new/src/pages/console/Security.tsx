import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { changePassword } from "../../api/auth";
import { getConsoleBootstrap } from "../../api/console";
import type { ConsoleBootstrap } from "../../types/console";
import { usePageTitle } from "../../hooks/usePageTitle";
import { errorMessage, resolveLocalizedMessage, type LocalizedMessage } from "../../utils/localizedMessage";

export default function Security() {
  const { t } = useTranslation("console");
  usePageTitle(t("security.title"));
  const [bootstrap, setBootstrap] = useState<ConsoleBootstrap | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<LocalizedMessage | null>(null);
  const [done, setDone] = useState(false);

  // OAuth 渠道建号的用户免当前密码（本地密码是随机串）；通过 bootstrap 用户信息推断。
  const oauthSourced = bootstrap?.user?.signup_source !== undefined
    && bootstrap.user.signup_source !== "email"
    && bootstrap.user.signup_source !== "";

  useEffect(() => {
    let active = true;
    getConsoleBootstrap()
      .then((data) => {
        if (active) setBootstrap(data);
      })
      .catch(() => {
        if (active) setBootstrap(null);
      });
    return () => {
      active = false;
    };
  }, []);

  const requiresCurrentPassword = bootstrap === null || !oauthSourced;
  const canSubmit = newPassword.length >= 6
    && newPassword === confirmPassword
    && (!requiresCurrentPassword || currentPassword !== "");

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting || !canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await changePassword({
        old_password: requiresCurrentPassword ? currentPassword : undefined,
        new_password: newPassword,
      });
      setDone(true);
    } catch (reason) {
      setError(errorMessage(reason, "securityChangeFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">{t("security.title")}</h1>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-sm text-emerald-800">
          <p className="font-semibold">{t("security.changedTitle")}</p>
          <p className="mt-2">{t("security.changedDescription")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">{t("security.title")}</h1>
        <p className="text-sm text-zinc-500">{t("security.description")}</p>
      </div>
      {oauthSourced ? (
        <p className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
          {t("security.oauthHint")}
        </p>
      ) : null}
      <form className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm" onSubmit={handleSubmit}>
        {requiresCurrentPassword ? (
          <label className="block text-sm font-medium text-zinc-700">
            {t("security.currentPassword")}
            <input
              autoComplete="current-password"
              className="mt-2 h-11 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-950"
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
              type="password"
              value={currentPassword}
            />
          </label>
        ) : null}
        <label className="block text-sm font-medium text-zinc-700">
          {t("security.newPassword")}
          <input
            autoComplete="new-password"
            className="mt-2 h-11 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-950"
            minLength={6}
            onChange={(event) => setNewPassword(event.target.value)}
            required
            type="password"
            value={newPassword}
          />
        </label>
        <label className="block text-sm font-medium text-zinc-700">
          {t("security.confirmPassword")}
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
          {submitting ? t("security.submitting") : t("security.submit")}
        </button>
      </form>
    </div>
  );
}
