import { Link } from "wouter";
import { useReleaseCatalog, type ReleaseCatalogUiState } from "@/hooks/useReleaseCatalog";
import { PublicPageShell } from "./PublicPageShell";

const RELEASE_STATE_LABELS: Record<ReleaseCatalogUiState, string> = {
  checking: "Проверяем доступность",
  preparing: "Версия готовится к выпуску",
  available: "Stable-версия доступна",
  current: "Установлена актуальная версия",
  update_available: "Доступно обновление",
  offline_cached: "Показаны сохранённые данные",
  unavailable: "Загрузка временно недоступна",
};

export function DownloadPage() {
  const windowsRelease = useReleaseCatalog("windows_download");
  const androidRelease = useReleaseCatalog("android_download");

  return (
    <PublicPageShell>
      <main className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <header className="max-w-2xl">
          <p className="text-sm font-semibold uppercase text-[color:var(--kub-cyan)]">Загрузки</p>
          <h1 className="mt-2 text-3xl font-bold text-[color:var(--kub-text)]">Приложения LETSCUBE</h1>
          <p className="mt-3 text-base leading-7 text-[color:var(--kub-muted)]">
            Выберите платформу. Прямая загрузка Stable-версий появится после проверки каталога релизов.
          </p>
        </header>

        <section aria-label="Доступные платформы" className="mt-10 grid gap-6 md:grid-cols-2">
          <DownloadPlaceholder
            title="Windows"
            action="Скачать для Windows"
            state={windowsRelease.state}
          />
          <DownloadPlaceholder
            title="Android"
            action="Скачать для Android"
            state={androidRelease.state}
          />
        </section>

        <section aria-labelledby="web-version-title" className="mt-12 border-t border-[color:var(--kub-border-color)] pt-8">
          <h2 id="web-version-title" className="text-xl font-semibold text-[color:var(--kub-text)]">
            Веб-версия
          </h2>
          <p className="mt-2 text-sm text-[color:var(--kub-muted)]">Работает без установки в современном браузере.</p>
          <Link
            href="/login"
            className="mt-4 inline-flex min-h-11 items-center justify-center rounded-md bg-[var(--kub-cyan)] px-5 text-sm font-semibold text-[var(--kub-bg)]"
          >
            Открыть веб-версию
          </Link>
        </section>
      </main>
    </PublicPageShell>
  );
}

function DownloadPlaceholder({
  title,
  action,
  state,
}: {
  title: string;
  action: string;
  state: ReleaseCatalogUiState;
}) {
  return (
    <article className="border-t border-[color:var(--kub-border-color)] py-5">
      <h2 className="text-xl font-semibold text-[color:var(--kub-text)]">{title}</h2>
      <p className="mt-2 text-sm text-[color:var(--kub-muted)]">{RELEASE_STATE_LABELS[state]}</p>
      <button
        type="button"
        disabled
        aria-disabled="true"
        className="mt-5 inline-flex min-h-11 cursor-not-allowed items-center justify-center rounded-md border border-[color:var(--kub-border-color)] px-5 text-sm font-semibold text-[color:var(--kub-muted)] opacity-70"
      >
        {action}
      </button>
    </article>
  );
}
