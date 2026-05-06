import type { ChatMember, ChatWithLastMessage, Profile } from "@/types/database";

type DisplayChat = Pick<
  ChatWithLastMessage,
  "id" | "name" | "type" | "description" | "created_by" | "members" | "other_user"
>;

export interface ChatDisplayInfo {
  title: string;
  subtitle: string;
  typeLabel: string;
  isSaved: boolean;
}

export function isSavedChatLikeName(name: string | null | undefined): boolean {
  const normalized = (name ?? "").trim().toLocaleLowerCase("ru-RU");
  return normalized === "избранное" || normalized === "сохранённое" || normalized === "saved messages";
}

export function isSavedChat(chat: DisplayChat, currentUserId?: string | null): boolean {
  if (!isSavedChatLikeName(chat.name)) return false;
  const members = chat.members ?? [];
  if (!currentUserId) return members.length <= 1;
  const hasCurrentUser = members.some((member) => member.user_id === currentUserId);
  return chat.created_by === currentUserId || (hasCurrentUser && members.length <= 1);
}

export function getChatDisplayInfo(
  chat: DisplayChat,
  currentUserId?: string | null,
): ChatDisplayInfo {
  const saved = isSavedChat(chat, currentUserId);
  if (saved) {
    return {
      title: "Избранное",
      subtitle: "Личное пространство",
      typeLabel: "Избранное",
      isSaved: true,
    };
  }

  if (chat.type === "private") {
    const otherUser =
      chat.other_user ??
      (chat.members as (ChatMember & { profile?: Profile | null })[] | undefined)
        ?.find((member) => member.user_id !== currentUserId)?.profile ??
      null;
    const title = otherUser?.full_name ?? otherUser?.username ?? chat.name ?? "Личный чат";
    return {
      title,
      subtitle: "Личный чат",
      typeLabel: "Личный чат",
      isSaved: false,
    };
  }

  if (chat.type === "channel") {
    return {
      title: chat.name?.trim() || "Канал без названия",
      subtitle: chat.description?.trim() || "Канал",
      typeLabel: "Канал",
      isSaved: false,
    };
  }

  const memberCount = chat.members?.length ?? 0;
  return {
    title: chat.name?.trim() || "Группа без названия",
    subtitle: chat.description?.trim() || (memberCount > 0 ? `${memberCount} участников` : "Группа"),
    typeLabel: "Группа",
    isSaved: false,
  };
}
