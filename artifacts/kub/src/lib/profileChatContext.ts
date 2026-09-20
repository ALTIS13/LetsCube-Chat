/**
 * What a person's card may say about the place it was opened from.
 *
 * ## Why a profile has a place at all
 *
 * Discord's profile hooks are not keyed on a person. They are keyed on
 * `(userId, guildId)` — module 999291 reads `(0,O.Ay)(userId, guildId)` out of
 * `UserProfileStore`, and module 207634's presentation table passes the same
 * pair into every one of them. That is why its popout and its modal can say
 * «this person's roles», in the colours of **that server**, without either of
 * them being a second implementation of a person: the roles are a fact about
 * the pair, not about the person.
 *
 * Ours had no pair, and the cost was measurable rather than theoretical. With
 * the overlay knowing no chat, the full card had nothing to say that the
 * summary did not, and the two surfaces rendered 446 px and 450 px tall — the
 * summary **taller than the thing it summarised**. Measured on 2026-09-21 at
 * 1440 against the fixture, before this module existed.
 *
 * ## The refusal that is kept, and now has a reason
 *
 * D-283 wrote that the overlay «does not guess a standing out of the private
 * conversation the two happen to share», and that stays — but as a rule rather
 * than as a consequence of knowing nothing. **A private conversation has no
 * standing to report.** Whoever opens one becomes its owner (which is what
 * `20260911120000_private_chat_owner_delete_repair.sql` was about), so
 * «Владелец» there is an artefact of who pressed first, not a fact about the
 * person. A group and a channel have real standings, and a join date that
 * answers a real question.
 *
 * ## Why this is a module
 *
 * The same reason `chatRowProfile.ts` and `messageAuthorProfile.ts` are: the
 * decision is «which facts may be shown», it has four branches that a browser
 * test would reach only by accident, and this project has already paid once
 * for a rule that lived inside a component.
 */

import type { Chat, ChatMember, Profile } from "../types/database.ts";

/** The part of a chat this module reads. */
export type ProfileContextChat = Pick<Chat, "id" | "type"> & {
  members?: (Pick<ChatMember, "user_id" | "role" | "joined_at"> & { profile?: Profile | null })[];
};

export interface ProfileChatContext {
  /** `"owner" | "admin" | "member"`, or null when nothing may be said. */
  standing: "owner" | "admin" | "member" | null;
  /** The ISO instant this person joined, or null. */
  joinedAt: string | null;
  /** Whether the place is one whose vocabulary is «канала» rather than «группы». */
  channel: boolean;
}

/** Nothing may be said — a private conversation, a chat we do not hold, a stranger. */
export const NO_PROFILE_CHAT_CONTEXT: ProfileChatContext = {
  standing: null,
  joinedAt: null,
  channel: false,
};

export function profileChatContext(
  chat: ProfileContextChat | null | undefined,
  userId: string | null | undefined,
): ProfileChatContext {
  if (!chat || !userId) return NO_PROFILE_CHAT_CONTEXT;
  // A private conversation's «owner» is whoever opened it. Reporting it would
  // be reporting an artefact of the schema as a fact about a person.
  if (chat.type !== "group" && chat.type !== "channel") return NO_PROFILE_CHAT_CONTEXT;
  const member = (chat.members ?? []).find((row) => row.user_id === userId);
  // Present in the place but not in the copy of it we hold. The chat is still
  // a group, so the vocabulary is known; the standing is not, and an absent
  // line is the honest answer rather than «Участник» by default.
  if (!member) return { ...NO_PROFILE_CHAT_CONTEXT, channel: chat.type === "channel" };
  const role = member.role;
  return {
    standing: role === "owner" || role === "admin" ? role : "member",
    joinedAt: member.joined_at ?? null,
    channel: chat.type === "channel",
  };
}

/**
 * Whether the full card has anything of its own to say here.
 *
 * The escalation is worth offering only when the surface it reaches is
 * actually larger. It always is — the whole bio and the uncapped strip, which
 * is what Discord's own «View Full Bio» (`YDiPq8`) escalates for — so this is
 * not a gate on the control; it is the thing a test asserts so that «the full
 * card says more» stays true rather than becoming a comment.
 */
export function profileContextHasStanding(context: ProfileChatContext): boolean {
  return context.standing !== null;
}
