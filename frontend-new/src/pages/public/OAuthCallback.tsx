import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  completeOAuthRegistration,
  exchangePendingOAuthCompletion,
  persistAuth,
  type AuthResponse,
  type OAuthProvider,
  type PendingOAuthCompletion,
} from "../../api/auth";

type CallbackState = "processing" | "registration" | "error";

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
  if (decoded.includes("://") || decoded.includes("\n") || decoded.includes("\r")) return "/console";
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

function providerLabel(provider: OAuthProvider) {
  return provider === "google" ? "Google" : "GitHub";
}

export default function OAuthCallback() {
  const navigate = useNavigate();
  const [state, setState] = useState<CallbackState>("processing");
  const [message, setMessage] = useState("Completing sign in...");
  const [provider, setProvider] = useState<OAuthProvider>("google");
  const [redirectTo, setRedirectTo] = useState("/console");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [invitationRequired, setInvitationRequired] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = useMemo(() => {
    if (password.length < 6 || password !== confirmPassword) return false;
    if (invitationRequired && !inviteCode.trim()) return false;
    return true;
  }, [confirmPassword, invitationRequired, inviteCode, password]);

  useEffect(() => {
    let active = true;

    async function finishWithTokens(tokens: AuthResponse, redirect: string) {
      persistAuth(tokens);
      if (!active) return;
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
        await finishWithTokens(tokenResponse, params.get("redirect") || "/console");
        return;
      }

      try {
        const completion = await exchangePendingOAuthCompletion();
        if (isTokenCompletion(completion)) {
          await finishWithTokens(completion, completion.redirect || "/console");
          return;
        }

        const pendingProvider = completion.provider === "github" ? "github" : "google";
        if (!active) return;
        setProvider(pendingProvider);
        setRedirectTo(sanitizeRedirectPath(completion.redirect || "/console"));
        setEmail((completion.resolved_email || completion.email || "").trim());
        setInvitationRequired(completion.error === "invitation_required" || completion.invitation_required === true);
        if (completion.error === "invitation_required" || completion.error === "registration_completion_required") {
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setMessage("");
    try {
      const response = await completeOAuthRegistration({
        provider,
        password,
        invitation_code: inviteCode.trim() || undefined,
      });
      persistAuth(response);
      navigate(redirectTo, { replace: true });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to complete signup.");
      setState("registration");
    } finally {
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
            <p className="mt-3 text-sm leading-6 text-zinc-500">{message}</p>
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
                  onChange={(event) => setInviteCode(event.target.value)}
                  value={inviteCode}
                />
              </label>
            ) : null}
            {message ? <p className="text-sm text-red-600">{message}</p> : null}
            <button
              className="h-11 w-full rounded-md bg-zinc-950 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
              disabled={!canSubmit || submitting}
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
