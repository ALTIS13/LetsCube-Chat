import { useEffect, useState, useSyncExternalStore } from "react";

import { KubButton, KubIcon } from "@/components/kub";
import { useDesktopUpdate } from "@/hooks/useDesktopUpdate";
import { useVoiceCall } from "@/hooks/useVoiceCall";
import { restartOntoWaitingBuild } from "@/hooks/usePwa";
import { updateAction } from "@/lib/pwa/appUpdateNotice";
import { currentWebUpdateOffer, subscribeWebUpdateOffer, withdrawWebUpdate } from "@/lib/pwa/webUpdateOffer";
import { markVoiceResumeInterrupted } from "@/lib/voiceResumeStorage";
import { DISABLED_SINK } from "@/lib/controlSurface";
import { cn } from "@/lib/utils";

const DESKTOP_VERSION_STORAGE_KEY = "letscube:desktop:last-installed-version";
const UPDATE_SUCCESS_VISIBLE_MS = 4_200;

/**
 * The update offer where the Windows app keeps it: in the window's own caption,
 * beside minimise, maximise and close (tracker item 42).
 *
 * The owner's request of 2026-09-20 came with a screenshot of Discord's
 * desktop client, whose update arrow sits exactly there; Discord's bundle
 * applies an update from that one control and never on its own
 * (reference-clients §9). Both of ours land here on the desktop: the shell's
 * own installer, which also brings the newest web build, and a new web build
 * on its own. The shell's comes first when both are pending.
 *
 * What is decided elsewhere is unchanged: when the web build is offered, and
 * whether it restarts quietly, is `AppUpdateBanner`'s; a required shell update
 * is still the blocking gate in `DesktopUpdatePill`. In a call, pressing asks
 * first, as the web notice does and as Discord's «Briefly leave voice?» does.
 *
 * The test id stays `desktop-update-pill` with its `data-phase`, `data-channel`
 * and `data-update-success`: this is the same control, moved, and the Windows
 * lifecycle specs find it by that name.
 */
