"use client";

import { useEffect, useRef, useState } from "react";
import { KubGlassLayer, KubIcon } from "@/components/kub";
import { CAPSULE_GLASS } from "@/lib/chatChrome";
import { FOCUS_RING, PRESS_FILLED } from "@/lib/controlSurface";
import { formatVoiceDuration } from "@/hooks/useVoiceRecorder";
import {
  recordingHoldLabel,
  type RecordingHold,
  type RecordingMode,
  type RecordingPhase,
} from "@/lib/recordingGesture";
import { cn } from "@/lib/utils";

export interface ComposerRecordingPreview {
  url: string;
  durationMs: number;
}

export interface ComposerRecordingRowProps {
  mode: RecordingMode;
  phase: RecordingPhase;
  /** Where the held gesture has got to, which decides what the row says. */
  hold: RecordingHold;
  pointerType: "mouse" | "touch" | "pen";
  durationMs: number;
  /** 0 to 1 towards the cancel, which the row fades along. */
  cancelProgress: number;
  /** 0 to 1 towards the lock, which fills the rail. */
  lockFill: number;
  /** How far left the row is drawn, following the finger. */
  followX: number;
  /** A paused recording, ready to be listened to before it is sent. */
  preview: ComposerRecordingPreview | null;
  onCancel: () => void;
  /** Stops a locked recording so it can be heard before it goes. */
  onPause: () => void;
  onSend: () => void;
}

/**
 * The composer while something is being recorded (D-130).
 *
 * It takes the composer's row rather than standing above it in a card that
 * explains the gesture, which is what the product did and what the audit called
 * a card for what the row itself should say (R3). Three states, and they are the
 * gesture's own:
 *
 * - **held.** A red dot, the time, and which way to go — «Влево — отмена» under
 *   a finger, «Отпустите вне поля — отмена» under a mouse, because those are the
 *   two ways out Telegram gives each (T19, T21). The row follows the finger left
 *   and fades as it goes, so the slide is something a person feels rather than a
 *   sentence they obey; past the threshold the recording is gone and this row
 *   with it. The lock rail stands above the button the finger is already on.
 * - **locked.** The finger is free. Delete, the time, and a stop that ends the
 *   recording without sending it, so it can be heard first.
 * - **paused.** What was recorded, playable, with the same delete beside it and
 *   a send that finally sends it. This is the only preview there is: the tray is
 *   no longer one (R9, R10).
 *
 * The material is the chat screen's own — one glass capsule, a `KubGlassLayer`
 * leaf with the row over it, exactly as the composer's other capsules are — so
 * nothing here writes a fill, a blur or a shadow of its own (rule 1).
 */
