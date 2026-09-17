/**
 * Who the invite list offers, in what order, and in what state (D-170).
 *
 * The entry is «There is no way to invite anyone who is not already findable by
 * name», and the owner reported the same thing from the other end on
 * 2026-09-15: a group could not be created at all, because the invitee step
 * opened as a blank box with a disabled button. That half was fixed in
 * `NewGroupModal` — it opens with an unfiltered page of people now — and the
 * fix stopped there. `GroupInviteModal`, which is the surface you use *once you
 * have a group*, still opened as a blank box behind «Введите минимум 2 символа
 * для поиска пользователя.», so the second half of the same complaint was
 * untouched.
 *
 * **Why a blank box is the defect and not the search.** `Profiles are viewable
 * by everyone` is the live SELECT policy on `profiles`, so there was never a
 * reason to show nothing. And the one route that would let you reach a stranger
 * by something you actually know — `public.search_profiles_by_phone` — refuses
 * every caller without `users.view`, which on this deployment is four
 * administrative global roles and nobody else: an ordinary person has never
 * been able to find anybody by telephone number. So the people an ordinary
 * person can reach are the people they can recognise, and the list has to show
 * them rather than wait to be spelled at.
 *
 * Hence the order below: the people you already share a chat with come first.
 * That is the same mechanic Discord's invite dialog and Telegram's contact list
 * have, and it is the answer to «somebody you cannot find by name» — you rarely
 * know how a name is spelled, and you always recognise a face you talk to.
 *
 * Free of React and of every browser API, so `node --test` reads it directly.
 */

import type { GroupInviteStatus } from "./groupInvites.ts";

/** What the list knows about one person. A `Profile` satisfies it. */
export interface InvitePerson {
  id: string;
  full_name?: string | null;
  username?: string | null;
}

/** One row of the chat list, as much of it as this module reads. */
export interface KnownChatRow {
  members?: readonly { user_id?: string | null }[] | null;
  other_user?: { id?: string | null } | null;
}

/** What the button beside a person says, and whether it does anything. */
export type InviteCandidateState =
  | "self"
  | "member"
  | "pending"
  | "declined"
  | "cancelled"
  | "expired"
  /** Accepted once and no longer in the chat. */
  | "former"
  | "available";

/**
 * Everybody the signed-in person already shares a chat with.
 *
 * Taken from the chat list the store already holds — `chats` is selected with
 * `members:chat_members(…, profile:profiles(*))`, so this costs no request at
 * all. `other_user` is carried separately for a private conversation and is
 * read too, because a one-to-one chat is the strongest signal of the lot.
 */
export function peopleAlreadyInYourChats(
  chats: readonly KnownChatRow[] | null | undefined,
  myId: string | null | undefined,
): Set<string> {
  const known = new Set<string>();
  for (const chat of chats ?? []) {
    for (const member of chat.members ?? []) {
      if (member?.user_id && member.user_id !== myId) known.add(member.user_id);
    }
    const other = chat.other_user?.id;
    if (other && other !== myId) known.add(other);
  }
  return known;
}

/** What a person is shown as, given the chat's members and its invitations. */
export function inviteCandidateState(input: {
  personId: string;
  myId: string | null | undefined;
  memberIds: ReadonlySet<string>;
  /** The latest invitation per invitee, as the chat's `group_invites` hold it. */
  inviteStatuses: Readonly<Record<string, GroupInviteStatus | undefined>>;
  /** Invitations sent in this session, which the initial read cannot know. */
  sentIds: ReadonlySet<string>;
}): InviteCandidateState {
  if (input.personId === input.myId) return "self";
  if (input.memberIds.has(input.personId)) return "member";
  if (input.sentIds.has(input.personId)) return "pending";
  const status = input.inviteStatuses[input.personId];
  // Accepted, yet not a member: they joined and have since left, so they can be
  // asked again. «accepted» is never shown as itself for that reason.
  if (status === "accepted") return "former";
  if (status === "pending") return "pending";
  if (status === "declined") return "declined";
  if (status === "cancelled") return "cancelled";
  if (status === "expired") return "expired";
  return "available";
}

/** Whether pressing the row would send anything. */
export function canInviteCandidate(state: InviteCandidateState): boolean {
  return state !== "self" && state !== "member" && state !== "pending";
}

/**
 * Whether a person matches what was typed, decided on this side.
 *
 * The server answers the query; this filters the people the store already had,
 * so that typing narrows the whole list rather than only the fetched half.
 *
 * The «@» is stripped here as well as in the filter sent to the server, because
 * otherwise typing «@anna» would narrow the local half to nothing while the
 * server's half found her — one query, two answers.
 *
 * `toLocaleLowerCase("ru-RU")` is the repository's convention beside
 * `localeCompare("ru-RU")` above, not a fix for anything: JavaScript's plain
 * `toLowerCase` folds Cyrillic correctly, and no test here pretends otherwise.
 * It is `grep -i` that does not, which is a shell lesson and not this one.
 */
export function matchesInviteSearch(person: InvitePerson, term: string): boolean {
  const needle = term.trim().replace(/^@+/, "").toLocaleLowerCase("ru-RU");
  if (!needle) return true;
  const haystacks = [person.full_name ?? "", person.username ?? ""];
  return haystacks.some((value) => value.toLocaleLowerCase("ru-RU").includes(needle));
}

/** What the row shows as a name, in the order the rest of the product uses. */
export function inviteCandidateName(person: InvitePerson): string {
  const full = (person.full_name ?? "").trim();
  if (full) return full;
  const username = (person.username ?? "").trim();
  if (username) return `@${username}`;
  return "Без имени";
}

/**
 * The list, in the order it is shown.
 *
 * - The signed-in person is never in it. They are «self» to
 *   `inviteCandidateState`, and a row saying «Это вы» is a row that cannot be
 *   pressed occupying the top of a short list.
 * - People already in the chat are dropped while nothing is typed, and kept
 *   once something is. An unfiltered list is for finding somebody new, so the
 *   members are noise in it; a search for a particular person who turns out to
 *   be a member already must say so, or the search looks broken.
 * - People you share a chat with come first. Then name, then id: total and
 *   stable, so the list does not reorder under a finger already moving toward a
 *   row — the same reason D-206 ordered the member list by role rather than by
 *   presence.
 */
export function orderInviteCandidates<T extends InvitePerson>(input: {
  people: readonly T[];
  knownIds: ReadonlySet<string>;
  memberIds: ReadonlySet<string>;
  myId: string | null | undefined;
  /** Whether the person has typed something. */
  searching: boolean;
}): T[] {
  const seen = new Set<string>();
  const kept: T[] = [];
  for (const person of input.people) {
    if (!person?.id || seen.has(person.id)) continue;
    if (person.id === input.myId) continue;
    if (!input.searching && input.memberIds.has(person.id)) continue;
    seen.add(person.id);
    kept.push(person);
  }
  return kept.sort((left, right) => {
    const leftKnown = input.knownIds.has(left.id) ? 0 : 1;
    const rightKnown = input.knownIds.has(right.id) ? 0 : 1;
    if (leftKnown !== rightKnown) return leftKnown - rightKnown;
    const byName = inviteCandidateName(left).localeCompare(inviteCandidateName(right), "ru-RU", {
      sensitivity: "base",
    });
    if (byName !== 0) return byName;
    return left.id.localeCompare(right.id);
  });
}
