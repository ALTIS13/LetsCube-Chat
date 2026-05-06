import type { KubIconName, KubIconTone } from "@/components/kub";
import type { ChatMember, MessageWithSender } from "@/types/database";

export type MessageDeliveryStateName = "incoming" | "sending" | "sent" | "read" | "failed";

export interface MessageDeliveryState {
  state: MessageDeliveryStateName;
  icon: KubIconName;
  tone: KubIconTone;
  label: string;
  isOwnMessage: boolean;
}

interface MessageDeliveryContext {
  currentUserId: string | null;
  chatType?: string | null;
  members?: Array<Pick<ChatMember, "user_id" | "last_read_at">> | null;
  isSavedChat?: boolean;
}

export function getMessageDeliveryState(
  message: Pick<MessageWithSender, "user_id" | "created_at" | "pending" | "failed"> | null | undefined,
  context: MessageDeliveryContext,
): MessageDeliveryState | null {
  if (!message || !context.currentUserId || message.user_id !== context.currentUserId) return null;
  if (context.isSavedChat) return null;

  if (message.failed) {
    return {
      state: "failed",
      icon: "alert",
      tone: "danger",
      label: "Не удалось отправить",
      isOwnMessage: true,
    };
  }

  if (message.pending) {
    return {
      state: "sending",
      icon: "clock",
      tone: "muted",
      label: "Отправляется",
      isOwnMessage: true,
    };
  }

  if (context.chatType === "private" && isReadByPrivateRecipient(message, context)) {
    return {
      state: "read",
      icon: "doubleCheck",
      tone: "accent",
      label: "Прочитано",
      isOwnMessage: true,
    };
  }

  return {
    state: "sent",
    icon: "check",
    tone: "muted",
    label: "Отправлено",
    isOwnMessage: true,
  };
}

function isReadByPrivateRecipient(
  message: Pick<MessageWithSender, "created_at">,
  context: MessageDeliveryContext,
): boolean {
  const recipient = context.members?.find((member) => member.user_id !== context.currentUserId);
  if (!recipient?.last_read_at) return false;
  const readAt = new Date(recipient.last_read_at).getTime();
  const sentAt = new Date(message.created_at).getTime();
  return Number.isFinite(readAt) && Number.isFinite(sentAt) && readAt >= sentAt;
}
