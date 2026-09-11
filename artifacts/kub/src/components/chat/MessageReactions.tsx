"use client";

import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { KubIcon } from "@/components/kub";
import { UserAvatar } from "@/components/ui/ChatAvatar";
import { FOCUS_RING, PRESS_SINK } from "@/lib/controlSurface";
import { placeAnchored, type BoxEdges } from "@/lib/messageMenuPlacement";
import { QUICK_REACTION, reactionCountLabel, type ReactionGroup } from "@/lib/messageReactions";
import { readSafeAreaInsets } from "@/lib/safeArea";
import { cn } from "@/lib/utils";

import { MessageActionsContext, reactionPersonName, type ReactionPerson } from "./messageActionsContext";
import { COVERING_SURFACE } from "./messageSurfaces";

/**
 * The reaction controls that live inside a message: the hover button with its
 * column of quick reactions, and the chips under the text.
 *
 * Their surfaces are the covering material, so they live here and not in
 * `MessageBubble.tsx`, which is held to carrying no glass at all — a blur per
 * message is a layer per message on every scrolled frame (rule 6). Nothing here
 * is glass until it is open, and only one thing is open at a time.
 */

const OPEN_DELAY_MS = 160;
const CLOSE_DELAY_MS = 220;
const PEOPLE_DELAY_MS = 300;
const PEOPLE_SHOWN = 8;

function edgesOf(element: Element): BoxEdges {
  const rect = element.getBoundingClientRect();
  return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
}

/**
 * A popover laid out once invisibly, measured, and then placed beside its
 * anchor — so its real size decides whether it fits above, not a guess.
 */
function AnchoredLayer({
  anchor,
  prefer,
  className,
  children,
  layerRef,
  ...rest
}: {
  anchor: BoxEdges;
  prefer: "above" | "below";
  className: string;
  children: (side: "above" | "below") => ReactNode;
  layerRef?: React.MutableRefObject<HTMLDivElement | null>;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "children" | "className">) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<{ top: number; left: number; side: "above" | "below" } | null>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    setPlacement(
      placeAnchored({
        viewport: { width: window.innerWidth, height: window.innerHeight },
        safe: readSafeAreaInsets(),
        anchor,
        size: { width: rect.width, height: rect.height },
        prefer,
      }),
    );
  }, [anchor, prefer]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      {...rest}
      ref={(node) => {
        ref.current = node;
        if (layerRef) layerRef.current = node;
      }}
      className={className}
      style={{
        position: "fixed",
        top: placement?.top ?? 0,
        left: placement?.left ?? 0,
        visibility: placement ? "visible" : "hidden",
      }}
    >
      {children(placement?.side ?? prefer)}
    </div>,
    document.body,
  );
}

/**
 * A 24px face for the lists of who reacted. `UserAvatar` has no size that
 * small, and its monogram keeps its own 32px box, so a smaller class on the
 * avatar only clipped the letter. The 32px face is drawn and scaled down
 * instead, which moves nothing in the layout.
 */
export function TinyUserAvatar({ user, ringed = false }: { user: ReactionPerson; ringed?: boolean }) {
  return (
    <span
      className={cn(
        "flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full",
        ringed && "border-2 border-[color:var(--kub-surface)]",
      )}
    >
      <UserAvatar user={user} size="sm" className={ringed ? "scale-[0.625]" : "scale-75"} />
    </span>
  );
}

function useDelayedToggle() {
  const timer = useRef<number | null>(null);
  const clear = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);
  const later = useCallback(
    (delay: number, run: () => void) => {
      clear();
      timer.current = window.setTimeout(() => {
        timer.current = null;
        run();
      }, delay);
    },
    [clear],
  );
  useEffect(() => clear, [clear]);
  return { clear, later };
}

/**
 * The round ❤️ beside the time of a hovered message, as in Telegram Desktop.
 *
 * A click puts ❤️, or takes it back. Resting on it opens a column of the
 * person's frequent reactions, ❤️ nearest the button and «Больше реакций» at the
 * far end. It exists only for a hover-capable pointer from 640px — the class
 * decides that in `index.css` — and is otherwise not in the page at all.
 *
 * From the keyboard it is reached with Tab like any control: Enter puts ❤️,
 * ArrowUp opens the column with focus in it, and the menu key opens the
 * message's full menu.
 */
