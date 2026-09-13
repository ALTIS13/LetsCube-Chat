/**
 * What the product calls a group-like chat, and the people in it (D-169).
 *
 * The information card called every group-like chat a group: «Информация о
 * группе» over a channel, a «Участники» tab, «Покинуть группу», «Удалить
 * групповой чат». Three other surfaces had already learned the difference and
 * disagreed with it — the chat list's context menu says «Информация о канале»,
 * the conversation header says «N подписчиков», and the settings rows added on
 * 2026-09-13 say «Удалить канал» — so the same object was named two ways
 * depending on which surface you opened.
 *
 * **What actually differs, established from the code rather than assumed.**
 * `chats.type` allows `private`, `group` and `channel` (`schema.sql:53`), and
 * that is the whole of it:
 *
 * - Membership is one table. `chat_members` holds `owner | admin | member` for
 *   a channel exactly as for a group; there is no subscriber table and no
 *   subscriber role.
 * - Posting is one policy. «Chat members can send messages» has no type and no
 *   role condition, so a channel's members write into it like a group's.
 * - Every rule that names a channel names it beside a group and treats the two
 *   the same: the invite functions accept `type in ('group','channel')`, and so
 *   does the media-variant queue.
 * - Nothing in the product creates one. `NewGroupModal` inserts `type: "group"`
 *   and no other code path writes `channel` at all, so a channel exists only if
 *   somebody put one in the database by hand.
 *
 * So a channel is a group with another name, and the fix is the name. This
 * module is that name and nothing more: no capability is invented here, because
 * the product has none to invent.
 *
 * Free of React and of every browser API, so `node --test` reads it directly.
 */

import { selectRussianPluralForm } from "./messageMediaSections.ts";

export type ChatKind = "group" | "channel";

export interface ChatVocabulary {
  kind: ChatKind;
  /** «Группа», «Канал» — the thing itself, opening a sentence. */
  subject: string;
  /** «группу», «канал» — what you leave, delete or invite somebody into. */
  object: string;
  /** «группы», «канала» — «Настройки группы». */
  possessive: string;
  /** «группе», «канале» — «Информация о группе», «уже в канале». */
  locative: string;
  /** «Участники» / «Подписчики»: the tab, and the row on the settings screen. */
  membersTitle: string;
  /** The card's own title over the root layer. */
  infoTitle: string;
  /** The card's own title over the settings layer. */
  settingsTitle: string;
  leaveLabel: string;
  leaveTitle: string;
  leaveDescription: string;
  deleteLabel: string;
  deleteTitle: string;
  deleteDescription: string;
  /** The line inside the confirmation, under its heading. */
  deleteAftermath: string;
  /** What failed, for `prefixError` to put the server's reason after. */
  deleteError: string;
  /** The placeholder over the description box on the settings screen. */
  descriptionPlaceholder: string;
}

/**
 * The three counted forms of the noun for a person in this chat.
 *
 * A channel's are «подписчик / подписчика / подписчиков» — the word the
 * conversation header has used all along. They count the same rows: see the
 * module header.
 */
const MEMBER_FORMS: Record<ChatKind, readonly [string, string, string]> = {
  group: ["участник", "участника", "участников"],
  channel: ["подписчик", "подписчика", "подписчиков"],
};

/**
 * Which of the two this chat is.
 *
 * Anything that is not a channel is addressed as a group, because the card only
 * ever reaches this module for a chat it already decided is group-like — a
 * private conversation shows a person's profile and «Избранное» shows neither.
 */
export function chatKindOf(type: string | null | undefined): ChatKind {
  return type === "channel" ? "channel" : "group";
}

export function chatVocabulary(type: string | null | undefined): ChatVocabulary {
  const kind = chatKindOf(type);
  const channel = kind === "channel";
  const subject = channel ? "Канал" : "Группа";
  const object = channel ? "канал" : "группу";
  const possessive = channel ? "канала" : "группы";
  const locative = channel ? "канале" : "группе";
  const membersTitle = channel ? "Подписчики" : "Участники";
  // The genitive plural of the same noun, for the sentences that say whose
  // history stays behind.
  const others = MEMBER_FORMS[kind][2];

  return {
    kind,
    subject,
    object,
    possessive,
    locative,
    membersTitle,
    infoTitle: `Информация о ${locative}`,
    settingsTitle: `Настройки ${possessive}`,
    leaveLabel: `Покинуть ${object}`,
    leaveTitle: `Покинуть ${object}?`,
    leaveDescription: `${subject} исчезнет из вашего списка. История у других ${others} останется.`,
    // «Удалить групповой чат» on the card root against «Удалить группу» on the
    // settings screen was the same button named twice; they say one thing now.
    deleteLabel: `Удалить ${object}`,
    deleteTitle: `Удалить ${object}?`,
    deleteDescription: `Это действие нельзя отменить. Чат и история исчезнут у всех ${others}.`,
    deleteAftermath: `После удаления ${subject.toLocaleLowerCase("ru-RU")} исчезнет у всех ${others}.`,
    deleteError: `Не удалось удалить ${object}`,
    descriptionPlaceholder: channel ? "О чём этот канал" : "О чём эта группа",
  };
}

/**
 * «12 участников», «12 подписчиков», in the forms Russian actually takes.
 *
 * Separate from `chatDisplay.memberCountLabel`, which knows only the group's
 * noun and is what the conversation header and the chat list still use for one.
 */
export function countedMemberLabel(count: number, type: string | null | undefined): string {
  return `${count} ${selectRussianPluralForm(count, MEMBER_FORMS[chatKindOf(type)])}`;
}
