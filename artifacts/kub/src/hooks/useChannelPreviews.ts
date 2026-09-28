"use client";

import { useEffect, useMemo, useState } from "react";
import { onChannelActivity } from "@/lib/channelActivity";
import { channelPreviewOf, type ChannelPreview } from "@/lib/channelPreview";
import { channelPreviewCache } from "@/lib/channelPreviewCache";
import { clearedAtCache } from "@/lib/clearedAtCache";
import { MESSAGE_LAST_MESSAGE_SELECT } from "@/lib/messageProjection";
import { CONNECTION_REVIVED_EVENT } from "@/lib/realtimeRevival";
import type { ChannelGroup } from "@/lib/serverChannels";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";
import type { MessageWithSender } from "@/types/database";

/** How many of a channel's newest messages to read, so one hidden for this reader does not blank it. */
const LOOKBACK = 5;

// What either socket hears moves the kept lines, whether or not a list is on
// screen: a server read once stays current while it is closed. A row from a
// socket carries no joined sender, so the chat's own member list names them,
// as the conversation fills it in for its own rows.
onChannelActivity((message) => {
  const known = message.sender
    ? message
    : {
        ...message,
        sender:
          useAppStore.getState().chats.find((chat) => chat.id === message.chat_id)?.members?.find((member) => member.user_id === message.user_id)
            ?.profile ?? null,
      };
  channelPreviewCache.hear(known as MessageWithSender);
});

// Back from a gap in the connection, anything may have been missed.
if (typeof window !== "undefined") window.addEventListener(CONNECTION_REVIVED_EVENT, () => channelPreviewCache.clear());

/**
 * Each text channel's last line — who, what, when — for the channel list
 * (tracker item 54; the row is `lib/channelPreview.ts`).
 *
 * Read once per server, one small read per text channel, and kept
 * (`lib/channelPreviewCache.ts`): reopening a server reads nothing for its
 * list. The history's own rules hold: a chat cleared for this reader shows
 * nothing from before the clearing, and a message this reader hid for
 * themselves is never the preview.
 */
export function useChannelPreviews(
  chatId: string | null,
  groups: readonly ChannelGroup[],
  generalTopicIds: readonly string[],
  selfId: string | null,
): ReadonlyMap<string, ChannelPreview> {
  const [previews, setPreviews] = useState<ReadonlyMap<string, ChannelPreview>>(() => new Map());

  const textChannels = useMemo(
    () => groups.flatMap((group) => group.channels).filter((channel) => channel.kind === "text"),
    [groups],
  );
  const channelsKey = textChannels.map((channel) => `${channel.id}:${channel.isGeneral ? 1 : 0}`).join(",");
  const generalChannelId = textChannels.find((channel) => channel.isGeneral)?.id ?? null;
  const generalKey = generalTopicIds.join(",");

  useEffect(() => {
    if (!chatId || !selfId || !channelsKey) {
      setPreviews((current) => (current.size ? new Map() : current));
      return undefined;
    }
    let active = true;
    const supabase = createClient();
    const general = generalKey ? generalKey.split(",") : [];
    const scope = { selfId, channelsKey, generalChannelId, general };

    const readChannel = async (channelId: string, isGeneral: boolean, clearedAt: string | null) => {
      // The chat list's own preview projection: a line needs its sender and
      // bot, not the reactions and replied-to rows a conversation page reads.
      let query = supabase
        .from("messages")
        .select(MESSAGE_LAST_MESSAGE_SELECT)
        .eq("chat_id", chatId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(LOOKBACK);
      if (isGeneral) {
        query = general.length ? query.or(`topic_id.is.null,topic_id.in.(${general.join(",")})`) : query.is("topic_id", null);
      } else {
        query = query.eq("topic_id", channelId);
      }
      if (clearedAt) query = query.gt("created_at", clearedAt);
      const { data, error } = await query;
      if (error || !data) return null;
      const rows = data as unknown as MessageWithSender[];
      if (!rows.length) return null;
      const { data: hidden } = await supabase
        .from("message_hidden_for_users")
        .select("message_id")
        .in("message_id", rows.map((row) => row.id));
      const hiddenIds = new Set((hidden ?? []).map((row: { message_id: string }) => row.message_id));
      for (const row of rows) {
        if (hiddenIds.has(row.id)) continue;
        const preview = channelPreviewOf(row, channelId, selfId);
        if (preview) return preview;
      }
      return null;
    };

    const load = async () => {
      const token = channelPreviewCache.begin(chatId, scope);
      const clearedAt = await clearedAtCache
        .getOrLoad(chatId, selfId, async () => {
          const { data, error } = await supabase
            .from("chat_members")
            .select("cleared_at")
            .eq("chat_id", chatId)
            .eq("user_id", selfId)
            .maybeSingle();
          return { value: data?.cleared_at ?? null, ok: !error };
        })
        .catch(() => undefined);
      const found = await Promise.all(
        channelsKey.split(",").map((entry) => {
          const [channelId, isGeneral] = entry.split(":");
          return readChannel(channelId, isGeneral === "1", clearedAt ?? null).catch(() => null);
        }),
      );
      const answered = channelPreviewCache.complete(
        chatId,
        token,
        found.filter((preview): preview is ChannelPreview => preview !== null),
      );
      if (active && answered) setPreviews(answered);
    };

    const show = () => {
      const held = channelPreviewCache.read(chatId, scope);
      if (held) {
        setPreviews(held);
        return;
      }
      setPreviews((current) => (current.size ? new Map() : current));
      void load();
    };
    show();

    const stop = channelPreviewCache.subscribe((changed) => {
      if (!active || (changed !== chatId && changed !== "*")) return;
      // Moved by a message: draw it. Dropped: read it again.
      show();
    });

    return () => {
      active = false;
      stop();
    };
  }, [chatId, selfId, channelsKey, generalChannelId, generalKey]);

  return previews;
}
