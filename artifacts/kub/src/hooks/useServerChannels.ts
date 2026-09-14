"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { subscribeByTable } from "@/lib/realtimeTableChannels";
import { buildChannelTree, type ChannelCategory, type ChannelGroup, type ServerChannel } from "@/lib/serverChannels";
import {
  categoryFromRow,
  textChannelFromTopic,
  voiceChannelFromRow,
  withGeneralChannel,
  type ChannelCategoryRow,
  type TopicRow,
  type VoiceChannelRow,
} from "@/lib/channelRail";
import { classifyVoiceChannelWriteError } from "@/lib/voiceChannel";

/**
 * A group's channels — every one of them — and who is in each room.
 *
 * This replaces the read that made the product look like it had one voice
 * channel: `useVoiceChannel` asked for `.limit(1)` while the database has
 * carried «admins manage voice channels» FOR ALL since the voice work, so an
 * administrator could always have had as many rooms as they liked and the
 * interface could only ever show the first.
 *
 * **The text channels are handed in rather than read here, and that is not
 * only to save a query.** `useTopics` is the product's decision about what a
 * text channel is: it reads `topics` for a forum and refuses to for anything
 * else, and it resets `selectedTopicId` to null in a chat that is not one. A
 * second reader would list rows in a group where selecting them does nothing,
 * because `useMessages` is given `undefined` for the topic outside forum mode.
 * One reader, one answer.
 *
 * Everything here is a read. `voice_participants` has no INSERT, UPDATE or
 * DELETE policy at all — the rows arrive from the SFU's webhooks and from the
 * reconciler, which is what makes the list correct when a client vanishes
 * without saying so.
 */

export interface ServerChannelsView {
  /** False where this deployment has no `voice_channels` table — see below. */
  supported: boolean;
  /** False until the first read has come back, so an empty rail is not drawn as «пусто». */
  ready: boolean;
  /**
   * The chat this answer was read for, and null before the first read.
   *
   * Opening another conversation changes the argument without clearing what is
   * held, so for a moment this view is the **previous** chat's answer. Harmless
   * where it names a row, dangerous where a decision is made from it: see
   * `voiceCallLostItsChannel`, which hangs up a call on «this chat has no such
   * channel» and therefore compares against this field rather than the argument.
   */
  chatId: string | null;
  categories: ChannelCategory[];
  /** Text channels and rooms together, with the conversation guaranteed among them. */
  channels: ServerChannel[];
  /** The rail, in drawing order. */
  groups: ChannelGroup[];
  /** Who is in each room, by channel id. Ids only; names come from the member list. */
  participants: ReadonlyMap<string, string[]>;
  refresh: () => void;
}

const NO_PARTICIPANTS: ReadonlyMap<string, string[]> = new Map();

const EMPTY: ServerChannelsView = {
  supported: true,
  ready: false,
  chatId: null,
  categories: [],
  channels: [],
  groups: [],
  participants: NO_PARTICIPANTS,
  refresh: () => undefined,
};

/** What was read from the two tables this hook owns. */
interface ServerChannelsRead {
  supported: boolean;
  chatId: string;
  categories: ChannelCategory[];
  voice: ServerChannel[];
  participants: Map<string, string[]>;
}

