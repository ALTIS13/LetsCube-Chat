export const PASSWORD_RECOVERY_LINK_INVALID_MESSAGE =
  "Ссылка недействительна или устарела. Запросите восстановление пароля повторно.";

export function isPasswordRecoveryUrl(params: URLSearchParams): boolean {
  return params.get("type") === "recovery";
}
