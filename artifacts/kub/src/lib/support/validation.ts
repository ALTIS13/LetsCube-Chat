import {
  SUPPORT_CATEGORIES,
  type NormalizedSupportRequest,
  type SupportCategory,
  type SupportRequestInput,
} from "./types.ts";

export const SUPPORT_LIMITS = {
  fullNameMax: 80,
  emailMax: 254,
  phoneMax: 20,
  subjectMax: 120,
  messageMax: 4_000,
  captchaTokenMax: 4_096,
  minimumFillTimeMs: 2_000,
} as const;

type SupportRequestField = keyof SupportRequestInput;

export type SupportValidationResult =
  | { ok: true; value: NormalizedSupportRequest }
  | {
      ok: false;
      fields: Partial<Record<SupportRequestField, string>>;
      formError?: string;
    };

export function validateSupportRequest(
  input: SupportRequestInput,
  options: { now?: () => number } = {},
): SupportValidationResult {
  const now = options.now ?? Date.now;
  const fields: Partial<Record<SupportRequestField, string>> = {};
  const fullName = normalizeHumanText(input.fullName);
  const email = input.email.trim().toLowerCase();
  const phone = normalizeSupportPhone(input.phone);
  const subject = normalizeHumanText(input.subject);
  const message = input.message.trim();
  const captchaToken = input.captchaToken.trim();
  const category = isSupportCategory(input.category) ? input.category : null;
  const privacyVersion = input.privacyVersion.trim();

  if (input.website.trim()) {
    return { ok: false, fields, formError: "Не удалось отправить обращение." };
  }
  if (
    !Number.isFinite(input.formStartedAt) ||
    input.formStartedAt <= 0 ||
    now() - input.formStartedAt < SUPPORT_LIMITS.minimumFillTimeMs
  ) {
    return {
      ok: false,
      fields,
      formError: "Подождите несколько секунд и отправьте обращение снова.",
    };
  }

  if (fullName.length < 2 || fullName.length > SUPPORT_LIMITS.fullNameMax) {
    fields.fullName = "Укажите имя длиной от 2 до 80 символов.";
  }
  if (!isValidEmail(email) || email.length > SUPPORT_LIMITS.emailMax) {
    fields.email = "Введите корректный адрес электронной почты.";
  }
  if (!phone) {
    fields.phone = "Введите номер в международном формате, например +79991234567.";
  }
  if (!category) {
    fields.category = "Выберите категорию обращения.";
  }
  if (subject.length < 5 || subject.length > SUPPORT_LIMITS.subjectMax) {
    fields.subject = "Опишите тему обращения: от 5 до 120 символов.";
  }
  if (message.length < 20 || message.length > SUPPORT_LIMITS.messageMax) {
    fields.message = "Опишите ситуацию подробнее: от 20 до 4000 символов.";
  }
  if (!input.privacyAccepted) {
    fields.privacyAccepted = "Подтвердите согласие с Политикой конфиденциальности.";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(privacyVersion)) {
    fields.privacyVersion = "Не удалось определить версию Политики. Обновите страницу.";
  }
  if (!captchaToken || captchaToken.length > SUPPORT_LIMITS.captchaTokenMax) {
    fields.captchaToken = "Подтвердите, что запрос отправляет человек.";
  }

  if (Object.keys(fields).length > 0 || !phone || !category || !input.privacyAccepted) {
    return { ok: false, fields };
  }

  return {
    ok: true,
    value: {
      fullName,
      email,
      phone,
      category,
      subject,
      message,
      privacyAccepted: true,
      privacyVersion,
      captchaToken,
      website: "",
      formStartedAt: input.formStartedAt,
    },
  };
}

export function normalizeSupportPhone(value: string): string | null {
  const compact = value.trim().replace(/[\s()-]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(compact)) return null;
  return compact;
}

function normalizeHumanText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isSupportCategory(value: string): value is SupportCategory {
  return SUPPORT_CATEGORIES.includes(value as SupportCategory);
}
