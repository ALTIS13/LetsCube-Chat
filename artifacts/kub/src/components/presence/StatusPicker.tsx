"use client";

import { useId, useState } from "react";
import { KubIcon } from "@/components/kub";
import { usePrivacyPreferences } from "@/hooks/usePrivacyPreferences";
import { FOCUS_RING_INSET } from "@/lib/controlSurface";
import {
  manualStatusInForce,
  STATUS_DURATIONS,
  STATUS_OPTIONS,
  statusUntil,
  statusUntilLabel,
  statusUntilMs,
  type ManualStatus,
} from "@/lib/presenceStatus";
import { cn } from "@/lib/utils";

const DOT_FILL: Record<ManualStatus, string> = {
  online: "var(--kub-online)",
  idle: "var(--kub-warn)",
  dnd: "var(--kub-danger)",
  invisible: "var(--kub-muted)",
};

/**
 * The dot for a status on a menu: the shapes of `presenceDotBackground` —
 * a disc, a crescent, a disc with a bar, a ring — cut out with a mask, because
 * a menu is glass and its ground is not one colour a hole could be painted in.
 */
export function StatusDot({ status, className }: { status: ManualStatus; className?: string }) {
  // An id React makes can carry characters a `url(#…)` reference will not.
  const maskId = `status-dot-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  return (
    <svg viewBox="0 0 10 10" aria-hidden="true" data-status-dot={status} className={cn("h-2.5 w-2.5 shrink-0", className)}>
      {status !== "online" && (
        <mask id={maskId}>
          <rect width="10" height="10" fill="white" />
          {status === "idle" && <circle cx="2.2" cy="2.2" r="3.6" fill="black" />}
          {status === "dnd" && <rect x="1.9" y="3.8" width="6.2" height="2.4" rx="1.2" fill="black" />}
          {status === "invisible" && <circle cx="5" cy="5" r="2.3" fill="black" />}
        </mask>
      )}
      <circle cx="5" cy="5" r="5" fill={DOT_FILL[status]} mask={status === "online" ? undefined : `url(#${maskId})`} />
    </svg>
  );
}

/** The chosen status in force, and when it runs out, for a row's value. */
export function useChosenStatus(): { status: ManualStatus; until: number | null; untilLabel: string | null } {
  const { preferences } = usePrivacyPreferences();
  const until = statusUntilMs(preferences.manualStatusUntil);
  const now = Date.now();
  const status = manualStatusInForce(preferences.manualStatus, until, now);
  return { status, until: status === "online" ? null : until, untilLabel: status === "online" ? null : statusUntilLabel(until, now) };
}

/**
 * «В сети», «Неактивен», «Не беспокоить», «Невидимый» — the owner's menu — and
 * for the last three how long: 15 минут, 1 час, 8 часов, 24 часа, 3 дня,
 * навсегда — the list Discord's status submenu carries (reference-clients
 * §21). Here a press opens the durations under the status, which a finger
 * reaches as well as a pointer.
 */
export function StatusPicker({ onChosen }: { onChosen?: () => void }) {
  const privacy = usePrivacyPreferences();
  const chosen = useChosenStatus();
  const [timing, setTiming] = useState<ManualStatus | null>(null);

  const choose = (status: ManualStatus, until: number | null) => {
    setTiming(null);
    void privacy.setManualStatus(status, until === null ? null : new Date(until).toISOString());
    onChosen?.();
  };

  return (
    <div role="radiogroup" aria-label="Статус" data-testid="status-picker" className="grid grid-cols-[minmax(0,1fr)] gap-0.5">
      {STATUS_OPTIONS.map((option) => {
        const selected = chosen.status === option.id;
        const open = timing === option.id;
        return (
          <div key={option.id}>
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={!privacy.ready}
              aria-expanded={option.timed ? open : undefined}
              onClick={() => (option.timed ? setTiming(open ? null : option.id) : choose("online", null))}
              data-testid={`status-option-${option.id}`}
              className={cn(
                "flex w-full min-w-0 items-center gap-3 rounded-lg px-3 py-1.5 text-left text-sm text-[color:var(--kub-text)] transition-colors kub-raise-hover",
                FOCUS_RING_INSET,
              )}
            >
              {/* The 16px column a menu row keeps for its icon, so the words
                  line up with the rows around the picker. */}
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                <StatusDot status={option.id} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="truncate">
                  {option.label}
                  {selected && chosen.untilLabel && (
                    <span className="text-[color:var(--kub-muted)]"> · {chosen.untilLabel}</span>
                  )}
                </span>
                {option.hint && <span className="text-xs text-[color:var(--kub-muted)]">{option.hint}</span>}
              </span>
              {selected && <KubIcon name="check" size={14} tone="accent" />}
              {option.timed && !selected && <KubIcon name={open ? "chevronDown" : "chevronRight"} size={12} tone="muted" />}
            </button>
            {open && (
              <div className="grid grid-cols-3 gap-1 px-3 pb-1.5 pt-0.5" data-testid={`status-durations-${option.id}`}>
                {STATUS_DURATIONS.map((duration) => (
                  <button
                    key={duration.id}
                    type="button"
                    disabled={!privacy.ready}
                    onClick={() => choose(option.id, statusUntil(duration, Date.now()))}
                    data-testid={`status-duration-${duration.id}`}
                    className={cn(
                      "min-w-0 truncate rounded-full bg-[var(--kub-raise-veil)] px-1.5 py-1 text-center text-xs text-[color:var(--kub-text)] transition-colors kub-raise-hover",
                      FOCUS_RING_INSET,
                    )}
                  >
                    {duration.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
