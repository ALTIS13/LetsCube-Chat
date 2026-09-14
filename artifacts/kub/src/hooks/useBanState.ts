"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";
import { bumpFetch, registerChannel, unregisterChannel } from "@/lib/dev/instrumentation";
import type { ListReadView } from "@/lib/listReadState";
import {
  activeSanctionAt,
  sanctionRetryDelayMs,
  stateAfterRefusedRead,
} from "@/lib/sanctionRead";
import type { Ban } from "@/types/database";

export interface BanState {
  loading: boolean;
  banned: boolean;
  ban: (Ban & { issuer?: { full_name: string | null; username: string | null } | null }) | null;
  /**
   * What the newest read could actually tell us.
   *
   * `banned: false` used to mean two different things — «we asked and they are
   * not banned» and «we could not ask». A banned person whose read is refused
   * gets the product with every list empty and every write rejected, and no
   * screen anywhere says why, because fifteen tables carry restrictive «block
   * banned» policies that answer with emptiness rather than an error. This
   * separates the two, so a refusal can never be reported as an acquittal.
   */
  view: ListReadView;
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
    view: "loading",
  });
  const supabase = createClient();
  const loadedOnce = useRef(false);

  useEffect(() => {
    if (!userId) {
      loadedOnce.current = false;
      setState({ loading: false, banned: false, ban: null, view: "ready" });
      return;
    }

    let cancelled = false;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const refresh = async () => {
      bumpFetch("useBanState");
      const { data, error } = await supabase
        .from("bans")
        .select("*, issuer:profiles!bans_issued_by_fkey(full_name,username)")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      if (cancelled) return;

      if (error) {
        // Never answer «not banned» here. Keep whatever was last known true,
        // say the reading is stale or missing, and ask again.
        setState((previous) =>
          stateAfterRefusedRead(previous, {
            loadedOnce: loadedOnce.current,
            message: error.message ?? "read refused",
          }),
        );
        retry = setTimeout(refresh, sanctionRetryDelayMs(attempt));
        attempt += 1;
        return;
      }

      attempt = 0;
      loadedOnce.current = true;
      const rows = ((data ?? []) as unknown) as (Ban & {
        issuer?: { full_name: string | null; username: string | null } | null;
      })[];
      const active = activeSanctionAt(rows, Date.now());
      setState({ loading: false, banned: !!active, ban: active, view: "ready" });
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
      if (retry) clearTimeout(retry);
      supabase.removeChannel(channel);
      unregisterChannel(channelName);
    };
  }, [userId, supabase]);

  return state;
}
