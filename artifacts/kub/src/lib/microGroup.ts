/**
 * The micro-group — «групповой чат» — tracker item 45 (2026-09-30).
 *
 * The owner's design: two people talking in a private chat add somebody, and a
 * small group exists; a crown on its creator is its only hierarchy; name and
 * picture are all it has to edit. The database is
 * `20260930150000_micro_groups.sql`. What the references settled, as read on
 * 2026-09-30 (`docs/operations/reference-clients.md` §27): Discord's cap of
 * ten and a new group made from a DM that stays as it was, both in its web
 * bundle; no bringing anybody in across a block in either direction,
 * Telegram's `USER_IS_BLOCKED` and `YOU_BLOCKED_USER`. Anybody adding and only
 * the crown removing is ours, the proposal's recommendation.
 *
 * Its database value is `dm_group`, deliberately not `group_chat`: a light
 * kind named by a suffix on the heavy `group` would be selected by any filter
 * that starts with «group».
 *
 * Pure, so `node --test` decides every case.
 */

import { selectRussianPluralForm } from "./messageMediaSections.ts";

export const MICRO_GROUP_TYPE = "dm_group";

/** Discord's group DM limit, read in its shipped bundle; the database holds it too. */
export const MICRO_GROUP_CAP = 10;

export function isMicroGroup(chat: { readonly type?: string | null } | null | undefined): boolean {
  return chat?.type === MICRO_GROUP_TYPE;
}

export interface MicroGroupMember {
  readonly user_id: string;
  readonly joined_at?: string | null;
  readonly role?: string | null;
  readonly profile?: { readonly full_name?: string | null; readonly username?: string | null } | null;
}

/** A person as the drawn name calls them: the first word of the name, else the handle. */
export function microGroupFirstName(profile: MicroGroupMember["profile"]): string {
  const first = (profile?.full_name ?? "").trim().split(/\s+/)[0] ?? "";
  if (first) return first;
  const handle = (profile?.username ?? "").trim();
  return handle ? `@${handle}` : "Участник";
}

/**
 * The name of a micro-group nobody has named, as one reader sees it: the
 * others' first names in the order they joined, three at most, then «и ещё N».
 * `micro_group_drawn_name` in the database draws the same one for a
 * notification. No name is stored until somebody gives one — the proposal's
 * answer 6.
 */
export function microGroupDrawnName(members: readonly MicroGroupMember[], viewerId: string | null): string {
  const others = members
    .filter((member) => member.user_id !== viewerId)
    .slice()
    .sort((a, b) => {
      const at = (a.joined_at ?? "").localeCompare(b.joined_at ?? "");
      return at !== 0 ? at : a.user_id.localeCompare(b.user_id);
    });
  if (others.length === 0) return "Групповой чат";
  const shown = others.slice(0, 3).map((member) => microGroupFirstName(member.profile)).join(", ");
  return others.length > 3 ? `${shown} и ещё ${others.length - 3}` : shown;
}

/** The one whose crown it is, or null while the list has not arrived. */
export function microGroupOwnerId(members: readonly MicroGroupMember[]): string | null {
  return members.find((member) => member.role === "owner")?.user_id ?? null;
}

/** How many more people fit. */
export function microGroupRoom(memberCount: number): number {
  return Math.max(0, MICRO_GROUP_CAP - memberCount);
}

/** «добавить ещё 1 человека», «2 человека», «5 человек». */
const PEOPLE_FORMS = ["человека", "человека", "человек"] as const;

/** «Можно добавить ещё 8 человек». */
export function microGroupRoomLabel(memberCount: number): string {
  const room = microGroupRoom(memberCount);
  if (room === 0) return `В групповом чате уже ${MICRO_GROUP_CAP} человек — больше нельзя.`;
  return `Можно добавить ещё ${room} ${selectRussianPluralForm(room, PEOPLE_FORMS)}`;
}

/** A refusal from the micro-group functions, as a sentence; never Postgres's words. */
export function microGroupErrorText(error: unknown, fallback: string): string {
  const message = typeof error === "object" && error && "message" in error
    ? String((error as { message: unknown }).message)
    : "";
  if (message.includes("micro_group_full")) return `В групповом чате может быть не больше ${MICRO_GROUP_CAP} человек.`;
  if (message.includes("micro_group_blocked_by_you")) return "Вы заблокировали одного из выбранных. Разблокируйте его, чтобы добавить.";
  // Nothing more specific: that somebody has blocked you is not yours to learn.
  if (message.includes("micro_group_unavailable")) return "Одного из выбранных нельзя добавить.";
  if (message.includes("micro_group_needs_partner")) return "Групповой чат создаётся из переписки с другим человеком.";
  if (message.includes("micro_group_not_member")) return "Вы больше не участник этого чата.";
  if (message.includes("micro_group_bad_name")) return "Название — не длиннее 64 символов.";
  if (message.includes("micro_group_not_found")) return "Этого группового чата больше нет.";
  return fallback;
}
