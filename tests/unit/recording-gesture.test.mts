import assert from "node:assert/strict";
import test from "node:test";

import {
  RECORDING_CANCEL_LABEL,
  RECORDING_CANCEL_TOUCH_PAD_PX,
  RECORDING_LOCK_DRAG_PX,
  formatRecordingElapsed,
  lockProgress,
  overCancelButton,
  readRecordingHold,
  recordingButtonLabel,
  recordingMinimumMs,
  recordingStateLabel,
  releaseRecording,
  shortPressHint,
  type RecordingReleaseInput,
} from "../../artifacts/kub/src/lib/recordingGesture.ts";

/**
 * D-130: hold to record, release to send, swipe up to lock, and «Отмена» in the
 * middle of the row to throw it away — Telegram's gesture as the owner ruled it
 * on 2026-09-12, as decisions without a pointer or a microphone around them.
 *
 * Every case here fails if the rule it names is changed: the lock threshold, how
 * forgiving the cancel target is, the order the release reasons beat each other,
 * and the one release that does nothing because the recording is already locked.
 */

/** A release that sends, which each case then spoils in exactly one way. */
const sending: RecordingReleaseInput = {
  hold: "recording",
  phase: "holding",
  durationMs: 4_000,
  mode: "voice",
  pointerOverCancel: false,
};

/** The «Отмена» button as it is drawn on a 430-point phone: 74 wide, 36 tall. */
const cancelBox = { left: 172, right: 246, top: 812, bottom: 848 };

test("a hold at rest is a recording, and a release sends it", () => {
  assert.equal(readRecordingHold(0), "recording");
  assert.equal(releaseRecording(sending), "send");
});

test("there is no sideways cancel left: travel does not decide a hold at all", () => {
  // The whole of the owner's ruling, as a rule rather than a layout: a held
  // gesture is read from one axis, and no distance in any direction cancels.
  // Restoring a lateral threshold means restoring a second argument here.
  assert.equal(readRecordingHold.length, 1);
  assert.equal(readRecordingHold(0), "recording");
  assert.equal(releaseRecording({ ...sending, durationMs: 4_000 }), "send");
});

test("sliding up past the threshold locks, and short of it does not", () => {
  assert.equal(readRecordingHold(-(RECORDING_LOCK_DRAG_PX - 1)), "recording");
  assert.equal(readRecordingHold(-RECORDING_LOCK_DRAG_PX), "locking");
  assert.equal(releaseRecording({ ...sending, hold: "locking" }), "lock");
});

test("sliding down is not a lock", () => {
  assert.equal(lockProgress(RECORDING_LOCK_DRAG_PX * 3), 0);
  assert.equal(readRecordingHold(200), "recording");
});

test("the lock distance is the measured one, in pixels", () => {
  // The boundary test above probes *at* the constant, so it holds the rule —
  // the threshold is inclusive — and not the value. This is the distance
  // itself: what a thumb has to travel, and what the owner judges when he
  // decides how easy a recording is to lock.
  assert.equal(RECORDING_LOCK_DRAG_PX, 72);
  assert.equal(readRecordingHold(-71), "recording");
  assert.equal(readRecordingHold(-72), "locking");
});

test("lock progress is the fraction of the way to the rail, and never past 1", () => {
  assert.equal(lockProgress(-RECORDING_LOCK_DRAG_PX / 4), 0.25);
  assert.equal(lockProgress(-RECORDING_LOCK_DRAG_PX), 1);
  assert.equal(lockProgress(-RECORDING_LOCK_DRAG_PX * 9), 1);
  assert.equal(lockProgress(Number.NaN), 0);
});

test("a release over «Отмена» throws the recording away, and beside it does not", () => {
  assert.equal(releaseRecording({ ...sending, pointerOverCancel: true }), "cancel");
  assert.equal(releaseRecording({ ...sending, pointerOverCancel: false }), "send");
});

test("the cancel target is the button plus a forgiving margin, on every side", () => {
  const pad = RECORDING_CANCEL_TOUCH_PAD_PX;
  assert.equal(pad, 12);
  // Dead centre, and each edge from just inside the margin.
  assert.equal(overCancelButton({ x: 209, y: 830 }, cancelBox), true);
  assert.equal(overCancelButton({ x: cancelBox.left - pad, y: 830 }, cancelBox), true);
  assert.equal(overCancelButton({ x: cancelBox.right + pad, y: 830 }, cancelBox), true);
  assert.equal(overCancelButton({ x: 209, y: cancelBox.top - pad }, cancelBox), true);
  assert.equal(overCancelButton({ x: 209, y: cancelBox.bottom + pad }, cancelBox), true);
  // And one point past each of them is not the button.
  assert.equal(overCancelButton({ x: cancelBox.left - pad - 1, y: 830 }, cancelBox), false);
  assert.equal(overCancelButton({ x: cancelBox.right + pad + 1, y: 830 }, cancelBox), false);
  assert.equal(overCancelButton({ x: 209, y: cancelBox.top - pad - 1 }, cancelBox), false);
  assert.equal(overCancelButton({ x: 209, y: cancelBox.bottom + pad + 1 }, cancelBox), false);
});

