import { useEffect, useSyncExternalStore } from "react";
import { actionFeedback, type ActionFeedbackKind } from "@/lib/actionFeedback";
import { cn } from "@/lib/utils";
import { KubIcon } from "./KubIcon";
import type { KubIconName } from "./icons";

const ICON: Record<ActionFeedbackKind, KubIconName> = {
  success: "checkCircle",
  info: "info",
  warning: "warning",
  error: "alert",
};

const RAIL: Record<ActionFeedbackKind, string> = {
  success: "bg-[var(--kub-online)]",
  info: "bg-[var(--kub-cyan)]",
  warning: "bg-[var(--kub-warn)]",
  error: "bg-[var(--kub-danger)]",
};

const TONE: Record<ActionFeedbackKind, string> = {
  success: "text-[color:var(--kub-online)]",
  info: "text-[color:var(--kub-cyan)]",
  warning: "text-[color:var(--kub-warn)]",
  error: "text-[color:var(--kub-danger)]",
};

/**
 * Where transient confirmations appear.
 *
 * Mounted once, near the root. The container is pointer-transparent so it never
 * intercepts a click meant for the interface underneath — a confirmation that
 * blocks the thing it is confirming is worse than none — and only the cards
 * themselves take pointer events, so they can still be dismissed.
 *
 * It sits below the desktop title bar and above the mobile bottom navigation,
 * with the safe-area inset added, because on a phone the bottom strip is where
 * both the navigation and the system gesture area live.
 *
 * The tone follows the rule settled in D-019 and the badge before it: the text
 * takes the interface colour and the tone lives in the rail and the icon, where
 * the threshold is 3:1 rather than 4.5:1.
 */
export function KubFeedbackViewport() {
  const items = useSyncExternalStore(
    actionFeedback.subscribe,
    actionFeedback.getSnapshot,
    actionFeedback.getSnapshot,
  );

  // One timer for the whole queue rather than one per card: the store already
  // knows every expiry, so this only has to ask it to look again.
  useEffect(() => {
    if (items.length === 0) return;
    const timer = window.setInterval(() => actionFeedback.prune(), 250);
    return () => window.clearInterval(timer);
  }, [items.length]);

  if (items.length === 0) return null;

  return (
    <div
      data-testid="kub-feedback-viewport"
      className={cn(
        // Measured rather than guessed: the staff area stacks a 56px header on
        // a 45px navigation strip, so anything above 101px sits on top of the
        // tabs. 108px clears the tallest chrome in the product; on the messenger,
        // whose bar ends at 44px, the card simply floats a little lower.
        "pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+6.75rem)] z-[70]",
        "flex flex-col items-center gap-2 px-3",
        "sm:inset-x-auto sm:right-4 sm:items-end",
      )}
    >
      {items.map((item) => (
        <div
          key={item.id}
          role={item.kind === "error" ? "alert" : "status"}
          aria-live={item.kind === "error" ? "assertive" : "polite"}
          className={cn(
            "kub-feedback-card pointer-events-auto relative flex w-full max-w-sm items-start gap-2.5",
            "overflow-hidden rounded-xl border border-[color:var(--kub-border-color)]",
            "bg-[var(--kub-surface-2)] py-2.5 pl-4 pr-3 text-sm shadow-lg",
            "text-[color:var(--kub-text)]",
          )}
        >
          <span aria-hidden="true" className={cn("absolute inset-y-0 left-0 w-1", RAIL[item.kind])} />
          <span className={cn("mt-0.5 shrink-0", TONE[item.kind])}>
            <KubIcon name={ICON[item.kind]} size={15} tone="currentColor" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold leading-snug">{item.title}</span>
            {item.detail && (
              <span className="mt-0.5 block text-xs leading-snug text-[color:var(--kub-muted)]">
                {item.detail}
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={() => actionFeedback.dismiss(item.id)}
            aria-label="Закрыть уведомление"
            className="kub-icon-action kub-interactive shrink-0 rounded-md text-[color:var(--kub-muted)] hover:bg-[var(--kub-surface-3)] hover:text-[color:var(--kub-text)]"
          >
            <KubIcon name="close" size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
