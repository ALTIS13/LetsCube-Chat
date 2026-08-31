import { Link } from "wouter";
import { useReleaseCatalog, type ReleaseCatalogUiState } from "@/hooks/useReleaseCatalog";
import { PublicPageShell } from "./PublicPageShell";

const RELEASE_STATE_LABELS: Record<ReleaseCatalogUiState, string> = {
  checking: "Проверяем версию",
  preparing: "Готовится к выпуску",
  available: "Stable доступна",
  current: "Установлена актуальная версия",
  update_available: "Доступно обновление",
  offline_cached: "Показаны сохранённые данные",
  unavailable: "Временно недоступно",
};

export function PublicHomePage() {
  const windowsRelease = useReleaseCatalog("windows_download");
  const androidRelease = useReleaseCatalog("android_download");

  return (
    <PublicPageShell>
      <main>
        <section
          aria-labelledby="public-home-title"
          className="mx-auto flex min-h-[58vh] w-full max-w-7xl flex-col justify-center gap-6 px-4 py-16 sm:px-6 lg:px-8"
        >
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase text-[color:var(--kub-cyan)]">LETSCUBE</p>
            <h1 id="public-home-title" className="mt-3 text-4xl font-bold text-[color:var(--kub-text)] sm:text-5xl">
              Мессенджер для общения и совместной работы
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-[color:var(--kub-muted)] sm:text-lg">
              Переписка, звонки, файлы и задачи доступны в браузере и приложениях LETSCUBE.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/login"
              className="inline-flex min-h-11 items-center justify-center rounded-md bg-[var(--kub-cyan)] px-5 text-sm font-semibold text-[var(--kub-bg)]"
            >
              Открыть веб-версию
            </Link>
            <Link
              href="/download?platform=windows"
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-[color:var(--kub-border-color)] px-5 text-sm font-semibold text-[color:var(--kub-text)]"
            >
              Скачать для Windows
            </Link>
            <Link
              href="/download?platform=android"
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-[color:var(--kub-border-color)] px-5 text-sm font-semibold text-[color:var(--kub-text)]"
            >
              Скачать для Android
            </Link>
          </div>
        </section>

        <section
          aria-labelledby="public-platforms-title"
          className="border-t border-[color:var(--kub-border-color)] bg-[var(--kub-surface)]"
        >
          <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
            <h2 id="public-platforms-title" className="text-2xl font-bold text-[color:var(--kub-text)]">
              Приложения LETSCUBE
            </h2>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <ReleasePlaceholder title="Windows" state={windowsRelease.state} />
              <ReleasePlaceholder title="Android" state={androidRelease.state} />
            </div>
          </div>
        </section>
      </main>
    </PublicPageShell>
  );
}

function ReleasePlaceholder({ title, state }: { title: string; state: ReleaseCatalogUiState }) {
  return (
    <article className="border-t border-[color:var(--kub-border-color)] py-5">
      <h3 className="text-lg font-semibold text-[color:var(--kub-text)]">{title}</h3>
      <p className="mt-1 text-sm text-[color:var(--kub-muted)]">{RELEASE_STATE_LABELS[state]}</p>
    </article>
  );
}
