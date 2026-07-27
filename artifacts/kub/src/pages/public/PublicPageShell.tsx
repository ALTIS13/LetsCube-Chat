import type { ReactNode } from "react";
import { Link } from "wouter";
import { KubBrandLogo, KubIcon } from "@/components/kub";
import { useTheme } from "@/hooks/useTheme";

interface PublicPageShellProps {
  children: ReactNode;
}

export function PublicPageShell({ children }: PublicPageShellProps) {
  const { resolvedTheme } = useTheme();
  const logoTone = resolvedTheme === "light" ? "dark" : "light";

  return (
    <div
      data-testid="public-scroll-root"
      className="h-dvh overflow-x-hidden overflow-y-auto bg-[var(--kub-bg)] text-[color:var(--kub-text)]"
    >
      <header className="public-page-print-hide sticky top-0 z-30 border-b border-[color:var(--kub-border-color)] bg-[color:var(--kub-surface)]/95 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
          <Link
            href="/"
            aria-label="Открыть LETSCUBE"
            className="inline-flex min-w-0 items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--kub-cyan)]"
          >
            <KubBrandLogo variant="mark" imgClassName="h-7 w-7 sm:hidden" />
            <KubBrandLogo
              variant="horizontal"
              tone={logoTone}
              className="hidden sm:inline-flex"
              imgClassName="h-7 w-auto max-w-[180px]"
            />
          </Link>
          <nav
            aria-label="Публичные страницы"
            className="ml-auto flex items-center gap-1 text-xs font-semibold sm:gap-3 sm:text-sm"
          >
            <Link
              href="/privacy"
              className="rounded-md px-2 py-2 text-[color:var(--kub-text)] transition-colors hover:bg-[var(--kub-surface-2)]"
            >
              Конфиденциальность
            </Link>
            <Link
              href="/support"
              className="hidden rounded-md px-2 py-2 text-[color:var(--kub-text)] transition-colors hover:bg-[var(--kub-surface-2)] sm:inline-flex"
            >
              Поддержка
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--kub-cyan)] px-3 py-2 text-[color:var(--kub-bg)] transition-colors hover:bg-[var(--kub-cyan-hover)]"
            >
              <KubIcon name="lock" size={14} />
              Войти
            </Link>
          </nav>
        </div>
      </header>

      {children}

      <footer className="public-page-print-hide border-t border-[color:var(--kub-border-color)] bg-[var(--kub-surface)]">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 py-7 text-xs text-[color:var(--kub-muted)] sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>© {new Date().getFullYear()} ООО «КУБ». LETSCUBE.</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <a
              href="mailto:privacy@app.letscube.ru"
              className="hover:text-[color:var(--kub-cyan)]"
            >
              privacy@app.letscube.ru
            </a>
            <a
              href="mailto:support@app.letscube.ru"
              className="hover:text-[color:var(--kub-cyan)]"
            >
              support@app.letscube.ru
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
