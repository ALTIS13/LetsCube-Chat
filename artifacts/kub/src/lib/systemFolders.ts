/**
 * The system folders (tracker items 47 and 69): «Личные», «Группы», «Каналы»
 * and «Боты» beside «Все», each the conversations of one kind.
 *
 * A tester, 2026-09-28, after the kind capsule had already left his own
 * folders: «у меня не перестает гореть от этого фильтра… убери, пожалуйста…
 * сделай просто как папки системные, и всё» — and earlier the same day: «это
 * делается просто наличием трех базовых папок "группы" "все" "личное"…
 * условно системные папки, без доп фильтра этого». Item 47's first proposal,
 * the owner's, was the same: three folders from the start; the capsule was his
 * second.
 *
 * Telegram's shape, bettered in two places. Its «Recommended Folders» are
 * folders with «Chat types» rules — Contacts, Non Contacts, Groups, Channels,
 * Bots — offered in the folder settings and added with one tap (`DrKLO/
 * Telegram`, `strings.xml`, read 2026-09-28, item 69). Here they are there from
 * the start, because the owner's complaint about Telegram is exactly that the
 * separation exists there but is opt-in; and a kind's folder appears only while
 * a conversation of that kind does, so nobody is shown an empty «Каналы».
 *
 * They are rules, not lists: a group made tomorrow is in «Группы» without
 * anybody putting it there. That is why they are computed here rather than
 * stored as `folders` rows, whose chats are a fixed list — item 69's reason for
 * not building a «Группы» folder as one.
 *
 * The capsule is gone with them: one mechanism for one separation.
 *
 * Pure, so `node --test` decides every case.
 */

import { chatKind, type ChatKind, type ChatKindSubject } from "./chatKind.ts";

export type SystemFolderId = `system:${ChatKind}`;

export interface SystemFolder {
  readonly id: SystemFolderId;
  readonly kind: ChatKind;
  readonly name: string;
}

/** In the order the list is usually read: people first. */
export const SYSTEM_FOLDERS: readonly SystemFolder[] = [
  { id: "system:person", kind: "person", name: "Личные" },
  { id: "system:group", kind: "group", name: "Группы" },
  { id: "system:channel", kind: "channel", name: "Каналы" },
  { id: "system:bot", kind: "bot", name: "Боты" },
];

export function isSystemFolderId(id: string | null | undefined): id is SystemFolderId {
  return typeof id === "string" && SYSTEM_FOLDERS.some((folder) => folder.id === id);
}

export function systemFolderKind(id: string | null | undefined): ChatKind | null {
  return SYSTEM_FOLDERS.find((folder) => folder.id === id)?.kind ?? null;
}

/**
 * The system folders worth showing: one for every kind present, and none at all
 * when the list holds one kind or nothing — a «Личные» beside «Все» holding
 * the same chats would be a second name for one list.
 *
 * Nor one whose name the reader already gave a folder of their own. That folder
 * was made on purpose, and two «Личные» side by side would be one name for two
 * different lists.
 */
export function offeredSystemFolders(
  chats: readonly ChatKindSubject[],
  ownFolderNames: readonly string[] = [],
): SystemFolder[] {
  const present = new Set(chats.map(chatKind));
  if (present.size < 2) return [];
  const taken = new Set(ownFolderNames.map(folderNameKey));
  return SYSTEM_FOLDERS.filter((folder) => present.has(folder.kind) && !taken.has(folderNameKey(folder.name)));
}

function folderNameKey(name: string): string {
  return name.trim().toLocaleLowerCase("ru-RU");
}

/**
 * The folder in force. A system folder whose kind emptied — its last group
 * left — gives way to «Все» rather than showing nothing, and is in force again
 * when a conversation of its kind returns. A folder of the reader's own is
 * left as it is.
 */
export function folderInForce(active: string | null, offered: readonly SystemFolder[]): string | null {
  if (!isSystemFolderId(active)) return active;
  return offered.some((folder) => folder.id === active) ? active : null;
}

/**
 * The conversations one folder shows: everything for «Все», one kind for a
 * system folder, the reader's own list for one of theirs. «Все» hands back the
 * very array it was given, so an event that changed nothing renders nothing
 * (`chat-list-event-cost.spec.ts`).
 */
export function chatsInFolder<T extends ChatKindSubject & { readonly id: string }>(
  chats: T[],
  folder: string | null,
  folderChats: Readonly<Record<string, ReadonlySet<string> | undefined>>,
): T[] {
  if (folder === null) return chats;
  const kind = systemFolderKind(folder);
  if (kind) return chats.filter((chat) => chatKind(chat) === kind);
  const inFolder = folderChats[folder];
  return inFolder ? chats.filter((chat) => inFolder.has(chat.id)) : [];
}
