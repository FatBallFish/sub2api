import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  clearOAuthAffiliateCode,
  completeOAuthRegistration,
  createPendingOAuthAccount,
  exchangePendingOAuthCompletion,
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
import {
  captchaProofPayload,
  resolveCaptchaProvider,
  type CaptchaProof,
} from "../../components/auth/captcha";

type CallbackState = "processing" | "registration" | "error";

const EXISTING_ACCOUNT_MESSAGE = "This email already has an account. Return to sign in to continue.";

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

function providerLabel(provider: OAuthProvider) {
  return provider === "google" ? "Google" : "GitHub";
}

export default function OAuthCallback() {
  const navigate = useNavigate();
  const [state, setState] = useState<CallbackState>("processing");
  const [message, setMessage] = useState("Completing sign in...");
  const [status, setStatus] = useState<string | null>(null);
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
  const captchaRef = useRef<CaptchaChallengeHandle>(null);
  const requestInFlightRef = useRef(false);

  const emailVerifyEnabled = settings?.email_verify_enabled !== false;
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

  useEffect(() => {
    let active = true;

    function finishWithTokens(tokens: AuthResponse, redirect: string) {
      if (!active) return;
      persistAuth(tokens);
      clearOAuthAffiliateCode();
      navigate(sanitizeRedirectPath(redirect), { replace: true });
    }

    async function run() {
      const params = parseFragmentParams();
      const fragmentError = params.get("error");
      if (fragmentError) {
        setMessage(params.get("error_description") || params.get("error_message") || fragmentError);
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

        const pendingProvider = completion.provider === "github" ? "github" : "google";
        const resolvedEmail = (completion.resolved_email || completion.email || "").trim();
        const registrationRequired = completion.error === "invitation_required"
          || completion.error === "registration_completion_required";
        if (!active) return;
        if (registrationRequired && !resolvedEmail) {
          setMessage("OAuth email address is unavailable. Return to sign in and try again.");
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
          if (!active) return;
          setSettings(publicSettings);
          setMessage("");
          setState("registration");
          return;
        }

        setMessage(completion.error || "OAuth callback could not be completed.");
        setState("error");
      } catch (error) {
        if (!active) return;
        setMessage(error instanceof Error ? error.message : "OAuth callback could not be completed.");
        setState("error");
      }
    }

    void run();

    return () => {
      active = false;
    };
  }, [navigate]);

  function showExistingAccountError() {
    setStatus(null);
    setMessage(EXISTING_ACCOUNT_MESSAGE);
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
      setMessage("Security verification is misconfigured. Please contact support.");
      return;
    }
    if (turnstileRequired && !captchaProof) {
      setMessage("Complete the security verification before continuing.");
      return;
    }

    requestInFlightRef.current = true;
    setSendingCode(true);
    setMessage("");
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
      setStatus("Code sent. Check your inbox.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to send verification code.");
    } finally {
      if (captchaRequired) resetCaptcha();
      requestInFlightRef.current = false;
      setSendingCode(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestInFlightRef.current || !canSubmit) return;
    if (emailVerifyEnabled && captchaConfigurationInvalid) {
      setMessage("Security verification is misconfigured. Please contact support.");
      return;
    }
    if (emailVerifyEnabled && turnstileRequired && !captchaProof) {
      setMessage("Complete the security verification before continuing.");
      return;
    }
    requestInFlightRef.current = true;
    setSubmitting(true);
    setMessage("");
    setStatus(null);
    try {
      if (!emailVerifyEnabled) {
        const response = await completeOAuthRegistration({
          provider,
          password,
          invitation_code: inviteCode.trim() || undefined,
        });
        if (!isAuthResponse(response)) {
          setMessage("Unable to complete signup.");
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
          setMessage("Unable to complete signup.");
          return;
        }
      }
      clearOAuthAffiliateCode();
      navigate(redirectTo, { replace: true });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to complete signup.");
      setState("registration");
    } finally {
      if (emailVerifyEnabled && captchaRequired) resetCaptcha();
      requestInFlightRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-6 py-12">
      <section className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-8 shadow-sm">
        {state === "processing" ? (
          <div className="text-center">
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-950" />
            <h1 className="mt-5 text-xl font-semibold text-zinc-950">Completing sign in</h1>
            <p className="mt-2 text-sm text-zinc-500">{message}</p>
          </div>
        ) : null}

        {state === "error" ? (
          <div className="text-center">
            <h1 className="text-xl font-semibold text-zinc-950">Sign in failed</h1>
            <p role="alert" className="mt-3 text-sm leading-6 text-zinc-500">{message}</p>
            <Link
              className="mt-6 inline-flex h-11 items-center justify-center rounded-md bg-zinc-950 px-5 text-sm font-semibold text-white"
              to="/login"
            >
              Back to sign in
            </Link>
          </div>
        ) : null}

        {state === "registration" ? (
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-400">
                {providerLabel(provider)} OAuth
              </p>
              <h1 className="mt-2 text-xl font-semibold text-zinc-950">Complete {providerLabel(provider)} signup</h1>
              <p className="mt-2 text-sm leading-6 text-zinc-500">
                Create a password to finish setting up this account.
              </p>
            </div>

            <label className="block text-sm font-medium text-zinc-700">
              Email Address
              <input
                className="mt-2 h-11 w-full rounded-md border border-zinc-200 bg-zinc-100 px-3 text-sm text-zinc-500 outline-none"
                readOnly
                value={email}
              />
            </label>
            <label className="block text-sm font-medium text-zinc-700">
              Password
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
              Confirm Password
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
                Invite Code
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
                    setMessage("");
                  }}
                  onExpire={() => {
                    setCaptchaProof(null);
                    setMessage("Security verification expired. Please verify again.");
                  }}
                  onError={() => {
                    setCaptchaProof(null);
                    setMessage("Security verification failed. Please try again.");
                  }}
                />
                <button
                  className="h-11 w-full rounded-md border border-zinc-300 bg-white text-sm font-semibold text-zinc-900 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400"
                  disabled={busy || countdown > 0 || captchaConfigurationInvalid || (turnstileRequired && !captchaProof)}
                  onClick={() => void handleSendCode()}
                  type="button"
                >
                  {sendingCode
                    ? "Sending..."
                    : countdown > 0
                      ? `Resend in ${countdown}s`
                      : "Send verification code"}
                </button>
                <label className="block text-sm font-medium text-zinc-700">
                  Verification Code
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
            {message ? <p role="alert" className="text-sm text-red-600">{message}</p> : null}
            {status ? <p role="status" className="text-sm text-emerald-700">{status}</p> : null}
            <button
              className="h-11 w-full rounded-md bg-zinc-950 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
              disabled={!canSubmit || busy || (emailVerifyEnabled && (captchaConfigurationInvalid || (turnstileRequired && !captchaProof)))}
              type="submit"
            >
              {submitting ? "Completing..." : "Complete signup"}
            </button>
          </form>
        ) : null}
      </section>
    </main>
  );
}