export function QuickReactionButton({
  messageId,
  placement,
  onReact,
}: {
  messageId: string;
  /** Which side of the bubble it sits on: an own message's left, a received one's right. */
  placement: "left" | "right";
  onReact: (emoji: string) => void;
}) {
  const actions = useContext(MessageActionsContext);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const columnRef = useRef<HTMLDivElement | null>(null);
  const [column, setColumn] = useState<{ anchor: BoxEdges; focusFirst: boolean } | null>(null);
  const { clear, later } = useDelayedToggle();

  const items = [QUICK_REACTION, ...(actions?.quickReactions ?? []).filter((emoji) => emoji !== QUICK_REACTION)].slice(0, 7);

  const open = useCallback((focusFirst: boolean) => {
    const button = buttonRef.current;
    if (!button) return;
    setColumn({ anchor: edgesOf(button), focusFirst });
  }, []);

  const close = useCallback((returnFocus = false) => {
    clear();
    setColumn(null);
    if (returnFocus) buttonRef.current?.focus();
  }, [clear]);

  useEffect(() => {
    if (!column) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close(true);
      }
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (columnRef.current?.contains(target) || buttonRef.current?.contains(target))) return;
      close();
    };
    // The column is placed against the button, and a scroll moves the button.
    const onScroll = () => close();
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [close, column]);

  useLayoutEffect(() => {
    if (!column?.focusFirst) return;
    const first = columnRef.current?.querySelector<HTMLButtonElement>("button");
    first?.focus();
  }, [column]);

  const react = (emoji: string) => {
    close();
    onReact(emoji);
  };

  const onColumnKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>, side: "above" | "below") => {
    const buttons = Array.from(columnRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const forward = side === "above" ? "ArrowUp" : "ArrowDown";
    const back = side === "above" ? "ArrowDown" : "ArrowUp";
    if (event.key === forward || event.key === back) {
      event.preventDefault();
      const step = event.key === forward ? 1 : -1;
      const next = buttons[(index + step + buttons.length) % buttons.length];
      next?.focus();
    } else if (event.key === "Tab") {
      close();
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        data-message-react-button="true"
        aria-label={`Поставить ${QUICK_REACTION}`}
        aria-haspopup="menu"
        aria-expanded={column !== null}
        className={cn(
          "kub-message-react-button kub-interactive absolute bottom-0 z-10 h-7 w-7 items-center justify-center rounded-full border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] text-[15px] leading-none kub-raise-hover",
          placement === "right" ? "left-full ml-1.5" : "right-full mr-1.5",
          FOCUS_RING,
          PRESS_SINK,
        )}
        onClick={(event) => {
          event.stopPropagation();
          react(QUICK_REACTION);
        }}
        onPointerEnter={(event) => {
          if (event.pointerType !== "mouse") return;
          later(OPEN_DELAY_MS, () => open(false));
        }}
        onPointerLeave={(event) => {
          if (event.pointerType !== "mouse") return;
          later(CLOSE_DELAY_MS, () => setColumn(null));
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp") {
            event.preventDefault();
            open(true);
          } else if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
            event.preventDefault();
            event.stopPropagation();
            if (buttonRef.current) actions?.openMenuAt(messageId, edgesOf(buttonRef.current));
          }
        }}
      >
        <span aria-hidden="true">{QUICK_REACTION}</span>
      </button>

      {column && (
        <AnchoredLayer
          anchor={column.anchor}
          prefer="above"
          layerRef={columnRef}
          role="menu"
          aria-label="Реакции"
          data-reaction-column="true"
          className={cn(COVERING_SURFACE, "kub-menu-in z-[56] rounded-full p-1")}
          onPointerEnter={clear}
          onPointerLeave={(event) => {
            if (event.pointerType !== "mouse") return;
            later(CLOSE_DELAY_MS, () => setColumn(null));
          }}
        >
          {(side) => (
            <div
              className={cn("flex items-center gap-0.5", side === "above" ? "flex-col-reverse" : "flex-col")}
              onKeyDown={(event) => onColumnKeyDown(event, side)}
            >
              {items.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  role="menuitem"
                  aria-label={`Поставить реакцию ${emoji}`}
                  className={cn(
                    "kub-interactive flex h-9 w-9 items-center justify-center rounded-full text-xl leading-none transition-transform hover:scale-110 kub-raise-hover",
                    FOCUS_RING,
                    PRESS_SINK,
                  )}
                  onClick={(event) => {
                    event.stopPropagation();
                    react(emoji);
                  }}
                >
                  {emoji}
                </button>
              ))}
              <button
                type="button"
                role="menuitem"
                aria-label="Больше реакций"
                title="Больше реакций"
                className={cn(
                  "kub-interactive flex h-9 w-9 items-center justify-center rounded-full text-[color:var(--kub-muted)] transition-colors hover:text-[color:var(--kub-text)] kub-raise-hover",
                  FOCUS_RING,
                  PRESS_SINK,
                )}
                onClick={(event) => {
                  event.stopPropagation();
                  const anchor = columnRef.current ? edgesOf(columnRef.current) : column.anchor;
                  close();
                  actions?.openEmojiPanel(messageId, anchor);
                }}
              >
                <KubIcon name={side === "above" ? "chevronUp" : "chevronDown"} size={16} />
              </button>
            </div>
          )}
        </AnchoredLayer>
      )}
    </>
  );
}

