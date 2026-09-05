import { useState } from "react";
import { useLocation, Link } from "wouter";
import { AuthCaptcha } from "@/components/auth/AuthCaptcha";
import { createClient } from "@/lib/supabase/client";
import { KubBrandLogo, KubButton, KubIcon, KubInput, KubPanel } from "@/components/kub";
import { kubBrandAsset } from "@/components/kub/brandAssets";
import { mapPgError } from "@/lib/errors";
import { CONFIRMATION_LINK_INVALID_MESSAGE } from "@/lib/authRedirect";
import {
  getAuthCaptchaConfig,
  getAuthCaptchaRequiredMessage,
  getAuthCaptchaUnavailableMessage,
  isAuthCaptchaEnabled,
} from "@/lib/authCaptcha";
import { requestAuthGateway } from "@/lib/authGateway";
import { useTheme } from "@/hooks/useTheme";

interface BanInfo {
  reason: string;
  expires_at: string | null;
}

function getInitialAuthNotice(): string {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  if (params.get("confirmed") === "1") {
    return "Почта подтверждена. Теперь войдите в аккаунт.";
  }
  if (params.get("auth_error") === "confirmation_link") {
    return CONFIRMATION_LINK_INVALID_MESSAGE;
  }
  if (params.get("password_reset") === "1") {
    return "Пароль обновлён. Теперь войдите с новым паролем.";
  }
  return "";
}

