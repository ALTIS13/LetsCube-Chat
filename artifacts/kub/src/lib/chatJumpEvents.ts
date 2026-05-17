export const KUB_CHAT_MESSAGE_JUMP_EVENT = "kub:chat-message-jump";

export type ChatMessageJumpDetail = {
  chatId: string;
  messageId: string;
};

export function requestChatMessageJump(chatId: string, messageId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ChatMessageJumpDetail>(KUB_CHAT_MESSAGE_JUMP_EVENT, {
      detail: { chatId, messageId },
    }),
  );
}
