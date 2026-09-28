/**
 * How much in each channel of a server is unread (tracker item 54, the unread
 * half). The testers asked for Telegram's topic list, where every topic carries
 * its own unread count; `20260929090000_channel_reads.sql` keeps one read mark
 * per channel beside the chat's own and answers `channel_unread_counts`.
 *
 * A channel is filed under `general` for the chat's general conversation —
 * the rail's synthetic general row or a topic flagged general — and under its
 * topic id otherwise, which is how the database keys it.
 *
 * Imports nothing, so `tests/unit/channel-unread.test.mts` reaches it directly.
 */

export const GENERAL_CHANNEL_KEY = "general";
/** The id `lib/channelRail.ts` gives the general row of a group without topics. */
const SYNTHETIC_GENERAL_ID = "general";

/** The key a rail row is filed under. */
export function channelReadKey(channel: { id: string; isGeneral?: boolean }): string {
  if (channel.isGeneral === true || channel.id === SYNTHETIC_GENERAL_ID) return GENERAL_CHANNEL_KEY;
  return channel.id;
}

/** The key a message is counted under, by its topic. */
export function channelKeyForTopic(topicId: string | null | undefined, generalTopicIds: readonly string[]): string {
  if (!topicId || generalTopicIds.includes(topicId)) return GENERAL_CHANNEL_KEY;
  return topicId;
}

/** What the badge says: nothing, the number, or «99+» as Telegram caps it. */
export function unreadBadgeLabel(count: number | null | undefined): string | null {
  if (!count || count <= 0 || !Number.isFinite(count)) return null;
  return count > 99 ? "99+" : String(Math.floor(count));
}

/** The database's answer, or an empty map for anything else. */
export function readUnreadCounts(rows: unknown): Map<string, number> {
  const counts = new Map<string, number>();
  if (!Array.isArray(rows)) return counts;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const { channel, unread } = row as { channel?: unknown; unread?: unknown };
    if (typeof channel !== "string" || typeof unread !== "number" || !Number.isFinite(unread)) continue;
    counts.set(channel, Math.max(0, Math.floor(unread)));
  }
  return counts;
}

export interface HeardMessage {
  user_id?: string | null;
  bot_id?: string | null;
  topic_id?: string | null;
  type?: string | null;
  deleted_at?: string | null;
}

/**
 * The channel a message heard live adds one to, or null: not the reader's own,
 * not a notice, not deleted, and not in the channel being read, which is read
 * as it arrives.
 */
export function channelToBump(
  message: HeardMessage,
  selfId: string | null,
  viewingKey: string | null,
  generalTopicIds: readonly string[],
): string | null {
  if (message.deleted_at) return null;
  if ((message.type ?? "text") === "system") return null;
  if (!message.bot_id && (!message.user_id || message.user_id === selfId)) return null;
  const key = channelKeyForTopic(message.topic_id, generalTopicIds);
  return key === viewingKey ? null : key;
}
