import { useEffect, useState } from "react";
import { KubButton, KubIcon } from "@/components/kub";
import { usePwaInstall } from "@/hooks/usePwa";
import { useReleaseCatalog, type ReleaseCatalogUiState } from "@/hooks/useReleaseCatalog";
import { getBuildMetadata } from "@/lib/monitoring";
import { getCurrentDistributionTarget } from "@/lib/platform/capabilities";

const STATE_COPY: Record<ReleaseCatalogUiState, string> = {
  checking: "Проверяем доступность приложения",
  preparing: "Версия для загрузки готовится",
  available: "Версия доступна для загрузки",
  current: "Установлена актуальная версия",
  update_available: "Доступно обновление",
  offline_cached: "Показаны последние сохранённые данные",
  unavailable: "Не удалось проверить доступность",
};

export function ReleaseDistributionSection() {
  const target = getCurrentDistributionTarget();
  const {
    installCopy,
    instructionsOpen,
    showInstallButton,
    promptInstall,
  } = usePwaInstall();
  const release = useReleaseCatalog(target);
  const buildMetadata = getBuildMetadata();
  const [handoff, setHandoff] = useState(false);

  useEffect(() => {
    if (!handoff) return;
    const timeout = window.setTimeout(() => setHandoff(false), 2_500);
    return () => window.clearTimeout(timeout);
  }, [handoff]);

  const manifest = release.snapshot?.manifest ?? null;
  const artifact = manifest?.available ? manifest.artifact : null;
  const nativePackage = release.platform !== null;

  return (
    <div
      className="release-distribution-card rounded-xl overflow-hidden bg-[var(--kub-surface-2)] border border-[color:var(--kub-border-color)]"
      data-testid="release-distribution-card"
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 px-4 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
        <KubIcon
          name={target === "windows_download" ? "cloud" : "phone"}
          size={16}
          className="mt-0.5 text-[color:var(--kub-cyan)]"
        />
        <div className="min-w-0 flex-1">
          <div className="text-sm text-[color:var(--kub-text)]" data-testid="pwa-install-title">
            {installCopy.title}
          </div>
          <div className="text-xs text-[color:var(--kub-muted)]" data-testid="pwa-install-description">
            {installCopy.description}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-[color:var(--kub-muted)]">
            <span
              className="rounded-full border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] px-2 py-1"
              data-testid="pwa-install-variant"
            >
              Версия установки: {installCopy.variantLabel}
            </span>
            <span
              className="rounded-full border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] px-2 py-1"
              data-testid="pwa-install-mode"
            >
              Режим: {installCopy.modeLabel}
            </span>
          </div>
          {nativePackage && (
            <div
              className="release-status-enter mt-3 rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] px-3 py-2"
              data-testid="release-catalog-state"
              data-state={release.state}
            >
              <div className="flex min-w-0 items-center gap-2 text-xs text-[color:var(--kub-text)]">
                <span className={release.state === "checking" ? "release-status-pulse" : ""} aria-hidden="true" />
                <span className="min-w-0">{STATE_COPY[release.state]}</span>
              </div>
              {manifest?.available && (
                <div className="mt-1 text-[11px] text-[color:var(--kub-muted)]">
                  Версия {manifest.version} · {formatFileSize(manifest.artifact?.size ?? 0)} · {formatReleaseDate(manifest.publishedAt)}
                </div>
              )}
              {handoff && (
                <div className="mt-2 text-[11px] text-[color:var(--kub-cyan)]" role="status">
                  Загрузка передана системе
                </div>
              )}
            </div>
          )}
        </div>
        {showInstallButton && (
          <KubButton
            size="sm"
            onClick={() => void promptInstall()}
            className="col-span-2 w-full sm:col-span-1 sm:w-auto"
            data-testid="pwa-install-button"
          >
            {installCopy.buttonLabel}
          </KubButton>
        )}
        {artifact && release.state !== "current" && (
          <a
            href={artifact.url}
            download
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setHandoff(true)}
            className="col-span-2 inline-flex h-8 w-full shrink-0 items-center justify-center gap-1.5 rounded-xl bg-[var(--kub-cyan)] px-3 text-xs font-semibold text-[color:var(--kub-bg)] transition-[transform,filter] hover:brightness-110 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--kub-cyan)] sm:col-span-1 sm:w-auto"
            data-testid="release-download-button"
          >
            <KubIcon name="externalLink" size={13} />
            Скачать
          </a>
        )}
        {release.state === "unavailable" && (
          <KubButton
            size="sm"
            variant="secondary"
            onClick={() => void release.refresh()}
            className="col-span-2 w-full sm:col-span-1 sm:w-auto"
          >
            Повторить
          </KubButton>
        )}
      </div>
      {instructionsOpen && target === "ios_pwa" && (
        <div
          className="mx-4 mb-3 rounded-xl border border-[color:var(--kub-cyan)]/25 bg-[color-mix(in_srgb,var(--kub-cyan)_8%,var(--kub-surface))] px-3 py-3"
          data-testid="pwa-install-guidance"
        >
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-[color:var(--kub-text)]">
            <KubIcon name="externalLink" size={13} className="text-[color:var(--kub-cyan)]" />
            {installCopy.instructionTitle}
          </div>
          <ol className="space-y-1 pl-4 text-xs leading-relaxed text-[color:var(--kub-muted)]">
            {installCopy.instructionSteps.map((step) => (
              <li key={step} className="list-decimal">{step}</li>
            ))}
          </ol>
        </div>
      )}
      <div className="border-t border-[color:var(--kub-border-color)] px-4 py-2 text-xs text-[color:var(--kub-muted)]">
        Сборка: {buildMetadata.version}
        {buildMetadata.commit !== "unknown" ? ` · ${buildMetadata.commit.slice(0, 7)}` : ""}
      </div>
    </div>
  );
}

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "размер уточняется";
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(bytes / 1_048_576)} МБ`;
}

function formatReleaseDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "дата не указана";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric" }).format(date);
}
