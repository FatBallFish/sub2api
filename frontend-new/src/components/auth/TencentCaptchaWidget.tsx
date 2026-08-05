import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { CaptchaProof } from "./captcha";

const TENCENT_SCRIPT_ID = "tencent-captcha-script";
const TENCENT_SCRIPT_URL = "https://turing.captcha.qcloud.com/TJCaptcha.js";
const TENCENT_SCRIPT_OWNER = "sub2api";

interface TencentCaptchaResult {
  ret: number;
  ticket?: string | null;
  randstr?: string | null;
  errorCode?: number;
}

interface TencentCaptchaInstance {
  show(): void;
  destroy(): void;
}

type TencentCaptchaConstructor = new (
  appId: string,
  callback: (result: TencentCaptchaResult) => void,
  options?: { userLanguage: "zh-cn" | "en" },
) => TencentCaptchaInstance;

declare global {
  interface Window {
    TencentCaptcha?: TencentCaptchaConstructor;
  }
}

export interface TencentCaptchaWidgetHandle {
  verify(): Promise<CaptchaProof | null>;
  reset(): void;
}

export interface TencentCaptchaWidgetProps {
  appId: string;
}

let scriptLoadingPromise: Promise<TencentCaptchaConstructor> | null = null;

function loadTencentCaptcha(): Promise<TencentCaptchaConstructor> {
  if (window.TencentCaptcha) return Promise.resolve(window.TencentCaptcha);
  if (scriptLoadingPromise) return scriptLoadingPromise;

  const pending = new Promise<TencentCaptchaConstructor>((resolve, reject) => {
    const existingElement = document.getElementById(TENCENT_SCRIPT_ID);
    if (existingElement && !(existingElement instanceof HTMLScriptElement)) {
      reject(new Error("Tencent Captcha script ID is already used by another element."));
      return;
    }

    const script = existingElement ?? document.createElement("script");
    const owned = !existingElement || script.dataset.tencentCaptchaLoader === TENCENT_SCRIPT_OWNER;
    const removeListeners = () => {
      script.removeEventListener("load", handleLoad);
      script.removeEventListener("error", handleError);
    };
    const fail = (error: Error) => {
      removeListeners();
      if (owned) script.remove();
      reject(error);
    };
    const handleLoad = () => {
      removeListeners();
      if (window.TencentCaptcha) {
        resolve(window.TencentCaptcha);
      } else {
        fail(new Error("Tencent Captcha SDK is unavailable"));
      }
    };
    const handleError = () => fail(new Error("Failed to load Tencent Captcha SDK"));

    script.addEventListener("load", handleLoad);
    script.addEventListener("error", handleError);
    if (!existingElement) {
      script.id = TENCENT_SCRIPT_ID;
      script.dataset.tencentCaptchaLoader = TENCENT_SCRIPT_OWNER;
      script.src = TENCENT_SCRIPT_URL;
      script.async = true;
      document.head.appendChild(script);
    }
  });

  scriptLoadingPromise = pending.then(
    (sdk) => {
      scriptLoadingPromise = null;
      return sdk;
    },
    (error: unknown) => {
      scriptLoadingPromise = null;
      throw error;
    },
  );
  return scriptLoadingPromise;
}

const TencentCaptchaWidget = forwardRef<TencentCaptchaWidgetHandle, TencentCaptchaWidgetProps>(
  function TencentCaptchaWidget({ appId }, ref) {
    const instanceRef = useRef<TencentCaptchaInstance | null>(null);
    const pendingRef = useRef<Promise<CaptchaProof | null> | null>(null);
    const cancelRef = useRef<(() => void) | null>(null);
    const mountedRef = useRef(true);

    function reset() {
      instanceRef.current?.destroy();
      instanceRef.current = null;
      cancelRef.current?.();
      cancelRef.current = null;
    }

    function verify(): Promise<CaptchaProof | null> {
      if (pendingRef.current) return pendingRef.current;

      const request = new Promise<CaptchaProof | null>((resolve, reject) => {
        let settled = false;
        const finish = (complete: () => void) => {
          if (settled) return;
          settled = true;
          if (cancelRef.current === cancel) cancelRef.current = null;
          instanceRef.current?.destroy();
          instanceRef.current = null;
          complete();
        };
        const cancel = () => finish(() => resolve(null));
        cancelRef.current = cancel;

        void loadTencentCaptcha().then((TencentCaptcha) => {
          if (!mountedRef.current || cancelRef.current !== cancel) return;
          try {
            const language = document.documentElement.lang.toLowerCase().startsWith("zh") ? "zh-cn" : "en";
            instanceRef.current = new TencentCaptcha(appId, (result) => {
              if (result.ret === 2) {
                finish(() => resolve(null));
                return;
              }
              const ticket = result.ticket?.trim() || "";
              const randstr = result.randstr?.trim() || "";
              if (!ticket || !randstr || ticket.startsWith("trerror_") || result.errorCode !== undefined) {
                finish(() => reject(new Error("Tencent Captcha verification failed")));
                return;
              }
              finish(() => resolve({ provider: "tencent", ticket, randstr }));
            }, { userLanguage: language });
            instanceRef.current.show();
          } catch (error) {
            finish(() => reject(error instanceof Error ? error : new Error("Tencent Captcha initialization failed")));
          }
        }).catch((error: unknown) => {
          finish(() => reject(error instanceof Error ? error : new Error("Tencent Captcha initialization failed")));
        });
      }).finally(() => {
        pendingRef.current = null;
      });

      pendingRef.current = request;
      return request;
    }

    useImperativeHandle(ref, () => ({ verify, reset }));

    useEffect(() => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
        reset();
      };
    }, []);

    return null;
  },
);

export default TencentCaptchaWidget;
