import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { AuthCaptcha } from "@/components/auth/AuthCaptcha";
import { createNonPersistedAuthClient } from "@/lib/supabase/client";
import { KubBrandLogo, KubButton, KubIcon, KubInput, KubPanel } from "@/components/kub";
import { kubBrandAsset } from "@/components/kub/brandAssets";
import {
  getAuthCaptchaConfig,
  getAuthCaptchaRequiredMessage,
  getAuthCaptchaUnavailableMessage,
  isAuthCaptchaEnabled,
} from "@/lib/authCaptcha";
import { requestAuthGateway } from "@/lib/authGateway";
import { mapPgError } from "@/lib/errors";
import { maskRegistrationEmail } from "@/lib/registrationConfirmation";
import { PROFILE_LIMITS, normalizeFullName, validateFullName } from "@/lib/profileValidation";
import {
  REGISTRATION_INVITE_ONLY_BANNER_BODY,
  REGISTRATION_INVITE_ONLY_BANNER_TITLE,
  REGISTRATION_INVITE_ONLY_CODE_REQUIRED_MESSAGE,
  normalizeRegistrationInviteCode,
  readRegistrationInviteFromSearch,
} from "@/lib/registrationInvite";
import { useTheme } from "@/hooks/useTheme";

const RESEND_COOLDOWN_MS = 60_000;

