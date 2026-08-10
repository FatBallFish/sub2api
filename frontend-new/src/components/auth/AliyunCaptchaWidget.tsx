import { CheckCircle, ShieldCheck, SpinnerGap } from "@phosphor-icons/react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CaptchaProof } from "./captcha";

const ALIYUN_SCRIPT_ID = "aliyun-captcha-script";
const ALIYUN_SCRIPT_URL = "https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js";
const POPUP_ID = "aliyunCaptcha-window-popup";
const MASK_ID = "aliyunCaptcha-mask";
const POPUP_OPEN_TIMEOUT_MS = 8000;
const POPUP_WATCH_INTERVAL_MS = 300;

interface AliyunCaptchaInitOptions {
  SceneId: string;
  prefix: string;
  mode: "popup";
  element: string;
  button: string;
  captchaVerifyCallback: (captchaVerifyParam: string) => { captchaResult: boolean };
  onBizResultCallback: (bizResult: boolean) => void;
  getInstance: (instance: unknown) => void;
  slideStyle: { width: number; height: number };
  language: "cn" | "en";
}

declare global {
  interface Window {
    initAliyunCaptcha?: (options: AliyunCaptchaInitOptions) => void;
    AliyunCaptchaConfig?: { region: string; prefix: string };
  }
}

export interface AliyunCaptchaWidgetHandle {
  verify(): Promise<CaptchaProof | null>;
  reset(): void;
}

export interface AliyunCaptchaWidgetProps {
  sceneId: string;
  prefix: string;
  region?: "cn" | "sgp";
  onVerify?: (proof: CaptchaProof) => void;
  onError?: (error: Error) => void;
}

type VerificationState = "idle" | "verifying" | "verified";

let scriptLoadingPromise: Promise<void> | null = null;
let widgetSequence = 0;

function loadAliyunCaptcha(): Promise<void> {
  if (window.initAliyunCaptcha) return Promise.resolve();
  if (scriptLoadingPromise) return scriptLoadingPromise;

  const pending = new Promise<void>((resolve, reject) => {
    const existingElement = document.getElementById(ALIYUN_SCRIPT_ID);
    if (existingElement && !(existingElement instanceof HTMLScriptElement)) {
      reject(new Error("Aliyun Captcha script ID is already used by another element."));
      return;
    }
    const script = existingElement ?? document.createElement("script");
    const removeListeners = () => {
      script.removeEventListener("load", handleLoad);
      script.removeEventListener("error", handleError);
    };
    const handleLoad = () => {
      removeListeners();
      if (window.initAliyunCaptcha) resolve();
      else reject(new Error("Aliyun Captcha SDK is unavailable"));
    };
    const handleError = () => {
      removeListeners();
      reject(new Error("Failed to load Aliyun Captcha SDK"));
    };
    script.addEventListener("load", handleLoad);
    script.addEventListener("error", handleError);
    if (!existingElement) {
      script.id = ALIYUN_SCRIPT_ID;
      script.src = ALIYUN_SCRIPT_URL;
      script.async = true;
      document.head.appendChild(script);
    }
  });

  scriptLoadingPromise = pending.catch((error: unknown) => {
    scriptLoadingPromise = null;
    document.getElementById(ALIYUN_SCRIPT_ID)?.remove();
    throw error;
  });
  return scriptLoadingPromise;
}

