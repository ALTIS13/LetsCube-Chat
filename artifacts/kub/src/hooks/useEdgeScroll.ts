"use client";

import { useCallback, useEffect, useRef, useState, type RefObject, type WheelEvent } from "react";

/**
 * A row that scrolls sideways, and the two arrows that say it does.
 *
 * This is `FolderTabs`' mechanism, lifted out of it unchanged so a second row
 * can have it without a second copy. It was already the product's answer to
 * this problem — a scroll ref, the two edges kept by a scroll listener and a
 * `ResizeObserver`, a step of `max(120, clientWidth * 0.6)`, a vertical wheel
 * mapped to horizontal, and an arrow rendered only on the side that has
 * somewhere to go — and D-156 was the same defect appearing on the search
 * type-filter row, which had none of it: nine pills in a 360px column with
 * `overflow-x-auto no-scrollbar`, so no bar, no fade, no arrow, and with a
 * mouse and no horizontal wheel nothing to grab.
 *
 * Two things are deliberately NOT in here.
 *
 *  - **Keeping the chosen item in view.** `FolderTabs` scrolls the active tab
 *    into view by its index into its own `folders` array. That is its own
 *    business, not the scroller's, and moving it would have been the one way to
 *    change what that shipped component does.
 *  - **Watching the content.** The observer watches the scrolling element's own
 *    box, exactly as `FolderTabs` did. A row whose *children* change width
 *    without the row resizing — the filter row's counts appearing and
 *    disappearing is precisely that — tells the hook so through `revision`.
 *    Observing the children instead would be a better mechanism and a change to
 *    a stable component's behaviour, which this defect is not licensed to make.
 *
 * The class strings live here rather than at the call sites because they are
 * the half that rots: two rows drawing the same fade from two copies of one
 * gradient is how a material stops being one material. They are whole literal
 * strings, never composed, so Tailwind's scanner can still see them — the same
 * reason `lib/controlSurface.ts` writes its utilities out in full.
 */

/**
 * How far one press of an arrow moves the row.
 *
 * A proportion so the gesture means the same thing in a wide row and a narrow
 * one, with a floor so that in a very narrow column it still clears a pill
 * rather than nudging.
 */
export function edgeScrollStep(clientWidth: number): number {
  return Math.max(120, clientWidth * 0.6);
}

export interface ScrollEdges {
  canScrollLeft: boolean;
  canScrollRight: boolean;
}

/**
 * Which way the row can still go.
 *
 * The 1px slack on each side is not decoration: a scroller at its end can sit
 * a fraction of a pixel short of `scrollWidth - clientWidth` under a fractional
 * layout or a device pixel ratio that is not 1, and without it an arrow stays
 * lit at the end of a row that cannot move.
 */
export function edgesAt({
  scrollLeft,
  scrollWidth,
  clientWidth,
}: {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
}): ScrollEdges {
  const max = scrollWidth - clientWidth;
  return { canScrollLeft: scrollLeft > 1, canScrollRight: scrollLeft < max - 1 };
}

/**
 * A wheel with no horizontal axis, turned into one.
 *
 * Most mice have only a vertical wheel, so without this the row cannot be
 * reached by wheel at all. A trackpad that reports a real horizontal delta is
 * left alone — the browser is already scrolling the row with it, and adding
 * `deltaY` on top would fight the gesture.
 */
export function wheelScrollDelta(deltaX: number, deltaY: number): number {
  return Math.abs(deltaY) > Math.abs(deltaX) ? deltaY : 0;
}

export type EdgeScrollDirection = "left" | "right";

/**
 * The arrow's surface, and why it is a gradient rather than a button.
 *
 * It has no fill of its own: it fades the row out into `--glass-fill`, the
 * panel's own fill read from the token rather than a colour picked to match it,
 * so it cannot drift when the material changes (rule 1). The fade is the point
 * — it says the row continues under it — and the chevron is what you press.
 *
 * Written twice, in full, because a composed string is invisible to Tailwind's
 * scanner. The two differ only in which edge they are pinned to and which way
 * the gradient runs.
 */
export const EDGE_ARROW_CLASS: Record<EdgeScrollDirection, string> = {
  left: "absolute left-0 top-0 bottom-0 z-10 flex items-center justify-center px-1.5 text-[color:var(--kub-muted)] hover:text-[color:var(--kub-cyan)] transition-colors bg-gradient-to-r from-[var(--glass-fill)] from-60% to-transparent",
  right:
    "absolute right-0 top-0 bottom-0 z-10 flex items-center justify-center px-1.5 text-[color:var(--kub-muted)] hover:text-[color:var(--kub-cyan)] transition-colors bg-gradient-to-l from-[var(--glass-fill)] from-60% to-transparent",
};

export interface EdgeArrowProps {
  type: "button";
  onClick: () => void;
  "aria-label": string;
  className: string;
}

export interface EdgeScroll<T extends HTMLElement> {
  /** Put this on the element that scrolls, not on the wrapper around it. */
  scrollRef: RefObject<T | null>;
  canScrollLeft: boolean;
  canScrollRight: boolean;
  scrollByStep: (direction: 1 | -1) => void;
  handleWheel: (event: WheelEvent<T>) => void;
  /** Everything an arrow needs except its icon, which is the caller's word. */
  arrowProps: (direction: EdgeScrollDirection, label: string) => EdgeArrowProps;
}

export function useEdgeScroll<T extends HTMLElement = HTMLDivElement>({
  enabled = true,
  revision,
}: {
  /** False while the row is not rendered at all; no listener is attached. */
  enabled?: boolean;
  /**
   * Anything whose change alters the row's content width without resizing the
   * row itself. Compared as a dependency, so give it a scalar.
   */
  revision?: string | number | boolean | null;
} = {}): EdgeScroll<T> {
  const scrollRef = useRef<T>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const el = scrollRef.current;
    if (!el) return;

    const update = () => {
      const edges = edgesAt({
        scrollLeft: el.scrollLeft,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      });
      setCanScrollLeft(edges.canScrollLeft);
      setCanScrollRight(edges.canScrollRight);
    };

    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [enabled, revision]);

  const scrollByStep = useCallback((direction: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * edgeScrollStep(el.clientWidth), behavior: "smooth" });
  }, []);

  const handleWheel = useCallback((event: WheelEvent<T>) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollLeft += wheelScrollDelta(event.deltaX, event.deltaY);
  }, []);

  const arrowProps = useCallback(
    (direction: EdgeScrollDirection, label: string): EdgeArrowProps => ({
      type: "button",
      onClick: () => scrollByStep(direction === "left" ? -1 : 1),
      "aria-label": label,
      className: EDGE_ARROW_CLASS[direction],
    }),
    [scrollByStep],
  );

  return { scrollRef, canScrollLeft, canScrollRight, scrollByStep, handleWheel, arrowProps };
}
