import { type ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface KubTooltipProps {
  label: string;
  side?: "top" | "bottom" | "left" | "right";
  children: ReactNode;
  className?: string;
}

/**
 * The short label on an icon button — «Уведомления», «Новый чат», «Меню».
 *
 * **It used to be a CSS-only bubble and that made it useless where it was most
 * used.** The bubble was a `position: absolute` span inside a
 * `relative inline-flex group` wrapper, revealed by a hover rule in the
 * stylesheet whose declarations are gone with it.
 * Absolute positioning is clipped by any ancestor with `overflow: hidden`, and
 * the sidebar's header sits inside two of them — the header block and
 * `.kub-chat-list-column`. Measured at 1440 on 2026-09-18: the bell occupies
 * y 10–46, its `side="bottom"` bubble is laid out at y 52–80, and everything
 * below the header's edge is cut away. What a person sees is a six-pixel sliver
 * of a border above the chat list and no word at all, which is exactly how the
 * owner of this deployment described it — «их описания появляются под списком
 * чатов».
 *
 * `components/ui/tooltip.tsx` already carries the fix and the reason, written
 * when the same defect was found there: «Portalled, which this was not… It also
 * inherited any ancestor's `overflow: hidden`, which clips a tooltip near the
 * edge of a scrolling panel.» So this is not a second tooltip system any more —
 * it is a named shape of that one, kept because three call sites want «a short
 * label on an icon button» rather than the popover `InfoHint` builds.
 *
 * What changes for a reader beyond not being clipped: it appears on keyboard
 * focus as well as hover (Radix does both), it flips to the other side rather
 * than running off the window, and it waits 250ms so moving the pointer across
 * a row of icons does not flash three labels. What does not change: the glass,
 * the border, the 12px type and the side each call site asked for.
 */
export function KubTooltip({ label, side = "top", children, className }: KubTooltipProps) {
  return (
    <Tooltip delayDuration={250}>
      {/* The wrapper stays, and is not decoration: the three call sites sit in
          flex rows that were laid out with an `inline-flex` box around the
          button, so removing it would move the icons. `asChild` keeps the
          trigger as the button itself rather than nesting a second one. */}
      <span className={cn("relative inline-flex", className)}>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
      </span>
      <TooltipContent
        side={side}
        sideOffset={6}
        // `kub-glass-strong`, the border and the 12px type are what the CSS
        // bubble had; `TooltipContent` brings its own glass and text size, so
        // only the size is overridden here.
        // `kub-tooltip` carries one declaration pair: the animation duration
        // and easing, from the motion tokens. Without it the bubble animates
        // at the `animate-in` plugin's own 150ms, which is a literal outside
        // this product's motion system — the drift `motion-contract` catches.
        className="kub-tooltip whitespace-nowrap px-2 py-1 text-[12px] font-medium"
      >
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
