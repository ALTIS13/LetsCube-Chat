"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { KubGlassLayer, KubIcon } from "@/components/kub";
import { CAPSULE_GLASS } from "@/lib/chatChrome";
import { FOCUS_RING, PRESS_FILLED } from "@/lib/controlSurface";
import {
  RECORDING_CANCEL_LABEL,
  RECORDING_DELETE_LABEL,
  formatRecordingElapsed,
  formatRecordingLength,
  recordingRowControls,
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
  /** A stopped recording, ready to be listened to before it is sent. */
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
 * explains the gesture (R3), and it is laid out the way Telegram Desktop lays
 * out the same moments. Nothing moves: the row used to follow the finger
 * leftwards and fade as it went, which is what carried the timer out of the
 * frame — `04` where `00:04` was recorded — and there is no translation left to
 * clip it.
 *
 * **The row has two shapes, and which one it wears is whether the recording is
 * still running.** `recordingRowControls` decides, so the answer is a rule with
 * a test rather than a condition spread through the markup.
 *
 * - **Running** — held or locked. `1fr auto 1fr`: the red dot and the running
 *   time at the left, «Отмена» centred by the grid rather than by a number, and
 *   at the right what sends. Held, the record button is still under the finger
 *   as a sibling of this row, so that column is empty and the lock rail stands
 *   above the button as a capsule of the panel material.
 * - **Stopped** — `auto 1fr auto`: the bin at the left edge, the bar across the
 *   width with the play control and the length on it, and the blue send at the
 *   right. **No «Отмена».** The commit before this one removed the bin on the
 *   argument that «Отмена» had become the single way out; the owner's
 *   screenshot of Telegram Desktop's stopped recording says the argument was
 *   right and the conclusion was wrong. One way out per state — the word while
 *   the recording runs, the bin once it has stopped.
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
  const controls = recordingRowControls(phase);
  // The stopped shape needs something to have been recorded: without a clip it
  // would be a bar with no length beside a send with nothing to send. Nothing
  // produces that pairing today — the row is only paused after a clip comes
  // back — and if anything ever does, the running shape is the safe one.
  const stopped = controls.playback && preview !== null;

  return (
    <div
      // The testid the locked state has always carried, so what already reads
      // this row goes on reading it.
      data-testid="composer-recording-lock-indicator"
      data-recording-row={mode}
      data-recording-phase={phase}
      data-cancel-armed={cancelArmed ? "true" : "false"}
      className={cn(
        "relative grid h-11 w-full items-center gap-2 rounded-full",
        stopped ? "grid-cols-[auto_1fr_auto] px-1" : "grid-cols-[1fr_auto_1fr] pl-3 pr-1",
      )}
    >
      <KubGlassLayer className={CAPSULE_GLASS} />

      {/* The state in words, for a screen reader. The row says it with a red
          dot, a padlock, a bar and a bin; none of those is readable aloud.
          `sr-only` is absolutely positioned, so it takes none of the three
          columns above. */}
      <span data-testid="composer-recording-state" className="sr-only">
        {recordingStateLabel(phase, mode)}
      </span>

      {stopped && preview ? (
        <>
          {/* Left: the way out of a stopped recording. */}
          <button
            type="button"
            data-testid="composer-recording-trash"
            onClick={onCancel}
            aria-label={RECORDING_DELETE_LABEL}
            title={RECORDING_DELETE_LABEL}
            className={cn(
              "kub-interactive relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[color:var(--kub-text)]",
              FOCUS_RING,
            )}
          >
            <KubIcon name="delete" size={18} />
          </button>

          <StoppedRecording preview={preview} />

          <SendRecording onSend={onSend} />
        </>
      ) : (
        <>
          {/* Left: what is being recorded and for how long. */}
          <div className="relative flex min-w-0 items-center gap-2">
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
          </div>

          {/* Middle: the way out, while the recording is still running. */}
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
            {controls.pause && (
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
            {controls.send && <SendRecording onSend={onSend} />}
          </div>
        </>
      )}

      {holding && <LockRail lockFill={lockFill} />}
    </div>
  );
}

/** The blue circle at the right edge, which is the same control in both shapes. */
function SendRecording({ onSend }: { onSend: () => void }) {
  return (
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

/**
 * What was recorded, on the bar, between the bin and the send.
 *
 * The bar takes the whole width it is given rather than sharing the row with a
 * separate play button and a separate length at the far right, which is how
 * this looked before the owner's screenshot: the triangle and the time are one
 * control and they sit **on** the bar, roughly centred, with the playhead
 * travelling underneath them.
 *
 * The pill has a capsule of the panel material behind it for the same reason
 * the lock rail does — it has to be legible over a track it crosses, and rule 1
 * says a fill comes from the material rather than from a colour written here.
 */
function StoppedRecording({ preview }: { preview: ComposerRecordingPreview }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    // The recorder's own measurement is the length that is trusted: a WebM
    // clip written by `MediaRecorder` frequently reports `Infinity` for its
    // duration until it has been played through once.
    const lengthMs = () => {
      const seconds = audio.duration;
      return Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : preview.durationMs;
    };
    const sync = () => setPositionMs(Math.min(lengthMs(), audio.currentTime * 1_000));
    const started = () => setPlaying(true);
    const paused = () => setPlaying(false);
    const ended = () => {
      setPlaying(false);
      setPositionMs(0);
    };
    audio.addEventListener("timeupdate", sync);
    audio.addEventListener("play", started);
    audio.addEventListener("pause", paused);
    audio.addEventListener("ended", ended);
    return () => {
      audio.pause();
      // Every one of them, which the version this replaced did not do: it added
      // four listeners and removed two, so `play` and `pause` were left setting
      // state on a component that had gone.
      audio.removeEventListener("timeupdate", sync);
      audio.removeEventListener("play", started);
      audio.removeEventListener("pause", paused);
      audio.removeEventListener("ended", ended);
    };
  }, [preview.durationMs, preview.url]);

  const lengthMs = preview.durationMs > 0 ? preview.durationMs : 0;
  const played = lengthMs > 0 ? Math.min(1, Math.max(0, positionMs / lengthMs)) : 0;
  const percent = Math.round(played * 100);

  return (
    <div
      data-testid="composer-recording-preview"
      data-played={played.toFixed(2)}
      className="relative flex h-9 min-w-0 items-center"
    >
      <audio ref={audioRef} src={preview.url} preload="metadata" />

      {/* The bar itself, across the whole width between the two controls.
          Six points rather than four: at four it photographed as a hairline
          between the bin and the send rather than as the bar the owner's
          screenshot shows, in both themes and on both widths. */}
      <span
        data-testid="composer-recording-bar"
        className="pointer-events-none absolute inset-x-0 top-1/2 block h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-[var(--kub-inset)]"
        aria-hidden
      >
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-[var(--kub-cyan)]"
          style={{ width: `${percent}%` }}
        />
      </span>

      {/* The playhead, on a track inset by its own radius so it stays on the
          bar at both ends instead of hanging off them. */}
      <span className="pointer-events-none absolute inset-x-[5px] top-1/2 block h-0" aria-hidden>
        <span
          data-testid="composer-recording-playhead"
          className="absolute top-0 block h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--kub-cyan)]"
          style={{ left: `${percent}%` }}
        />
      </span>

      {/* The play control and the length, together, on the bar. */}
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
          "kub-interactive absolute left-1/2 flex h-7 -translate-x-1/2 items-center gap-1.5 rounded-full pl-2.5 pr-3",
          FOCUS_RING,
        )}
      >
        <KubGlassLayer className={CAPSULE_GLASS} />
        <KubIcon name={playing ? "pause" : "play"} size={12} className="relative text-[color:var(--kub-accent-text)]" />
        <span
          data-testid="composer-recording-length"
          className="relative tabular-nums text-sm text-[color:var(--kub-text)]"
        >
          {formatRecordingLength(playing ? positionMs : lengthMs)}
        </span>
      </button>
    </div>
  );
}
