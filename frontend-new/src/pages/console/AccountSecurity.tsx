import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { changePassword } from "../../api/auth";
import { getConsoleBootstrap } from "../../api/console";
import { apiRequest, getJSON } from "../../api/client";
import type { ConsoleBootstrap } from "../../types/console";
import { usePageTitle } from "../../hooks/usePageTitle";
import { errorMessage, resolveLocalizedMessage, type LocalizedMessage } from "../../utils/localizedMessage";

/** 用户自述身份绑定摘要（/user/profile 的 identities 集合）。 */
interface IdentitySummary {
  provider: string;
  bound: boolean;
  bound_count?: number;
  display_name?: string;
  subject_hint?: string;
  provider_key?: string;
  can_unbind?: boolean;
  note_key?: string;
}

type IdentitySummarySet = Record<string, IdentitySummary>;

const DISPLAY_PROVIDERS = ["oidc", "linuxdo", "wechat", "dingtalk"];

function AccountSecurity() {
  const { t } = useTranslation("console");
  usePageTitle(t("security.accountTitle"));
  const [bootstrap, setBootstrap] = useState<ConsoleBootstrap | null>(null);
  const [identities, setIdentities] = useState<IdentitySummarySet | null>(null);
  const [unbinding, setUnbinding] = useState<string | null>(null);
  const [unbindError, setUnbindError] = useState<LocalizedMessage | null>(null);
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
    getJSON<Record<string, unknown> & { identities?: IdentitySummarySet }>("/user/profile")
      .then((profile) => {
        if (active) setIdentities(profile.identities ?? {});
      })
      .catch(() => {
        if (active) setIdentities({});
      });
    return () => {
      active = false;
    };
  }, []);

  const requiresCurrentPassword = bootstrap === null || !oauthSourced;
  const canSubmit = newPassword.length >= 6
    && newPassword === confirmPassword
    && (!requiresCurrentPassword || currentPassword !== "");

  const unbind = async (provider: string) => {
    if (unbinding !== null) return;
    setUnbinding(provider);
    setUnbindError(null);
    try {
      await apiRequest(`/user/account-bindings/${provider}`, { method: "DELETE" });
      const profile = await getJSON<Record<string, unknown> & { identities?: IdentitySummarySet }>("/user/profile");
      setIdentities(profile.identities ?? {});
    } catch (reason) {
      setUnbindError(errorMessage(reason, "securityUnbindFailed"));
    } finally {
      setUnbinding(null);
    }
  };

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

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">{t("security.accountTitle")}</h1>
        <p className="text-sm text-zinc-500">{t("security.accountDescription")}</p>
      </div>

      {/* 三方授权 */}
      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold tracking-tight text-zinc-900">{t("security.linkedTitle")}</h2>
        <p className="mt-1 text-sm text-zinc-500">{t("security.linkedDescription")}</p>
        {identities === null ? (
          <div className="py-8 text-center text-sm font-bold uppercase tracking-widest text-zinc-400">
            {t("security.loading")}
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {DISPLAY_PROVIDERS.map((provider) => {
              const summary = identities[provider];
              if (!summary) return null;
              return (
                <div
                  key={provider}
                  className="flex flex-col gap-2 rounded-xl border border-zinc-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-600">
                        {provider}
                      </span>
                      {summary.bound ? (
                        <span className="text-sm font-medium text-zinc-900">
                          {summary.display_name || summary.subject_hint || t("security.linked")}
                        </span>
                      ) : (
                        <span className="text-sm text-zinc-400">{t("security.notLinked")}</span>
                      )}
                    </div>
                    {summary.bound && summary.provider_key ? (
                      <div className="mt-0.5 truncate text-[10px] text-zinc-400" title={summary.provider_key}>
                        {summary.provider_key}
                      </div>
                    ) : null}
                  </div>
                  {summary.bound ? (
                    <button
                      type="button"
                      disabled={unbinding !== null || summary.can_unbind === false}
                      title={summary.can_unbind === false ? t("security.lastMethodHint") : undefined}
                      onClick={() => void unbind(provider)}
                      className="shrink-0 self-start rounded-lg bg-red-50 px-3.5 py-2 text-xs font-semibold text-red-600 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50 sm:self-auto"
                    >
                      {unbinding === provider ? "…" : t("security.unbind")}
                    </button>
                  ) : null}
                </div>
              );
            })}
            {unbindError ? <p role="alert" className="text-sm text-red-600">{resolveLocalizedMessage(unbindError)}</p> : null}
          </div>
        )}
      </section>

      {/* 重置密码 */}
      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold tracking-tight text-zinc-900">{t("security.title")}</h2>
        <p className="mt-1 text-sm text-zinc-500">{t("security.description")}</p>
        {done ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            <p className="font-semibold">{t("security.changedTitle")}</p>
            <p className="mt-1">{t("security.changedDescription")}</p>
          </div>
        ) : (
          <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
            {oauthSourced ? (
              <p className="rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-800">{t("security.oauthHint")}</p>
            ) : null}
            {requiresCurrentPassword ? (
              <label className="block text-sm font-medium text-zinc-700">
                {t("security.currentPassword")}
                <input
                  autoComplete="current-password"
                  className="mt-2 h-11 w-full rounded-lg border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-950"
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
                className="mt-2 h-11 w-full rounded-lg border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-950"
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
                className="mt-2 h-11 w-full rounded-lg border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-950"
                minLength={6}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
                type="password"
                value={confirmPassword}
              />
            </label>
            {error ? <p role="alert" className="text-sm text-red-600">{resolveLocalizedMessage(error)}</p> : null}
            <button
              className="h-11 rounded-lg bg-zinc-950 px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
              disabled={submitting || !canSubmit}
              type="submit"
            >
              {submitting ? t("security.submitting") : t("security.submit")}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}

export default AccountSecurity;
