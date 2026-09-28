import type { PublicSettings } from "../../api/settings";

export type CaptchaProof =
  | { provider: "turnstile" | "aliyun"; token: string }
  | { provider: "tencent"; ticket: string; randstr: string };

export interface CaptchaProofPayload {
  turnstile_token?: string;
  tencent_captcha_ticket?: string;
  tencent_captcha_randstr?: string;
}

export type CaptchaProviderConfig =
  | { provider: "turnstile"; siteKey: string }
  | { provider: "tencent"; appId: string }
  | { provider: "aliyun"; sceneId: string; prefix: string; region: "cn" | "sgp" }
  | null;

export function resolveCaptchaProvider(settings: PublicSettings | null): CaptchaProviderConfig {
  if (!settings) return null;
  const enabled = [
    settings.turnstile_enabled === true,
    settings.tencent_captcha_enabled === true,
    settings.aliyun_captcha_enabled === true,
  ].filter(Boolean).length;
  if (enabled > 1) throw new Error("Multiple captcha providers are enabled");

  if (settings.turnstile_enabled) {
    const siteKey = settings.turnstile_site_key?.trim() || "";
    if (!siteKey) throw new Error("Turnstile configuration is incomplete");
    return { provider: "turnstile", siteKey };
  }
  if (settings.tencent_captcha_enabled) {
    const appId = settings.tencent_captcha_app_id?.trim() || "";
    if (!appId) throw new Error("Tencent captcha configuration is incomplete");
    return { provider: "tencent", appId };
  }
  if (settings.aliyun_captcha_enabled) {
    const sceneId = settings.aliyun_captcha_scene_id?.trim() || "";
    const prefix = settings.aliyun_captcha_prefix?.trim() || "";
    if (!sceneId || !prefix) throw new Error("Aliyun captcha configuration is incomplete");
    return {
      provider: "aliyun",
      sceneId,
      prefix,
      region: settings.aliyun_captcha_region === "sgp" ? "sgp" : "cn",
    };
  }
  return null;
}

export function captchaProofPayload(proof: CaptchaProof | null | undefined): CaptchaProofPayload {
  if (!proof) return {};
  if (proof.provider === "tencent") {
    return {
      tencent_captcha_ticket: proof.ticket,
      tencent_captcha_randstr: proof.randstr,
    };
  }
  return { turnstile_token: proof.token };
}
