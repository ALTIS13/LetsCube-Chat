/**
 * Who a group's people are, in what order they stand, and what a row says about
 * each of them. (D-168)
 *
 * The entry's complaint was that a member row «carries nothing at all» — no
 * username, no last seen, no join date — and that the list has no order. Both
 * are decisions rather than markup, so they live here, where `node --test` can
 * execute them without React, without the `@/` alias and without a browser.
 * `chatMemberRules.ts` beside this one is the same shape for the same reason.
 *
 * Everything this module needs is already on the wire. `ChatInfoPanel`'s member
 * query asks for `profiles(*)`, so `username` and `online_at` arrive on every
 * row today and are thrown away; `chat_members.joined_at` is `not null` in
 * production and was simply never selected. Nothing here needs a migration,
 * which is why D-168 could be answered and D-166 beside it could not.
 *
 * ## The order, and why it is this one
 *
 * The brief offered two references: Discord sorts by role then name, Telegram by
 * presence then name. **This takes Discord's**, and the reason is measurable
 * rather than aesthetic.
 *
 *  - *This list is already about roles.* It draws a crown and a shield on the
 *    name line, puts «Владелец группы» on the second, and the information tab
 *    beside it counts administrators as their own figure. An order by role is
 *    the order the surface already claims to have.
 *  - *Presence-first would reorder under the reader.* `useHeartbeat` writes
 *    `profiles.online_at` every 60 seconds, `lib/profileChange.ts` carries
 *    `online_at` among the fields a realtime profile update delivers, and the
 *    panel re-reads its members on every `chat_members` change. A list sorted by
 *    presence moves while a finger is travelling toward a row — a worse defect
 *    than the one being fixed, and one that cannot be tested away.
 *  - *Role order is total and stable.* Three buckets, then name, then id: the
 *    same input always gives the same list. Presence order gives a different
 *    list every minute from unchanged data.
 *
 * Names are compared with `localeCompare("ru-RU", { sensitivity: "base" })`
 * rather than by lowercasing and comparing. Case folding by hand does not fold
 * Cyrillic reliably, and «ё» against «е» is exactly the pair a member list of
 * Russian names will contain.
 *
 * A person with no name at all sorts last inside their bucket. They are the row
 * a reader can say least about, and putting them first would be the one
 * position that guarantees nobody is looking for them there.
 *
 * ## What a row says
 *
 * At most two facts, plus whatever `badgeStrip` already puts beside them:
 *
 *  - the chat's own role when there is one, otherwise `@username`;
 *  - the presence sentence, when presence can be read at all.
 *
 * Two and not three, and that was measured rather than preferred: `d424f96`
 * photographed this row at 390 points and found a member wearing a standing and
 * two medals wrapping onto a third line, the four-person list growing from 223
 * to 331 points. «Администратор группы · @konstantin · был(а) 12 мин назад» is
 * longer than either of those strips. The join date belongs on the person's own
 * card for the same reason: a row is scanned, a card is read.
 *
 * **The row is never empty.** That is the whole of the entry's third sentence.
 * Someone with no chat role, no username and no readable presence still gets
 * «Без имени пользователя» — the wording this very panel already uses for a
 * private chat's other person, so one product does not have two spellings of
 * one absence.
 *
 * ## Presence that cannot be read is not presence that is off
 *
 * `usePrivacyPreferences` writes `profiles.online_at = null` when a person turns
 * the setting off, and a profile that has never been seen is also null. Neither
 * means «не в сети», so neither is said: an unreadable presence produces no
 * sentence and no dot. Claiming someone is offline because we were not allowed
 * to look is the same mistake D-140 and D-193 record on the other side — an
 * answer nobody could get rendered as an answer.
 *
 * The presence *sentence* is not computed here. `lib/presence.ts` owns the
 * threshold and the wording, and a second copy of a threshold drifts until the
 * dot and the words disagree on one row — which is the defect `chatMemberRules`
 * opens by naming. The caller reads it there and hands the answer in.
 */

import { plainFailure } from "./plainMessages.ts";

export type ChatMemberListRole = "owner" | "admin" | "member";

/** The part of a member row this module decides anything about. */
export interface ChatMemberListEntry {
  id: string;
  full_name?: string | null;
  username?: string | null;
  chat_role: ChatMemberListRole;
}

/** What `getUserPresenceState` answered, or null when nothing could be read. */
export interface ChatMemberPresence {
  isOnline: boolean;
  /** «в сети», «был(а) 12 мин назад» — empty when presence is unknown. */
  label: string;
}

/**
 * Sentences.
 *
 * `MEMBERS_UNAVAILABLE` and `MEMBERS_EMPTY` are the two different facts D-140
 * and D-193 require a surface to tell apart. Before this change `loadMembers`
 * destructured `{ data }` and dropped `error` on the floor, so a refused read
 * and a group with nobody in it drew the same nothing.
 */
export const MEMBERS_UNAVAILABLE = "Не удалось загрузить участников.";
export const MEMBERS_UNAVAILABLE_DETAIL = "Список мог остаться неполным. Попробуйте ещё раз.";
export const MEMBERS_EMPTY = "В этой группе пока никого нет.";
export const MEMBER_NO_USERNAME = "Без имени пользователя";
export const MEMBER_UNNAMED = "Без имени";
export const MEMBER_JOINED_UNKNOWN = "Дата входа неизвестна";

/** Every sentence here, for the test that none of them explains the machine. */
export const MEMBER_LIST_MESSAGES: readonly string[] = [
  MEMBERS_UNAVAILABLE,
  MEMBERS_UNAVAILABLE_DETAIL,
  MEMBERS_EMPTY,
  MEMBER_NO_USERNAME,
  MEMBER_UNNAMED,
  MEMBER_JOINED_UNKNOWN,
];