test("a cancel target that is not on the screen catches nothing", () => {
  // The button is measured from the DOM, and an element that is not laid out
  // reports a box of zero size at the origin. Without this, every recording
  // released near the top-left corner would be thrown away — and worse, a
  // missing button would read as one the pointer is always over.
  assert.equal(overCancelButton({ x: 0, y: 0 }, { left: 0, right: 0, top: 0, bottom: 0 }), false);
  assert.equal(overCancelButton({ x: 0, y: 0 }, null), false);
  assert.equal(overCancelButton({ x: Number.NaN, y: 830 }, cancelBox), false);
});

test("a press too short to be a recording is neither sent nor silently kept", () => {
  assert.equal(releaseRecording({ ...sending, durationMs: 999 }), "too-short");
  assert.equal(releaseRecording({ ...sending, durationMs: 1_000 }), "send");
  // A round video is allowed to be shorter, and the boundary is its own.
  assert.equal(releaseRecording({ ...sending, mode: "video", durationMs: 499 }), "too-short");
  assert.equal(releaseRecording({ ...sending, mode: "video", durationMs: 500 }), "send");
  assert.equal(recordingMinimumMs("voice"), 1_000);
  assert.equal(recordingMinimumMs("video"), 500);
});

test("a locked recording is not ended by letting go, paused or not", () => {
  for (const phase of ["locked", "paused"] as const) {
    assert.equal(releaseRecording({ ...sending, phase }), "hold");
    // Not even by the gestures that would otherwise decide it: the finger is
    // long gone, and what it did on the way out means nothing.
    assert.equal(releaseRecording({ ...sending, phase, pointerOverCancel: true }), "hold");
    assert.equal(releaseRecording({ ...sending, phase, hold: "locking" }), "hold");
    assert.equal(releaseRecording({ ...sending, phase, durationMs: 10 }), "hold");
  }
});

test("cancelling beats a short recording, so a slip is never reported as an accident", () => {
  assert.equal(
    releaseRecording({ ...sending, pointerOverCancel: true, durationMs: 10 }),
    "cancel",
  );
});

test("the lock beats the cancel, because a locked recording can still be deleted", () => {
  // Both true at once: the finger came up past the rail and the rail happens to
  // stand over the cancel's margin. Locking is the recoverable answer — the row
  // it produces has «Отмена» in the middle of it — and cancelling is not.
  assert.equal(
    releaseRecording({ ...sending, hold: "locking", pointerOverCancel: true }),
    "lock",
  );
});

test("the elapsed time carries tenths, with a comma, as Telegram Desktop writes it", () => {
  assert.equal(formatRecordingElapsed(0), "00:00,0");
  assert.equal(formatRecordingElapsed(5_200), "00:05,2");
  assert.equal(formatRecordingElapsed(59_900), "00:59,9");
  assert.equal(formatRecordingElapsed(60_000), "01:00,0");
  assert.equal(formatRecordingElapsed(603_500), "10:03,5");
  // A tenth is floored, never rounded up: a clock that reads 00:05,0 before
  // five seconds have passed is a clock that lies about the length of what it
  // is about to send.
  assert.equal(formatRecordingElapsed(4_999), "00:04,9");
  // Minutes grow rather than wrapping, so an hour-long recording is not «00:01».
  assert.equal(formatRecordingElapsed(3_600_000), "60:00,0");
  // Nothing sensible in, zero out.
  assert.equal(formatRecordingElapsed(-5), "00:00,0");
  assert.equal(formatRecordingElapsed(Number.NaN), "00:00,0");
});

test("the row's spoken state names the phase, and no vanished gesture", () => {
  assert.equal(recordingStateLabel("holding", "voice"), "Идёт запись голосового");
  assert.equal(recordingStateLabel("holding", "video"), "Идёт запись видеосообщения");
  assert.equal(recordingStateLabel("locked", "voice"), "Запись закреплена");
  assert.match(recordingStateLabel("paused", "voice"), /прослушать/);
  // The two sentences the row used to print described the slide that is gone.
  // Neither may come back through here.
  for (const phase of ["holding", "locked", "paused"] as const) {
    for (const mode of ["voice", "video"] as const) {
      const label = recordingStateLabel(phase, mode);
      assert.doesNotMatch(label, /Влево/);
      assert.doesNotMatch(label, /вне поля/);
    }
  }
});

test("the way out is one word, and it is the one on the button", () => {
  assert.equal(RECORDING_CANCEL_LABEL, "Отмена");
});

test("a short press hints beside the button instead of raising a dialog", () => {
  assert.match(shortPressHint("voice"), /Удерживайте/);
  assert.match(shortPressHint("video"), /видеосообщение/);
  assert.equal(recordingButtonLabel("voice"), "Голосовое");
  assert.equal(recordingButtonLabel("video"), "Видеосообщение");
});
