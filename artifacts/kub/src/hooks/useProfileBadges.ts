import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ProfileBadgeRow } from "@/lib/profileBadges";

/**
 * The badges other people wear (D-180).
 *
 * One RPC for a whole list of people, cached for the session. `profile_badges`
 * is a SECURITY DEFINER function that returns presentation fields only — it can
 * never hand back a permission, an `assigned_by` or an `assigned_at` — which is
 * why a badge became visible without widening the policies on `roles` and
 * `user_global_roles`, where a widened read would have carried all of that.
 *
 * **Cached at module level, not per component.** The same person appears in a
 * contact card, a member list and a hundred message bubbles; a cache inside the
 * hook would ask once per mount. What is cached is the answer *and the question*:
 * somebody with no badges is simply absent from the rows, so «asked and got
 * nothing» has to be remembered separately or every render asks again for ever.
 *
 * Nothing here decides what a chip looks like. That is `lib/profileBadges.ts`,
 * which is pure and tested.
 */

/** Answers, by user id. A person present with an empty array has been asked about. */
const cache = new Map<string, ProfileBadgeRow[]>();
/** In flight, so ten bubbles mounting at once make one request. */
const pending = new Map<string, Promise<void>>();
/** Bumped whenever the cache gains anything, so mounted hooks re-read it. */
let revision = 0;
const listeners = new Set<() => void>();

function announce(): void {
  revision += 1;
  for (const listener of listeners) listener();
}

/** As many as `profile_badges` accepts in one call; it raises above 200. */
const MAX_IDS = 200;

async function loadBadges(ids: string[]): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("profile_badges", { p_user_ids: ids });
  if (error) {
    // An answer that did not come is not an answer that nothing is worn. The
    // ids stay uncached so a later render asks again, and the surface renders
    // the person without a strip in the meantime.
    for (const id of ids) pending.delete(id);
    return;
  }
  const rows = (data ?? []) as unknown as ProfileBadgeRow[];
  for (const id of ids) {
    // A person not in the answer wears nothing, and that is an answer: the
    // empty array records it, so nobody asks about them again for the session.
    cache.set(id, rows.filter((row) => row.user_id === id));
    pending.delete(id);
  }
  announce();
}

function requestBadges(ids: readonly string[]): void {
  const wanted = ids.filter((id) => id && !cache.has(id) && !pending.has(id));
  if (!wanted.length) return;
  for (let at = 0; at < wanted.length; at += MAX_IDS) {
    const batch = wanted.slice(at, at + MAX_IDS);
    const promise = loadBadges(batch);
    for (const id of batch) pending.set(id, promise);
  }
}

export interface ProfileBadgesState {
  /** Rows by user id; an id that has not been answered for yet is absent. */
  rows: Map<string, ProfileBadgeRow[]>;
  /** Whether every id asked about has been answered for. */
  ready: boolean;
}

export function useProfileBadges(userIds: readonly string[]): ProfileBadgesState {
  // The identity of the array changes on every render of most callers; what it
  // holds does not.
  const key = useMemo(() => [...new Set(userIds.filter(Boolean))].sort().join("|"), [userIds]);
  const [, setRevision] = useState(revision);

  useEffect(() => {
    const listener = () => setRevision(revision);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (!key) return;
    requestBadges(key.split("|"));
  }, [key]);

  return useMemo(() => {
    const ids = key ? key.split("|") : [];
    const rows = new Map<string, ProfileBadgeRow[]>();
    let ready = true;
    for (const id of ids) {
      const answer = cache.get(id);
      if (answer) rows.set(id, answer);
      else ready = false;
    }
    return { rows, ready };
    // `revision` is the dependency that matters: the cache is module state, so
    // nothing else changes when an answer arrives.
  }, [key, revision]);
}

/** For tests and for a sign-out, which must not leave one account's badges behind. */
export function forgetProfileBadges(): void {
  cache.clear();
  pending.clear();
  announce();
}
