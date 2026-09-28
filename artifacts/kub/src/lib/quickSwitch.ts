/**
 * What the search offers before anything is typed (tracker item 36, c — its
 * global half).
 *
 * The owner, 2026-09-20, of Discord's quick switcher: «Глобальный поиск
 * исполнен немного иначе чем в Telegram, но тем не менее интересно». Our field
 * showed nothing at all until a letter was typed. Discord's switcher was read in
 * its bundle (reference-clients §15, module 174768): on an empty query it lists
 * **Previous Channels** — its history of where you were, the one you are in
 * skipped — then **Drafts**, **Mentions** and **Unread Channels**, and it cuts
 * the first to seven when it stands alone and to three when anything follows
 * it. Ours takes the three we have the facts for: where the reader was, where a
 * draft waits (the composer keeps them), and what is unread and not muted.
 * Mentions wait for a mention count, which the list does not carry.
 *
 * A conversation appears once, in the first section that has it: the same row
 * twice in a dozen is a row the arrow keys pass twice.
 *
 * Pure, so `node --test` reads every case.
 */

export type QuickSwitchSectionId = "recent" | "drafts" | "unread";

export interface QuickSwitchSection {
  id: QuickSwitchSectionId;
  title: string;
  chatIds: string[];
}

export interface QuickSwitchChat {
  id: string;
  unread: number;
  muted: boolean;
}

/** How many visits are remembered. */
export const RECENT_CHATS_LIMIT = 20;
/** Discord's figures: seven alone, three with company. */
export const RECENT_ALONE = 7;
export const RECENT_WITH_OTHERS = 3;
export const OTHER_SECTION_LIMIT = 5;

/** The visit list after opening `chatId`: most recent first, each once. */
export function recordRecentChat(list: readonly string[], chatId: string, limit = RECENT_CHATS_LIMIT): string[] {
  return [chatId, ...list.filter((id) => id !== chatId)].slice(0, limit);
}

export function quickSwitchSections(input: {
  /** Most recent first. */
  recent: readonly string[];
  currentChatId: string | null;
  /** The conversations the reader can see, in the list's order. */
  chats: readonly QuickSwitchChat[];
  draftChatIds: ReadonlySet<string>;
}): QuickSwitchSection[] {
  const known = new Set(input.chats.map((chat) => chat.id));
  const taken = new Set<string>(input.currentChatId ? [input.currentChatId] : []);
  const pick = (ids: readonly string[], limit: number): string[] => {
    const chosen: string[] = [];
    for (const id of ids) {
      if (chosen.length >= limit) break;
      if (!known.has(id) || taken.has(id)) continue;
      taken.add(id);
      chosen.push(id);
    }
    return chosen;
  };

  // Decided on what the other two would hold, before either takes anything.
  const othersPresent =
    input.chats.some((chat) => chat.id !== input.currentChatId && input.draftChatIds.has(chat.id)) ||
    input.chats.some((chat) => chat.id !== input.currentChatId && chat.unread > 0 && !chat.muted);
  const recent = pick(input.recent, othersPresent ? RECENT_WITH_OTHERS : RECENT_ALONE);
  const drafts = pick(
    input.chats.filter((chat) => input.draftChatIds.has(chat.id)).map((chat) => chat.id),
    OTHER_SECTION_LIMIT,
  );
  const unread = pick(
    input.chats.filter((chat) => chat.unread > 0 && !chat.muted).map((chat) => chat.id),
    OTHER_SECTION_LIMIT,
  );

  const sections: QuickSwitchSection[] = [];
  if (recent.length) sections.push({ id: "recent", title: "Недавние", chatIds: recent });
  if (drafts.length) sections.push({ id: "drafts", title: "Черновики", chatIds: drafts });
  if (unread.length) sections.push({ id: "unread", title: "Непрочитанные", chatIds: unread });
  return sections;
}

/** The rows the arrow keys walk, headers left out, as Discord's navigation skips them. */
export function quickSwitchOrder(sections: readonly QuickSwitchSection[]): string[] {
  return sections.flatMap((section) => section.chatIds);
}
