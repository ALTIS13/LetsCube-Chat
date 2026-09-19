import type { ChatMember, ChatWithLastMessage, Profile } from "@/types/database";
import { botDisplayName, chatBotPartner } from "./chatBots.ts";
import { selectRussianPluralForm } from "./messageMediaSections.ts";

type DisplayChat = Pick<
  ChatWithLastMessage,
  "id" | "name" | "type" | "description" | "created_by" | "members" | "other_user" | "bots"
>;

export interface ChatDisplayInfo {
  title: string;
  subtitle: string;
  typeLabel: string;
  isSaved: boolean;
  /**
   * This conversation's counterpart is a bot (D-236).
   *
   * Decided here rather than on each surface, because this is the one function
   * the chat list row, the chat header and the information card all already
   * call — so a surface that draws a name from it cannot draw one without the
   * fact beside it unless it chooses to.
   */
  isBot: boolean;
}

export function getChatSecondaryLine(info: ChatDisplayInfo, context?: string | null): string {
  const cleanContext = context?.trim();
  if (!cleanContext || cleanContext === info.typeLabel) return info.subtitle;
  if (cleanContext === info.subtitle) return info.subtitle;
  return `${info.typeLabel} · ${cleanContext}`;
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

/** «1 участник», «3 участника», «5 участников»: Russian takes the form from the last two digits. */
export function memberCountLabel(count: number): string {
  return `${count} ${selectRussianPluralForm(count, ["участник", "участника", "участников"])}`;
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
      isBot: false,
    };
  }

  // Before the private branch, because a bot chat IS private and the branch
  // below looks for a person who is not there: a bot has no `chat_members`
  // row, so `other_user` is null and the title fell back to `chat.name` —
  // which `open_or_create_bot_chat` happens to set to the bot's display name.
  // The right name for the wrong reason, and nothing said what it was.
  const bot = chatBotPartner(chat);
  if (bot) {
    return {
      title: botDisplayName(bot),
      subtitle: "Бот",
      typeLabel: "Бот",
      isSaved: false,
      isBot: true,
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
      isBot: false,
    };
  }

  if (chat.type === "channel") {
    return {
      title: chat.name?.trim() || "Канал без названия",
      subtitle: chat.description?.trim() || "Канал",
      typeLabel: "Канал",
      isSaved: false,
      isBot: false,
    };
  }

  const memberCount = chat.members?.length ?? 0;
  return {
    title: chat.name?.trim() || "Группа без названия",
    subtitle: chat.description?.trim() || (memberCount > 0 ? memberCountLabel(memberCount) : "Группа"),
    typeLabel: "Группа",
    isSaved: false,
    isBot: false,
  };
}
