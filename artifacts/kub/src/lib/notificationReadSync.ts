type NotificationReadSyncClient = {
  rpc: (
    fn: "notifications_mark_chat_messages_read",
    args: { p_chat_id: string; p_read_until: string | null },
  ) => PromiseLike<{ error: unknown }>;
};

export async function markChatMessageNotificationsRead(
  client: NotificationReadSyncClient,
  chatId: string,
  readUntil: string | null,
  onMarkedRead?: (chatId: string) => void | PromiseLike<void>,
  isCurrent: () => boolean = () => true,
): Promise<unknown> {
  if (!isCurrent()) return null;
  try {
    const { error } = await client.rpc("notifications_mark_chat_messages_read", {
      p_chat_id: chatId,
      p_read_until: readUntil,
    });
    if (!error && onMarkedRead && isCurrent()) await onMarkedRead(chatId);
    return error;
  } catch (error) {
    return error;
  }
}
