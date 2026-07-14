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
): Promise<unknown> {
  const { error } = await client.rpc("notifications_mark_chat_messages_read", {
    p_chat_id: chatId,
    p_read_until: readUntil,
  });
  if (!error && onMarkedRead) await onMarkedRead(chatId);
  return error;
}
