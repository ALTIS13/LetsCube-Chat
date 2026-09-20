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

/**
 * Everything in the left region that is **not** the list: the 72px folder rail
 * and the region's own right hairline.
 *
 * `.kub-left-region` is `calc(72px + var(--kub-chat-list-width) + 1px)`, so the
 * region is always this much wider than the column the width names. The handle
 * has to subtract it, and the first version did not — it read the pointer's
 * distance from the region's own left edge and wrote that straight into the
 * column's width, with a comment saying the rail «is already in it and the
 * arithmetic does not have to know the rail exists». It is in it, which is
 * exactly why the arithmetic does have to take it out.
 *
 * The cost was 73px of lag on every frame: grabbing the handle without moving
 * jumped the list 73px wider, and dragging left crossed the collapse threshold
 * while the pointer was still deep inside the list. The owner reported it as
 * «сразу становятся аватарками без возможности вытянуть обратно» (D-196).
 */
export const CHAT_LIST_REGION_CHROME = 73;

/** Telegram's `columnMinimalWidthLeft`. */
export const CHAT_LIST_MIN_WIDTH = 260;

/**
 * Telegram's `columnMaximalWidthLeft`, and the widest this list may ever be on
 * any screen. `chatListMaxWidth` is what a given window actually allows.
 */
export const CHAT_LIST_MAX_WIDTH = 540;

/**
 * The share of the window the whole left region — rail, list and the region's
 * own hairline — may take at its widest.
 *
 * **0.3 is Discord's ceiling, divided by the width ours was measured wrong at:
 * `432 / 1440`.** Read off the shipped client on 2026-09-20, from
 * `discord.com/assets/web.<hash>.js` at `BUILD_NUMBER 615980` — the same bundle
 * the desktop application's renderer downloads, so this is one number and not
 * two that happen to agree:
 *
 *     E = (0, n1.A)({ minDimension: 264, maxDimension: 432, … })
 *     …  "aria-valuemin": 264, "aria-valuemax": 432
 *     …  case "Home": t = 264; case "End": t = 432
 *     …  Number.isNaN(e) && (e = 375)      // the default, when nothing is stored
 *
 * `--custom-guild-sidebar-width` is that whole region: the channel list is
 * `calc(var(--custom-guild-sidebar-width) - var(--custom-guild-list-width) - 1px)`
 * and the guild rail is 76 (a 44pt avatar and 16 of padding each side), so
 * Discord's list alone is 187…355 around a default of 298. Ours is the same
 * shape — a rail of 72 and a hairline, `CHAT_LIST_REGION_CHROME`.
 *
 * **Discord's 432 is a hard constant and does not move with the window.** There
 * is no viewport term anywhere in that path: no `innerWidth`, and not one
 * `@media (width)` rule on the sidebar in its 3.4 MB of stylesheets. So this is
 * the one place we deliberately do more than Discord does, and the reason is
 * that a constant is only safe for the window Discord ships:
 *
 *  - Discord is a window with a floor under its width. We are also a browser
 *    tab, which can be 900 points wide on a laptop beside another window, and
 *    at 900 a 432 region is 48% of everything.
 *  - Discord's region is the ONLY fixed column before its conversation. Ours is
 *    followed by `ChannelRail`, 224 more points, in any group that has channels
 *    — so the same region costs us 224 points more than it costs Discord.
 *
 * A share answers both without asking which shell it is running in, and that is
 * why it is a share rather than a platform check: a maximised Tauri window on a
 * 1920 monitor and a browser tab on the same monitor are the same number to
 * this function, and `window.innerWidth` is already the truth in both.
 *
 * What it computes, with `CHAT_LIST_MAX_WIDTH` still the absolute ceiling:
 *
 *   | window | region allowed | list allowed |               |
 *   | ------ | -------------- | ------------ | ------------- |
 *   |   1024 |            333 |          260 | floored at the minimum |
 *   |   1280 |            384 |          311 |               |
 *   |   1440 |            432 |          359 | exactly Discord's |
 *   |   1920 |            576 |          503 |               |
 *   |   2133 |            613 |          540 | Telegram's ceiling reached |
 *   |   2560 |            613 |          540 | unchanged from today |
 *
 * The last two rows are the half worth saying out loud: nobody on a large
 * monitor loses a point of what they have today, and the 1440 defect (D-270,
 * the conversation down to 603 points with the wallpaper composed on it) is
 * answered where it is actually caused.
 */
