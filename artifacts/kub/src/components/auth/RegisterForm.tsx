import { useState } from "react";
import { Link, useLocation } from "wouter";
import { AuthCaptcha } from "@/components/auth/AuthCaptcha";
import { createNonPersistedAuthClient } from "@/lib/supabase/client";
import { KubBrandLogo, KubButton, KubIcon, KubInput, KubPanel } from "@/components/kub";
import { kubBrandAsset } from "@/components/kub/brandAssets";
import { getAuthCallbackUrl } from "@/lib/authRedirect";
import { getAuthCaptchaRequiredMessage, isAuthCaptchaEnabled, shouldUseAuthCaptchaGateway } from "@/lib/authCaptcha";
import { requestAuthGateway } from "@/lib/authGateway";
import { mapPgError } from "@/lib/errors";
import { PROFILE_LIMITS, normalizeFullName, validateFullName } from "@/lib/profileValidation";

export function RegisterForm() {
  const [, setLocation] = useLocation();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaResetSignal, setCaptchaResetSignal] = useState(0);

  const supabase = createNonPersistedAuthClient();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const fullNameError = validateFullName(fullName);
      if (fullNameError) throw new Error(fullNameError);
      if (isAuthCaptchaEnabled() && !captchaToken) {
        throw new Error(getAuthCaptchaRequiredMessage());
      }

      if (shouldUseAuthCaptchaGateway()) {
        await requestAuthGateway({
          action: "signup",
          email: email.trim(),
          password,
          fullName: normalizeFullName(fullName),
          captchaToken,
        });
      } else {
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            captchaToken: captchaToken || undefined,
            data: { full_name: normalizeFullName(fullName) },
            emailRedirectTo: getAuthCallbackUrl(),
          },
        });
        if (error) throw error;
      }

      setSuccess(true);
    } catch (err: unknown) {
      if (isExistingAccountSignupError(err)) {
        setSuccess(true);
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

  if (success) {
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
                tone="light"
                className="h-24 w-56 justify-center"
                imgClassName="max-h-24"
                alt="Letscube"
              />
            </div>
            <p className="text-sm text-[color:var(--kub-muted)]">
              Панель связи киберарены
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
                <h2 className="text-xl font-bold text-[color:var(--kub-text)]">
                  Проверьте почту
                </h2>
                <p className="mt-2 text-sm leading-6 text-[color:var(--kub-muted)]">
                  Если к этому адресу электронной почты ещё не привязан аккаунт,
                  мы отправим вам письмо для подтверждения регистрации. Если
                  письмо не пришло, проверьте папку «Спам» или воспользуйтесь
                  опцией «Восстановить пароль».
                </p>
              </div>
              <div className="grid gap-3 pt-1">
                <KubButton type="button" fullWidth onClick={() => setLocation("/login")}>
                  К входу
                </KubButton>
                <KubButton type="button" variant="secondary" fullWidth onClick={() => setLocation("/login?reset=1")}>
                  Восстановить доступ
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
              tone="light"
              className="h-24 w-56 justify-center"
              imgClassName="max-h-24"
              alt="Letscube"
            />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold text-[color:var(--kub-text)]">
              Создать аккаунт
            </h1>
            <p className="text-sm mt-1 text-[color:var(--kub-muted)]">
              Доступ к панели связи LETSCUBE
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
            <KubInput
              type="text"
              placeholder="Имя и фамилия"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              maxLength={PROFILE_LIMITS.fullNameMax}
              hint={`${fullName.length}/${PROFILE_LIMITS.fullNameMax}`}
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
                  className="text-[color:var(--kub-muted)] hover:text-[color:var(--kub-text)] transition-colors"
                  aria-label={showPass ? "Скрыть пароль" : "Показать пароль"}
                >
                  <KubIcon name={showPass ? "eyeOff" : "eye"} size={16} />
                </button>
              }
            />

            <AuthCaptcha onTokenChange={setCaptchaToken} resetSignal={captchaResetSignal} />

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
          <span className="mx-2 text-[color:var(--kub-border-strong)]">/</span>
          <Link
            href="/login?reset=1"
            className="font-semibold text-[color:var(--kub-cyan)] hover:text-[color:var(--kub-cyan-hover)] transition-colors"
          >
            Восстановить доступ
          </Link>
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
