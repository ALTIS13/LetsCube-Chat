import { isSavedChat } from "@/lib/chatDisplay";
import type { ChatWithLastMessage } from "@/types/database";

export function sortChatsForSidebar(
  chats: ChatWithLastMessage[],
  currentUserId: string | null,
): ChatWithLastMessage[] {
  return [...chats].sort((a, b) => {
    const aSaved = isSavedChat(a, currentUserId);
    const bSaved = isSavedChat(b, currentUserId);
    if (aSaved !== bSaved) return aSaved ? -1 : 1;

    const aPinned = Boolean(a.is_pinned);
    const bPinned = Boolean(b.is_pinned);
    if (aPinned !== bPinned) return aPinned ? -1 : 1;

    if (aPinned && bPinned) {
      const byPinnedOrder = comparePinnedOrder(a, b);
      if (byPinnedOrder !== 0) return byPinnedOrder;

      const aPinnedAt = a.pinned_at ? new Date(a.pinned_at).getTime() : 0;
      const bPinnedAt = b.pinned_at ? new Date(b.pinned_at).getTime() : 0;
      if (aPinnedAt !== bPinnedAt) return bPinnedAt - aPinnedAt;
    }

    const aTime = a.last_message?.created_at ?? a.updated_at;
    const bTime = b.last_message?.created_at ?? b.updated_at;
    return new Date(bTime).getTime() - new Date(aTime).getTime();
  });
}

export function comparePinnedOrder(a: ChatWithLastMessage, b: ChatWithLastMessage): number {
  const aOrder = typeof a.pinned_order === "number" ? a.pinned_order : null;
  const bOrder = typeof b.pinned_order === "number" ? b.pinned_order : null;
  if (aOrder === null && bOrder === null) return 0;
  if (aOrder === null) return 1;
  if (bOrder === null) return -1;
  return aOrder - bOrder;
}
