"use client";

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { subscribeByTable } from "@/lib/realtimeTableChannels";
import { useVoiceCall } from "@/hooks/useVoiceCall";
import { voiceRingState } from "@/lib/voiceRing";
import {
  voiceElsewhere,
  type VoiceElsewhereRoom,
  type VoiceParticipantRow,
} from "@/lib/voiceElsewhere";
import { useAppStore } from "@/store/app.store";

/**
 * Whether this person is in a voice room on some other device of theirs.
 *
 * The rule is `lib/voiceElsewhere.ts` and is pure. What is here is the one
 * read, the one subscription, and the reason both are shaped the way they are.
 *
 * ## Why this is not folded into `useVoicePresenceReader`
 *
 * That reader answers «which conversations have somebody talking in them», and
 * it does so from `voice_channels.participant_count` — a denormalised counter
 * written by the SFU's webhooks and reconciled twice a minute. It deliberately
 * does not watch `voice_participants`, because that would cost an event per
 * join per room across every conversation in the list for a mark the width of a
 * glyph.
 *
 * This question is the opposite shape. It is about **one person**, so the
 * subscription can be filtered to them — `user_id=eq.<me>`, one binding, which
 * fires only when that person joins or leaves a room anywhere — and it must not
 * inherit the counter's staleness, because a banner that appears a
 * reconciliation period late is a banner somebody has already given up on. So:
 * its own read, its own channel, and the chat list's hot path untouched.
 *
 * `subscribeByTable` gets its own channel name for the reason its header
 * records: one channel per table, and `useServerChannels` already carries
 * `voice_participants` bindings of its own on a channel keyed by chat.
 *
 * ## What it reads, and what it refuses to conclude
 *
 * Two queries, and the second almost never runs: the participant rows for this
 * person — normally none — and then the rooms those rows name, for their names
 * and their chats. The room read is what makes «Перейти сюда» a press rather
 * than a lookup, and it is also the check that a room still exists at all.
 *
 * **A refused read is not «you are nowhere».** The held answer stays, exactly
 * as the presence reader keeps its map: publishing an empty set from a failed
 * request would take the banner off the screen of somebody who really is in a
 * call on their computer, which is the one thing this exists to prevent.
 *
 * `user_id` is selected as well as filtered on, and the rule filters by it
 * again. That is not belt and braces for its own sake: the filter is the
 * server's promise, the column is the evidence, and a rule that reads the
 * evidence is a rule a test can put a foreign row in front of.
 */

interface Held {
  readonly participants: readonly VoiceParticipantRow[];
  readonly rooms: readonly VoiceElsewhereRoom[];
}

const NOTHING: Held = { participants: [], rooms: [] };

let held: Held = NOTHING;
const listeners = new Set<() => void>();

