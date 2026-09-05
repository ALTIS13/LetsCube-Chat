import { Link } from "wouter";

import { PlatformShowcase } from "@/components/public/PlatformShowcase";
import { ReleaseChangelog } from "@/components/public/ReleaseChangelog";
import { usePublicReleaseCatalog } from "@/hooks/usePublicReleaseCatalog";
import { PublicPageShell } from "./PublicPageShell";

/**
 * The full downloads surface.
 *
 * Same platform sections as the home page, with every platform present rather
 * than the visitor's own first. Availability comes only from the release
 * catalog.
 */
export function DownloadPage() {
  const { platforms, changelog, refresh } = usePublicReleaseCatalog();

  return (
    <PublicPageShell>
      <main className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <header className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-wide text-[color:var(--kub-accent-text)]">Загрузки</p>
          <h1 className="mt-2 text-3xl font-bold text-[color:var(--kub-text)] sm:text-4xl">
            Приложения LETSCUBE
          </h1>
          <p className="mt-3 text-base leading-7 text-[color:var(--kub-muted)]">
            Файлы загружаются напрямую из каталога релизов LETSCUBE и не требуют входа. Версия и
            дата берутся из того же каталога, что и обновления в самих приложениях.
          </p>
        </header>

        {/* The platforms are cards now, so the space between them is a gap
            rather than the rule that used to separate two stretches of the
            same page. */}
        <div className="mt-8 grid gap-4 sm:gap-5">
          {platforms.map((platform) => (
            <PlatformShowcase key={platform.platform} platform={platform} onRetry={refresh} />
          ))}
        </div>

        <ReleaseChangelog entry={changelog} />

        <section
          aria-labelledby="web-version-title"
          // The browser is the universal fallback and it needs no download, so
          // it is a released surface like Windows and Android: the same
          // material, the same box.
          className="kub-glass mt-4 rounded-2xl border border-[color:var(--kub-border-color)] p-5 sm:mt-5 sm:p-8"
        >
          <h2 id="web-version-title" className="text-xl font-semibold text-[color:var(--kub-text)]">
            Веб-версия
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[color:var(--kub-muted)]">
            Работает без установки в современном браузере на любой системе, включая macOS и iPhone.
          </p>
          <Link
            href="/login"
            className="mt-5 inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--kub-action-primary-background)] px-5 text-sm font-semibold text-[color:var(--kub-action-primary-foreground)] transition-colors hover:bg-[var(--kub-action-primary-hover)]"
          >
            Открыть веб-версию
          </Link>
        </section>
      </main>
    </PublicPageShell>
  );
}
