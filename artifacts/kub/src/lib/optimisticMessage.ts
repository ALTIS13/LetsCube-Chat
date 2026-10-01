import type { Json, MessageWithSender, Profile } from "../types/database.ts";
import { emptyMessageMentions, type MessageMentionsV1 } from "./memberMentions.ts";

export type SendableMessageType = Extract<MessageWithSender["type"], "text" | "image" | "video" | "audio" | "file">;

export interface OptimisticMessageInput {
  chatId: string;
  topicId: string | null;
  user: Profile;
  type: SendableMessageType;
  content: string | null;
  mentionEntities?: MessageMentionsV1;
  mediaBucket?: string | null;
  mediaPath?: string | null;
  mediaUrl?: string | null;
  replyToId?: string | null;
  forwardedFromId?: string | null;
  mediaMetadata?: Json | null;
  clientMessageId: string;
  clientSentAt: string;
  tempId: string;
}

/**
 * The message a send puts in the conversation before the server has answered.
 *
 * One shape for both of the places that make one: `sendLocalMessage`, which
 * inserts a row, and an attachment that is still on its way to storage (D-314),
 * which is shown the moment «Отправить» is pressed and becomes the first when
 * its bytes are up. Two builders would drift, and a placeholder that differed
 * from its own replacement in any field the bubble reads would jump when it was
 * replaced.
 */
export function buildOptimisticMessage(input: OptimisticMessageInput): MessageWithSender {
  return {
    id: input.tempId,
    chat_id: input.chatId,
    topic_id: input.topicId,
    user_id: input.user.id,
    bot_id: null,
    bot_input_field_placeholder: null,
    bot_reply_markup: null,
    content: input.content,
    ...{ mention_entities: { ...structuredClone(input.mentionEntities ?? emptyMessageMentions()) } },
    type: input.type,
    // Never anything else on a row a client wrote: the column is only ever
    // set by `voice_call_stop`, on a `system` row nothing here can produce.
    system_payload: null,
    media_bucket: input.mediaBucket ?? null,
    media_path: input.mediaPath ?? null,
    media_url: input.mediaUrl ?? null,
    reply_to_id: input.replyToId ?? null,
    forwarded_from_id: input.forwardedFromId ?? null,
    edited_at: null,
    deleted_at: null,
    pinned: false,
    created_at: input.clientSentAt,
    client_message_id: input.clientMessageId,
    client_sent_at: input.clientSentAt,
    media_metadata: input.mediaMetadata ?? null,
    sender: input.user,
    reactions: [],
    pending: true,
    checking: false,
    failed: false,
    send_error: null,
  };
}
