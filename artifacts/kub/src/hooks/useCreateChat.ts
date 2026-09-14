"use client";

import { useCallback, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";
import { dispatchChatsRefresh } from "@/lib/chatEvents";
import { mapPgError } from "@/lib/errors";
import { CHAT_OPEN_FAILED, CHAT_OPEN_SIGNED_OUT, plainFailure } from "@/lib/plainMessages";
import type { Profile } from "@/types/database";

export function useCreateChat() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const userId = useAppStore((s) => s.currentUser?.id ?? null);
  const setSelectedChatId = useAppStore((s) => s.setSelectedChatId);
  const supabase = createClient();

  const openPrivateChat = useCallback(
    async (otherUserId: string): Promise<string | null> => {
      // D-132 (chat-functions A3). This said «Not logged in» — English, from
      // the inside, on a screen whose only text is Russian. It is also the one
      // failure here somebody can fix, so it says what to do rather than being
      // folded into «попробуйте ещё раз».
      if (!userId) { setError(CHAT_OPEN_SIGNED_OUT); return null; }
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
        // Thrown as the sentence the screen shows: `mapPgError` passes Cyrillic
        // through, so a near-miss of the constant here would put two spellings
        // of one failure in front of the same person.
        if (!chatId) throw new Error(CHAT_OPEN_FAILED);

        await supabase.rpc("unhide_private_chat", { p_chat_id: chatId as string });
        dispatchChatsRefresh({ reason: "membership-change", chatId: chatId as string });
        setSelectedChatId(chatId as string);
        setLoading(false);
        return chatId as string;

      } catch (err: unknown) {
        // D-132 (chat-functions A3). What used to reach the screen was
        // `err.message` — the server's English, or a Postgres constraint name —
        // and `JSON.stringify(err)`, a raw object dump, whenever the thrown
        // thing was not an `Error`. The cause still exists; it goes to the log,
        // which is where somebody who can act on it reads it.
        //
        // `mapPgError` is asked first because it knows the failures a person
        // can do something about — the session expired, the network is gone,
        // rights are missing — and `plainFailure` refuses its answer when it
        // describes the machine instead, or when it recognised nothing and
        // fell back to «операцию» where this surface can say «чат».
        console.error("openPrivateChat error:", err);
        setError(plainFailure(mapPgError(err), CHAT_OPEN_FAILED));
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
