"use client";

import { KubIcon } from "@/components/kub";
import { EDGE_ARROW_CLASS, useEdgeScroll } from "@/hooks/useEdgeScroll";
import { CHAT_KIND_FILTERS, type ChatKindFilter } from "@/lib/chatKind";
import { FOCUS_RING, PRESS_FILLED, PRESS_SINK_RAISED } from "@/lib/controlSurface";
import { cn } from "@/lib/utils";

/**
 * The capsule that separates people, groups and bots in the chat list
 * (tracker item 47). The rule — which pills, which is in force, what each
 * counts — is `lib/chatKind.ts`; this draws it.
 *
 * The same pills the global search uses for its types, deliberately: one
 * vocabulary for «narrow this list by kind», measured once in
 * `search-type-filters.test.mjs`. And `useEdgeScroll`, the mechanism
 * `FolderTabs` and those pills share, for a column dragged narrower than the
 * row.
 *
 * **No «Все» pill, and that is the one place it differs from the search's
 * row.** The folder strip above it — the rail's «Все» from `md` — already
 * says «Все», and a second «Все» a hand's width below read, in the first
 * render, as two controls for one thing. So a kind is a toggle: pressed, the
 * list is that kind; pressed again, it is everything the folder holds.
 */
export function ChatKindFilterBar({
  offered,
  active,
  unread,
  onSelect,
}: {
  offered: readonly ChatKindFilter[];
  active: ChatKindFilter;
  unread: Record<ChatKindFilter, number>;
  onSelect: (kind: ChatKindFilter) => void;
}) {
  const { scrollRef, canScrollLeft, canScrollRight, handleWheel, arrowProps } = useEdgeScroll<HTMLDivElement>({
    revision: `${active}:${offered.join(",")}`,
  });
  const pills = CHAT_KIND_FILTERS.filter((filter) => filter.id !== "all" && offered.includes(filter.id));

  return (
    // No surface of its own: it sits inside the list column's glass, as the
    // folder strip and the search's pills do.
    <div className="relative flex items-center px-3 pb-2 pt-2" data-testid="chat-kind-filter">
      {canScrollLeft && (
        <button {...arrowProps("left", "Прокрутить фильтры влево")} className={cn(EDGE_ARROW_CLASS.left, "hidden md:flex")}>
          <KubIcon name="chevronLeft" size={14} />
        </button>
      )}
      <div
        role="group"
        aria-label="Какие чаты показать"
        ref={scrollRef}
        onWheel={handleWheel}
        data-scroll-left={canScrollLeft}
        data-scroll-right={canScrollRight}
        className="kub-edge-scroll-fade flex min-w-0 flex-1 gap-1.5 overflow-x-auto no-scrollbar"
      >
        {pills.map((filter) => {
          const isActive = filter.id === active;
          const count = unread[filter.id] ?? 0;
          return (
            <button
              key={filter.id}
              type="button"
              data-chat-kind={filter.id}
              data-active={isActive ? "true" : undefined}
              aria-pressed={isActive}
              onClick={() => onSelect(isActive ? "all" : filter.id)}
              className={cn(
                // Padding only, as the search's pills: `.kub-button` carries the
                // 44px floor on a coarse pointer and a height utility would
                // outrank it silently.
                "kub-button kub-interactive flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold whitespace-nowrap transition-colors",
                FOCUS_RING,
                isActive
                  ? `bg-[var(--kub-cyan)] text-[color:var(--kub-bg)] ${PRESS_FILLED}`
                  : `kub-raise text-[color:var(--kub-muted)] hover:text-[color:var(--kub-text)] ${PRESS_SINK_RAISED}`,
              )}
            >
              <span>{filter.label}</span>
              {count > 0 && (
                <span
                  data-testid="chat-kind-unread"
                  className={cn(
                    "flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[12px] font-bold tabular-nums",
                    isActive ? "text-[color:var(--kub-bg)]" : "bg-[var(--kub-inset)] text-[color:var(--kub-muted)]",
                  )}
                >
                  {count > 99 ? "99+" : count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {canScrollRight && (
        <button {...arrowProps("right", "Прокрутить фильтры вправо")} className={cn(EDGE_ARROW_CLASS.right, "hidden md:flex")}>
          <KubIcon name="chevronRight" size={14} />
        </button>
      )}
    </div>
  );
}
