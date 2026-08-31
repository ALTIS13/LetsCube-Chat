import { z } from "zod";

const uuidSchema = z.string().uuid();
const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

export const callbackButtonSchema = z
  .object({
    text: z.string().min(1).max(64),
    callback_data: z.string().min(1).max(128),
  })
  .strict();

export const inlineKeyboardSchema = z
  .object({
    inline_keyboard: z
      .array(z.array(callbackButtonSchema).min(1).max(8))
      .min(1)
      .max(8),
  })
  .strict()
  .superRefine((value, context) => {
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > 16_384) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "inline_keyboard_too_large",
      });
    }
  });

const safeObjectPathSchema = z
  .string()
  .min(80)
  .max(1024)
  .superRefine((value, context) => {
    const segments = value.split("/");
    if (
      value.startsWith("/") ||
      value.endsWith("/") ||
      value.includes("\\") ||
      /[\u0000-\u001f\u007f]/.test(value) ||
      /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value) ||
      segments.some(
        (segment) => segment === "" || segment === "." || segment === "..",
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "invalid_storage_object_path",
      });
    }
  });

export const storageObjectReferenceSchema = z
  .object({
    bucket: z.literal("chat-media"),
    object_path: safeObjectPathSchema,
    mime_type: z.enum([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "video/mp4",
      "video/webm",
      "audio/webm",
      "audio/ogg",
      "audio/mpeg",
      "application/pdf",
    ]),
    size_bytes: z.number().int().positive().max(104_857_600),
  })
  .strict();

const emptySchema = z.object({}).strict();
const optionalReplyFields = {
  topic_id: uuidSchema.optional(),
  reply_to_message_id: uuidSchema.optional(),
  reply_markup: inlineKeyboardSchema.optional(),
};

export const sendMessageSchema = z
  .object({
    chat_id: uuidSchema,
    text: z.string().min(1).max(4096),
    ...optionalReplyFields,
    idempotency_key: idempotencyKeySchema,
  })
  .strict();

function mediaMessageSchema(allowedMimeTypes: readonly string[]) {
  return z
    .object({
      chat_id: uuidSchema,
      media: storageObjectReferenceSchema.refine(
        (media) => allowedMimeTypes.includes(media.mime_type),
        "media_mime_type_not_allowed",
      ),
      caption: z.string().min(1).max(4096).optional(),
      ...optionalReplyFields,
      idempotency_key: idempotencyKeySchema,
    })
    .strict();
}

const sendPhotoSchema = mediaMessageSchema([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const sendVideoSchema = mediaMessageSchema(["video/mp4", "video/webm"]);
const sendDocumentSchema = mediaMessageSchema(["application/pdf"]);
const sendVoiceSchema = mediaMessageSchema([
  "audio/webm",
  "audio/ogg",
  "audio/mpeg",
]);

const sendChatActionSchema = z
  .object({
    chat_id: uuidSchema,
    action: z.enum([
      "typing",
      "upload_photo",
      "upload_video",
      "upload_document",
      "record_voice",
    ]),
    topic_id: uuidSchema.optional(),
    idempotency_key: idempotencyKeySchema,
  })
  .strict();

const editMessageTextSchema = z
  .object({
    chat_id: uuidSchema,
    message_id: uuidSchema,
    text: z.string().min(1).max(4096),
    reply_markup: inlineKeyboardSchema.optional(),
    idempotency_key: idempotencyKeySchema,
  })
  .strict();

const deleteMessageSchema = z
  .object({
    chat_id: uuidSchema,
    message_id: uuidSchema,
    idempotency_key: idempotencyKeySchema,
  })
  .strict();

const getFileSchema = z
  .object({
    chat_id: uuidSchema,
    message_id: uuidSchema,
  })
  .strict();

export const botCommandSchema = z
  .object({
    command: z
      .string()
      .min(1)
      .max(32)
      .regex(/^[a-z][a-z0-9_]{0,31}$/),
    description: z.string().trim().min(1).max(256),
  })
  .strict();

const setMyCommandsSchema = z
  .object({
    commands: z.array(botCommandSchema).max(100),
    idempotency_key: idempotencyKeySchema,
  })
  .strict();

const answerCallbackQuerySchema = z
  .object({
    callback_query_id: uuidSchema,
    text: z.string().min(1).max(200).optional(),
    show_alert: z.boolean().optional(),
    idempotency_key: idempotencyKeySchema,
  })
  .strict();

const webhookUrlSchema = z
  .string()
  .min(1)
  .max(2048)
  .superRefine((value, context) => {
    try {
      const url = new URL(value);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        !url.hostname
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "invalid_webhook_url",
        });
      }
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "invalid_webhook_url",
      });
    }
  });

const setWebhookSchema = z
  .object({
    url: webhookUrlSchema,
    drop_pending_updates: z.boolean().optional(),
    idempotency_key: idempotencyKeySchema,
  })
  .strict();

const deleteWebhookSchema = z
  .object({
    drop_pending_updates: z.boolean().optional(),
    idempotency_key: idempotencyKeySchema,
  })
  .strict();

const allowedUpdateSchema = z.enum([
  "message",
  "edited_message",
  "callback_query",
  "membership",
]);

const getUpdatesSchema = z
  .object({
    offset: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
    limit: z.number().int().min(1).max(100).optional(),
    timeout: z.number().int().min(0).max(30).optional(),
    allowed_updates: z.array(allowedUpdateSchema).max(4).optional(),
  })
  .strict();

export const botMethodSchemas = {
  getMe: emptySchema,
  getWebhookInfo: emptySchema,
  sendMessage: sendMessageSchema,
  sendPhoto: sendPhotoSchema,
  sendVideo: sendVideoSchema,
  sendDocument: sendDocumentSchema,
  sendVoice: sendVoiceSchema,
  sendChatAction: sendChatActionSchema,
  editMessageText: editMessageTextSchema,
  deleteMessage: deleteMessageSchema,
  getFile: getFileSchema,
  setMyCommands: setMyCommandsSchema,
  getMyCommands: emptySchema,
  answerCallbackQuery: answerCallbackQuerySchema,
  setWebhook: setWebhookSchema,
  deleteWebhook: deleteWebhookSchema,
  getUpdates: getUpdatesSchema,
} as const;

export const botMethodNameSchema = z.enum(
  Object.keys(botMethodSchemas) as [
    keyof typeof botMethodSchemas,
    ...(keyof typeof botMethodSchemas)[],
  ],
);

export type BotMethodName = z.infer<typeof botMethodNameSchema>;
export type BotMethodInputMap = {
  [Method in BotMethodName]: z.infer<(typeof botMethodSchemas)[Method]>;
};

export function parseBotMethodInput<Method extends BotMethodName>(
  method: Method,
  input: unknown,
): BotMethodInputMap[Method];
export function parseBotMethodInput(
  method: string,
  input: unknown,
): BotMethodInputMap[BotMethodName];
export function parseBotMethodInput(
  method: string,
  input: unknown,
): BotMethodInputMap[BotMethodName] {
  if (!Object.prototype.hasOwnProperty.call(botMethodSchemas, method)) {
    throw new Error("bot_method_not_found");
  }
  const schema = botMethodSchemas[method as BotMethodName];
  return schema.parse(input) as BotMethodInputMap[BotMethodName];
}
