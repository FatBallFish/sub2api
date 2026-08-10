import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { PublicSettings } from "../../api/settings";
import AliyunCaptchaWidget, { type AliyunCaptchaWidgetHandle } from "./AliyunCaptchaWidget";
import TencentCaptchaWidget, { type TencentCaptchaWidgetHandle } from "./TencentCaptchaWidget";
import TurnstileWidget, { type TurnstileWidgetHandle } from "./TurnstileWidget";
import {
  resolveCaptchaProvider,
  type CaptchaProof,
  type CaptchaProviderConfig,
} from "./captcha";

export interface CaptchaChallengeHandle {
  verify(): Promise<CaptchaProof | null>;
  reset(): void;
}

export interface CaptchaChallengeProps {
  settings: PublicSettings | null;
  onVerify: (proof: CaptchaProof) => void;
  onExpire?: () => void;
  onError?: (error: Error) => void;
}

const CaptchaChallenge = forwardRef<CaptchaChallengeHandle, CaptchaChallengeProps>(
  function CaptchaChallenge({ settings, onVerify, onExpire, onError }, ref) {
    const { t } = useTranslation("auth");
    let config: CaptchaProviderConfig = null;
    let configurationErrorMessage: string | null = null;
    try {
      config = resolveCaptchaProvider(settings);
    } catch {
      configurationErrorMessage = t("captcha.misconfigured");
    }

    const turnstileRef = useRef<TurnstileWidgetHandle>(null);
    const tencentRef = useRef<TencentCaptchaWidgetHandle>(null);
    const aliyunRef = useRef<AliyunCaptchaWidgetHandle>(null);
    const proofRef = useRef<CaptchaProof | null>(null);
    const onVerifyRef = useRef(onVerify);
    const onExpireRef = useRef(onExpire);
    const onErrorRef = useRef(onError);
    onVerifyRef.current = onVerify;
    onExpireRef.current = onExpire;
    onErrorRef.current = onError;

    function acceptProof(proof: CaptchaProof) {
      proofRef.current = proof;
      onVerifyRef.current(proof);
    }

    function reset() {
      proofRef.current = null;
      turnstileRef.current?.reset();
      tencentRef.current?.reset();
      aliyunRef.current?.reset();
    }

    async function verify() {
      if (!config || configurationErrorMessage) return null;
      if (config.provider === "turnstile") return proofRef.current;
      try {
        const proof = config.provider === "tencent"
          ? await tencentRef.current?.verify() ?? null
          : await aliyunRef.current?.verify() ?? null;
        if (proof && proofRef.current !== proof) acceptProof(proof);
        return proof;
      } catch (error) {
        onErrorRef.current?.(normalizeVerificationError(error, t("captchaFailed")));
        return null;
      }
    }

    useImperativeHandle(ref, () => ({ verify, reset }));

    useEffect(() => {
      proofRef.current = null;
    }, [config?.provider]);

    useEffect(() => {
      if (configurationErrorMessage) onErrorRef.current?.(new Error(configurationErrorMessage));
    }, [configurationErrorMessage]);

    if (configurationErrorMessage) {
      return <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{t("captcha.misconfigured")}</p>;
    }
    if (!config) return null;
    if (config.provider === "turnstile") {
      return <TurnstileWidget
        ref={turnstileRef}
        siteKey={config.siteKey}
        onVerify={(token) => acceptProof({ provider: "turnstile", token })}
        onExpire={() => {
          proofRef.current = null;
          onExpireRef.current?.();
        }}
        onError={(error) => {
          proofRef.current = null;
          onErrorRef.current?.(normalizeVerificationError(error, t("captchaFailed")));
        }}
      />;
    }
    if (config.provider === "tencent") {
      return <TencentCaptchaWidget ref={tencentRef} appId={config.appId} />;
    }
    return <AliyunCaptchaWidget
      ref={aliyunRef}
      sceneId={config.sceneId}
      prefix={config.prefix}
      region={config.region}
      onVerify={acceptProof}
      onError={(error) => onErrorRef.current?.(error)}
    />;
  },
);

export default CaptchaChallenge;

function normalizeVerificationError(error: unknown, fallback: string) {
  if (error instanceof Error) return error;
  if (typeof error === "string" && error.trim()) return new Error(error);
  return new Error(fallback);
}
