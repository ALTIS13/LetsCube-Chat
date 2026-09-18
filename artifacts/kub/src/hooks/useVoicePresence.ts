"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { subscribeByTable } from "@/lib/realtimeTableChannels";
import {
  chatVoicePresence,
  mergeVoicePresence,
  readVoicePresenceRows,
  type ChatVoicePresence,
} from "@/lib/voicePresence";
import { readVoiceRingRows } from "@/lib/voiceRing";
import { publishVoiceRings, setVoiceRingViewer } from "@/hooks/useVoiceRing";

/**
 * Which of the reader's conversations have somebody talking in them (slice 3).
 *
 * The rules are `lib/voicePresence.ts` and are pure. What is here is the one
 * read, the one subscription, and the way a row subscribes to **its own
 * answer** rather than to the whole map.
 *
 * ## Why this is module state and a primitive, not a context
 *
 * The chat list is the most render-sensitive surface in this application and it
 * already has a measured contract — `tests/e2e/chat-list-event-cost.spec.ts`.
 * A map of chats handed to every row through context renders every row whenever
 * anybody anywhere joins or leaves a call. `useVoiceSpeaking` had exactly that
 * problem and was measured at 190 face renders for 10 speaker changes before it
 * became a boolean per person; this follows it.
 *
 * So the map lives in module state, and `useChatVoicePresence(chatId)` hands one
 * row **its own entry**. `useSyncExternalStore` compares with `Object.is`, and
 * the entries are rebuilt whole on every read — so an entry is a new object
 * each time and `Object.is` would be false for every row on every event. That
 * is why `read` below returns the *held* entry and the store only replaces an
 * entry when its own numbers changed: the comparison is done once, here, rather
 * than N times in React.
 *
 * ## One channel, one table
 *
 * `voice_channels` is in the `supabase_realtime` publication (checked on
 * production 2026-09-18), and this binding carries **no filter**: RLS decides
 * what the reader may see, which is exactly the set of chats their list holds.
 * One binding rather than one per chat, because a filter per chat would be a
 * channel whose binding count grows with the list — and `subscribeByTable`
 * groups by table for the reason its own header records.
 *
 * `voice_participants` is deliberately not watched here. It would make the
 * count exact instead of up to one reconciliation period stale, at the price of
 * an event per join per room across every conversation in the list — and the
 * mark is a glyph and a number.
 */

/** The held answer, one entry per chat that has somebody in a room. */
let byChat: ReadonlyMap<string, ChatVoicePresence> = new Map<string, ChatVoicePresence>();
const listeners = new Set<() => void>();

function publish(next: Map<string, ChatVoicePresence>) {
  // The merge is a rule and lives in the pure module, so it has a test: it
  // hands back the held map itself when nothing changed, which is how a call
  // in one conversation costs the list one row rather than all of them.
  const merged = mergeVoicePresence(byChat, next);
  if (merged === byChat) return;
  byChat = merged;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * One entry, or null. The value a row renders from.
 *
 * `null` rather than a zeroed entry: «no call here» and «a call with nobody in
 * it» are different facts, and only the first one is real — a room with nobody
 * in it is not in the read at all.
 */
export function useChatVoicePresence(chatId: string | null): ChatVoicePresence | null {
  const read = useCallback(() => (chatId ? byChat.get(chatId) ?? null : null), [chatId]);
  return useSyncExternalStore(subscribe, read, read);
}

/** Read once, outside React, for a test or a probe. */
export function voicePresenceSnapshot(): ReadonlyMap<string, ChatVoicePresence> {
  return byChat;
}

/**
 * The reader for the whole list, mounted once.
 *
 * Mounted by `Sidebar`, which is the one component guaranteed to exist while a
 * chat list is on screen. It renders nothing and returns nothing: every reader
 * takes its answer through `useChatVoicePresence`, so this hook's own render is
 * the only one a call anywhere costs the list.
 */
export function useVoicePresenceReader(userId: string | null): void {
  const supabase = createClient();
  const enabled = userId !== null;
  // One in-flight read at a time. A burst of events — somebody joining a room
  // with four people in it produces four — would otherwise start four reads
  // whose answers can arrive out of order, and the last to land wins rather
  // than the newest.
  const running = useRef(false);
  const again = useRef(false);

  const refresh = useCallback(async () => {
    if (running.current) {
      again.current = true;
      return;
    }
    running.current = true;
    try {
      for (;;) {
        again.current = false;
        /**
         * Somebody in the room, **or** a ring on it — and the second half is
         * the single most important line in slice A of the one-to-one calls.
         *
         * Until 2026-09-18 this read was `.gt("participant_count", 0)` alone,
         * and a ringing room has nobody in it. So the ring was invisible to the
         * very subscription the whole design rests on: the row changed, the
         * handler fired, the re-read asked for occupied rooms and the ring was
         * not one. Nothing on any screen could have said somebody was calling.
         *
         * The three ring columns are selected explicitly. They carry a
         * column-level `GRANT SELECT` and nothing else — a ring is set only
         * through the four functions — and Realtime sends only what the
         * subscribing role may read, which is what that grant is for.
         *
         * `readStartedAt` is taken **before** the query goes out, because the
         * ring store uses it to decide whether an answer that lacks the
         * caller's own ring is evidence that the ring is gone or merely a read
         * that predates it.
         */
        const readStartedAt = Date.now();
        const { data, error } = await supabase
          .from("voice_channels" as never)
          .select(
            "id,chat_id,name,participant_count,archived,ring_started_at,ring_caller,ring_answered_at",
          )
          .or("participant_count.gt.0,ring_started_at.not.is.null")
          .eq("archived", false);
        // A refused read is not «nobody is talking». The held answer stays, and
        // the mark stays with it, because a list that quietly stops mentioning
        // calls is the defect this exists to fix rather than a safe default.
        // The ring follows the same rule, and more sharply: publishing an empty
        // set from a failed read would tell every device that every call had
        // just ended.
        if (!error) {
          publish(chatVoicePresence(readVoicePresenceRows(data, Date.now())));
          publishVoiceRings(readVoiceRingRows(data), readStartedAt);
        }
        if (!again.current) break;
      }
    } finally {
      running.current = false;
    }
  }, [supabase]);

  // Who is reading, handed to the ring store: it has to know whose ring ran out
  // before it may write `missed`, and only the caller's own device does that.
  useEffect(() => {
    setVoiceRingViewer(userId);
  }, [userId]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const opened = subscribeByTable<(payload: unknown) => void, RealtimeChannel>(
      supabase.realtime,
      "voice-presence",
      [{ event: "*", schema: "public", table: "voice_channels", handler: () => void refresh() }],
    );
    return () => {
      for (const entry of opened) void supabase.removeChannel(entry.channel);
    };
  }, [enabled, refresh, supabase]);

  // The list is not the only thing that can be stale: a tab asleep for an hour
  // wakes with whatever the last event left. Realtime reconnects on its own and
  // replays nothing, so the answer is re-read on return rather than trusted.
  useEffect(() => {
    if (!enabled) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [enabled, refresh]);
}
