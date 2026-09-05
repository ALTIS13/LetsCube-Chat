import { useEffect, useRef, useState } from "react";
import { KubButton, KubIcon } from "@/components/kub";
import { useDesktopUpdate } from "@/hooks/useDesktopUpdate";
import { cn } from "@/lib/utils";

const DESKTOP_VERSION_STORAGE_KEY = "letscube:desktop:last-installed-version";
const UPDATE_SUCCESS_VISIBLE_MS = 4_200;

export function DesktopUpdatePill() {
  const update = useDesktopUpdate();
  const [showUpdateSuccess, setShowUpdateSuccess] = useState(false);
  const snapshot = update?.snapshot ?? null;

  useEffect(() => {
    if (snapshot?.channel !== "stable" || snapshot.phase !== "current") {
      setShowUpdateSuccess(false);
      return undefined;
    }

    try {
      const previousVersion = window.localStorage.getItem(DESKTOP_VERSION_STORAGE_KEY);
      window.localStorage.setItem(DESKTOP_VERSION_STORAGE_KEY, snapshot.installedVersion);
      const versionChanged = Boolean(previousVersion && previousVersion !== snapshot.installedVersion);
      setShowUpdateSuccess(versionChanged);
      if (!versionChanged) return undefined;

      const timeout = window.setTimeout(() => setShowUpdateSuccess(false), UPDATE_SUCCESS_VISIBLE_MS);
      return () => window.clearTimeout(timeout);
    } catch {
      setShowUpdateSuccess(false);
      return undefined;
    }
  }, [snapshot?.channel, snapshot?.installedVersion, snapshot?.phase]);

  if (!update?.snapshot || !update.presentation) return null;

  const { snapshot: activeSnapshot, presentation, commandPending } = update;
  if (presentation.blocking) {
    return (
      <CriticalUpdateGate
        title={presentation.title}
        description={presentation.description}
        pending={commandPending}
        onInstall={() => void update.install()}
      />
    );
  }

  if (!presentation.persistent) {
    if (!showUpdateSuccess) return null;
    return (
      <aside
        className="desktop-update-pill desktop-update-pill--success"
        role="status"
        aria-live="polite"
        data-testid="desktop-update-pill"
        data-update-success="true"
      >
        <span className="desktop-update-pill__icon" aria-hidden="true">
          <KubIcon name="checkCircle" size={17} />
        </span>
        <span className="min-w-0">
          <strong className="block truncate text-xs font-semibold text-[color:var(--kub-text)]">
            Обновление установлено
          </strong>
          <span className="block truncate text-[11px] text-[color:var(--kub-muted)]">
            Версия {activeSnapshot.installedVersion} готова к работе
          </span>
        </span>
      </aside>
    );
  }

  const action = presentation.action;
  return (
    <aside
      className={cn("desktop-update-pill", activeSnapshot.channel === "test" && "desktop-update-pill--test")}
      aria-live="polite"
      data-testid="desktop-update-pill"
      data-phase={activeSnapshot.phase}
      data-channel={activeSnapshot.channel}
    >
      <span className="desktop-update-pill__icon" aria-hidden="true">
        <KubIcon
          name={activeSnapshot.phase === "failed" ? "warning" : activeSnapshot.phase === "downloading" ? "cloud" : "zap"}
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
          <span
            className="desktop-update-pill__progress"
            role="progressbar"
            aria-label="Загрузка обновления"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={presentation.progress}
            aria-valuetext={`Загружено ${presentation.progress}%`}
          >
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

type CriticalUpdateGateProps = {
  title: string;
  description: string;
  pending: boolean;
  onInstall: () => void;
};

function CriticalUpdateGate({ title, description, pending, onInstall }: CriticalUpdateGateProps) {
  const gateRef = useRef<HTMLDivElement>(null);
  const installRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const gate = gateRef.current;
    const focusInstall = () => installRef.current?.focus();
    const frame = window.requestAnimationFrame(focusInstall);

    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !gate) return;
      const focusable = Array.from(gate.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      if (focusable.length === 0) {
        event.preventDefault();
        gate.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement;
      if (event.shiftKey && (current === first || !gate.contains(current))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || !gate.contains(current))) {
        event.preventDefault();
        first.focus();
      }
    };

    gate?.addEventListener("keydown", trapFocus);
    return () => {
      window.cancelAnimationFrame(frame);
      gate?.removeEventListener("keydown", trapFocus);
      window.queueMicrotask(() => {
        if (previousFocus?.isConnected) previousFocus.focus();
      });
    };
  }, []);

  return (
    <div
      ref={gateRef}
      // The scrim dims the shell; it does not erase it. At 94% of --kub-bg with
      // a blur of its own this wrote the material by hand and then left the
      // panel over it a flat rectangle to sample, so the gate read as a plain
      // dark box rather than as a sheet over the application. Same value the
      // product's own Radix dialogs settled on, for the same reason, so the two
      // layers cannot drift apart.
      className="desktop-update-gate fixed inset-0 z-[75] flex items-center justify-center bg-black/45 px-4"
      data-testid="desktop-critical-update-gate"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="desktop-critical-update-title"
      aria-describedby="desktop-critical-update-description"
      tabIndex={-1}
    >
      {/* `-strong`, and no shadow of its own: this covers the whole shell, and
          the material already carries --glass-shadow. It is the same substance
          the Tauri startup window's own dialogs are made of, which matters more
          here than matching the browser. */}
      <section className="kub-glass-strong w-full max-w-md rounded-2xl border border-[color:var(--kub-pink)]/45 p-6 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--kub-pink)_18%,transparent)] text-[color:var(--kub-pink)]">
          <KubIcon name="shield" size={25} />
        </span>
        <h2 id="desktop-critical-update-title" className="mt-4 text-lg font-semibold text-[color:var(--kub-text)]">
          {title}
        </h2>
        <p id="desktop-critical-update-description" className="mt-2 text-sm leading-relaxed text-[color:var(--kub-muted)]">
          {description}
        </p>
        <KubButton
          ref={installRef}
          className="mt-5"
          loading={pending}
          onClick={onInstall}
          leftIcon={<KubIcon name="cloud" size={15} />}
          data-testid="desktop-critical-update-install"
        >
          Скачать и установить
        </KubButton>
      </section>
    </div>
  );
}
