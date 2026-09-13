import type { KeyboardEvent } from "react";
import { KubGlassLayer, KubIcon } from "@/components/kub";
import { DISABLED_SINK, DISABLED_SINK_FILLED, FOCUS_RING, FOCUS_RING_WITHIN, PRESS_FILLED } from "@/lib/controlSurface";
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
 */
export function AttachSendBar({ sendLabel, caption, onCaptionChange, onSend, hdAvailable, hd, onHdChange, busy }: AttachSendBarProps) {
  const handleCaptionKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!busy) onSend();
  };

  return (
    <div
      data-attach-send-bar="floating"
      className="relative flex min-h-[3.25rem] items-center gap-2 rounded-full py-1 pl-4 pr-1"
    >
      <KubGlassLayer className="rounded-full border border-[color:var(--glass-line)]" />
      <label className={cn("relative flex min-w-0 flex-1 items-center rounded-full", FOCUS_RING_WITHIN)}>
        <span className="sr-only">Подпись</span>
        <input
          value={caption}
          onChange={(event) => onCaptionChange(event.target.value)}
          onKeyDown={handleCaptionKeyDown}
          placeholder="Добавить подпись…"
          enterKeyHint="send"
          data-testid="attach-caption"
          className="relative h-11 w-full min-w-0 bg-transparent text-base text-[color:var(--kub-text)] outline-none placeholder:text-[color:var(--kub-muted)] sm:text-sm"
        />
      </label>
      {hdAvailable && (
        <button
          type="button"
          data-testid="attach-hd"
          aria-pressed={hd}
          disabled={busy}
          aria-label={hd ? "Фото уйдут в высоком качестве" : "Фото уйдут в обычном качестве"}
          title={hd ? "Высокое качество" : "Обычное качество"}
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
          HD
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