export function LoginForm() {
  const [, setLocation] = useLocation();
  const { resolvedTheme } = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(getInitialAuthNotice);
  const [resetMode, setResetMode] = useState(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("reset") === "1";
  });
  const [banInfo, setBanInfo] = useState<BanInfo | null>(null);
  const [resetCaptchaToken, setResetCaptchaToken] = useState("");
  const [resetCaptchaResetSignal, setResetCaptchaResetSignal] = useState(0);

  const supabase = createClient();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBanInfo(null);
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      const uid = data.user?.id;
      if (uid) {
        const { data: bans, error: bansErr } = await supabase
          .from("bans")
          .select("reason, expires_at")
          .eq("user_id", uid)
          .order("created_at", { ascending: false });
        if (bansErr) {
          await supabase.auth.signOut();
          throw new Error("Не удалось проверить статус блокировки. Попробуйте ещё раз.");
        }
        const now = Date.now();
        const active = (bans ?? []).find(
          (b) => !b.expires_at || new Date(b.expires_at).getTime() > now
        );
        if (active) {
          setBanInfo(active);
          await supabase.auth.signOut();
          setLoading(false);
          return;
        }
      }
      setLocation("/");
    } catch (err: unknown) {
      setError(mapPgError(err));
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setError("Введите адрес эл. почты, чтобы получить ссылку для сброса пароля.");
      return;
    }
    const captchaConfig = getAuthCaptchaConfig();
    if (!captchaConfig) {
      setError(getAuthCaptchaUnavailableMessage());
      return;
    }
    if (!resetCaptchaToken) {
      setError(getAuthCaptchaRequiredMessage());
      return;
    }
    setError("");
    setResetLoading(true);
    try {
      await requestAuthGateway({
        action: "recovery",
        email: cleanEmail,
        captchaToken: resetCaptchaToken,
        captchaProvider: captchaConfig.provider,
      });
      setNotice("Если такая эл. почта зарегистрирована, письмо со ссылкой для сброса пароля придёт на почту.");
      setResetMode(false);
    } catch (err: unknown) {
      setError(mapPgError(err));
    } finally {
      if (isAuthCaptchaEnabled()) {
        setResetCaptchaToken("");
        setResetCaptchaResetSignal((value) => value + 1);
      }
      setResetLoading(false);
    }
  };

  const fmt = (s: string) =>
    new Date(s).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

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
            <p className="text-sm text-[color:var(--kub-muted)]">
              Защищённый мессенджер
            </p>
          </div>
        </div>

        <KubPanel glow="soft" padded={false} className="overflow-hidden">
          <div className="px-3 py-2 border-b border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)]/50">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--kub-accent-text)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--kub-cyan)] kub-pulse" />
              Авторизация
            </div>
          </div>

          <div className="p-5 space-y-4">
            {banInfo && (
              <div
                className="rounded-xl p-4 text-left text-xs space-y-1.5"
                style={{
                  background: "color-mix(in srgb, var(--kub-danger) 10%, transparent)",
                  border: "1px solid color-mix(in srgb, var(--kub-danger) 35%, transparent)",
                }}
              >
                <div className="flex items-center gap-2 font-semibold text-sm text-[color:var(--kub-danger-text)]">
                  <KubIcon name="ban" size={14} />
                  Аккаунт заблокирован
                </div>
                <div className="text-[color:var(--kub-text)]">
                  <span className="text-[color:var(--kub-muted)]">Причина: </span>
                  {banInfo.reason}
                </div>
                <div className="text-[color:var(--kub-text)]">
                  <span className="text-[color:var(--kub-muted)]">До: </span>
                  {banInfo.expires_at ? fmt(banInfo.expires_at) : "бессрочно"}
                </div>
              </div>
            )}

            {notice && !error && (
              <p className="text-xs text-[color:var(--kub-accent-text)] px-1">{notice}</p>
            )}

            <form onSubmit={resetMode ? handlePasswordReset : handleLogin} className="flex flex-col gap-3">
              <KubInput
                type="email"
                placeholder="Эл. почта"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                leftIcon={<KubIcon name="mail" size={16} />}
                autoComplete="email"
              />

              {!resetMode && (
                <KubInput
                  type={showPass ? "text" : "password"}
                  placeholder="Пароль"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  leftIcon={<KubIcon name="lock" size={16} />}
                  autoComplete="current-password"
                  rightSlot={
                    <button
                      type="button"
                      onClick={() => setShowPass(!showPass)}
                      // The icon stays 16px; the hit area does not. It was a
                      // 16x16 target inside a 44px field, so the reveal toggle
                      // was the hardest thing on the form to tap. The negative
                      // margin keeps the field's height unchanged. See D-013.
                      className="-my-3 flex h-11 w-11 shrink-0 items-center justify-center text-[color:var(--kub-muted)] hover:text-[color:var(--kub-text)] transition-colors"
                      aria-label={showPass ? "Скрыть пароль" : "Показать пароль"}
                    >
                      <KubIcon name={showPass ? "eyeOff" : "eye"} size={16} />
                    </button>
                  }
                />
              )}

              {resetMode && (
                <AuthCaptcha
                  onTokenChange={setResetCaptchaToken}
                  required
                  resetSignal={resetCaptchaResetSignal}
                />
              )}

              {error && (
                <p className="text-xs text-[color:var(--kub-danger-text)] px-1">{error}</p>
              )}

              <KubButton
                type="submit"
                loading={resetMode ? resetLoading : loading}
                fullWidth
                size="lg"
                className="mt-1"
              >
                {resetMode ? "Отправить ссылку" : "Войти"}
              </KubButton>
              <button
                type="button"
                onClick={() => {
                  setResetMode((v) => !v);
                  setError("");
                  setResetCaptchaToken("");
                  setResetCaptchaResetSignal((value) => value + 1);
                }}
                // A standalone action, not a link inside a sentence, so it is
                // held to the target size. The padding grows the hit area
                // without changing the type size. See D-013.
                className="mx-auto inline-flex min-h-11 items-center justify-center px-3 text-xs font-semibold text-[color:var(--kub-accent-text)] hover:text-[color:var(--kub-cyan-hover)] transition-colors"
              >
                {resetMode ? "Вернуться ко входу" : "Забыли пароль?"}
              </button>
            </form>
          </div>
        </KubPanel>

        <p className="text-center text-sm mt-5 text-[color:var(--kub-muted)]">
          Нет аккаунта?{" "}
          <Link
            href="/register"
            className="font-semibold text-[color:var(--kub-accent-text)] hover:text-[color:var(--kub-cyan-hover)] transition-colors"
          >
            Зарегистрироваться
          </Link>
        </p>
        <p className="mt-3 text-center text-[11px] leading-5 text-[color:var(--kub-muted)]">
          Используя LETSCUBE, вы подтверждаете, что ознакомились с{" "}
          <Link
            href="/privacy"
            className="font-semibold text-[color:var(--kub-accent-text)] hover:text-[color:var(--kub-cyan-hover)]"
          >
            Политикой конфиденциальности
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
