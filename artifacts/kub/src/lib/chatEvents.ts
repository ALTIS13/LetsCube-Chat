export const KUB_CHATS_REFRESH_EVENT = "kub:chats-refresh";

interface OrdinaryChatsRefreshDetail {
  reason: "membership-change" | "chat-notification" | "message-realtime" | "message-hidden" | "contact-change";
  chatId?: string;
  messageId?: string;
}

export type ChatsRefreshDetail = OrdinaryChatsRefreshDetail | {
  reason: "media-retired";
  chatId: string;
  ownerUserId: string;
  accountEpoch: number;
  messageId?: never;
} & ({ retiredMessageIds: string[]; retirement: "hidden" | "gone"; retireChat?: never } | {
  retireChat: "access" | "clear" | "access-restored"; retiredMessageIds?: never; retirement?: never;
});

export function dispatchChatsRefresh(detail: ChatsRefreshDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ChatsRefreshDetail>(KUB_CHATS_REFRESH_EVENT, { detail }));
}
