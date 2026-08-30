const env = import.meta.env as Record<string, string | undefined>;

export type AuthCaptchaProvider = "turnstile" | "yandex-smartcaptcha";

export interface AuthCaptchaConfig {
  provider: AuthCaptchaProvider;
  siteKey: string;
}

const AUTH_CAPTCHA_CONFIG = resolveAuthCaptchaConfig();

export function getAuthCaptchaConfig(): AuthCaptchaConfig | null {
  return AUTH_CAPTCHA_CONFIG;
}

export function isAuthCaptchaEnabled(): boolean {
  return AUTH_CAPTCHA_CONFIG !== null;
}

export function getAuthCaptchaRequiredMessage(): string {
  return "Подтвердите защиту от автоматической регистрации.";
}

export function getAuthCaptchaUnavailableMessage(): string {
  return "Защита регистрации временно недоступна. Обратитесь к администратору.";
}

export function shouldUseAuthCaptchaGateway(): boolean {
  return AUTH_CAPTCHA_CONFIG !== null;
}

export function resolveAuthCaptchaConfig(): AuthCaptchaConfig | null {
  const configuredProvider = env.VITE_AUTH_CAPTCHA_PROVIDER?.trim().toLowerCase();
  const siteKey = (env.VITE_AUTH_CAPTCHA_SITE_KEY || env.VITE_TURNSTILE_SITE_KEY || "").trim();
  if (!siteKey) return null;

  const provider = configuredProvider || "turnstile";
  if (provider === "turnstile") return { provider, siteKey };
  if (provider === "yandex" || provider === "yandex-smartcaptcha" || provider === "smartcaptcha") {
    return { provider: "yandex-smartcaptcha", siteKey };
  }

  return null;
}
