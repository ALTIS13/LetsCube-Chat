"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

import { KubIcon, type KubIconName } from "@/components/kub";
import { UserAvatar } from "@/components/ui/ChatAvatar";
import { EmojiCategoryPicker } from "@/components/ui/EmojiCategoryPicker";
import { FOCUS_RING, FOCUS_RING_INSET, PRESS_SINK } from "@/lib/controlSurface";
import { MESSAGE_EMOJI_CATEGORIES, MESSAGE_EMOJI_SEARCH_TERMS } from "@/lib/emojiCatalog";
import { formatFullTime, formatMessageMoment } from "@/lib/format";
import { getReceiptDisplayName, type GroupReadReceiptInfo } from "@/lib/groupReadReceipts";
import {
  MESSAGE_ACTION_LABELS,
  desktopMessageActions,
  phoneMessageActions,
  type MessageActionContext,
  type MessageActionId,
} from "@/lib/messageActions";
import {
  placeAnchored,
  placeAtPoint,
  placePhoneMenu,
  type BoxEdges,
  type PhoneMenuPlacement,
} from "@/lib/messageMenuPlacement";
import {
  QUICK_REACTION,
  groupReactions,
  leadingReactionEmoji,
  myReaction,
  reactionCountLabel,
} from "@/lib/messageReactions";
import { NO_SAFE_AREA_INSETS, readSafeAreaInsets, type SafeAreaInsets } from "@/lib/safeArea";
import { cn } from "@/lib/utils";
import type { MessageWithSender } from "@/types/database";

import { reactionPersonName, type ReactionPerson } from "./messageActionsContext";
import { COVERING_SURFACE } from "./messageSurfaces";
import { TinyUserAvatar } from "./MessageReactions";

/**
 * A message's menus — Telegram's, as the owner described them on 2026-09-11.
 *
 * One layer for the whole conversation rather than one per message: a message
 * only reports what was asked for (a tap, a right click, a key), and this draws
 * it. That keeps every bubble free of menu state, which is D-086's reason for
 * existing, and it is what lets the phone menu dim the whole screen while the
 * message itself stays lit.
 *
 * Two shapes. Below 640px, the phone's: the screen dims, the message stays in
 * place above the dim, a pill of reactions sits over it and a card under it —
 * a list, then a row of icons. From 640px, the desktop's: a strip of reactions
 * on top of a menu opened at the pointer, its items chosen by what the message
 * is. Both open «Детали», the readers, the people who reacted and the full
 * emoji panel inside themselves rather than stacking a dialog on top.
 */

export type MessageMenuShape = "phone" | "desktop";

export interface MessageMenuRequest {
  messageId: string;
  shape: MessageMenuShape;
  /** Where it was asked for: the pointer, the tap, or the middle of a control. */
  point: { x: number; y: number };
  /** Opens straight into the emoji panel, beside the control at this box. */
  emojiAnchor?: BoxEdges;
  /** A key opened it, so focus starts on the first item. */
  fromKeyboard?: boolean;
}

export type MessageActionCapabilities = MessageActionContext["can"];

type View = "actions" | "details" | "reactors" | "readers" | "emoji";

const ACTION_ICONS: Readonly<Record<MessageActionId, KubIconName>> = {
  reply: "reply",
  edit: "edit",
  editCaption: "edit",
  pin: "pin",
  unpin: "pinOff",
  copy: "copy",
  copyText: "copy",
  copyImage: "image",
  saveAs: "download",
  copyLink: "link",
  forward: "forward",
  delete: "delete",
  select: "checkCircle",
  details: "info",
  retry: "rotate",
  editFailed: "edit",
  discard: "delete",
};

const DANGER: ReadonlySet<MessageActionId> = new Set(["delete", "discard"]);

const TOUCH_CELL = 44;
const POINTER_CELL = 36;

function edgesOf(element: Element): BoxEdges {
  const rect = element.getBoundingClientRect();
  return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
}

