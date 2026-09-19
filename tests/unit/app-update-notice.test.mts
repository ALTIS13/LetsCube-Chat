import assert from "node:assert/strict";
import test from "node:test";
import {
  APP_UPDATE_NOTICE_SHOWN_KEY,
  ROUTINE_NOTICE_INTERVAL_MS,
  parseLastShownAt,
  shouldShowUpdateNotice,
  updateAction,
} from "../../artifacts/kub/src/lib/pwa/appUpdateNotice.ts";

/**
 * When a new web build may be put in front of somebody (D-264).
 *
 * The rule these cases hold is the one Discord's web client applies to a build
 * that is not marked `required`: it may be shown at most once every seven days,
 * counted from the last time anybody saw the notice rather than from the last
 * deploy. Read live from the production bundle on 2026-09-20 —
 * `version.stable.json` answers `{"hash":"…","required":false}` and the
 * renderer gates on a `lastNonRequiredUpdateShown` timestamp, with
 * `7 * Millis.DAY` on stable.
 *
 * The second rule is Discord's only interruption in the whole update path: a
 * connected voice call is asked about before the reload drops it.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 20, 12, 0, 0);

test("the interval is the seven days Discord's stable channel uses", () => {
  assert.equal(ROUTINE_NOTICE_INTERVAL_MS, 7 * DAY);
  assert.equal(APP_UPDATE_NOTICE_SHOWN_KEY, "letscube:app-update:last-shown");
});

test("nothing is offered while no newer build is deployed", () => {
  assert.equal(
    shouldShowUpdateNotice({ pending: false, required: false, lastShownAt: null, now: NOW }),
    false,
  );
  // Not even a required one: `required` says how urgent a pending build is, not
  // that there is one.
  assert.equal(
    shouldShowUpdateNotice({ pending: false, required: true, lastShownAt: null, now: NOW }),
    false,
  );
});

test("a browser that has never seen the notice sees it", () => {
  assert.equal(
    shouldShowUpdateNotice({ pending: true, required: false, lastShownAt: null, now: NOW }),
    true,
  );
});

test("a routine build waits out the whole interval, and then is offered", () => {
  const cases: Array<[number, boolean]> = [
    [0, false],
    [DAY, false],
    // The day before the interval closes is still inside it. A rule written
    // with `>` instead of `>=` differs only on the exact boundary, so the
    // boundary is stated from both sides below.
    [7 * DAY - 1, false],
    [7 * DAY, true],
    [7 * DAY + 1, true],
    [30 * DAY, true],
  ];
  for (const [elapsed, expected] of cases) {
    assert.equal(
      shouldShowUpdateNotice({ pending: true, required: false, lastShownAt: NOW - elapsed, now: NOW }),
      expected,
      `${elapsed}ms after the last notice`,
    );
  }
});

test("a required build is never throttled", () => {
  // Nothing can set this today — no web build declares itself required — so
  // this case pins the branch against the day the signal is added rather than
  // against current behaviour. See the module comment.
  assert.equal(
    shouldShowUpdateNotice({ pending: true, required: true, lastShownAt: NOW, now: NOW }),
    true,
  );
});

test("a clock that has gone backwards does not lock the notice out", () => {
  // A corrected device, or a profile restored from a backup, can leave a stored
  // time in the future. Subtracting then gives a negative elapsed, which is
  // below the interval, and the notice would be unreachable until the stored
  // time came round again.
  assert.equal(
    shouldShowUpdateNotice({ pending: true, required: false, lastShownAt: NOW + 30 * DAY, now: NOW }),
    true,
  );
});

test("only a usable timestamp counts as one", () => {
  assert.equal(parseLastShownAt(null), null);
  assert.equal(parseLastShownAt(""), null);
  assert.equal(parseLastShownAt("not a time"), null);
  assert.equal(parseLastShownAt("0"), null);
  assert.equal(parseLastShownAt("-1"), null);
  assert.equal(parseLastShownAt("1.5"), null);
  // `Number("")` is 0 and `Number(null)` is 0, which is why the two cases above
  // are spelled out: a check that only rejected NaN would accept both.
  assert.equal(parseLastShownAt(String(NOW)), NOW);
});

test("a connected call is asked about once, and only once", () => {
  assert.equal(updateAction({ callActive: false, acknowledged: false }), "restart");
  assert.equal(updateAction({ callActive: true, acknowledged: false }), "confirm");
  assert.equal(updateAction({ callActive: true, acknowledged: true }), "restart");
  // Acknowledging without a call changes nothing: there was nothing to lose.
  assert.equal(updateAction({ callActive: false, acknowledged: true }), "restart");
});
