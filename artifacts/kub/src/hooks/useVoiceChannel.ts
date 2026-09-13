"use client";

import { useCallback, useEffect, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { subscribeByTable } from "@/lib/realtimeTableChannels";
import type { VoiceChannelSummary } from "@/lib/voiceChannel";

/**
 * A chat's voice channel and who is in it, for everyone **outside** the call.
 *
 * Section 3.1 of docs/proposals/2026-09-13-voice-channels.md: the client never
 * writes either table. `voice_participants` has no INSERT, UPDATE or DELETE
 * policy at all, so every write here would be refused — the rows arrive from
 * the SFU's own webhooks and from the reconciler, which is what makes the list
 * correct when a client vanishes without saying so. This hook only reads.
 *
 * Somebody who is **in** the call reads the SDK instead (`useVoiceCall`), which
 * is faster and cannot go stale. This is the chat's own view of it.
 */

export interface VoiceChannelView {
  /** Whether this deployment has the voice tables at all — see `tableIsAbsent`. */
  supported: boolean;
  /** Whether the first read has come back, so an empty list is not drawn as «никого». */
  ready: boolean;
  channel: VoiceChannelSummary | null;
  /** Ids only. Names come from the chat's member list, through `resolveVoiceParticipants`. */
  participantIds: string[];
  refresh: () => void;
}

const EMPTY: VoiceChannelView = {
  supported: true,
  ready: false,
  channel: null,
  participantIds: [],
  refresh: () => undefined,
};

/**
 * The two ways PostgREST says «that table does not exist here».
 *
 * This matters on the day the client half of slice 2 is deployed and the
 * migration is not, which is a state this feature is deliberately built to pass
 * through: the gateway, the reconciler and the migration are three separate
 * pieces of work. A deployment without the tables must show no voice row and no
 * error — not a red box on the information panel of every group in the product.
 */
function tableIsAbsent(code: string | null | undefined): boolean {
  return code === "42P01" || code === "PGRST205" || code === "PGRST202";
}

interface ChannelRow {
  id: string;
  name: string;
  participant_count: number | null;
  max_participants: number | null;
}

export function useVoiceChannel(chatId: string | null, enabled: boolean): VoiceChannelView {
  const supabase = createClient();
  const [view, setView] = useState<VoiceChannelView>(EMPTY);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (!enabled || !chatId) {
      setView(EMPTY);
      return;
    }
    let cancelled = false;

    void (async () => {
      // `as any` on the table name: `voice_channels` is not in the generated
      // database types, because those are generated from a schema this
      // migration has not been applied to yet. The same cast is what
      // `lib/achievements.ts` and `lib/support/userTickets.ts` already use for
      // tables added after the last type generation.
      const channelRead = await supabase
        .from("voice_channels" as any)
        .select("id,name,participant_count,max_participants")
        .eq("chat_id", chatId)
        .eq("archived", false)
        .limit(1);
      if (cancelled) return;

      if (channelRead.error) {
        setView({
          ...EMPTY,
          ready: true,
          supported: !tableIsAbsent(channelRead.error.code),
        });
        return;
      }

      const row = (channelRead.data as unknown as ChannelRow[] | null)?.[0] ?? null;
      if (!row) {
        setView({ ...EMPTY, ready: true, refresh });
        return;
      }

      const channel: VoiceChannelSummary = {
        id: row.id,
        name: row.name,
        participantCount: Math.max(0, row.participant_count ?? 0),
        maxParticipants: Math.max(1, row.max_participants ?? 10),
      };

      // Both are read, and where they disagree the **row's** counter wins.
      //
      // That is the one the gateway compares against `max_participants` before
      // it mints (step 4 of section 3.4), so it is the number the decision will
      // actually be made on. Showing the list's length instead would let the
      // capsule say «9 из 10» and the join come back «В канале уже максимум
      // участников» — the interface contradicting the server about the only
      // thing the reader was using it for. Section 3.2 recomputes the counter
      // from the list on every write, so a disagreement is a ghost the
      // reconciler clears within its period.
      const participantsRead = await supabase
        .from("voice_participants" as any)
        .select("user_id")
        .eq("channel_id", row.id);
      if (cancelled) return;

      const ids = participantsRead.error
        ? []
        : ((participantsRead.data as unknown as { user_id: string }[] | null) ?? []).map((entry) => entry.user_id);

      setView({
        supported: true,
        ready: true,
        channel,
        participantIds: ids,
        refresh,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [chatId, enabled, nonce, refresh, supabase]);

  // Realtime, one channel per table (`realtimeTableChannels.ts:1-38`: a binding
  // to a table outside the publication silently kills every other binding on
  // its channel while still reporting SUBSCRIBED). Both tables are bound
  // separately and either one changing re-reads both, which costs two small
  // queries and removes every chance of the two views disagreeing.
  const channelId = view.channel?.id ?? null;
  useEffect(() => {
    if (!enabled || !chatId || !view.supported) return;
    const opened = subscribeByTable<(payload: unknown) => void, RealtimeChannel>(
      supabase.realtime,
      `voice:chat:${chatId}`,
      [
        { event: "*", schema: "public", table: "voice_channels", filter: `chat_id=eq.${chatId}`, handler: refresh },
        ...(channelId
          ? [
              {
                event: "*" as const,
                schema: "public",
                table: "voice_participants",
                filter: `channel_id=eq.${channelId}`,
                handler: refresh,
              },
            ]
          : []),
      ],
    );
    return () => {
      for (const entry of opened) void supabase.removeChannel(entry.channel);
    };
  }, [chatId, channelId, enabled, refresh, supabase, view.supported]);

  return view;
}
