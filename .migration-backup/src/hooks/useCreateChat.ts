"use client";

import { useCallback, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";
import type { Profile } from "@/types/database";

export function useCreateChat() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { currentUser, setSelectedChatId } = useAppStore();
  const supabase = createClient();

  const openPrivateChat = useCallback(
    async (otherUserId: string): Promise<string | null> => {
      if (!currentUser) { setError("Not logged in"); return null; }
      setLoading(true);
      setError(null);

      try {
        // 1. Find chats where current user is a member
        const { data: myMemberships, error: e1 } = await supabase
          .from("chat_members")
          .select("chat_id")
          .eq("user_id", currentUser.id);

        if (e1) throw e1;

        // 2. Among those chats, find one where other user is also a member
        if (myMemberships && myMemberships.length > 0) {
          const myIds = myMemberships.map((m) => m.chat_id);

          const { data: otherMemberships, error: e2 } = await supabase
            .from("chat_members")
            .select("chat_id")
            .eq("user_id", otherUserId)
            .in("chat_id", myIds);

          if (e2) throw e2;

          if (otherMemberships && otherMemberships.length > 0) {
            // Verify it's a private chat
            const sharedIds = otherMemberships.map((m) => m.chat_id);
            const { data: privateChatData } = await supabase
              .from("chats")
              .select("id")
              .eq("type", "private")
              .in("id", sharedIds)
              .limit(1)
              .single();

            if (privateChatData) {
              setSelectedChatId(privateChatData.id);
              setLoading(false);
              return privateChatData.id;
            }
          }
        }

        // 3. No existing chat — create one
        const { data: newChat, error: e3 } = await supabase
          .from("chats")
          .insert({ type: "private", created_by: currentUser.id })
          .select("id")
          .single();

        if (e3) throw e3;
        if (!newChat) throw new Error("Failed to create chat");

        // 4. Add both members
        const { error: e4 } = await supabase.from("chat_members").insert([
          { chat_id: newChat.id, user_id: currentUser.id, role: "owner" },
          { chat_id: newChat.id, user_id: otherUserId, role: "member" },
        ]);

        if (e4) throw e4;

        setSelectedChatId(newChat.id);
        setLoading(false);
        return newChat.id;

      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : JSON.stringify(err);
        console.error("openPrivateChat error:", msg);
        setError(msg);
        setLoading(false);
        return null;
      }
    },
    [currentUser, supabase, setSelectedChatId]
  );

  const searchUsers = useCallback(
    async (query: string): Promise<Profile[]> => {
      if (!query.trim() || !currentUser) return [];

      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .neq("id", currentUser.id)
        .or(`full_name.ilike.%${query}%,username.ilike.%${query}%`)
        .limit(20);

      if (error) console.error("searchUsers error:", error);
      return (data as Profile[]) ?? [];
    },
    [currentUser, supabase]
  );

  return { openPrivateChat, searchUsers, loading, error };
}
