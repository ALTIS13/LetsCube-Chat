import assert from "node:assert/strict";
import test from "node:test";
import {
  APP_UPDATE_NOTICE_SHOWN_KEY,
  APP_UPDATE_QUIET_RESTART_KEY,
  QUIET_HIDDEN_MS,
  QUIET_IDLE_MS,
  QUIET_RESTART_COOLDOWN_MS,
  ROUTINE_NOTICE_INTERVAL_MS,
  parseLastShownAt,
  shouldRestartQuietly,
  shouldShowUpdateNotice,
  updateAction,
} from "../../artifacts/kub/src/lib/pwa/appUpdateNotice.ts";

/**
 * When a new web build may be put in front of somebody (D-264), and when it may
 * be taken without asking (D-282).
 *
 * **The throttle is set from our cadence, not from Discord's stable channel.**
 * It was seven days, which is the number Discord uses on the channel least like
 * ours; the same source records one day on ptb and canary, so the rule Discord
 * actually applies is "roughly one notice per release wave". Measured against
 * production from Coolify's deployment records, `letscube-web`, 2026-08-21 to
 * 2026-09-20: 242 successful deploys of 238 distinct commits, median gap 28
 * minutes, mean and p90 both 3 hours, longest quiet stretch 101 hours. A
 * seven-day throttle is longer than the longest silence this project has ever
 * had, so one notice covered all 242.
 *
 * **A reload is what taking an update costs, and sometimes it costs nothing.**
 * `skipWaiting` changes which worker controls the page; the loaded JavaScript
 * keeps running until a navigation, so a tab held open across a deploy never
 * takes the new build. `shouldRestartQuietly` says when this tab may reload
 * itself: only where the reload lands the page where it already is, with
 * nothing running that a reload would end.
 *
 * **A connected call is never traded.** It is Discord's only interruption in
 * the whole update path, and it is the one veto here that has no override.
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 8, 20, 12, 0, 0);

test("the notice interval is our own deploy cadence, not Discord's stable channel", () => {
  assert.equal(ROUTINE_NOTICE_INTERVAL_MS, HOUR);
  // The number this replaced. Stated so that putting it back is a visible
  // change rather than a silent one: 7 days is longer than the longest gap
  // between two production deploys that this project has ever recorded.
  assert.notEqual(ROUTINE_NOTICE_INTERVAL_MS, 7 * DAY);
  assert.ok(
    ROUTINE_NOTICE_INTERVAL_MS > 28 * MINUTE,
    "shorter than the median gap between deploys would be one notice per deploy",
  );
  assert.ok(
    ROUTINE_NOTICE_INTERVAL_MS < 101 * HOUR,
    "longer than the longest recorded quiet stretch is silence, not a throttle",
  );
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
    [MINUTE, false],
    // The minute before the interval closes is still inside it. A rule written
    // with `>` instead of `>=` differs only on the exact boundary, so the
    // boundary is stated from both sides below.
    [HOUR - 1, false],
    [HOUR, true],
    [HOUR + 1, true],
    [DAY, true],
    // The case the owner hit: a session open across a day of deploys. Under the
    // seven-day interval this answered false and he ran a two-commit-old bundle
    // until he pressed F5.
    [2 * HOUR, true],
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

// --- Taking the build without asking -------------------------------------

/** A tab hidden for an hour, on the chat list, with nothing else going on. */
const FREE = {
  pending: true,
  callBusy: false,
  conversationOpen: false,
  hiddenSince: NOW - HOUR,
  lastInteractionAt: NOW - HOUR,
  lastQuietRestartAt: null,
  now: NOW,
} as const;

test("the quiet windows are the ones the module documents", () => {
  assert.equal(QUIET_HIDDEN_MS, MINUTE);
  assert.equal(QUIET_IDLE_MS, 10 * MINUTE);
  assert.equal(QUIET_RESTART_COOLDOWN_MS, 30 * MINUTE);
  assert.equal(APP_UPDATE_QUIET_RESTART_KEY, "letscube:app-update:quiet-restart");
  // The cooldown has to outlast a rollover, or a tab that reloaded into the
  // same bundle reloads again straight away. A deploy takes minutes, not half
  // an hour, so this is the margin rather than the measurement.
  assert.ok(QUIET_RESTART_COOLDOWN_MS > QUIET_IDLE_MS);
});

