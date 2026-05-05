export const CONFIRMATION_LINK_INVALID_MESSAGE =
  "Ссылка подтверждения недействительна или устарела. Попробуйте войти или запросить письмо повторно.";

export function getAuthCallbackUrl(): string {
  if (typeof window === "undefined") return "/auth/callback";

  const baseUrl = import.meta.env.BASE_URL || "/";
  const basePath =
    baseUrl === "/" ? "" : `/${baseUrl.replace(/^\/+|\/+$/g, "")}`;

  return `${window.location.origin}${basePath}/auth/callback`;
}

export function getAuthCallbackErrorMessage(
  params: URLSearchParams,
): string | null {
  const error = params.get("error");
  const errorCode = params.get("error_code");

  if (!error && !errorCode) return null;

  if (error === "access_denied" || errorCode === "otp_expired") {
    return CONFIRMATION_LINK_INVALID_MESSAGE;
  }

  return "Не удалось завершить подтверждение почты. Попробуйте войти или запросить письмо повторно.";
}

export function getAuthCallbackExceptionMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/otp|expired|invalid|access_denied/i.test(message)) {
    return CONFIRMATION_LINK_INVALID_MESSAGE;
  }

  return "Не удалось завершить подтверждение почты. Попробуйте войти или запросить письмо повторно.";
}
