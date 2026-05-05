"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";
import { bumpFetch, registerChannel, unregisterChannel } from "@/lib/dev/instrumentation";
import type { Mute } from "@/types/database";

export type MuteScope = "global" | "chat";

export interface MuteState {
  loading: boolean;
  muted: boolean;
  scope: MuteScope | null;
  mute: Mute | null;
}

/**
 * Reports whether the current user is muted in the given chat (or globally).
 * Pass `null`/`undefined` for chatId to check only the global mute.
 *
 * Realtime-aware: subscribes to the user's mutes and re-evaluates when a
 * matching row changes.
 */
export function useMuteState(chatId: string | null | undefined): MuteState {
  // Узкий per-field селектор: подписываемся ТОЛЬКО на примитив userId,
  // чтобы heartbeat-эхо не пересоздавало канал `mutes:user:{id}:chat:{...}`
  // и не дёргало refresh лишний раз (Task #48).
  const userId = useAppStore((s) => s.currentUser?.id ?? null);
  const [state, setState] = useState<MuteState>({
    loading: true,
    muted: false,
    scope: null,
    mute: null,
  });
  const supabase = createClient();

  useEffect(() => {
    if (!userId) {
      setState({ loading: false, muted: false, scope: null, mute: null });
      return;
    }

    let cancelled = false;

    const refresh = async () => {
      bumpFetch("useMuteState");
      let q = supabase
        .from("mutes")
        .select("*")
        .eq("user_id", userId);
      // Either a global mute (chat_id IS NULL) or a mute scoped to this chat.
      q = chatId
        ? q.or(`chat_id.is.null,chat_id.eq.${chatId}`)
        : q.is("chat_id", null);
      const { data } = await q;
      if (cancelled) return;
      const rows = (data ?? []) as Mute[];
      const now = Date.now();
      const active = rows.find(
        (m) => !m.expires_at || new Date(m.expires_at).getTime() > now
      );
      setState({
        loading: false,
        muted: !!active,
        scope: active ? (active.chat_id ? "chat" : "global") : null,
        mute: active ?? null,
      });
    };

    refresh();

    const channelName = `mutes:user:${userId}:chat:${chatId ?? "global"}`;
    registerChannel(channelName);
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "mutes",
          filter: `user_id=eq.${userId}`,
        },
        refresh
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
      unregisterChannel(channelName);
    };
  }, [userId, chatId, supabase]);

  return state;
}
