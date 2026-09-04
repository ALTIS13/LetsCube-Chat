/**
 * The contact card, as a window rather than a column.
 *
 * The profile used to be a 320px strip welded to the right edge, so looking
 * someone up cost a permanent third of the conversation. It is the same panel
 * with the same actions; only where it sits changed. The rules that decide
 * where it sits live here, apart from the component, because they are the part
 * that can go quietly wrong — a card stranded off screen after a resize, a
 * stored position from a wider monitor, a drag that starts on the close button
 * and eats the click, an Escape that closes the card *and* the confirmation
 * standing on top of it.
 *
 * The geometry itself is `floatingWindow.ts`, shared with the support window.
 * Nothing here re-implements it.
 */

import {
  clampPosition,
  isDocked,
  parseStoredPlacement,
  resolvePlacement,
  type PlacementStore,
  type Point,
  type Size,
  type Viewport,
  type WindowPlacement,
} from "./floatingWindow.ts";

/**
 * Its own key. Sharing the support window's would make moving one window move
 * the other, which is the kind of thing nobody reports and everybody notices.
 */
export const PROFILE_WINDOW_STORAGE_KEY = "letscube:profile-window";

/**
 * Taller than the support window's default: a contact card is a list of
 * actions plus a media grid, and 560px cut the grid off at one row.
 */
export const PROFILE_WINDOW_DEFAULT_SIZE: Size = { width: 380, height: 620 };

/**
 * A drag must not start on anything that can be clicked. The pointer capture a
 * drag takes redirects every later pointer event to the handle, so the button
 * under the finger never gets its click — that is how a draggable title bar
 * makes its own close button stop working.
 */
export const PROFILE_WINDOW_DRAG_IGNORE_SELECTOR =
  "button, a, input, select, textarea, label, [role='button']";

/** The docked panel, exactly as it was before the window existed. */
const DOCKED_CLASS =
  "flex min-h-0 flex-col h-full w-full md:w-80 flex-shrink-0 border-l bg-[var(--kub-surface)] border-[color:var(--kub-border-color)]";

/**
 * `min-h-0` and `flex-col` are load-bearing: the media grid inside scrolls
 * because the window has a fixed height and refuses to grow past it.
 * `overflow-hidden` is what keeps the rounded corners from being squared off
 * by the content.
 */
const FLOATING_CLASS =
  "fixed z-[60] flex min-h-0 flex-col overflow-hidden rounded-2xl border shadow-2xl bg-[var(--kub-surface)] border-[color:var(--kub-border-color)]";

export interface FloatingFrameStyle {
  left: string;
  top: string;
  width: string;
  height: string;
}

export interface ProfileWindowFrame {
  docked: boolean;
  className: string;
  /** Only a floating window is positioned by hand; a docked one is laid out. */
  style: FloatingFrameStyle | undefined;
}

/**
 * Where the card is drawn, given where it was put and how much screen there is.
 *
 * Below the dock breakpoint there is no room to float anything, so the panel
 * stays the panel — a window that has to be dragged around a phone is worse
 * than the column it replaced.
 */
export function profileWindowFrame(
  placement: WindowPlacement,
  viewport: Viewport,
): ProfileWindowFrame {
  if (isDocked(viewport)) {
    return { docked: true, className: DOCKED_CLASS, style: undefined };
  }
  return {
    docked: false,
    className: FLOATING_CLASS,
    style: {
      left: `${placement.position.x}px`,
      top: `${placement.position.y}px`,
      width: `${placement.size.width}px`,
      height: `${placement.size.height}px`,
    },
  };
}

/**
 * Open where it was left, unless where it was left no longer exists.
 *
 * `resolvePlacement` shrinks the card to the viewport and pulls it back on
 * screen, so a position remembered on a 2560px monitor survives being reopened
 * on a laptop instead of being thrown away or restored out of reach.
 */
