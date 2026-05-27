export const KUB_CHAT_NOTIFICATIONS_READ_EVENT = "kub:chat-notifications-read";

export type ChatNotificationsReadDetail = {
  chatId: string;
  readUntil?: string | null;
};

export function dispatchChatNotificationsRead(detail: ChatNotificationsReadDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ChatNotificationsReadDetail>(KUB_CHAT_NOTIFICATIONS_READ_EVENT, { detail }));
}
