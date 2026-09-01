import { useMemo } from "react";
import { Link } from "wouter";

import { PlatformShowcase } from "@/components/public/PlatformShowcase";
import { ReleaseChangelog } from "@/components/public/ReleaseChangelog";
import { ReleaseDownloadAction } from "@/components/public/ReleaseDownloadAction";
import { usePublicReleaseCatalog } from "@/hooks/usePublicReleaseCatalog";
import { describePublicAvailability } from "@/lib/publicReleaseModel";
import { useTheme } from "@/hooks/useTheme";
import { getCurrentDistributionTarget } from "@/lib/platform/capabilities";
import { PublicPageShell } from "./PublicPageShell";

/**
 * The public LETSCUBE home.
 *
 * The product itself is the illustration: the band under the heading is a
 * screenshot of the shipping interface, matched to the reader's theme. Every
 * availability statement on this page comes from the release catalog through
 * `usePublicReleaseCatalog`, so the page cannot promise a build that does not
 * exist.
 */
export function PublicHomePage() {
  const { platforms, changelog, refresh } = usePublicReleaseCatalog();
  const { resolvedTheme } = useTheme();

  // The visitor's own platform is offered first; everyone else gets the web
  // client, which needs no download at all.
  const preferred = useMemo(() => {
    const target = getCurrentDistributionTarget();
    if (target === "android_download" || target === "android_native") return "android";
    if (target === "windows_download" || target === "windows_native") return "windows";
    return null;
  }, []);

  const preferredPlatform = preferred
    ? platforms.find((platform) => platform.platform === preferred) ?? null
    : null;

  const heroImage = resolvedTheme === "light"
    ? "/product/windows-messenger-light.webp"
    : "/product/windows-messenger-dark.webp";

  return (
    <PublicPageShell>
      <main>
        <section
          aria-labelledby="public-home-title"
          className="mx-auto w-full max-w-7xl px-4 pt-8 sm:px-6 sm:pt-16 lg:px-8"
        >
          <p className="text-sm font-semibold uppercase tracking-wide text-[color:var(--kub-cyan)]">LETSCUBE</p>
          <h1
            id="public-home-title"
            className="mt-3 max-w-3xl text-3xl font-bold leading-tight text-[color:var(--kub-text)] sm:text-4xl lg:text-5xl"
          >
            Мессенджер для общения и совместной работы
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-6 text-[color:var(--kub-muted)] sm:mt-4 sm:leading-7 sm:text-lg">
            Переписка, файлы, задачи и уведомления в браузере, на Windows и на Android. Один аккаунт
            и одна история сообщений на всех устройствах.
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-2 sm:mt-7 sm:gap-3">
            {preferredPlatform && <ReleaseDownloadAction platform={preferredPlatform} onRetry={refresh} />}
            <Link
              href="/login"
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[color:var(--kub-border-color)] px-5 text-sm font-semibold text-[color:var(--kub-text)] transition-colors hover:bg-[var(--kub-surface-2)]"
            >
              Открыть веб-версию
            </Link>
            <Link
              href="/download"
              className="inline-flex min-h-11 items-center justify-center rounded-lg px-3 text-sm font-semibold text-[color:var(--kub-cyan)]"
            >
              Все платформы
            </Link>
          </div>

          {/* The interface is the illustration. The band is deliberately clipped
              at the bottom so the platform sections are visible from here. */}
          <div className="mt-6 max-h-[26vh] overflow-hidden rounded-t-2xl border border-b-0 border-[color:var(--kub-border-color)] sm:mt-10 sm:max-h-[42vh]">
            <img
              src={heroImage}
              alt="Окно LETSCUBE с открытым групповым чатом"
              width={1440}
              height={900}
              decoding="async"
              // The parent's max-height and overflow do the clipping, so the
              // platform sections below are visible from the first viewport.
              className="block h-auto w-full"
            />
          </div>
        </section>

        <section
          aria-labelledby="public-platforms-title"
          className="mx-auto w-full max-w-7xl px-4 pt-8 sm:px-6 sm:pt-12 lg:px-8"
        >
          <h2 id="public-platforms-title" className="text-3xl font-bold text-[color:var(--kub-text)]">
            Приложения LETSCUBE
          </h2>
          {/* Derived, never asserted. A static sentence here would keep saying a
              platform is downloadable after the catalog stopped saying so. */}
          <p className="mt-2 max-w-2xl text-sm text-[color:var(--kub-muted)]">
            {describePublicAvailability(platforms)}
          </p>

          <div className="mt-4">
            {platforms.map((platform) => (
              <PlatformShowcase key={platform.platform} platform={platform} onRetry={refresh} />
            ))}
          </div>
        </section>

        <div className="mx-auto w-full max-w-7xl px-4 pb-16 sm:px-6 lg:px-8">
          <ReleaseChangelog entry={changelog} />
        </div>
      </main>
    </PublicPageShell>
  );
}