/**
 * The message as a person sees it: from the sender's name above the bubble to
 * the bubble's bottom. A bar placed against the bubble alone sat on the name.
 */
function messageTop(messageId: string): number | null {
  const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(messageId) : messageId;
  const row = document.querySelector<HTMLElement>(`[data-message-id="${escaped}"] [data-message-row="true"]`);
  return row ? row.getBoundingClientRect().top : null;
}

function findBubble(messageId: string): HTMLElement | null {
  const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(messageId) : messageId.replace(/"/g, '\\"');
  return document.querySelector<HTMLElement>(`[data-message-id="${escaped}"] [data-message-bubble="true"]`);
}

function hiddenUntilPlaced(position: { top: number; left: number } | null | undefined, extra?: CSSProperties): CSSProperties {
  return {
    top: position?.top ?? 0,
    left: position?.left ?? 0,
    visibility: position ? "visible" : "hidden",
    ...extra,
  };
}

/**
 * A desktop menu places its bar and card as one column, and each of them hides
 * itself until then; the column itself never does. Measured in WebKit on
 * 2026-09-11: with the visibility flipping on the column instead, the entrance
 * animating inside it ended and left both surfaces on its first keyframe — the
 * bar at opacity 0 and .98 — until something else restyled them. A surface that
 * carries its own visibility, as a phone's do, comes to rest.
 */
function shownOncePlaced(position: { top: number; left: number } | null): CSSProperties {
  return { visibility: position ? "visible" : "hidden" };
}

/** Arrow keys walk the items of whichever group holds the focus. */
function walkItems(event: ReactKeyboardEvent<HTMLElement>) {
  const active = document.activeElement as HTMLElement | null;
  if (!active) return;
  const horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight";
  const vertical = event.key === "ArrowUp" || event.key === "ArrowDown";
  const edge = event.key === "Home" || event.key === "End";
  if (!horizontal && !vertical && !edge) return;
  const group = active.closest<HTMLElement>(horizontal ? '[role="toolbar"]' : '[role="menu"]') ??
    active.closest<HTMLElement>('[role="menu"], [role="toolbar"]');
  if (!group) return;
  const selector = group.getAttribute("role") === "toolbar" ? "button" : '[role="menuitem"]';
  const items = Array.from(group.querySelectorAll<HTMLElement>(selector)).filter((item) => !item.hasAttribute("disabled"));
  if (!items.length) return;
  event.preventDefault();
  const index = items.indexOf(active);
  if (event.key === "Home") return items[0].focus();
  if (event.key === "End") return items[items.length - 1].focus();
  const step = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
  items[(index + step + items.length) % items.length]?.focus();
}

export function MessageActionLayer({
  request,
  message,
  own,
  chatType,
  privateReadAt,
  groupReadInfo,
  currentUserId,
  people,
  quickReactions,
  capabilities,
  captionEditable,
  hasText,
  kind,
  onClose,
  onLift,
  onAction,
  onReact,
}: {
  request: MessageMenuRequest;
  message: MessageWithSender;
  own: boolean;
  chatType: string | null | undefined;
  /** When the other person of a private chat read this message, if they have. */
  privateReadAt: string | null;
  groupReadInfo: GroupReadReceiptInfo | null;
  currentUserId: string | null;
  people: ReadonlyMap<string, ReactionPerson>;
  quickReactions: readonly string[];
  capabilities: MessageActionCapabilities;
  captionEditable: boolean;
  hasText: boolean;
  kind: MessageActionContext["kind"];
  onClose: () => void;
  /** How far the phone menu lifts the message; the list moves the row. */
  onLift: (lift: number) => void;
  onAction: (action: MessageActionId) => void;
  onReact: (emoji: string) => void;
}) {
  const phone = request.shape === "phone";
  const [view, setView] = useState<View>(request.emojiAnchor ? "emoji" : "actions");
  const [emojiAnchor, setEmojiAnchor] = useState<BoxEdges | null>(request.emojiAnchor ?? null);
  const safeRef = useRef<SafeAreaInsets>(NO_SAFE_AREA_INSETS);
  const liftRef = useRef(0);
  const barRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const deskRef = useRef<HTMLDivElement | null>(null);
  const [phonePlacement, setPhonePlacement] = useState<PhoneMenuPlacement | null>(null);
  const [deskPosition, setDeskPosition] = useState<{ top: number; left: number } | null>(null);

  const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches === true;
  const viewportWidth = typeof window === "undefined" ? 390 : window.innerWidth;
  const mine = myReaction(message.reactions, currentUserId);
  const reactable = !(message.id.startsWith("tmp:") || message.pending || message.checking || message.failed);

  const context: MessageActionContext = {
    kind,
    own,
    localSend: !reactable,
    failed: Boolean(message.failed),
    pinned: Boolean(message.pinned),
    hasText,
    captionEditable,
    can: capabilities,
  };

  // How many reactions the bar holds: ❤️ and up to six more, as many as fit
  // beside the expand button at a finger's 44px without leaving the screen.
  // At 390 that is all eight — ❤️, six more and the expand button — edge to
  // edge at 44px each; at 360 one of the six gives way.
  const cell = phone || coarse ? TOUCH_CELL : POINTER_CELL;
  const availableForBar = viewportWidth - 24 - 6;
  const barCount = Math.max(3, Math.min(7, Math.floor(availableForBar / cell) - 1));
  const barEmoji = [QUICK_REACTION, ...quickReactions.filter((emoji) => emoji !== QUICK_REACTION)].slice(0, barCount);

  useLayoutEffect(() => {
    safeRef.current = readSafeAreaInsets();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    const onResize = () => onClose();
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onResize);
    };
  }, [onClose]);

  // Focus goes into the menu so arrows and Escape reach it; a key that opened
  // it lands on the first item, a pointer only on the container.
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const container = phone ? cardRef.current : deskRef.current;
    const first = container?.querySelector<HTMLElement>('[role="menuitem"]');
    (request.fromKeyboard ? first ?? container : container)?.focus({ preventScroll: true });
    return () => {
      if (!request.fromKeyboard) return;
      const previous = returnFocusRef.current;
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true });
    };
    // Once per opening: the layer is remounted for every request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    const safe = readSafeAreaInsets();
    safeRef.current = safe;
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    if (phone) {
      const bubble = findBubble(message.id);
      if (!bubble) {
        onClose();
        return;
      }
      const rect = bubble.getBoundingClientRect();
      const top = messageTop(message.id) ?? rect.top;
      // The rectangles include the lift already applied, so it is taken back
      // out: every placement starts from where the message really sits.
      const base = { top: top + liftRef.current, bottom: rect.bottom + liftRef.current, left: rect.left, right: rect.right };
      const lower = (view === "emoji" ? panelRef.current : cardRef.current)?.getBoundingClientRect();
      // No bar in a submenu, and none for a message that cannot take a
      // reaction yet; the card then takes the room the bar would have had.
      const bar = view === "actions" && reactable ? barRef.current?.getBoundingClientRect() : { width: 0, height: 0 };
      if (!lower || !bar) return;
      const placement = placePhoneMenu({
        viewport,
        safe,
        bubble: base,
        bar: { width: bar.width, height: bar.height },
        card: { width: lower.width, height: lower.height },
        align: own ? "end" : "start",
      });
      liftRef.current = placement.lift;
      onLift(placement.lift);
      setPhonePlacement(placement);
      return;
    }
    const box = (view === "emoji" ? panelRef.current : deskRef.current)?.getBoundingClientRect();
    if (!box) return;
    const size = { width: box.width, height: box.height };
    setDeskPosition(
      view === "emoji" && emojiAnchor
        ? placeAnchored({ viewport, safe, anchor: emojiAnchor, size, prefer: "above" })
        : placeAtPoint({
            viewport,
            safe,
            point: request.point,
            size,
            avoid: (() => {
              const top = messageTop(message.id);
              return top === null ? undefined : { top };
            })(),
          }),
    );
    // Placed again whenever what is shown changes size.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const run = (action: MessageActionId) => {
    if (action === "details") {
      setView("details");
      return;
    }
    onAction(action);
  };

  const react = (emoji: string) => {
    onReact(emoji);
    onClose();
  };

  const openEmoji = (from: HTMLElement | null) => {
    setEmojiAnchor(from ? edgesOf(from) : null);
    setView("emoji");
  };

  const reactionButton = (emoji: string) => (
    <button
      key={emoji}
      type="button"
      aria-label={`Поставить реакцию ${emoji}`}
      aria-pressed={mine === emoji}
      onClick={() => react(emoji)}
      className={cn(
        "kub-interactive flex shrink-0 items-center justify-center rounded-full leading-none transition-transform hover:scale-110 kub-raise-hover",
        phone ? "h-11 w-11 text-[26px]" : "h-9 w-9 text-xl pointer-coarse:h-11 pointer-coarse:w-11 pointer-coarse:text-2xl",
        mine === emoji && "bg-[color-mix(in_srgb,var(--kub-cyan)_24%,transparent)]",
        FOCUS_RING,
        PRESS_SINK,
      )}
    >
      {emoji}
    </button>
  );

  const expandButton = (
    <button
      type="button"
      aria-label="Больше реакций"
      title="Больше реакций"
      onClick={(event) => openEmoji(event.currentTarget.closest<HTMLElement>("[data-reaction-bar]"))}
      className={cn(
        "kub-interactive flex shrink-0 items-center justify-center rounded-full border border-[color:var(--kub-rule)] text-[color:var(--kub-muted)] transition-colors hover:text-[color:var(--kub-text)] kub-raise-hover",
        phone ? "h-11 w-11" : "h-9 w-9 pointer-coarse:h-11 pointer-coarse:w-11",
        FOCUS_RING,
        PRESS_SINK,
      )}
    >
      <KubIcon name="chevronDown" size={phone ? 20 : 16} />
    </button>
  );

  const reactionBar = reactable && (
    <div
      ref={barRef}
      data-reaction-bar="true"
      role="toolbar"
      aria-label="Реакции"
      onKeyDown={walkItems}
      className={cn(
        COVERING_SURFACE,
        "kub-menu-in flex items-center rounded-full",
        phone ? "p-0.5" : "gap-0.5 p-1",
        phone && "fixed z-[52]",
      )}
      style={phone ? hiddenUntilPlaced(phonePlacement?.bar) : shownOncePlaced(deskPosition)}
    >
      {barEmoji.map(reactionButton)}
      {expandButton}
    </div>
  );

  const menuItem = (action: MessageActionId) => (
    <button
      key={action}
      type="button"
      role="menuitem"
      data-message-action={action}
      onClick={() => run(action)}
      className={cn(
        "kub-interactive flex w-full items-center gap-3 px-4 text-left text-sm transition-colors kub-raise-hover",
        phone ? "min-h-11 py-2" : "min-h-9 py-1.5 pointer-coarse:min-h-11",
        DANGER.has(action) ? "text-[color:var(--kub-danger-text)]" : "text-[color:var(--kub-text)]",
        FOCUS_RING_INSET,
        PRESS_SINK,
      )}
    >
      <KubIcon name={ACTION_ICONS[action]} size={18} tone={DANGER.has(action) ? "currentColor" : "muted"} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{MESSAGE_ACTION_LABELS[action]}</span>
      {action === "details" && <KubIcon name="chevronRight" size={16} tone="muted" className="shrink-0" />}
    </button>
  );

  const backRow = (title: string) => (
    <button
      type="button"
      role="menuitem"
      onClick={() => setView("actions")}
      className={cn(
        "kub-interactive flex min-h-11 w-full items-center gap-2 border-b border-[color:var(--kub-rule)] px-3 text-left text-sm font-semibold text-[color:var(--kub-text)] transition-colors kub-raise-hover",
        FOCUS_RING_INSET,
        PRESS_SINK,
      )}
    >
      <KubIcon name="chevronLeft" size={16} tone="muted" />
      {title}
    </button>
  );

  const person = (userId: string) => ({
    profile: people.get(userId),
    name: reactionPersonName(people.get(userId), userId, currentUserId),
  });

  const smallAvatar = (userId: string, name: string) => (
    <TinyUserAvatar
      key={userId}
      ringed
      user={people.get(userId) ?? { id: userId, full_name: name, username: null, avatar_url: null }}
    />
  );

  const groups = groupReactions(message.reactions, currentUserId);
  const reactionTotal = message.reactions?.length ?? 0;
  const reactors = [...new Set((message.reactions ?? []).map((reaction) => reaction.user_id))];

  const reactionsHeader = reactionTotal > 0 && (
    <button
      type="button"
      role="menuitem"
      data-message-menu-reactions="true"
      onClick={() => setView("reactors")}
      className={cn(
        "kub-interactive flex min-h-12 w-full items-center gap-2 border-b border-[color:var(--kub-rule)] px-4 text-left text-sm text-[color:var(--kub-text)] transition-colors kub-raise-hover",
        FOCUS_RING_INSET,
        PRESS_SINK,
      )}
    >
      <span className="shrink-0 text-base leading-none">{leadingReactionEmoji(groups).join(" ")}</span>
      <span className="min-w-0 flex-1 truncate">{reactionCountLabel(reactionTotal)}</span>
      <span className="flex shrink-0 -space-x-1">
        {reactors.slice(0, 3).map((userId) => smallAvatar(userId, person(userId).name))}
      </span>
      <KubIcon name="chevronRight" size={16} tone="muted" className="shrink-0" />
    </button>
  );

  const readersList = (info: GroupReadReceiptInfo) =>
    info.readers.length === 0 ? (
      <p className="px-4 py-3 text-sm text-[color:var(--kub-muted)]">Пока никто не прочитал</p>
    ) : (
      <ul className="max-h-[min(40dvh,18rem)] overflow-y-auto py-1" data-message-readers="true">
        {info.readers.map((reader) => {
          const name = getReceiptDisplayName(reader);
          return (
            <li key={reader.userId} className="flex min-w-0 items-center gap-3 px-4 py-1.5">
              <UserAvatar
                user={reader.profile ?? { id: reader.userId, full_name: name, username: null, avatar_url: null }}
                size="sm"
              />
              <span className="min-w-0 flex-1 truncate text-sm text-[color:var(--kub-text)]">{name}</span>
              <span className="shrink-0 text-[12px] tabular-nums text-[color:var(--kub-muted)]">{formatFullTime(reader.readAt)}</span>
            </li>
          );
        })}
      </ul>
    );

  const detailRow = (icon: KubIconName, term: string, value: string) => (
    <div key={term} className="flex min-w-0 items-start gap-3">
      <KubIcon name={icon} size={18} tone="muted" className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        <dt className="text-[12px] text-[color:var(--kub-muted)]">{term}</dt>
        <dd className="text-sm text-[color:var(--kub-text)]">{value}</dd>
      </div>
    </div>
  );

  let cardContent: ReactNode;
  if (view === "details") {
    cardContent = (
      <>
        {backRow("Детали")}
        <dl className="grid gap-3 px-4 py-3" data-message-details="true">
          {detailRow("clock", "Отправлено", formatMessageMoment(message.created_at))}
          {message.edited_at && detailRow("edit", "Изменено", formatMessageMoment(message.edited_at))}
          {own && chatType === "private" &&
            detailRow("doubleCheck", "Прочитано", privateReadAt ? formatMessageMoment(privateReadAt) : "Ещё не прочитано")}
        </dl>
        {own && groupReadInfo && (
          <div className="border-t border-[color:var(--kub-rule)]">
            <div className="px-4 pb-1 pt-2.5 text-[12px] font-semibold text-[color:var(--kub-muted)]">
              Кто прочитал · {groupReadInfo.readCount} из {groupReadInfo.totalRecipients}
            </div>
            {readersList(groupReadInfo)}
          </div>
        )}
      </>
    );
  } else if (view === "reactors") {
    cardContent = (
      <>
        {backRow(reactionCountLabel(reactionTotal))}
        <ul className="max-h-[min(40dvh,18rem)] overflow-y-auto py-1" data-message-reactors="true">
          {(message.reactions ?? []).map((reaction) => {
            const { name } = person(reaction.user_id);
            return (
              <li key={reaction.id} className="flex min-w-0 items-center gap-3 px-4 py-1.5">
                <UserAvatar
                  user={people.get(reaction.user_id) ?? { id: reaction.user_id, full_name: name, username: null, avatar_url: null }}
                  size="sm"
                />
                <span className="min-w-0 flex-1 truncate text-sm text-[color:var(--kub-text)]">{name}</span>
                <span className="shrink-0 text-lg leading-none">{reaction.emoji}</span>
              </li>
            );
          })}
        </ul>
      </>
    );
  } else if (view === "readers" && groupReadInfo) {
    cardContent = (
      <>
        {backRow(`Прочитали · ${groupReadInfo.readCount} из ${groupReadInfo.totalRecipients}`)}
        {readersList(groupReadInfo)}
      </>
    );
  } else if (phone) {
    const { list, row } = phoneMessageActions(context);
    cardContent = (
      <>
        {reactionsHeader}
        {list.map(menuItem)}
        {row.length > 0 && (
          <div
            className={cn("grid", list.length > 0 && "border-t border-[color:var(--kub-rule)]")}
            style={{ gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))` }}
          >
            {row.map((action) => (
              <button
                key={action}
                type="button"
                role="menuitem"
                data-message-action={action}
                onClick={() => run(action)}
                className={cn(
                  "kub-interactive flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 px-1 py-2 text-[12px] leading-tight transition-colors kub-raise-hover",
                  DANGER.has(action) ? "text-[color:var(--kub-danger-text)]" : "text-[color:var(--kub-text)]",
                  FOCUS_RING_INSET,
                  PRESS_SINK,
                )}
              >
                <KubIcon name={ACTION_ICONS[action]} size={22} tone={DANGER.has(action) ? "currentColor" : "muted"} />
                <span className="max-w-full truncate">{MESSAGE_ACTION_LABELS[action]}</span>
              </button>
            ))}
          </div>
        )}
      </>
    );
  } else {
    const groupRead = own && groupReadInfo && (chatType === "group" || chatType === "channel");
    const privateRead = own && chatType === "private" && privateReadAt;
    cardContent = (
      <>
        {groupRead && (
          <button
            type="button"
            role="menuitem"
            data-message-menu-readers="true"
            onClick={() => setView("readers")}
            className={cn(
              "kub-interactive flex min-h-9 w-full items-center gap-3 border-b border-[color:var(--kub-rule)] px-4 py-1.5 text-left text-sm text-[color:var(--kub-text)] transition-colors kub-raise-hover pointer-coarse:min-h-11",
              FOCUS_RING_INSET,
              PRESS_SINK,
            )}
          >
            <KubIcon name="doubleCheck" size={18} tone="muted" className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">Прочитали: {groupReadInfo.readCount}</span>
            <KubIcon name="chevronRight" size={16} tone="muted" className="shrink-0" />
          </button>
        )}
        {privateRead && (
          <div className="flex min-h-9 items-center gap-3 border-b border-[color:var(--kub-rule)] px-4 py-1.5 text-sm text-[color:var(--kub-muted)]">
            <KubIcon name="doubleCheck" size={18} tone="accent" className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">Прочитано в {formatFullTime(privateReadAt)}</span>
          </div>
        )}
        {desktopMessageActions(context).map(menuItem)}
      </>
    );
  }

  const card = view !== "emoji" && (
    <div
      ref={cardRef}
      data-action-menu="true"
      data-message-menu-view={view}
      role="menu"
      aria-label="Действия с сообщением"
      tabIndex={-1}
      onKeyDown={walkItems}
      className={cn(
        COVERING_SURFACE,
        "kub-menu-in outline-none",
        phone
          // 312px, so four icons below the list keep their whole labels —
          // «Копировать» at 12px is 68px, and 280px cut it to «Копиров…».
          ? "fixed z-[52] w-[19.5rem] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl"
          // Never taller than the screen can hold beside the bar above it. A
          // phone held sideways keeps this shape with finger-sized rows, and
          // a photo's ten ran 8px into its bottom inset at 844x390. The
          // screen less both safe insets, the 8px margin at each end and the
          // bar with its gap (52 + 6 under a finger); the rest scrolls.
          : "w-64 max-h-[calc(100dvh-var(--kub-safe-top)-var(--kub-safe-bottom)-4.75rem)] overflow-x-hidden overflow-y-auto overscroll-contain rounded-xl pointer-coarse:w-[18.75rem]",
      )}
      style={phone ? hiddenUntilPlaced(phonePlacement?.card) : shownOncePlaced(deskPosition)}
    >
      {cardContent}
    </div>
  );

  const recentCount = phone || coarse
    ? Math.max(4, Math.floor((Math.min(viewportWidth - 24, 480) - 16 + 4) / (TOUCH_CELL + 4)))
    : 8;
  const emojiPanel = view === "emoji" && (
    <div
      ref={panelRef}
      data-reaction-menu="true"
      role="dialog"
      aria-label="Все реакции"
      className={cn(
        COVERING_SURFACE,
        "kub-menu-in fixed z-[52] overflow-hidden rounded-2xl p-2",
        phone ? "w-[calc(100vw-1.5rem)] max-w-[30rem]" : "w-[22rem] max-w-[calc(100vw-1rem)]",
      )}
      style={hiddenUntilPlaced(phone ? phonePlacement?.card : deskPosition)}
    >
      <EmojiCategoryPicker
        categories={MESSAGE_EMOJI_CATEGORIES}
        searchTerms={MESSAGE_EMOJI_SEARCH_TERMS}
        recent={[QUICK_REACTION, ...quickReactions.filter((emoji) => emoji !== QUICK_REACTION)].slice(0, recentCount)}
        selected={mine}
        onSelect={(value) => {
          if (value) react(value);
        }}
        // Four whole rows under a finger, so the grid ends on a row rather
        // than on a strip of a fifth one.
        gridClassName="pointer-coarse:max-h-[min(11.75rem,25dvh)]"
        testIdPrefix="reaction-emoji"
        searchable
        scrollable
        compact
      />
    </div>
  );

  if (phone) {
    return (
      <>
        <div
          data-message-menu-scrim="true"
          aria-hidden="true"
          className="kub-message-scrim fixed inset-0 z-50"
          onClick={onClose}
          onContextMenu={(event) => {
            event.preventDefault();
            onClose();
          }}
        />
        {view === "actions" && reactionBar}
        {card}
        {emojiPanel}
      </>
    );
  }

  return (
    <>
      <div
        data-message-menu-catcher="true"
        aria-hidden="true"
        className="fixed inset-0 z-50"
        onClick={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      />
      {view === "emoji" ? (
        emojiPanel
      ) : (
        <div
          ref={deskRef}
          data-message-menu="desktop"
          tabIndex={-1}
          className="fixed z-[52] flex flex-col items-start gap-1.5 outline-none"
          style={{ top: deskPosition?.top ?? 0, left: deskPosition?.left ?? 0 }}
          onKeyDown={walkItems}
          onContextMenu={(event) => event.preventDefault()}
        >
          {view === "actions" && reactionBar}
          {card}
        </div>
      )}
    </>
  );
}
