import { postJSON } from "./client";

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

export interface LoginRequest {
  email: string;
  password: string;
  turnstile_token?: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  verify_code?: string;
  turnstile_token?: string;
  promo_code?: string;
  invitation_code?: string;
  aff_code?: string;
}

export interface SendVerifyCodeResponse {
  message: string;
  countdown: number;
}

export type OAuthProvider = "google" | "github";

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

export function sendVerifyCode(email: string, turnstileToken?: string) {
  return postJSON<SendVerifyCodeResponse>("/auth/send-verify-code", {
    email,
    turnstile_token: turnstileToken,
  });
}

export function startOAuth(provider: OAuthProvider, redirect = "/console") {
  const params = new URLSearchParams({ redirect });
  window.location.href = `/api/v1/auth/oauth/${provider}/start?${params.toString()}`;
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
