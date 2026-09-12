"use client";

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

import { FOCUS_RING_INSET } from "@/lib/controlSurface";
import {
  CHAT_LIST_MAX_WIDTH,
  CHAT_LIST_MIN_WIDTH,
  DESKTOP_CHAT_LIST_STORAGE_KEY,
  chatListNarrowRatio,
  effectiveChatListWidth,
  liveChatListWidth,
  readDesktopChatListState,
  serializeDesktopChatListState,
  settleChatListState,
  toggleChatListCollapsed,
  type DesktopChatListState,
} from "@/lib/desktopChatList";

/**
 * The handle between the chat list and the conversation.
 *
 * **Nothing here goes into React state.** `tests/e2e/chat-list-event-cost.spec.ts`
 * counts the renders of `Sidebar`, `ChatList` and `ChatListItem` per event and
 * those counts are a contract; a width held in the store would re-render every
 * row on every frame of a drag. The width is written straight onto
 * `document.documentElement` as two custom properties and read from there by
 * CSS, so a whole drag costs zero React renders.
 *
 *  - `--kub-chat-list-width` is the column's width.
 *  - `--kub-chat-list-narrow` is Telegram's `setNarrowRatio(float64)`: 0 at the
 *    normal narrowest, 1 at the strip of avatars, interpolated between. The row
 *    reads it, so it narrows continuously instead of switching mode.
 *
 * The state is restored before the first paint by `applyStoredChatListState`,
 * called from the module that owns the shell, and written back only when the
 * handle is released — so a drag is not 200 writes to `localStorage`.
 */

const ROOT_STYLE_WIDTH = "--kub-chat-list-width";
const ROOT_STYLE_NARROW = "--kub-chat-list-narrow";
const KEYBOARD_STEP = 16;

function applyWidth(width: number) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty(ROOT_STYLE_WIDTH, `${Math.round(width)}px`);
  root.style.setProperty(ROOT_STYLE_NARROW, chatListNarrowRatio(width).toFixed(4));
}

function readStored(): DesktopChatListState {
  if (typeof window === "undefined") return readDesktopChatListState(null);
  try {
    return readDesktopChatListState(window.localStorage.getItem(DESKTOP_CHAT_LIST_STORAGE_KEY));
  } catch {
    return readDesktopChatListState(null);
  }
}

function writeStored(state: DesktopChatListState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DESKTOP_CHAT_LIST_STORAGE_KEY, serializeDesktopChatListState(state));
  } catch {
    /* private mode, a full quota: the width is a convenience, not data */
  }
}

/** Puts the stored width on the page. Safe to call before anything is rendered. */
export function applyStoredChatListState(): DesktopChatListState {
  const state = readStored();
  applyWidth(effectiveChatListWidth(state));
  return state;
}

export function ChatListResizer() {
  const stateRef = useRef<DesktopChatListState>(readStored());
  const handleRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const originRef = useRef(0);
  const startXRef = useRef(0);
  const movedRef = useRef(false);

  useEffect(() => {
    const state = applyStoredChatListState();
    stateRef.current = state;
    handleRef.current?.setAttribute("aria-valuenow", String(effectiveChatListWidth(state)));
  }, []);

  const commit = useCallback((state: DesktopChatListState) => {
    stateRef.current = state;
    const width = effectiveChatListWidth(state);
    applyWidth(width);
    writeStored(state);
    handleRef.current?.setAttribute("aria-valuenow", String(width));
  }, []);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const region = document.querySelector<HTMLElement>("[data-kub-left-region]");
    if (!region) return;
    // Measured from the region's own left edge, so the rail's 72px is already
    // in it and the arithmetic does not have to know the rail exists.
    originRef.current = region.getBoundingClientRect().left;
    startXRef.current = event.clientX;
    movedRef.current = false;
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    // No `preventDefault()` here. A double click is two pointer downs and ups
    // before it, and preventing the default on the down suppresses the click
    // pair the double click is built from — measured: the toggle never ran and
    // the two stray pointer-ups settled the list at the handle's own x, 536px.
    // Selection is suppressed on the first actual move instead.
  }, []);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    if (Math.abs(event.clientX - startXRef.current) > 2) {
      movedRef.current = true;
      event.preventDefault();
    }
    // Continuous, through the band between the strip and the normal narrowest:
    // the ratio is what makes the row interpolate rather than snap.
    applyWidth(liveChatListWidth(event.clientX - originRef.current));
  }, []);

  const endDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      // A press that never moved is a click, not a drag: it leaves the width
      // exactly where it was, so the double click that follows has something
      // to toggle.
      if (!movedRef.current) {
        applyWidth(effectiveChatListWidth(stateRef.current));
        return;
      }
      commit(settleChatListState(event.clientX - originRef.current));
    },
    [commit],
  );

  const nudge = useCallback(
    (delta: number) => {
      const current = effectiveChatListWidth(stateRef.current);
      commit(settleChatListState(current + delta));
    },
    [commit],
  );

  return (
    // A separator, which is what it is: `role="separator"` with `tabindex` is
    // the window-splitter pattern, so the width is reachable without a pointer.
    <div
      ref={handleRef}
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label="Ширина списка чатов"
      aria-valuemin={CHAT_LIST_MIN_WIDTH}
      aria-valuemax={CHAT_LIST_MAX_WIDTH}
      data-testid="chat-list-resizer"
      className={`group relative hidden w-1.5 shrink-0 cursor-col-resize touch-none select-none md:block ${FOCUS_RING_INSET}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => commit(toggleChatListCollapsed(stateRef.current))}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          nudge(-KEYBOARD_STEP);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          nudge(KEYBOARD_STEP);
        } else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          commit(toggleChatListCollapsed(stateRef.current));
        }
      }}
    >
      {/* The grip shows where the pointer already is. A resting line here would
          be a third vertical rule beside the rail's and the column's. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 rounded-full bg-[var(--kub-cyan)] opacity-0 transition-opacity group-hover:opacity-70 group-focus-visible:opacity-70"
      />
    </div>
  );
}
