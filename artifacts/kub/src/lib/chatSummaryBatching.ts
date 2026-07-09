type ChatSummaryRpcRow<TLastMessage> = {
  chat_id: string;
  last_message: TLastMessage | null;
  unread_count: number | string | null;
};

export type ChatSummary<TLastMessage> = {
  lastMessage: TLastMessage | null;
  unreadCount: number;
};

export function buildChatSummaryMap<TLastMessage>(
  rows: ChatSummaryRpcRow<TLastMessage>[] | null | undefined,
): Map<string, ChatSummary<TLastMessage>> {
  const summaries = new Map<string, ChatSummary<TLastMessage>>();
  for (const row of rows ?? []) {
    if (!row.chat_id) continue;
    const parsedUnreadCount = Number(row.unread_count ?? 0);
    summaries.set(row.chat_id, {
      lastMessage: row.last_message ?? null,
      unreadCount: Number.isFinite(parsedUnreadCount)
        ? Math.max(0, Math.trunc(parsedUnreadCount))
        : 0,
    });
  }
  return summaries;
}

export function isChatListSummariesUnavailable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  const code = typeof candidate.code === "string" ? candidate.code.toLowerCase() : "";
  const message =
    typeof candidate.message === "string" ? candidate.message.toLowerCase() : "";
  if (code === "pgrst202" || code === "42883") return true;
  return (
    message.includes("chat_list_summaries") &&
    (message.includes("does not exist") || message.includes("could not find"))
  );
}

export function isChatListSummariesEnabled(value: unknown): boolean {
  return value === "1";
}
