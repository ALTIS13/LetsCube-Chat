import assert from "node:assert/strict";
import test from "node:test";

import {
  VOICE_BAR_SELF_MOUNTED,
  voiceShellBarNeeded,
  voiceShellBarPath,
} from "../../artifacts/kub/src/lib/voiceShellBar.ts";

/**
 * Which screens the application shell has to carry the call bar on.
 *
 * The defect is in `lib/voiceShellBar.ts`'s own head: the bar's two mounts are
 * both inside `MainLayout`, `MainLayout` is `<Route path="/">`, and every other
 * authenticated route therefore ran a call with nothing on screen about it.
 *
 * The two failures this file exists to catch are opposite and both cheap to
 * write by accident:
 *
 *  - the shell drawing a **second** band on `/`, where `Sidebar` and
 *    `MainLayout` already draw one between them;
 *  - the shell drawing **nothing** on a page that has no bar of its own, which
 *    is the state before the change.
 */

test("the messenger carries its own bar, so the shell draws none", () => {
  assert.equal(voiceShellBarNeeded("/"), false);
});

test("every other authenticated route needs the shell's bar", () => {
  // The exact route table of `App.tsx` on 2026-09-19, minus `/`. Listed rather
  // than sampled: each of these is a place a person can be during a call, and
  // «Задачи» is a tab of `BottomNav`, one tap away on a phone.
  for (const location of [
    "/tasks",
    "/bots",
    "/admin",
    "/admin/users",
    "/admin/support/42",
    "/login",
    "/register",
  ]) {
    assert.equal(voiceShellBarNeeded(location), true, location);
  }
});

test("a location nothing routes to still gets the bar", () => {
  // `NotFound` is a full-height page like any other and mounts no bar, so the
  // interesting answer for an unknown path is «yes», not «no». A rule written
  // as an allow-list of known pages would have answered the other way.
  assert.equal(voiceShellBarNeeded("/nothing-here"), true);
  assert.equal(voiceShellBarNeeded("/tasks/deeper/still"), true);
});

test("`/` is matched whole, never as a prefix", () => {
  // The mistake this pins: `location.startsWith("/")` is true of every path
  // there is, so a prefix test would exempt the entire application and restore
  // the defect while reading as a fix.
  assert.equal(voiceShellBarNeeded("/tasks"), true);
  assert.ok(VOICE_BAR_SELF_MOUNTED.includes("/"));
  assert.equal(VOICE_BAR_SELF_MOUNTED.length, 1);
});

test("a query or a hash does not move a page off the exempt list", () => {
  // `/tasks?task=…` is what `NotificationBell` and the desktop notification
  // router both navigate to, so a location with a search string is the normal
  // case rather than a curiosity — and on `/` a stray query must not start a
  // second band above the panes.
  assert.equal(voiceShellBarNeeded("/?task=1"), false);
  assert.equal(voiceShellBarNeeded("/#top"), false);
  assert.equal(voiceShellBarNeeded("/tasks?task=1"), true);
  assert.equal(voiceShellBarPath("/tasks?task=1"), "/tasks");
  assert.equal(voiceShellBarPath("/#top"), "/");
  // A hash before a question mark, so the order the two are stripped in is
  // pinned rather than incidental.
  assert.equal(voiceShellBarPath("/#a?b"), "/");
});

test("an empty location is the messenger, not an unknown page", () => {
  // What a router answers before it has resolved. Reading it as «some other
  // page» would flash a band above the messenger on the first frame of every
  // load taken during a call.
  assert.equal(voiceShellBarPath(""), "/");
  assert.equal(voiceShellBarNeeded(""), false);
});
