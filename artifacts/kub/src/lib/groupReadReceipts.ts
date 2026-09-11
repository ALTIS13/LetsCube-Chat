import type { ChatMember, MessageWithSender, Profile } from "@/types/database";

export interface GroupReadReceiptUser {
  userId: string;
  /**
   * When they read it. From the pointer here; the exact time, or null when
   * there is none to show, once `message_read_times` has answered
   * (`lib/messageReadTimes.ts`).
   */
  readAt: string | null;
  profile?: Profile | null;
}

export interface GroupReadReceiptInfo {
  readCount: number;
  totalRecipients: number;
  allRead: boolean;
  readers: GroupReadReceiptUser[];
}

interface GroupReadReceiptContext {
  currentUserId: string | null;
  chatType?: string | null;
  members?: (ChatMember & { profile?: Profile | null })[] | null;
  isSavedChat?: boolean;
}

export function getGroupReadReceiptInfo(
  message: Pick<MessageWithSender, "user_id" | "created_at" | "deleted_at" | "pending" | "checking" | "failed"> | null | undefined,
  context: GroupReadReceiptContext,
): GroupReadReceiptInfo | null {
  if (!message) return null;
  if (!context.currentUserId || context.isSavedChat) return null;
  if (context.chatType !== "group" && context.chatType !== "channel") return null;
  if (message.user_id !== context.currentUserId) return null;
  if (message.deleted_at || message.pending || message.checking || message.failed) return null;

  const sentAt = new Date(message.created_at).getTime();
  if (!Number.isFinite(sentAt)) return null;

  const recipients = (context.members ?? []).filter((member) => member.user_id !== message.user_id);
  const readers = recipients
    .filter((member) => {
      if (!member.last_read_at) return false;
      const readAt = new Date(member.last_read_at).getTime();
      return Number.isFinite(readAt) && readAt >= sentAt;
    })
    .map((member) => ({
      userId: member.user_id,
      readAt: member.last_read_at!,
      profile: member.profile ?? null,
    }))
    .sort((a, b) => new Date(b.readAt).getTime() - new Date(a.readAt).getTime());

  return {
    readCount: readers.length,
    totalRecipients: recipients.length,
    allRead: recipients.length > 0 && readers.length === recipients.length,
    readers,
  };
}

/**
 * Whether two receipts draw the same thing on a message: the same people out of
 * the same total.
 *
 * Neither the readers' profiles nor their read marks are compared. A bubble
 * shows the count; the list of names and times is built fresh when it is
 * opened. A reader's mark is the member's `last_read_at`, the same for every
 * message that reader has read, so comparing it called one read a change to all
 * of them — measured on the fixture, a receipt that moved one of my 14 messages
 * rendered all 14 — and comparing profiles did the same for every heartbeat.
 */
export function sameGroupReadReceiptFace(
  a: GroupReadReceiptInfo | null | undefined,
  b: GroupReadReceiptInfo | null | undefined,
): boolean {
  if (!a || !b) return !a && !b;
  if (a.readCount !== b.readCount || a.totalRecipients !== b.totalRecipients || a.allRead !== b.allRead) return false;
  const readers = new Set(a.readers.map((reader) => reader.userId));
  return b.readers.every((reader) => readers.has(reader.userId));
}

export function getReceiptDisplayName(reader: GroupReadReceiptUser): string {
  return reader.profile?.full_name ?? reader.profile?.username ?? "Без имени";
}

export function getGroupReadReceiptCompactLabel(info: GroupReadReceiptInfo): string {
  if (info.totalRecipients > 0) return `${info.readCount}/${info.totalRecipients}`;
  return String(info.readCount);
}

export function getGroupReadReceiptAriaLabel(info: GroupReadReceiptInfo): string {
  const countLabel = info.totalRecipients > 0
    ? `${info.readCount} из ${info.totalRecipients}`
    : String(info.readCount);
  return info.allRead ? `Прочитано всеми: ${countLabel}` : `Прочитали: ${countLabel}`;
}