export function ComposerRecordingRow({
  mode,
  phase,
  hold,
  pointerType,
  durationMs,
  cancelProgress,
  lockFill,
  followX,
  preview,
  onCancel,
  onPause,
  onSend,
}: ComposerRecordingRowProps) {
  const holding = phase === "holding";
  const paused = phase === "paused";

  return (
    <div
      // The testid the locked state has always carried, so what already reads
      // this row goes on reading it.
      data-testid="composer-recording-lock-indicator"
      data-recording-row={mode}
      data-recording-phase={phase}
      data-recording-hold={holding ? hold : "none"}
      className="relative flex h-11 w-full items-center gap-2 rounded-full pl-3 pr-1"
      style={{
        transform: followX ? `translateX(${Math.round(followX)}px)` : undefined,
        // Fades along the slide, so the row is visibly on its way out before it
        // goes. Never to nothing: at the threshold it is replaced, not hidden.
        opacity: holding && cancelProgress > 0 ? 1 - cancelProgress * 0.55 : undefined,
      }}
    >
      <KubGlassLayer className={CAPSULE_GLASS} />

      {holding && <div className="relative flex min-w-0 flex-1 items-center gap-2">{
        <>
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[var(--kub-danger)]" aria-hidden />
          <span
            data-testid="composer-recording-timer"
            className="shrink-0 tabular-nums text-sm text-[color:var(--kub-text)]"
            aria-live="polite"
          >
            {formatVoiceDuration(durationMs)}
          </span>
          <span
            data-testid="composer-recording-hint"
            className="truncate text-sm text-[color:var(--kub-muted)]"
          >
            {recordingHoldLabel(hold, pointerType)}
          </span>
        </>
      }</div>}

      {!holding && (
        <>
          <button
            type="button"
            data-testid="composer-recording-delete"
            onClick={onCancel}
            aria-label="Удалить запись"
            title="Удалить"
            className={cn(
              "kub-interactive relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[color:var(--kub-danger)]",
              FOCUS_RING,
            )}
          >
            <KubIcon name="delete" size={17} />
          </button>

          {paused && preview ? (
            <PausedPreview preview={preview} />
          ) : (
            <div className="relative flex min-w-0 flex-1 items-center gap-2">
              <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[var(--kub-danger)]" aria-hidden />
              <span
                data-testid="composer-recording-timer"
                className="shrink-0 tabular-nums text-sm text-[color:var(--kub-text)]"
                aria-live="polite"
              >
                {formatVoiceDuration(durationMs)}
              </span>
              <span className="truncate text-sm text-[color:var(--kub-muted)]">
                {recordingHoldLabel("locking", pointerType)}
              </span>
            </div>
          )}

          {!paused && (
            <button
              type="button"
              // The name this control has always had, kept: what reads it is
              // the locked recording's stop, and that is still what it is.
              data-testid="composer-locked-recording-stop"
              onClick={onPause}
              aria-label={mode === "video" ? "Остановить запись" : "Остановить и прослушать"}
              title="Остановить"
              className={cn(
                "kub-interactive relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[color:var(--kub-text)]",
                FOCUS_RING,
              )}
            >
              <KubIcon name="pause" size={16} />
            </button>
          )}

          <button
            type="button"
            data-testid="composer-recording-send"
            onClick={onSend}
            aria-label="Отправить"
            className={cn(
              "kub-interactive relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--kub-cyan)] text-[color:var(--kub-bg)]",
              PRESS_FILLED,
              FOCUS_RING,
            )}
          >
            <KubIcon name="send" size={16} className="ml-0.5" />
          </button>
        </>
      )}

      {holding && (
        <div
          data-testid="composer-recording-lock-rail"
          className="pointer-events-none absolute bottom-full right-1 mb-2 flex flex-col items-center gap-1"
        >
          <span
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--kub-muted)]",
              lockFill >= 1 && "text-[color:var(--kub-cyan)]",
            )}
          >
            <KubIcon name="lock" size={15} />
          </span>
          <span className="relative block h-14 w-1 overflow-hidden rounded-full bg-[var(--kub-inset)]">
            <span
              data-testid="composer-recording-lock-progress"
              data-lock-progress={lockFill.toFixed(2)}
              className="absolute bottom-0 left-0 w-full rounded-full bg-[var(--kub-cyan)]"
              style={{ height: `${Math.max(6, lockFill * 100)}%` }}
            />
          </span>
        </div>
      )}
    </div>
  );
}

/** A paused recording, listened to before it is sent. */
function PausedPreview({ preview }: { preview: ComposerRecordingPreview }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const sync = () => {
      const seconds = Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.duration
        : preview.durationMs / 1000;
      setProgress(seconds > 0 ? Math.min(1, Math.max(0, audio.currentTime / seconds)) : 0);
    };
    const stop = () => {
      setPlaying(false);
      setProgress(0);
    };
    audio.addEventListener("timeupdate", sync);
    audio.addEventListener("play", () => setPlaying(true));
    audio.addEventListener("pause", () => setPlaying(false));
    audio.addEventListener("ended", stop);
    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", sync);
      audio.removeEventListener("ended", stop);
    };
  }, [preview.durationMs, preview.url]);

  return (
    <div data-testid="composer-recording-preview" className="relative flex min-w-0 flex-1 items-center gap-2">
      <audio ref={audioRef} src={preview.url} preload="metadata" />
      <button
        type="button"
        data-testid="composer-recording-preview-toggle"
        onClick={() => {
          const audio = audioRef.current;
          if (!audio) return;
          if (playing) audio.pause();
          else void audio.play().catch(() => setPlaying(false));
        }}
        aria-label={playing ? "Пауза" : "Прослушать запись"}
        className={cn(
          "kub-interactive flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[color:var(--kub-accent-text)]",
          FOCUS_RING,
        )}
      >
        <KubIcon name={playing ? "pause" : "play"} size={15} />
      </button>
      <span className="relative block h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--kub-inset)]">
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-[var(--kub-cyan)]"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </span>
      <span className="shrink-0 tabular-nums text-sm text-[color:var(--kub-text)]">
        {formatVoiceDuration(preview.durationMs)}
      </span>
    </div>
  );
}