function publish(next: Held) {
  // Nothing changed is the ordinary case — this reader answers «no rows» on
  // every refresh of an account that is not in a call — and `useSyncExternalStore`
  // compares with `Object.is`, so handing back a fresh object each time would
  // render every reader on every voice event anywhere.
  if (
    held.participants.length === next.participants.length &&
    held.rooms.length === next.rooms.length &&
    held.participants.every(
      (row, index) =>
        row.channelId === next.participants[index]?.channelId &&
        row.userId === next.participants[index]?.userId,
    ) &&
    held.rooms.every(
      (room, index) =>
        room.channelId === next.rooms[index]?.channelId &&
        room.chatId === next.rooms[index]?.chatId &&
        room.name === next.rooms[index]?.name &&
        room.archived === next.rooms[index]?.archived &&
        room.ringing === next.rooms[index]?.ringing,
    )
  ) {
    return;
  }
  held = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function read(): Held {
  return held;
}

/** Read once, outside React, for a test or a probe. */
export function voiceElsewhereSnapshot(): Held {
  return held;
}

/**
 * The room this person is in on another device, or null.
 *
 * Every surface that has to know takes it through here, so the banner, the
 * capsule, the rail and the information panel cannot disagree about which room
 * that is. `useVoiceCall` for the local half rather than an argument: the
 * question is «somewhere that is not here», and «here» is not the caller's to
 * decide.
 */
export function useVoiceElsewhere(): VoiceElsewhereRoom | null {
  const rows = useSyncExternalStore(subscribe, read, read);
  const call = useVoiceCall();
  const myUserId = useAppStore((state) => state.currentUser?.id ?? null);
  return useMemo(
    () =>
      voiceElsewhere({
        myUserId,
        participants: rows.participants,
        localPhase: call.phase,
        localChannelId: call.channelId,
        rooms: rows.rooms,
      }),
    [call.channelId, call.phase, myUserId, rows],
  );
}

/**
 * The reader, mounted once beside `useVoicePresenceReader`.
 *
 * `Sidebar` is the one component guaranteed to exist while a chat list is on
 * screen — on a phone it stays mounted with a conversation open, which is
 * exactly the device this feature is for. It renders nothing.
 */
export function useVoiceElsewhereReader(userId: string | null): void {
  const supabase = useMemo(() => createClient(), []);
  // One in-flight read at a time, and a re-run queued rather than raced: the
  // same guard `useVoicePresenceReader` carries, and for the same reason — two
  // answers can land out of order and the last to arrive would win over the
  // newest.
  const running = useRef(false);
  const again = useRef(false);

  const refresh = useCallback(async () => {
    if (!userId) {
      publish(NOTHING);
      return;
    }
    if (running.current) {
      again.current = true;
      return;
    }
    running.current = true;
    try {
      for (;;) {
        again.current = false;
        const mine = await supabase
          .from("voice_participants" as never)
          .select("channel_id,user_id")
          .eq("user_id", userId);
        // A refused read is not «you are nowhere». The held answer stays.
        if (mine.error) break;
        const participants: VoiceParticipantRow[] = [];
        for (const row of (mine.data as unknown as { channel_id: string; user_id: string }[] | null) ?? []) {
          if (typeof row?.channel_id !== "string" || typeof row?.user_id !== "string") continue;
          participants.push({ channelId: row.channel_id, userId: row.user_id });
        }

        const ids = [...new Set(participants.filter((row) => row.userId === userId).map((row) => row.channelId))];
        if (ids.length === 0) {
          publish(NOTHING);
          if (!again.current) break;
          continue;
        }

        // The ring columns for the reason `voiceElsewhere` takes `ringing`: the
        // caller joins the room the moment they press, so an unanswered
        // outgoing call on the other device is a participant row in a room
        // where no conversation is happening. `archived` because removing a
        // room sets the flag rather than deleting the row.
        const named = await supabase
          .from("voice_channels" as never)
          .select("id,chat_id,name,archived,ring_started_at,ring_answered_at")
          .in("id", ids);
        if (named.error) break;
        const now = Date.now();
        const rooms: VoiceElsewhereRoom[] = [];
        for (const row of (named.data as unknown as Record<string, unknown>[] | null) ?? []) {
          const channelId = typeof row?.id === "string" ? row.id : null;
          const chatId = typeof row?.chat_id === "string" ? row.chat_id : null;
          if (channelId === null || chatId === null) continue;
          const startedAt = typeof row.ring_started_at === "string" ? Date.parse(row.ring_started_at) : NaN;
          const answeredAt = typeof row.ring_answered_at === "string" ? Date.parse(row.ring_answered_at) : NaN;
          rooms.push({
            channelId,
            chatId,
            name: typeof row.name === "string" ? row.name : "",
            archived: row.archived === true,
            ringing:
              Number.isFinite(startedAt) &&
              voiceRingState({
                startedAt,
                answeredAt: Number.isFinite(answeredAt) ? answeredAt : null,
                now,
              }) === "ringing",
          });
        }
        publish({ participants, rooms });
        if (!again.current) break;
      }
    } finally {
      running.current = false;
    }
  }, [supabase, userId]);

  useEffect(() => {
    if (!userId) {
      publish(NOTHING);
      return;
    }
    void refresh();
    const opened = subscribeByTable<(payload: unknown) => void, RealtimeChannel>(
      supabase.realtime,
      `voice-elsewhere:${userId}`,
      [
        {
          event: "*",
          schema: "public",
          table: "voice_participants",
          // `voice_participants` carries `replica identity full`, so a DELETE
          // payload carries this column too and the filter holds for the event
          // that matters most: the other device leaving.
          filter: `user_id=eq.${userId}`,
          handler: () => void refresh(),
        },
      ],
    );
    return () => {
      for (const entry of opened) void supabase.removeChannel(entry.channel);
    };
  }, [refresh, supabase, userId]);

  // A tab asleep for an hour wakes with whatever the last event left, and
  // Realtime reconnects without replaying. The presence reader re-reads on
  // return for the same reason; this one matters more, because the device
  // coming back is often the one being picked up.
  useEffect(() => {
    if (!userId) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh, userId]);
}
