"use client";

import { useCallback, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";
import { dispatchChatsRefresh } from "@/lib/chatEvents";
import type { Profile } from "@/types/database";

export function useCreateChat() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const userId = useAppStore((s) => s.currentUser?.id ?? null);
  const setSelectedChatId = useAppStore((s) => s.setSelectedChatId);
  const supabase = createClient();

  const openPrivateChat = useCallback(
    async (otherUserId: string): Promise<string | null> => {
      if (!userId) { setError("Not logged in"); return null; }
      setLoading(true);
      setError(null);

      try {
        // Single SECURITY DEFINER RPC: atomically returns the existing
        // private chat with `otherUserId` or creates a fresh one. Replaces
        // the previous 4-step client-side query that was race-prone (two
        // tabs would happily create two chats with the same person).
        const { data: chatId, error: rpcErr } = await supabase
          .rpc("open_or_create_private_chat", { target_user_id: otherUserId });

        if (rpcErr) throw rpcErr;
        if (!chatId) throw new Error("Не удалось открыть чат");

        await supabase.rpc("unhide_private_chat", { p_chat_id: chatId as string });
        dispatchChatsRefresh({ reason: "membership-change", chatId: chatId as string });
        setSelectedChatId(chatId as string);
        setLoading(false);
        return chatId as string;

      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : JSON.stringify(err);
        console.error("openPrivateChat error:", msg);
        setError(msg);
        setLoading(false);
        return null;
      }
    },
    [userId, supabase, setSelectedChatId]
  );

  const searchUsers = useCallback(
    async (query: string): Promise<Profile[]> => {
      if (!query.trim() || !userId) return [];

      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .neq("id", userId)
        .or(`full_name.ilike.%${query}%,username.ilike.%${query}%`)
        .limit(20);

      if (error) console.error("searchUsers error:", error);
      return (data as Profile[]) ?? [];
    },
    [userId, supabase]
  );

  return { openPrivateChat, searchUsers, loading, error };
}
