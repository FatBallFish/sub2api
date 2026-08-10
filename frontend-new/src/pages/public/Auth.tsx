import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  GithubLogo,
  GoogleLogo,
  Envelope,
  ArrowRight,
  ShieldCheck,
  Cpu,
  Globe,
  LockKey,
} from "@phosphor-icons/react";
import { motion, AnimatePresence } from "motion/react";
import { useTranslation } from "react-i18next";
import { login, register, sendVerifyCode, startOAuth } from "../../api/auth";
import { getPublicSettings, type PublicSettings } from "../../api/settings";
import CaptchaChallenge, { type CaptchaChallengeHandle } from "../../components/auth/CaptchaChallenge";
import LoginAgreementPrompt from "../../components/auth/LoginAgreementPrompt";
import LanguageSwitcher from "../../components/LanguageSwitcher";
import {
  captchaProofPayload,
  resolveCaptchaProvider,
  type CaptchaProof,
} from "../../components/auth/captcha";
import { isAuthenticated } from "../../utils/authStorage";
import { usePageTitle } from "../../hooks/usePageTitle";
import {
  errorMessage,
  resolveLocalizedMessage,
  translationMessage,
  type LocalizedMessage,
} from "../../utils/localizedMessage";
import {
  agreementDocuments,
  agreementRevision,
  clearAgreementConsent,
  hasAcceptedAgreement,
  storeAgreementConsent,
} from "../../utils/loginAgreement";

type AuthMode = "login" | "register";

function getQueryValue(search: string, key: string) {
  return new URLSearchParams(search).get(key) || undefined;
}

