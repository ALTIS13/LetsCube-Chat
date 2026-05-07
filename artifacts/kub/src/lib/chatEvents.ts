export const KUB_CHATS_REFRESH_EVENT = "kub:chats-refresh";

export interface ChatsRefreshDetail {
  reason: "membership-change" | "chat-notification" | "message-realtime" | "message-hidden";
  chatId?: string;
  messageId?: string;
}

export function dispatchChatsRefresh(detail: ChatsRefreshDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ChatsRefreshDetail>(KUB_CHATS_REFRESH_EVENT, { detail }));
}
