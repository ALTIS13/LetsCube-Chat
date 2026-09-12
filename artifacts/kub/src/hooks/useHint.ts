"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { createHintStore, type HintStore } from "@/lib/hints";

/**
 * One store for the application, built over this browser's storage.
 *
 * Storage is read once at construction and may be absent — a browser set to
 * refuse site data throws on the getter itself, before any call — so even
 * reaching for it is guarded.
 */
function browserStorage() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

let store: HintStore | null = null;

export function hintStore(): HintStore {
  store ??= createHintStore({ storage: browserStorage() });
  return store;
}

/**
 * How often the budget is charged. A minute is coarse on purpose: this is a
 * budget of hours, and a timer that fires every second to move a two-hour
 * total would be a cost with no reader.
 */
const TICK_MS = 60_000;

/**
 * Time is charged only while the page is actually being looked at.
 *
 * `document.hidden` is the difference between «two hours of use» and «two
 * hours since it first appeared»: a tab left open overnight is not use, and a
 * budget that expired while nobody was there would have explained nothing to
 * nobody.
 */
function useHintClock(active: boolean) {
  useEffect(() => {
    if (!active || typeof window === "undefined") return undefined;
    let last = Date.now();
    const tick = () => {
      const now = Date.now();
      const elapsed = now - last;
      last = now;
      if (typeof document !== "undefined" && document.hidden) return;
      // A machine that slept, or a tab the browser froze, would otherwise pay
      // the whole gap at once. Never charge more than the interval asked for.
      hintStore().spend(Math.min(elapsed, TICK_MS));
    };
    const timer = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(timer);
  }, [active]);
}

export interface UseHintOptions {
  /** Offered only when this is true — a right the person has, a screen they are on. */
  enabled: boolean;
  /** Defaults to the two hours of use in `lib/hints.ts`. */
  budgetMs?: number;
}

/**
 * Whether this hint belongs on screen, and how to put it away for good.
 */
export function useHint(id: string, { enabled, budgetMs }: UseHintOptions) {
  const visible = useSyncExternalStore(
    (listener) => hintStore().subscribe(listener),
    () => hintStore().getSnapshot().includes(id),
    () => false,
  );

  useEffect(() => {
    if (!enabled) {
      hintStore().withdraw(id);
      return undefined;
    }
    hintStore().offer({ id, budgetMs });
    return () => hintStore().withdraw(id);
  }, [id, enabled, budgetMs]);

  useHintClock(visible);

  const dismiss = useCallback(() => hintStore().dismiss(id), [id]);

  return { visible, dismiss };
}
