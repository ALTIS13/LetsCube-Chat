import { useState } from "react";
import { useLocation, Link } from "wouter";
import { createClient } from "@/lib/supabase/client";
import { KubButton, KubIcon, KubInput, KubLogo, KubPanel } from "@/components/kub";
import { mapPgError } from "@/lib/errors";

interface BanInfo {
  reason: string;
  expires_at: string | null;
}

export function LoginForm() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [banInfo, setBanInfo] = useState<BanInfo | null>(null);

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

  const fmt = (s: string) =>
    new Date(s).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <div className="min-h-screen flex items-center justify-center px-4 kub-grid-bg">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-4 mb-8">
          <KubLogo size={72} withGlow />
          <div className="text-center">
            <h1 className="text-3xl font-extrabold tracking-tight kub-text-gradient">
              КУБ
            </h1>
            <p className="text-sm mt-1 text-[color:var(--kub-muted)]">
              Панель связи киберарены
            </p>
          </div>
        </div>

        <KubPanel glow="soft" padded={false} className="overflow-hidden">
          <div className="px-3 py-2 border-b border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)]/50">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--kub-cyan)]">
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
                <div className="flex items-center gap-2 font-semibold text-sm text-[color:var(--kub-danger)]">
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

            <form onSubmit={handleLogin} className="flex flex-col gap-3">
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
                Войти
              </KubButton>
            </form>
          </div>
        </KubPanel>

        <p className="text-center text-sm mt-5 text-[color:var(--kub-muted)]">
          Нет аккаунта?{" "}
          <Link
            href="/register"
            className="font-semibold text-[color:var(--kub-cyan)] hover:text-[color:var(--kub-cyan-hover)] transition-colors"
          >
            Зарегистрироваться
          </Link>
        </p>
      </div>
    </div>
  );
}
