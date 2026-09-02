import { cn } from "@/lib/utils";
import { KubIcon } from "./KubIcon";

interface KubFilterButtonProps {
  /** How many filters are currently narrowing the list. */
  count: number;
  open: boolean;
  onToggle: () => void;
  className?: string;
}

/**
 * Opens the filter panel, and says how many filters are on without opening it.
 *
 * The count is the point. Collapsing the filters behind a button reclaims the
 * space the list needs, but it also hides them — so the button has to carry the
 * one fact that was previously readable from the selects themselves. The badge
 * takes the primary action's own colour pair, which is already held to 4.5:1 by
 * the filled-action contract, so it cannot drift on its own.
 */
export function KubFilterButton({ count, open, onToggle, className }: KubFilterButtonProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={cn(
        "kub-button kub-interactive inline-flex items-center gap-2 rounded-xl border px-3 text-sm font-semibold",
        "transition-colors",
        count > 0 || open
          ? "border-[color:var(--kub-cyan)] bg-[var(--kub-surface-2)] text-[color:var(--kub-text)]"
          : "border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] text-[color:var(--kub-text)] hover:border-[color:color-mix(in_srgb,var(--kub-cyan)_60%,transparent)]",
        className,
      )}
    >
      <KubIcon name="filter" size={14} />
      Фильтры
      {count > 0 && (
        <span
          className={cn(
            "inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold",
            "bg-[var(--kub-action-primary-background)] text-[color:var(--kub-action-primary-foreground)]",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}