export default function Auth() {
  const { t } = useTranslation("auth");
  const location = useLocation();
  const navigate = useNavigate();
  const initialMode = location.pathname.includes("register") ? "register" : "login";
  const redirectTo = getQueryValue(location.search, "redirect") || "/console";
  const initialInvitationCode = getQueryValue(location.search, "invitation_code") || "";
  const initialAffiliateCode = getQueryValue(location.search, "ref") || getQueryValue(location.search, "aff_code") || "";
  const initialInviteCode = initialInvitationCode || initialAffiliateCode;
  const initialInviteCodeKind = initialInvitationCode ? "invitation" : initialAffiliateCode ? "affiliate" : "none";
  const promoCode = getQueryValue(location.search, "promo_code");

  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [inviteCode, setInviteCode] = useState(initialInviteCode);
  const [sent, setSent] = useState(false);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [status, setStatus] = useState<LocalizedMessage | null>(null);
  const [error, setError] = useState<LocalizedMessage | null>(null);
  const [loading, setLoading] = useState(false);
  const [captchaProof, setCaptchaProof] = useState<CaptchaProof | null>(null);
  const [agreementAccepted, setAgreementAccepted] = useState(false);
  const [agreementModalOpen, setAgreementModalOpen] = useState(false);
  const captchaRef = useRef<CaptchaChallengeHandle>(null);
  const requestInFlightRef = useRef(false);

  const settingsLoaded = settings !== null;
  const emailVerifyEnabled = settings?.email_verify_enabled !== false;
  const registrationEnabled = settings?.registration_enabled !== false;
  const invitationCodeRequired = settings?.invitation_code_enabled === true;
  const googleOAuthEnabled = settings?.google_oauth_enabled === true;
  const githubOAuthEnabled = settings?.github_oauth_enabled === true;
  const showOAuth = googleOAuthEnabled || githubOAuthEnabled;
  const loginAgreementDocuments = agreementDocuments(settings);
  const loginAgreementEnabled = settings?.login_agreement_enabled === true && loginAgreementDocuments.length > 0;
  const loginAgreementMode = settings?.login_agreement_mode === "checkbox" ? "checkbox" : "modal";
  const loginAgreementRevision = settings ? agreementRevision(settings, loginAgreementDocuments) : "";
  const agreementRequired = loginAgreementEnabled && !agreementAccepted;
  let captchaProvider: ReturnType<typeof resolveCaptchaProvider> = null;
  let captchaConfigurationInvalid = false;
  try {
    captchaProvider = resolveCaptchaProvider(settings);
  } catch {
    captchaConfigurationInvalid = true;
  }
  const captchaRequired = captchaProvider !== null;
  const actionCaptchaRequired = captchaProvider?.provider === "tencent" || captchaProvider?.provider === "aliyun";
  const turnstileRequired = captchaProvider?.provider === "turnstile";
  usePageTitle(t(mode === "login" ? "pageTitles.login" : "pageTitles.register"));

  useEffect(() => {
    if (isAuthenticated()) {
      navigate(redirectTo, { replace: true });
      return;
    }

    let active = true;
    getPublicSettings()
      .then((data) => {
        if (!active) return;
        const documents = agreementDocuments(data);
        const enabled = data.login_agreement_enabled === true && documents.length > 0;
        const revision = agreementRevision(data, documents);
        const accepted = !enabled || hasAcceptedAgreement(revision);
        setSettings(data);
        setAgreementAccepted(accepted);
        setAgreementModalOpen(enabled && !accepted && data.login_agreement_mode !== "checkbox");
      })
      .catch(() => {
        if (active) setSettings({});
      });

    return () => {
      active = false;
    };
  }, [navigate, redirectTo]);

  if (isAuthenticated()) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white text-sm font-medium text-zinc-500">
        {t("redirecting")}
      </div>
    );
  }

  const title = mode === "login" ? t("loginTitle") : sent ? t("checkEmailTitle") : t("registerTitle");
  const subtitle = mode === "login"
    ? t("loginDescription")
    : sent
      ? t("codeSentTo", { email })
      : emailVerifyEnabled
        ? t("registerVerifyDescription")
        : t("registerDescription");

  const resetCaptcha = () => {
    setCaptchaProof(null);
    captchaRef.current?.reset();
  };

  const requireReadySettings = () => {
    if (settingsLoaded) return true;
    setError(translationMessage("auth:settingsLoadingError"));
    return false;
  };

  const requireAgreement = () => {
    if (!agreementRequired) return true;
    if (loginAgreementMode === "modal") setAgreementModalOpen(true);
    setError(translationMessage("auth:agreementRequiredError"));
    return false;
  };

  const acceptAgreement = () => {
    storeAgreementConsent(loginAgreementRevision);
    setAgreementAccepted(true);
    setAgreementModalOpen(false);
    setError(null);
  };

  const rejectAgreement = () => {
    clearAgreementConsent();
    setAgreementAccepted(false);
    setAgreementModalOpen(false);
  };

  const requireEmbeddedCaptchaVerification = () => {
    if (!turnstileRequired || captchaProof) return true;
    setError(translationMessage("auth:captchaRequiredError"));
    return false;
  };

  const acquireCaptchaProof = async () => {
    if (!captchaRequired) return null;
    if (captchaProof) return captchaProof;
    if (!actionCaptchaRequired) return null;
    return captchaRef.current?.verify() ?? null;
  };

  const switchMode = (nextMode: AuthMode) => {
    if (requestInFlightRef.current) return;
    resetCaptcha();
    setMode(nextMode);
    setSent(false);
    setVerifyCode("");
    setStatus(null);
    setError(null);
  };

  const finishAuth = () => {
    navigate(redirectTo, { replace: true });
  };

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (requestInFlightRef.current) return;
    if (!requireReadySettings() || !requireAgreement() || captchaConfigurationInvalid || !requireEmbeddedCaptchaVerification()) return;
    requestInFlightRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const requestCaptchaProof = actionCaptchaRequired ? await acquireCaptchaProof() : captchaProof;
      if (captchaRequired && !requestCaptchaProof) return;
      setCaptchaProof(null);
      const response = await login({
        email,
        password,
        ...captchaProofPayload(requestCaptchaProof),
      });
      if (response.requires_2fa) {
        setError(translationMessage("auth:twoFactorClassic"));
        return;
      }
      finishAuth();
    } catch (reason) {
      setError(errorMessage(reason, "authSignInFailed", "auth"));
    } finally {
      if (captchaRequired) resetCaptcha();
      requestInFlightRef.current = false;
      setLoading(false);
    }
  };

  const handleSendCode = async (event: React.FormEvent) => {
    event.preventDefault();
    if (requestInFlightRef.current) return;
    if (!requireReadySettings() || !requireAgreement()) return;
    if (!registrationEnabled) {
      setError(null);
      return;
    }
    if (invitationCodeRequired && !inviteCode.trim()) {
      setError(translationMessage("auth:invitationRequiredError"));
      return;
    }
    if (!emailVerifyEnabled) {
      await handleRegister(event);
      return;
    }
    if (captchaConfigurationInvalid || !requireEmbeddedCaptchaVerification()) return;
    requestInFlightRef.current = true;
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const requestCaptchaProof = actionCaptchaRequired ? await acquireCaptchaProof() : captchaProof;
      if (captchaRequired && !requestCaptchaProof) return;
      setCaptchaProof(null);
      await sendVerifyCode(email, requestCaptchaProof);
      setSent(true);
      setStatus(translationMessage("auth:codeSent"));
    } catch (reason) {
      setError(errorMessage(reason, "authSendCodeFailed", "auth"));
    } finally {
      if (captchaRequired) resetCaptcha();
      requestInFlightRef.current = false;
      setLoading(false);
    }
  };

  const handleRegister = async (event: React.FormEvent) => {
    event.preventDefault();
    if (requestInFlightRef.current) return;
    if (!requireReadySettings() || !requireAgreement()) return;
    if (!registrationEnabled) {
      setError(null);
      return;
    }
    const normalizedInviteCode = inviteCode.trim();
    if (invitationCodeRequired && !normalizedInviteCode) {
      setError(translationMessage("auth:invitationRequiredError"));
      return;
    }
    if (!emailVerifyEnabled && (captchaConfigurationInvalid || !requireEmbeddedCaptchaVerification())) return;
    requestInFlightRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const requestCaptchaProof = emailVerifyEnabled
        ? null
        : actionCaptchaRequired
          ? await acquireCaptchaProof()
          : captchaProof;
      if (!emailVerifyEnabled && captchaRequired && !requestCaptchaProof) return;
      if (requestCaptchaProof) setCaptchaProof(null);
      const payload = {
        email,
        password,
        ...(emailVerifyEnabled ? { verify_code: verifyCode } : {}),
        ...captchaProofPayload(requestCaptchaProof),
        ...(normalizedInviteCode && (invitationCodeRequired || initialInviteCodeKind === "invitation") ? { invitation_code: normalizedInviteCode } : {}),
        ...(normalizedInviteCode && !invitationCodeRequired && initialInviteCodeKind !== "invitation" ? { aff_code: normalizedInviteCode } : {}),
        ...(promoCode ? { promo_code: promoCode } : {}),
      };
      await register(payload);
      finishAuth();
    } catch (reason) {
      setError(errorMessage(reason, "authRegisterFailed", "auth"));
    } finally {
      if (!emailVerifyEnabled && captchaRequired) resetCaptcha();
      requestInFlightRef.current = false;
      setLoading(false);
    }
  };

  const handleOAuthStart = async (provider: "google" | "github") => {
    if (requestInFlightRef.current || !requireReadySettings() || !requireAgreement() || captchaConfigurationInvalid) return;
    if (!actionCaptchaRequired) {
      startOAuth(provider, redirectTo, initialAffiliateCode);
      return;
    }
    requestInFlightRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const requestCaptchaProof = await acquireCaptchaProof();
      if (!requestCaptchaProof) return;
      if (requestCaptchaProof) setCaptchaProof(null);
      await startOAuth(provider, redirectTo, initialAffiliateCode, requestCaptchaProof);
    } catch (reason) {
      setError(errorMessage(reason, "authOAuthStartFailed", "auth"));
    } finally {
      resetCaptcha();
      requestInFlightRef.current = false;
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen bg-white selection:bg-zinc-900 selection:text-white">
      <div className="absolute right-4 top-4 z-30 md:right-8 md:top-8">
        <LanguageSwitcher />
      </div>
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-zinc-950 p-16 lg:flex">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(24,24,27,1)_0%,rgba(9,9,11,1)_100%)]" />
        <div
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage: "radial-gradient(circle at 1px 1px, #3f3f46 1px, transparent 0)",
            backgroundSize: "40px 40px",
          }}
        />

        <div className="relative z-10">
          <Link to="/" className="text-2xl font-bold tracking-tighter text-white">
            Mikiko CC
          </Link>
        </div>

        <div className="relative z-10 space-y-12">
          <div className="space-y-6">
            <h2 className="text-5xl font-bold leading-tight tracking-tight text-white">
              {t("hero.heading")} <br />
              <span className="text-zinc-500">{t("hero.headingEmphasis")}</span>
            </h2>
            <p className="max-w-md text-lg leading-relaxed text-zinc-400">
              {t("hero.description")}
            </p>
          </div>

          <div className="space-y-8">
            {[
              { icon: Cpu, title: t("hero.universalTitle"), desc: t("hero.universalDescription") },
              { icon: ShieldCheck, title: t("hero.secureTitle"), desc: t("hero.secureDescription") },
              { icon: Globe, title: t("hero.globalTitle"), desc: t("hero.globalDescription") },
            ].map((item, index) => (
              <motion.div
                key={item.title}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.5 + index * 0.1 }}
                className="flex gap-4"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white">
                  <item.icon size={20} weight="duotone" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white">{item.title}</h4>
                  <p className="mt-1 text-xs text-zinc-500">{item.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        <div className="relative z-10 text-xs font-bold uppercase tracking-widest text-zinc-600">
          {t("hero.copyright")}
        </div>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center p-8 md:p-16">
        <div className="w-full max-w-sm space-y-10">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight text-zinc-900">{title}</h1>
            <p className="text-sm leading-relaxed text-zinc-500">{subtitle}</p>
          </div>

          <div className="grid grid-cols-2 rounded-xl bg-zinc-100 p-1 text-sm font-bold">
            <button
              type="button"
              disabled={loading}
              onClick={() => switchMode("login")}
              className={`rounded-lg py-2 transition-colors disabled:cursor-not-allowed ${mode === "login" ? "bg-white text-zinc-950 shadow-sm" : "text-zinc-500"}`}
            >
              {t("loginTab")}
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => switchMode("register")}
              className={`rounded-lg py-2 transition-colors disabled:cursor-not-allowed ${mode === "register" ? "bg-white text-zinc-950 shadow-sm" : "text-zinc-500"}`}
            >
              {t("registerTab")}
            </button>
          </div>

          <div className="space-y-6">
            <AnimatePresence mode="wait">
              {mode === "login" ? (
                <motion.form
                  key="login-form"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  onSubmit={handleLogin}
                  className="space-y-4"
                >
                  <AuthTextField
                    id="login-email"
                    label={t("email")}
                    type="email"
                    value={email}
                    onChange={setEmail}
                    placeholder="name@company.com"
                    icon={<Envelope size={18} className="text-zinc-400" />}
                  />
                  <AuthTextField
                    id="login-password"
                    label={t("password")}
                    type="password"
                    value={password}
                    onChange={setPassword}
                    placeholder={t("passwordPlaceholder")}
                    icon={<LockKey size={18} className="text-zinc-400" />}
                  />
                  <CaptchaChallenge
                    ref={captchaRef}
                    settings={settings}
                    onVerify={(proof) => {
                      setCaptchaProof(proof);
                      setError(null);
                    }}
                    onExpire={() => {
                      setCaptchaProof(null);
                      setError(translationMessage("auth:captchaExpired"));
                    }}
                    onInvalidate={() => setCaptchaProof(null)}
                    onError={() => {
                      setCaptchaProof(null);
                      setError(translationMessage("auth:captchaFailed"));
                    }}
                  />
                  <SubmitButton
                    loading={loading}
                    disabled={!settingsLoaded || agreementRequired || captchaConfigurationInvalid || (turnstileRequired && !captchaProof)}
                  >
                    {t("signIn")}
                  </SubmitButton>
                </motion.form>
              ) : !sent ? (
                <motion.form
                  key="register-email-form"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  onSubmit={handleSendCode}
                  className="space-y-4"
                >
                  <AuthTextField
                    id="register-email"
                    label={t("email")}
                    type="email"
                    value={email}
                    onChange={setEmail}
                    placeholder="name@company.com"
                    icon={<Envelope size={18} className="text-zinc-400" />}
                  />
                  <AuthTextField
                    id="register-password"
                    label={t("password")}
                    type="password"
                    minLength={6}
                    value={password}
                    onChange={setPassword}
                    placeholder={t("passwordMinPlaceholder")}
                    icon={<LockKey size={18} className="text-zinc-400" />}
                  />
                  <AuthTextField
                    id="register-invitation-code"
                    label={t(invitationCodeRequired ? "inviteCodeRequired" : "inviteCode")}
                    type="text"
                    value={inviteCode}
                    onChange={setInviteCode}
                    placeholder={t(invitationCodeRequired ? "inviteRequiredPlaceholder" : "invitePlaceholder")}
                    icon={<ShieldCheck size={18} className="text-zinc-400" />}
                    required={invitationCodeRequired}
                  />
                  {!registrationEnabled ? (
                    <p role="alert" className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700">
                      {t("registrationClosed")}
                    </p>
                  ) : null}
                  <CaptchaChallenge
                    ref={captchaRef}
                    settings={settings}
                    onVerify={(proof) => {
                      setCaptchaProof(proof);
                      setError(null);
                    }}
                    onExpire={() => {
                      setCaptchaProof(null);
                      setError(translationMessage("auth:captchaExpired"));
                    }}
                    onInvalidate={() => setCaptchaProof(null)}
                    onError={() => {
                      setCaptchaProof(null);
                      setError(translationMessage("auth:captchaFailed"));
                    }}
                  />
                  <SubmitButton
                    loading={loading}
                    disabled={!registrationEnabled || !settingsLoaded || agreementRequired || captchaConfigurationInvalid || (turnstileRequired && !captchaProof)}
                  >
                    {!settingsLoaded ? t("loadingSettings") : emailVerifyEnabled ? t("sendVerificationCode") : t("registerAccount")}
                  </SubmitButton>
                </motion.form>
              ) : (
                <motion.form
                  key="register-code-form"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  onSubmit={handleRegister}
                  className="space-y-4"
                >
                  <div className="space-y-2">
                    <label
                      htmlFor="verification-code"
                      className="ml-1 text-[10px] font-bold uppercase tracking-widest text-zinc-400"
                    >
                      {t("verificationCode")}
                    </label>
                    <input
                      id="verification-code"
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      required
                      value={verifyCode}
                      onChange={(event) => setVerifyCode(event.target.value)}
                      placeholder="000000"
                      className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-center font-mono text-2xl tracking-[0.5em] outline-none transition-colors focus:border-zinc-900"
                    />
                  </div>
                  <SubmitButton loading={loading} disabled={agreementRequired}>{t("verifyCreateAccount")}</SubmitButton>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => {
                      if (!requestInFlightRef.current) setSent(false);
                    }}
                    className="w-full text-xs font-bold text-zinc-400 transition-colors hover:text-zinc-900 disabled:cursor-not-allowed"
                  >
                    {t("useDifferentEmail")}
                  </button>
                </motion.form>
              )}
            </AnimatePresence>

            {loginAgreementEnabled ? (
              <LoginAgreementPrompt
                accepted={agreementAccepted}
                documents={loginAgreementDocuments}
                mode={loginAgreementMode}
                open={agreementModalOpen}
                updatedAt={settings?.login_agreement_updated_at}
                onAccept={acceptAgreement}
                onReject={rejectAgreement}
                onOpen={() => setAgreementModalOpen(true)}
              />
            ) : null}

            {status ? <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{resolveLocalizedMessage(status)}</p> : null}
            {error ? <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{resolveLocalizedMessage(error)}</p> : null}

            {showOAuth ? (
              <>
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-zinc-100" />
                  </div>
                  <div className="relative flex justify-center text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                    <span className="bg-white px-2">{t("orContinueWith")}</span>
                  </div>
                </div>

                <div className={`grid gap-4 ${googleOAuthEnabled && githubOAuthEnabled ? "grid-cols-2" : "grid-cols-1"}`}>
                  {googleOAuthEnabled ? (
                    <button
                      type="button"
                      disabled={loading || agreementRequired}
                      onClick={() => void handleOAuthStart("google")}
                      className="flex items-center justify-center gap-2 rounded-xl border border-zinc-200 py-3 text-sm font-medium transition-all hover:bg-zinc-50 disabled:cursor-not-allowed"
                    >
                      <GoogleLogo size={20} weight="bold" />
                      Google
                    </button>
                  ) : null}
                  {githubOAuthEnabled ? (
                    <button
                      type="button"
                      disabled={loading || agreementRequired}
                      onClick={() => void handleOAuthStart("github")}
                      className="flex items-center justify-center gap-2 rounded-xl border border-zinc-200 py-3 text-sm font-medium transition-all hover:bg-zinc-50 disabled:cursor-not-allowed"
                    >
                      <GithubLogo size={20} weight="bold" />
                      GitHub
                    </button>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>

        </div>
      </div>
    </div>
  );
}

interface AuthTextFieldProps {
  id: string;
  label: string;
  type: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  icon: React.ReactNode;
  minLength?: number;
  required?: boolean;
}

function AuthTextField({ id, label, type, value, onChange, placeholder, icon, minLength, required = true }: AuthTextFieldProps) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="ml-1 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
        {label}
      </label>
      <div className="relative">
        <div className="absolute left-4 top-1/2 -translate-y-1/2">{icon}</div>
        <input
          id={id}
          type={type}
          required={required}
          minLength={minLength}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="w-full rounded-xl border border-zinc-200 bg-zinc-50 py-3 pl-12 pr-4 outline-none transition-colors focus:border-zinc-900"
        />
      </div>
    </div>
  );
}

function SubmitButton({ children, loading, disabled = false }: { children: React.ReactNode; loading: boolean; disabled?: boolean }) {
  const { t } = useTranslation("auth");
  return (
    <button
      type="submit"
      disabled={loading || disabled}
      className="group flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-900 py-3 font-bold text-white transition-all hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
    >
      {loading ? t("working") : children}
      {!loading ? <ArrowRight size={18} weight="bold" className="transition-transform group-hover:translate-x-1" /> : null}
    </button>
  );
}
