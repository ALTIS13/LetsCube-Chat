export const KUB_CHAT_MESSAGE_JUMP_EVENT = "kub:chat-message-jump";

export type ChatMessageJumpDetail = {
  chatId: string;
  messageId: string;
  /**
   * The topic the message is in, for a forum.
   *
   * Optional, and absent means «wherever it already is» — which is what every
   * caller before the list column's search meant, so their behaviour is
   * unchanged. A caller outside the chat pane cannot switch the topic itself:
   * the pane owns `selectedTopicId` and the pending-jump handshake that waits
   * for the new topic's messages. Passing the topic here routes the jump
   * through the pane's own `handleSearchJump`, which is the same path the
   * phone's overlay takes, rather than a second copy of that handshake.
   */
  topicId?: string | null;
};

export function requestChatMessageJump(chatId: string, messageId: string, topicId?: string | null): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ChatMessageJumpDetail>(KUB_CHAT_MESSAGE_JUMP_EVENT, {
      detail: topicId === undefined ? { chatId, messageId } : { chatId, messageId, topicId },
    }),
  );
}
