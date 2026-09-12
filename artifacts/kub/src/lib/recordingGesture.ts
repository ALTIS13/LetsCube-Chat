/**
 * The recording gesture's rules, as pure functions (D-130).
 *
 * Telegram records from one continuous gesture on the composer's round button:
 * hold and it records, slide up and it locks and goes on without the finger, let
 * go and it is **sent**. A locked recording can be paused, listened to and then
 * sent or deleted. A press too short to be a recording says so beside the button
 * rather than in a dialog.
 *
 * **The sideways slide is gone, on every shell**, on the owner's ruling of
 * 2026-09-12 after he put our renders beside Telegram's own: «без сдвига вбок, у
 * них просто кнопка посередине - отмена». So there is no cancel threshold, no
 * lateral travel to read and no row that moves — a recording is abandoned by the
 * «Отмена» button standing in the middle of the row, which a finger releases over
 * and a mouse clicks. Removing the movement also removed a defect the renders
 * showed: while the row slid it took the timer out of the frame, `04` for
 * `00:04` on the phone and `:03` on the desktop. Nothing translates now, so
 * nothing clips.
 *
 * What the audit found and this work answers is unchanged: rows R4, R6 and R7 of
 * `output/audits/2026-09-12-telegram-parity/chat-functions`, against Telegram's
 * own sources T19, T20 (hold, release sends, swipe up to lock) and T21 (the
 * desktop bar). Only the way out of a held recording has changed shape, from a
 * distance to a target.
 *
 * Nothing here touches the DOM, the network or React, and it imports nothing at
 * all, so `tests/unit/recording-gesture.test.mts` reads this file directly. That
 * is deliberate and it is the lesson of `lib/supabase/config.ts`: a decision that
 * cannot be reached from a test is a gap in the module boundary, not in the
 * suite. Every rule below is reachable without a browser, a microphone or a
 * pointer.
 */

/** What the composer's round button records, which the button's icon says. */
export type RecordingMode = "voice" | "video";

/**
 * Where a held recording is while the finger is still down.
 *
 * Two states, where there were three: `recording` is the gesture at rest and
 * `locking` is reached by travelling up. There is no third reached by travel,
 * because cancelling is no longer a distance — it is a button.
 */
export type RecordingHold = "recording" | "locking";

/**
 * The recording's own state, which outlives the gesture once it is locked.
 *
 * `holding` needs the finger; `locked` does not; `paused` is a locked recording
 * stopped for a listen, which is the only place a preview exists — the tray is
 * no longer one (R9, R10).
 */
export type RecordingPhase = "holding" | "locked" | "paused";

/** What letting go does. `hold` is a locked recording, which a release does not end. */
export type RecordingRelease = "send" | "cancel" | "lock" | "too-short" | "hold";

/**
 * How far up the finger travels before the recording locks.
 *
 * Unchanged from the value the product already shipped, so the gesture people
 * have learned still locks at the same place and the existing coverage in
 * `tests/e2e/video-message.spec.ts`, which drags 96px up, still means what it
 * meant.
 */
export const RECORDING_LOCK_DRAG_PX = 72;

/**
 * How far outside its own box the «Отмена» button still catches a release.
 *
 * The button is 36 points tall in a row of 44, and a thumb dragging along that
 * row is not aiming — it is arriving. Twelve points each way covers the rest of
 * the row's height and a little of the gap on either side, which is the whole
 * of the forgiveness the vanished 96-point slide used to provide.
 */
export const RECORDING_CANCEL_TOUCH_PAD_PX = 12;

/**
 * Shorter than this and there is no recording, only a press.
 *
 * The two values the product already enforced in `ChatWindow`, kept: a voice
 * message needs a second, a round video half of one. What changes is the answer
 * — a hint beside the button instead of a modal alert (R7).
 */
export const RECORDING_MIN_MS: Record<RecordingMode, number> = {
  voice: 1000,
  video: 500,
};

export function recordingMinimumMs(mode: RecordingMode): number {
  return RECORDING_MIN_MS[mode];
}

/** 0 to 1 along the way to the lock. Only upward travel counts. */
export function lockProgress(dy: number): number {
  if (!Number.isFinite(dy) || dy >= 0) return 0;
  return Math.min(1, -dy / RECORDING_LOCK_DRAG_PX);
}

