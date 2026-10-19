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
import type { Mute } from "@/types/database";

export type MuteScope = "global" | "chat";

export interface MuteState {
  loading: boolean;
  muted: boolean;
  scope: MuteScope | null;
  mute: Mute | null;
  /**
   * What the newest read could actually tell us.
   *
   * `muted: false` used to mean both «we asked and they are not muted» and «we
   * could not ask», so a refused read handed somebody an input box that the
   * database would then refuse. See the same note on `BanState`.
   */
  view: ListReadView;
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
    view: "loading",
  });
  const supabase = createClient();
  const loadedOnce = useRef(false);

  useEffect(() => {
    if (!userId) {
      loadedOnce.current = false;
      setState({ loading: false, muted: false, scope: null, mute: null, view: "ready" });
      return;
    }

    let cancelled = false;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    let refreshPending = false;

    const clearRetry = () => {
      if (retry !== null) clearTimeout(retry);
      retry = null;
    };

    const refuseRead = (message: string) => {
      if (cancelled) return;
      // A refusal never clears the last known sanction.
      setState((previous) => stateAfterRefusedRead(previous, {
        loadedOnce: loadedOnce.current,
        message,
      }));
      clearRetry();
      retry = setTimeout(() => {
        retry = null;
        void refresh();
      }, sanctionRetryDelayMs(attempt));
      attempt += 1;
    };

    const refresh = async (): Promise<void> => {
      if (cancelled) return;
      clearRetry();
      if (inFlight) {
        refreshPending = true;
        return;
      }
      inFlight = true;
      try {
        bumpFetch("useMuteState");
        let q = supabase
          .from("mutes")
          .select("*")
          .eq("user_id", userId);
        // Either a global mute (chat_id IS NULL) or a mute scoped to this chat.
        q = chatId
          ? q.or(`chat_id.is.null,chat_id.eq.${chatId}`)
          : q.is("chat_id", null);
        const { data, error } = await q;
        if (cancelled) return;
        if (error) {
          refuseRead(error.message ?? "read refused");
          return;
        }

        attempt = 0;
        loadedOnce.current = true;
        const rows = (data ?? []) as Mute[];
        const active = activeSanctionAt(rows, Date.now());
        setState({
          loading: false,
          muted: !!active,
          scope: active ? (active.chat_id ? "chat" : "global") : null,
          mute: active,
          view: "ready",
        });
      } catch {
        refuseRead("read refused");
      } finally {
        inFlight = false;
        // A newer row event owes one read after the current snapshot settles.
        if (!cancelled && refreshPending) {
          refreshPending = false;
          void refresh();
        }
      }
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
      clearRetry();
      supabase.removeChannel(channel);
      unregisterChannel(channelName);
    };
  }, [userId, chatId, supabase]);

  return state;
}
