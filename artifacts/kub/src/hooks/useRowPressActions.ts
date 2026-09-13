"use client";

import { useCallback, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from "react";

/**
 * The one gesture that opens a row's actions: right-click on a computer, a long
 * press under a finger.
 *
 * Lifted verbatim out of `components/sidebar/ChatListItem.tsx`, where it was
 * written first and where its three guards were learned. It is lifted rather
 * than re-derived because each guard is invisible until it is missing:
 *
 *  - a context menu is refused within a second of a touch, because a phone
 *    fires `contextmenu` after its own long press and both would open;
 *  - a context menu is refused on a coarse pointer at all, for the same reason
 *    on devices that do not report the touch;
 *  - the click that follows a long press is swallowed, or letting go would
 *    also activate the row underneath the menu that just opened.
 *
 * **No state, deliberately.** `tests/e2e/chat-list-event-cost.spec.ts` pins the
 * chat row at one render per event, two where a delivery mark follows, and
 * `tests/e2e/helpers/render-counter.ts` counts renders with a mount counted as
 * one. A hook that set state here would break a contract on the critical
 * regression list rather than a cosmetic one, so everything lives in refs.
 *
 * The suppression flag is cleared on every fresh press rather than by the next
 * click that happens along: a flag that outlives its gesture eats the click
 * that opens the row, which is the bug that taught `ChatListItem` to do this.
 */

/** How long a finger must rest before the actions open. */
const LONG_PRESS_MS = 520;

/** How far a finger may wander first. Beyond this it is a scroll, not a press. */
const LONG_PRESS_SLOP_PX = 8;

/** How long after a touch a `contextmenu` is still that touch's echo. */
const TOUCH_ECHO_MS = 1_000;

export interface RowPressOptions {
  /** The row's own activation — opening the chat, say. Skipped after a long press. */
  onActivate?: () => void;
  /** A computer asked for the menu, at this point. */
  onMenu?: (position: { x: number; y: number }) => void;
  /** A finger rested long enough. */
  onSheet?: () => void;
}

export interface RowPressHandlers {
  onClick: (event: ReactMouseEvent) => void;
  onContextMenu: (event: ReactMouseEvent) => void;
  onPointerDown: (event: ReactPointerEvent) => void;
  onPointerMove: (event: ReactPointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
}

export interface RowPressActions {
  /** Spread onto the row. Only DOM handlers live here, so the spread is safe. */
  handlers: RowPressHandlers;
  /**
   * Eat the next click on this row, for a gesture this hook does not own.
   *
   * The chat list needs it: a pinned row is also draggable, and
   * `ChatListItem.tsx` sets the same suppression flag when a drag starts —
   * otherwise letting go at the end of a drag opens the chat. The flag has to
   * stay in one place, so the gesture that is not ours asks for it rather than
   * keeping a second copy.
   */
  suppressNextClick: () => void;
}

export function useRowPressActions({ onActivate, onMenu, onSheet }: RowPressOptions): RowPressActions {
  const timerRef = useRef<number | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);
  const lastTouchAtRef = useRef(0);

  const clearTimer = useCallback(() => {
    startRef.current = null;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onClick = useCallback(
    (event: ReactMouseEvent) => {
      if (suppressClickRef.current) {
        event.preventDefault();
        suppressClickRef.current = false;
        return;
      }
      onActivate?.();
    },
    [onActivate],
  );

  const onContextMenu = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      const isRecentTouch = Date.now() - lastTouchAtRef.current < TOUCH_ECHO_MS;
      const isCoarsePointer =
        typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
      if (isRecentTouch || isCoarsePointer) return;
      if (!onMenu) return;
      if (suppressClickRef.current) return;
      onMenu({ x: event.clientX, y: event.clientY });
    },
    [onMenu],
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent) => {
      // A fresh press is a fresh interaction: whatever suppressed the last
      // click must not swallow this one.
      suppressClickRef.current = false;
      if (event.pointerType !== "touch" || !onSheet) return;
      lastTouchAtRef.current = Date.now();
      clearTimer();
      startRef.current = { x: event.clientX, y: event.clientY };
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        suppressClickRef.current = true;
        onSheet();
      }, LONG_PRESS_MS);
    },
    [clearTimer, onSheet],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent) => {
      if (event.pointerType !== "touch" || !startRef.current) return;
      const dx = Math.abs(event.clientX - startRef.current.x);
      const dy = Math.abs(event.clientY - startRef.current.y);
      if (dx > LONG_PRESS_SLOP_PX || dy > LONG_PRESS_SLOP_PX) clearTimer();
    },
    [clearTimer],
  );

  const suppressNextClick = useCallback(() => {
    suppressClickRef.current = true;
  }, []);

  return {
    handlers: {
      onClick,
      onContextMenu,
      onPointerDown,
      onPointerMove,
      onPointerUp: clearTimer,
      onPointerCancel: clearTimer,
    },
    suppressNextClick,
  };
}

export const ROW_PRESS_TIMINGS = {
  longPressMs: LONG_PRESS_MS,
  slopPx: LONG_PRESS_SLOP_PX,
  touchEchoMs: TOUCH_ECHO_MS,
} as const;