/**
 * One reaction under a message: the emoji, how many, and whether it is yours.
 *
 * A click puts it or takes it back, through the same one-per-person rule as
 * every other surface. Resting the pointer on it, or focusing it, lists who put
 * it. It pops once when it becomes yours — a double tap, a click, a choice from
 * a menu — and not when a conversation merely loads.
 */
export function ReactionChip({
  group,
  isNew,
  onToggle,
}: {
  group: ReactionGroup;
  /** Appeared after the message was already on screen. */
  isNew: boolean;
  onToggle: (emoji: string) => void;
}) {
  const actions = useContext(MessageActionsContext);
  const chipRef = useRef<HTMLButtonElement | null>(null);
  const [popping, setPopping] = useState(isNew && group.mine);
  const wasMine = useRef(group.mine);
  const [peopleAnchor, setPeopleAnchor] = useState<BoxEdges | null>(null);
  const { clear, later } = useDelayedToggle();

  useLayoutEffect(() => {
    if (group.mine && !wasMine.current) setPopping(true);
    wasMine.current = group.mine;
  }, [group.mine]);

  useEffect(() => {
    if (!peopleAnchor) return;
    const hide = () => setPeopleAnchor(null);
    window.addEventListener("scroll", hide, true);
    return () => window.removeEventListener("scroll", hide, true);
  }, [peopleAnchor]);

  const showPeople = () => {
    if (chipRef.current) setPeopleAnchor(edgesOf(chipRef.current));
  };

  const people = group.userIds.slice(0, PEOPLE_SHOWN);
  const more = group.userIds.length - people.length;
  const currentUserId = actions?.currentUserId ?? null;

  return (
    <>
      <button
        ref={chipRef}
        type="button"
        data-reaction-chip={group.emoji}
        aria-pressed={group.mine}
        aria-label={`${group.emoji}: ${reactionCountLabel(group.count)}${group.mine ? ", ваша" : ""}`}
        onClick={(event) => {
          event.stopPropagation();
          clear();
          setPeopleAnchor(null);
          onToggle(group.emoji);
        }}
        onPointerEnter={(event) => {
          if (event.pointerType !== "mouse") return;
          later(PEOPLE_DELAY_MS, showPeople);
        }}
        onPointerLeave={() => {
          clear();
          setPeopleAnchor(null);
        }}
        onFocus={(event) => {
          if (event.currentTarget.matches(":focus-visible")) showPeople();
        }}
        onBlur={() => setPeopleAnchor(null)}
        onAnimationEnd={(event) => {
          if (event.animationName === "kub-reaction-pop") setPopping(false);
        }}
        className={cn(
          "inline-flex h-[22px] items-center gap-1 rounded-full border px-2 text-[12px] leading-none transition-colors",
          FOCUS_RING,
          popping && "kub-reaction-pop",
          group.mine
            ? "bg-[color-mix(in_srgb,var(--kub-cyan)_14%,transparent)] border-[color-mix(in_srgb,var(--kub-cyan)_72%,transparent)] text-[color:var(--kub-accent-text)]"
            : "bg-[color-mix(in_srgb,var(--kub-surface-2)_72%,transparent)] border-[color-mix(in_srgb,var(--kub-border-color)_72%,transparent)] text-[color:var(--kub-muted)]",
        )}
      >
        <span className="text-sm leading-none">{group.emoji}</span>
        {group.count > 1 && <span className="tabular-nums">{group.count}</span>}
      </button>

      {peopleAnchor && (
        <AnchoredLayer
          anchor={peopleAnchor}
          prefer="below"
          role="tooltip"
          data-reaction-people={group.emoji}
          className={cn(COVERING_SURFACE, "kub-menu-in z-[56] w-max min-w-44 max-w-64 rounded-xl px-2 py-1.5")}
        >
          {() => (
            <>
              <div className="flex items-center gap-1.5 px-1 pb-1 text-[12px] text-[color:var(--kub-muted)]">
                <span className="text-sm leading-none">{group.emoji}</span>
                <span>{reactionCountLabel(group.count)}</span>
              </div>
              <ul className="grid gap-0.5">
                {people.map((userId) => {
                  const person = actions?.people.get(userId);
                  const name = reactionPersonName(person, userId, currentUserId);
                  return (
                    <li key={userId} className="flex min-w-0 items-center gap-2 px-1 py-1">
                      <TinyUserAvatar user={person ?? { id: userId, full_name: name, username: null, avatar_url: null }} />
                      <span className="min-w-0 truncate text-sm text-[color:var(--kub-text)]">{name}</span>
                    </li>
                  );
                })}
              </ul>
              {more > 0 && (
                <div className="px-1 pt-0.5 text-[12px] text-[color:var(--kub-muted)]">и ещё {more}</div>
              )}
            </>
          )}
        </AnchoredLayer>
      )}
    </>
  );
}
