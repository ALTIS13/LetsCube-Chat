import { KubButton, KubIcon } from "@/components/kub";
import { useDesktopUpdate } from "@/hooks/useDesktopUpdate";
import { cn } from "@/lib/utils";

export function DesktopUpdatePill() {
  const update = useDesktopUpdate();
  if (!update?.snapshot || !update.presentation) return null;

  const { snapshot, presentation, commandPending } = update;
  if (presentation.blocking) {
    return (
      <div
        className="desktop-update-gate fixed inset-0 z-[75] flex items-center justify-center bg-[color:var(--kub-bg)]/94 px-4 backdrop-blur-md"
        data-testid="desktop-critical-update-gate"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="desktop-critical-update-title"
      >
        <section className="w-full max-w-md rounded-2xl border border-[color:var(--kub-pink)]/45 bg-[var(--kub-surface)] p-6 text-center shadow-2xl">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--kub-pink)_18%,var(--kub-surface))] text-[color:var(--kub-pink)]">
            <KubIcon name="shield" size={25} />
          </span>
          <h2 id="desktop-critical-update-title" className="mt-4 text-lg font-semibold text-[color:var(--kub-text)]">
            {presentation.title}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-[color:var(--kub-muted)]">
            {presentation.description}
          </p>
          <KubButton
            className="mt-5"
            loading={commandPending}
            onClick={() => void update.install()}
            leftIcon={<KubIcon name="cloud" size={15} />}
            data-testid="desktop-critical-update-install"
          >
            Скачать и установить
          </KubButton>
        </section>
      </div>
    );
  }

  if (!presentation.persistent) {
    return (
      <button
        type="button"
        className="desktop-update-pill desktop-update-pill--collapsed"
        onClick={() => void update.check()}
        disabled={commandPending}
        aria-label="Проверить обновления LETSCUBE"
        title="LETSCUBE обновлён"
        data-testid="desktop-update-pill"
        data-collapsed="true"
      >
        <KubIcon name={commandPending ? "spinner" : "checkCircle"} size={17} />
      </button>
    );
  }

  const action = presentation.action;
  return (
    <aside
      className={cn("desktop-update-pill", snapshot.channel === "test" && "desktop-update-pill--test")}
      aria-live="polite"
      data-testid="desktop-update-pill"
      data-phase={snapshot.phase}
      data-channel={snapshot.channel}
    >
      <span className="desktop-update-pill__icon" aria-hidden="true">
        <KubIcon
          name={snapshot.phase === "failed" ? "warning" : snapshot.phase === "downloading" ? "cloud" : "zap"}
          size={17}
        />
      </span>
      <span className="min-w-0 flex-1">
        <strong className="block truncate text-xs font-semibold text-[color:var(--kub-text)]">
          {presentation.title}
        </strong>
        <span className="block truncate text-[11px] text-[color:var(--kub-muted)]">
          {presentation.description}
        </span>
        {presentation.progress !== null && (
          <span className="desktop-update-pill__progress" aria-label={`Загружено ${presentation.progress}%`}>
            <span style={{ width: `${presentation.progress}%` }} />
          </span>
        )}
      </span>
      {action && (
        <button
          type="button"
          className="desktop-update-pill__action"
          onClick={() => void (action === "install" ? update.install() : update.check())}
          disabled={commandPending}
          aria-label={action === "install" ? "Установить обновление" : "Повторить проверку"}
        >
          <KubIcon name={commandPending ? "spinner" : action === "install" ? "cloud" : "rotate"} size={15} />
        </button>
      )}
    </aside>
  );
}