export function useServerChannels(
  chatId: string | null,
  enabled: boolean,
  topics: readonly TopicRow[],
): ServerChannelsView {
  const supabase = useMemo(() => createClient(), []);
  const [read, setRead] = useState<ServerChannelsRead | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (!enabled || !chatId) {
      setRead(null);
      return;
    }
    let cancelled = false;

    void (async () => {
      // `as any` on both table names: neither `voice_channels` nor
      // `chat_channel_categories` is in the generated database types, which
      // were generated from a schema older than both migrations. The same cast
      // `lib/achievements.ts` and `lib/support/userTickets.ts` already use.
      const [categoryRead, channelRead] = await Promise.all([
        supabase
          .from("chat_channel_categories" as any)
          .select("id,name,position,created_at")
          .eq("chat_id", chatId),
        supabase
          .from("voice_channels" as any)
          .select("id,name,position,max_participants,speak_role,participant_count,archived,category_id,created_at")
          .eq("chat_id", chatId)
          .eq("archived", false),
      ]);
      if (cancelled) return;

      // A deployment without the voice tables must show no rooms and no error,
      // because the migration, the gateway and this interface are three
      // separate pieces of work. A deployment without the **categories** table
      // is the same day seen from the other side: the rail still draws, every
      // channel is simply uncategorised.
      const supported = !(channelRead.error && classifyVoiceChannelWriteError(channelRead.error) === "unsupported");
      const categories = categoryRead.error
        ? []
        : ((categoryRead.data as unknown as ChannelCategoryRow[] | null) ?? []).map(categoryFromRow);
      const voice = channelRead.error
        ? []
        : ((channelRead.data as unknown as VoiceChannelRow[] | null) ?? []).map(voiceChannelFromRow);

      const participants = new Map<string, string[]>();
      if (voice.length > 0) {
        const inside = await supabase
          .from("voice_participants" as any)
          .select("channel_id,user_id")
          .in("channel_id", voice.map((room) => room.id));
        if (cancelled) return;
        if (!inside.error) {
          for (const row of (inside.data as unknown as { channel_id: string; user_id: string }[] | null) ?? []) {
            const held = participants.get(row.channel_id);
            if (held) held.push(row.user_id);
            else participants.set(row.channel_id, [row.user_id]);
          }
        }
      }

      setRead({ supported, chatId, categories, voice, participants });
    })();

    return () => {
      cancelled = true;
    };
  }, [chatId, enabled, nonce, supabase]);

  const channels = useMemo(() => {
    const text = topics.map(textChannelFromTopic);
    return withGeneralChannel([...text, ...(read?.voice ?? [])]);
  }, [read, topics]);

  const groups = useMemo(
    () => buildChannelTree({ categories: read?.categories ?? [], channels }),
    [channels, read],
  );

  // Realtime, one channel per table: a binding to a table outside the
  // publication silently kills every other binding on its channel while still
  // reporting SUBSCRIBED (`realtimeTableChannels.ts`). `topics` is deliberately
  // absent — `useTopics` already watches it, and a second subscription to the
  // same rows would be a second answer to the same question.
  //
  // `voice_participants` carries no `chat_id`, so it gets one binding per room.
  // They land on one channel because they are one table, which is exactly what
  // the grouping rule allows.
  const roomIds = useMemo(() => (read?.voice ?? []).map((room) => room.id).join(","), [read]);
  const supported = read?.supported ?? true;
  useEffect(() => {
    if (!enabled || !chatId || !supported) return;
    const rooms = roomIds ? roomIds.split(",") : [];
    const opened = subscribeByTable<(payload: unknown) => void, RealtimeChannel>(
      supabase.realtime,
      `server-channels:${chatId}`,
      [
        {
          event: "*",
          schema: "public",
          table: "voice_channels",
          filter: `chat_id=eq.${chatId}`,
          handler: refresh,
        },
        {
          event: "*",
          schema: "public",
          table: "chat_channel_categories",
          filter: `chat_id=eq.${chatId}`,
          handler: refresh,
        },
        ...rooms.map((id) => ({
          event: "*" as const,
          schema: "public",
          table: "voice_participants",
          filter: `channel_id=eq.${id}`,
          handler: refresh,
        })),
      ],
    );
    return () => {
      for (const entry of opened) void supabase.removeChannel(entry.channel);
    };
  }, [chatId, enabled, refresh, roomIds, supabase, supported]);

  return useMemo(() => {
    if (!read) return { ...EMPTY, refresh };
    return {
      supported: read.supported,
      ready: true,
      chatId: read.chatId,
      categories: read.categories,
      channels,
      groups,
      participants: read.participants,
      refresh,
    };
  }, [channels, groups, read, refresh]);
}