const AliyunCaptchaWidget = forwardRef<AliyunCaptchaWidgetHandle, AliyunCaptchaWidgetProps>(
  function AliyunCaptchaWidget(
    { sceneId, prefix, region = "cn", onVerify, onError },
    ref,
  ) {
    const { t } = useTranslation("auth");
    const [state, setState] = useState<VerificationState>("idle");
    const idsRef = useRef<{ button: string; element: string } | null>(null);
    if (!idsRef.current) {
      widgetSequence += 1;
      idsRef.current = {
        button: `aliyun-captcha-button-${widgetSequence}`,
        element: `aliyun-captcha-element-${widgetSequence}`,
      };
    }
    const { button: buttonId, element: elementId } = idsRef.current;
    const cachedProofRef = useRef<CaptchaProof | null>(null);
    const pendingResolveRef = useRef<((proof: CaptchaProof | null) => void) | null>(null);
    const popupWatchRef = useRef<number | null>(null);
    const readyPromiseRef = useRef<Promise<void> | null>(null);
    const initializeRef = useRef<(() => Promise<void>) | null>(null);
    const mountedRef = useRef(true);
    const onVerifyRef = useRef(onVerify);
    const onErrorRef = useRef(onError);
    onVerifyRef.current = onVerify;
    onErrorRef.current = onError;

    function stopPopupWatch() {
      if (popupWatchRef.current !== null) {
        window.clearInterval(popupWatchRef.current);
        popupWatchRef.current = null;
      }
    }

    function settlePending(proof: CaptchaProof | null) {
      const resolve = pendingResolveRef.current;
      pendingResolveRef.current = null;
      resolve?.(proof);
    }

    function reset() {
      stopPopupWatch();
      settlePending(null);
      cachedProofRef.current = null;
      setState("idle");
    }

    function isPopupVisible() {
      const popup = document.getElementById(POPUP_ID);
      return Boolean(popup && window.getComputedStyle(popup).display !== "none");
    }

    function startPopupWatch() {
      stopPopupWatch();
      const startedAt = Date.now();
      let seen = false;
      popupWatchRef.current = window.setInterval(() => {
        if (cachedProofRef.current) {
          stopPopupWatch();
          return;
        }
        if (isPopupVisible()) {
          seen = true;
          return;
        }
        if (seen || Date.now() - startedAt > POPUP_OPEN_TIMEOUT_MS) {
          stopPopupWatch();
          setState("idle");
          settlePending(null);
          return;
        }
        document.getElementById(buttonId)?.click();
      }, POPUP_WATCH_INTERVAL_MS);
    }

    function handleTrigger() {
      if (cachedProofRef.current) return;
      setState("verifying");
      if (popupWatchRef.current === null) startPopupWatch();
    }

    function initialize() {
      window.AliyunCaptchaConfig = { region, prefix };
      if (!readyPromiseRef.current) {
        readyPromiseRef.current = loadAliyunCaptcha().then(() => {
          if (!window.initAliyunCaptcha) throw new Error("Aliyun Captcha SDK is unavailable");
          window.initAliyunCaptcha({
            SceneId: sceneId,
            prefix,
            mode: "popup",
            element: `#${elementId}`,
            button: `#${buttonId}`,
            captchaVerifyCallback: (captchaVerifyParam) => {
              const token = captchaVerifyParam.trim();
              if (!token) {
                const error = new Error("Aliyun Captcha verification failed");
                onErrorRef.current?.(error);
                reset();
                return { captchaResult: false };
              }
              const proof: CaptchaProof = { provider: "aliyun", token };
              stopPopupWatch();
              cachedProofRef.current = proof;
              setState("verified");
              settlePending(proof);
              onVerifyRef.current?.(proof);
              return { captchaResult: true };
            },
            onBizResultCallback: () => {},
            getInstance: () => {},
            slideStyle: { width: 360, height: 40 },
            language: document.documentElement.lang.toLowerCase().startsWith("zh") ? "cn" : "en",
          });
        }).catch((error: unknown) => {
          readyPromiseRef.current = null;
          throw error;
        });
      }
      return readyPromiseRef.current;
    }
    initializeRef.current = initialize;

    async function verify(): Promise<CaptchaProof | null> {
      if (cachedProofRef.current) return cachedProofRef.current;
      settlePending(null);
      await initialize();
      if (!mountedRef.current) return null;
      if (cachedProofRef.current) return cachedProofRef.current;
      return new Promise<CaptchaProof | null>((resolve) => {
        pendingResolveRef.current = resolve;
        document.getElementById(buttonId)?.click();
      });
    }

    useImperativeHandle(ref, () => ({ verify, reset }));

    useEffect(() => {
      mountedRef.current = true;
      let active = true;
      void initializeRef.current?.().catch((error: unknown) => {
        if (active) onErrorRef.current?.(error instanceof Error ? error : new Error("Aliyun Captcha initialization failed"));
      });
      return () => {
        active = false;
        mountedRef.current = false;
        stopPopupWatch();
        settlePending(null);
        document.getElementById(MASK_ID)?.remove();
        document.getElementById(POPUP_ID)?.remove();
      };
    }, [prefix, region, sceneId]);

    const label = state === "verified"
      ? t("captcha.verified")
      : state === "verifying"
        ? t("captcha.verifying")
        : t("captcha.idle");

    return (
      <div className="w-full">
        <button
          id={buttonId}
          type="button"
          aria-label={label}
          disabled={state === "verified"}
          onClick={handleTrigger}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-100 disabled:border-emerald-200 disabled:bg-emerald-50 disabled:text-emerald-700"
        >
          {state === "verified" ? <CheckCircle size={18} weight="fill" /> : null}
          {state === "verifying" ? <SpinnerGap size={18} className="animate-spin" /> : null}
          {state === "idle" ? <ShieldCheck size={18} /> : null}
          <span>{label}</span>
        </button>
        <div id={elementId} />
      </div>
    );
  },
);

export default AliyunCaptchaWidget;
