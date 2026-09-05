import { useCallback, useState, type FormEvent } from "react";
import { Link } from "wouter";
import { HumanVerificationCaptcha } from "@/components/security/HumanVerificationCaptcha";
import { KubButton, KubIcon, KubInput, KubPanel } from "@/components/kub";
import { PRIVACY_POLICY_VERSION } from "@/content/privacyPolicy";
import {
  SUPPORT_CATEGORIES,
  SUPPORT_CATEGORY_LABELS,
  type NormalizedSupportRequest,
  type SupportRequestInput,
} from "@/lib/support/types";
import {
  SUPPORT_LIMITS,
  validateSupportRequest,
  type SupportValidationResult,
} from "@/lib/support/validation";

interface SupportRequestFormProps {
  busy: boolean;
  error?: string;
  onSubmit: (request: NormalizedSupportRequest) => Promise<void>;
}

type FieldErrors = Extract<SupportValidationResult, { ok: false }>["fields"];

export function SupportRequestForm({ busy, error, onSubmit }: SupportRequestFormProps) {
  const [input, setInput] = useState<SupportRequestInput>(() => createInitialInput());
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");
  const [captchaResetSignal, setCaptchaResetSignal] = useState(0);

  const setField = <K extends keyof SupportRequestInput>(
    field: K,
    value: SupportRequestInput[K],
  ) => {
    setInput((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
    setFormError("");
  };

  const handleCaptcha = useCallback((token: string) => {
    setField("captchaToken", token);
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validation = validateSupportRequest(input);
    if (!validation.ok) {
      setFieldErrors(validation.fields);
      setFormError(validation.formError ?? "");
      return;
    }

    setFieldErrors({});
    setFormError("");
    try {
      await onSubmit(validation.value);
    } catch {
      setCaptchaResetSignal((value) => value + 1);
    }
  };

  return (
    <KubPanel className="w-full p-4 sm:p-6" data-testid="support-request-form">
      <form onSubmit={submit} noValidate className="space-y-5">
        <div>
          <h2 className="text-lg font-bold text-[color:var(--kub-text)]">
            Новое обращение
          </h2>
          <p className="mt-1 text-xs leading-5 text-[color:var(--kub-muted)]">
            Чат откроется сразу после отправки формы. Переходить по ссылке из письма не нужно.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <KubInput
            label="Ваше имя"
            value={input.fullName}
            onChange={(event) => setField("fullName", event.target.value)}
            error={fieldErrors.fullName}
            maxLength={SUPPORT_LIMITS.fullNameMax}
            autoComplete="name"
            required
          />
          <KubInput
            label="Эл. почта для ответа"
            type="email"
            value={input.email}
            onChange={(event) => setField("email", event.target.value)}
            error={fieldErrors.email}
            maxLength={SUPPORT_LIMITS.emailMax}
            autoComplete="email"
            required
          />
          <KubInput
            label="Номер телефона"
            type="tel"
            value={input.phone}
            onChange={(event) => setField("phone", event.target.value)}
            error={fieldErrors.phone}
            hint="Международный формат, например +79991234567."
            maxLength={SUPPORT_LIMITS.phoneMax}
            autoComplete="tel"
            required
          />
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-[color:var(--kub-muted)]">
              Категория
            </span>
            <select
              value={input.category}
              onChange={(event) => setField("category", event.target.value)}
              className="h-11 w-full rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 text-sm text-[color:var(--kub-text)] outline-none transition focus:border-[color:var(--kub-cyan)] focus:ring-2 focus:ring-[color:var(--kub-cyan)]/20"
              aria-invalid={Boolean(fieldErrors.category)}
              required
            >
              <option value="">Выберите категорию</option>
              {SUPPORT_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {SUPPORT_CATEGORY_LABELS[category]}
                </option>
              ))}
            </select>
            {fieldErrors.category && (
              <span className="text-xs text-[color:var(--kub-danger-text)]">
                {fieldErrors.category}
              </span>
            )}
          </label>
        </div>

        <KubInput
          label="Тема обращения"
          value={input.subject}
          onChange={(event) => setField("subject", event.target.value)}
          error={fieldErrors.subject}
          maxLength={SUPPORT_LIMITS.subjectMax}
          required
        />

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-[color:var(--kub-muted)]">
            Что произошло
          </span>
          <textarea
            value={input.message}
            onChange={(event) => setField("message", event.target.value)}
            maxLength={SUPPORT_LIMITS.messageMax}
            rows={6}
            required
            className="min-h-32 w-full resize-y rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 py-2.5 text-sm leading-6 text-[color:var(--kub-text)] outline-none transition placeholder:text-[color:var(--kub-muted)] focus:border-[color:var(--kub-cyan)] focus:ring-2 focus:ring-[color:var(--kub-cyan)]/20"
            placeholder="Опишите проблему, ожидаемый результат и что уже пробовали сделать."
            aria-invalid={Boolean(fieldErrors.message)}
          />
          <span className="flex justify-between gap-3 text-xs">
            <span className={fieldErrors.message ? "text-[color:var(--kub-danger-text)]" : "text-[color:var(--kub-muted)]"}>
              {fieldErrors.message ?? "Не указывайте пароли, коды подтверждения и платёжные данные."}
            </span>
            <span className="shrink-0 text-[color:var(--kub-muted)]">
              {input.message.length}/{SUPPORT_LIMITS.messageMax}
            </span>
          </span>
        </label>

        <div className="hidden" aria-hidden="true">
          <label>
            Сайт
            <input
              name="website"
              tabIndex={-1}
              autoComplete="off"
              value={input.website}
              onChange={(event) => setField("website", event.target.value)}
            />
          </label>
        </div>

        <label className="flex items-start gap-3 rounded-md border border-[color:var(--kub-border-color)] px-3 py-3">
          <input
            type="checkbox"
            checked={input.privacyAccepted}
            onChange={(event) => setField("privacyAccepted", event.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--kub-cyan)]"
          />
          <span className="text-xs leading-5 text-[color:var(--kub-muted)]">
            Я ознакомился с{" "}
            <Link
              href="/privacy"
              target="_blank"
              className="font-semibold text-[color:var(--kub-accent-text)]"
            >
              Политикой конфиденциальности
            </Link>{" "}
            и согласен на обработку данных обращения для получения ответа.
            {fieldErrors.privacyAccepted && (
              <span className="mt-1 block text-[color:var(--kub-danger-text)]">
                {fieldErrors.privacyAccepted}
              </span>
            )}
          </span>
        </label>

        <HumanVerificationCaptcha
          required
          disabled={busy}
          onTokenChange={handleCaptcha}
          resetSignal={captchaResetSignal}
          testId="support-captcha"
          ariaLabel="Проверка защиты формы поддержки"
        />
        {fieldErrors.captchaToken && (
          <p className="text-xs text-[color:var(--kub-danger-text)]">
            {fieldErrors.captchaToken}
          </p>
        )}

        {(formError || error) && (
          <p
            role="alert"
            className="rounded-md border border-[color:var(--kub-danger)]/40 bg-[color:var(--kub-danger)]/10 px-3 py-2 text-xs text-[color:var(--kub-danger-text)]"
          >
            {formError || error}
          </p>
        )}

        <KubButton
          type="submit"
          fullWidth
          size="lg"
          loading={busy}
          leftIcon={<KubIcon name="send" size={17} />}
        >
          Отправить и открыть чат
        </KubButton>
      </form>
    </KubPanel>
  );
}

function createInitialInput(): SupportRequestInput {
  return {
    fullName: "",
    email: "",
    phone: "",
    category: "",
    subject: "",
    message: "",
    privacyAccepted: false,
    privacyVersion: PRIVACY_POLICY_VERSION,
    captchaToken: "",
    website: "",
    formStartedAt: Date.now(),
  };
}
