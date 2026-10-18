import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  clearOAuthAffiliateCode,
  completeOAuthRegistration,
  createPendingOAuthAccount,
  exchangePendingOAuthCompletion,
  pendingOAuthBindLogin,
  isAuthResponse,
  persistAuth,
  readOAuthAffiliateCode,
  sendPendingOAuthVerifyCode,
  type AuthResponse,
  type OAuthProvider,
  type PendingOAuthCompletion,
  type PendingOAuthSessionStatus,
  type SendVerifyCodeResponse,
} from "../../api/auth";
import { getPublicSettings, type PublicSettings } from "../../api/settings";
import CaptchaChallenge, { type CaptchaChallengeHandle } from "../../components/auth/CaptchaChallenge";
import StandaloneLanguageSwitcher from "../../components/StandaloneLanguageSwitcher";
import { usePageTitle } from "../../hooks/usePageTitle";
import { isAuthenticated } from "../../utils/authStorage";
import { sanitizeSilentSsoFallback } from "../../utils/silentSso";
import {
  errorMessage,
  rawMessage,
  resolveLocalizedMessage,
  translationMessage,
  type LocalizedMessage,
} from "../../utils/localizedMessage";
import {
  captchaProofPayload,
  resolveCaptchaProvider,
  type CaptchaProof,
} from "../../components/auth/captcha";

type CallbackState = "processing" | "choice" | "bind" | "registration" | "adoption" | "error";

function parseFragmentParams() {
  const raw = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  return new URLSearchParams(raw);
}

