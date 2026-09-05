import type { ReactNode, RefObject } from "react";
import { Link } from "wouter";
import { KubBrandLogo, KubIcon } from "@/components/kub";
import { useTheme } from "@/hooks/useTheme";

interface PublicPageShellProps {
  children: ReactNode;
  scrollRootRef?: RefObject<HTMLDivElement | null>;
}

export function PublicPageShell({ children, scrollRootRef }: PublicPageShellProps) {
  const { resolvedTheme } = useTheme();
  const logoTone = resolvedTheme === "light" ? "dark" : "light";

  return (
    <div
      ref={scrollRootRef}
      data-testid="public-scroll-root"
      className="h-dvh overflow-x-hidden overflow-y-auto bg-[var(--kub-bg)] text-[color:var(--kub-text)]"
    >
      <header className="public-page-print-hide sticky top-0 z-30 border-b border-[color:var(--kub-border-color)] bg-[color:var(--kub-surface)]/95 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
          <Link
            href="/"
            aria-label="Открыть LETSCUBE"
            // `min-h-11` makes the header controls real targets on a phone; the marks
            // and labels keep their size. See D-013.
            className="inline-flex min-h-11 min-w-0 items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--kub-cyan)]"
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
              className="inline-flex min-h-11 items-center rounded-md px-2 py-2 text-[color:var(--kub-text)] transition-colors kub-raise-hover"
            >
              Конфиденциальность
            </Link>
            <Link
              href="/support"
              className="hidden min-h-11 items-center rounded-md px-2 py-2 text-[color:var(--kub-text)] transition-colors kub-raise-hover sm:inline-flex"
            >
              Поддержка
            </Link>
            <Link
              href="/login"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-[var(--kub-cyan)] px-3 py-2 text-[color:var(--kub-bg)] transition-colors hover:bg-[var(--kub-cyan-hover)]"
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
              // Standalone footer contacts, not links inside a sentence, so they
              // are held to the target size. See D-013.
              className="inline-flex min-h-11 items-center hover:text-[color:var(--kub-accent-text)]"
            >
              privacy@app.letscube.ru
            </a>
            <a
              href="mailto:support@app.letscube.ru"
              // Standalone footer contacts, not links inside a sentence, so they
              // are held to the target size. See D-013.
              className="inline-flex min-h-11 items-center hover:text-[color:var(--kub-accent-text)]"
            >
              support@app.letscube.ru
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
