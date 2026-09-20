/**
 * The horizontal gesture on a message row: left replies, right forwards.
 *
 * D-287, decided by the owner on 2026-09-20 after the tester could neither
 * reply to nor forward his own photo — «это по аналогии с телеграммом сделай
 * действиями влево/вправо по сообщению». It is added *beside* the long-press
 * menu, which keeps every action it has, so D-071 is not overturned. A
 * horizontal swipe is what reaches a photo at all: a tap there belongs to the
 * viewer, because the photo's opener is itself a `<button>` and
 * `isContentControl` discards the tap that would have opened the menu.
 *
 * ## What Telegram actually does, and where this departs from it
 *
 * Measured on the owner's device on 2026-09-20 (Telegram for Android 12.10.3,
 * 1080x2400 at 420dpi, so 1dp = 2.625 device px; the full record is section 16
 * of `docs/operations/reference-clients.md`):
 *
 * - a row starts moving after about **27dp** of finger travel, then follows it
 *   one to one, and stops at **80dp**;
 * - the reply fires **during** the drag at between **46dp and 50dp**, not on
 *   release, and the row springs back under the finger;
 * - a circular backdrop about 28dp across, with a white arrow in it, is drawn
 *   in the row's free margin while the finger is down;
 * - a gesture abandoned below that distance does nothing at all;
 * - **swiping right does nothing.** The bubble does not move by a pixel. There
 *   is no forward gesture in Telegram to copy.
 *
 * So the right half is ours, not Telegram's, and saying otherwise would be the
 * relabelling CLAUDE.md §7 forbids. It is worth having anyway — forwarding is
 * the other thing the tester could not reach on a photo — and the owner
 * explicitly permits bettering the reference. Two further departures, each
 * with its reason:
 *
 * - **The row starts moving at 12, not 27.** The arrow is the only thing that
 *   tells anybody the gesture exists, and a row that does not move until 27dp
 *   announces it late. This is the same 12 the reply swipe has used since it
 *   was written.
 * - **The action fires on release, not mid-drag.** Telegram can fire early
 *   because its only outcome is a reply bar above the composer, which is
 *   cheap to undo. Ours opens a modal on the forward side, and a modal that
 *   appears under a finger still moving is the wrong kind of surprise.
 *
 * One thing neither client can have: a swipe that begins inside the system's
 * gesture-navigation edge is the operating system's back, not ours. That
 * affects the right-hand gesture on a left-aligned bubble, and there is no
 * fixing it from a web view — it is another reason Telegram may have left the
 * direction alone.
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

export type SwipeAction = "reply" | "forward";

/** What this particular message allows, which is not the same for every row. */
export interface SwipeAllowance {
  reply: boolean;
  forward: boolean;
}

/**
 * Which action a moving finger has started, or `null` while it has started
 * none — either because it has not moved far enough, because it is scrolling,
 * or because this message does not offer what that direction means.
 */
export function swipeActionFor(dx: number, dy: number, allow: SwipeAllowance): SwipeAction | null {
  if (Math.abs(dx) <= SWIPE_START_PX) return null;
  if (Math.abs(dx) <= Math.abs(dy) * SWIPE_HORIZONTAL_RATIO) return null;
  if (dx < 0) return allow.reply ? "reply" : null;
  return allow.forward ? "forward" : null;
}

/**
 * How far the row has travelled for a finger that has moved `dx`.
 *
 * The first `SWIPE_START_PX` are spent starting the gesture, so the row leaves
 * its place from where it started moving rather than jumping that distance.
 */
export function swipeOffset(dx: number, action: SwipeAction): number {
  if (action === "reply") return Math.max(-SWIPE_MAX_PX, Math.min(0, dx + SWIPE_START_PX));
  return Math.min(SWIPE_MAX_PX, Math.max(0, dx - SWIPE_START_PX));
}

/** Whether releasing at this offset performs the action. */
export function swipeCommits(offset: number, action: SwipeAction): boolean {
  return action === "reply" ? offset <= -SWIPE_TRIGGER_PX : offset >= SWIPE_TRIGGER_PX;
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
