import { getChatDisplayInfo } from "./chatDisplay.ts";
import type { ChatWithLastMessage } from "@/types/database";

type ChatSearchResult = {
  resultType: string;
  id: string;
  chatId?: string | null;
  title: string;
  subtitle?: string | null;
};

export function withChatDisplayTitles<T extends ChatSearchResult>(
  results: T[],
  chats: ChatWithLastMessage[],
  currentUserId: string | null,
): T[] {
  if (!currentUserId || chats.length === 0 || results.length === 0) return results;

  const chatById = new Map(chats.map((chat) => [chat.id, chat]));
  return results.map((result) => {
    if (result.resultType !== "chat" && result.resultType !== "message") return result;
    const chat = chatById.get(result.chatId ?? (result.resultType === "chat" ? result.id : ""));
    if (!chat) return result;

    const display = getChatDisplayInfo(chat, currentUserId);
    if (result.resultType === "message") {
      return result.title === display.title ? result : { ...result, title: display.title };
    }
    return result.title === display.title && result.subtitle === display.subtitle
      ? result
      : { ...result, title: display.title, subtitle: display.subtitle };
  });
}
