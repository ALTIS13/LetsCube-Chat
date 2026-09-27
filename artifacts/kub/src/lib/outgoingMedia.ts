import type { StagedAttachment } from "./stagedAttachments.ts";

/**
 * Attachments on their way, owned by the application rather than by a chat's
 * view (D-314's Telegram half).
 *
 * Pressing «Отправить» puts each attachment in its conversation at once, as a
 * placeholder message with its progress, and takes it out of the tray above
 * the composer. From then on nothing about the send may depend on which chat is
 * on screen: the reader can leave and come back, and the placeholder they find
 * has to be cancellable while it uploads and sendable again if it failed. A
 * chat's view is remounted every time it is opened, so the facts that make both
 * possible live here, keyed by the placeholder's id:
 *
 *  - what is needed to send the attachment again — the file itself, its
 *    caption, what it replied to, its chat and topic, and its place in the
 *    order it was picked in;
 *  - how to stop its upload, from whichever view is showing it;
 *  - which attachments were cancelled, so an upload that finishes after its
 *    placeholder was taken away does not insert a row nobody wants.
 *
 * Nothing here touches the store or the network; the chat's view does both and
 * asks this module what it needs to know.
 */

export interface OutgoingMediaEntry {
  /** The placeholder's id in the conversation, `tmp:<client message id>`. */
  readonly tempId: string;
  readonly chatId: string;
  /** As the send had it; `undefined` is a chat that is not scoped by topic. */
  readonly topicId: string | null | undefined;
  readonly replyToId: string | null;
  /** The caption this attachment carries, or null. */
  readonly caption: string | null;
  readonly attachment: StagedAttachment;
  /** The placeholder's own time, so a retry keeps its place in the order. */
  readonly clientSentAt: string;
}

const entries = new Map<string, OutgoingMediaEntry>();
const aborts = new Map<string, () => void>();
const cancelled = new Set<string>();

/** The id a placeholder has, the same one the row that replaces it is matched by. */
export function outgoingTempId(clientMessageId: string): string {
  return `tmp:${clientMessageId}`;
}

export function rememberOutgoing(entry: OutgoingMediaEntry): void {
  entries.set(entry.tempId, entry);
  cancelled.delete(entry.attachment.id);
}

export function outgoingEntry(tempId: string): OutgoingMediaEntry | null {
  return entries.get(tempId) ?? null;
}

/** Done with: the row is in, or the placeholder was discarded. */
export function forgetOutgoing(tempId: string): OutgoingMediaEntry | null {
  const entry = entries.get(tempId) ?? null;
  entries.delete(tempId);
  if (entry) aborts.delete(entry.attachment.id);
  return entry;
}

/** How to stop an upload that is running, for whichever view cancels it. */
export function holdOutgoingAbort(attachmentId: string, abort: () => void): void {
  aborts.set(attachmentId, abort);
}

export function releaseOutgoingAbort(attachmentId: string, abort: () => void): void {
  if (aborts.get(attachmentId) === abort) aborts.delete(attachmentId);
}

/**
 * Stop it: the upload, if one is running and can be stopped, and the insert
 * that would follow it either way. Answers the entry, so the caller can take
 * the placeholder out and free its preview.
 */
export function cancelOutgoing(tempId: string): OutgoingMediaEntry | null {
  const entry = entries.get(tempId) ?? null;
  if (!entry) return null;
  cancelled.add(entry.attachment.id);
  const abort = aborts.get(entry.attachment.id);
  aborts.delete(entry.attachment.id);
  entries.delete(tempId);
  try {
    abort?.();
  } catch {
    // Stopping is best-effort; the cancelled mark is what keeps the row out.
  }
  return entry;
}

export function isOutgoingCancelled(attachmentId: string): boolean {
  return cancelled.has(attachmentId);
}

/**
 * Everything, for an account change: the next account's views must find no
 * placeholder of the last one's, and none of its uploads may finish into a
 * conversation.
 */
export function cancelAllOutgoing(): OutgoingMediaEntry[] {
  const all = [...entries.values()];
  for (const entry of all) cancelOutgoing(entry.tempId);
  return all;
}
