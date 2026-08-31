import { BotApiError } from "#bot/errors";
import type {
  BotMethodFingerprint,
  BotMethodHandlers,
} from "#bot/methodRouter";
import type {
  BotMessageCommand,
  BotMethodRepository,
} from "#bot/repository";
import type { BotMethodInputMap } from "#bot/schemas";

export type BotChatActionPublisher = (payload: {
  botId: string;
  chatId: string;
  action: string;
  topicId?: string;
}) => Promise<void>;

type MediaMethod = "sendPhoto" | "sendVideo" | "sendDocument" | "sendVoice";
type MediaKind = Extract<BotMessageCommand["kind"], "image" | "video" | "file" | "audio">;

const MEDIA_KIND: Record<MediaMethod, MediaKind> = {
  sendPhoto: "image",
  sendVideo: "video",
  sendDocument: "file",
  sendVoice: "audio",
};

const MEDIA_MIME: Record<MediaMethod, ReadonlySet<string>> = {
  sendPhoto: new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]),
  sendVideo: new Set(["video/mp4", "video/webm"]),
  sendDocument: new Set(["application/pdf"]),
  sendVoice: new Set(["audio/webm", "audio/ogg", "audio/mpeg"]),
};

function optionalReplyPayload(input: {
  topic_id?: string;
  reply_to_message_id?: string;
  reply_markup?: unknown;
}): Record<string, unknown> {
  return {
    ...(input.topic_id ? { topic_id: input.topic_id } : {}),
    ...(input.reply_to_message_id
      ? { reply_to_id: input.reply_to_message_id }
      : {}),
    ...(input.reply_markup ? { reply_markup: input.reply_markup } : {}),
  };
}

async function sendMedia(
  method: MediaMethod,
  repository: BotMethodRepository,
  fingerprint: BotMethodFingerprint,
  botId: string,
  input: BotMethodInputMap[MediaMethod],
): Promise<unknown> {
  if (!MEDIA_MIME[method].has(input.media.mime_type)) {
    throw new BotApiError("validation_failed");
  }
  const kind = MEDIA_KIND[method];
  await repository.authorizeMedia({
    botId,
    chatId: input.chat_id,
    bucket: input.media.bucket,
    objectPath: input.media.object_path,
    mimeType: input.media.mime_type,
    sizeBytes: input.media.size_bytes,
    expiresInSeconds: 60,
  });
  const operation = await repository.executeMessageCommand({
    botId,
    chatId: input.chat_id,
    kind,
    payload: {
      ...(input.caption ? { text: input.caption } : {}),
      media_bucket: input.media.bucket,
      media_path: input.media.object_path,
      media_metadata: {
        mime_type: input.media.mime_type,
        size: input.media.size_bytes,
        kind,
      },
      ...optionalReplyPayload(input),
    },
    idempotencyKey: input.idempotency_key,
    requestFingerprint: fingerprint(method, input),
  });
  return operation.result;
}

export function createMessageHandlers(
  repository: BotMethodRepository,
  fingerprint: BotMethodFingerprint,
  publishChatAction: BotChatActionPublisher,
): Pick<
  BotMethodHandlers,
  | "sendMessage"
  | "sendPhoto"
  | "sendVideo"
  | "sendDocument"
  | "sendVoice"
  | "sendChatAction"
  | "editMessageText"
  | "deleteMessage"
  | "answerCallbackQuery"
> {
  return {
    async sendMessage(context, input) {
      const operation = await repository.executeMessageCommand({
        botId: context.bot.botId,
        chatId: input.chat_id,
        kind: "text",
        payload: {
          text: input.text,
          ...optionalReplyPayload(input),
        },
        idempotencyKey: input.idempotency_key,
        requestFingerprint: fingerprint("sendMessage", input),
      });
      return operation.result;
    },

    sendPhoto: (context, input) =>
      sendMedia("sendPhoto", repository, fingerprint, context.bot.botId, input),
    sendVideo: (context, input) =>
      sendMedia("sendVideo", repository, fingerprint, context.bot.botId, input),
    sendDocument: (context, input) =>
      sendMedia("sendDocument", repository, fingerprint, context.bot.botId, input),
    sendVoice: (context, input) =>
      sendMedia("sendVoice", repository, fingerprint, context.bot.botId, input),

    async sendChatAction(context, input) {
      const operation = await repository.executeMessageCommand({
        botId: context.bot.botId,
        chatId: input.chat_id,
        kind: "chat_action",
        payload: {
          action: input.action,
          ...(input.topic_id ? { topic_id: input.topic_id } : {}),
        },
        idempotencyKey: input.idempotency_key,
        requestFingerprint: fingerprint("sendChatAction", input),
      });
      if (!operation.duplicate) {
        await publishChatAction({
          botId: context.bot.botId,
          chatId: input.chat_id,
          action: input.action,
          ...(input.topic_id ? { topicId: input.topic_id } : {}),
        });
      }
      return operation.result;
    },

    async editMessageText(context, input) {
      const operation = await repository.executeMessageCommand({
        botId: context.bot.botId,
        chatId: input.chat_id,
        kind: "edit",
        payload: {
          message_id: input.message_id,
          text: input.text,
          reply_markup: input.reply_markup ?? null,
        },
        idempotencyKey: input.idempotency_key,
        requestFingerprint: fingerprint("editMessageText", input),
      });
      return operation.result;
    },

    async deleteMessage(context, input) {
      const operation = await repository.executeMessageCommand({
        botId: context.bot.botId,
        chatId: input.chat_id,
        kind: "delete",
        payload: { message_id: input.message_id },
        idempotencyKey: input.idempotency_key,
        requestFingerprint: fingerprint("deleteMessage", input),
      });
      return operation.result;
    },

    async answerCallbackQuery(context, input) {
      const operation = await repository.answerCallback({
        botId: context.bot.botId,
        callbackQueryId: input.callback_query_id,
        text: input.text ?? null,
        showAlert: input.show_alert ?? false,
        idempotencyKey: input.idempotency_key,
        requestFingerprint: fingerprint("answerCallbackQuery", input),
      });
      return operation.result;
    },
  };
}
