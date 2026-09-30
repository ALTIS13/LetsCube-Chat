/**
 * What kind of conversation a row is (tracker item 47).
 *
 * The owner, 2026-09-20: «ботов много, людей тоже и групп очевидно не меньше,
 * получается что всё в кучу сваливается… у меня буквально перед глазами шум из
 * чатов». The kinds were first a capsule of pills over the list; since
 * 2026-09-30 they are system folders beside «Все» (`lib/systemFolders.ts`), at
 * a tester's request: «сделай просто как папки системные, и всё».
 *
 * Pure, so `node --test` decides every case.
 */

import { chatBotPartner, type ChatBotHost } from "./chatBots.ts";

export type ChatKind = "person" | "group" | "channel" | "bot";

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
