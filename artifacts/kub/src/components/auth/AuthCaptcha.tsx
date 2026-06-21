import { useEffect, useRef, useState } from "react";
import { getAuthCaptchaConfig } from "@/lib/authCaptcha";

type TurnstileWidgetId = string;

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

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

interface AuthCaptchaProps {
  disabled?: boolean;
  onTokenChange: (token: string) => void;
  resetSignal?: number;
}

let turnstileScriptPromise: Promise<void> | null = null;

export function AuthCaptcha({ disabled = false, onTokenChange, resetSignal = 0 }: AuthCaptchaProps) {
  const config = getAuthCaptchaConfig();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetRef = useRef<TurnstileWidgetId | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!config || disabled) return;
    let cancelled = false;

    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile || widgetRef.current) return;
        widgetRef.current = window.turnstile.render(containerRef.current, {
          sitekey: config.siteKey,
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
      if (widgetId && window.turnstile) {
        try {
          window.turnstile.remove(widgetId);
        } catch {
          // Turnstile can already remove a widget after failed/expired challenges.
        }
      }
      widgetRef.current = null;
      onTokenChange("");
    };
  }, [config, disabled, onTokenChange]);

  useEffect(() => {
    if (!config || !widgetRef.current || !window.turnstile) return;
    window.turnstile.reset(widgetRef.current);
    onTokenChange("");
    setError("");
  }, [config, onTokenChange, resetSignal]);

  if (!config) return null;

  return (
    <div className="space-y-2" data-testid="auth-captcha">
      <div
        ref={containerRef}
        aria-label="Проверка защиты от автоматических регистраций"
        className="min-h-[65px] overflow-hidden rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)]/60 px-1 py-2"
      />
      {error && (
        <p className="px-1 text-xs text-[color:var(--kub-danger)]">{error}</p>
      )}
    </div>
  );
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
