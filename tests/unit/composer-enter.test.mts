import assert from "node:assert/strict";
import test from "node:test";

import { enterSends } from "../../artifacts/kub/src/lib/composerEnter.ts";

// Tracker item 71: on a phone the keyboard's Enter starts a line and the arrow
// sends, as Telegram Web A decides it (`isSendShortcut` is false whenever its
// phone layout is on iOS or Android); anywhere else Enter sends.

const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPAD_DESKTOP_SITE = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";

test("a phone's Enter starts a line, on Android and on an iPhone", () => {
  assert.equal(enterSends({ userAgent: ANDROID, maxTouchPoints: 5, phoneLayout: true }), false);
  assert.equal(enterSends({ userAgent: IPHONE, maxTouchPoints: 5, phoneLayout: true }), false);
  // An iPad asking for the desktop site, in the phone layout of a split screen.
  assert.equal(enterSends({ userAgent: IPAD_DESKTOP_SITE, maxTouchPoints: 5, phoneLayout: true }), false);
});

test("a computer's Enter sends, even in a narrow window", () => {
  assert.equal(enterSends({ userAgent: WINDOWS, maxTouchPoints: 0, phoneLayout: false }), true);
  assert.equal(enterSends({ userAgent: WINDOWS, maxTouchPoints: 0, phoneLayout: true }), true);
  // A Mac is a Mac without touch points.
  assert.equal(enterSends({ userAgent: IPAD_DESKTOP_SITE, maxTouchPoints: 0, phoneLayout: true }), true);
});

test("a tablet in the wide layout sends on Enter, as Telegram Web A's layout rule has it", () => {
  assert.equal(enterSends({ userAgent: ANDROID.replace(" Mobile", ""), maxTouchPoints: 5, phoneLayout: false }), true);
  assert.equal(enterSends({ userAgent: IPAD_DESKTOP_SITE, maxTouchPoints: 5, phoneLayout: false }), true);
});
