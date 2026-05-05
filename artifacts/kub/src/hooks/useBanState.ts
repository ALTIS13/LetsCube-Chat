"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";
import { bumpFetch, registerChannel, unregisterChannel } from "@/lib/dev/instrumentation";
import type { Ban } from "@/types/database";

export interface BanState {
  loading: boolean;
  banned: boolean;
  ban: (Ban & { issuer?: { full_name: string | null; username: string | null } | null }) | null;
}

/**
 * Subscribes to the current user's row in `public.bans` via Supabase Realtime
 * and exposes whether they are currently banned plus the active ban row (if
 * any) for display in the "Вы заблокированы" overlay.
 *
 * Only rows where `expires_at IS NULL OR expires_at > now()` count as active.
 */
export function useBanState(): BanState {
  // Узкий per-field селектор: подписываемся ТОЛЬКО на примитив userId,
  // чтобы heartbeat-эхо не пересоздавало канал `bans:user:{id}` (Task #48).
  const userId = useAppStore((s) => s.currentUser?.id ?? null);
  const [state, setState] = useState<BanState>({
    loading: true,
    banned: false,
    ban: null,
  });
  const supabase = createClient();

  useEffect(() => {
    if (!userId) {
      setState({ loading: false, banned: false, ban: null });
      return;
    }

    let cancelled = false;

    const refresh = async () => {
      bumpFetch("useBanState");
      const { data } = await supabase
        .from("bans")
        .select("*, issuer:profiles!bans_issued_by_fkey(full_name,username)")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      if (cancelled) return;
      const rows = ((data ?? []) as unknown) as (Ban & {
        issuer?: { full_name: string | null; username: string | null } | null;
      })[];
      const now = Date.now();
      const active = rows.find(
        (b) => !b.expires_at || new Date(b.expires_at).getTime() > now
      );
      setState({ loading: false, banned: !!active, ban: active ?? null });
    };

    refresh();

    const channelName = `bans:user:${userId}`;
    registerChannel(channelName);
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "bans",
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
  }, [userId, supabase]);

  return state;
}
