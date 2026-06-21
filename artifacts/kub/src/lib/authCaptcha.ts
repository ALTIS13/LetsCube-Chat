const env = import.meta.env as Record<string, string | undefined>;

export type AuthCaptchaProvider = "turnstile";

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

function resolveAuthCaptchaConfig(): AuthCaptchaConfig | null {
  const configuredProvider = env.VITE_AUTH_CAPTCHA_PROVIDER?.trim().toLowerCase();
  const siteKey = (env.VITE_AUTH_CAPTCHA_SITE_KEY || env.VITE_TURNSTILE_SITE_KEY || "").trim();
  if (!siteKey) return null;

  const provider = configuredProvider || "turnstile";
  if (provider !== "turnstile") return null;

  return { provider, siteKey };
}
