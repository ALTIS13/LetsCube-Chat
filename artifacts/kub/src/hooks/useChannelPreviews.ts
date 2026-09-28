"use client";

import { useEffect, useMemo, useState } from "react";
import { onChannelActivity } from "@/lib/channelActivity";
import { channelOfMessage, channelPreviewOf, laterPreview, type ChannelPreview } from "@/lib/channelPreview";
import { clearedAtCache } from "@/lib/clearedAtCache";
import { MESSAGE_SELECT_WITH_JOINS } from "@/lib/messageProjection";
import type { ChannelGroup } from "@/lib/serverChannels";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";
import type { MessageWithSender } from "@/types/database";

/** How many of a channel's newest messages to read, so one hidden for this reader does not blank it. */
const LOOKBACK = 5;

/**
 * Each text channel's last line — who, what, when — for the channel list
 * (tracker item 54; the row is `lib/channelPreview.ts`).
 *
 * One small read per text channel when the list is shown, then kept current
 * from the open conversation's own socket (`lib/channelActivity.ts`), which
 * already hears every channel of the chat. The history's own rules hold: a
 * chat cleared for this reader shows nothing from before the clearing, and a
 * message this reader hid for themselves is never the preview.
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
    setPreviews(new Map());
    if (!chatId || !selfId || !channelsKey) return undefined;
    let active = true;
    const supabase = createClient();
    const general = generalKey ? generalKey.split(",") : [];

    const readChannel = async (channelId: string, isGeneral: boolean, clearedAt: string | null) => {
      let query = supabase
        .from("messages")
        .select(MESSAGE_SELECT_WITH_JOINS)
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

    void (async () => {
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
      if (!active) return;
      setPreviews((current) => {
        const next = new Map(current);
        for (const preview of found) if (preview) next.set(preview.channelId, laterPreview(next.get(preview.channelId), preview));
        return next;
      });
    })();

    const stop = onChannelActivity((message) => {
      if (message.chat_id !== chatId || message.deleted_at) return;
      const channelId = channelOfMessage(message, generalChannelId, general);
      if (!channelId) return;
      // A row from the socket carries no joined sender: the chat's own member
      // list names them, as the conversation fills it in for its own rows.
      const known = message.sender
        ? message
        : {
            ...message,
            sender:
              useAppStore.getState().chats.find((chat) => chat.id === chatId)?.members?.find((member) => member.user_id === message.user_id)?.profile ??
              null,
          };
      const preview = channelPreviewOf(known as MessageWithSender, channelId, selfId);
      if (!preview) return;
      setPreviews((current) => {
        const next = new Map(current);
        next.set(channelId, laterPreview(next.get(channelId), preview));
        return next;
      });
    });

    return () => {
      active = false;
      stop();
    };
  }, [chatId, selfId, channelsKey, generalChannelId, generalKey]);

  return previews;
}
