"use client";

import { useRef, useState, type ReactNode } from "react";
import { KubIcon } from "@/components/kub";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * The typography is reset rather than merely set. `TooltipContent` renders the
 * panel where it stands instead of through `TooltipPrimitive.Portal`, so it
 * inherits from whatever it was written inside — and several of these hints sit
 * in an uppercase, letter-spaced section heading, which turned the explanation
 * into shouting. Every inherited text property this component relies on is
 * therefore stated here.
 */
const CONTENT_CLASS =
  "max-w-[16rem] text-xs font-normal normal-case leading-relaxed tracking-normal";

interface InfoHintProps {
  /**
   * The word being explained. Only assistive tech reads it, so it names the
   * term rather than repeating the explanation.
   */
  term: string;
  /** The explanation, in the words of someone who has never read the code. */
  text: ReactNode;
  /**
   * When present this becomes the trigger and is marked with a dotted
   * underline; otherwise the trigger is a small info glyph placed after a
   * label.
   */
  children?: ReactNode;
  /**
   * Make the child element itself the trigger instead of wrapping it in a
   * button of our own. Required wherever the thing being explained is already
   * a control — a button inside a button is invalid, and the nested one would
   * swallow the outer one's click.
   */
  asChild?: boolean;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}

/**
 * The explanation behind a word the interface uses but a person is not
 * required to know.
 *
 * Built on the Radix tooltip rather than `KubTooltip`. That one is for a short
 * label on a control: it is `whitespace-nowrap` with no maximum width, so a
 * sentence would run off the side of the window, and it is positioned by four
 * fixed offsets with no awareness of the viewport edge. These explanations are
 * sentences, and several of them hang off controls near the edge of a dialog.
 *
 * The open state is held here because Radix deliberately ignores touch: its
 * trigger returns early on `pointerType === "touch"`, and a tap then runs
 * pointerdown → focus → click, of which pointerdown and click both close and
 * focus is suppressed while the pointer is down. A tap therefore produces
 * nothing at all, which on Android is every reader this component has.
 *
 * So a press re-opens it on the next tick — after Radix's own close has run,
 * since `composeEventHandlers` puts ours first — but only when the press did
 * not start on an already-open tooltip, which keeps a click a real toggle
 * rather than something that can only ever open.
 */
export function InfoHint({
  term,
  text,
  children,
  asChild = false,
  side = "top",
  className,
}: InfoHintProps) {
  const [open, setOpen] = useState(false);
  const openAtPressRef = useRef(false);

  const pressHandlers = {
    onPointerDown: () => {
      openAtPressRef.current = open;
    },
    onClick: () => {
      if (openAtPressRef.current) return;
      window.setTimeout(() => setOpen(true), 0);
    },
  };

  if (asChild) {
    return (
      <Tooltip open={open} onOpenChange={setOpen} delayDuration={120}>
        {/* No aria-label here: the child is already a labelled control, and
            replacing its name with the term would lose what it does. */}
        <TooltipTrigger asChild {...pressHandlers}>
          {children}
        </TooltipTrigger>
        <TooltipContent side={side} className={CONTENT_CLASS}>
          {text}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip open={open} onOpenChange={setOpen} delayDuration={120}>
      <TooltipTrigger
        type="button"
        aria-label={`${term} — что это`}
        {...pressHandlers}
        className={cn(
          "inline-flex items-center rounded-[3px] align-middle",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]",
          children
            ? "gap-1 underline decoration-dotted decoration-[color:var(--kub-muted)] underline-offset-[3px] transition-colors hover:decoration-[color:var(--kub-cyan)]"
            // D-047: icon-only, and 13x13 before this - the smallest control
            // the settings screen had. The text-carrying branch above is a word
            // in a sentence and is left as it reads.
            : "kub-icon-action shrink-0 text-[color:var(--kub-muted)] transition-colors hover:text-[color:var(--kub-cyan)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)] active:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil)),linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))]",
          className,
        )}
      >
        {children ?? <KubIcon name="info" size={13} aria-hidden="true" />}
      </TooltipTrigger>
      <TooltipContent side={side} className={CONTENT_CLASS}>
        {text}
      </TooltipContent>
    </Tooltip>
  );
}