export function resolveProfileWindowPlacement(
  stored: Partial<WindowPlacement> | null,
  viewport: Viewport,
): WindowPlacement {
  return resolvePlacement(
    {
      size: stored?.size ?? PROFILE_WINDOW_DEFAULT_SIZE,
      ...(stored?.position ? { position: stored.position } : {}),
    },
    viewport,
  );
}

export interface DragOrigin {
  /** Where the pointer went down. */
  origin: Point;
  /** Where the window was when it did. */
  start: Point;
}

/** Follow the pointer, but never further than the card can be dragged back from. */
export function profileDragPosition(
  drag: DragOrigin,
  pointer: Point,
  size: Size,
  viewport: Viewport,
): Point {
  return clampPosition(
    {
      x: drag.start.x + (pointer.x - drag.origin.x),
      y: drag.start.y + (pointer.y - drag.origin.y),
    },
    size,
    viewport,
  );
}

export interface DragStartTarget {
  closest(selector: string): unknown;
}

export interface DragStartAttempt {
  docked: boolean;
  /** `PointerEvent.button`; 0 is the primary one. */
  button: number;
  target: DragStartTarget | null;
}

export function shouldStartProfileDrag(attempt: DragStartAttempt): boolean {
  if (attempt.docked) return false;
  if (attempt.button !== 0) return false;
  if (attempt.target?.closest(PROFILE_WINDOW_DRAG_IGNORE_SELECTOR)) return false;
  return true;
}

export interface ProfileWindowKeyAttempt {
  key: string;
  /** Something already answered this key; do not answer it twice. */
  defaultPrevented?: boolean;
  /** The person is typing — Escape belongs to the field, not to the window. */
  editing?: boolean;
  /** A confirmation or the media viewer is standing on top of the card. */
  overlayAbove?: boolean;
}

/**
 * Escape closes the card, but only when the card is the thing on top.
 *
 * «Удалить чат у себя» opens a confirmation over the profile, and that dialog
 * listens for Escape too. Without the overlay guard one press would dismiss the
 * confirmation and the profile behind it, which reads as the app losing its
 * place.
 */
export function shouldCloseProfileWindowOnKey(attempt: ProfileWindowKeyAttempt): boolean {
  if (attempt.key !== "Escape") return false;
  if (attempt.defaultPrevented) return false;
  if (attempt.editing) return false;
  if (attempt.overlayAbove) return false;
  return true;
}

/** Nothing, back to the card root, or away entirely. */
export type ProfileWindowEscape = "ignore" | "back" | "close";

export interface ProfileWindowEscapeAttempt extends ProfileWindowKeyAttempt {
  /** The card has pushed into a sub-view — the shared media gallery. */
  subview?: boolean;
}

/**
 * Escape pops the sub-view before it closes the card.
 *
 * The gallery is a push, not an overlay, so a person who pressed Escape inside
 * it means "back", the same as the arrow in the title bar. Closing the whole
 * card instead loses the chat's profile as well as the gallery, and reopening
 * it lands on the root anyway — two keystrokes to undo one.
 */
export function resolveProfileWindowEscape(attempt: ProfileWindowEscapeAttempt): ProfileWindowEscape {
  if (!shouldCloseProfileWindowOnKey(attempt)) return "ignore";
  return attempt.subview ? "back" : "close";
}

function defaultProfileWindowStore(): PlacementStore | null {
  try {
    // Session-scoped on purpose: where the card was put is a convenience for
    // the sitting, not a preference worth carrying between them.
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/** Never throws: a private window or a browser that blocks site data must not
 *  take the profile with it. */
export function readProfileWindowPlacement(
  store: PlacementStore | null = defaultProfileWindowStore(),
): Partial<WindowPlacement> | null {
  try {
    return parseStoredPlacement(store?.getItem(PROFILE_WINDOW_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeProfileWindowPlacement(
  placement: WindowPlacement,
  store: PlacementStore | null = defaultProfileWindowStore(),
): void {
  try {
    store?.setItem(PROFILE_WINDOW_STORAGE_KEY, JSON.stringify(placement));
  } catch {
    /* a remembered position is a convenience, never a requirement */
  }
}
