/**
 * What the invitations block says, and what it offers, per invitation (D-172).
 *
 * The block used to explain itself. Under «ПРИГЛАШЕНИЯ» stood the sentence
 * «Статусы обновляются без перезагрузки панели.» — a note about how the code
 * works — beside a manual «Обновить» button that contradicted it. Neither
 * belonged to the person reading. The empty state named the filter rather than
 * the world: «Активных или отклонённых приглашений пока нет.» And the state a
 * migration leaves behind announced the database: «Приглашения требуют
 * обновления базы данных.»
 *
 * Everything here answers one question instead: what is true for the person
 * looking at this list. Every state the block really has is kept — waiting,
 * joined, left again, refused, withdrawn, lapsed, and unavailable — because a
 * state dropped to make the copy tidy is a state that still happens and is now
 * unexplained.
 *
 * The chips also stopped guessing at gender. «Отказался» and «Принял» are past
 * tenses that agree with the invitee, so half of them were wrong about half the
 * people; the words below agree with the invitation, which has none.
 *
 * Free of React and of every browser API, so `node --test` reads it directly.
 */

import type { ChatInviteDenial } from "./chatInviteAccess.ts";
import { chatVocabulary } from "./chatVocabulary.ts";
import type { GroupInviteStatus } from "./groupInvites.ts";
import type { InviteCandidateState } from "./inviteCandidates.ts";
import { selectRussianPluralForm } from "./messageMediaSections.ts";

/**
 * How the chip is coloured. A name rather than a class, so the decision is
 * testable here and the palette stays in the component that paints it.
 */
export type InviteTone = "waiting" | "joined" | "refused" | "gone";

export interface InviteState {
  /** What the chip says. */
  label: string;
  tone: InviteTone;
  /** Whether this invitation can still be withdrawn. */
  canCancel: boolean;
  /** Whether this person can be asked again. */
  canInviteAgain: boolean;
}

export interface InviteStateInput {
  status: GroupInviteStatus;
  /** Whether the invitee is in the chat right now. */
  isMember: boolean;
  /** The chat's `type`, so a channel's invitations speak of a channel. */
  type: string | null | undefined;
}

/**
 * One invitation, as the person managing it sees it.
 *
 * The two actions used to be computed inline in the panel. They are the same
 * two rules as before — only a waiting invitation can be withdrawn, and only
 * somebody who is not in the chat can be asked again — written where they can
 * be read without a browser.
 */
export function inviteState({ status, isMember, type }: InviteStateInput): InviteState {
  const words = chatVocabulary(type);

  if (status === "pending") {
    return { label: "Ждёт ответа", tone: "waiting", canCancel: true, canInviteAgain: false };
  }
  if (status === "accepted") {
    return isMember
      ? { label: `В ${words.locative}`, tone: "joined", canCancel: false, canInviteAgain: false }
      : { label: `Уже не в ${words.locative}`, tone: "gone", canCancel: false, canInviteAgain: true };
  }
  if (status === "declined") {
    return { label: "Отклонено", tone: "refused", canCancel: false, canInviteAgain: true };
  }
  if (status === "cancelled") {
    return { label: "Отменено", tone: "gone", canCancel: false, canInviteAgain: true };
  }
  return { label: "Истекло", tone: "gone", canCancel: false, canInviteAgain: true };
}

/**
 * The line under the heading: how many people have not answered yet.
 *
 * `null` when nobody is waiting, because a line saying so beside a list that
 * shows it is a second place to read the same thing. This is what replaced the
 * sentence about panel reloads: a number the person can act on, in place of a
 * note about the code.
 */
export function invitesWaitingLine(pending: number): string | null {
  if (pending <= 0) return null;
  const noun = selectRussianPluralForm(pending, ["приглашение", "приглашения", "приглашений"]);
  const verb = selectRussianPluralForm(pending, ["ждёт", "ждут", "ждут"]);
  return `${pending} ${noun} ${verb} ответа`;
}

