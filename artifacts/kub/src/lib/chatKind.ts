/**
 * What kind of conversation a row is, and the filter that separates them
 * (tracker item 47).
 *
 * The owner, 2026-09-20: «ботов много, людей тоже и групп очевидно не меньше,
 * получается что всё в кучу сваливается… у меня буквально перед глазами шум из
 * чатов», and his own proposal: «небольшая капсула фильтрации по типу чатов».
 *
 * The phone survey (reference-clients §17) found both references answering it
 * differently. Telegram already separates by type — its folder editor has a
 * «Типы чатов» block with Контакты, Не контакты, Группы, Каналы and Боты — but
 * only by building a folder by hand, six steps each, which is why the owner, with
 * six tabs, still sees noise: the separation is **opt-in** there. Discord
 * separates by structure — servers never share the direct-message list — which
 * item 45 brings for the heavy object. What remains in one list is people,
 * groups and bots, and this is the capsule for that list: always there when the
 * list holds more than one kind, one press, no folder to build.
 *
 * Pure, so `node --test` decides every case; the sidebar draws it.
 */

import { chatBotPartner, type ChatBotHost } from "./chatBots.ts";

export type ChatKind = "person" | "group" | "channel" | "bot";
export type ChatKindFilter = "all" | ChatKind;

/** The pills, in the order the list is usually read: people first. */
export const CHAT_KIND_FILTERS: readonly { readonly id: ChatKindFilter; readonly label: string }[] = [
  { id: "all", label: "Все" },
  { id: "person", label: "Люди" },
  { id: "group", label: "Группы" },
  { id: "channel", label: "Каналы" },
  { id: "bot", label: "Боты" },
];

/** As much of a chat as the decision reads. */
export type ChatKindSubject = ChatBotHost & { readonly type: string };

/**
 * The kind of one conversation.
 *
 * A bot's conversation is private by type — the bot is not a member row — so it
 * is told apart by the bot it holds, the same reading `chatRowProfileTarget`
 * makes. «Избранное» is a person's own conversation and counts as one.
 */
export function chatKind(chat: ChatKindSubject): ChatKind {
  if (chat.type === "group") return "group";
  if (chat.type === "channel") return "channel";
  if (chatBotPartner(chat)) return "bot";
  return "person";
}

/**
 * The pills worth drawing for this list: «Все» and every kind present.
 *
 * None at all when the list holds one kind or nothing — a filter with one
 * choice filters nothing, and a row of one pill is noise of its own.
 */
export function offeredChatKinds(chats: readonly ChatKindSubject[]): ChatKindFilter[] {
  const present = new Set(chats.map(chatKind));
  if (present.size < 2) return [];
  return CHAT_KIND_FILTERS.map((filter) => filter.id).filter((id) => id === "all" || present.has(id as ChatKind));
}

/**
 * The filter in force: the one chosen while it is still offered, and «Все»
 * otherwise. A choice is not thrown away when its kind empties — it comes
 * back into force when a chat of that kind does.
 */
export function effectiveChatKind(chosen: ChatKindFilter, offered: readonly ChatKindFilter[]): ChatKindFilter {
  return offered.includes(chosen) ? chosen : "all";
}

/**
 * The list for one pill. «Все» hands back the very array it was given: the
 * chat list renders on a new array, and every event that did not change the
 * list is measured to render nothing (`chat-list-event-cost.spec.ts`).
 */
export function chatsOfKind<T extends ChatKindSubject>(chats: T[], filter: ChatKindFilter): T[] {
  if (filter === "all") return chats;
  return chats.filter((chat) => chatKind(chat) === filter);
}

/** Unread messages per pill, so a pill that is not chosen still says something waits there. */
export function unreadByChatKind(
  chats: readonly (ChatKindSubject & { readonly unread_count?: number | null })[],
): Record<ChatKindFilter, number> {
  const counts: Record<ChatKindFilter, number> = { all: 0, person: 0, group: 0, channel: 0, bot: 0 };
  for (const chat of chats) {
    const unread = chat.unread_count ?? 0;
    if (unread <= 0) continue;
    counts.all += unread;
    counts[chatKind(chat)] += unread;
  }
  return counts;
}

/** Where the choice is kept: per device and per account, as the list it filters is. */
export function chatKindStorageKey(userId: string): string {
  return `kub:chat-kind-filter:v1:${userId}`;
}

/** A stored value, read without trusting it. */
export function readStoredChatKind(raw: string | null | undefined): ChatKindFilter {
  return CHAT_KIND_FILTERS.some((filter) => filter.id === raw) ? (raw as ChatKindFilter) : "all";
}
