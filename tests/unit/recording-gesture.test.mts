import assert from "node:assert/strict";
import test from "node:test";

import {
  RECORDING_CANCEL_SLIDE_PX,
  RECORDING_LOCK_DRAG_PX,
  lockProgress,
  readRecordingHold,
  recordingButtonLabel,
  recordingHoldLabel,
  recordingMinimumMs,
  releaseRecording,
  shortPressHint,
  slideCancelProgress,
  slideFollowX,
  type RecordingReleaseInput,
} from "../../artifacts/kub/src/lib/recordingGesture.ts";

/**
 * D-130: hold to record, slide left to cancel, release to send, slide up to
 * lock — Telegram's one continuous gesture, as decisions without a pointer or a
 * microphone around them.
 *
 * Every case here fails if the rule it names is changed: the thresholds, which
 * axis wins a diagonal, the order the release reasons beat each other, and the
 * one release that does nothing because the recording is already locked.
 */

/** A release that sends, which each case then spoils in exactly one way. */
const sending: RecordingReleaseInput = {
  hold: "recording",
  phase: "holding",
  durationMs: 4_000,
  mode: "voice",
  pointerInsideComposer: true,
  pointerType: "touch",
};

test("a hold at rest is a recording, and a release sends it", () => {
  assert.equal(readRecordingHold({ dx: 0, dy: 0 }), "recording");
  assert.equal(releaseRecording(sending), "send");
});

test("sliding left past the threshold cancels, and short of it does not", () => {
  assert.equal(readRecordingHold({ dx: -(RECORDING_CANCEL_SLIDE_PX - 1), dy: 0 }), "recording");
  assert.equal(readRecordingHold({ dx: -RECORDING_CANCEL_SLIDE_PX, dy: 0 }), "cancelling");
  assert.equal(
    releaseRecording({ ...sending, hold: "cancelling" }),
    "cancel",
    "a slid-away recording is thrown away however long it ran",
  );
});

test("sliding right is not a cancel, however far", () => {
  assert.equal(slideCancelProgress(RECORDING_CANCEL_SLIDE_PX * 4), 0);
  assert.equal(readRecordingHold({ dx: 400, dy: 0 }), "recording");
});

test("sliding up past the threshold locks, and short of it does not", () => {
  assert.equal(readRecordingHold({ dx: 0, dy: -(RECORDING_LOCK_DRAG_PX - 1) }), "recording");
  assert.equal(readRecordingHold({ dx: 0, dy: -RECORDING_LOCK_DRAG_PX }), "locking");
  assert.equal(releaseRecording({ ...sending, hold: "locking" }), "lock");
});

test("sliding down is not a lock", () => {
  assert.equal(lockProgress(RECORDING_LOCK_DRAG_PX * 3), 0);
  assert.equal(readRecordingHold({ dx: 0, dy: 200 }), "recording");
});

test("the two distances are the measured ones, in pixels", () => {
  // The boundary tests above probe *at* the constants, so they hold the rule —
  // each threshold is inclusive — and not the value. Both survived a mutation
  // that moved a threshold by one pixel, because the probe moved with it. These
  // are the distances themselves: what a thumb has to travel, and what the owner
  // judges when he decides how easy a recording is to throw away. Changing one
  // is a decision, and it should have to be made here as well as there.
  assert.equal(RECORDING_CANCEL_SLIDE_PX, 96);
  assert.equal(RECORDING_LOCK_DRAG_PX, 72);
  assert.equal(readRecordingHold({ dx: -95, dy: 0 }), "recording");
  assert.equal(readRecordingHold({ dx: -96, dy: 0 }), "cancelling");
  assert.equal(readRecordingHold({ dx: 0, dy: -71 }), "recording");
  assert.equal(readRecordingHold({ dx: 0, dy: -72 }), "locking");
});

test("a diagonal goes to whichever axis is further along, and a tie locks", () => {
  // Both past their thresholds, but the cancel is further along its own.
  assert.equal(
    readRecordingHold({ dx: -RECORDING_CANCEL_SLIDE_PX * 2, dy: -RECORDING_LOCK_DRAG_PX }),
    "cancelling",
  );
  // Both exactly at their thresholds: the lock wins, because a locked recording
  // can still be deleted and a cancelled one cannot be got back.
  assert.equal(
    readRecordingHold({ dx: -RECORDING_CANCEL_SLIDE_PX, dy: -RECORDING_LOCK_DRAG_PX }),
    "locking",
  );
});

test("progress is the fraction of the way to each threshold, and never past 1", () => {
  assert.equal(slideCancelProgress(-RECORDING_CANCEL_SLIDE_PX / 2), 0.5);
  assert.equal(slideCancelProgress(-RECORDING_CANCEL_SLIDE_PX * 9), 1);
  assert.equal(lockProgress(-RECORDING_LOCK_DRAG_PX / 4), 0.25);
  assert.equal(lockProgress(-RECORDING_LOCK_DRAG_PX * 9), 1);
});

test("the row follows the finger left, stops at the cancel point, and never goes right", () => {
  assert.equal(slideFollowX(-20), -20);
  assert.equal(slideFollowX(-RECORDING_CANCEL_SLIDE_PX * 5), -RECORDING_CANCEL_SLIDE_PX);
  assert.equal(slideFollowX(64), 0);
});

test("a mouse released outside the composer cancels; a finger outside does not", () => {
  assert.equal(
    releaseRecording({ ...sending, pointerType: "mouse", pointerInsideComposer: false }),
    "cancel",
  );
  assert.equal(
    releaseRecording({ ...sending, pointerType: "mouse", pointerInsideComposer: true }),
    "send",
  );
  assert.equal(
    releaseRecording({ ...sending, pointerType: "touch", pointerInsideComposer: false }),
    "send",
    "a finger has «Влево — отмена»; there is no outside for it to mean anything",
  );
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
    // Not even by the gestures that would otherwise cancel it: the finger is
    // long gone, and what it did on the way out means nothing.
    assert.equal(releaseRecording({ ...sending, phase, hold: "cancelling" }), "hold");
    assert.equal(
      releaseRecording({ ...sending, phase, pointerType: "mouse", pointerInsideComposer: false }),
      "hold",
    );
    assert.equal(releaseRecording({ ...sending, phase, durationMs: 10 }), "hold");
  }
});

test("cancelling beats a short recording, so a slip is never sent", () => {
  assert.equal(
    releaseRecording({ ...sending, hold: "cancelling", durationMs: 10 }),
    "cancel",
    "a deliberate cancel is not reported as an accident",
  );
});

test("the row says what the gesture will do, and a mouse is told its own way out", () => {
  assert.equal(recordingHoldLabel("recording", "touch"), "Влево — отмена");
  assert.equal(recordingHoldLabel("recording", "mouse"), "Отпустите вне поля — отмена");
  assert.equal(recordingHoldLabel("locking", "touch"), "Запись закреплена");
  // There is no «about to cancel» state to speak: crossing the threshold throws
  // the recording away at once, so nothing ever reads this label for it.
  assert.equal(recordingHoldLabel("cancelling", "touch"), "Влево — отмена");
});

test("a short press hints beside the button instead of raising a dialog", () => {
  assert.match(shortPressHint("voice"), /Удерживайте/);
  assert.match(shortPressHint("video"), /видеосообщение/);
  assert.equal(recordingButtonLabel("voice"), "Голосовое");
  assert.equal(recordingButtonLabel("video"), "Видеосообщение");
});
