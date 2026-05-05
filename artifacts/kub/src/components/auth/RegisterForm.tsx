import { useState } from "react";
import { Link } from "wouter";
import { createClient } from "@/lib/supabase/client";
import { KubButton, KubIcon, KubInput, KubLogo, KubPanel } from "@/components/kub";
import { mapPgError } from "@/lib/errors";
import { getAuthCallbackUrl } from "@/lib/authRedirect";

export function RegisterForm() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const supabase = createClient();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName },
          emailRedirectTo: getAuthCallbackUrl(),
        },
      });
      if (error) throw error;
      setSuccess(true);
    } catch (err: unknown) {
      setError(mapPgError(err));
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 kub-grid-bg">
        <div className="w-full max-w-sm text-center">
          <div className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-5 bg-[color-mix(in_srgb,var(--kub-online)_18%,transparent)] border border-[color:var(--kub-online)]/40 text-[color:var(--kub-online)] kub-glow-soft">
            <KubIcon name="mailCheck" size={32} label="Письмо отправлено" />
          </div>
          <h2 className="text-xl font-bold mb-2 text-[color:var(--kub-text)]">
            Проверьте почту
          </h2>
          <p className="text-sm text-[color:var(--kub-muted)]">
            Мы отправили ссылку для подтверждения на{" "}
            <span className="text-[color:var(--kub-cyan)] font-medium">{email}</span>.<br />
            Перейдите по ней, чтобы активировать аккаунт.
          </p>
          <Link
            href="/login"
            className="inline-flex items-center justify-center mt-6 h-11 px-5 rounded-lg text-sm font-semibold transition-colors bg-[var(--kub-cyan)] text-[color:var(--kub-bg)] hover:bg-[var(--kub-cyan-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--kub-cyan)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--kub-bg)] kub-glow-cyan"
          >
            К входу
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 kub-grid-bg">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-4 mb-8">
          <KubLogo size={72} withGlow />
          <div className="text-center">
            <h1 className="text-2xl font-bold text-[color:var(--kub-text)]">
              Создать аккаунт
            </h1>
            <p className="text-sm mt-1 text-[color:var(--kub-muted)]">
              Присоединяйтесь к КУБу
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
        </p>
      </div>
    </div>
  );
}
