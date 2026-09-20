/**
 * The groups and channels two people are both in.
 *
 * ## Why this is the one list, out of Discord's five
 *
 * `docs/operations/reference-clients.md` §15.1 read the tabs off Discord's
 * profile modal — Board, Activity, Wishlist, N Mutual Friends, N Mutual Servers
 * — and recorded the rule they follow: **tabs are only for the things that are
 * lists.** Bio, roles and the note render in the body; there is no «user info»
 * tab at all.
 *
 * Four of the five presuppose objects this product has not decided to have: an
 * activity feed, a wishlist, linked external accounts and a friends graph. The
 * assessment refused them by name and kept exactly one as having an honest
 * analogue here — «Mutual Servers», which for us is the groups and channels in
 * common. This is that one.
 *
 * ## Why it costs nothing, and the boundary that comes with it
 *
 * It asks the server for nothing. `useChats` already selects
 * `members:chat_members(user_id, role, joined_at, …)` onto every chat the
 * signed-in account can read, so «which of my groups is this person also in» is
 * a filter over state the client is holding anyway — no query, no new policy,
 * no privacy surface that did not already exist. Nothing here can reveal a
 * group the reader is not in, because the list it filters **is** the reader's
 * own list.
 *
 * The boundary that follows from that, and which the caller must not overstate:
 * this is «общие группы **среди твоих**», and it is complete only in so far as
 * the sidebar's list is. It is not a count taken on the server, and it must
 * never be labelled as one.
 *
 * ## Why private conversations are not in it
 *
 * «A group in common» is a fact about a place several people share. A private
 * conversation between the reader and this person is not something they have in
 * common with anybody — it is the pair itself, and it is already one press away
 * on the card. Discord's own list is servers, not DMs.
 */

import type { Chat, ChatMember, Profile } from "../types/database.ts";

/** The part of a chat row this module reads. */
export type MutualChatRow = Pick<Chat, "id" | "name" | "type" | "avatar_url"> & {
  members?: (Pick<ChatMember, "user_id"> & { profile?: Profile | null })[];
};

/**
 * How many rows a card draws before it stops.
 *
 * Measured rather than chosen: at 390 the full card's sheet had **about 890 px
 * of empty ground** below «Открыть чат» on 2026-09-21, and a row of this shape
 * is 44 px with an 8 px gap, so five rows take 252 px — a section that is
 * clearly a section, on the narrowest release width, without turning a person's
 * card into a list of chats. The remainder is stated as «ещё N», never dropped
 * silently.
 */
export const PROFILE_MUTUAL_CHAT_LIMIT = 5;

export interface MutualChats {
  /** The rows to draw, in the order they were given. */
  shown: MutualChatRow[];
  /** How many more there are. */
  hidden: number;
  /** Every one of them, for a caller that needs the count. */
  total: number;
}

/**
 * The places both people are in, out of the chats the reader already holds.
 *
 * `chats` arrives in the sidebar's own order, which is by recent activity, so
 * the five that are drawn are the five that matter most right now — the same
 * reason the sidebar is sorted that way.
 */
export function profileMutualChats(
  chats: readonly MutualChatRow[],
  userId: string | null | undefined,
  currentUserId: string | null | undefined,
  limit: number = PROFILE_MUTUAL_CHAT_LIMIT,
): MutualChats {
  if (!userId || userId === currentUserId) return { shown: [], hidden: 0, total: 0 };
  const shared = chats.filter((chat) => {
    if (chat.type !== "group" && chat.type !== "channel") return false;
    return (chat.members ?? []).some((member) => member.user_id === userId);
  });
  const shown = shared.slice(0, Math.max(0, limit));
  return { shown, hidden: shared.length - shown.length, total: shared.length };
}