export interface InviteEmptyInput {
  /** Every invitation the chat has, including the ones the list hides. */
  total: number;
  /** How many the list actually draws. */
  visible: number;
  /** Whether the list could not be read at all. */
  failed: boolean;
  type: string | null | undefined;
}

/**
 * Why the list is empty, which is three different facts and one non-fact.
 *
 * An accepted invitation from somebody who is in the chat is hidden, so «пока
 * нет приглашений» was said to people who had invited five and seen all five
 * arrive. The two cases are told apart and named.
 *
 * The non-fact was found in the rendered pixels rather than argued: with the
 * table missing, the block drew its unavailable banner and, directly under it,
 * «никого не приглашали» — which it cannot know, because it read nothing. A
 * list that failed to load is not an empty list, and saying so is the same
 * defect this entry is about, pointing the other way.
 */
export function invitesEmptyText({ total, visible, failed, type }: InviteEmptyInput): string {
  if (failed) return "";
  const words = chatVocabulary(type);
  if (visible > 0) return "";
  if (total > 0) return `Все приглашённые уже в ${words.locative}.`;
  return `В ${words.object} ещё никого не приглашали.`;
}

/**
 * Why the invite screen offers nothing (D-165).
 *
 * One sentence per branch of `group_invite_create`'s refusal, named after the
 * error it would raise. The screen used to have no such sentence at all: an
 * unrecognised `invite_policy` removed an ordinary member's invite button and
 * said nothing, which is the half of D-165 the earlier pass left open. The
 * other half of saying nothing was the blanket «Недоступно» stamped on every
 * button when any read failed, which named neither the cause nor the remedy.
 */
export function inviteDenialText(denial: ChatInviteDenial, type: string | null | undefined): string {
  const words = chatVocabulary(type);
  if (denial === "not_group_chat") return "Приглашения есть только у групп и каналов.";
  if (denial === "member_required") return `Приглашать может только тот, кто сам в ${words.locative}.`;
  return `В ${words.locative} приглашают только владелец и администраторы.`;
}

/**
 * The note for a policy the client could not read.
 *
 * It replaces a silent refusal, and it deliberately does not claim to know the
 * answer: the column is read by the function itself, so the invitation is
 * offered and the server judges it. Saying «только администраторы» here would
 * be the card asserting a policy it never read, which is D-165's part 1 over
 * again on a second surface.
 */
export function invitePolicyUnreadNote(type: string | null | undefined): string {
  const words = chatVocabulary(type);
  return `Не удалось прочитать, кому разрешено приглашать в ${words.object}. Приглашение можно отправить — ответит сервер.`;
}

/** What the button beside one person says. */
export function inviteCandidateButtonLabel(state: InviteCandidateState): string {
  if (state === "self") return "Это вы";
  if (state === "member") return "Уже здесь";
  if (state === "pending") return "Ждёт ответа";
  if (state === "former" || state === "declined" || state === "cancelled" || state === "expired") {
    return "Пригласить снова";
  }
  return "Пригласить";
}

/**
 * The two headings over the unfiltered list.
 *
 * They exist to make the order legible: people you already share a chat with
 * are first, and a list whose order nobody can explain reads as no order at
 * all. While something is typed there are no headings, because a search result
 * is one answer to one question.
 */
export const INVITE_KNOWN_HEADING = "Вы уже общаетесь";
export const INVITE_OTHERS_HEADING = "Остальные";

/**
 * Nothing matched, with what was looked for quoted back.
 *
 * «Пользователи не найдены.» could not be told apart from a search that never
 * ran, which is the state the old two-character gate left the screen in for
 * every single-letter query.
 */
export function inviteSearchEmptyText(term: string): string {
  const trimmed = term.trim();
  if (!trimmed) return "Пока некого приглашать.";
  return `По запросу «${trimmed}» никого не нашли.`;
}
