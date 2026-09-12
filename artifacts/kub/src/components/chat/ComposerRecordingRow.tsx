"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { KubGlassLayer, KubIcon } from "@/components/kub";
import { CAPSULE_GLASS } from "@/lib/chatChrome";
import { FOCUS_RING, PRESS_FILLED } from "@/lib/controlSurface";
import { formatVoiceDuration } from "@/hooks/useVoiceRecorder";
import {
  RECORDING_CANCEL_LABEL,
  formatRecordingElapsed,
  recordingStateLabel,
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
  durationMs: number;
  /** 0 to 1 towards the lock, which lifts the rail's chevron and lights its padlock. */
  lockFill: number;
  /** The pointer is over «Отмена» and letting go would throw the recording away. */
  cancelArmed: boolean;
  /** The composer measures this button to decide what a release means. */
  cancelRef?: RefObject<HTMLButtonElement | null>;
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
 * explains the gesture (R3), and since the owner's ruling of 2026-09-12 it is
 * laid out the way Telegram Desktop lays out the same moment: **the time at the
 * left, «Отмена» in the middle, and what sends at the right**. Three columns,
 * `1fr auto 1fr`, so the middle one is centred by the grid itself and stays
 * centred whatever the time reads.
 *
 * Nothing moves. The row used to follow the finger leftwards and fade as it
 * went, which is what made the old slide legible and what carried the timer out
 * of the frame — `04` where `00:04` was recorded. There is no translation left
 * to clip it.
 *
 * Three states, and they are the gesture's own:
 *
 * - **held.** A red dot and the running time, «Отмена», and the record button
 *   still under the finger as a sibling of this row. The lock rail stands above
 *   that button as a capsule of the panel material — on the desktop too, which
 *   the owner asked for by name.
 * - **locked.** The finger is free, so the row carries a padlock beside the
 *   time, and at the right a stop that ends the recording without sending it and
 *   a send that does.
 * - **paused.** What was recorded, playable, with the same «Отмена» in the
 *   middle and a send at the right. This is the only preview there is: the tray
 *   is no longer one (R9, R10).
 *
 * The material is the chat screen's own — one glass capsule, a `KubGlassLayer`
 * leaf with the row over it, exactly as the composer's other capsules are — so
 * nothing here writes a fill, a blur or a shadow of its own (rule 1).
 */
export function ComposerRecordingRow({
  mode,
  phase,
  durationMs,
  lockFill,
  cancelArmed,
  cancelRef,
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
      data-cancel-armed={cancelArmed ? "true" : "false"}
      className="relative grid h-11 w-full grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-full pl-3 pr-1"
    >
      <KubGlassLayer className={CAPSULE_GLASS} />

      {/* Left: what is being recorded and for how long. */}
      <div className="relative flex min-w-0 items-center gap-2">
        {/* The state in words, for a screen reader. The row says it with a red
            dot, a padlock and a button; none of those is readable aloud. */}
        <span data-testid="composer-recording-state" className="sr-only">
          {recordingStateLabel(phase, mode)}
        </span>
        {paused && preview ? (
          <PausedPreview preview={preview} />
        ) : (
          <>
            <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[var(--kub-danger)]" aria-hidden />
            <span
              data-testid="composer-recording-timer"
              className="shrink-0 tabular-nums text-sm text-[color:var(--kub-text)]"
              aria-live="off"
            >
              {formatRecordingElapsed(durationMs)}
            </span>
            {!holding && (
              // The finger is free, and this is what says so where the hint
              // sentence used to.
              <KubIcon name="lock" size={14} className="shrink-0 text-[color:var(--kub-muted)]" aria-hidden />
            )}
          </>
        )}
      </div>

      {/* Middle: the way out, in the middle of the row, in every state. */}
      <button
        ref={cancelRef}
        type="button"
        data-testid="composer-recording-cancel"
        onClick={onCancel}
        aria-label="Отменить запись"
        className={cn(
          "kub-interactive relative flex h-9 shrink-0 items-center justify-center rounded-full px-4 text-sm font-medium transition-colors",
          FOCUS_RING,
          // Armed only while a finger or a mouse is resting on it mid-hold:
          // letting go here throws the recording away, and that is worth saying
          // before it happens rather than after.
          cancelArmed
            ? "text-[color:var(--kub-danger-text)]"
            : "text-[color:var(--kub-accent-text)]",
        )}
      >
        {RECORDING_CANCEL_LABEL}
      </button>

      {/* Right: what sends. While the finger is down the record button is a
          sibling of this row, still under the thumb, so this column is empty. */}
      <div className="relative flex items-center justify-end gap-1">
        {!holding && (
          <>
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
      </div>

      {holding && <LockRail lockFill={lockFill} />}
    </div>
  );
}

/**
 * The lock rail: a capsule standing above the record button, with a padlock in
 * its upper part and a chevron pointing up below it.
 *
 * It was a 15-point padlock over a one-pixel line, and on the rendered sheets it
 * was the faintest thing on the screen — the owner rejected it by name and sent
 * Telegram's, which is a real object with its own fill. So it is one now: a
 * `KubGlassLayer` capsule of the panel material, the same material the composer's
 * own buttons are made of, which is rule 1's way of having a fill without
 * writing one.
 *
 * It is placed over the record button rather than over this row's right edge.
 * The button is a sibling 44 points wide with an 8-point gap before it, so its
 * centre is 30 points past the row — `left-[calc(100%+1.875rem)]` with the
 * capsule pulled back by half its own width. During a hold the row is exactly
 * those 52 points narrower than the composer, which is the one asymmetry the
 * held state has and the reason the button can stay under the thumb.
 *
 * It is drawn on the desktop as well as the phone. Locking with a mouse is the
 * same gesture as with a thumb — press the button, pull the pointer up onto this
 * capsule, and the recording goes on without the button held — so the capsule is
 * the target that says the gesture exists at all.
 */
function LockRail({ lockFill }: { lockFill: number }) {
  const armed = lockFill >= 1;
  return (
    <div
      data-testid="composer-recording-lock-rail"
      className="pointer-events-none absolute bottom-full left-[calc(100%+1.875rem)] mb-2 flex w-10 -translate-x-1/2 flex-col items-center gap-1 rounded-full py-2.5"
    >
      <KubGlassLayer className={CAPSULE_GLASS} />
      <span
        data-testid="composer-recording-lock-progress"
        data-lock-progress={lockFill.toFixed(2)}
        className={cn(
          "relative flex h-6 w-6 items-center justify-center rounded-full transition-colors",
          armed
            ? "text-[color:var(--kub-cyan)]"
            : lockFill > 0
              ? "text-[color:var(--kub-text)]"
              : "text-[color:var(--kub-muted)]",
        )}
      >
        <KubIcon name="lock" size={17} />
      </span>
      <span
        className="relative block text-[color:var(--kub-muted)] transition-transform"
        style={{
          // Rises and fades as the finger comes up to meet it, which is the
          // rail's only motion and the whole of what tells a person the gesture
          // is being read.
          transform: `translateY(${-Math.round(lockFill * 4)}px)`,
          opacity: armed ? 0 : 0.5 + lockFill * 0.5,
        }}
        aria-hidden
      >
        <KubIcon name="chevronUp" size={14} />
      </span>
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
