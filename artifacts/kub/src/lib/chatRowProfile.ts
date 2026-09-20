/**
 * Whose profile a chat-list row opens — and whether it can open one at all.
 *
 * ## Why this is a module and not four lines in `ChatList`
 *
 * It was four lines in `ChatList`, and that is how D-283 happened. The entry
 * read `if (isPrivate) push({ label: "Открыть профиль", run: () =>
 * selectAndOpenPanel("info") })`, and `selectAndOpenPanel` selects the chat
 * first. Nothing could test it: the decision was a closure inside a component,
 * so the only instrument that could see it was a browser, and no browser test
 * asked the question the label was making a promise about.
 *
 * CLAUDE.md records the general form of this after the `isSupabaseConfigured`
 * work: a check that cannot be reached from a test is not a gap in the suite,
 * it is a gap in the module boundary. So the decision moved here, where
 * `node --test` runs it without React and without a browser, and the component
 * is left holding only the effect.
 *
 * ## The three answers, and why the third is not «offer it anyway»
 *
 *  - **a person** — a private conversation with somebody who is not you. The
 *    row's menu opens their card, and nothing else happens.
 *  - **yourself** — «Избранное». There is no second party, so there is nobody
 *    to open.
 *  - **nobody** — a group, a channel, and a **bot**.
 *
 * The bot is the interesting one, and it is a deliberate narrowing rather than
 * an oversight. A bot conversation is `type === "private"` in the database, so
 * the old predicate offered «Открыть профиль» on a bot row too — and there is
 * no person behind it: `other_user` is null, and `chatBotPartner` is what the
 * display name comes from. Routed to a person's card it would draw an empty
 * one. `docs/operations/reference-clients.md` §8 states the product's own rule
 * for this case — a control that cannot work is absent, not inert — and D-263
 * is the entry that owns giving a bot a card worth opening. Until it does, the
 * bot row keeps «Открыть», which is the thing anybody wants with a bot, and
 * the conversation's own header still opens the bot's information.
 */

import type { ChatMember, ChatWithLastMessage, Profile } from "@/types/database";
import { chatBotPartner } from "./chatBots.ts";
import { isSavedChat } from "./chatDisplay.ts";

/** The part of a chat row this module reads. */
export type ProfileTargetChat = Pick<
  ChatWithLastMessage,
  "id" | "name" | "type" | "description" | "created_by" | "members" | "other_user" | "bots"
>;

export type ChatRowProfileTarget =
  | { kind: "person"; userId: string }
  | { kind: "none"; reason: "saved" | "group" | "bot" | "unknown-person" };

/**
 * The other person in a private conversation, or `null`.
 *
 * Both places are read, and in this order, because both are really populated:
 * `useChats` projects `other_user` onto every private row, and the fixture and
 * the realtime patch paths carry `members` with a nested profile. Reading only
 * the first would leave the entry absent on a row that has the second — and an
 * entry that is absent for a reason nobody can see is worse than one that is
 * wrong for a reason everybody can.
 */
export function privateChatCounterpart(
  chat: ProfileTargetChat,
  currentUserId: string | null | undefined,
): Profile | null {
  if (chat.other_user) return chat.other_user;
  const members = (chat.members ?? []) as (ChatMember & { profile?: Profile | null })[];
  const other = members.find((member) => member.user_id && member.user_id !== currentUserId);
  return other?.profile ?? null;
}

export function chatRowProfileTarget(
  chat: ProfileTargetChat,
  currentUserId: string | null | undefined,
): ChatRowProfileTarget {
  if (isSavedChat(chat, currentUserId ?? null)) return { kind: "none", reason: "saved" };
  // Before the type check, exactly as `getChatDisplayInfo` orders it: a bot
  // conversation IS private, and the branch below looks for a person who is
  // not there.
  if (chatBotPartner(chat)) return { kind: "none", reason: "bot" };
  if (chat.type !== "private") return { kind: "none", reason: "group" };
  const other = privateChatCounterpart(chat, currentUserId);
  // A private row whose counterpart never arrived. It happens while the list
  // is still filling, and an entry that opens an empty card is the inert
  // control the material contract's rule 8 refuses.
  if (!other?.id) return { kind: "none", reason: "unknown-person" };
  if (other.id === currentUserId) return { kind: "none", reason: "saved" };
  return { kind: "person", userId: other.id };
}

/** Whether the row's menu carries «Открыть профиль». */
export function offersProfileEntry(
  chat: ProfileTargetChat,
  currentUserId: string | null | undefined,
): boolean {
  return chatRowProfileTarget(chat, currentUserId).kind === "person";
}
