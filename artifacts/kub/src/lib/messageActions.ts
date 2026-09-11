import { selectRussianPluralForm } from "./messageMediaSections.ts";

/**
 * Which actions a message offers, and in what order — Telegram's menus, as the
 * owner described them on 2026-09-11 from Telegram for Android and for Windows.
 *
 * A pure function of what the message is and what the chat allows, so the
 * order of a menu is pinned by `node --test` rather than by reading JSX. The
 * components only draw what comes back.
 */

export type MessageActionId =
  | "reply"
  | "edit"
  | "editCaption"
  | "pin"
  | "unpin"
  | "copy"
  | "copyText"
  | "copyImage"
  | "saveAs"
  | "copyLink"
  | "forward"
  | "delete"
  | "select"
  | "details"
  | "retry"
  | "editFailed"
  | "discard";

export const MESSAGE_ACTION_LABELS: Readonly<Record<MessageActionId, string>> = Object.freeze({
  reply: "Ответить",
  edit: "Изменить",
  editCaption: "Изменить подпись",
  pin: "Закрепить",
  unpin: "Открепить",
  copy: "Копировать",
  copyText: "Копировать текст",
  copyImage: "Копировать изображение",
  saveAs: "Сохранить как…",
  copyLink: "Копировать ссылку",
  forward: "Переслать",
  delete: "Удалить",
  select: "Выделить",
  details: "Детали",
  retry: "Повторить",
  editFailed: "Изменить",
  discard: "Удалить",
});

export type MessageActionKind = "text" | "photo" | "video" | "voice" | "file";

export interface MessageActionContext {
  kind: MessageActionKind;
  /** Written by the person reading, as a person — a bot's message is never "own". */
  own: boolean;
  /** Not on the server yet: optimistic, being checked, or failed. */
  localSend: boolean;
  failed: boolean;
  pinned: boolean;
  /** There is text to copy: the message's own, or a caption a person can see. */
  hasText: boolean;
  /**
   * A caption that can be edited without breaking the message. A voice note and
   * a round video keep their duration in the content, so editing it would
   * corrupt what the player reads.
   */
  captionEditable: boolean;
  can: {
    reply: boolean;
    edit: boolean;
    pin: boolean;
    forward: boolean;
    delete: boolean;
    select: boolean;
    retry: boolean;
    editFailed: boolean;
    discard: boolean;
  };
}

/** What a message is, for the menu: the shape of its content, not its storage type. */
export function messageActionKind(message: {
  type: string;
  media_url?: string | null;
  content?: string | null;
}): MessageActionKind {
  if (message.type === "image" && message.media_url) return "photo";
  if (message.type === "video" && message.media_url) return "video";
  if (message.type === "audio" && message.media_url) return "voice";
  if (message.type === "file" && message.media_url) return "file";
  return "text";
}

function localSendActions(ctx: MessageActionContext, copy: MessageActionId): MessageActionId[] {
  const actions: MessageActionId[] = [];
  if (ctx.failed && ctx.can.retry) actions.push("retry");
  if (ctx.failed && ctx.kind === "text" && ctx.can.editFailed) actions.push("editFailed");
  if (ctx.hasText) actions.push(copy);
  if (ctx.can.discard) actions.push("discard");
  return actions;
}

/**
 * The right-click menu, top to bottom.
 *
 * - text: Ответить, Изменить (own), Закрепить, Копировать текст, Копировать
 *   ссылку, Переслать, Удалить, Выделить;
 * - photo: Ответить, Изменить подпись (own), Закрепить, Сохранить как…,
 *   Копировать изображение, Копировать ссылку, Переслать, Удалить, Выделить;
 * - file, voice or video: Сохранить как… instead of Копировать изображение.
 */
export function desktopMessageActions(ctx: MessageActionContext): MessageActionId[] {
  if (ctx.localSend) return localSendActions(ctx, "copyText");
  const actions: MessageActionId[] = [];
  if (ctx.can.reply) actions.push("reply");
  if (ctx.own && ctx.can.edit) {
    if (ctx.kind === "text") actions.push("edit");
    else if (ctx.captionEditable) actions.push("editCaption");
  }
  if (ctx.can.pin) actions.push(ctx.pinned ? "unpin" : "pin");
  if (ctx.kind === "text") {
    if (ctx.hasText) actions.push("copyText");
  } else {
    actions.push("saveAs");
    if (ctx.kind === "photo") actions.push("copyImage");
  }
  actions.push("copyLink");
  if (ctx.can.forward) actions.push("forward");
  if (ctx.can.delete) actions.push("delete");
  if (ctx.can.select) actions.push("select");
  return actions;
}

/**
 * The card under a tapped message on a phone: a list, and a row of icons under
 * it. Telegram for Android draws exactly this — «Копировать ссылку», «Переслать»,
 * «Закрепить», «Детали ›», then Ответить, Копировать, Изменить and Удалить.
 */
export function phoneMessageActions(ctx: MessageActionContext): {
  list: MessageActionId[];
  row: MessageActionId[];
} {
  if (ctx.localSend) return { list: [], row: localSendActions(ctx, "copy") };
  const list: MessageActionId[] = ["copyLink"];
  if (ctx.can.forward) list.push("forward");
  if (ctx.can.pin) list.push(ctx.pinned ? "unpin" : "pin");
  list.push("details");

  const row: MessageActionId[] = [];
  if (ctx.can.reply) row.push("reply");
  if (ctx.kind === "photo" || ctx.hasText) row.push("copy");
  if (ctx.own && ctx.can.edit && (ctx.kind === "text" || ctx.captionEditable)) row.push("edit");
  if (ctx.can.delete) row.push("delete");
  return { list, row };
}

const MESSAGES: readonly [string, string, string] = ["сообщение", "сообщения", "сообщений"];

/** «Удалить сообщение?» for one, «Удалить 2 сообщения?» for several. */
export function deleteDialogTitle(count: number): string {
  if (count <= 1) return "Удалить сообщение?";
  return `Удалить ${count} ${selectRussianPluralForm(count, MESSAGES)}?`;
}

/**
 * The one choice the delete dialog offers, or null when there is none.
 *
 * Only messages that are all the reader's own can be removed for others: a
 * private chat names the other person, a group says «у всех». Someone else's
 * message is deleted for the reader only, and so is anything in Saved Messages,
 * where nobody else could see it.
 */
export function deleteDialogOption(input: {
  count: number;
  allOwn: boolean;
  chatType: string | null | undefined;
  isSavedChat: boolean;
  otherName: string | null | undefined;
}): string | null {
  if (input.count < 1 || !input.allOwn || input.isSavedChat) return null;
  if (input.chatType === "private") {
    const name = input.otherName?.trim();
    return `Также удалить для ${name || "собеседника"}`;
  }
  return "Удалить у всех";
}

/** «Переслать сообщение», «Переслать 2 сообщения», «Переслать 5 сообщений». */
export function forwardDraftTitle(count: number): string {
  if (count <= 1) return "Переслать сообщение";
  return `Переслать ${count} ${selectRussianPluralForm(count, MESSAGES)}`;
}

/** «Выделено: 3». */
export function selectionCountLabel(count: number): string {
  return `Выделено: ${count}`;
}