function decodeRedirect(value: string) {
  let decoded = value;
  for (let index = 0; index < 2; index += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
}

function sanitizeRedirectPath(value?: string | null) {
  const decoded = decodeRedirect(value || "/console");
  if (!decoded.startsWith("/") || decoded.startsWith("//")) return "/console";
  const hasUnsafeCharacter = Array.from(decoded).some((character) => {
    const code = character.charCodeAt(0);
    return character === "\\" || code < 0x20 || code === 0x7f;
  });
  if (decoded.includes("://") || hasUnsafeCharacter) return "/console";
  if (decoded === "/login" || decoded === "/register") return "/console";
  return decoded;
}

function readTokenResponse(params: URLSearchParams): AuthResponse | null {
  const accessToken = params.get("access_token")?.trim();
  if (!accessToken) return null;

  const expiresIn = Number.parseInt(params.get("expires_in") || "", 10);
  return {
    access_token: accessToken,
    refresh_token: params.get("refresh_token")?.trim() || undefined,
    expires_in: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : undefined,
    token_type: params.get("token_type")?.trim() || undefined,
  };
}

function isTokenCompletion(completion: PendingOAuthCompletion): completion is PendingOAuthCompletion & AuthResponse {
  return typeof completion.access_token === "string" && completion.access_token.trim().length > 0;
}

function isPendingSession(
  response: AuthResponse | PendingOAuthSessionStatus | SendVerifyCodeResponse,
): response is PendingOAuthSessionStatus {
  return "auth_result" in response && response.auth_result === "pending_session";
}

// Mirrors the classic frontend: the upstream (possibly real) email arrives in
// compat_email while resolved_email may be a synthetic oidc-...@oidc-connect.invalid
// identity key; prefer the real one for display and account creation.
function extractPendingEmail(completion: PendingOAuthCompletion): string {
  return (completion.pending_email
    || completion.existing_account_email
    || completion.compat_email
    || completion.resolved_email
    || completion.email
    || completion.suggested_email
    || "").trim();
}

const pendingChoiceSteps = new Set([
  "choose_account_action_required",
  "choose_account_action",
  "choose_account",
  "choice",
  "choose",
  "email_required",
]);

function isPendingChoiceStep(completion: PendingOAuthCompletion): boolean {
  const step = (completion.step || completion.error || "").trim().toLowerCase();
  return pendingChoiceSteps.has(step);
}

function providerLabel(provider: OAuthProvider, settings?: PublicSettings | null) {
  if (provider === "google") return "Google";
  if (provider === "github") return "GitHub";
  // OIDC 用管理员配置的 Provider 展示名（如 Mikiko CC New），缺省回退 OIDC。
  return settings?.oidc_console_oauth_provider_name?.trim() || "OIDC";
}

export default function OAuthCallback() {
  const { t } = useTranslation("auth");
  const navigate = useNavigate();
  const [state, setState] = useState<CallbackState>("processing");
  const [message, setMessage] = useState<LocalizedMessage | null>(null);
  const [status, setStatus] = useState<LocalizedMessage | null>(null);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [provider, setProvider] = useState<OAuthProvider>("google");
  const [redirectTo, setRedirectTo] = useState("/console");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [invitationRequired, setInvitationRequired] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [captchaProof, setCaptchaProof] = useState<CaptchaProof | null>(null);
  const [choiceEmail, setChoiceEmail] = useState("");
  const [createAccountAllowed, setCreateAccountAllowed] = useState(true);
  const [pendingRequiresEmailVerification, setPendingRequiresEmailVerification] = useState(false);
  const [bindEmail, setBindEmail] = useState("");
  const [bindPassword, setBindPassword] = useState("");
  // 上游资料采用确认（adoption_required）：是否把第三方昵称/头像写入本账号。
  const [suggestedDisplayName, setSuggestedDisplayName] = useState("");
  const [suggestedAvatarUrl, setSuggestedAvatarUrl] = useState("");
  const [adoptDisplayName, setAdoptDisplayName] = useState(false);
  const [adoptAvatar, setAdoptAvatar] = useState(false);
  const captchaRef = useRef<CaptchaChallengeHandle>(null);
  const requestInFlightRef = useRef(false);

  // Pending OAuth account creation always requires a local email code (independent
  // of the global email verification switch); GitHub/Google signup keeps following
  // the global setting.
  const emailVerifyEnabled = pendingRequiresEmailVerification
    || (provider === "github" || provider === "google"
      ? settings?.email_verify_enabled === true
      : true);
  let captchaProvider: ReturnType<typeof resolveCaptchaProvider> = null;
  let captchaConfigurationInvalid = false;
  if (emailVerifyEnabled) {
    try {
      captchaProvider = resolveCaptchaProvider(settings);
    } catch {
      captchaConfigurationInvalid = true;
    }
  }
  const captchaRequired = captchaProvider !== null;
  const actionCaptchaRequired = captchaProvider?.provider === "tencent" || captchaProvider?.provider === "aliyun";
  const turnstileRequired = captchaProvider?.provider === "turnstile";
  const busy = sendingCode || submitting;
  usePageTitle(t("pageTitles.oauth"));

  const canSubmit = useMemo(() => {
    if (password.length < 6 || password !== confirmPassword) return false;
    if (invitationRequired && !inviteCode.trim()) return false;
    if (emailVerifyEnabled && !verifyCode.trim()) return false;
    return true;
  }, [confirmPassword, emailVerifyEnabled, invitationRequired, inviteCode, password, verifyCode]);

  useEffect(() => {
    if (countdown <= 0) return;
    const interval = window.setInterval(() => {
      setCountdown((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [countdown]);

  const exchangeStartedRef = useRef(false);

  useEffect(() => {
    // dev 环境的 React StrictMode 会双执行 effect；pending session 是一次性的，
    // 并发两次 exchange 会导致其一被后端拒绝并覆盖成功结果。只发一次，
    // 且结果总是应用（卸载态 setState 在 React 18 中无害）。
    if (exchangeStartedRef.current) return;
    exchangeStartedRef.current = true;

    function finishWithTokens(tokens: AuthResponse, redirect: string) {
      persistAuth(tokens);
      clearOAuthAffiliateCode();
      navigate(sanitizeRedirectPath(redirect), { replace: true });
    }

    async function run() {
      const params = parseFragmentParams();
      const fragmentError = params.get("error");
      if (fragmentError) {
        // 静默登录（prompt=none）失败：login_required 等错误不做任何展示，
        // 直接回到发起入口页，让用户走正常登录流程。
        if (params.get("silent") === "1") {
          navigate(sanitizeSilentSsoFallback(params.get("fallback")), { replace: true });
          return;
        }
        setMessage(rawMessage(params.get("error_description") || params.get("error_message") || fragmentError));
        setState("error");
        return;
      }

      const tokenResponse = readTokenResponse(params);
      if (tokenResponse) {
        finishWithTokens(tokenResponse, params.get("redirect") || "/console");
        return;
      }

      try {
        const completion = await exchangePendingOAuthCompletion();
        if (isTokenCompletion(completion)) {
          finishWithTokens(completion, completion.redirect || "/console");
          return;
        }
        if (completion.auth_result === "identity_bound") {
          // 已登录用户主动绑定三方身份完成：不换发 token（沿用现有会话），
          // 直接回到发起绑定的页面（默认账号与安全）。
          clearOAuthAffiliateCode();
          navigate(sanitizeRedirectPath(completion.redirect || "/console/security"), { replace: true });
          return;
        }

        const pendingProvider: OAuthProvider = completion.provider === "github"
          ? "github"
          : completion.provider === "oidc" || completion.provider === "oidc-console"
            ? "oidc"
            : "google";
        const resolvedEmail = extractPendingEmail(completion);
        const registrationRequired = completion.error === "invitation_required"
          || completion.error === "registration_completion_required";

        if (isPendingChoiceStep(completion)) {
          // Upstream identity is new (or its email is unverified): ask whether to
          // bind an existing local account or create a new one, mirroring the
          // classic frontend chooser.
          setProvider(pendingProvider);
          setChoiceEmail(resolvedEmail || (completion.existing_account_email || "").trim());
          setCreateAccountAllowed(completion.create_account_allowed !== false);
          setBindEmail(resolvedEmail || "");
          setPendingRequiresEmailVerification(completion.email_verification_required === true
            || (pendingProvider !== "github" && pendingProvider !== "google"));
          getPublicSettings()
            .then((publicSettings) => setSettings(publicSettings))
            .catch(() => undefined);
          setState("choice");
          return;
        }

        if (registrationRequired && !resolvedEmail) {
          setMessage(translationMessage("auth:oauth.emailUnavailable"));
          setState("error");
          return;
        }
        setProvider(pendingProvider);
        setRedirectTo(sanitizeRedirectPath(completion.redirect || "/console"));
        setEmail(resolvedEmail);
        setInvitationRequired(completion.error === "invitation_required" || completion.invitation_required === true);
        if (registrationRequired) {
          const publicSettings = await getPublicSettings().catch(() => ({
            email_verify_enabled: true,
            turnstile_enabled: false,
          }));
            setSettings(publicSettings);
          setMessage(null);
          setState("registration");
          return;
        }

        // 上游带了昵称/头像建议且需要用户确认是否采用：登录与已登录用户的绑定
        // （intent=bind_current_user）都会走到这里，session 尚未消费，确认后重发
        // exchange 携带采用决定。
        if (completion.adoption_required === true
          && (completion.suggested_display_name || completion.suggested_avatar_url)) {
          setSuggestedDisplayName(completion.suggested_display_name || "");
          setSuggestedAvatarUrl(completion.suggested_avatar_url || "");
          setAdoptDisplayName(Boolean(completion.suggested_display_name));
          setAdoptAvatar(Boolean(completion.suggested_avatar_url));
          setMessage(null);
          setState("adoption");
          return;
        }

        setMessage(completion.error
          ? rawMessage(completion.error)
          : translationMessage("errors:oauthCallbackFailed"));
        setState("error");
      } catch (error) {
        // pending session 已被消费/过期（常见：用户在 OIDC 流程中打开忘记密码等
        // 新链接并完成了登录，再回到本页）。此时若本地已有有效会话，静默跳转，
        // 不展示报错。
        if ((error as { code?: string })?.code === "PENDING_AUTH_SESSION_NOT_FOUND" && isAuthenticated()) {
          navigate(redirectTo || "/console", { replace: true });
          return;
        }
        setMessage(errorMessage(error, "oauthCallbackFailed", "auth"));
        setState("error");
      }
    }

    void run();
  }, [navigate]);

  function showExistingAccountError() {
    setStatus(null);
    setMessage(translationMessage("auth:oauth.existingAccount"));
    setState("error");
  }

  function resetCaptcha() {
    setCaptchaProof(null);
    captchaRef.current?.reset();
  }

  async function acquireCaptchaProof() {
    if (!captchaRequired) return null;
    if (captchaProof) return captchaProof;
    if (!actionCaptchaRequired) return null;
    return captchaRef.current?.verify() ?? null;
  }

  async function handleSendCode() {
    if (requestInFlightRef.current || countdown > 0) return;
    if (captchaConfigurationInvalid) {
      setMessage(translationMessage("auth:captcha.misconfiguredSupport"));
      return;
    }
    if (turnstileRequired && !captchaProof) {
      setMessage(translationMessage("auth:captchaRequiredError"));
      return;
    }

    requestInFlightRef.current = true;
    setSendingCode(true);
    setMessage(null);
    setStatus(null);
    try {
      const requestCaptchaProof = actionCaptchaRequired ? await acquireCaptchaProof() : captchaProof;
      if (captchaRequired && !requestCaptchaProof) return;
      setCaptchaProof(null);
      const response = await sendPendingOAuthVerifyCode(email, requestCaptchaProof);
      if (isPendingSession(response)) {
        showExistingAccountError();
        return;
      }
      setCountdown(Math.max(0, Math.floor(response.countdown)));
      setStatus(translationMessage("auth:codeSent"));
    } catch (error) {
      setMessage(errorMessage(error, "authSendCodeFailed", "auth"));
    } finally {
      if (captchaRequired) resetCaptcha();
      requestInFlightRef.current = false;
      setSendingCode(false);
    }
  }

  function enterCreateAccountMode() {
    setMessage(null);
    if (choiceEmail) setEmail(choiceEmail);
    setState("registration");
  }

  function enterBindMode() {
    setMessage(null);
    setBindPassword("");
    setState("bind");
  }

  async function handleBindLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestInFlightRef.current) return;
    const email = bindEmail.trim();
    if (!email || !bindPassword) return;
    requestInFlightRef.current = true;
    setSubmitting(true);
    setMessage(null);
    try {
      const completion = await pendingOAuthBindLogin({ email, password: bindPassword });
      if (completion.requires_2fa === true || completion.temp_token) {
        setMessage(translationMessage("auth:twoFactorClassic"));
        return;
      }
      if (isTokenCompletion(completion)) {
        persistAuth(completion);
        clearOAuthAffiliateCode();
        navigate(sanitizeRedirectPath(completion.redirect || "/console"), { replace: true });
        return;
      }
      // Bind-only completion carries no tokens; follow its redirect.
      clearOAuthAffiliateCode();
      navigate(sanitizeRedirectPath(completion.redirect || "/console"), { replace: true });
    } catch (error) {
      setMessage(errorMessage(error, "oauthCallbackFailed", "auth"));
    } finally {
      requestInFlightRef.current = false;
      setSubmitting(false);
    }
  }

  // Adoption confirmation: resubmitting exchange with adopt decision (nickname/avatar).
  // After success: login flow obtains a token and goes to redirect; already-logged-in bind flow
  // (identity_bound) carries no token and directly returns to the page that initiated the bind.
  async function handleAdoptionConfirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestInFlightRef.current) return;
    requestInFlightRef.current = true;
    setSubmitting(true);
    setMessage(null);
    try {
      const completion = await exchangePendingOAuthCompletion({
        adopt_display_name: adoptDisplayName,
        adopt_avatar: adoptAvatar,
      });
      if (isTokenCompletion(completion)) {
        persistAuth(completion);
        clearOAuthAffiliateCode();
        navigate(sanitizeRedirectPath(completion.redirect || redirectTo || "/console"), { replace: true });
        return;
      }
      if (completion.auth_result === "identity_bound") {
        clearOAuthAffiliateCode();
        navigate(sanitizeRedirectPath(completion.redirect || redirectTo || "/console/security"), { replace: true });
        return;
      }
      setMessage(completion.error
        ? rawMessage(completion.error)
        : translationMessage("errors:oauthCallbackFailed"));
      setState("error");
    } catch (error) {
      setMessage(errorMessage(error, "oauthCallbackFailed", "auth"));
    } finally {
      requestInFlightRef.current = false;
      setSubmitting(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestInFlightRef.current || !canSubmit) return;
    if (emailVerifyEnabled && captchaConfigurationInvalid) {
      setMessage(translationMessage("auth:captcha.misconfiguredSupport"));
      return;
    }
    if (emailVerifyEnabled && turnstileRequired && !captchaProof) {
      setMessage(translationMessage("auth:captchaRequiredError"));
      return;
    }
    requestInFlightRef.current = true;
    setSubmitting(true);
    setMessage(null);
    setStatus(null);
    const usesEmailPasswordSignup = provider === "github" || provider === "google";
    try {
      if (usesEmailPasswordSignup && !emailVerifyEnabled) {
        const response = await completeOAuthRegistration({
          provider,
          password,
          invitation_code: inviteCode.trim() || undefined,
        });
        if (!isAuthResponse(response)) {
          setMessage(translationMessage("errors:oauthSignupFailed"));
          return;
        }
        persistAuth(response);
      } else {
        const requestCaptchaProof = actionCaptchaRequired ? await acquireCaptchaProof() : captchaProof;
        if (captchaRequired && !requestCaptchaProof) return;
        setCaptchaProof(null);
        const response = await createPendingOAuthAccount({
          email,
          password,
          verify_code: verifyCode.trim(),
          invitation_code: inviteCode.trim() || undefined,
          aff_code: readOAuthAffiliateCode() || undefined,
          ...captchaProofPayload(requestCaptchaProof),
        });
        if (isPendingSession(response)) {
          showExistingAccountError();
          return;
        }
        if (!isAuthResponse(response)) {
          setMessage(translationMessage("errors:oauthSignupFailed"));
          return;
        }
      }
      clearOAuthAffiliateCode();
      navigate(redirectTo, { replace: true });
    } catch (error) {
      setMessage(errorMessage(error, "oauthSignupFailed", "auth"));
      setState("registration");
    } finally {
      if (emailVerifyEnabled && captchaRequired) resetCaptcha();
      requestInFlightRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-zinc-50 px-6 py-12">
      <StandaloneLanguageSwitcher />
      <section className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-8 shadow-sm">
        {state === "processing" ? (
          <div className="text-center">
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-950" />
            <h1 className="mt-5 text-xl font-semibold text-zinc-950">{t("oauth.completing")}</h1>
            <p className="mt-2 text-sm text-zinc-500">{t("oauth.completingMessage")}</p>
          </div>
        ) : null}

        {state === "error" ? (
          <div className="text-center">
            <h1 className="text-xl font-semibold text-zinc-950">{t("oauth.failed")}</h1>
            {message ? <p role="alert" className="mt-3 text-sm leading-6 text-zinc-500">{resolveLocalizedMessage(message)}</p> : null}
            <Link
              className="mt-6 inline-flex h-11 items-center justify-center rounded-md bg-zinc-950 px-5 text-sm font-semibold text-white"
              to="/login"
            >
              {t("oauth.backToSignIn")}
            </Link>
          </div>
        ) : null}

        {state === "choice" ? (
          <div className="text-center">
            <h1 className="text-xl font-semibold text-zinc-950">{t("oauth.chooseHowToContinue")}</h1>
            <p className="mt-2 text-sm leading-6 text-zinc-500">{t("oauth.chooseAccountActionHint")}</p>
            {choiceEmail ? (
              <p className="mt-3 rounded-lg bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-800">
                {t("oauth.suggestedEmail", { email: choiceEmail })}
              </p>
            ) : null}
            <div className="mt-6 space-y-3">
              <button
                type="button"
                onClick={enterBindMode}
                className="h-11 w-full rounded-md bg-zinc-950 text-sm font-semibold text-white transition hover:bg-zinc-800"
              >
                {t("oauth.bindExistingAccount")}
              </button>
              {createAccountAllowed ? (
                <button
                  type="button"
                  onClick={enterCreateAccountMode}
                  className="h-11 w-full rounded-md border border-zinc-300 bg-white text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50"
                >
                  {t("oauth.createNewAccount")}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {state === "adoption" ? (
          <form className="space-y-4" onSubmit={handleAdoptionConfirm}>
            <div>
              <h1 className="text-xl font-semibold text-zinc-950">{t("oauth.adoptionTitle")}</h1>
              <p className="mt-2 text-sm leading-6 text-zinc-500">{t("oauth.adoptionHint")}</p>
            </div>
            {suggestedDisplayName ? (
              <label className="flex items-start gap-3 rounded-lg border border-zinc-200 bg-white p-3 text-sm">
                <input
                  checked={adoptDisplayName}
                  className="mt-0.5 h-4 w-4"
                  onChange={(event) => setAdoptDisplayName(event.target.checked)}
                  type="checkbox"
                />
                <span>
                  <span className="block font-medium text-zinc-900">{t("oauth.adoptDisplayName")}</span>
                  <span className="block text-zinc-500">{suggestedDisplayName}</span>
                </span>
              </label>
            ) : null}
            {suggestedAvatarUrl ? (
              <label className="flex items-start gap-3 rounded-lg border border-zinc-200 bg-white p-3 text-sm">
                <input
                  checked={adoptAvatar}
                  className="mt-0.5 h-4 w-4"
                  onChange={(event) => setAdoptAvatar(event.target.checked)}
                  type="checkbox"
                />
                <span>
                  <span className="block font-medium text-zinc-900">{t("oauth.adoptAvatar")}</span>
                  <img
                    alt=""
                    className="mt-2 h-10 w-10 rounded-full object-cover"
                    src={suggestedAvatarUrl}
                  />
                </span>
              </label>
            ) : null}
            {message ? <p role="alert" className="text-sm text-red-600">{resolveLocalizedMessage(message)}</p> : null}
            <button
              className="h-11 w-full rounded-md bg-zinc-950 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
              disabled={submitting}
              type="submit"
            >
              {submitting ? t("oauth.completing") : t("oauth.adoptionConfirm")}
            </button>
          </form>
        ) : null}

        {state === "bind" ? (
          <form className="space-y-4" onSubmit={handleBindLogin}>
            <div>
              <h1 className="text-xl font-semibold text-zinc-950">{t("oauth.bindExistingAccount")}</h1>
              <p className="mt-2 text-sm leading-6 text-zinc-500">{t("oauth.bindLoginHint")}</p>
            </div>
            <label className="block text-sm font-medium text-zinc-700">
              {t("email")}
              <input
                autoComplete="username"
                className="mt-2 h-11 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-950"
                onChange={(event) => setBindEmail(event.target.value)}
                type="email"
                value={bindEmail}
              />
            </label>
            <label className="block text-sm font-medium text-zinc-700">
              {t("password")}
              <input
                autoComplete="current-password"
                className="mt-2 h-11 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-950"
                onChange={(event) => setBindPassword(event.target.value)}
                type="password"
                value={bindPassword}
              />
            </label>
            {message ? <p role="alert" className="text-sm text-red-600">{resolveLocalizedMessage(message)}</p> : null}
            <button
              className="h-11 w-full rounded-md bg-zinc-950 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
              disabled={submitting || !bindEmail.trim() || !bindPassword}
              type="submit"
            >
              {submitting ? t("oauth.completing") : t("oauth.logInAndBind")}
            </button>
            <button
              type="button"
              onClick={() => setState("choice")}
              className="h-11 w-full rounded-md border border-zinc-200 text-sm font-semibold text-zinc-500 transition hover:bg-zinc-50"
            >
              {t("oauth.backToOptions")}
            </button>
          </form>
        ) : null}

        {state === "registration" ? (
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-400">
                {providerLabel(provider, settings)} OAuth
              </p>
              <h1 className="mt-2 text-xl font-semibold text-zinc-950">{t("oauth.completeSignup", { provider: providerLabel(provider, settings) })}</h1>
              <p className="mt-2 text-sm leading-6 text-zinc-500">
                {t("oauth.signupDescription")}
              </p>
            </div>

            <label className="block text-sm font-medium text-zinc-700">
              {t("email")}
              <input
                className="mt-2 h-11 w-full rounded-md border border-zinc-200 bg-zinc-100 px-3 text-sm text-zinc-500 outline-none"
                readOnly
                value={email}
              />
            </label>
            <label className="block text-sm font-medium text-zinc-700">
              {t("password")}
              <input
                autoComplete="new-password"
                className="mt-2 h-11 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-950"
                disabled={busy}
                minLength={6}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                value={password}
              />
            </label>
            <label className="block text-sm font-medium text-zinc-700">
              {t("confirmPassword")}
              <input
                autoComplete="new-password"
                className="mt-2 h-11 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-950"
                disabled={busy}
                onChange={(event) => setConfirmPassword(event.target.value)}
                type="password"
                value={confirmPassword}
              />
            </label>
            {invitationRequired ? (
              <label className="block text-sm font-medium text-zinc-700">
                {t("inviteCode")}
                <input
                  className="mt-2 h-11 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-950"
                  disabled={busy}
                  onChange={(event) => setInviteCode(event.target.value)}
                  value={inviteCode}
                />
              </label>
            ) : null}
            {emailVerifyEnabled ? (
              <>
                <CaptchaChallenge
                  ref={captchaRef}
                  settings={settings}
                  onVerify={(proof) => {
                    setCaptchaProof(proof);
                    setMessage(null);
                  }}
                  onExpire={() => {
                    setCaptchaProof(null);
                    setMessage(translationMessage("auth:captchaExpired"));
                  }}
                  onInvalidate={() => setCaptchaProof(null)}
                  onError={() => {
                    setCaptchaProof(null);
                    setMessage(translationMessage("auth:captchaFailed"));
                  }}
                />
                <button
                  className="h-11 w-full rounded-md border border-zinc-300 bg-white text-sm font-semibold text-zinc-900 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400"
                  disabled={busy || countdown > 0 || captchaConfigurationInvalid || (turnstileRequired && !captchaProof)}
                  onClick={() => void handleSendCode()}
                  type="button"
                >
                  {sendingCode
                    ? t("oauth.sending")
                    : countdown > 0
                      ? t("oauth.resendIn", { seconds: countdown })
                      : t("sendVerificationCode")}
                </button>
                <label className="block text-sm font-medium text-zinc-700">
                  {t("verificationCode")}
                  <input
                    className="mt-2 h-11 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-950"
                    disabled={busy}
                    inputMode="numeric"
                    onChange={(event) => setVerifyCode(event.target.value)}
                    value={verifyCode}
                  />
                </label>
              </>
            ) : null}
            {message ? <p role="alert" className="text-sm text-red-600">{resolveLocalizedMessage(message)}</p> : null}
            {status ? <p role="status" className="text-sm text-emerald-700">{resolveLocalizedMessage(status)}</p> : null}
            <button
              className="h-11 w-full rounded-md bg-zinc-950 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
              disabled={!canSubmit || busy || (emailVerifyEnabled && (captchaConfigurationInvalid || (turnstileRequired && !captchaProof)))}
              type="submit"
            >
              {submitting ? t("oauth.completingSignup") : t("oauth.completeSignupButton")}
            </button>
            <button
              type="button"
              onClick={() => setState("choice")}
              className="h-11 w-full rounded-md border border-zinc-200 text-sm font-semibold text-zinc-500 transition hover:bg-zinc-50"
            >
              {t("oauth.backToOptions")}
            </button>
          </form>
        ) : null}
      </section>
    </main>
  );
}
