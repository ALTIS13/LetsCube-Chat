import { createClient } from "@/lib/supabase/client";
import { dispatchChatsRefresh } from "@/lib/chatEvents";
import { isSavedChat, isSavedChatLikeName } from "@/lib/chatDisplay";
import { sortChatsForSidebar } from "@/lib/chatSort";
import { showAppAlert } from "@/lib/appDialogs";
import { useAppStore } from "@/store/app.store";
import type { ChatWithLastMessage, Profile } from "@/types/database";
import { MESSAGE_LAST_MESSAGE_SELECT } from "@/lib/messageProjection";

const UNAVAILABLE_CHAT_MESSAGE = "Чат удалён или больше недоступен.";

type OpenChatOptions = {
  unavailableMessage?: string;
  unavailableTitle?: string;
};

export async function safeOpenChat(
  chatId: string | null | undefined,
  options: OpenChatOptions = {},
): Promise<boolean> {
  const normalizedChatId = chatId?.trim();
  if (!normalizedChatId) return false;

  const state = useAppStore.getState();
  const currentUserId = state.currentUser?.id;
  const hasChatInStore = state.chats.some((chat) => chat.id === normalizedChatId);

  if (!currentUserId) {
    handleUnavailableChat(normalizedChatId, options);
    return false;
  }

  const canAccess = await canAccessChat(normalizedChatId, currentUserId);
  if (canAccess === false) {
    handleUnavailableChat(normalizedChatId, options);
    return false;
  }

  // On transient check errors, keep current visible chats usable, but never
  // open a chat that is absent from the local list and unverified by RLS.
  if (canAccess === null && !hasChatInStore) {
    handleUnavailableChat(normalizedChatId, options);
    return false;
  }

  if (!hasChatInStore) {
    const hydrated = await hydrateChatSummary(normalizedChatId, currentUserId);
    if (hydrated) {
      const latestState = useAppStore.getState();
      latestState.setChats(
        sortChatsForSidebar(
          [hydrated, ...latestState.chats.filter((chat) => chat.id !== hydrated.id)],
          currentUserId,
        ),
      );
    } else {
      dispatchChatsRefresh({ reason: "chat-notification", chatId: normalizedChatId });
    }
  }

  useAppStore.getState().setSelectedChatId(normalizedChatId);
  return true;
}

async function hydrateChatSummary(chatId: string, currentUserId: string): Promise<ChatWithLastMessage | null> {
  const supabase = createClient();
  const { data: chatData, error } = await supabase
    .from("chats")
    .select("*, members:chat_members(user_id, role, joined_at, last_read_at, last_delivered_at, hidden_at, cleared_at, pinned, pinned_at, pinned_order, profile:profiles(*))")
    .eq("id", chatId)
    .maybeSingle();
  if (error || !chatData) return null;

  const { data: lastRows } = await supabase
    .from("messages")
    .select(MESSAGE_LAST_MESSAGE_SELECT)
    .eq("chat_id", chatId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);

  const members = (chatData.members ?? []) as NonNullable<ChatWithLastMessage["members"]>;
  const myMembership = members.find((member) => member.user_id === currentUserId) ?? null;
  const otherMember = chatData.type === "private"
    ? members?.find((member) => member.user_id !== currentUserId)
    : null;
  const otherUser = otherMember?.profile as Profile | null | undefined;
  const saved = isSavedChatLikeName(chatData.name) && (
    chatData.created_by === currentUserId ||
    members.length <= 1 ||
    members.some((member) => member.user_id === currentUserId)
  );
  const privateDisplayName = otherUser?.full_name ?? otherUser?.username ?? chatData.name;
  const privateAvatarUrl = otherUser?.avatar_url ?? chatData.avatar_url ?? null;
  const hydrated = {
    ...chatData,
    members,
    other_user: otherUser ?? undefined,
    name: chatData.type === "private" && !saved ? privateDisplayName : chatData.name,
    avatar_url: chatData.type === "private" && !saved ? privateAvatarUrl : chatData.avatar_url ?? null,
    last_message: (lastRows?.[0] as ChatWithLastMessage["last_message"] | undefined) ?? undefined,
    unread_count: 0,
    is_pinned: Boolean(myMembership?.pinned),
    pinned_at: myMembership?.pinned_at ?? null,
    pinned_order: myMembership?.pinned_order ?? null,
    hidden_at: myMembership?.hidden_at ?? null,
    cleared_at: myMembership?.cleared_at ?? null,
  } as ChatWithLastMessage;

  return isSavedChat(hydrated, currentUserId)
    ? { ...hydrated, name: "Избранное" }
    : hydrated;
}

async function canAccessChat(chatId: string, userId: string): Promise<boolean | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("chat_members")
    .select("chat_id")
    .eq("chat_id", chatId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return null;

  return Boolean(data?.chat_id);
}

function handleUnavailableChat(chatId: string, options: OpenChatOptions): void {
  const state = useAppStore.getState();
  if (state.selectedChatId === chatId) {
    state.setSelectedChatId(null);
  }
  showAppAlert(
    options.unavailableMessage ?? UNAVAILABLE_CHAT_MESSAGE,
    options.unavailableTitle ?? "Чат недоступен",
    "alert",
  );
}
