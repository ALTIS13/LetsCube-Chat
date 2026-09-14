// A refused read is not an acquittal.
//
// `useBanState` and `useMuteState` both discarded `error` and turned a refused
// read into `banned: false` / `muted: false`. Fifteen tables carry restrictive
// «block banned» policies, so the person that lands on gets the whole product
// with every list empty and every write rejected, and nothing on any screen
// says why — the policies answer with emptiness rather than an error.
//
// The decision was moved out of the hooks to be reachable at all: a hook that
// needs Supabase and Realtime to exist cannot be measured by `node --test`.
import assert from "node:assert/strict";
import test from "node:test";
import {
  activeSanctionAt,
  sanctionRetryDelayMs,
  stateAfterRefusedRead,
} from "../../artifacts/kub/src/lib/sanctionRead.ts";

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 8, 15, 12, 0, 0);

test("a refused read keeps the verdict it already had", () => {
  const banned = { loading: false, view: "ready" as const, banned: true, ban: { id: "b1" } };
  const after = stateAfterRefusedRead(banned, { loadedOnce: true, message: "permission denied" });

  // The whole point: the person is still banned, and the screen still says so.
  assert.equal(after.banned, true);
  assert.deepEqual(after.ban, { id: "b1" });
  assert.equal(after.view, "stale");
  assert.equal(after.loading, false);
});

test("a refusal before anything ever loaded says so, rather than «not banned»", () => {
  const nothingYet = { loading: true, view: "loading" as const, banned: false, ban: null };
  const after = stateAfterRefusedRead(nothingYet, { loadedOnce: false, message: "permission denied" });

  // `banned` is still false — there is nothing else it could be — but `view`
  // now distinguishes «we asked and they are not» from «we could not ask».
  assert.equal(after.view, "unavailable");
  assert.notEqual(after.view, "ready");
  assert.equal(after.loading, false);
});

test("an empty refusal message is still a refusal", () => {
  const after = stateAfterRefusedRead(
    { loading: true, view: "loading" as const, muted: false },
    { loadedOnce: false, message: "" },
  );
  assert.equal(after.view, "unavailable");
});

test("a sanction with no end never lapses", () => {
  assert.deepEqual(activeSanctionAt([{ expires_at: null }], NOW), { expires_at: null });
});

test("a sanction lapses exactly when its moment passes", () => {
  const future = new Date(NOW + HOUR).toISOString();
  const past = new Date(NOW - HOUR).toISOString();
  assert.deepEqual(activeSanctionAt([{ expires_at: future }], NOW), { expires_at: future });
  assert.equal(activeSanctionAt([{ expires_at: past }], NOW), null);
  // The boundary itself is over: `> now`, not `>=`.
  assert.equal(activeSanctionAt([{ expires_at: new Date(NOW).toISOString() }], NOW), null);
});

test("an unreadable date is not treated as a sanction that never ends", () => {
  // `new Date("nonsense").getTime()` is NaN, and NaN > now is false — but so is
  // NaN <= now, so a comparison written the other way round would silently keep
  // the sanction forever.
  assert.equal(activeSanctionAt([{ expires_at: "nonsense" }], NOW), null);
});

test("the first row still in force is the one that counts", () => {
  const past = new Date(NOW - HOUR).toISOString();
  const future = new Date(NOW + HOUR).toISOString();
  const rows = [{ expires_at: past, id: "old" }, { expires_at: future, id: "live" }];
  assert.deepEqual(activeSanctionAt(rows, NOW), { expires_at: future, id: "live" });
  assert.equal(activeSanctionAt([], NOW), null);
});

test("retrying backs off and then stops growing", () => {
  assert.equal(sanctionRetryDelayMs(0), 1_000);
  assert.equal(sanctionRetryDelayMs(1), 2_000);
  assert.equal(sanctionRetryDelayMs(4), 16_000);
  assert.equal(sanctionRetryDelayMs(5), 30_000, "the cap holds");
  assert.equal(sanctionRetryDelayMs(40), 30_000, "and keeps holding rather than overflowing");
  assert.equal(sanctionRetryDelayMs(-3), 1_000, "a nonsense attempt still waits");
});