export function RegisterForm() {
  const [location, setLocation] = useLocation();
  const { resolvedTheme } = useTheme();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState(() =>
    typeof window === "undefined" ? "" : readRegistrationInviteFromSearch(window.location.search),
  );
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaResetSignal, setCaptchaResetSignal] = useState(0);
  const [resendCaptchaToken, setResendCaptchaToken] = useState("");
  const [resendCaptchaResetSignal, setResendCaptchaResetSignal] = useState(0);
  const [resendAvailableAt, setResendAvailableAt] = useState(0);
  const [resendNow, setResendNow] = useState(0);
  const [resending, setResending] = useState(false);
  const [resendError, setResendError] = useState("");
  const [resendSuccess, setResendSuccess] = useState("");
  const [inviteOnlyEnabled, setInviteOnlyEnabled] = useState(false);

  const supabase = useMemo(() => createNonPersistedAuthClient(), []);

  useEffect(() => {
    const query = location.includes("?") ? location.slice(location.indexOf("?")) : window.location.search;
    const nextInviteCode = readRegistrationInviteFromSearch(query);
    if (nextInviteCode) setInviteCode(nextInviteCode);
  }, [location]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await supabase.rpc("registration_invite_mode");
        if (cancelled) return;
        const row = Array.isArray(data) ? data[0] : data;
        setInviteOnlyEnabled(Boolean(row?.invite_only_enabled));
      } catch {
        if (!cancelled) setInviteOnlyEnabled(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  useEffect(() => {
    if (!success || !resendAvailableAt) return;

    const tick = () => setResendNow(Date.now());
    tick();
    const intervalId = window.setInterval(() => {
      const now = Date.now();
      setResendNow(now);
      if (now >= resendAvailableAt) window.clearInterval(intervalId);
    }, 250);

    return () => window.clearInterval(intervalId);
  }, [resendAvailableAt, success]);

  const resendCountdown = Math.max(0, Math.ceil((resendAvailableAt - resendNow) / 1_000));

  const startResendCooldown = () => {
    const now = Date.now();
    setResendNow(now);
    setResendAvailableAt(now + RESEND_COOLDOWN_MS);
  };

  const showRegistrationConfirmation = (normalizedEmail: string) => {
    setSubmittedEmail(normalizedEmail);
    setEmail("");
    setPassword("");
    setResendCaptchaToken("");
    setResendError("");
    setResendSuccess("");
    startResendCooldown();
    setSuccess(true);
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      const fullNameError = validateFullName(fullName);
      if (fullNameError) throw new Error(fullNameError);
      const captchaConfig = getAuthCaptchaConfig();
      if (!captchaConfig) {
        throw new Error(getAuthCaptchaUnavailableMessage());
      }
      if (!captchaToken) {
        throw new Error(getAuthCaptchaRequiredMessage());
      }
      const normalizedInviteCode = normalizeRegistrationInviteCode(inviteCode);
      if (inviteCode.trim() && !normalizedInviteCode) {
        throw new Error("Код приглашения должен быть 6–64 символа: латинские буквы, цифры, дефис или подчёркивание.");
      }
      if (inviteOnlyEnabled && !normalizedInviteCode) {
        throw new Error(REGISTRATION_INVITE_ONLY_CODE_REQUIRED_MESSAGE);
      }

      await requestAuthGateway({
        action: "signup",
        email: normalizedEmail,
        password,
        fullName: normalizeFullName(fullName),
        captchaToken,
        captchaProvider: captchaConfig.provider,
        inviteCode: normalizedInviteCode,
      });

      showRegistrationConfirmation(normalizedEmail);
    } catch (err: unknown) {
      if (isExistingAccountSignupError(err)) {
        showRegistrationConfirmation(email.trim().toLowerCase());
        return;
      }
      setError(mapPgError(err));
    } finally {
      if (isAuthCaptchaEnabled()) {
        setCaptchaToken("");
        setCaptchaResetSignal((value) => value + 1);
      }
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendCountdown > 0 || resending) return;

    setResendError("");
    setResendSuccess("");
    const captchaConfig = getAuthCaptchaConfig();
    if (!captchaConfig) {
      setResendError(getAuthCaptchaUnavailableMessage());
      return;
    }
    if (!resendCaptchaToken) {
      setResendError(getAuthCaptchaRequiredMessage());
      return;
    }

    setResending(true);
    try {
      await requestAuthGateway({
        action: "resend_signup",
        email: submittedEmail,
        captchaToken: resendCaptchaToken,
        captchaProvider: captchaConfig.provider,
      });
      setResendSuccess("Письмо отправлено повторно.");
      startResendCooldown();
    } catch (err: unknown) {
      setResendError(mapPgError(err));
    } finally {
      setResendCaptchaToken("");
      setResendCaptchaResetSignal((value) => value + 1);
      setResending(false);
    }
  };

  const handleUseDifferentEmail = () => {
    setSubmittedEmail("");
    setResendCaptchaToken("");
    setResendError("");
    setResendSuccess("");
    setSuccess(false);
  };

  if (success) {
    const resendLocked = resendCountdown > 0;
    return (
      <div className="min-h-screen flex items-center justify-center px-4 kub-grid-bg kub-auth-shell">
        <img
          src={kubBrandAsset("letscube-mascot-primary.png")}
          alt=""
          aria-hidden="true"
          loading="eager"
          decoding="async"
          className="kub-auth-mascot"
        />
        <div className="relative z-10 w-full max-w-sm text-center" data-testid="auth-form-shell">
          <div className="flex flex-col items-center gap-4 mb-8">
            <div data-testid="auth-brand-lockup">
              <KubBrandLogo
                variant="vertical"
                tone={resolvedTheme === "light" ? "dark" : "light"}
                className="h-24 w-56 justify-center"
                imgClassName="max-h-24"
                alt="LETSCUBE"
              />
            </div>
            <p className="text-sm text-[color:var(--kub-muted)]">
              Защищённый мессенджер
            </p>
          </div>

          <KubPanel glow="soft" padded={false} className="overflow-hidden">
            <div className="px-3 py-2 border-b border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)]/50">
              <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--kub-cyan)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--kub-cyan)] kub-pulse" />
                Подтверждение
              </div>
            </div>
            <div className="p-5 space-y-4">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--kub-online)_18%,transparent)] border border-[color:var(--kub-online)]/40 text-[color:var(--kub-online)] kub-glow-soft">
                <KubIcon name="mailCheck" size={28} label="Письмо отправлено" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-[color:var(--kub-text)]">
                  Проверьте почту
                </h1>
                <div className="mt-2 space-y-2 text-sm leading-6 text-[color:var(--kub-muted)]">
                  <p>Если к этому адресу электронной почты ещё не привязан аккаунт, мы отправим письмо для подтверждения регистрации.</p>
                  <p>Если письмо не пришло, проверьте папку «Спам» и правильность указанного адреса. При ошибке вернитесь и зарегистрируйтесь с корректным email.</p>
                  <p>Неподтверждённая учётная запись будет удалена автоматически.</p>
                </div>
              </div>
              <p className="break-all rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)]/60 px-3 py-2 font-mono text-sm text-[color:var(--kub-text)]">
                {maskRegistrationEmail(submittedEmail)}
              </p>
              <div className="relative">
                <AuthCaptcha
                  disabled={resendLocked}
                  onTokenChange={setResendCaptchaToken}
                  required
                  resetSignal={resendCaptchaResetSignal}
                />
                {resendLocked && (
                  <p className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-[var(--kub-surface-2)]/85 px-4 text-center text-xs leading-5 text-[color:var(--kub-muted)]">
                    Подтверждение защиты станет доступно после окончания таймера.
                  </p>
                )}
              </div>
              <div className="min-h-10 px-1 text-xs leading-5" aria-live="polite">
                {resendError && <p className="text-[color:var(--kub-danger)]">{resendError}</p>}
                {resendSuccess && <p className="text-[color:var(--kub-online)]">{resendSuccess}</p>}
              </div>
              <div className="grid gap-3 pt-1">
                <KubButton
                  type="button"
                  variant="secondary"
                  fullWidth
                  disabled={resendLocked || resending}
                  loading={resending}
                  onClick={handleResend}
                  className="!h-auto min-h-16 px-4 py-3 leading-5 whitespace-normal"
                >
                  {resendLocked ? `Отправить письмо повторно через ${resendCountdown} сек.` : "Отправить письмо повторно"}
                </KubButton>
                <KubButton type="button" fullWidth onClick={() => setLocation("/login")}>
                  Ко входу
                </KubButton>
                <KubButton type="button" variant="secondary" fullWidth onClick={handleUseDifferentEmail}>
                  Указать другой email
                </KubButton>
              </div>
            </div>
          </KubPanel>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 kub-grid-bg kub-auth-shell">
      <img
        src={kubBrandAsset("letscube-mascot-primary.png")}
        alt=""
        aria-hidden="true"
        loading="eager"
        decoding="async"
        className="kub-auth-mascot"
      />
      <div className="relative z-10 w-full max-w-sm" data-testid="auth-form-shell">
        <div className="flex flex-col items-center gap-4 mb-8">
          <div data-testid="auth-brand-lockup">
            <KubBrandLogo
              variant="vertical"
              tone={resolvedTheme === "light" ? "dark" : "light"}
              className="h-24 w-56 justify-center"
              imgClassName="max-h-24"
              alt="LETSCUBE"
            />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold text-[color:var(--kub-text)]">
              Создать аккаунт
            </h1>
            <p className="text-sm mt-1 text-[color:var(--kub-muted)]">
              Для общения и совместной работы в LETSCUBE
            </p>
          </div>
        </div>

        <KubPanel glow="soft" padded={false} className="overflow-hidden">
          <div className="px-3 py-2 border-b border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)]/50">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--kub-pink)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--kub-pink)] kub-pulse" />
              Регистрация
            </div>
          </div>

          <form onSubmit={handleRegister} className="p-5 flex flex-col gap-3">
            {inviteOnlyEnabled && (
              <div
                data-testid="registration-invite-only-banner"
                className="rounded-xl border border-[color:var(--kub-warn)]/35 bg-[color-mix(in_srgb,var(--kub-warn)_13%,transparent)] px-3 py-2 text-sm text-[color:var(--kub-text)]"
              >
                <div className="flex items-start gap-2">
                  <KubIcon name="lock" size={16} tone="warn" className="mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <div className="font-semibold">{REGISTRATION_INVITE_ONLY_BANNER_TITLE}</div>
                    <div className="mt-1 text-xs leading-5 text-[color:var(--kub-muted)]">
                      {REGISTRATION_INVITE_ONLY_BANNER_BODY}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <KubInput
              type="text"
              placeholder="Имя и фамилия"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              maxLength={PROFILE_LIMITS.fullNameMax}
              hint={
                fullName.length > PROFILE_LIMITS.fullNameMax - 12
                  ? `${fullName.length}/${PROFILE_LIMITS.fullNameMax}`
                  : undefined
              }
              leftIcon={<KubIcon name="user" size={16} />}
              autoComplete="name"
            />
            <KubInput
              type="email"
              placeholder="Эл. почта"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              leftIcon={<KubIcon name="mail" size={16} />}
              autoComplete="email"
            />
            <KubInput
              type={showPass ? "text" : "password"}
              placeholder="Пароль (минимум 6 символов)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              leftIcon={<KubIcon name="lock" size={16} />}
              autoComplete="new-password"
              rightSlot={
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  // Same 16x16 target as the login form's reveal toggle; the
                  // icon size is unchanged and only the hit area grows.
                  className="-my-3 flex h-11 w-11 shrink-0 items-center justify-center text-[color:var(--kub-muted)] hover:text-[color:var(--kub-text)] transition-colors"
                  aria-label={showPass ? "Скрыть пароль" : "Показать пароль"}
                >
                  <KubIcon name={showPass ? "eyeOff" : "eye"} size={16} />
                </button>
              }
            />

            {inviteOnlyEnabled && (
              <KubInput
                type="text"
                label="Код приглашения"
                placeholder="Например STAFF-2026"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase().replace(/\s+/g, ""))}
                maxLength={64}
                leftIcon={<KubIcon name="userPlus" size={16} />}
                autoComplete="off"
                hint={inviteCode ? undefined : "По ссылке-приглашению код заполняется сам."}
              />
            )}

            <AuthCaptcha
              onTokenChange={setCaptchaToken}
              required
              resetSignal={captchaResetSignal}
            />

            {error && (
              <p className="text-xs text-[color:var(--kub-danger)] px-1">{error}</p>
            )}

            <KubButton type="submit" loading={loading} fullWidth size="lg" className="mt-1">
              Создать аккаунт
            </KubButton>
          </form>
        </KubPanel>

        <p className="text-center text-sm mt-5 text-[color:var(--kub-muted)]">
          Уже есть аккаунт?{" "}
          <Link
            href="/login"
            className="font-semibold text-[color:var(--kub-cyan)] hover:text-[color:var(--kub-cyan-hover)] transition-colors"
          >
            Войти
          </Link>
          <span className="mx-2 text-[color:var(--kub-muted)]">/</span>
          <Link
            href="/login?reset=1"
            className="font-semibold text-[color:var(--kub-cyan)] hover:text-[color:var(--kub-cyan-hover)] transition-colors"
          >
            Восстановить доступ
          </Link>
        </p>
        <p className="mt-3 text-center text-[11px] leading-5 text-[color:var(--kub-muted)]">
          Перед созданием аккаунта ознакомьтесь с{" "}
          <Link
            href="/privacy"
            className="font-semibold text-[color:var(--kub-cyan)] hover:text-[color:var(--kub-cyan-hover)]"
          >
            Политикой конфиденциальности
          </Link>
          .
        </p>
      </div>
    </div>
  );
}

function isExistingAccountSignupError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const record = err as Record<string, unknown>;
  const code = typeof record.code === "string" ? record.code.toLowerCase() : "";
  const message = typeof record.message === "string" ? record.message.toLowerCase() : "";
  const status = typeof record.status === "number" ? record.status : null;

  return (
    (status === null || status === 400) &&
    (code === "user_already_exists" ||
      code === "email_exists" ||
      message.includes("already registered") ||
      message.includes("already exists"))
  );
}
