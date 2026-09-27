import { useEffect, useRef } from "react";
import { KubButton, KubIcon } from "@/components/kub";
import { useDesktopUpdate } from "@/hooks/useDesktopUpdate";

const DESKTOP_VERSION_STORAGE_KEY = "letscube:desktop:last-installed-version";
const UPDATE_SUCCESS_VISIBLE_MS = 4_200;

/**
 * A required shell update: the one offer that is not the caption's to make.
 *
 * Everything else this drew — an update available, downloading, installing or
 * failed, the test channel, and «Обновление установлено» — is now drawn in the
 * window's caption by `CaptionUpdateButton` (tracker item 42), beside the
 * window's own buttons, where Discord's desktop client keeps its update arrow.
 * A required update still blocks the window until it is installed.
 */
export function DesktopUpdatePill() {
  const update = useDesktopUpdate();
  if (!update?.snapshot || !update.presentation?.blocking) return null;
  const { presentation, commandPending } = update;
  return (
    <CriticalUpdateGate
      title={presentation.title}
      description={presentation.description}
      pending={commandPending}
      onInstall={() => void update.install()}
    />
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
