import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { onChannelActivity } from "@/lib/channelActivity";
import { channelToBump, readUnreadCounts } from "@/lib/channelUnread";

/**
 * Each channel's unread count while a server's channel list is on screen
 * (tracker item 54). Read once when the list is shown for a chat, then kept
 * current from the open conversation's socket, which already hears every
 * channel of the chat (`lib/channelActivity.ts`); the channel being read counts
 * nothing, because it is read as it arrives.
 *
 * A database without `channel_unread_counts` answers with an error, and the list
 * is drawn without counts, as it was.
 */
export function useChannelUnread(
  chatId: string | null,
  viewingKey: string | null,
  generalTopicIds: readonly string[],
  selfId: string | null,
): ReadonlyMap<string, number> {
  const [counts, setCounts] = useState<ReadonlyMap<string, number>>(() => new Map());
  // The list's socket and the conversation's both hand the same message over
  // (`lib/channelActivity.ts`); a line is idempotent, a count is not.
  const counted = useRef(new Set<string>());
  const generalKey = generalTopicIds.join(",");
  const general = useMemo(() => (generalKey ? generalKey.split(",") : []), [generalKey]);

  useEffect(() => {
    counted.current = new Set();
    if (!chatId || !selfId) {
      setCounts((current) => (current.size ? new Map() : current));
      return undefined;
    }
    let active = true;
    void createClient()
      .rpc("channel_unread_counts", { p_chat_id: chatId })
      .then(({ data, error }) => {
        if (!active) return;
        setCounts(error ? new Map() : readUnreadCounts(data));
      });
    return () => {
      active = false;
    };
  }, [chatId, selfId]);

  // The channel being read counts nothing, from the moment it is opened.
  useEffect(() => {
    if (!viewingKey) return;
    setCounts((current) => {
      if (!current.get(viewingKey)) return current;
      const next = new Map(current);
      next.set(viewingKey, 0);
      return next;
    });
  }, [viewingKey]);

  useEffect(() => {
    if (!chatId) return undefined;
    return onChannelActivity((message) => {
      if (message.chat_id !== chatId) return;
      const key = channelToBump(message, selfId, viewingKey, general);
      if (!key || counted.current.has(message.id)) return;
      counted.current.add(message.id);
      setCounts((current) => {
        const next = new Map(current);
        next.set(key, (current.get(key) ?? 0) + 1);
        return next;
      });
    });
  }, [chatId, selfId, viewingKey, general]);

  return counts;
}
