/**
 * Opening «Избранное».
 *
 * Lifted out of `SidebarHeader` unchanged when the desktop side list gained the
 * same row: two copies of a chat-creation path that has already been narrowed
 * once by an RLS lockdown is exactly the kind of duplication that drifts.
 */
import { newGroupRow } from "@/lib/chatCreation";

export async function openSavedMessagesChat({
  userId,
  setSelectedChatId,
  onRefetch,
}: {
  userId: string | null;
  setSelectedChatId: (id: string) => void;
  onRefetch?: () => void;
}): Promise<void> {
  if (!userId) return;
  const { createClient } = await import("@/lib/supabase/client");
  const supabase = createClient();
  // After the chat-INSERT lockdown (20260504_tasks_update_and_chat_lockdown.sql)
  // direct INSERT of `type='private'` rows is blocked — only
  // `open_or_create_private_chat` may create them, and it refuses self-chats.
  // So Saved Messages is a single-member 'group', which the regular INSERT
  // policy still permits. Any pre-existing "Избранное" row is accepted whatever
  // its type, so accounts with legacy private rows are not locked out.
  const { data: existing } = await supabase
    .from("chats")
    .select("id")
    .eq("created_by", userId)
    .eq("name", "Избранное")
    .limit(1)
    .maybeSingle();
  if (existing) {
    setSelectedChatId(existing.id);
    return;
  }
  // Same defect as the group modal, same fix: the id is chosen here and the
  // row is not read back, because `INSERT ... RETURNING` is judged by the
  // SELECT policy and the creator is not yet a member when it is evaluated.
  const chat = newGroupRow({ name: "Избранное", createdBy: userId });
  const { error } = await supabase.from("chats").insert(chat);
  if (error) return;
  // The `add_chat_creator_as_owner` trigger inserts the owner row. Do not
  // repeat it from the client: RLS correctly blocks a direct membership upsert
  // in production and that shows up as noisy 403 logs.
  setSelectedChatId(chat.id);
  onRefetch?.();
}
