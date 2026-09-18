import assert from "node:assert/strict";
import test from "node:test";

import {
  callReachabilityNotice,
  callsNeedThisAppOpen,
} from "../../artifacts/kub/src/lib/callReachability.ts";

/**
 * Slice E: the one shell where the product has to say a call cannot reach you.
 *
 * Both halves are asserted, and the negative one is the point. A notice that
 * appeared everywhere would be four sentences nobody asked for, three of them
 * wrong — Windows has a setting that fixes it, Android has a slice that will,
 * and a closed browser tab explains itself. The value of this module is that it
 * says it in exactly one place.
 */

const on = (target: string, standalone = true) => callsNeedThisAppOpen({ target, standalone });

test("it speaks for the iPhone and the iPad, and for nothing else", () => {
  assert.equal(on("ios_pwa"), true);
  // Installed or in a tab: Safari suspends both, so the limitation is the same
  // and only the noun changes.
  assert.equal(on("ios_pwa", false), true);

  // The three that must stay silent, each for its own reason.
  assert.equal(on("windows_native"), false, "Windows has autostart, two rows away");
  assert.equal(on("android_native"), false, "Android's answer is slice D, not a notice");
  assert.equal(on("web_only"), false, "a closed tab explains itself");
  assert.equal(on("android_download"), false);
  assert.equal(on("windows_download"), false);
});

test("the target is the detector's spelling, not the shorter one it looks like", () => {
  // `detectDistributionTarget` answers `ios_pwa`. Matching on `ios` compiles,
  // reads correctly, and is never true — which is the whole mutation this
  // covers, and it was the first draft.
  assert.equal(on("ios"), false);
});

test("it says what happens, what cannot be changed, and what still works", () => {
  const notice = callReachabilityNotice({ target: "ios_pwa", standalone: true });
  assert.ok(notice);
  // iPad is in this shell too, so the heading may not name only the phone.
  assert.match(notice.title, /iPad/);
  assert.match(notice.text, /приложение LETSCUBE открыто/);
  // The limitation is stated as permanent rather than as «not yet», because it
  // is: no setting changes it.
  assert.match(notice.text, /обойти это нельзя/);
  // And the half that keeps it from being only bad news — true because slice C
  // writes the record with no client present.
  assert.match(notice.text, /Пропущенный звонок всё равно появится в переписке/);
});

test("a tab says «вкладка» and an installed app says «приложение»", () => {
  const tab = callReachabilityNotice({ target: "ios_pwa", standalone: false });
  const app = callReachabilityNotice({ target: "ios_pwa", standalone: true });
  assert.ok(tab && app);
  assert.match(tab.text, /эта вкладка открыта/);
  assert.ok(!tab.text.includes("приложение LETSCUBE открыто"));
  assert.match(app.text, /приложение LETSCUBE открыто/);
  // One sentence, two nouns: everything else about them is the same.
  assert.equal(tab.title, app.title);
});

test("every other shell gets nothing at all, not an empty notice", () => {
  for (const target of ["windows_native", "android_native", "web_only", "windows_download"]) {
    assert.equal(
      callReachabilityNotice({ target, standalone: true }),
      null,
      `${target} was told something about iPhone calls`,
    );
  }
});
