/**
 * What a ban or a mute reading means, including when there isn't one.
 *
 * `useBanState` and `useMuteState` both read a table, both threw `error` away,
 * and both turned a refused read into `banned: false` / `muted: false`. That is
 * the one answer a refused read must never give: fifteen tables carry
 * restrictive «block banned» policies, so a banned person whose read fails is
 * handed the whole product with every list empty and every write rejected, and
 * no screen anywhere explains it — the policies answer with emptiness, not with
 * an error.
 *
 * The decision lives here rather than inside the hooks because a decision made
 * inside a hook that needs Supabase and Realtime to exist cannot be reached by
 * `node --test`. Moving it is cheaper than building a harness around it — the
 * same conclusion `isSupabaseConfigured` reached.
 */

import { listReadView, type ListReadView } from "./listReadState.ts";

/** The shape both hooks share: a verdict plus how well it is known. */
export interface SanctionReadState {
  readonly loading: boolean;
  readonly view: ListReadView;
}

/** Anything that stops applying at a moment, or never does. */
export interface Expiring {
  readonly expires_at: string | null;
}

/**
 * The row that is still in force, or null.
 *
 * A row with no `expires_at` never lapses; one with a date counts only while
 * that date is ahead. Both hooks carried their own copy of this, and two copies
 * of one rule drift.
 */
export function activeSanctionAt<T extends Expiring>(
  rows: readonly T[],
  nowMs: number,
): T | null {
  return (
    rows.find((row) => {
      if (!row.expires_at) return true;
      const expiresMs = new Date(row.expires_at).getTime();
      return Number.isFinite(expiresMs) && expiresMs > nowMs;
    }) ?? null
  );
}

/**
 * The state after a read the database refused.
 *
 * Returns the previous verdict untouched. Only `loading` and `view` move, so
 * «we could not ask» can never be read off the screen as «they are not banned».
 */
export function stateAfterRefusedRead<S extends SanctionReadState>(
  previous: S,
  failure: { readonly loadedOnce: boolean; readonly message: string },
): S {
  return {
    ...previous,
    loading: false,
    view: listReadView({
      loading: false,
      error: failure.message || "read refused",
      loadedOnce: failure.loadedOnce,
    }),
  };
}

/**
 * How long to wait before asking again.
 *
 * A refusal is retried rather than settled as an answer, backing off so a
 * persistent refusal does not become a request loop. Doubling from a second,
 * capped at half a minute.
 */
export function sanctionRetryDelayMs(attempt: number): number {
  const bounded = Math.max(0, Math.floor(attempt));
  return Math.min(30_000, 1_000 * 2 ** bounded);
}
