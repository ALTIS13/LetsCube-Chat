import { createClient } from "@/lib/supabase/client";
import { dispatchChatsRefresh } from "@/lib/chatEvents";
import { showAppAlert } from "@/lib/appDialogs";
import { useAppStore } from "@/store/app.store";

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
    dispatchChatsRefresh({ reason: "chat-notification", chatId: normalizedChatId });
  }

  useAppStore.getState().setSelectedChatId(normalizedChatId);
  return true;
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
