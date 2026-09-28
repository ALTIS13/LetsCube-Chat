import type { MessageWithSender } from "../types/database.ts";
import { messageActorDisplayName } from "./messageActor.ts";
import { formatChatMessagePreview } from "./messagePreview.ts";

/**
 * What a server's text channel says about itself in the channel list: who wrote
 * last, what, and when (tracker item 54).
 *
 * The report, 2026-09-28, forwarded from a second tester with Telegram's topic
 * list beside ours: «ты когда заходишь к нам ты не видишь вот этих каналов в
 * формате последнего сообщения… тебе надо будет протыкивать каждый канал
 * вручную смотреть, а написали там что-то или не написали». Telegram's forum
 * topic list, in that screenshot, draws each topic as a chat row: its icon, its
 * title, the last sender's name, a line of what they wrote, and the time. That
 * is the row adopted here, inside the server's channel list, whose other half —
 * the voice rooms with their people under them — stays Discord's.
 *
 * Pure, so `node --test` reads every case.
 */

export interface ChannelPreview {
  channelId: string;
  /** «Вы» for the reader's own message; the author's name otherwise. */
  sender: string;
  text: string;
  at: string;
  messageId: string;
}

type PreviewSource = Pick<
  MessageWithSender,
  "id" | "topic_id" | "user_id" | "created_at" | "deleted_at" | "type" | "content" | "media_url"
> &
  Partial<MessageWithSender>;

/**
 * Which channel a message belongs to. The general channel is the one with
 * `topic_id` null or one of the `is_general` topics' ids — the same rule the
 * conversation reads its history by (`messageBelongsToTopic`).
 */
export function channelOfMessage(
  message: Pick<MessageWithSender, "topic_id">,
  generalChannelId: string | null,
  generalTopicIds: readonly string[],
): string | null {
  const topic = message.topic_id ?? null;
  if (topic === null || generalTopicIds.includes(topic)) return generalChannelId;
  return topic;
}

export function channelPreviewOf(
  message: PreviewSource,
  channelId: string,
  selfId: string | null,
): ChannelPreview | null {
  if (message.deleted_at) return null;
  const text = formatChatMessagePreview(message as MessageWithSender, selfId).replace(/\s+/g, " ").trim();
  if (!text) return null;
  const own = Boolean(selfId && message.user_id === selfId && !message.bot_id);
  return {
    channelId,
    sender: own ? "Вы" : senderShortName(message),
    text,
    at: message.created_at,
    messageId: message.id,
  };
}

/**
 * A person by their first name, as Telegram's group previews print a sender:
 * «Анна: Смена закрыта», not «Анна Смирнова: Смена закры…» in a 224px column.
 * A bot, a deleted account or a nickname-only profile keeps the name the
 * conversation prints, which is already one word or deliberately whole.
 */
function senderShortName(message: PreviewSource): string {
  const whole = messageActorDisplayName(message as MessageWithSender);
  const fullName = (message.sender as { full_name?: string | null } | null | undefined)?.full_name?.trim();
  if (message.bot_id || !fullName || whole !== fullName) return whole;
  return fullName.split(/\s+/)[0] || whole;
}

/** The later of two previews of one channel; a tie keeps the one held. */
export function laterPreview(held: ChannelPreview | undefined, next: ChannelPreview): ChannelPreview {
  if (!held) return next;
  return Date.parse(next.at) > Date.parse(held.at) ? next : held;
}