test("a tab that has been left alone takes the build by itself", () => {
  assert.equal(shouldRestartQuietly({ ...FREE }), true);
});

test("nothing is taken while there is nothing to take", () => {
  assert.equal(shouldRestartQuietly({ ...FREE, pending: false }), false);
});

test("a call is never traded for an update, however long the tab has been idle", () => {
  // The owner sits in a voice channel for hours, and there is no rejoin after a
  // reload. This is the veto with no override anywhere in the module.
  assert.equal(shouldRestartQuietly({ ...FREE, callBusy: true }), false);
  assert.equal(
    shouldRestartQuietly({ ...FREE, callBusy: true, hiddenSince: NOW - 30 * DAY, lastInteractionAt: NOW - 30 * DAY }),
    false,
  );
});

test("an open conversation is never reloaded out from under anybody", () => {
  // A reload lands on the chat list: `selectedChatId` is neither in the URL nor
  // persisted. So it is free exactly when the page is already on the list.
  assert.equal(shouldRestartQuietly({ ...FREE, conversationOpen: true }), false);
  assert.equal(
    shouldRestartQuietly({ ...FREE, conversationOpen: true, hiddenSince: NOW - 30 * DAY }),
    false,
  );
});

test("a tab somebody is looking at, and has just touched, is left alone", () => {
  const visible = { ...FREE, hiddenSince: null, lastInteractionAt: NOW - SECOND };
  assert.equal(shouldRestartQuietly(visible), false);
});

test("hidden counts from the moment it went away, to the millisecond", () => {
  const cases: Array<[number, boolean]> = [
    [0, false],
    [MINUTE - 1, false],
    [MINUTE, true],
    [MINUTE + 1, true],
  ];
  for (const [hidden, expected] of cases) {
    assert.equal(
      // Visible-tab idleness is ruled out so that only the hidden clause can
      // answer: the person touched the tab a second before it went away.
      shouldRestartQuietly({ ...FREE, hiddenSince: NOW - hidden, lastInteractionAt: NOW - hidden - SECOND }),
      expected,
      `${hidden}ms hidden`,
    );
  }
});

test("a visible tab is taken on idleness alone, at ten minutes", () => {
  const cases: Array<[number, boolean]> = [
    [0, false],
    [10 * MINUTE - 1, false],
    [10 * MINUTE, true],
    [HOUR, true],
  ];
  for (const [idle, expected] of cases) {
    assert.equal(
      shouldRestartQuietly({ ...FREE, hiddenSince: null, lastInteractionAt: NOW - idle }),
      expected,
      `${idle}ms untouched`,
    );
  }
});

test("a tab that has just restarted itself will not do it again", () => {
  // A restart that does not take — a rollover, two replicas, a stale proxy —
  // leaves the page pending the moment it boots. Without the cooldown that is a
  // reload loop in a background tab, where nobody would ever see it.
  const cases: Array<[number, boolean]> = [
    [0, false],
    [MINUTE, false],
    [30 * MINUTE - 1, false],
    [30 * MINUTE, true],
    [HOUR, true],
  ];
  for (const [since, expected] of cases) {
    assert.equal(
      shouldRestartQuietly({ ...FREE, lastQuietRestartAt: NOW - since }),
      expected,
      `${since}ms after the last quiet restart`,
    );
  }
});

test("a clock that has gone backwards keeps the tab still, not busy", () => {
  // The safe direction here is the opposite of the notice's. A stored time in
  // the future must not be read as a tab that has been hidden or untouched for
  // ages, and must not open the cooldown early.
  assert.equal(shouldRestartQuietly({ ...FREE, hiddenSince: NOW + DAY, lastInteractionAt: NOW + DAY }), false);
  assert.equal(shouldRestartQuietly({ ...FREE, lastQuietRestartAt: NOW + DAY }), false);
});
