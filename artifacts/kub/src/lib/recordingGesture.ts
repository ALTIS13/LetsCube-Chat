/**
 * The recording gesture's rules, as pure functions (D-130).
 *
 * Telegram records from one continuous gesture on the composer's round button:
 * hold and it records, slide left and it is thrown away, slide up and it locks
 * and goes on without the finger, let go and it is **sent**. A locked recording
 * can be paused, listened to and then sent or deleted. A press too short to be a
 * recording says so beside the button rather than in a dialog.
 *
 * What we had instead: only the upward drag was read, so a sideways slide did
 * nothing and an accidental recording could not be abandoned; and every release
 * parked the recording in the attachment tray, where it needed a second,
 * separate «Отправить». The audit rows are R4, R6 and R7 of
 * `output/audits/2026-09-12-telegram-parity/chat-functions`, against Telegram's
 * own sources T19 (the recording hints, «Slide to cancel» included), T20 (hold,
 * release sends, swipe up to lock) and T21 (the desktop bar: release outside the
 * field cancels, and a locked recording plays back).
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
 * `recording` is the resting state of the gesture; `cancelling` and `locking`
 * are reached by travel and are what a release then means.
 */
export type RecordingHold = "recording" | "cancelling" | "locking";

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
 * How far left the finger travels before the recording is thrown away.
 *
 * Far enough that the drift of a thumb settling on a button is not a cancel, and
 * near enough to reach without lifting the hand: on the narrowest phone in the
 * matrix, 360 points, it is a bit over a quarter of the screen.
 */
export const RECORDING_CANCEL_SLIDE_PX = 96;

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

/** 0 to 1 along the way to a cancel. Only leftward travel counts; rightward is nothing. */
export function slideCancelProgress(dx: number): number {
  if (!Number.isFinite(dx) || dx >= 0) return 0;
  return Math.min(1, -dx / RECORDING_CANCEL_SLIDE_PX);
}

/** 0 to 1 along the way to the lock. Only upward travel counts. */
export function lockProgress(dy: number): number {
  if (!Number.isFinite(dy) || dy >= 0) return 0;
  return Math.min(1, -dy / RECORDING_LOCK_DRAG_PX);
}

/**
 * How far the recording row is drawn from where it started, following the
 * finger leftwards and never past the point where it would be cancelled.
 *
 * Telegram's row travels with the finger, which is what makes «Влево — отмена»
 * a gesture a person can feel their way through rather than a sentence to obey.
 */
export function slideFollowX(dx: number): number {
  if (!Number.isFinite(dx) || dx >= 0) return 0;
  return Math.max(-RECORDING_CANCEL_SLIDE_PX, dx);
}

/**
 * How far along an axis the finger is, as a multiple of that axis's threshold
 * and **not** clamped. Zero or less means it went the other way.
 *
 * The clamped versions above are for drawing — a rail cannot fill past its top.
 * This one is for deciding, and the difference is the whole of a diagonal: once
 * both axes clamp at 1, a finger that went twice as far left as it did up reads
 * as an exact tie, and the gesture it plainly is gets the wrong answer. Caught
 * by `tests/unit/recording-gesture.test.mts` on the first run of the rule.
 */
function travelRatio(distance: number, threshold: number): number {
  if (!Number.isFinite(distance)) return 0;
  return -distance / threshold;
}

/**
 * Which way a held gesture is going, from where the finger landed.
 *
 * The two axes are compared by how far along each is rather than by pixels, so
 * neither threshold has to be the other's size for the comparison to be fair. A
 * tie goes to the lock: a recording that locks can still be cancelled a moment
 * later from its own row, where a cancelled one is gone for good.
 */
export function readRecordingHold(travel: { dx: number; dy: number }): RecordingHold {
  const lock = travelRatio(travel.dy, RECORDING_LOCK_DRAG_PX);
  const cancel = travelRatio(travel.dx, RECORDING_CANCEL_SLIDE_PX);
  if (lock >= 1 && lock >= cancel) return "locking";
  if (cancel >= 1) return "cancelling";
  return "recording";
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
   * Whether the pointer is over the composer. Only a mouse is asked: Telegram
   * Desktop cancels a recording released outside the field (T21), where a finger
   * has «Влево — отмена» instead and nothing outside to mean anything.
   */
  pointerInsideComposer: boolean;
  pointerType: "mouse" | "touch" | "pen";
}

/**
 * What letting go of the button does.
 *
 * The order is the order the reasons beat each other. A locked recording is not
 * ended by a release at all — that is the whole point of locking it — so it is
 * asked first. Then the two ways to throw the recording away, because a person
 * who has slid to cancel means it whatever the recording's length. Only then is
 * the recording judged long enough to be one, and anything that survives all of
 * that is **sent**, with no tray and no second button (R6).
 */
export function releaseRecording(input: RecordingReleaseInput): RecordingRelease {
  if (input.phase === "locked" || input.phase === "paused") return "hold";
  if (input.hold === "locking") return "lock";
  if (input.hold === "cancelling") return "cancel";
  if (input.pointerType === "mouse" && !input.pointerInsideComposer) return "cancel";
  if (input.durationMs < recordingMinimumMs(input.mode)) return "too-short";
  return "send";
}

/**
 * What the row says while the finger is down, in Telegram's words for each
 * state rather than a card explaining the gesture (R3).
 */
export function recordingHoldLabel(hold: RecordingHold, pointerType: "mouse" | "touch" | "pen"): string {
  if (hold === "cancelling") return "Отпустите — запись отменится";
  if (hold === "locking") return "Запись закреплена";
  return pointerType === "mouse" ? "Отпустите вне поля — отмена" : "Влево — отмена";
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
