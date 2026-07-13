import React, { useEffect, useState } from "react";
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
import { login, register, sendVerifyCode, startOAuth } from "../../api/auth";
import { getPublicSettings, type PublicSettings } from "../../api/settings";
import { isAuthenticated } from "../../utils/authStorage";

type AuthMode = "login" | "register";

function getQueryValue(search: string, key: string) {
  return new URLSearchParams(search).get(key) || undefined;
}

export default function Auth() {
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
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const settingsLoaded = settings !== null;
  const emailVerifyEnabled = settings?.email_verify_enabled !== false;
  const registrationEnabled = settings?.registration_enabled !== false;
  const invitationCodeRequired = settings?.invitation_code_enabled === true;
  const googleOAuthEnabled = settings?.google_oauth_enabled === true;
  const githubOAuthEnabled = settings?.github_oauth_enabled === true;
  const showOAuth = googleOAuthEnabled || githubOAuthEnabled;

  useEffect(() => {
    if (isAuthenticated()) {
      navigate(redirectTo, { replace: true });
      return;
    }

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
  }, [navigate, redirectTo]);

  if (isAuthenticated()) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white text-sm font-medium text-zinc-500">
        Redirecting to console...
      </div>
    );
  }

  const title = mode === "login" ? "Sign in to Gateway" : sent ? "Check your email" : "Create your account";
  const subtitle = mode === "login"
    ? "Use your email and password to access your console."
    : sent
      ? `We've sent a verification code to ${email}.`
      : emailVerifyEnabled
        ? "Create an account with email verification."
        : "Create an account to start using the console.";

  const switchMode = (nextMode: AuthMode) => {
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
    setLoading(true);
    setError(null);
    try {
      const response = await login({ email, password });
      if (response.requires_2fa) {
        setError("Two-factor authentication is enabled. Please use the classic console login for now.");
        return;
      }
      finishAuth();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to sign in.");
    } finally {
      setLoading(false);
    }
  };

  const handleSendCode = async (event: React.FormEvent) => {
    event.preventDefault();
    if (invitationCodeRequired && !inviteCode.trim()) {
      setError("Invitation code is required.");
      return;
    }
    if (!emailVerifyEnabled) {
      await handleRegister(event);
      return;
    }
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      await sendVerifyCode(email);
      setSent(true);
      setStatus("Code sent. Check your inbox.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to send verification code.");
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedInviteCode = inviteCode.trim();
    if (invitationCodeRequired && !normalizedInviteCode) {
      setError("Invitation code is required.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const payload = {
        email,
        password,
        ...(emailVerifyEnabled ? { verify_code: verifyCode } : {}),
        ...(normalizedInviteCode && (invitationCodeRequired || initialInviteCodeKind === "invitation") ? { invitation_code: normalizedInviteCode } : {}),
        ...(normalizedInviteCode && !invitationCodeRequired && initialInviteCodeKind !== "invitation" ? { aff_code: normalizedInviteCode } : {}),
        ...(promoCode ? { promo_code: promoCode } : {}),
      };
      await register(payload);
      finishAuth();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create account.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-white selection:bg-zinc-900 selection:text-white">
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
              Build with the <br />
              <span className="text-zinc-500">best AI models.</span>
            </h2>
            <p className="max-w-md text-lg leading-relaxed text-zinc-400">
              Connect your favorite coding clients to a single, high-performance gateway.
              Transparent billing, enterprise-grade reliability.
            </p>
          </div>

          <div className="space-y-8">
            {[
              { icon: Cpu, title: "Universal Access", desc: "One key for Codex, Claude, and Gemini." },
              { icon: ShieldCheck, title: "Secure & Encrypted", desc: "AES-256 encryption for all credentials." },
              { icon: Globe, title: "Global Infrastructure", desc: "Low-latency routing across US, EU, and Asia." },
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
          &copy; 2026 Gateway Labs Inc. All rights reserved.
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
              onClick={() => switchMode("login")}
              className={`rounded-lg py-2 transition-colors ${mode === "login" ? "bg-white text-zinc-950 shadow-sm" : "text-zinc-500"}`}
            >
              Login
            </button>
            <button
              type="button"
              onClick={() => switchMode("register")}
              className={`rounded-lg py-2 transition-colors ${mode === "register" ? "bg-white text-zinc-950 shadow-sm" : "text-zinc-500"}`}
            >
              Create account
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
                    label="Email Address"
                    type="email"
                    value={email}
                    onChange={setEmail}
                    placeholder="name@company.com"
                    icon={<Envelope size={18} className="text-zinc-400" />}
                  />
                  <AuthTextField
                    id="login-password"
                    label="Password"
                    type="password"
                    value={password}
                    onChange={setPassword}
                    placeholder="Your password"
                    icon={<LockKey size={18} className="text-zinc-400" />}
                  />
                  <SubmitButton loading={loading}>Sign in</SubmitButton>
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
                    label="Email Address"
                    type="email"
                    value={email}
                    onChange={setEmail}
                    placeholder="name@company.com"
                    icon={<Envelope size={18} className="text-zinc-400" />}
                  />
                  <AuthTextField
                    id="register-password"
                    label="Password"
                    type="password"
                    minLength={6}
                    value={password}
                    onChange={setPassword}
                    placeholder="At least 6 characters"
                    icon={<LockKey size={18} className="text-zinc-400" />}
                  />
                  <AuthTextField
                    id="register-invitation-code"
                    label={invitationCodeRequired ? "Invite Code (required)" : "Invite Code"}
                    type="text"
                    value={inviteCode}
                    onChange={setInviteCode}
                    placeholder={invitationCodeRequired ? "Enter your invite code" : "Optional invite code"}
                    icon={<ShieldCheck size={18} className="text-zinc-400" />}
                    required={invitationCodeRequired}
                  />
                  {!registrationEnabled ? (
                    <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700">
                      Registration is currently closed.
                    </p>
                  ) : null}
                  <SubmitButton loading={loading} disabled={!registrationEnabled || !settingsLoaded}>
                    {!settingsLoaded ? "Loading settings..." : emailVerifyEnabled ? "Send verification code" : "Register account"}
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
                      Verification Code
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
                  <SubmitButton loading={loading}>Verify & Create Account</SubmitButton>
                  <button
                    type="button"
                    onClick={() => setSent(false)}
                    className="w-full text-xs font-bold text-zinc-400 transition-colors hover:text-zinc-900"
                  >
                    Use a different email
                  </button>
                </motion.form>
              )}
            </AnimatePresence>

            {status ? <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{status}</p> : null}
            {error ? <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</p> : null}

            {showOAuth ? (
              <>
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-zinc-100" />
                  </div>
                  <div className="relative flex justify-center text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                    <span className="bg-white px-2">Or continue with</span>
                  </div>
                </div>

                <div className={`grid gap-4 ${googleOAuthEnabled && githubOAuthEnabled ? "grid-cols-2" : "grid-cols-1"}`}>
                  {googleOAuthEnabled ? (
                    <button
                      type="button"
                      onClick={() => startOAuth("google", redirectTo)}
                      className="flex items-center justify-center gap-2 rounded-xl border border-zinc-200 py-3 text-sm font-medium transition-all hover:bg-zinc-50"
                    >
                      <GoogleLogo size={20} weight="bold" />
                      Google
                    </button>
                  ) : null}
                  {githubOAuthEnabled ? (
                    <button
                      type="button"
                      onClick={() => startOAuth("github", redirectTo)}
                      className="flex items-center justify-center gap-2 rounded-xl border border-zinc-200 py-3 text-sm font-medium transition-all hover:bg-zinc-50"
                    >
                      <GithubLogo size={20} weight="bold" />
                      GitHub
                    </button>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>

          <p className="px-4 text-center text-xs leading-relaxed text-zinc-400">
            By continuing, you agree to our{" "}
            <Link to="/terms" className="font-bold text-zinc-900 underline underline-offset-4">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link to="/privacy" className="font-bold text-zinc-900 underline underline-offset-4">
              Privacy Policy
            </Link>
            .
          </p>
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
  return (
    <button
      type="submit"
      disabled={loading || disabled}
      className="group flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-900 py-3 font-bold text-white transition-all hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
    >
      {loading ? "Working..." : children}
      {!loading ? <ArrowRight size={18} weight="bold" className="transition-transform group-hover:translate-x-1" /> : null}
    </button>
  );
}
