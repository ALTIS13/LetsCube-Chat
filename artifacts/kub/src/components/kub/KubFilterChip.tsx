import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { KubIcon } from "./KubIcon";

interface KubFilterChipProps {
  /** What the filter is, phrased as a person would read it: "Роль: Администратор". */
  children: ReactNode;
  /** Removes this one filter. The chip is the only place a filter can be undone individually. */
  onRemove: () => void;
  /** Used for the remove button's label, so a screen reader hears which filter it drops. */
  label: string;
  className?: string;
}

/**
 * One filter that is currently narrowing a list.
 *
 * The staff screens used to keep every filter as a permanently visible select,
 * five of them across the top of the users tab. That has two costs: the filters
 * take the space the list needs, and what is *active* is invisible — a select
 * showing "Все роли" and one showing "Администратор" look alike at a glance, so
 * people scroll a filtered list without knowing it is filtered.
 *
 * A chip says what is on and removes it in one click. The remove control is a
 * real button rather than a decorative ×, so it is reachable by keyboard and
 * carries its own accessible name.
 */
export function KubFilterChip({ children, onRemove, label, className }: KubFilterChipProps) {
  return (
    <span
      className={cn(
        "kub-field inline-flex items-center gap-1.5 rounded-full border border-[color:var(--kub-border-color)]",
        "bg-[var(--kub-surface-2)] py-0.5 pl-3 pr-1 text-xs text-[color:var(--kub-text)]",
        className,
      )}
    >
      {children}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Убрать фильтр: ${label}`}
        className={cn(
          "kub-icon-action kub-interactive rounded-full text-[color:var(--kub-muted)]",
          "kub-raise-hover hover:text-[color:var(--kub-text)]",
        )}
      >
        <KubIcon name="close" size={12} />
      </button>
    </span>
  );
}
