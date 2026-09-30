/**
 * Messages from somebody the reader blocked, folded away in a group
 * conversation — the group chat's place in the block system (tracker item 45;
 * the owner, 2026-09-30: «Микро-группы должны входить в общую систему блока
 * пользователя»).
 *
 * Discord's shape, read in its web bundle on 2026-09-30
 * (`docs/operations/reference-clients.md` §27): consecutive messages whose
 * author is blocked become one collapsed item (`MESSAGE_GROUP_BLOCKED`) that
 * says how many there are and offers to show them; the reader can open it; a
 * group holding the target of a jump opens by itself; system messages are
 * never folded (`NON_COLLAPSIBLE`).
 *
 * Ours in two places, each with its reason. A run does not cross a day, so
 * the date stays where the reader looks for it. And the first unread message
 * is the first one from somebody not blocked — the entry lands on something
 * the reader chose to see, where Discord keeps its unread divider above the
 * folded group.
 *
 * Only a conversation of several people folds: in a private chat a blocked
 * person cannot write, and what they wrote before is the conversation itself.
 *
 * Pure, so `node --test` decides every case (`tests/unit/blocked-runs.test.mts`).
 */

import { selectRussianPluralForm, type RussianPluralForms } from "./messageMediaSections.ts";

export interface FoldableMessage {
  readonly id: string;
  readonly user_id?: string | null;
  readonly bot_id?: string | null;
  readonly type?: string | null;
}

/** The kinds of conversation that fold a blocked person's messages. */
export function chatFoldsBlockedMessages(chatType: string | null | undefined, isSaved = false): boolean {
  if (isSaved) return false;
  return chatType === "group" || chatType === "dm_group" || chatType === "channel";
}

/** Whether one message is a blocked person's. A system line and a bot never are. */
export function isBlockedAuthorMessage(message: FoldableMessage, blocked: ReadonlySet<string>): boolean {
  if (message.type === "system" || message.bot_id) return false;
  return Boolean(message.user_id && blocked.has(message.user_id));
}

export type FoldItem<G> =
  | { readonly kind: "open"; readonly group: G }
  | {
      readonly kind: "blocked";
      /** Stable across renders: the first message's id. */
      readonly key: string;
      readonly groups: readonly G[];
      readonly messageIds: readonly string[];
    };

/**
 * The list's groups, with each run of blocked groups folded into one item.
 *
 * `startsDay` breaks a run: the date separator belongs to the day's first
 * message, and a run that swallowed it would hide the date.
 */
export function foldBlockedRuns<G>(input: {
  readonly groups: readonly G[];
  readonly messagesOf: (group: G) => readonly FoldableMessage[];
  readonly blocked: ReadonlySet<string>;
  readonly startsDay: (group: G) => boolean;
}): FoldItem<G>[] {
  const out: FoldItem<G>[] = [];
  if (input.blocked.size === 0) {
    for (const group of input.groups) out.push({ kind: "open", group });
    return out;
  }
  let run: { groups: G[]; ids: string[] } | null = null;
  const close = () => {
    if (!run) return;
    out.push({ kind: "blocked", key: run.ids[0], groups: run.groups, messageIds: run.ids });
    run = null;
  };
  for (const group of input.groups) {
    const messages = input.messagesOf(group);
    const folded = messages.length > 0 && messages.every((message) => isBlockedAuthorMessage(message, input.blocked));
    if (!folded) {
      close();
      out.push({ kind: "open", group });
      continue;
    }
    if (run && input.startsDay(group)) close();
    if (!run) run = { groups: [], ids: [] };
    run.groups.push(group);
    for (const message of messages) run.ids.push(message.id);
  }
  close();
  return out;
}

const BLOCKED_FORMS: RussianPluralForms = [
  "заблокированное сообщение",
  "заблокированных сообщения",
  "заблокированных сообщений",
];

/**
 * «2 заблокированных сообщения» — Discord's own phrase, «N blocked messages»,
 * which does not name who: the reader knows whom they blocked. Short enough to
 * sit beside «Показать» on one line at a phone's width, which «2 сообщения от
 * заблокированного пользователя» was not (photographed at 390, twice).
 */
export function blockedRunLabel(count: number): string {
  const safe = Math.max(0, Math.floor(count));
  return `${safe} ${selectRussianPluralForm(safe, BLOCKED_FORMS)}`;
}

/** Whether a run opens by itself: it holds the target of a jump. */
export function blockedRunHoldsTarget(messageIds: readonly string[], targetId: string | null | undefined): boolean {
  return Boolean(targetId && messageIds.includes(targetId));
}
