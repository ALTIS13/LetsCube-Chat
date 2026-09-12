import type { KeyboardEvent } from "react";
import { KubGlassLayer, KubIcon } from "@/components/kub";
import { FOCUS_RING, FOCUS_RING_WITHIN, PRESS_FILLED } from "@/lib/controlSurface";
import { cn } from "@/lib/utils";

interface AttachSendBarProps {
  /** The button's accessible name, which is where the count is said: «Отправить 3 фото». */
  sendLabel: string;
  caption: string;
  onCaptionChange: (value: string) => void;
  onSend: () => void;
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
export function AttachSendBar({ sendLabel, caption, onCaptionChange, onSend }: AttachSendBarProps) {
  const handleCaptionKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    onSend();
  };

  return (
    <div
      data-attach-send-bar="floating"
      className="absolute inset-x-3 bottom-3 z-10 flex min-h-[3.25rem] items-center gap-2 rounded-full py-1 pl-4 pr-1"
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
      <button
        type="button"
        data-testid="attach-send"
        aria-label={sendLabel}
        onClick={onSend}
        className={cn(
          "kub-interactive relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--kub-cyan)] text-[color:var(--kub-bg)]",
          PRESS_FILLED,
          FOCUS_RING,
        )}
      >
        <KubIcon name="send" size={20} className="ml-0.5" />
      </button>
    </div>
  );
}
