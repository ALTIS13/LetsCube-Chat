import { useEffect, useRef } from "react";
import { KubGlassLayer, KubIcon } from "@/components/kub";
import { FOCUS_RING } from "@/lib/controlSurface";
import { cn } from "@/lib/utils";

interface AttachMoreMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSendOriginal: () => void;
}

/**
 * «…» at the top right once photos or videos are selected — where Telegram for
 * iOS keeps «Отправить без сжатия» — and the one other way to send. The button
 * beside the caption sends compressed and asks nothing (D-119).
 */
export function AttachMoreMenu({ open, onOpenChange, onSendOriginal }: AttachMoreMenuProps) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    itemRef.current?.focus({ preventScroll: true });
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      onOpenChange(false);
    };
    window.addEventListener("pointerdown", closeOutside, true);
    return () => window.removeEventListener("pointerdown", closeOutside, true);
  }, [open, onOpenChange]);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label="Ещё"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="attach-more"
        onClick={() => onOpenChange(!open)}
        className={cn(
          "kub-icon-action kub-interactive relative flex h-11 w-11 items-center justify-center rounded-full text-[color:var(--kub-text)] transition-colors",
          FOCUS_RING,
        )}
      >
        <KubGlassLayer className="rounded-full border border-[color:var(--glass-line)]" />
        <KubIcon name="more" size={20} className="relative" />
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Как отправить"
          data-testid="attach-send-menu"
          className="kub-menu-in absolute right-0 top-[calc(100%+0.375rem)] z-20 min-w-[15.5rem] rounded-2xl p-1.5"
        >
          <KubGlassLayer strong className="rounded-2xl border border-[color:var(--glass-line)]" />
          <button
            ref={itemRef}
            type="button"
            role="menuitem"
            data-testid="attach-send-original"
            onClick={() => {
              onOpenChange(false);
              onSendOriginal();
            }}
            className={cn(
              "kub-interactive relative flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] text-[color:var(--kub-text)] kub-raise-hover",
              FOCUS_RING,
            )}
          >
            <KubIcon name="imageOriginal" size={20} tone="accent" />
            Отправить без сжатия
          </button>
        </div>
      )}
    </div>
  );
}
