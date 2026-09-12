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
import { CHAT_LIST_MIN_WIDTH } from "./desktopChatList.ts";

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

/**
 * The docked panel: a sheet laid over the conversation.
 *
 * `-strong`, like the floating shape. Docking only happens below
 * DOCK_BREAKPOINT (640px), so the card is always the full width of a phone and
 * covers the conversation completely. Measured over a white field, `kub-glass`
 * composites to rgb(113,126,141), which is 3.86:1 for this panel's own body
 * text; the conversation it covers is full of photographs.
 *
 * D-050: it used to be a flex child of the same row as the conversation, which
 * is not what "covers it completely" means to a layout engine. The chat was
 * compressed to **24px** and pushed off the left edge rather than left alone —
 * measured at 390x844 with 75 rows, `scrollHeight` went from 6,586 to 114,731
 * and individual rows were laid out up to 4,786px tall, all of it invisible and
 * all of it re-measured twice more on the way back. Positioning the sheet over
 * the row instead of inside it costs the conversation nothing: it keeps its
 * width, so the meta-placement machinery closed by D-032 and D-041 is never
 * asked the question at the wrong width.
 */
const DOCKED_CLASS =
  // `pt-safe pb-safe`: docked, the sheet is the whole phone, so its material
  // runs under the status bar and the home indicator while its title bar and
  // its last row stay clear of both.
  "kub-glass-strong absolute inset-0 z-[60] flex min-h-0 flex-col pt-safe pb-safe";

/**
 * `min-h-0` and `flex-col` are load-bearing: the media grid inside scrolls
 * because the window has a fixed height and refuses to grow past it.
 * `overflow-hidden` is what keeps the rounded corners from being squared off
 * by the content.
 */
const FLOATING_CLASS =
  // Floating, the card stands on the conversation, so `-strong`: at panel
  // opacity the messages underneath would read through its own text.
  // `shadow-2xl` goes with the fill — --glass-shadow is the card's shadow now,
  // and two box-shadows on one element is a fight, not a stack.
  "kub-glass-strong fixed z-[60] flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[color:var(--kub-border-color)]";

/**
 * The card as a third column, beside the conversation rather than on it.
 *
 * D-161. Floating is what a card does when there is nowhere to put it; on a
 * computer there is. Measured at 1440 the window covered 26.2% of the
 * conversation — four bubbles — stood over the composer, and scrolled 639px of
 * itself inside 562px while the pane beside it had 1007px to spare. A desktop
 * client docks the contact card, and the owner asked the web client to stop
 * reading as a phone wearing a desktop's screen.
 *
 * `kub-glass`, not `-strong`. The strong fill is for a surface covering content
 * it is not part of; this one covers nothing — it stands beside the
 * conversation the way the chat list does, on the page's own ambient, and that
 * is the fill the left region already uses for the same job.
 *
 * `pt-window-top` is load-bearing and is the one thing here that is not
 * cosmetic: the column is flush to the right edge of the window, which is
 * exactly where the Windows app draws its own minimise, maximise and close.
 * Without the reservation this card's title bar — its close button included —
 * would open underneath them. That is D-112 restated, and rule 13 of
 * docs/operations/interface-material.md. The material still runs to the top
 * edge, because padding does not clip a background.
 *
 * No `z-index`. The floating shape needs one to stand on the conversation; a
 * column is a sibling of it and overlaps nothing, and an index here would make
 * a stacking context for no reason (rule 12).
 */
const COLUMN_CLASS =
  "kub-glass relative flex h-full min-h-0 flex-shrink-0 flex-col overflow-hidden border-l border-[color:var(--kub-border-color)] pt-window-top";

/**
 * Left, top and height are the floating shape's; a column is laid out by the
 * row it sits in and states only its width. They are optional rather than a
 * second type so that `style` stays one thing to apply and one thing to assert.
 */
export interface FloatingFrameStyle {
  left?: string;
  top?: string;
  width: string;
  height?: string;
}

/** Which of the three shapes the card is wearing. */
export type ProfileWindowSurface = "docked" | "column" | "floating";

export interface ProfileWindowFrame {
  surface: ProfileWindowSurface;
  /** The phone's sheet, and only that. `data-docked` has meant this all along. */
  docked: boolean;
  /** Only a floating window is placed by hand. */
  draggable: boolean;
  className: string;
  /** Only a floating window is positioned by hand; a docked one is laid out. */
  style: FloatingFrameStyle | undefined;
}

/**
 * Whether the chat pane can give the card a column and still leave a
 * conversation worth reading.
 *
 * The floor is the product's own: `CHAT_LIST_MIN_WIDTH` is Telegram's
 * `columnMinimalWidthLeft`, the width this application already treats as the
 * narrowest a column may be, so the answer moves with that decision instead of
 * restating it. Measured against the **pane**, never the viewport, because the
 * chat list is dragged: at 1440 the pane is 1007px with the list at its default
 * 360 and 787px with it at its maximum 540, and only one of those two numbers
 * is a function of the window.
 */
export function paneFitsProfileColumn(paneWidth: number): boolean {
  if (!Number.isFinite(paneWidth)) return false;
  return paneWidth - PROFILE_WINDOW_DEFAULT_SIZE.width >= CHAT_LIST_MIN_WIDTH;
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
  /**
   * Where the viewport the placement was resolved in begins on the screen.
   * Given the safe viewport that is the left and top insets, and the card is
   * drawn clear of the notch without the geometry knowing a notch exists.
   */
  origin: Point = { x: 0, y: 0 },
  /**
   * Whether the pane beside the conversation can afford the column —
   * `paneFitsProfileColumn` of a measured pane. Absent it is `false`: a card
   * that has not been told how much room there is has not got any.
   */
  columnFits = false,
): ProfileWindowFrame {
  if (isDocked(viewport)) {
    return { surface: "docked", docked: true, draggable: false, className: DOCKED_CLASS, style: undefined };
  }
  // Before floating, because floating is the fallback: a window is what the
  // card is when the pane cannot hold a column, not what it prefers to be.
  if (columnFits) {
    return {
      surface: "column",
      docked: false,
      draggable: false,
      className: COLUMN_CLASS,
      // The one number the row cannot work out for itself. It comes from the
      // same constant as the floating card's width, so the two shapes are the
      // same card and not two sizes of one.
      style: { width: `${PROFILE_WINDOW_DEFAULT_SIZE.width}px` },
    };
  }
  return {
    surface: "floating",
    docked: false,
    draggable: true,
    className: FLOATING_CLASS,
    style: {
      left: `${placement.position.x + origin.x}px`,
      top: `${placement.position.y + origin.y}px`,
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
  /**
   * A column is laid out by the row it sits in, so there is nowhere to drag it
   * to. Dragging one would write a placement that only takes effect later, on
   * a narrower pane — the card would appear to have moved on its own.
   */
  column?: boolean;
  /** `PointerEvent.button`; 0 is the primary one. */
  button: number;
  target: DragStartTarget | null;
}

export function shouldStartProfileDrag(attempt: DragStartAttempt): boolean {
  if (attempt.docked) return false;
  if (attempt.column) return false;
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
