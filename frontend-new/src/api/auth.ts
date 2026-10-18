import { getJSON, postJSON, putJSON } from "./client";
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

export type OAuthProvider = "google" | "github" | "oidc" | "oidc-console";

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

/**
 * 拉取当前用户并写入 auth_user。OAuth 各成功路径（fragment 直发 token、
 * pending session exchange、bind-login）的响应只带 token 不带 user，而
 * isAuthenticated() 要求 auth_token 与 auth_user 同时存在——缺了 user 会出现
 * 「控制台进得去、首页却显示未登录」的分裂状态。登录落地后必须补齐。
 */
export async function syncAuthUserProfile(): Promise<AuthUser | null> {
  try {
    const user = await getJSON<AuthUser>("/auth/me");
    if (user && typeof user.id === "number" && typeof user.email === "string" && user.email) {
      localStorage.setItem("auth_user", JSON.stringify(user));
      return user;
    }
  } catch {
    // token 本身已有效（控制台可用）；profile 拉取失败不阻塞登录流程。
  }
  return null;
}

/** persistAuth 之后，若响应未携带 user 则拉 /auth/me 补齐，保证登录态完整。 */
export async function persistAuthWithUserProfile(response: AuthResponse) {
  persistAuth(response);
  if (response.user || response.requires_2fa) return;
  await syncAuthUserProfile();
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
    await persistAuthWithUserProfile(response);
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

export interface StartOAuthOptions {
  /** 静默登录：IdP 无会话时直接返回 login_required 而非弹登录框。 */
  prompt?: "none";
  /** 静默登录失败后的回退页（同源相对路径）。 */
  fallback?: string;
}

export function startOAuth(
  provider: OAuthProvider,
  redirect = "/console",
  affiliateCode?: string,
  proof?: CaptchaProof | null,
  options?: StartOAuthOptions,
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
  if (options?.prompt) {
    params.set("prompt", options.prompt);
  }
  if (options?.fallback) {
    params.set("fallback", options.fallback);
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
  /** "pending_session"=需继续交互；"identity_bound"=已登录用户的绑定已完成（无 token pair）。 */
  auth_result?: string;
  provider?: OAuthProvider;
  redirect?: string;
  email?: string;
  resolved_email?: string;
  invitation_required?: boolean;
  step?: string;
  compat_email?: string;
  pending_email?: string;
  suggested_email?: string;
  email_verification_required?: boolean;
  create_account_allowed?: boolean;
  existing_account_email?: string;
  existing_account_bindable?: boolean;
  requires_2fa?: boolean;
  temp_token?: string;
  user_email_masked?: string;
  adoption_required?: boolean;
  suggested_display_name?: string;
  suggested_avatar_url?: string;
}

export interface PendingOAuthBindLoginRequest {
  email: string;
  password: string;
}

export interface CompleteOAuthRegistrationRequest {
  provider: OAuthProvider;
  password: string;
  invitation_code?: string;
}

/** OAuth 资料采用决定：是否把上游昵称/头像写入本账号资料（交换时随请求提交）。 */
export interface OAuthAdoptionDecision {
  adopt_display_name?: boolean;
  adopt_avatar?: boolean;
}

export function exchangePendingOAuthCompletion(decision?: OAuthAdoptionDecision) {
  return postJSON<PendingOAuthCompletion>("/auth/oauth/pending/exchange", decision ?? {});
}

// Binds the pending OAuth identity to an existing local account by signing in
// with its email + password. Provider-agnostic: the pending browser session
// cookie carries the OAuth context.
export function pendingOAuthBindLogin(request: PendingOAuthBindLoginRequest) {
  return postJSON<PendingOAuthCompletion>("/auth/oauth/pending/bind-login", request);
}

export function completeOAuthRegistration(request: CompleteOAuthRegistrationRequest) {
  const { provider, ...body } = request;
  return postJSON<AuthResponse>(`/auth/oauth/${provider}/complete-registration`, body);
}

export interface ForgotPasswordRequest {
  email: string;
  turnstile_token?: string;
}

export function forgotPassword(request: ForgotPasswordRequest) {
  return postJSON<{ message: string }>("/auth/forgot-password", request);
}

export interface ResetPasswordRequest {
  email: string;
  token: string;
  new_password: string;
}

export function resetPassword(request: ResetPasswordRequest) {
  return postJSON<{ message: string }>("/auth/reset-password", request);
}

export function changePassword(request: { old_password?: string; new_password: string }) {
  return putJSON<{ message: string }>("/user/password", request);
}
