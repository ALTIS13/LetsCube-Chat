"use client";

import { type ReactNode } from "react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { KubIcon } from "./KubIcon";

interface KubHintProps {
  /** The control this is about. Rendered as it was; it keeps its own press. */
  children: ReactNode;
  /** Whether the hint is on screen. Decided by `useHint`, never by this. */
  open: boolean;
  /** One or two short lines: what the control does, and how. */
  text: string;
  /**
   * Offered when the hint can be closed by hand. Some of Telegram's carry a
   * close and some do not, and the difference is whether the hint is worth
   * interrupting for; ours all are, so this is expected rather than optional.
   */
  onDismiss: () => void;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  className?: string;
}

/**
 * A hint that stands beside a control and does not take the screen.
 *
 * Every escape from radix's defaults below is deliberate:
 *
 *  - it does not take focus when it opens, because it interrupts nothing and
 *    a person mid-sentence must not lose their cursor to an explanation;
 *  - it does not close because a person touched something else. That is what
 *    a menu does. This closes when it is read, when its budget of use runs
 *    out, or on Escape, which stays because a keyboard user needs a way out;
 *  - it has no arrow. Not one of the four hints photographed in Telegram on
 *    2026-09-12 had one: they point by sitting against the thing they mean.
 */
export function KubHint({
  children,
  open,
  text,
  onDismiss,
  side = "bottom",
  align = "start",
  className,
}: KubHintProps) {
  return (
    <Popover open={open}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent
        side={side}
        align={align}
        sideOffset={8}
        role="status"
        aria-live="polite"
        data-testid="kub-hint"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        onFocusOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={() => onDismiss()}
        className={cn(
          // `w-auto` undoes the wrapper's `w-72`: a hint is as wide as its
          // sentence, up to the screen less a margin on both sides.
          "flex w-auto max-w-[min(20rem,calc(100vw-2rem))] items-start gap-2 p-3",
          className,
        )}
      >
        <span className="min-w-0 flex-1 text-[13px] leading-snug text-[color:var(--kub-text)]">
          {text}
        </span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Понятно"
          className="kub-icon-action kub-interactive -mr-1 -mt-1 shrink-0 rounded-full p-1 text-[color:var(--kub-muted)] kub-raise-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]"
        >
          <KubIcon name="close" size={14} />
        </button>
      </PopoverContent>
    </Popover>
  );
}