/**
 * What the panel prints when the member read failed.
 *
 * Routed through `plainFailure` for the same reason `useCreateChat` routes its
 * own: `mapPgError` may hand back a Postgres constraint name or the server's
 * English, and this surface's only language is Russian.
 */
export function memberListFailure(mapped: string | null | undefined): string {
  return plainFailure(mapped, MEMBERS_UNAVAILABLE);
}

/** Owner first, then administrators, then everybody else. */
const ROLE_RANK: Record<ChatMemberListRole, number> = { owner: 0, admin: 1, member: 2 };

/** The name a person is sorted and listed under. */
export function memberDisplayName(member: ChatMemberListEntry): string {
  const full = member.full_name?.trim();
  if (full) return full;
  const username = member.username?.trim();
  if (username) return username;
  return MEMBER_UNNAMED;
}

/** Whether this person has a name of their own, as against a placeholder. */
function hasOwnName(member: ChatMemberListEntry): boolean {
  return Boolean(member.full_name?.trim() || member.username?.trim());
}

/**
 * The order of two rows: role, then name, then id.
 *
 * The id tiebreak is not decoration. Two people may share a display name, and
 * without it their relative order would depend on what the database happened to
 * return — which is the «no order» the entry records, surviving in miniature.
 */
export function compareChatMembers(a: ChatMemberListEntry, b: ChatMemberListEntry): number {
  const byRole = ROLE_RANK[a.chat_role] - ROLE_RANK[b.chat_role];
  if (byRole !== 0) return byRole;

  const aNamed = hasOwnName(a);
  const bNamed = hasOwnName(b);
  if (aNamed !== bNamed) return aNamed ? -1 : 1;

  const byName = memberDisplayName(a).localeCompare(memberDisplayName(b), "ru-RU", {
    sensitivity: "base",
  });
  if (byName !== 0) return byName;

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The list in that order. A copy: the caller's array is left alone. */
export function sortChatMembers<T extends ChatMemberListEntry>(rows: readonly T[]): T[] {
  return [...rows].sort(compareChatMembers);
}

/** What one row shows, beside the avatar and whatever badges the person wears. */
export interface ChatMemberRowFacts {
  /** The name on the first line. Never empty. */
  name: string;
  /** The second line, already joined. Never empty. */
  secondary: string;
  /** Whether the avatar draws its presence dot. */
  showOnlineDot: boolean;
}

/**
 * The two facts a row carries, and the dot.
 *
 * `roleLabel` comes from `chatRoleLabel` in `chatMemberRules.ts` — scoped to
 * this chat («Владелец группы»), because a badge chip beside it may say
 * «Владелец» about LETSCUBE itself (D-180).
 *
 * **`tagLabel` takes its place when the group has a word of its own** (D-215).
 * That is Telegram's mechanic read literally: an administrator carrying a
 * custom title reads as that title rather than as «админ», because the group
 * chose the word and the word is more informative than the tier. It replaces
 * rather than joins — «Наставник · Администратор группы · был(а) недавно» is
 * three facts on a 280px line and neither reference shows it.
 *
 * **What it does not replace is the glyph's accessible name.** The crown and
 * the shield on the line above are still named «Владелец группы» and
 * «Администратор группы» by `roleLabel`, so a screen reader is still told who
 * can do what even when the visible word is the group's. Losing that was the
 * first thing this change nearly did: passing the tag in as `roleLabel` is one
 * line shorter and renames the glyph with it.
 */
export function chatMemberRowFacts({
  member,
  roleLabel,
  tagLabel,
  presence,
}: {
  member: ChatMemberListEntry;
  roleLabel: string;
  /** The group's own word for this person, if it has one. */
  tagLabel?: string | null;
  presence: ChatMemberPresence | null;
}): ChatMemberRowFacts {
  const tag = tagLabel?.trim() ?? "";
  const role = tag || roleLabel.trim();
  const handle = member.username?.trim() ? formatUsername(member.username) : "";
  const presenceLabel = presence?.label.trim() ?? "";
  // «Без имени пользователя» is the last resort, not the identity slot. Saying
  // it beside a presence — «Без имени пользователя · был(а) недавно» — tells the
  // reader what somebody does not have, which is neither a fact about the
  // person nor anything Telegram or Discord puts in that line. It appears only
  // when the row would otherwise be empty, which is what the note above the
  // module has always said it was for.
  const parts = [role || handle, presenceLabel].filter((part) => part !== "");
  return {
    name: memberDisplayName(member),
    secondary: parts.length > 0 ? parts.join(" · ") : MEMBER_NO_USERNAME,
    showOnlineDot: presence?.isOnline === true,
  };
}

/** `@name`, or the panel's own wording for somebody who has none. */
export function formatUsername(username: string | null | undefined): string {
  const trimmed = username?.trim();
  return trimmed ? `@${trimmed}` : MEMBER_NO_USERNAME;
}

/**
 * «в группе с 5 мая 2026», or the honest refusal.
 *
 * On the person's card rather than in the row — see the note above. The month
 * is spelled out because «05.09» and «09.05» are the same six characters in two
 * conventions and a join date is read once, not scanned.
 */
export function formatJoinedAt(
  joinedAt: string | null | undefined,
  locale = "ru-RU",
): string {
  if (!joinedAt) return MEMBER_JOINED_UNKNOWN;
  const when = new Date(joinedAt);
  const ms = when.getTime();
  if (!Number.isFinite(ms)) return MEMBER_JOINED_UNKNOWN;
  const date = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(when);
  return `В группе с ${date}`;
}