export function CaptionUpdateButton() {
  const update = useDesktopUpdate();
  const webOffer = useSyncExternalStore(subscribeWebUpdateOffer, currentWebUpdateOffer, () => null);
  const call = useVoiceCall();
  const callActive = call.phase === "connected" || call.phase === "joining" || call.phase === "reconnecting";
  const [confirming, setConfirming] = useState<"shell" | "web" | null>(null);
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

  if (!update) return null;
  const presentation = update.presentation;
  if (presentation?.blocking) return null;

  const applyWeb = () => {
    const registration = webOffer?.registration ?? null;
    withdrawWebUpdate();
    markVoiceResumeInterrupted();
    restartOntoWaitingBuild(registration);
  };
  const press = (kind: "shell" | "web", apply: () => void) => {
    if (updateAction({ callActive, acknowledged: confirming === kind }) === "confirm") {
      setConfirming(kind);
      return;
    }
    setConfirming(null);
    apply();
  };

  const shellPhase = snapshot && presentation?.persistent && snapshot.phase !== "checking" ? snapshot.phase : null;
  const confirm = confirming && callActive ? (
    <CaptionConfirm
      onCancel={() => setConfirming(null)}
      onConfirm={() => (confirming === "shell" ? press("shell", () => void update.install()) : press("web", applyWeb))}
    />
  ) : null;

  if (shellPhase && snapshot && presentation) {
    const label = `${presentation.title}. ${presentation.description}`;
    if (shellPhase === "downloading" || shellPhase === "installing") {
      const progress = presentation.progress;
      return (
        <span
          className="flex h-full w-11 items-center justify-center text-[color:var(--kub-cyan)]"
          title={label}
          data-testid="desktop-update-pill"
          data-phase={shellPhase}
          data-channel={snapshot.channel}
          aria-live="polite"
        >
          {shellPhase === "installing" || progress === null ? (
            <KubIcon name="spinner" size={16} spin label={presentation.title} />
          ) : (
            <span
              className="relative flex h-6 w-6 items-center justify-center rounded-full"
              style={{ background: `conic-gradient(var(--kub-cyan) ${progress * 3.6}deg, color-mix(in srgb, var(--kub-cyan) 18%, transparent) 0deg)` }}
              role="progressbar"
              aria-label="Загрузка обновления"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              aria-valuetext={`Загружено ${progress}%`}
            >
              <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[var(--kub-surface)]">
                <KubIcon name="download" size={12} />
              </span>
            </span>
          )}
        </span>
      );
    }
    const failed = shellPhase === "failed";
    const test = snapshot.channel === "test" && shellPhase === "current";
    const install = presentation.action === "install";
    return (
      <span className="relative flex h-full" data-caption-update="">
        <button
          type="button"
          onClick={() => (install ? press("shell", () => void update.install()) : void update.check())}
          disabled={update.commandPending}
          aria-label={install ? `Установить обновление. ${presentation.title}` : `Повторить проверку. ${presentation.title}`}
          title={label}
          data-testid="desktop-update-pill"
          data-phase={shellPhase}
          data-channel={snapshot.channel}
          className={cn(
            "flex h-full min-w-11 items-center justify-center gap-1 px-2 transition-colors kub-raise-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]",
            DISABLED_SINK,
            failed ? "text-[color:var(--kub-warn)]" : test ? "text-[color:var(--kub-warn)]" : "text-[color:var(--kub-online)]",
          )}
        >
          <KubIcon name={update.commandPending ? "spinner" : failed ? "warning" : test ? "rotate" : "download"} size={16} spin={update.commandPending} />
          {test && <span className="text-[11px] font-semibold uppercase tracking-wide">Тест</span>}
        </button>
        {confirm}
      </span>
    );
  }

  if (showUpdateSuccess && snapshot) {
    return (
      <span
        className="flex h-full items-center gap-1.5 px-2 text-xs font-medium text-[color:var(--kub-online)]"
        role="status"
        aria-live="polite"
        title={`Версия ${snapshot.installedVersion} готова к работе`}
        data-testid="desktop-update-pill"
        data-update-success="true"
      >
        <KubIcon name="checkCircle" size={15} />
        <span className="text-[color:var(--kub-text)]">Обновление установлено</span>
      </span>
    );
  }

  if (webOffer) {
    return (
      <span className="relative flex h-full" data-caption-update="">
        <button
          type="button"
          onClick={() => press("web", applyWeb)}
          aria-label="Готова новая версия. Обновить"
          title="Готова новая версия. Применится при перезапуске"
          data-testid="desktop-web-update"
          className="flex h-full w-11 items-center justify-center text-[color:var(--kub-online)] transition-colors kub-raise-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]"
        >
          <KubIcon name="download" size={16} />
        </button>
        {confirm}
      </span>
    );
  }

  return null;
}

/** The question a call asks before an update takes it away. */
function CaptionConfirm({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <div
      role="alertdialog"
      aria-label="Звонок прервётся"
      data-testid="desktop-update-call-confirm"
      onMouseDown={(event) => event.stopPropagation()}
      className="kub-glass-strong kub-menu-in absolute right-0 top-[calc(100%+0.25rem)] z-[60] flex w-64 flex-col gap-2 rounded-2xl p-3 text-left"
    >
      <span className="text-sm font-semibold text-[color:var(--kub-text)]">Звонок прервётся</span>
      <span className="text-xs leading-snug text-[color:var(--kub-muted)]">Обновление отключит вас от разговора</span>
      <span className="flex justify-end gap-2">
        <KubButton size="sm" variant="secondary" onClick={onCancel}>Отмена</KubButton>
        <KubButton size="sm" variant="danger" onClick={onConfirm} data-testid="desktop-update-call-confirm-go">Всё равно</KubButton>
      </span>
    </div>
  );
}
