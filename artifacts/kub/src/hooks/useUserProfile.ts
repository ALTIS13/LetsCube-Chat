import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  PROFILE_FRESHNESS_MS,
  profileRequestDecision,
  type ProfileCacheEntry,
} from "@/lib/profileCache";
import { mapPgError } from "@/lib/errors";
import { PROFILE_UNAVAILABLE, plainFailure } from "@/lib/plainMessages";
import type { Profile } from "@/types/database";

/**
 * One person, read once for every surface that draws them.
 *
 * The rules live in `lib/profileCache.ts`, which is pure and tested; this file
 * is only the maps, the request and the subscription — the same division
 * `useProfileBadges` uses, and for the same reason: a decision inside a hook
 * can only be examined by mounting React.
 *
 * **Module level, not per component**, exactly as the badges cache is. The
 * compact card and the full card are different components by design (Discord's
 * popout and modal are too — modules 851588 and 808261); what stops them
 * disagreeing is that they read these maps.
 */

const cache = new Map<string, ProfileCacheEntry>();
const pending = new Map<string, Promise<void>>();
/** Bumped whenever the cache changes, so mounted hooks re-read it. */
let revision = 0;
const listeners = new Set<() => void>();

function announce(): void {
  revision += 1;
  for (const listener of listeners) listener();
}

/** Failure text, kept beside the entry rather than in it, so the type stays a row. */
const failures = new Map<string, string>();

async function loadProfile(userId: string): Promise<void> {
  const supabase = createClient();
  try {
    const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
    if (error) {
      console.error("Profile read error:", error);
      failures.set(userId, plainFailure(mapPgError(error), PROFILE_UNAVAILABLE));
      cache.set(userId, { profile: null, failed: true, fetchedAt: Date.now() });
      return;
    }
    failures.delete(userId);
    // A refusal and an absence are different facts (D-140). Row-level security
    // answers `null` with no error for a row nobody may read, so «нет такого
    // человека» would report a refusal as a fact about the world; the surface
    // says the same unavailable sentence for both and claims neither.
    cache.set(userId, { profile: (data as Profile | null) ?? null, failed: false, fetchedAt: Date.now() });
  } finally {
    pending.delete(userId);
    announce();
  }
}

function requestProfile(userId: string | null): void {
  const decision = profileRequestDecision({
    userId,
    entry: userId ? cache.get(userId) : undefined,
    inFlight: userId ? pending.has(userId) : false,
    now: Date.now(),
  });
  if (decision !== "fetch" || !userId) return;
  pending.set(userId, loadProfile(userId));
}

export interface UserProfileState {
  profile: Profile | null;
  /** Whether an answer — or a refusal — has arrived. */
  settled: boolean;
  /** The sentence to show, or null. Present only when the read failed. */
  failure: string | null;
}

export function useUserProfile(userId: string | null): UserProfileState {
  const [, setRevision] = useState(revision);

  useEffect(() => {
    const listener = () => setRevision(revision);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    requestProfile(userId);
    // A stale answer has to be replaced while the surface is open, not only
    // when it is opened: escalating from the compact card to the full one can
    // cross the window. The timer is armed for exactly what is left of it.
    if (!userId) return;
    const entry = cache.get(userId);
    if (!entry) return;
    const left = PROFILE_FRESHNESS_MS - (Date.now() - entry.fetchedAt);
    if (left <= 0) return;
    const timer = window.setTimeout(() => requestProfile(userId), left + 1);
    return () => window.clearTimeout(timer);
    // `revision` is a dependency so that the timer is re-armed on the answer
    // that has just arrived. It cannot loop: `requestProfile` is gated by the
    // same window the timer waits out.
  }, [userId, revision]);

  return useMemo(() => {
    if (!userId) return { profile: null, settled: false, failure: null };
    const entry = cache.get(userId);
    if (!entry) return { profile: null, settled: false, failure: null };
    return {
      profile: entry.profile,
      settled: true,
      failure: entry.failed ? failures.get(userId) ?? PROFILE_UNAVAILABLE : entry.profile ? null : PROFILE_UNAVAILABLE,
    };
  }, [userId, revision]);
}

/** For tests and for a sign-out, which must not leave one account's reads behind. */
export function forgetUserProfiles(): void {
  cache.clear();
  pending.clear();
  failures.clear();
  announce();
}
