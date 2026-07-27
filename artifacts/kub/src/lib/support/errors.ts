const SUPPORT_ERROR_MESSAGES: Record<string, string> = {
  bad_request: "Проверьте заполненные поля и попробуйте снова.",
  invalid_request: "Проверьте заполненные поля и попробуйте снова.",
  captcha_required: "Подтвердите, что запрос отправляет человек.",
  captcha_failed: "Не удалось выполнить проверку защиты. Обновите страницу и попробуйте снова.",
  rate_limited: "Слишком много обращений. Подождите и попробуйте позже.",
  support_closed: "Приём новых обращений временно приостановлен.",
  session_expired: "Срок доступа к обращению истёк. Создайте новое обращение.",
  session_invalid: "Не удалось подтвердить доступ к обращению.",
  forbidden: "Недостаточно прав для выполнения операции.",
  message_too_long: "Сообщение слишком длинное.",
  not_configured: "Служба поддержки пока недоступна. Попробуйте позже.",
  service_unavailable: "Служба поддержки временно недоступна. Попробуйте позже.",
};

export function getSupportErrorMessage(code: unknown): string {
  if (typeof code !== "string") {
    return "Не удалось выполнить операцию. Попробуйте позже.";
  }
  return SUPPORT_ERROR_MESSAGES[code] ?? "Не удалось выполнить операцию. Попробуйте позже.";
}

export class SupportGatewayError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 500) {
    super(getSupportErrorMessage(code));
    this.name = "SupportGatewayError";
    this.code = code;
    this.status = status;
  }
}
