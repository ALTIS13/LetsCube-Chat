import { useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { KubGlassLayer, KubIcon } from "@/components/kub";
import { DISABLED_SINK, DISABLED_SINK_FILLED, FOCUS_RING, FOCUS_RING_WITHIN, PRESS_FILLED } from "@/lib/controlSurface";
import { photoSendQualityBadge, photoSendQualitySentence } from "@/lib/mediaQuality";
import { enterSendsHere } from "@/lib/composerEnter";
import { cn } from "@/lib/utils";

interface AttachSendBarProps {
  /** The button's accessible name, which is where the count is said: «Отправить 3 фото». */
  sendLabel: string;
  caption: string;
  onCaptionChange: (value: string) => void;
  onSend: () => void;
  /** Whether HD is worth offering at all for what is selected (D-174). */
  hdAvailable: boolean;
  hd: boolean;
  onHdChange: (next: boolean) => void;
  /** While a video is being encoded there is nothing to press but «Отмена». */
  busy: boolean;
}

/**
 * What takes the tabs' place once something is selected, as in Telegram: a
 * caption and a send button, in the capsule the tabs were. The button sends
 * compressed and asks nothing (D-119); the originals are «Отправить без сжатия»
 * under «…», where Telegram for iOS keeps them.
 *
 * How many go is said in the sheet's title — «Выбрано 3» — which is the glass
 * capsule look the owner chose, and in this button's own accessible name, so a
 * screen reader hears it at the control that sends.
 *
 * The HD badge reads its **state** and speaks of **разрешение**, for the reason
 * `lib/mediaQuality.ts` records under D-290: it raises the re-encode's
 * resolution cap and stops nothing, so a word that reads as «без сжатия» is a
 * control disagreeing with its own mechanism.
 */
/** Five lines of the caption before it scrolls: 20px of padding and 24px a line. */
const CAPTION_MAX_HEIGHT = 20 + 24 * 5;

export function AttachSendBar({ sendLabel, caption, onCaptionChange, onSend, hdAvailable, hd, onHdChange, busy }: AttachSendBarProps) {
  // A field of lines, as both Telegrams' captions are, because the composer's
  // text arrives here whole (tracker item 65): a one-line input drops every
  // line break a browser hands it.
  const captionRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const field = captionRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, CAPTION_MAX_HEIGHT)}px`;
  }, [caption]);

  // The composer's own rule: Enter sends and Shift+Enter starts a line, and on
  // a phone Enter starts a line and the arrow sends (tracker item 71).
  const handleCaptionKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || !enterSendsHere()) return;
    event.preventDefault();
    if (!busy) onSend();
  };

  return (
    <div
      data-attach-send-bar="floating"
      // Half its resting height as the radius: a pill on one line, and a
      // rounded box rather than a stretched pill when the caption grows.
      className="relative flex min-h-[3.25rem] items-end gap-2 rounded-[1.625rem] py-1 pl-4 pr-1"
    >
      <KubGlassLayer className="rounded-[1.625rem] border border-[color:var(--glass-line)]" />
      <label className={cn("relative flex min-w-0 flex-1 items-center rounded-[1.25rem]", FOCUS_RING_WITHIN)}>
        <span className="sr-only">Подпись</span>
        <textarea
          ref={captionRef}
          rows={1}
          value={caption}
          onChange={(event) => onCaptionChange(event.target.value)}
          onKeyDown={handleCaptionKeyDown}
          placeholder="Добавить подпись…"
          enterKeyHint="send"
          data-testid="attach-caption"
          className="relative block min-h-11 w-full min-w-0 resize-none overflow-y-auto bg-transparent py-2.5 text-base leading-6 text-[color:var(--kub-text)] outline-none placeholder:text-[color:var(--kub-muted)] sm:text-sm sm:leading-6"
        />
      </label>
      {hdAvailable && (
        <button
          type="button"
          data-testid="attach-hd"
          data-photo-resolution={hd ? "hd" : "sd"}
          aria-pressed={hd}
          disabled={busy}
          // «Разрешение», not «качество» — which is what this actually
          // changes, and what the tester read as «без сжатия» (D-290).
          aria-label={photoSendQualitySentence(hd)}
          title={photoSendQualitySentence(hd)}
          onClick={() => onHdChange(!hd)}
          className={cn(
            "kub-interactive relative flex h-11 shrink-0 items-center justify-center rounded-full px-3 text-[13px] font-semibold tracking-[0.06em]",
            hd
              ? "bg-[var(--kub-cyan)] text-[color:var(--kub-bg)]"
              : "border border-[color:var(--kub-border-color)] text-[color:var(--kub-muted)] kub-raise-hover",
            DISABLED_SINK,
            FOCUS_RING,
          )}
        >
          {/* The state, as Telegram's badge is, rather than the control's name
              over a fill colour a phone reads as decoration. */}
          {photoSendQualityBadge(hd)}
        </button>
      )}
      <button
        type="button"
        data-testid="attach-send"
        aria-label={sendLabel}
        disabled={busy}
        onClick={onSend}
        className={cn(
          "kub-interactive relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--kub-cyan)] text-[color:var(--kub-bg)]",
          // A well cut into the capsule rather than a fade: opacity on
          // translucent material shows the conversation through the control,
          // which `tests/unit/control-vocabulary.test.mjs` refuses by name.
          DISABLED_SINK_FILLED,
          PRESS_FILLED,
          FOCUS_RING,
        )}
      >
        <KubIcon name="send" size={20} className="ml-0.5" />
      </button>
    </div>
  );
}
