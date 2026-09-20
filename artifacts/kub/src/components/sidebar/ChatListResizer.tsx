"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { KubIcon } from "@/components/kub";
import { FOCUS_RING, FOCUS_RING_INSET } from "@/lib/controlSurface";
import {
  CHAT_LIST_MAX_WIDTH,
  CHAT_LIST_MIN_WIDTH,
  CHAT_LIST_REGION_CHROME,
  DESKTOP_CHAT_LIST_STORAGE_KEY,
  chatListMaxWidth,
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
 * **No width goes into React state.** `tests/e2e/chat-list-event-cost.spec.ts`
 * counts the renders of `Sidebar`, `ChatList` and `ChatListItem` per event and
 * those counts are a contract; a width held in the store would re-render every
 * row on every frame of a drag. The width is written straight onto the DOM as
 * two custom properties and read from there by CSS, so a whole drag costs zero
 * React renders.
 *
 *  - `--kub-chat-list-width` is the column's width.
 *  - `--kub-chat-list-narrow` is Telegram's `setNarrowRatio(float64)`: 0 at the
 *    normal narrowest, 1 at the strip of avatars, interpolated between. The row
 *    reads it, so it narrows continuously instead of switching mode.
 *
 * **On the region and the seam, never on `document.documentElement`** — and
 * that distinction is the whole of D-268. Zero React renders was true and it
 * was never where the time went. Measured on 2026-09-20, a conversation of 140
 * messages and a list of 25 chats, 3405 nodes, 60 writes each:
 *
 *   | written on                                  | style recalc per write |
 *   | ------------------------------------------- | ---------------------- |
 *   | `:root`, the property the product reads      | 13.1 ms                |
 *   | `:root`, a property **nothing reads**        | 12.2 ms                |
 *   | `[data-kub-left-region]`, the same property  | 1.7 ms                 |
 *   | the region's `width`, no property at all     | 0.02 ms                |
 *
 * The second row is the finding: a custom property on the root costs a full
 * document style resolution whether or not anything references it, because
 * every element inherits the root's custom properties. 140 message bubbles that
 * cannot change were re-resolved on every frame of the drag, and at 14.6 ms a
 * frame — recalc plus layout — the drag had spent the whole 60 Hz budget before
 * a single pixel was painted. That is «не так плавно как в discord», in
 * milliseconds.
 *
 * So the region carries both properties for itself and its rows, and the two
 * boxes on the seam — the handle and its toggle — carry their own copy of the
 * width, because they are the region's SIBLINGS and inherit nothing from it.
 * Three leaf writes, and the conversation is not asked anything.
 *
 * What that bought, on the same page, dragging the handle through 40 pointer
 * moves — the whole drag, not a synthetic sweep:
 *
 *   |                     | style recalc | layout  | per frame |
 *   | ------------------- | ------------ | ------- | --------- |
 *   | on the root         | 489 ms       | 49 ms   | 13.1 ms   |
 *   | on the region       | 125 ms       | 60 ms   | 4.5 ms    |
 *
 * Layout went slightly UP, and that is the shape of a real fix rather than a
 * suspicious one: the layout was never the problem — it is the work the drag
 * actually asks for — and what went away is the 364 ms of style resolution it
 * was dragging behind it.
 *
 * The state is restored before the first paint by `applyStoredChatListState`,
 * called from the module that owns the shell, and written back only when the
 * handle is released — so a drag is not 200 writes to `localStorage`.
 */

const STYLE_WIDTH = "--kub-chat-list-width";
const STYLE_NARROW = "--kub-chat-list-narrow";
const KEYBOARD_STEP = 16;

/** The column and its rows. */
const REGION_SELECTOR = "[data-kub-left-region]";
/**
 * The two boxes that stand ON the seam rather than inside the region — the
 * handle and its toggle. Both are the region's siblings, so both need their own
 * copy of the width to place themselves by; neither has descendants worth
 * mentioning, so writing it there costs nothing.
 */
const SEAM_SELECTOR = "[data-kub-chat-list-seam]";

/**
 * The widest this window allows, asked of the window itself.
 *
 * `window.innerWidth` and **no shell check**, which is the whole reason the
 * ceiling is a share rather than a constant per platform. A maximised Tauri
 * window, a browser tab sharing a laptop screen with an editor, and the same
 * tab full-screen on a 2560 monitor are three different numbers here and one
 * rule — and `isDesktopShell()` would have told us which shell it is without
 * telling us how wide it is, which is the only fact that matters.
 *
 * **`window.innerWidth` and not `document.documentElement.clientWidth`**, and
 * that is not interchangeable — this is called on every pointer move. Measured
 * on this page on 2026-09-20, 400 custom-property writes each followed by one
 * read:
 *
 *   | read                                   | total |
 *   | -------------------------------------- | ----- |
 *   | nothing                                | 0.2ms |
 *   | `window.innerWidth`                    | 0.3ms |
 *   | `document.documentElement.clientWidth` | 462ms |
 *
 * The second is free; the third forces a layout per read, 1.16ms each. Both
 * answer almost the same number, and one of them would have put D-268 straight
 * back into the drag by another road.
 */
function ceiling(): number {
  if (typeof window === "undefined") return CHAT_LIST_MAX_WIDTH;
  return chatListMaxWidth(window.innerWidth);
}

function applyWidth(width: number) {
  if (typeof document === "undefined") return;
  const px = `${Math.round(width)}px`;
  const region = document.querySelector<HTMLElement>(REGION_SELECTOR);
  if (region) {
    region.style.setProperty(STYLE_WIDTH, px);
    region.style.setProperty(STYLE_NARROW, chatListNarrowRatio(width).toFixed(4));
  }
  document.querySelectorAll<HTMLElement>(SEAM_SELECTOR).forEach((box) => {
    box.style.setProperty(STYLE_WIDTH, px);
  });
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
  applyWidth(effectiveChatListWidth(state, ceiling()));
  return state;
}

export function ChatListResizer() {
  const stateRef = useRef<DesktopChatListState>(readStored());
  const handleRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const originRef = useRef(0);
  const startXRef = useRef(0);
  const movedRef = useRef(false);
  /**
   * The only React state in this file, and it is a state the drag does not
   * touch: which way the toggle's chevron points. It changes when the list
   * settles — a release, a double click, a key, a click on the toggle — never
   * on a frame of a drag, so the render counts
   * `tests/e2e/chat-list-event-cost.spec.ts` pins are untouched. Nothing in
   * `Sidebar`, `ChatList` or `ChatListItem` is below this component anyway;
   * they are the region's children and this stands beside the region.
   */
  const [collapsed, setCollapsed] = useState(() => readStored().collapsed);

  /**
   * What the handle reports: where it is, and how far it may go on this window.
   *
   * `aria-valuemax` moves with the window and it has to: a separator that
   * announces 540 on a screen whose drag refuses anything past 359 is telling
   * a screen reader a number the pointer cannot reach. Set here rather than in
   * the class list for the reason `aria-valuenow` is — the JSX values are the
   * frame before this runs, and nothing below this component re-renders.
   */
  const reportHandle = useCallback((state: DesktopChatListState) => {
    const max = ceiling();
    const handle = handleRef.current;
    if (!handle) return;
    handle.setAttribute("aria-valuenow", String(effectiveChatListWidth(state, max)));
    handle.setAttribute("aria-valuemax", String(max));
  }, []);

  useEffect(() => {
    const state = applyStoredChatListState();
    stateRef.current = state;
    setCollapsed(state.collapsed);
    reportHandle(state);

    /**
     * A window that changed size re-draws the list, and **never writes it
     * down.**
     *
     * That is the contract `effectiveChatListWidth` states: the stored width is
     * a decision, this window is a fact about right now. Answering a resize
     * with `writeStored` would mean opening the application once on a laptop
     * was enough to lose a width chosen on a monitor, silently, with no
     * gesture from the person at all.
     *
     * Coalesced into one frame, and written through `applyWidth` — three leaf
     * writes on the region and the two seam boxes, never on
     * `document.documentElement` (D-268). A drag of the window edge produces
     * the same storm of events a drag of this handle does, and it must not cost
     * more.
     */
    let frame = 0;
    const onResize = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        applyWidth(effectiveChatListWidth(stateRef.current, ceiling()));
        reportHandle(stateRef.current);
      });
    };
    window.addEventListener("resize", onResize);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
    };
  }, [reportHandle]);

  const commit = useCallback(
    (state: DesktopChatListState) => {
      stateRef.current = state;
      applyWidth(effectiveChatListWidth(state, ceiling()));
      writeStored(state);
      setCollapsed(state.collapsed);
      reportHandle(state);
    },
    [reportHandle],
  );

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const region = document.querySelector<HTMLElement>("[data-kub-left-region]");
    if (!region) return;
    // Measured from where the **column** starts, which is the region's left
    // edge plus the rail and the region's hairline. Taking the region's edge
    // alone wrote the region's width into the column's variable and left the
    // handle 73px behind the pointer on every frame — see
    // `CHAT_LIST_REGION_CHROME`.
    originRef.current = region.getBoundingClientRect().left + CHAT_LIST_REGION_CHROME;
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
    applyWidth(liveChatListWidth(event.clientX - originRef.current, ceiling()));
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
        applyWidth(effectiveChatListWidth(stateRef.current, ceiling()));
        return;
      }
      commit(settleChatListState(event.clientX - originRef.current, ceiling()));
    },
    [commit],
  );

  const nudge = useCallback(
    (delta: number) => {
      const max = ceiling();
      const current = effectiveChatListWidth(stateRef.current, max);
      commit(settleChatListState(current + delta, max));
    },
    [commit],
  );

  const toggle = useCallback(() => {
    commit(toggleChatListCollapsed(stateRef.current));
  }, [commit]);

  return (
    <>
      {/* A separator, which is what it is: `role="separator"` with `tabindex`
          is the window-splitter pattern, so the width is reachable without a
          pointer. */}
      <div
      ref={handleRef}
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label="Ширина списка чатов"
      aria-valuemin={CHAT_LIST_MIN_WIDTH}
      aria-valuemax={CHAT_LIST_MAX_WIDTH}
      data-testid="chat-list-resizer"
      data-kub-chat-list-seam=""
      // **No width in the layout.** As a flex sibling this used to take 6px
      // between the two panes, and those 6px were a band of the application's
      // own ground — a black strip down the seam in the dark theme, which is
      // what the owner saw. Telegram's grip is not a column between the panes;
      // it sits **on** the edge. So does this one: absolute, centred on the
      // region's right border, which is where `left` puts it by repeating the
      // region's own width expression. The border stays the region's.
      style={{ left: `calc(72px + var(--kub-chat-list-width) + 1px)` }}
      className={`group absolute inset-y-0 z-20 hidden w-[9px] -translate-x-1/2 cursor-col-resize touch-none select-none md:block ${FOCUS_RING_INSET}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={toggle}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          nudge(-KEYBOARD_STEP);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          nudge(KEYBOARD_STEP);
        } else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggle();
        }
      }}
      >
        {/* The grip shows where the pointer already is. A resting line here
            would be a third vertical rule beside the rail's and the column's. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 rounded-full bg-[var(--kub-cyan)] opacity-0 transition-opacity group-hover:opacity-70 group-focus-visible:opacity-70"
        />
      </div>

      {/* The way to fold the list, and the way back.

          It exists because the fold already did and nobody could find it: until
          now the only ways in were a double click on a 9px seam that draws
          nothing at rest, and dragging past a threshold 134px below the
          narrowest resting width. The owner asked for the feature we had
          («нет возможности быстро свернуть часть с чатами»), which is what an
          undiscoverable feature looks like from outside.

          Discord is not the reference here and it is worth saying so: its
          channel sidebar does not collapse at all. The code ships in its stable
          build and is switched off — the state is computed and then `&& false`d,
          so `data-collapsed` is always "false" and the 76px path never runs —
          and collapsing is a BetterDiscord/Vencord plugin, one of the oldest
          standing requests on its own support forum. Telegram Desktop's strip
          of avatars is the reference, as it is for every number in
          `lib/desktopChatList.ts`.

          **Drawn at rest only when the list is folded**, and that asymmetry is
          measured rather than tasteful. Centred on the seam it stands half over
          whatever is on the right, and when a group has channels that is the
          rail's first row: photographed at 1440, the 20px disc covered the
          accent bar of the channel being read. So at rest it is transparent and
          it still takes its clicks — opacity hides a box, it does not lift it
          out of hit testing — which means it appears under the pointer the
          moment somebody reaches for the line they were going to drag anyway.
          That is where it has to be discovered, and it is the only place it can
          be without covering a row.

          Folded, it is opaque and stays opaque. Nothing else on the screen says
          the list can come back, and a fold with no visible way out is worse
          than no fold.

          A flat fill, not `.kub-glass`. This box moves on every frame of a drag,
          and a backdrop filter is a layer per element per frame (rule 6); the
          conversation's own chips take a flat token for the same reason. It
          keeps its perimeter because it is a thing you aim at (rule 11). */}
      <button
        type="button"
        data-kub-chat-list-seam=""
        data-kub-chat-list-fold=""
        data-testid="chat-list-fold"
        data-collapsed={collapsed ? "true" : "false"}
        aria-label={collapsed ? "Развернуть список чатов" : "Свернуть список чатов"}
        aria-expanded={!collapsed}
        title={collapsed ? "Развернуть список чатов" : "Свернуть список чатов"}
        onClick={toggle}
        style={{
          left: `calc(72px + var(--kub-chat-list-width) + 1px)`,
          // On the seam, level with the middle of the header row — the one band
          // of the column whose height does not depend on what is in the list.
          top: `calc(var(--kub-safe-top) + var(--kub-window-caption) + var(--kub-control-row-height) / 2)`,
        }}
        // No `opacity-*` utility here on purpose. When it shows is five
        // selectors, one of them a sibling combinator on the handle, and those
        // live in `@layer components` beside the rest of this shell's rules —
        // where a utility would beat every one of them (rule 10). So the
        // stylesheet owns the whole of it and there is no conflict to lose.
        className={`absolute z-30 hidden h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-3)] text-[color:var(--kub-muted)] hover:text-[color:var(--kub-text)] md:flex ${FOCUS_RING}`}
      >
        <KubIcon name={collapsed ? "chevronRight" : "chevronLeft"} size={12} tone="currentColor" />
      </button>
    </>
  );
}
