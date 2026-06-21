import { useLocation } from "wouter";
import { KubBrandLogo, KubButton, KubIcon, KubPanel } from "@/components/kub";
import { kubBrandAsset } from "@/components/kub/brandAssets";

export function RegisterForm() {
  const [, setLocation] = useLocation();

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
            <p className="text-sm text-[color:var(--kub-muted)]">
              Панель связи киберарены
            </p>
          </div>
        </div>

        <KubPanel glow="soft" padded={false} className="overflow-hidden">
          <div className="px-3 py-2 border-b border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)]/50">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--kub-cyan)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--kub-cyan)] kub-pulse" />
              Доступ
            </div>
          </div>

          <div className="p-5 space-y-4">
            <div className="rounded-2xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)]/45 p-4 text-center">
              <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] text-[color:var(--kub-cyan)]">
                <KubIcon name="shield" size={20} />
              </div>
              <h1 className="text-lg font-semibold text-[color:var(--kub-text)]">
                Регистрация закрыта
              </h1>
              <p className="mt-2 text-sm leading-6 text-[color:var(--kub-muted)]">
                Аккаунты LETSCUBE выдаёт администратор клуба. Если доступ уже был
                создан, войдите по email и паролю или восстановите пароль.
              </p>
            </div>

            <div className="grid gap-3">
              <KubButton type="button" fullWidth size="lg" onClick={() => setLocation("/login")}>
                Войти в аккаунт
              </KubButton>
              <KubButton type="button" variant="secondary" fullWidth onClick={() => setLocation("/login?reset=1")}>
                Восстановить доступ
              </KubButton>
            </div>
          </div>
        </KubPanel>

        <p className="text-center text-xs mt-5 text-[color:var(--kub-muted)]">
          Для нового доступа обратитесь к администратору киберарены.
        </p>
      </div>
    </div>
  );
}
