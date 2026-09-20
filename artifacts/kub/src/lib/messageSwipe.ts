/**
 * The horizontal gesture on a message row: a swipe left replies. That is all
 * it does, and the story of why is worth more than the rule.
 *
 * D-287, decided by the owner on 2026-09-20 after the tester could neither
 * reply to nor forward his own photo — «это по аналогии с телеграммом сделай
 * действиями влево/вправо по сообщению». It is added *beside* the long-press
 * menu, which keeps every action it has, so D-071 is not overturned. A
 * horizontal swipe is what reaches a photo at all: a tap there belongs to the
 * viewer, because the photo's opener is itself a `<button>` and
 * `isContentControl` discards the tap that would have opened the menu.
 *
 * ## The measurement that was wrong, and how
 *
 * The first version of this file carried a forward gesture on the right, and
 * argued for it from a measurement: on the owner's device a rightward drag
 * moved a Telegram bubble by **zero pixels**, so the direction looked
 * unclaimed. It is not. **The bubble does not move because the whole screen
 * does** — a rightward swipe in a Telegram conversation is back-to-the-list.
 * Reproduced afterwards, three times out of three from mid-screen and again
 * from either edge: the chat closes.
 *
 * **The lesson, which is the part to keep:** the probe asked «does the message
 * move» when the question was «is the gesture available». An element that does
 * not react to a gesture is not evidence that the gesture is free — something
 * above it may be consuming the whole sequence. Measure the *outcome*, not the
 * element you expected to react.
 *
 * So the right-hand direction belongs to navigation, and a forward modal
 * appearing where somebody meant to leave the conversation is a worse defect
 * than a missing shortcut. Forwarding stays where it was and works: «Переслать»
 * in the long-press menu, and the picker now offers the conversation the
 * message came from, which was the real cause of «переслать тебе он не даёт».
 *
 * ## The platform owns both edges, so we start clear of them
 *
 * Read off both of the owner's phones on 2026-09-20 rather than assumed:
 *
 * - `navigation_mode = 2` on both, which is gesture navigation;
 * - the window manager reports `type=systemGestures` insets of **30dp on the
 *   left and 30dp on the right** (78px at density 420 on one, 60 of 720 on the
 *   other). The back gesture lives at **both** edges, not only the left;
 * - our own shell asks for no exemption at all — with it in the foreground
 *   `mSystemGestureExclusion` is empty. Telegram's was empty too at the moment
 *   it was read.
 *
 * A leftward drag begun at the right edge is therefore the system's back
 * gesture, and that is the *reply* swipe, the one being kept. So a row swipe
 * **refuses to begin inside either inset**. Refusing is honest and
 * predictable; starting and being torn away mid-drag is the worst of both, and
 * a gesture that sometimes works is harder to learn than one that never does
 * in a place you can see.
 *
 * Two consequences stated rather than left to be discovered:
 *
 * - **In three-button navigation there are no edge gestures**, and the refusal
 *   costs a 30dp strip for nothing. Only native code can read
 *   `navigation_mode`; the web layer has no standard signal for it, and
 *   `env(safe-area-inset-*)` does not carry it. One behaviour serves both until
 *   somebody wants that 30dp back badly enough to plumb it through the bridge.
 * - **`setSystemGestureExclusionRects` is the mechanism** if we ever want the
 *   strip: it is a native call, reachable from the Capacitor shell, and capped
 *   by Android at 200dp of vertical extent per edge. Not done here.
 *
 * ## What Telegram's own gesture measures, for the half we keep
 *
 * Telegram for Android 12.10.3 on a 420dpi device, 2026-09-20 — the full
 * record is section 16 of `docs/operations/reference-clients.md`. A row starts
 * moving after about **27dp**, then tracks the finger one to one, and stops at
 * **80dp**; the reply fires **during** the drag at between **46dp and 50dp**,
 * and the row springs back under the finger. Ours starts at 12 and fires at
 * 48 — the commit distance was already theirs, arrived at independently.
 *
 * Two deliberate departures, each with a reason rather than a preference:
 *
 * - **The row starts moving at 12dp, not 27.** The arrow is the only thing
 *   that tells anybody the gesture exists, and a row that does not move until
 *   27dp announces it late.
 * - **The action fires on release, not mid-drag.** A reply bar that appears
 *   under a finger still moving is a surprise we do not need; Telegram can
 *   afford it because the bar is cheap to undo.
 *
 * The decisions live here rather than in the component so they can be tested
 * without a browser, and so the numbers can be mutated to prove the tests see
 * them.
 */

/** How far a finger travels before the row begins to follow it. */
export const SWIPE_START_PX = 12;
/** How far the row will travel, however far the finger goes. */
export const SWIPE_MAX_PX = 64;
/** The travel at which releasing performs the action. */
export const SWIPE_TRIGGER_PX = 48;
/** A swipe is this much more horizontal than vertical, or it is a scroll. */
const SWIPE_HORIZONTAL_RATIO = 1.4;
/**
 * How far in from each edge Android's back gesture reaches, in CSS px — which
 * on a phone viewport are dp. 30 on both edges, measured on both of the
 * owner's devices; AOSP's own default is 24 and vendors raise it, so this is
 * the larger of what was seen rather than the specification's number.
 */
export const SYSTEM_GESTURE_EDGE_PX = 30;

export type SwipeAction = "reply";

/** What this particular message allows, which is not the same for every row. */
export interface SwipeAllowance {
  reply: boolean;
}

/**
 * Whether a finger that went down at `startX` may begin a row swipe at all.
 *
 * False inside either of the platform's gesture insets, where the drag is the
 * system's back and never finishes as ours.
 */
export function swipeMayStartAt(startX: number, viewportWidth: number): boolean {
  if (!Number.isFinite(startX) || !Number.isFinite(viewportWidth) || viewportWidth <= 0) return false;
  return startX >= SYSTEM_GESTURE_EDGE_PX && startX <= viewportWidth - SYSTEM_GESTURE_EDGE_PX;
}

/**
 * Which action a moving finger has started, or `null` while it has started
 * none — because it has not moved far enough, because it is scrolling, because
 * it is going the way that belongs to navigation, or because this message does
 * not offer a reply.
 */
export function swipeActionFor(dx: number, dy: number, allow: SwipeAllowance): SwipeAction | null {
  if (dx >= -SWIPE_START_PX) return null;
  if (Math.abs(dx) <= Math.abs(dy) * SWIPE_HORIZONTAL_RATIO) return null;
  return allow.reply ? "reply" : null;
}

/**
 * How far the row has travelled for a finger that has moved `dx`.
 *
 * The first `SWIPE_START_PX` are spent starting the gesture, so the row leaves
 * its place from where it started moving rather than jumping that distance.
 */
export function swipeOffset(dx: number): number {
  return Math.max(-SWIPE_MAX_PX, Math.min(0, dx + SWIPE_START_PX));
}

/** Whether releasing at this offset performs the action. */
export function swipeCommits(offset: number): boolean {
  return offset <= -SWIPE_TRIGGER_PX;
}

/**
 * How far the indicator has come, 0 to 1.
 *
 * Full at the distance that acts, not at the distance the row stops: the arrow
 * reaching its full size is the promise that letting go now will do something,
 * and the last 16px of travel are only slack.
 */
export function swipeProgress(offset: number): number {
  return Math.min(1, Math.abs(offset) / SWIPE_TRIGGER_PX);
}