/**
 * Which way a held gesture is going, from how far up the finger has come.
 *
 * One axis, where there were two. The diagonal rule that used to decide between
 * a cancel and a lock went with the slide: there is nothing for the lock to
 * compete with any more, so a finger either reached the rail or it did not.
 */
export function readRecordingHold(dy: number): RecordingHold {
  return lockProgress(dy) >= 1 ? "locking" : "recording";
}

/** A box on the screen, as four edges. Kept plain so this file imports no DOM types. */
export interface RecordingBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Whether a release lands on «Отмена», which is the only way a held recording is
 * thrown away now.
 *
 * The box is inflated by `RECORDING_CANCEL_TOUCH_PAD_PX` on every side, so what
 * a person aims at is the word and what catches them is the row around it. A box
 * with no size — an element that is not on the screen — catches nothing, which
 * is what keeps a missing button from cancelling every recording.
 */
export function overCancelButton(
  point: { x: number; y: number },
  box: RecordingBox | null | undefined,
): boolean {
  if (!box) return false;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  if (box.right <= box.left || box.bottom <= box.top) return false;
  const pad = RECORDING_CANCEL_TOUCH_PAD_PX;
  return (
    point.x >= box.left - pad &&
    point.x <= box.right + pad &&
    point.y >= box.top - pad &&
    point.y <= box.bottom + pad
  );
}

export interface RecordingReleaseInput {
  /** Where the gesture had got to, from `readRecordingHold`. */
  hold: RecordingHold;
  /** The recording's own state; a locked one is not ended by a release. */
  phase: RecordingPhase;
  /** How long it has been recording. */
  durationMs: number;
  mode: RecordingMode;
  /**
   * Whether the release lands on «Отмена», from `overCancelButton`.
   *
   * The same question for a finger and for a mouse, which is new: the desktop
   * used to cancel a recording released anywhere outside the composer — a hidden
   * rule over a 44-point row, and the only one it had while it had no visible
   * cancel. It has one now, in the middle of the row, so the hidden rule is gone
   * and a mouse released on the button cancels exactly as a thumb does.
   */
  pointerOverCancel: boolean;
}

/**
 * What letting go of the button does.
 *
 * The order is the order the reasons beat each other. A locked recording is not
 * ended by a release at all — that is the whole point of locking it — so it is
 * asked first. Then the lock, then the cancel, because a person who let go over
 * «Отмена» means it whatever the recording's length. Only then is the recording
 * judged long enough to be one, and anything that survives all of that is
 * **sent**, with no tray and no second button (R6).
 */
export function releaseRecording(input: RecordingReleaseInput): RecordingRelease {
  if (input.phase === "locked" || input.phase === "paused") return "hold";
  if (input.hold === "locking") return "lock";
  if (input.pointerOverCancel) return "cancel";
  if (input.durationMs < recordingMinimumMs(input.mode)) return "too-short";
  return "send";
}

/** The word on the button that throws a recording away, in the middle of the row. */
export const RECORDING_CANCEL_LABEL = "Отмена";

/**
 * What the bin at the left edge of a stopped recording is called.
 *
 * The control is an icon, so this is spoken rather than drawn — but it is the
 * same promise «Отмена» makes in the states where the recording is still
 * running, and it is worth reading the two names together: one row, one way
 * out, named for what it does in the state it appears in.
 */
export const RECORDING_DELETE_LABEL = "Удалить запись";

/**
 * Which controls the row carries, phase by phase.
 *
 * This exists because the answer changed and the reason it changed is worth
 * keeping next to the rule. The commit that put «Отмена» in the middle of the
 * row also removed the separate bin from the states that had one, on the
 * argument that Telegram's bar has one way out rather than two. The owner then
 * sent Telegram Desktop's **stopped** recording — a bin at the left edge, the
 * bar across the width with the play control and the elapsed time on it, the
 * blue send at the right, and no «Отмена» anywhere — which says the argument
 * was right and the conclusion was wrong. There is one way out per state; it is
 * «Отмена» while the recording runs, and the bin once it has stopped.
 *
 * So `cancelButton` and `trash` are never both true and never both false. That
 * is the invariant this file is here to hold, and it is the one a future edit
 * is most likely to break by adding a control to a state rather than by moving
 * one.
 */
