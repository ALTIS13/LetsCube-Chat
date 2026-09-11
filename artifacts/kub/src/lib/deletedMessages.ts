/**
 * What a deleted message leaves behind, by kind of chat, and how a deletion
 * for everyone is sent.
 *
 * The owner approved delete for both in private chats on 2026-09-11, as
 * Telegram does it: either person may delete any message for both sides, and it
 * leaves no trace — no «Сообщение удалено». The row stays on the server,
 * soft-deleted and reversible (20260911143000); this is where the client stops
 * drawing it. It applies to every deleted message of a private chat, including
 * the ones deleted before, because a placeholder is exactly the trace the
 * decision removes. A group keeps its placeholder, as it always has.
 *
 * Kept free of React and Supabase so `node --test` can load it.
 */

export const DELETE_FOR_EVERYONE_RPC = "delete_messages_for_everyone";
/** The server's limit per call. */
export const DELETE_FOR_EVERYONE_BATCH = 100;

/** Whether a deleted message leaves «Сообщение удалено» where it was. */
export function keepsDeletedPlaceholder(chatType: string | null | undefined): boolean {
  return chatType !== "private";
}

/** The messages as a chat shows them. The same array when nothing is taken out. */
export function visibleConversation<T extends { deleted_at?: string | null }>(
  messages: T[],
  chatType: string | null | undefined,
): T[] {
  if (keepsDeletedPlaceholder(chatType)) return messages;
  if (!messages.some((message) => message.deleted_at)) return messages;
  return messages.filter((message) => !message.deleted_at);
}

/** Server ids only, once each, in batches the server accepts. */
export function deletionBatches(ids: readonly string[], size = DELETE_FOR_EVERYONE_BATCH): string[][] {
  const unique = [...new Set(ids.filter((id) => id && !id.startsWith("tmp:")))];
  const batches: string[][] = [];
  for (let index = 0; index < unique.length; index += size) batches.push(unique.slice(index, index + size));
  return batches;
}

export function parseDeletedIds(data: unknown): string[] | null {
  if (!Array.isArray(data)) return null;
  return data.every((id) => typeof id === "string") ? (data as string[]) : null;
}

/** The conversation with these messages marked deleted. The same array when none changes. */
export function markMessagesDeleted<T extends { id: string; deleted_at?: string | null }>(
  messages: T[],
  ids: ReadonlySet<string>,
  deletedAt: string,
): T[] {
  let changed = false;
  const next = messages.map((message) => {
    if (!ids.has(message.id) || message.deleted_at) return message;
    changed = true;
    return { ...message, deleted_at: deletedAt };
  });
  return changed ? next : messages;
}

/**
 * Where the server has no delete for both: what the reader could delete before
 * — their own messages, for everyone — and what they could only hide.
 */
export function splitForPreviousDeletion<T>(messages: readonly T[], isOwn: (message: T) => boolean): { own: T[]; others: T[] } {
  const own: T[] = [];
  const others: T[] = [];
  for (const message of messages) (isOwn(message) ? own : others).push(message);
  return { own, others };
}
