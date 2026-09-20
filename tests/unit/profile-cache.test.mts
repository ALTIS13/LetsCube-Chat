import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PROFILE_FRESHNESS_MS,
  profileEntryIsFresh,
  profileEntrySettled,
  profileRequestDecision,
  type ProfileCacheEntry,
} from "../../artifacts/kub/src/lib/profileCache.ts";
import type { Profile } from "../../artifacts/kub/src/types/database.ts";

/**
 * The gate the two profile surfaces share.
 *
 * `docs/operations/reference-clients.md` §15.1 is the whole of the authority
 * for it. Discord's popout and its full modal are different components; what
 * stops them disagreeing is one store behind one fetch path (module 903209)
 * that refuses to ask twice — in flight, no-op; answered under 60 seconds ago,
 * no-op. Ours had neither, and building the small surface without this would
 * have given the product two components over two queries.
 *
 * The number is asserted as a literal on purpose: `6e4` is the one part of that
 * mechanism that is a product decision rather than a mechanism, and copying it
 * is the only reason we may have it.
 */

const AT = 1_700_000_000_000;
const SOMEBODY = { id: "u1" } as unknown as Profile;

function answered(at: number, profile: Profile | null = SOMEBODY): ProfileCacheEntry {
  return { profile, failed: false, fetchedAt: at };
}

function refused(at: number): ProfileCacheEntry {
  return { profile: null, failed: true, fetchedAt: at };
}

test("the window is Discord's, to the millisecond", () => {
  assert.equal(PROFILE_FRESHNESS_MS, 60_000);
});

test("nobody asked about is not somebody who could not be read", () => {
  for (const nothing of [null, undefined, ""]) {
    assert.equal(
      profileRequestDecision({ userId: nothing, entry: undefined, inFlight: false, now: AT }),
      "idle",
    );
  }
});

test("a request already out is not issued twice", () => {
  // The whole point of the gate: a second surface mounting over the same person
  // — the escalation from the compact card to the full one is exactly that —
  // must not put a second query on the wire.
  assert.equal(
    profileRequestDecision({ userId: "u1", entry: undefined, inFlight: true, now: AT }),
    "in-flight",
  );
  assert.equal(
    profileRequestDecision({ userId: "u1", entry: answered(AT), inFlight: true, now: AT + 90_000 }),
    "in-flight",
  );
});

test("a person nobody has asked about is fetched", () => {
  assert.equal(
    profileRequestDecision({ userId: "u1", entry: undefined, inFlight: false, now: AT }),
    "fetch",
  );
});

test("an answer inside the window is used as it stands", () => {
  assert.equal(
    profileRequestDecision({ userId: "u1", entry: answered(AT), inFlight: false, now: AT + 59_999 }),
    "fresh",
  );
});

test("the window is closed at its own edge, as Discord writes it", () => {
  // `Date.now() - fetchEndedAt >= 6e4` is stale. At exactly 60 000 ms the
  // answer no longer stands.
  assert.equal(
    profileRequestDecision({ userId: "u1", entry: answered(AT), inFlight: false, now: AT + 60_000 }),
    "fetch",
  );
  assert.equal(profileEntryIsFresh(answered(AT), AT + 59_999), true);
  assert.equal(profileEntryIsFresh(answered(AT), AT + 60_000), false);
});

test("«nobody» is an answer and is cached like one", () => {
  // Row-level security answers `null` with no error for a row nobody may read.
  // That is a fact the surface can draw, and asking again inside the window
  // would put a query on the wire for every mount.
  assert.equal(
    profileRequestDecision({
      userId: "u1",
      entry: answered(AT, null),
      inFlight: false,
      now: AT + 10_000,
    }),
    "fresh",
  );
});

test("a refusal stops the surface waiting, and expires on the same clock", () => {
  // `useProfileBadges` learned this the expensive way: an id whose read failed
  // simply stayed missing, so a surface waiting for an answer waited for ever.
  // Cached, so the failure is drawn; timestamped, so a reopen after a minute
  // asks again instead of retrying in a loop or never retrying at all.
  assert.equal(profileEntrySettled(refused(AT)), true);
  assert.equal(
    profileRequestDecision({ userId: "u1", entry: refused(AT), inFlight: false, now: AT + 30_000 }),
    "fresh",
  );
  assert.equal(
    profileRequestDecision({ userId: "u1", entry: refused(AT), inFlight: false, now: AT + 60_000 }),
    "fetch",
  );
});

test("nothing is settled until something has been asked", () => {
  assert.equal(profileEntrySettled(undefined), false);
  assert.equal(profileEntrySettled(answered(AT, null)), true);
});

/**
 * The half of the contract that lives in the hook: there is exactly one read of
 * `profiles` for a person, and it is this one.
 *
 * A source scan rather than a behaviour, because the failure it guards against
 * is somebody adding a second `supabase.from("profiles")` to a profile surface
 * — which is precisely how this product came to have three of them.
 */
const OVERLAY = readFileSync(
  new URL("../../artifacts/kub/src/components/profile/UserProfileOverlay.tsx", import.meta.url),
  "utf8",
);
const COMPACT = readFileSync(
  new URL("../../artifacts/kub/src/components/profile/UserProfileCompact.tsx", import.meta.url),
  "utf8",
);

test("no profile surface reads the database for itself", () => {
  for (const [name, source] of [["overlay", OVERLAY], ["compact card", COMPACT]] as const) {
    assert.ok(!source.includes('from("profiles")'), `${name} must read the store, not the table`);
    assert.ok(!source.includes("createClient"), `${name} must not hold a client of its own`);
  }
  assert.ok(OVERLAY.includes("useUserProfile"));
});
