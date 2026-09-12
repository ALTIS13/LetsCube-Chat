import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MutableRefObject,
} from "react";
import { KubGlassLayer, KubIcon } from "@/components/kub";
import {
  ATTACH_TABS,
  nextTabIndex,
  tabRevealScrollLeft,
  tabRowOverflow,
  type AttachTabId,
  type AttachTabRowOverflow,
} from "@/lib/attachSheet";
import { FOCUS_RING } from "@/lib/controlSurface";
import { cn } from "@/lib/utils";
import { ATTACH_TAB_ICONS } from "./attachTypes";

export const attachTabElementId = (baseId: string, tab: AttachTabId) => `${baseId}-tab-${tab}`;
export const attachPanelElementId = (baseId: string, tab: AttachTabId) => `${baseId}-panel-${tab}`;

export type AttachTabRefs = MutableRefObject<Partial<Record<AttachTabId, HTMLButtonElement | null>>>;

/** Room kept beside a tab brought into view: the next one still peeks in, so the row reads as going on. */
const REVEAL_MARGIN = 28;

/**
 * The fade at an end of the row that hides tabs, so a tab cut off there reads as
 * more to come rather than as clipped. A mask rather than a gradient painted over
 * the row: the row stands on glass, and a painted fade would be a stripe of some
 * colour across it.
 */
const EDGE_FADE: Record<AttachTabRowOverflow, string | false> = {
  none: false,
  end: "[mask-image:linear-gradient(to_right,#000_calc(100%_-_2rem),transparent)]",
  start: "[mask-image:linear-gradient(to_left,#000_calc(100%_-_2rem),transparent)]",
  both: "[mask-image:linear-gradient(to_right,transparent,#000_2rem,#000_calc(100%_-_2rem),transparent)]",
};

interface AttachTabsProps {
  baseId: string;
  active: AttachTabId;
  onSelect: (tab: AttachTabId) => void;
  tabRefs: AttachTabRefs;
}

/**
 * The sheet's tabs, as the ARIA tabs pattern: one tab in the Tab order, the
 * arrows move between them and select as they go, Home and End reach the ends.
 *
 * A floating glass capsule with a lens under the chosen tab — «Стеклянная
 * капсула», the look the owner chose on 2026-09-12. Once something is selected
 * the capsule gives its place to the caption and the send button, which is the
 * same capsule doing the next job.
 *
 * Six tabs do not fit across a phone, so the row scrolls sideways under a
 * finger, as Telegram's does: the tabs keep their size, the last one in view is
 * cut by the edge, and a fade says which end hides more. The selected tab is
 * always brought wholly into view — after a key, after a tap on a tab half out
 * of view, or when the sheet picks the tab itself. A mouse wheel turns the row
 * too, since a desktop panel is as narrow as a phone.
 */
export function AttachTabs({ baseId, active, onSelect, tabRefs }: AttachTabsProps) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [overflow, setOverflow] = useState<AttachTabRowOverflow>("none");

  const readOverflow = useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    setOverflow(tabRowOverflow({ scrollLeft: row.scrollLeft, viewportWidth: row.clientWidth, contentWidth: row.scrollWidth }));
  }, []);

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return undefined;
    readOverflow();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(readOverflow);
    observer.observe(row);
    return () => observer.disconnect();
  }, [readOverflow]);

  // Registered by hand: React's wheel listener is passive, and turning the row
  // means keeping the wheel from also scrolling whatever is under the sheet.
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return undefined;
    const turn = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const furthest = row.scrollWidth - row.clientWidth;
      const next = Math.min(furthest, Math.max(0, row.scrollLeft + event.deltaY));
      if (furthest <= 0 || next === row.scrollLeft) return;
      event.preventDefault();
      row.scrollLeft = next;
    };
    row.addEventListener("wheel", turn, { passive: false });
    return () => row.removeEventListener("wheel", turn);
  }, []);

  useEffect(() => {
    const row = rowRef.current;
    const tab = tabRefs.current[active];
    if (!row || !tab) return;
    const left = tabRevealScrollLeft({
      scrollLeft: row.scrollLeft,
      viewportWidth: row.clientWidth,
      contentWidth: row.scrollWidth,
      tabStart: tab.offsetLeft,
      tabEnd: tab.offsetLeft + tab.offsetWidth,
      margin: REVEAL_MARGIN,
    });
    if (Math.abs(left - row.scrollLeft) < 1) return;
    const smooth = window.matchMedia?.("(prefers-reduced-motion: no-preference)").matches ?? false;
    row.scrollTo({ left, behavior: smooth ? "smooth" : "auto" });
  }, [active, tabRefs]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = ATTACH_TABS.findIndex((tab) => tab.id === active);
    const next = nextTabIndex(index, event.key, ATTACH_TABS.length);
    if (next === null) return;
    event.preventDefault();
    const target = ATTACH_TABS[next].id;
    onSelect(target);
    // The row brings the tab into view itself, above; a plain focus() could
    // also scroll the conversation or the page under the sheet to reach it.
    tabRefs.current[target]?.focus({ preventScroll: true });
  };

  return (
    // The capsule's glass does not scroll with the tabs inside it.
    <div className="relative min-w-0 max-w-full rounded-full">
      <KubGlassLayer className="rounded-full border border-[color:var(--glass-line)]" />
      <div
        ref={rowRef}
        role="tablist"
        aria-label="Вложения"
        data-attach-tabs="capsule"
        data-attach-tabs-overflow={overflow}
        onKeyDown={handleKeyDown}
        onScroll={readOverflow}
        className={cn("no-scrollbar relative flex gap-1 overflow-x-auto overscroll-x-contain rounded-full p-1", EDGE_FADE[overflow])}
      >
        {ATTACH_TABS.map((tab) => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              ref={(node) => {
                tabRefs.current[tab.id] = node;
              }}
              type="button"
              role="tab"
              id={attachTabElementId(baseId, tab.id)}
              aria-selected={selected}
              aria-controls={attachPanelElementId(baseId, tab.id)}
              tabIndex={selected ? 0 : -1}
              data-attach-tab={tab.id}
              onClick={() => onSelect(tab.id)}
              className={cn(
                "kub-interactive relative flex h-[3.25rem] w-[4.75rem] shrink-0 flex-col items-center justify-center gap-0.5 whitespace-nowrap rounded-full border px-1 text-[11px] font-semibold transition-colors",
                FOCUS_RING,
                // The row scrolls, so it clips an outline drawn outside a tab; this one is drawn inside.
                "focus-visible:outline-offset-[-3px]",
                selected
                  ? "kub-raise border-[color:var(--glass-line)] text-[color:var(--kub-accent-text)]"
                  : "border-transparent text-[color:var(--kub-muted)] hover:text-[color:var(--kub-text)]",
              )}
            >
              <KubIcon name={ATTACH_TAB_ICONS[tab.id]} size={21} className="relative" />
              <span className="relative">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
