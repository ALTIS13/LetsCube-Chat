"use client";

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";
import { dispatchChatsRefresh } from "@/lib/chatEvents";
import { mapPgError } from "@/lib/errors";
import { CHAT_OPEN_FAILED, CHAT_OPEN_SIGNED_OUT, plainFailure } from "@/lib/plainMessages";
import { sanitizePostgrestSearch } from "@/lib/searchQuery";
import { STRANGER_HANDLE_MIN, peopleSearchNeedle, personMatchesSearch } from "@/lib/peopleSearchScope";
import type { UserContact } from "@/lib/userContacts";
import type { Profile } from "@/types/database";

export function useCreateChat() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const userId = useAppStore((s) => s.currentUser?.id ?? null);
  const setSelectedChatId = useAppStore((s) => s.setSelectedChatId);
  const queryClient = useQueryClient();
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

  // Who a new chat or the contacts' search may offer (`lib/peopleSearchScope`):
  // somebody the reader already has, by name, from what this device holds;
  // anybody else only by the start of their handle. A name that merely
  // contained the letters typed used to be enough, from the first letter.
  const searchUsers = useCallback(
    async (query: string): Promise<Profile[]> => {
      const needle = peopleSearchNeedle(query);
      if (!needle || !userId) return [];

      const found = new Map<string, Profile>();
      for (const chat of useAppStore.getState().chats) {
        for (const member of chat.members ?? []) {
          const profile = member.profile;
          if (!profile || profile.id === userId || found.has(profile.id)) continue;
          if (personMatchesSearch(profile, needle, true)) found.set(profile.id, profile);
        }
      }
      // A contact is matched by the name the reader saved them under, too.
      const contacts = queryClient.getQueryData<UserContact[]>(["user-contacts", userId]) ?? [];
      const contactIds = contacts
        .filter((contact) => contact.profile && !found.has(contact.contact_user_id) && (
          personMatchesSearch({ id: contact.contact_user_id, full_name: contact.alias, username: null }, needle, true)
          || personMatchesSearch({ ...contact.profile, id: contact.contact_user_id }, needle, true)
        ))
        .map((contact) => contact.contact_user_id)
        .slice(0, 20);
      const handle = sanitizePostgrestSearch(needle).replace(/[_\\]/g, (char) => `\\${char}`);

      const [contactRows, strangerRows] = await Promise.all([
        contactIds.length > 0
          ? supabase.from("profiles").select("*").in("id", contactIds)
          : Promise.resolve({ data: [] as Profile[], error: null }),
        handle.length >= STRANGER_HANDLE_MIN
          ? supabase.from("profiles").select("*").neq("id", userId).ilike("username", `${handle}%`).limit(20)
          : Promise.resolve({ data: [] as Profile[], error: null }),
      ]);
      const error = contactRows.error ?? strangerRows.error;

      if (error) {
        console.error("searchUsers error:", error);
        setError("Не удалось найти людей. Проверьте соединение и попробуйте снова.");
      } else {
        setError(null);
      }
      for (const profile of [...((contactRows.data ?? []) as Profile[]), ...((strangerRows.data ?? []) as Profile[])]) {
        if (!found.has(profile.id) && profile.id !== userId) found.set(profile.id, profile);
      }
      return [...found.values()].slice(0, 20);
    },
    [userId, supabase, queryClient]
  );

  return { openPrivateChat, searchUsers, loading, error };
}
