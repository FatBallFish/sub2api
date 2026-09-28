import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { useTranslation } from "react-i18next";
import { turnstileLocale, type TurnstileSdkLocale } from "../../utils/sdkLocale";

const TURNSTILE_SCRIPT_ID = "cloudflare-turnstile-script";
const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const TURNSTILE_SCRIPT_OWNER = "sub2api";

type TurnstileTheme = "light" | "dark" | "auto";
type TurnstileSize = "normal" | "compact" | "flexible";
type TurnstileError = string | Error | undefined;

interface TurnstileRenderOptions {
  sitekey: string;
  language: TurnstileSdkLocale;
  theme: TurnstileTheme;
  size: TurnstileSize;
  callback: (token: string) => void;
  "expired-callback": () => void;
  "error-callback": (errorCode?: string) => void;
}

interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileRenderOptions): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export interface TurnstileWidgetHandle {
  reset(): void;
}

export interface TurnstileWidgetProps {
  siteKey: string;
  onVerify: (token: string) => void;
  onExpire?: () => void;
  onError?: (error: TurnstileError) => void;
  theme?: TurnstileTheme;
  size?: TurnstileSize;
}

let scriptLoadingPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) {
    return Promise.resolve(window.turnstile);
  }

  if (scriptLoadingPromise) {
    return scriptLoadingPromise;
  }

  const pendingPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const existingElement = document.getElementById(TURNSTILE_SCRIPT_ID);
    if (existingElement && !(existingElement instanceof HTMLScriptElement)) {
      reject(new Error("Turnstile script ID is already used by another element."));
      return;
    }

    const script = existingElement ?? document.createElement("script");
    const isLoaderOwned = !existingElement || script.dataset.turnstileLoader === TURNSTILE_SCRIPT_OWNER;

    const removeListeners = () => {
      script.removeEventListener("load", handleLoad);
      script.removeEventListener("error", handleError);
    };

    const removeFailedOwnedScript = () => {
      if (isLoaderOwned) {
        script.remove();
      }
    };

    const handleLoad = () => {
      removeListeners();
      if (window.turnstile) {
        resolve(window.turnstile);
      } else {
        removeFailedOwnedScript();
        reject(new Error("Turnstile API was unavailable after the script loaded."));
      }
    };

    const handleError = () => {
      removeListeners();
      removeFailedOwnedScript();
      reject(new Error("Failed to load the Turnstile script."));
    };

    script.addEventListener("load", handleLoad);
    script.addEventListener("error", handleError);

    if (!existingElement) {
      script.id = TURNSTILE_SCRIPT_ID;
      script.dataset.turnstileLoader = TURNSTILE_SCRIPT_OWNER;
      script.setAttribute("src", TURNSTILE_SCRIPT_URL);
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  });

  scriptLoadingPromise = pendingPromise.then(
    (turnstile) => {
      scriptLoadingPromise = null;
      return turnstile;
    },
    (error: unknown) => {
      scriptLoadingPromise = null;
      throw error;
    },
  );

  return scriptLoadingPromise;
}

const TurnstileWidget = forwardRef<TurnstileWidgetHandle, TurnstileWidgetProps>(
  function TurnstileWidget(
    {
      siteKey,
      onVerify,
      onExpire,
      onError,
      theme = "auto",
      size = "flexible",
    },
    ref,
  ) {
    const { i18n, t } = useTranslation("auth");
    const language = turnstileLocale(i18n.resolvedLanguage);
    const containerRef = useRef<HTMLDivElement>(null);
    const apiRef = useRef<TurnstileApi>(null);
    const widgetIdRef = useRef<string>(null);
    const onVerifyRef = useRef(onVerify);
    const onExpireRef = useRef(onExpire);
    const onErrorRef = useRef(onError);

    onVerifyRef.current = onVerify;
    onExpireRef.current = onExpire;
    onErrorRef.current = onError;

    useImperativeHandle(ref, () => ({
      reset() {
        const widgetId = widgetIdRef.current;
        if (widgetId) {
          apiRef.current?.reset(widgetId);
        }
      },
    }), []);

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      let cancelled = false;

      loadTurnstile()
        .then((turnstile) => {
          if (cancelled) return;

          try {
            const widgetId = turnstile.render(container, {
              sitekey: siteKey,
              language,
              theme,
              size,
              callback: (token) => onVerifyRef.current(token),
              "expired-callback": () => onExpireRef.current?.(),
              "error-callback": (errorCode) => onErrorRef.current?.(errorCode),
            });

            apiRef.current = turnstile;
            widgetIdRef.current = widgetId;
          } catch (error) {
            onErrorRef.current?.(error instanceof Error ? error : new Error("Failed to initialize Turnstile."));
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            onErrorRef.current?.(error instanceof Error ? error : new Error("Failed to initialize Turnstile."));
          }
        });

      return () => {
        cancelled = true;
        const widgetId = widgetIdRef.current;
        if (widgetId) {
          apiRef.current?.remove(widgetId);
          widgetIdRef.current = null;
          apiRef.current = null;
        }
      };
    }, [language, siteKey, size, theme]);

    return (
      <div
        ref={containerRef}
        role="group"
        aria-label={t("captcha.verification")}
        style={{ minHeight: "65px", width: "100%" }}
      />
    );
  },
);

export default TurnstileWidget;
