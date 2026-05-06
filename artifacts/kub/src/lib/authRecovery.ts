const RECOVERY_STORAGE_KEY = "kub-password-recovery";

export const PASSWORD_RECOVERY_LINK_INVALID_MESSAGE =
  "Ссылка недействительна или устарела. Запросите восстановление пароля повторно.";

export function markPasswordRecoveryFlow(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(RECOVERY_STORAGE_KEY, "1");
}

export function clearPasswordRecoveryFlow(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(RECOVERY_STORAGE_KEY);
}

export function isPasswordRecoveryFlow(): boolean {
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem(RECOVERY_STORAGE_KEY) === "1";
}

export function isPasswordRecoveryUrl(params: URLSearchParams): boolean {
  return params.get("type") === "recovery";
}
