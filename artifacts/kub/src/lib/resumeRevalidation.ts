/**
 * When coming back to the page is a reason to ask the server again.
 *
 * The chat list used to refetch itself whole on every window `focus`,
 * `visibilitychange` and `pageshow`, throttled only to ten seconds. On a
 * desktop a focus is every click back into the window, and nothing can have
 * been missed while the page stayed visible: the Realtime socket does not stop
 * because another window has the keyboard. Every one of those refetches
 * replaced every row, so the list rendered whole (D-088).
 *
 * What can go stale is a page that was actually away:
 *
 * - hidden long enough for a mobile browser or an installed app to have
 *   suspended the socket — `visible()` after at least `minHiddenMs`;
 * - restored from the back/forward cache — `pageShow(true)`;
 * - back from offline — `online()`, which always answers yes. A reconnect after
 *   offline is exactly the case this gate must never talk the caller out of.
 *
 * A socket that dies while the page is visible is not this gate's business:
 * Realtime reconnects on its own and the channel reports `SUBSCRIBED` again,
 * which the hooks treat as their reconnect signal.
 *
 * Revalidations started here are at least `minIntervalMs` apart, except the two
 * forced ones above. This module imports nothing and takes its clock as a
 * parameter, so the unit suite drives it without timers.
 */

export interface ResumeRevalidationOptions {
  /** How long the page must have been hidden before coming back is worth a request. */
  minHiddenMs: number;
  /** The least time between two revalidations this gate allows on its own. */
  minIntervalMs: number;
  /** Milliseconds, monotonic enough for intervals. Defaults to `Date.now`. */
  now?: () => number;
}

export interface ResumeRevalidationGate {
  /** The page went hidden. A second call before `visible` keeps the first time. */
  hidden(): void;
  /** The page is visible again. True when the caller should revalidate. */
  visible(): boolean;
  /** The browser is back online. Always true, and it restarts the interval. */
  online(): boolean;
  /** A `pageshow`. True only for a page restored from the back/forward cache. */
  pageShow(persisted: boolean): boolean;
}

/** Hidden for less than this, a page on a phone has kept its socket in practice. */
export const RESUME_REVALIDATE_AFTER_HIDDEN_MS = 15_000;
/** At most one resume revalidation in this long, whatever the page does. */
export const RESUME_REVALIDATE_MIN_INTERVAL_MS = 15_000;

export function createResumeRevalidationGate(options: ResumeRevalidationOptions): ResumeRevalidationGate {
  const now = options.now ?? Date.now;
  let hiddenSince: number | null = null;
  let lastRevalidationAt = Number.NEGATIVE_INFINITY;

  const grant = (force: boolean): boolean => {
    const at = now();
    if (!force && at - lastRevalidationAt < options.minIntervalMs) return false;
    lastRevalidationAt = at;
    return true;
  };

  return {
    hidden() {
      if (hiddenSince === null) hiddenSince = now();
    },
    visible() {
      if (hiddenSince === null) return false;
      const hiddenFor = now() - hiddenSince;
      hiddenSince = null;
      return hiddenFor >= options.minHiddenMs && grant(false);
    },
    online() {
      return grant(true);
    },
    pageShow(persisted) {
      return persisted ? grant(true) : false;
    },
  };
}
