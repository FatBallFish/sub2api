import { postJSON } from "./client";
import {
  captchaProofPayload,
  type CaptchaProof,
  type CaptchaProofPayload,
} from "../components/auth/captcha";

export interface AuthUser {
  id: number;
  email: string;
  username?: string;
  role?: string;
  status?: string;
}

export interface AuthResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  user?: AuthUser;
  requires_2fa?: boolean;
  temp_token?: string;
  user_email_masked?: string;
}

export interface LoginRequest extends CaptchaProofPayload {
  email: string;
  password: string;
}

export interface RegisterRequest extends CaptchaProofPayload {
  email: string;
  password: string;
  verify_code?: string;
  promo_code?: string;
  invitation_code?: string;
  aff_code?: string;
}

export interface SendVerifyCodeResponse {
  message: string;
  countdown: number;
}

export interface CreatePendingOAuthAccountRequest extends CaptchaProofPayload {
  email: string;
  password: string;
  verify_code?: string;
  invitation_code?: string;
  aff_code?: string;
}

export interface PendingOAuthSessionStatus {
  auth_result: "pending_session";
  provider?: string;
  intent?: string;
  step?: string;
  error?: string;
  redirect?: string;
  email?: string;
  resolved_email?: string;
  invitation_required?: boolean;
  adoption_required?: boolean;
  force_email_on_signup?: boolean;
  email_binding_required?: boolean;
  existing_account_bindable?: boolean;
  requires_email_completion?: boolean;
  email_verification_required?: boolean;
  suggested_display_name?: string;
  suggested_avatar_url?: string;
  choice_reason?: string;
}

export type OAuthProvider = "google" | "github";

const OAUTH_AFFILIATE_CODE_STORAGE_KEY = "oauth_aff_code";

function normalizeOAuthAffiliateCode(value?: string | null) {
  return value?.trim() || "";
}

export function persistAuth(response: AuthResponse) {
  if (response.requires_2fa) return;

  localStorage.setItem("auth_token", response.access_token);
  if (response.refresh_token) {
    localStorage.setItem("refresh_token", response.refresh_token);
  }
  if (response.expires_in) {
    localStorage.setItem("token_expires_at", String(Date.now() + response.expires_in * 1000));
  }
  if (response.user) {
    localStorage.setItem("auth_user", JSON.stringify(response.user));
  }
}

export async function login(request: LoginRequest) {
  const response = await postJSON<AuthResponse>("/auth/login", request);
  persistAuth(response);
  return response;
}

export async function register(request: RegisterRequest) {
  const response = await postJSON<AuthResponse>("/auth/register", request);
  persistAuth(response);
  return response;
}

type CaptchaProofInput = CaptchaProof | string | null | undefined;

function normalizeCaptchaProof(proof: CaptchaProofInput): CaptchaProof | null {
  if (typeof proof === "string") {
    return proof ? { provider: "turnstile", token: proof } : null;
  }
  return proof ?? null;
}

export function sendVerifyCode(email: string, proof?: CaptchaProofInput) {
  return postJSON<SendVerifyCodeResponse>("/auth/send-verify-code", {
    email,
    ...captchaProofPayload(normalizeCaptchaProof(proof)),
  });
}

export function sendPendingOAuthVerifyCode(email: string, proof?: CaptchaProofInput) {
  return postJSON<SendVerifyCodeResponse | PendingOAuthSessionStatus>(
    "/auth/oauth/pending/send-verify-code",
    {
      email,
      ...captchaProofPayload(normalizeCaptchaProof(proof)),
    },
  );
}

export function isAuthResponse(
  response: AuthResponse | PendingOAuthSessionStatus,
): response is AuthResponse {
  return "access_token" in response && response.access_token.trim().length > 0;
}

export async function createPendingOAuthAccount(
  request: CreatePendingOAuthAccountRequest,
): Promise<AuthResponse | PendingOAuthSessionStatus> {
  const response = await postJSON<AuthResponse | PendingOAuthSessionStatus>(
    "/auth/oauth/pending/create-account",
    request,
  );
  if (isAuthResponse(response)) {
    persistAuth(response);
  }
  return response;
}

export function readOAuthAffiliateCode() {
  try {
    return normalizeOAuthAffiliateCode(window.sessionStorage.getItem(OAUTH_AFFILIATE_CODE_STORAGE_KEY));
  } catch {
    return "";
  }
}

export function clearOAuthAffiliateCode() {
  try {
    window.sessionStorage.removeItem(OAUTH_AFFILIATE_CODE_STORAGE_KEY);
  } catch {
    // Storage may be unavailable in privacy-restricted browser contexts.
  }
}

export function startOAuth(
  provider: OAuthProvider,
  redirect = "/console",
  affiliateCode?: string,
  proof?: CaptchaProof | null,
) {
  const params = new URLSearchParams({ redirect });
  const trimmedAffiliateCode = normalizeOAuthAffiliateCode(affiliateCode);
  clearOAuthAffiliateCode();
  if (trimmedAffiliateCode) {
    try {
      window.sessionStorage.setItem(OAUTH_AFFILIATE_CODE_STORAGE_KEY, trimmedAffiliateCode);
    } catch {
      // OAuth must still proceed when session storage is unavailable.
    }
  }
  if (trimmedAffiliateCode) {
    params.set("aff_code", trimmedAffiliateCode);
  }
  const startPath = `/auth/oauth/${provider}/start?${params.toString()}`;
  if (proof) {
    return postJSON<{ authorize_url: string }>(startPath, captchaProofPayload(proof)).then((response) => {
      window.location.href = response.authorize_url;
    });
  }
  window.location.href = `/api/v1${startPath}`;
}

export interface PendingOAuthCompletion extends Partial<AuthResponse> {
  error?: string;
  provider?: OAuthProvider;
  redirect?: string;
  email?: string;
  resolved_email?: string;
  invitation_required?: boolean;
}

export interface CompleteOAuthRegistrationRequest {
  provider: OAuthProvider;
  password: string;
  invitation_code?: string;
}

export function exchangePendingOAuthCompletion() {
  return postJSON<PendingOAuthCompletion>("/auth/oauth/pending/exchange", {});
}

export function completeOAuthRegistration(request: CompleteOAuthRegistrationRequest) {
  const { provider, ...body } = request;
  return postJSON<AuthResponse>(`/auth/oauth/${provider}/complete-registration`, body);
}
