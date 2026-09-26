import { BotApiError } from "#bot/errors";
import type {
  BotMethodFingerprint,
  BotMethodHandlers,
} from "#bot/methodRouter";
import type {
  BotMessageCommand,
  BotMethodRepository,
} from "#bot/repository";
import { MAX_INLINE_PHOTO_BYTES, type BotMethodInputMap } from "#bot/schemas";

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

const PHOTO_EXTENSION = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
} as const;

type InlinePhoto = NonNullable<BotMethodInputMap["sendPhoto"]["photo"]>;

function photoBytes(photo: InlinePhoto): Buffer {
  if (
    typeof photo?.bytes_base64 !== "string" ||
    photo.bytes_base64.length < 4 ||
    photo.bytes_base64.length > (MAX_INLINE_PHOTO_BYTES / 3) * 4 ||
    !Object.prototype.hasOwnProperty.call(PHOTO_EXTENSION, photo.mime_type)
  ) {
    throw new BotApiError("validation_failed");
  }
  const bytes = Buffer.from(photo.bytes_base64, "base64");
  if (
    bytes.length === 0 ||
    bytes.length > MAX_INLINE_PHOTO_BYTES ||
    bytes.toString("base64") !== photo.bytes_base64
  ) {
    throw new BotApiError("validation_failed");
  }
  const matches = (() => {
    switch (photo.mime_type) {
      case "image/jpeg":
        return (
          bytes.length >= 4 &&
          bytes[0] === 0xff &&
          bytes[1] === 0xd8 &&
          bytes[2] === 0xff &&
          bytes.subarray(-2).equals(Buffer.from([0xff, 0xd9]))
        );
      case "image/png":
        return (
          bytes.length >= 33 &&
          bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) &&
          bytes.toString("ascii", 12, 16) === "IHDR" &&
          bytes.subarray(-12).equals(Buffer.from("0000000049454e44ae426082", "hex"))
        );
      case "image/gif":
        return (
          bytes.length >= 14 &&
          ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6)) &&
          bytes.at(-1) === 0x3b
        );
      case "image/webp":
        return (
          bytes.length >= 20 &&
          bytes.toString("ascii", 0, 4) === "RIFF" &&
          bytes.readUInt32LE(4) === bytes.length - 8 &&
          bytes.toString("ascii", 8, 12) === "WEBP" &&
          ["VP8 ", "VP8L", "VP8X"].includes(bytes.toString("ascii", 12, 16))
        );
    }
  })();
  if (!matches) throw new BotApiError("validation_failed");
  return bytes;
}

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
  const photo = "photo" in input ? input.photo : undefined;
  if (
    Number(media !== undefined) +
      Number(fileId !== undefined) +
      Number(photo !== undefined) !==
      1 ||
    (photo !== undefined && method !== "sendPhoto") ||
    (photo !== undefined &&
      (input.topic_id !== undefined ||
        input.reply_to_message_id !== undefined ||
        input.reply_markup !== undefined))
  ) {
    throw new BotApiError("validation_failed");
  }
  if (media !== undefined && !MEDIA_MIME[method].has(media.mime_type)) {
    throw new BotApiError("validation_failed");
  }
  const bytes = photo === undefined ? undefined : photoBytes(photo);
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

  let object = media;
  if (photo !== undefined && bytes !== undefined) {
    if (!/^[0-9a-f]{64}$/.test(requestFingerprint)) {
      throw new BotApiError("internal_error");
    }
    // The keyed fingerprint makes this path retry-stable but not guessable.
    const objectPath =
      `${input.chat_id.toLowerCase()}/bots/${botId.toLowerCase()}/${requestFingerprint}.` +
      PHOTO_EXTENSION[photo.mime_type];
    await repository.uploadPhoto({
      botId,
      chatId: input.chat_id,
      objectPath,
      mimeType: photo.mime_type,
      bytes,
    });
    object = {
      bucket: "chat-media",
      object_path: objectPath,
      mime_type: photo.mime_type,
      size_bytes: bytes.length,
    };
  }

  // A re-send introduces no object, so it takes no upload grant. Asking for one
  // would fail anyway: `bot_upload_authorize_internal` requires a path under
  // `<chat_id>/bots/<bot_id>/`, and the file being re-sent is somebody else's.
  if (object !== undefined) {
    await repository.authorizeMedia({
      botId,
      chatId: input.chat_id,
      bucket: object.bucket,
      objectPath: object.object_path,
      mimeType: object.mime_type,
      sizeBytes: object.size_bytes,
      expiresInSeconds: 60,
    });
  }
  const operation = await repository.executeMessageCommand({
    botId,
    chatId: input.chat_id,
    kind,
    payload: {
      ...(input.caption ? { text: input.caption } : {}),
      ...(object !== undefined
        ? {
            media_bucket: object.bucket,
            media_path: object.object_path,
            media_metadata: {
              mime_type: object.mime_type,
              size: object.size_bytes,
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