export const CHAT_LIST_MAX_SHARE = 0.3;

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
 * The widest this window allows the list to be: `CHAT_LIST_MAX_SHARE` of it,
 * less the rail and the hairline, never below the normal narrowest and never
 * above Telegram's ceiling.
 *
 * **An unreadable window is permissive, not restrictive**, and that asymmetry
 * is deliberate. This is only ever used to clamp, and a `0` arriving from a
 * server render or a detached document must not be allowed to cut somebody's
 * stored 540 down to 260 — the width would be gone before the first paint that
 * could have measured properly.
 */
export function chatListMaxWidth(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return CHAT_LIST_MAX_WIDTH;
  const region = Math.round(viewportWidth * CHAT_LIST_MAX_SHARE);
  return clamp(region - CHAT_LIST_REGION_CHROME, CHAT_LIST_MIN_WIDTH, CHAT_LIST_MAX_WIDTH);
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
export function liveChatListWidth(
  requested: number,
  maxWidth: number = CHAT_LIST_MAX_WIDTH,
): number {
  if (!Number.isFinite(requested)) return CHAT_LIST_DEFAULT_WIDTH;
  return clamp(requested, CHAT_LIST_COLLAPSED_WIDTH, maxWidth);
}

/**
 * Where the list comes to rest when the handle is let go: the strip, or a
 * normal width. The band between them is a place to pass through, not to stop.
 */
export function settleChatListState(
  requested: number,
  maxWidth: number = CHAT_LIST_MAX_WIDTH,
): DesktopChatListState {
  if (!Number.isFinite(requested)) return { ...DESKTOP_CHAT_LIST_DEFAULT_STATE };
  if (requested < CHAT_LIST_COLLAPSE_BELOW) {
    return { width: CHAT_LIST_COLLAPSED_WIDTH, collapsed: true };
  }
  return { width: clamp(requested, CHAT_LIST_MIN_WIDTH, maxWidth), collapsed: false };
}

/**
 * The width a stored state actually renders at.
 *
 * `collapsed` wins over `width`, and that is the half Telegram does not keep:
 * a state whose flag is set renders as the strip whatever number sits beside
 * it, so the width the person chose before collapsing survives to be restored
 * when they open it again.
 *
 * **`maxWidth` clamps what is drawn and must never be written back.** The
 * stored width is a decision the person made; this window is a fact about
 * right now. Somebody who chose 540 on a docked monitor and then undocked to a
 * 1280 laptop is drawn 311 and finds 540 again when they dock — which is the
 * same rule `collapsed` follows one line above, applied to the other axis. The
 * caller that breaks this is the one that answers a `resize` event by calling
 * `writeStored`; it does not exist, and `ChatListResizer` says so where the
 * listener is.
 */
export function effectiveChatListWidth(
  state: DesktopChatListState,
  maxWidth: number = CHAT_LIST_MAX_WIDTH,
): number {
  if (state.collapsed) return CHAT_LIST_COLLAPSED_WIDTH;
  return clamp(
    Number.isFinite(state.width) ? state.width : CHAT_LIST_DEFAULT_WIDTH,
    CHAT_LIST_MIN_WIDTH,
    maxWidth,
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
 *
 * **Bounded by `CHAT_LIST_MAX_WIDTH` and deliberately not by the window.** What
 * is read here is what the person chose, on whatever screen they chose it on;
 * the window's own ceiling belongs to `effectiveChatListWidth`, which draws.
 * Clamping here would make opening the application once on a laptop enough to
 * lose a width chosen on a monitor.
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
