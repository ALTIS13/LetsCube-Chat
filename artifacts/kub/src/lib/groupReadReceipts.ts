import type { ChatMember, MessageWithSender, Profile } from "@/types/database";

export interface GroupReadReceiptUser {
  userId: string;
  readAt: string;
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
  message: Pick<MessageWithSender, "user_id" | "created_at" | "deleted_at" | "pending" | "checking" | "failed">,
  context: GroupReadReceiptContext,
): GroupReadReceiptInfo | null {
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

export function getReceiptDisplayName(reader: GroupReadReceiptUser): string {
  return reader.profile?.full_name ?? reader.profile?.username ?? "Без имени";
}
