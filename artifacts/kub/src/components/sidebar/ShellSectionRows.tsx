"use client";

import { useLocation } from "wouter";
import { KubIcon } from "@/components/kub";
import { useTaskAccessGate } from "@/hooks/useTaskAccess";
import { FOCUS_RING_INSET, PRESS_SINK } from "@/lib/controlSurface";
import { SHELL_SECTION_ROWS, shellSection, shellSectionPath } from "@/lib/shellSection";
import { cn } from "@/lib/utils";

/**
 * The sections above the conversations (tracker item 41): Discord's home rows,
 * each a route with an icon and a word, opening its page in the main area while
 * the lists stay. The rule is `lib/shellSection.ts`.
 *
 * From `md` only. Discord's phone app does not carry these rows — its shell is
 * a different one (reference-clients §17.1), and the phone keeps its menu.
 *
 * The chosen row speaks the channel rail's language for a chosen channel: a
 * cyan wash that steps on hover and the accent text, so «where am I» reads the
 * same in both lists.
 */
export function ShellSectionRows() {
  const [location, setLocation] = useLocation();
  const { canAccessTasks } = useTaskAccessGate();
  const current = shellSection(location);
  const rows = SHELL_SECTION_ROWS.filter((row) => row.section !== "tasks" || canAccessTasks);

  return (
    <nav aria-label="Разделы" className="hidden flex-col gap-0.5 px-2 pb-1 pt-1 md:flex" data-testid="shell-sections">
      {rows.map((row) => {
        const active = current === row.section;
        return (
          <button
            key={row.section}
            type="button"
            onClick={() => setLocation(shellSectionPath(row.section))}
            aria-current={active ? "page" : undefined}
            data-shell-section={row.section}
            className={cn(
              "flex h-10 w-full min-w-0 items-center gap-3 rounded-lg px-2.5 text-left text-sm font-medium transition-colors",
              FOCUS_RING_INSET,
              PRESS_SINK,
              active
                ? "bg-[color-mix(in_srgb,var(--kub-cyan)_14%,transparent)] text-[color:var(--kub-accent-text)] hover:bg-[color-mix(in_srgb,var(--kub-cyan)_18%,transparent)]"
                : "text-[color:var(--kub-muted)] kub-raise-hover hover:text-[color:var(--kub-text)]",
            )}
          >
            <KubIcon name={row.icon} size={18} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">{row.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