export interface RecordingRowControls {
  /** «Отмена», centred, which a finger releases over and a mouse clicks. */
  cancelButton: boolean;
  /** The bin at the left edge, which is the stopped row's way out. */
  trash: boolean;
  /** The bar across the row, with the play control and the length on it. */
  playback: boolean;
  /** The stop that ends a locked recording so it can be heard first. */
  pause: boolean;
  send: boolean;
}

export function recordingRowControls(phase: RecordingPhase): RecordingRowControls {
  // Stopped: Telegram's own layout, bin to send, with nothing in the middle but
  // what was recorded.
  if (phase === "paused") {
    return { cancelButton: false, trash: true, playback: true, pause: false, send: true };
  }
  // Running, held or locked: «Отмена» in the middle. A held recording has the
  // record button still under the finger as a sibling of the row, so the row's
  // right-hand column is empty; a locked one has the finger free and carries
  // its own stop and send.
  return {
    cancelButton: true,
    trash: false,
    playback: false,
    pause: phase === "locked",
    send: phase === "locked",
  };
}

/**
 * The length of a recording that has stopped, as Telegram writes it: `0:03`.
 *
 * Not `formatRecordingElapsed`, and deliberately not the product's
 * `formatVoiceDuration` either. Three differences, and each of them is the
 * difference between a clock and a length:
 *
 * - no tenths, because nothing is running any more;
 * - minutes are not padded, so a three-second recording reads `0:03` and not
 *   `00:03` — which is what the owner's screenshot shows on the bar;
 * - minutes still grow rather than wrapping.
 *
 * It is used for the length at rest and for the position while the recording is
 * being played back, so the same field means the same kind of thing throughout.
 */
export function formatRecordingLength(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const seconds = Math.floor(safe / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * The elapsed time, with tenths, as Telegram Desktop writes it: `00:05,2`.
 *
 * Two decisions, and both are the owner's screenshot rather than a preference.
 * Tenths, because a recording is the one clock in the product a person watches
 * while it runs, and a seconds-only readout stands still for a whole second at a
 * time — which is exactly how long it takes to wonder whether the recording
 * started. And a comma, because that is the decimal separator in Russian and it
 * is what the screenshot shows; the colon already means something else in the
 * same string.
 *
 * Minutes are not clamped: a long recording grows the field rather than lying
 * about its length.
 */
export function formatRecordingElapsed(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const tenths = Math.floor(safe / 100);
  const seconds = Math.floor(tenths / 10);
  const minutes = Math.floor(seconds / 60);
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return `${mm}:${ss},${tenths % 10}`;
}

/**
 * What state the row is in, for a screen reader.
 *
 * It is spoken rather than drawn. The row used to print the way out in words —
 * «Влево — отмена» under a finger, «Отпустите вне поля — отмена» under a mouse —
 * and both sentences described a gesture that no longer exists. What replaced
 * them is a button that says what it does, so the words left here are the ones a
 * person who cannot see the button still needs.
 */
export function recordingStateLabel(phase: RecordingPhase, mode: RecordingMode): string {
  const what = mode === "video" ? "видеосообщения" : "голосового";
  if (phase === "locked") return "Запись закреплена";
  if (phase === "paused") return "Запись остановлена, можно прослушать";
  return `Идёт запись ${what}`;
}

/**
 * The hint a press too short to be a recording leaves beside the button.
 *
 * It replaces the modal «Запись слишком короткая или пустая.», which stopped the
 * whole interface to report a slip of the thumb (R7). Telegram's own wording for
 * the same moment is «Hold to record audio. Tap to switch to video.» (T19); ours
 * says the half that is true here, because the tap already switches.
 */
export function shortPressHint(mode: RecordingMode): string {
  return mode === "video"
    ? "Удерживайте, чтобы записать видеосообщение"
    : "Удерживайте, чтобы записать голосовое";
}

/** The button's accessible name, which says what a hold will record. */
export function recordingButtonLabel(mode: RecordingMode): string {
  return mode === "video" ? "Видеосообщение" : "Голосовое";
}
