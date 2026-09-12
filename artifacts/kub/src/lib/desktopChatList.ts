/**
 * The computer's left region: a fixed folder rail, and a chat list the person
 * drags as narrow as a strip of avatars.
 *
 * The numbers are Telegram Desktop's own, read off its source on 2026-09-12 and
 * recorded in `output/audits/2026-09-12-telegram-windows-ios/assessment.md`:
 *
 *  - `windowFiltersWidth: 72px` is the folder rail, and it does not move;
 *  - `dialogsSmallColumnWidth()` is `padding.left + photoSize + padding.left` on
 *    `defaultDialogRow`, which is 10 + 46 + 10 = **66px** — the list with
 *    everything but the picture removed, not a smaller list;
 *  - `columnMinimalWidthLeft: 260` and `columnMaximalWidthLeft: 540` bound the
 *    normal width.
 *
 * Two things are deliberately *not* copied.
 *
 *  - Telegram stores a ratio of the body width. We store pixels: our window can
 *    be a browser tab on a 3840px monitor, where a ratio hands the list 900px of
 *    a screen the person never asked to give it.
 *  - Telegram does not remember the collapsed state across a restart
 *    (tdesktop#6409), and the assessment calls that out as the thing not to
 *    copy. `collapsed` is stored beside the width and `effectiveChatListWidth`
 *    honours it, so a person who collapsed the list finds it collapsed.
 *
 * Pure functions, importing nothing, so `node --test` can reach them without a
 * bundler, a DOM or `import.meta.env` — the lesson CLAUDE.md records about
 * `isSupabaseConfigured()`: a check that cannot be reached from a test is a gap
 * in the module boundary, not in the suite.
 */

/** Telegram's `windowFiltersWidth`. The rail never resizes. */
export const FOLDER_RAIL_WIDTH = 72;

/** Telegram's `dialogsSmallColumnWidth()`: padding 10 + avatar 46 + padding 10. */
export const CHAT_LIST_COLLAPSED_WIDTH = 66;

/** Telegram's `columnMinimalWidthLeft`. */
export const CHAT_LIST_MIN_WIDTH = 260;

/** Telegram's `columnMaximalWidthLeft`. */
export const CHAT_LIST_MAX_WIDTH = 540;

/**
 * What the list is before anyone drags it. 360 is the width the breakpoint
 * triple in `MainLayout` started at, so a person who never touches the handle
 * sees exactly the column they saw before.
 */
export const CHAT_LIST_DEFAULT_WIDTH = 360;

/**
 * Below this, releasing the handle settles the list collapsed rather than
 * springing back to 260. It sits between the two resting widths so that neither
 * is reachable by accident: a drag has to cross 134px of dead band to collapse.
 */
export const CHAT_LIST_COLLAPSE_BELOW = 200;

export const DESKTOP_CHAT_LIST_STORAGE_KEY = "kub-desktop-chat-list";

export interface DesktopChatListState {
  /** The width the person last settled on, in CSS pixels. */
  width: number;
  /** Whether the list rests as a strip of avatars. */
  collapsed: boolean;
}

export const DESKTOP_CHAT_LIST_DEFAULT_STATE: DesktopChatListState = {
  width: CHAT_LIST_DEFAULT_WIDTH,
  collapsed: false,
};

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * How far along the way to a strip of avatars the list is: 0 at its normal
 * narrowest and 1 at the strip, interpolated in between.
 *
 * A ratio, not a boolean, and that is the whole point. Telegram's
 * `Dialogs::InnerWidget::setNarrowRatio(float64)` interpolates the row as the
 * handle moves, so there is no mode to switch and no snap to watch. Ours is
 * handed to CSS as `--kub-chat-list-narrow` and the row reads it; nothing in
 * React renders for a frame of the drag.
 */
export function chatListNarrowRatio(width: number): number {
  if (!Number.isFinite(width)) return 0;
  if (width >= CHAT_LIST_MIN_WIDTH) return 0;
  if (width <= CHAT_LIST_COLLAPSED_WIDTH) return 1;
  return (CHAT_LIST_MIN_WIDTH - width) / (CHAT_LIST_MIN_WIDTH - CHAT_LIST_COLLAPSED_WIDTH);
}

/**
 * The width the list takes *while the handle is held*: the pointer, bounded by
 * the strip below and the maximum above, and continuous everywhere between.
 *
 * Deliberately not snapped. Snapping here is what makes a drag feel like a
 * switch, and the ratio above exists so the band between 66 and 260 is a place
 * the list can actually be while the pointer is in it.
 */
export function liveChatListWidth(requested: number): number {
  if (!Number.isFinite(requested)) return CHAT_LIST_DEFAULT_WIDTH;
  return clamp(requested, CHAT_LIST_COLLAPSED_WIDTH, CHAT_LIST_MAX_WIDTH);
}

/**
 * Where the list comes to rest when the handle is let go: the strip, or a
 * normal width. The band between them is a place to pass through, not to stop.
 */
export function settleChatListState(requested: number): DesktopChatListState {
  if (!Number.isFinite(requested)) return { ...DESKTOP_CHAT_LIST_DEFAULT_STATE };
  if (requested < CHAT_LIST_COLLAPSE_BELOW) {
    return { width: CHAT_LIST_COLLAPSED_WIDTH, collapsed: true };
  }
  return { width: clamp(requested, CHAT_LIST_MIN_WIDTH, CHAT_LIST_MAX_WIDTH), collapsed: false };
}

/**
 * The width a stored state actually renders at.
 *
 * `collapsed` wins over `width`, and that is the half Telegram does not keep:
 * a state whose flag is set renders as the strip whatever number sits beside
 * it, so the width the person chose before collapsing survives to be restored
 * when they open it again.
 */
export function effectiveChatListWidth(state: DesktopChatListState): number {
  if (state.collapsed) return CHAT_LIST_COLLAPSED_WIDTH;
  return clamp(
    Number.isFinite(state.width) ? state.width : CHAT_LIST_DEFAULT_WIDTH,
    CHAT_LIST_MIN_WIDTH,
    CHAT_LIST_MAX_WIDTH,
  );
}

/** Collapsing keeps the width to come back to; expanding restores it. */
export function toggleChatListCollapsed(state: DesktopChatListState): DesktopChatListState {
  return { width: state.width, collapsed: !state.collapsed };
}

/**
 * A stored state, or the default.
 *
 * Everything that is not a number in range or a boolean is the default rather
 * than an error: this comes out of `localStorage`, which another version of the
 * application wrote and a person can edit.
 */
export function readDesktopChatListState(raw: unknown): DesktopChatListState {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ...DESKTOP_CHAT_LIST_DEFAULT_STATE };
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ...DESKTOP_CHAT_LIST_DEFAULT_STATE };
  }
  const candidate = parsed as { width?: unknown; collapsed?: unknown };
  const width =
    typeof candidate.width === "number" && Number.isFinite(candidate.width)
      ? clamp(candidate.width, CHAT_LIST_MIN_WIDTH, CHAT_LIST_MAX_WIDTH)
      : CHAT_LIST_DEFAULT_WIDTH;
  return { width, collapsed: candidate.collapsed === true };
}

export function serializeDesktopChatListState(state: DesktopChatListState): string {
  return JSON.stringify({ width: state.width, collapsed: state.collapsed });
}
