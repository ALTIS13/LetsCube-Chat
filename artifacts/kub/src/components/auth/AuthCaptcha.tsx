import { useEffect, useRef, useState } from "react";
import { getAuthCaptchaConfig } from "@/lib/authCaptcha";
import { useTheme } from "@/hooks/useTheme";

type TurnstileWidgetId = string;
type YandexWidgetId = string | number;

interface TurnstileRenderOptions {
  sitekey: string;
  callback?: (token: string) => void;
  "expired-callback"?: () => void;
  "error-callback"?: () => void;
  "timeout-callback"?: () => void;
  theme?: "auto" | "light" | "dark";
  size?: "normal" | "compact";
}

interface TurnstileApi {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => TurnstileWidgetId;
  reset: (widgetId?: TurnstileWidgetId) => void;
  remove: (widgetId: TurnstileWidgetId) => void;
}

interface YandexSmartCaptchaRenderOptions {
  sitekey: string;
  callback: (token: string) => void;
  "expired-callback"?: () => void;
  "error-callback"?: () => void;
  invisible?: boolean;
  test?: boolean;
  theme?: "light" | "dark";
}

interface YandexSmartCaptchaApi {
  render: (container: HTMLElement, options: YandexSmartCaptchaRenderOptions) => YandexWidgetId;
  reset?: (widgetId?: YandexWidgetId) => void;
  destroy?: (widgetId?: YandexWidgetId) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
    smartCaptcha?: YandexSmartCaptchaApi;
  }
}

interface AuthCaptchaProps {
  disabled?: boolean;
  onTokenChange: (token: string) => void;
  resetSignal?: number;
}

let turnstileScriptPromise: Promise<void> | null = null;
let yandexScriptPromise: Promise<void> | null = null;

export function AuthCaptcha({ disabled = false, onTokenChange, resetSignal = 0 }: AuthCaptchaProps) {
  const config = getAuthCaptchaConfig();
  const { resolvedTheme } = useTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetRef = useRef<TurnstileWidgetId | YandexWidgetId | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!config || disabled) return;
    let cancelled = false;

    const loadScript = config.provider === "yandex-smartcaptcha" ? loadYandexSmartCaptchaScript : loadTurnstileScript;

    loadScript()
      .then(() => {
        if (cancelled || !containerRef.current || widgetRef.current) return;
        widgetRef.current =
          config.provider === "yandex-smartcaptcha"
            ? renderYandexSmartCaptcha(containerRef.current, config.siteKey, resolvedTheme, onTokenChange, setError)
            : renderTurnstile(containerRef.current, config.siteKey, onTokenChange, setError);
      })
      .catch(() => {
        if (!cancelled) {
          onTokenChange("");
          setError("Не удалось загрузить проверку защиты. Проверьте соединение и попробуйте снова.");
        }
      });

    return () => {
      cancelled = true;
      const widgetId = widgetRef.current;
      if (widgetId && config.provider === "turnstile" && window.turnstile) {
        try {
          window.turnstile.remove(widgetId as TurnstileWidgetId);
        } catch {
          // Turnstile can already remove a widget after failed/expired challenges.
        }
      } else if (widgetId && config.provider === "yandex-smartcaptcha") {
        window.smartCaptcha?.destroy?.(widgetId);
      }
      widgetRef.current = null;
      onTokenChange("");
    };
  }, [config, disabled, onTokenChange, resolvedTheme]);

  useEffect(() => {
    if (!config || !widgetRef.current) return;
    if (config.provider === "turnstile") window.turnstile?.reset(widgetRef.current as TurnstileWidgetId);
    else window.smartCaptcha?.reset?.(widgetRef.current);
    onTokenChange("");
    setError("");
  }, [config, onTokenChange, resetSignal]);

  if (!config) return null;

  const captchaContainerClassName =
    config.provider === "yandex-smartcaptcha"
      ? "min-h-[104px] w-full overflow-hidden rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)]/60 p-0"
      : "min-h-[65px] overflow-hidden rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)]/60 px-1 py-2";

  return (
    <div className="space-y-2" data-testid="auth-captcha">
      <div
        ref={containerRef}
        aria-label="Проверка защиты от автоматических регистраций"
        data-provider={config.provider}
        data-theme={resolvedTheme}
        className={captchaContainerClassName}
        style={{ colorScheme: resolvedTheme }}
      />
      {error && (
        <p className="px-1 text-xs text-[color:var(--kub-danger)]">{error}</p>
      )}
    </div>
  );
}

function renderTurnstile(
  container: HTMLElement,
  siteKey: string,
  onTokenChange: (token: string) => void,
  setError: (message: string) => void,
): TurnstileWidgetId {
  if (!window.turnstile) throw new Error("Turnstile runtime unavailable");
  return window.turnstile.render(container, {
    sitekey: siteKey,
    theme: "dark",
    size: "normal",
    callback: (token) => {
      setError("");
      onTokenChange(token);
    },
    "expired-callback": () => {
      onTokenChange("");
    },
    "error-callback": () => {
      onTokenChange("");
      setError("Не удалось выполнить проверку. Обновите страницу и попробуйте снова.");
    },
    "timeout-callback": () => {
      onTokenChange("");
      setError("Проверка истекла. Повторите подтверждение.");
    },
  });
}

function renderYandexSmartCaptcha(
  container: HTMLElement,
  siteKey: string,
  theme: "light" | "dark",
  onTokenChange: (token: string) => void,
  setError: (message: string) => void,
): YandexWidgetId {
  if (!window.smartCaptcha) throw new Error("Yandex SmartCaptcha runtime unavailable");
  return window.smartCaptcha.render(container, {
    sitekey: siteKey,
    theme,
    callback: (token) => {
      setError("");
      onTokenChange(token);
    },
    "expired-callback": () => {
      onTokenChange("");
    },
    "error-callback": () => {
      onTokenChange("");
      setError("Не удалось выполнить проверку. Обновите страницу и попробуйте снова.");
    },
  });
}

function loadTurnstileScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("Browser runtime required"));
  if (window.turnstile) return Promise.resolve();
  if (turnstileScriptPromise) return turnstileScriptPromise;

  turnstileScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-kub-turnstile="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => {
        turnstileScriptPromise = null;
        reject(new Error("Turnstile failed to load"));
      }, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.dataset.kubTurnstile = "true";
    script.onload = () => resolve();
    script.onerror = () => {
      turnstileScriptPromise = null;
      reject(new Error("Turnstile failed to load"));
    };
    document.head.appendChild(script);
  });

  return turnstileScriptPromise;
}

function loadYandexSmartCaptchaScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("Browser runtime required"));
  if (window.smartCaptcha) return Promise.resolve();
  if (yandexScriptPromise) return yandexScriptPromise;

  yandexScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-kub-yandex-smartcaptcha="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => {
        yandexScriptPromise = null;
        reject(new Error("Yandex SmartCaptcha failed to load"));
      }, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://smartcaptcha.cloud.yandex.ru/captcha.js?render=onload";
    script.async = true;
    script.defer = true;
    script.dataset.kubYandexSmartcaptcha = "true";
    script.onload = () => resolve();
    script.onerror = () => {
      yandexScriptPromise = null;
      reject(new Error("Yandex SmartCaptcha failed to load"));
    };
    document.head.appendChild(script);
  });

  return yandexScriptPromise;
}
