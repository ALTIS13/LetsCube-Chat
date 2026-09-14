/**
 * What may raise itself above the conversation, and what may not (D-129).
 *
 * The chat screen decides paint order by **tree order**: the message list is
 * rendered first and the chrome — the header capsules, the pinned capsule, the
 * phone's search panel, the composer dock — after it, every one of them a
 * positioned box at `z-index: auto`. `ChatWindow.tsx` says why, and rule 12 of
 * `docs/operations/interface-material.md` says what the alternatives cost: a
 * `z-index` on the chrome, or an `isolation` on the column, makes a stacking
 * context and clamps every `fixed` overlay hosted in that subtree — the
 * header's phone menu, its modals, the composer's camera and video recorder, a
 * bubble's context menu. On a phone the header's menu opens exactly where the
 * composer is, so whichever of the two chrome boxes lost would have its
 * full-screen dialog covered by the other.
 *
 * The consequence nobody wrote down until D-129 is the other half of the same
 * sentence: **while the chrome is at `auto`, any positive z-index inside the
 * scrolling list beats all of it.** The round video carried `z-10` on its
 * playback button and `z-20` on its corner button. The wrapper around them is
 * `position: relative` with no z-index, so it is not a stacking context and
 * those two numbers were measured against the page — where the header and the
 * composer have no number at all. Measured at 1440 and at 390, in both themes:
 * at twelve points inside the header stack the topmost box was the circle's own
 * overlay, and the pinned capsule's word read «ЗА…» with an orange circle over
 * the rest of it.
 *
 * So the rule is stated from the conversation's side, which is the side that
 * can afford it:
 *
 * - **Content that scrolls carries no z-index.** Inside a message, order is
 *   tree order — it already gives a ring under a video and a corner button over
 *   it, which is exactly what the two numbers were buying.
 * - **A surface that must stand above the chrome leaves the list.** The bubble's
 *   reaction overflow is `createPortal(…, document.body)` and only then takes a
 *   level; a menu, a dialog and the media viewer do the same. A number is
 *   earned by being out of the scroller, not by being large.
 *
 * The levels below are the product's whole vocabulary, read off the components
 * that declare them. A new surface picks one of these rather than inventing a
 * number between two of them.
 *
 * Free of React and of every browser API, so `node --test` reads it directly.
 */

/** A z-index as a stylesheet can state it. */
export type StackingLevel = number | "auto";

/**
 * Every level this product uses, and the surface that owns it.
 *
 * Read off the sources rather than chosen here: `MessageBubble.tsx` (45),
 * `lib/profileWindow.ts` and `NotificationBell.tsx` (60), `SupportWindow.tsx`
 * and `KubFeedbackViewport.tsx` (70), `AppUpdateBanner.tsx` (80),
 * `MediaViewer.tsx` (90), `KubModal.tsx` (95), `BannedScreen.tsx` and
 * `ui/toast.tsx` (100).
 */
export const PRODUCT_STACKING_LEVELS = {
  /** A bubble's overflowed reactions, portalled to the body. */
  reactionOverflow: 45,
  /** A profile or notification window docked over a pane. */
  panel: 60,
  /** The support window, and the feedback toasts that must clear it. */
  supportWindow: 70,
  /** The update banner, above every window and below the viewer. */
  updateBanner: 80,
  /** A photograph or a video at full screen. */
  mediaViewer: 90,
  /** A confirmation, which has to be reachable from a full-screen photo. */
  modal: 95,
  /** The ban screen, and the toast viewport with it. Nothing is above these. */
  banScreen: 100,
} as const;

export type ProductStackingSurface = keyof typeof PRODUCT_STACKING_LEVELS;

/** The lowest level in the vocabulary. Anything under it is not a level, it is a mistake. */
export const LOWEST_PRODUCT_LEVEL = PRODUCT_STACKING_LEVELS.reactionOverflow;

const UTILITY = /^(-?)z-(\[(-?\d+)\]|\d+|auto)$/;

/**
 * The z-index a single Tailwind utility declares, or `null` when the token is
 * not one.
 *
 * Variants are kept: `hover:z-10` raises a box under the pointer just as
 * `z-10` raises it at rest, and a rule that read only the bare form would be
 * satisfied by writing the variant instead. `-z-10` is the negative form, which
 * is its own defect — rule 12 measured that a negative z-index on the list
 * stops it being the hit-test target in both engines.
 */
export function parseStackingUtility(token: string): StackingLevel | null {
  const bare = token.includes(":") ? token.slice(token.lastIndexOf(":") + 1) : token;
  const match = UTILITY.exec(bare);
  if (!match) return null;
  const [, negative, value, bracket] = match;
  if (value === "auto") return "auto";
  const digits = bracket ?? value;
  const parsed = Number(digits);
  if (!Number.isFinite(parsed)) return null;
  return negative === "-" ? -parsed : parsed;
}

/** Every level a class string declares, in the order it declares them. */
export function stackingLevels(className: string): StackingLevel[] {
  return className
    .split(/\s+/)
    .map(parseStackingUtility)
    .filter((level): level is StackingLevel => level !== null);
}

/**
 * Whether a class string would lift a box out of the conversation's own paint
 * order — which, while the chrome sits at `auto`, means above the header, the
 * pinned capsule, the search panel and the composer.
 *
 * `z-auto` and `z-0` are not raises: both leave the box painting in tree order.
 * A negative one is reported too, because it is the other way of leaving tree
 * order and it costs the hit test.
 */
export function raisesOutOfTheConversation(className: string): boolean {
  return stackingLevels(className).some((level) => level !== "auto" && level !== 0);
}

export interface StackingSubject {
  /** What the box is, for the message a failing test prints. */
  name: string;
  className: string;
}

/**
 * The boxes in a conversation that declare a z-index, with what each declares.
 *
 * An empty result is the contract: everything that scrolls with the messages
 * paints in tree order. A caller that portals a surface out of the list asks
 * `PRODUCT_STACKING_LEVELS` for its level instead of passing it through here.
 */
export function conversationStackingOffenders(
  subjects: readonly StackingSubject[],
): { name: string; levels: StackingLevel[] }[] {
  return subjects
    .filter((subject) => raisesOutOfTheConversation(subject.className))
    .map((subject) => ({ name: subject.name, levels: stackingLevels(subject.className) }));
}

/**
 * Whether a level portalled out of the list is one the vocabulary knows.
 *
 * The point is not tidiness. A number chosen between two of these is a claim
 * about which of two surfaces covers the other, made without looking at either;
 * every level above is a claim somebody has already had to defend.
 */
export function isProductStackingLevel(level: number): level is (typeof PRODUCT_STACKING_LEVELS)[ProductStackingSurface] {
  return Object.values(PRODUCT_STACKING_LEVELS).some((known) => known === level);
}

/**
 * The round video's two controls, as classes, so the rule and the markup cannot
 * drift apart.
 *
 * The order the circle's children are written in **is** the layering, and it is
 * the whole reason the two z-indexes could go: the progress ring is `absolute`,
 * the playback button `relative` and the corner button `absolute`, all three
 * positioned inside a wrapper at `z-index: auto`, so the engine paints them in
 * the order the markup lists them. Ring under the video, corner button over
 * it — which is what `z-10` and `z-20` were doing, at the price of doing it
 * against the page instead of against the circle.
 */
export const ROUND_VIDEO_PLAYBACK_CLASS =
  "group relative block h-full w-full overflow-hidden rounded-full bg-black shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]";

export const ROUND_VIDEO_OPEN_CLASS =
  "absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-black/65 text-white backdrop-blur transition-colors hover:bg-black/80";
