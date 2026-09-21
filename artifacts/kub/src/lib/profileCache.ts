/**
 * Whether a person has to be asked for again — the decision, on its own.
 *
 * ## Why this exists before any second surface does
 *
 * `docs/operations/reference-clients.md` §15.1 corrected the assumption this
 * project was about to build on. Discord's popout and its full modal are
 * **different components** — module 851588 and module 808261, sharing leaves
 * and not a root — and the reason they never disagree is not the markup. Both
 * read `UserProfileStore` (module 321191) through one fetch path (module
 * 903209), which refuses to ask twice:
 *
 * ```js
 * if(""===e||c.A.isFetchingProfile(e,f))return Promise.resolve();
 * …C=Date.now()-(N?.fetchEndedAt??0)>=6e4;
 * …if(!b&&!M)return Promise.resolve();
 * ```
 *
 * In flight, no-op. Answered less than **60 seconds** ago, no-op. So the small
 * surface is a *view of the same rows* as the large one, and a component that
 * drew something else would be drawing it from the same data.
 *
 * Ours had none of that: `UserProfileOverlay` read `profiles` on every open and
 * `ChatInfoPanel` read its own member list. Two reads of one row with no shared
 * cache and no in-flight gate. Building a compact surface beside the card
 * without this would have given us two components over two queries — which is
 * precisely the drift the 2026 consolidation was defending against, arriving
 * through the door D-283 had just re-opened.
 *
 * ## Why the decision is a module and the cache is not
 *
 * The same reason `lib/chatRowProfile.ts` is a module: a rule that lives inside
 * a hook can only be examined by mounting React, and the last time a decision
 * of this kind was a closure inside a component the product shipped D-283 with
 * nothing able to see it. Everything here is pure and takes its clock as an
 * argument, so `node --test` runs it; `hooks/useUserProfile.ts` holds the maps
 * and the request.
 *
 * ## The one place this deliberately differs from Discord
 *
 * **A refusal is not an answer.** Discord's gate has one negative state; ours
 * has two, because row-level security gives «nobody may read this person» the
 * same shape as «no such person», and `useProfileBadges` already learned the
 * cost of conflating a failure with a cached emptiness — an id that failed
 * simply stayed missing and a surface waiting on it waited for ever. So a
 * failed attempt is cached, with its own timestamp: it makes the surface stop
 * waiting *and* it expires on the same window, so the next open after a minute
 * asks again instead of retrying in a loop or never retrying at all.
 */

import type { Profile } from "../types/database.ts";

/**
 * How long an answer stands before it is asked for again.
 *
 * Discord's `6e4`, kept to the millisecond rather than rounded to something
 * that felt right: the number is the only part of its gate that is a product
 * decision rather than a mechanism, and copying it is the whole of the
 * authority for choosing it.
 */
export const PROFILE_FRESHNESS_MS = 60_000;

/**
 * What the cache holds for one subject.
 *
 * Generic since 2026-09-21, when a bot's card arrived (D-263). The **decision**
 * below is what the two hooks share — the in-flight gate, the window, the
 * cached failure — and it reads nothing but `fetchedAt` and whether an entry
 * exists, so it was never about a person. Two copies of that rule is exactly
 * the drift this file's header describes Discord avoiding with one store.
 */
export interface ProfileCacheEntry<T = Profile> {
  /** The row, or `null` when the last attempt was refused or found nothing. */
  profile: T | null;
  /**
   * Whether the last attempt failed, as opposed to answering «nobody».
   *
   * Kept apart from `profile: null` because they are different facts and the
   * reader is told different sentences (D-140's rule).
   */
  failed: boolean;
  /** When the attempt **ended**, which is what Discord's window measures from. */
  fetchedAt: number;
}

/**
 * What to do about one person, right now.
 *
 *  - `idle` — nobody was asked about.
 *  - `in-flight` — a request for this person is already out; a second surface
 *    mounting must not issue another.
 *  - `fresh` — answered inside the window; the surface draws what is held.
 *  - `fetch` — never asked, or the answer has aged out.
 */
export type ProfileRequestDecision = "idle" | "in-flight" | "fresh" | "fetch";

export function profileRequestDecision({
  userId,
  entry,
  inFlight,
  now,
  freshnessMs = PROFILE_FRESHNESS_MS,
}: {
  /** The subject's id — a person's or a bot's; the rule does not care which. */
  userId: string | null | undefined;
  entry: ProfileCacheEntry<unknown> | undefined;
  inFlight: boolean;
  now: number;
  freshnessMs?: number;
}): ProfileRequestDecision {
  // Discord's `""===e` arm. An absent id is not a person who could not be
  // read; it is nobody having been asked about, and a surface must not show a
  // failure for it.
  if (!userId) return "idle";
  if (inFlight) return "in-flight";
  if (!entry) return "fetch";
  return profileEntryIsFresh(entry, now, freshnessMs) ? "fresh" : "fetch";
}

/**
 * Whether an answer still stands.
 *
 * `>=` rather than `>`, exactly as Discord writes it: at the instant the window
 * elapses the answer is stale. A failure ages on the same clock — see the file
 * comment for why it is cached at all.
 */
export function profileEntryIsFresh(
  entry: ProfileCacheEntry<unknown>,
  now: number,
  freshnessMs: number = PROFILE_FRESHNESS_MS,
): boolean {
  return now - entry.fetchedAt < freshnessMs;
}

/**
 * Whether a surface may stop waiting.
 *
 * `useProfileBadges` calls the same distinction `settled` versus `ready`, and
 * the reason it exists there is the reason it exists here: a surface that waits
 * for an *answer* waits for ever against a database that refuses.
 */
export function profileEntrySettled(entry: ProfileCacheEntry<unknown> | undefined): boolean {
  return entry !== undefined;
}
