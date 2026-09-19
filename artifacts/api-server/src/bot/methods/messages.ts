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
  const media = input.media;
  const fileId = input.file_id;
  // The schema admits exactly one of the two; this is the type narrowing, and
  // the refusal if the schema is ever loosened by accident.
  if ((media === undefined) === (fileId === undefined)) {
    throw new BotApiError("validation_failed");
  }
  if (media !== undefined && !MEDIA_MIME[method].has(media.mime_type)) {
    throw new BotApiError("validation_failed");
  }
  const kind = MEDIA_KIND[method];
  const requestFingerprint = fingerprint(method, input);
  const preflight = await repository.preflightMediaCommand({
    botId,
    chatId: input.chat_id,
    kind,
    idempotencyKey: input.idempotency_key,
    requestFingerprint,
  });
  if (preflight.duplicate) return preflight.result;

  // A re-send introduces no object, so it takes no upload grant. Asking for one
  // would fail anyway: `bot_upload_authorize_internal` requires a path under
  // `<chat_id>/bots/<bot_id>/`, and the file being re-sent is somebody else's.
  if (media !== undefined) {
    await repository.authorizeMedia({
      botId,
      chatId: input.chat_id,
      bucket: media.bucket,
      objectPath: media.object_path,
      mimeType: media.mime_type,
      sizeBytes: media.size_bytes,
      expiresInSeconds: 60,
    });
  }
  const operation = await repository.executeMessageCommand({
    botId,
    chatId: input.chat_id,
    kind,
    payload: {
      ...(input.caption ? { text: input.caption } : {}),
      ...(media !== undefined
        ? {
            media_bucket: media.bucket,
            media_path: media.object_path,
            media_metadata: {
              mime_type: media.mime_type,
              size: media.size_bytes,
              kind,
            },
          }
        : { file_id: fileId }),
      ...optionalReplyPayload(input),
    },
    idempotencyKey: input.idempotency_key,
    requestFingerprint,
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
          ...(input.reply_markup !== undefined
            ? { reply_markup: input.reply_markup }
            : {}),
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
