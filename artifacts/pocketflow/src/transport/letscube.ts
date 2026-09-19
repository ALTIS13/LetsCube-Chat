import { randomUUID } from "node:crypto";

import {
  CapabilityUnsupportedError,
  TransportError,
  type Attachment,
  type BotCommandSpec,
  type BotIdentity,
  type BotTransport,
  type CallbackQueryId,
  type Chat,
  type ChatAction,
  type ChatId,
  type ChatKind,
  type EditTextOptions,
  type FileHandle,
  type InlineKeyboard,
  type IncomingCallbackQuery,
  type IncomingMembership,
  type IncomingMessage,
  type MessageId,
  type SendTextOptions,
  type Sender,
  type SentMessage,
  type TransportCapability,
  type Update,
  type UserId,
} from "#pf/transport/types";

/**
 * The LETSCUBE Bot API, behind the neutral interface.
 *
 * This is the only module in PocketFlow that knows any of the following, and
 * each one is a real difference from Telegram rather than a stylistic choice:
 *
 *   - the single-route shape `POST {base}/bot/v1/<method>`;
 *   - `Authorization: Bot <token>` — exactly one space, nothing after the
 *     token, which the gateway enforces by rejecting a header with a second
 *     space in it;
 *   - identifiers are UUIDs;
 *   - every writing method requires an `idempotency_key`;
 *   - the envelope is `{ok, result}` / `{ok: false, error: {code, ...}}`.
 *
 * **Why the idempotency key is minted here and not by the caller.** The key's
 * job is to make a *retry* harmless, so it has to be stable across the retries
 * of one logical send and different between two sends that happen to carry the
 * same text. Both halves of that are properties of this HTTP client, not of the
 * application: `call()` mints one key and reuses it for every attempt of that
 * call. An application that minted its own would either reuse one by accident
 * (silently dropping a message, because the gateway returns the first result
 * with `duplicate: true`) or mint a fresh one per attempt (defeating the point).
 */

const SUPPORTED: ReadonlySet<TransportCapability> = new Set<TransportCapability>([
  "sendText",
  "editMessageText",
  "deleteMessage",
  "replyToMessage",
  "inlineKeyboard",
  "callbackQuery",
  "answerCallbackQuery",
  "chatAction",
  "getFile",
  "setMyCommands",
  "getMyCommands",
  "polling",
  "webhook",
  "topics",
]);

/**
 * Deliberately absent, with the reason, because `/selftest` reports these and a
 * reader deserves to know which are platform gaps and which are ours.
 *
 * `sendPhoto` and friends exist as methods but are unreachable: they take a
 * storage object path, the gateway checks that the object already exists, and
 * no public method gives a bot a way to put one there or to learn the path of
 * one it received (`getFile` returns a signed URL and not the path). So the
 * honest answer for "can this bot send a file" is no. See G-1 in
 * `docs/proposals/2026-09-19-pocketflow-reference-bot.md`.
 */
export const LETSCUBE_GAPS: ReadonlyMap<TransportCapability, string> = new Map([
  ["sendPhoto", "sendPhoto needs a chat-media object path the bot cannot obtain (G-1)"],
  ["sendDocument", "sendDocument needs a chat-media object path the bot cannot obtain (G-1)"],
  ["sendFileById", "no method accepts a file_id in place of a storage reference (G-1)"],
  ["uploadFile", "no upload method exists in the public Bot API (G-1)"],
  ["editMessageReplyMarkup", "only editMessageText exists; it carries reply_markup (G-4)"],
  ["inlineMode", "no inline_query / answerInlineQuery / chosen_inline_result (G-2)"],
  ["poll", "no sendPoll and no poll / poll_answer update (G-3)"],
  ["reactions", "not implemented by the platform (G-6)"],
  ["richMessages", "not implemented by the platform (G-6)"],
  ["streaming", "not implemented by the platform (G-6)"],
  ["ephemeral", "not implemented by the platform (G-6)"],
  ["miniApp", "not implemented by the platform (G-6)"],
]);

type Json = Record<string, unknown>;

function asRecord(value: unknown): Json | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  // The platform stringifies some media metadata (it comes out of jsonb text
  // fields), so a numeric string is a number here rather than a missing value.
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function chatKind(value: unknown): ChatKind {
  const raw = asString(value);
  if (raw === "private" || raw === "group" || raw === "channel") return raw;
  return "unknown";
}

function attachmentKind(value: unknown): Attachment["kind"] {
  const raw = asString(value);
  if (raw === "image" || raw === "video" || raw === "file" || raw === "audio") return raw;
  return "unknown";
}

function parseSender(raw: unknown): Sender {
  const from = asRecord(raw);
  if (!from) return { id: null, isBot: false, displayName: null, username: null };
  return {
    id: (asString(from.id) ?? asString(from.bot_id)) as UserId | null,
    isBot: from.is_bot === true,
    displayName: asString(from.display_name),
    username: asString(from.username),
  };
}

function parseChat(raw: unknown, fallbackId: string | null): Chat | null {
  const chat = asRecord(raw);
  const id = asString(chat?.id) ?? fallbackId;
  if (!id) return null;
  return { id: id as ChatId, kind: chatKind(chat?.type), title: asString(chat?.name) };
}

function parseAttachment(raw: unknown): Attachment | null {
  const attachment = asRecord(raw);
  const fileId = asString(attachment?.file_id);
  if (!attachment || !fileId) return null;
  return {
    fileId,
    kind: attachmentKind(attachment.kind),
    mimeType: asString(attachment.mime_type),
    fileName: asString(attachment.file_name),
    byteSize: asNumber(attachment.byte_size),
    width: asNumber(attachment.width),
    height: asNumber(attachment.height),
    durationSeconds: asNumber(attachment.duration),
  };
}

function parseMessage(raw: unknown): IncomingMessage | null {
  const message = asRecord(raw);
  const id = asString(message?.id);
  if (!message || !id) return null;
  const chat = parseChat(message.chat, asString(message.chat_id));
  if (!chat) return null;
  const date = asString(message.date);
  return {
    id: id as MessageId,
    chat,
    from: parseSender(message.from),
    // An unparsable date is «now» rather than an exception: the date is
    // informational here, and refusing the whole update over it would lose a
    // message the user actually sent.
    date: date && !Number.isNaN(Date.parse(date)) ? new Date(date) : new Date(),
    text: asString(message.text),
    replyToMessageId: asString(message.reply_to_message_id) as MessageId | null,
    topicId: asString(message.topic_id),
    attachment: parseAttachment(message.attachment),
  };
}

function parseCallbackQuery(raw: unknown): IncomingCallbackQuery | null {
  const query = asRecord(raw);
  const id = asString(query?.id);
  const data = asString(query?.data);
  const message = asRecord(query?.message);
  const messageId = asString(message?.id);
  const chatId = asString(message?.chat_id);
  if (!query || !id || !data || !messageId || !chatId) return null;
  return {
    id: id as CallbackQueryId,
    from: parseSender(query.from),
    data,
    message: { id: messageId as MessageId, chatId: chatId as ChatId },
  };
}

function parseMembership(raw: unknown): IncomingMembership | null {
  const membership = asRecord(raw);
  const chatId = asString(membership?.chat_id);
  const action = asString(membership?.action);
  if (!membership || !chatId) return null;
  if (action !== "added" && action !== "removed" && action !== "privacy_changed") return null;
  return {
    chatId: chatId as ChatId,
    action,
    privacyMode: asString(membership.privacy_mode),
    actor: membership.actor ? parseSender(membership.actor) : null,
  };
}

/**
 * One delivered payload, whether it arrived by long poll or by webhook.
 *
 * An update this adapter cannot read comes back as `unsupported` rather than
 * throwing. §19 of the brief requires exactly that — a future platform version
 * adding a fifth update type must not stop the bot — and the alternative,
 * dropping it here, is what makes a delivery bug invisible.
 */
export function parseUpdate(raw: unknown): Update {
  const payload = asRecord(raw);
  const updateId = asNumber(payload?.update_id) ?? 0;
  if (payload) {
    if (payload.message !== undefined) {
      const message = parseMessage(payload.message);
      if (message) return { updateId, kind: "message", message };
    }
    if (payload.edited_message !== undefined) {
      const message = parseMessage(payload.edited_message);
      if (message) return { updateId, kind: "edited_message", message };
    }
    if (payload.callback_query !== undefined) {
      const callbackQuery = parseCallbackQuery(payload.callback_query);
      if (callbackQuery) return { updateId, kind: "callback_query", callbackQuery };
    }
    if (payload.membership !== undefined) {
      const membership = parseMembership(payload.membership);
      if (membership) return { updateId, kind: "membership", membership };
    }
  }
  const rawType = payload
    ? (Object.keys(payload).find((key) => key !== "update_id") ?? "empty")
    : "not_an_object";
  return { updateId, kind: "unsupported", rawType, raw };
}

function keyboardToWire(keyboard: InlineKeyboard | undefined): Json | undefined {
  if (!keyboard) return undefined;
  const rows = keyboard.rows
    .map((row) =>
      row
        .filter((button): button is { text: string; callbackData: string } => "callbackData" in button)
        .map((button) => ({ text: button.text, callback_data: button.callbackData })),
    )
    .filter((row) => row.length > 0);
  // A URL button is dropped rather than sent as a callback button that does
  // nothing: the platform's keyboard schema is strict and accepts callback
  // buttons only, so a silent downgrade would put a dead control on screen.
  if (rows.length === 0) return undefined;
  return { inline_keyboard: rows };
}

export type LetscubeTransportOptions = {
  baseUrl: string;
  token: string;
  /** How many times a retryable failure is tried again. The same idempotency key is reused. */
  maxAttempts?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

const DEFAULT_MAX_ATTEMPTS = 4;

export class LetscubeTransport implements BotTransport {
  readonly platform = "letscube";

  readonly #baseUrl: string;
  readonly #token: string;
  readonly #maxAttempts: number;
  readonly #fetch: typeof fetch;
  readonly #sleep: (ms: number) => Promise<void>;

  constructor(options: LetscubeTransportOptions) {
    // A trailing slash here and the URL becomes `//bot/v1/...`, which the
    // gateway answers 404 to — a confusing way to learn about a typo.
    this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.#token = options.token;
    this.#maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#sleep =
      options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  supports(capability: TransportCapability): boolean {
    return SUPPORTED.has(capability);
  }

  async #call(method: string, body: Json, signal?: AbortSignal): Promise<unknown> {
    let lastError: TransportError | null = null;
    for (let attempt = 1; attempt <= this.#maxAttempts; attempt += 1) {
      try {
        return await this.#attempt(method, body, signal);
      } catch (error) {
        // An abort is a decision, not a failure. Retrying one turns a prompt
        // shutdown into several seconds of sleeping and aborting again.
        if (signal?.aborted) {
          throw new TransportError({ code: "aborted", message: "request aborted" });
        }
        const transportError =
          error instanceof TransportError
            ? error
            : new TransportError({
                code: "network_error",
                message: error instanceof Error ? error.message : "request failed",
              });
        if (!transportError.retryable || attempt === this.#maxAttempts) throw transportError;
        lastError = transportError;
        const backoffMs =
          transportError.retryAfterSeconds !== null
            ? transportError.retryAfterSeconds * 1000
            : Math.min(2 ** (attempt - 1) * 500, 8000);
        await this.#sleep(backoffMs);
      }
    }
    throw lastError ?? new TransportError({ code: "network_error", message: "request failed" });
  }

  async #attempt(method: string, body: Json, signal?: AbortSignal): Promise<unknown> {
    const response = await this.#fetch(`${this.#baseUrl}/bot/v1/${method}`, {
      method: "POST",
      headers: {
        // One space, and nothing after the token. The gateway rejects any
        // other spelling, including a second `Authorization` header.
        authorization: `Bot ${this.#token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    const record = asRecord(payload);
    if (response.ok && record?.ok === true) return record.result;
    const failure = asRecord(record?.error);
    throw new TransportError({
      code: asString(failure?.code) ?? `http_${response.status}`,
      message: asString(failure?.message) ?? `request failed with ${response.status}`,
      status: response.status,
      retryAfterSeconds: asNumber(failure?.retry_after),
      requestId: asString(failure?.request_id),
    });
  }

  /** A fresh key per logical call, reused across that call's retries. */
  #idempotencyKey(): string {
    return `pf-${randomUUID()}`;
  }

  async getMe(): Promise<BotIdentity> {
    const result = asRecord(await this.#call("getMe", {}));
    const id = asString(result?.id) ?? asString(result?.bot_id);
    if (!id) {
      throw new TransportError({ code: "internal_error", message: "getMe returned no id" });
    }
    return {
      id: id as UserId,
      username: asString(result?.username),
      displayName: asString(result?.display_name),
    };
  }

  async sendText(options: SendTextOptions): Promise<SentMessage> {
    const keyboard = keyboardToWire(options.keyboard);
    const result = asRecord(
      await this.#call("sendMessage", {
        chat_id: options.chatId,
        text: options.text,
        ...(options.replyToMessageId ? { reply_to_message_id: options.replyToMessageId } : {}),
        ...(options.topicId ? { topic_id: options.topicId } : {}),
        ...(keyboard ? { reply_markup: keyboard } : {}),
        idempotency_key: this.#idempotencyKey(),
      }),
    );
    const id = asString(result?.message_id);
    const chatId = asString(result?.chat_id) ?? options.chatId;
    if (!id) {
      throw new TransportError({ code: "internal_error", message: "sendMessage returned no id" });
    }
    const createdAt = asString(result?.created_at);
    return {
      id: id as MessageId,
      chatId: chatId as ChatId,
      date: createdAt && !Number.isNaN(Date.parse(createdAt)) ? new Date(createdAt) : null,
    };
  }

  async editText(options: EditTextOptions): Promise<void> {
    const keyboard = keyboardToWire(options.keyboard);
    await this.#call("editMessageText", {
      chat_id: options.chatId,
      message_id: options.messageId,
      text: options.text,
      ...(keyboard ? { reply_markup: keyboard } : {}),
      idempotency_key: this.#idempotencyKey(),
    });
  }

  async deleteMessage(chatId: ChatId, messageId: MessageId): Promise<void> {
    await this.#call("deleteMessage", {
      chat_id: chatId,
      message_id: messageId,
      idempotency_key: this.#idempotencyKey(),
    });
  }

  async sendChatAction(chatId: ChatId, action: ChatAction, topicId?: string): Promise<void> {
    await this.#call("sendChatAction", {
      chat_id: chatId,
      action,
      ...(topicId ? { topic_id: topicId } : {}),
      idempotency_key: this.#idempotencyKey(),
    });
  }

  async answerCallbackQuery(
    id: CallbackQueryId,
    options?: { text?: string; showAlert?: boolean },
  ): Promise<void> {
    await this.#call("answerCallbackQuery", {
      callback_query_id: id,
      ...(options?.text ? { text: options.text } : {}),
      ...(options?.showAlert !== undefined ? { show_alert: options.showAlert } : {}),
      idempotency_key: this.#idempotencyKey(),
    });
  }

  async getFile(chatId: ChatId, fileId: string): Promise<FileHandle> {
    // `file_id` is the message id on this platform. The application does not
    // know that and must not: it passes back whatever `attachment.fileId` said.
    const result = asRecord(await this.#call("getFile", { chat_id: chatId, message_id: fileId }));
    const url = asString(result?.url);
    if (!url) {
      throw new TransportError({ code: "not_found", message: "getFile returned no url" });
    }
    return {
      fileId: asString(result?.file_id) ?? fileId,
      mimeType: asString(result?.mime_type),
      fileName: asString(result?.file_name),
      byteSize: asNumber(result?.file_size),
      url,
      expiresInSeconds: asNumber(result?.expires_in) ?? 60,
    };
  }

  async setMyCommands(commands: BotCommandSpec[]): Promise<void> {
    await this.#call("setMyCommands", {
      commands: commands.map((entry) => ({
        command: entry.command,
        description: entry.description,
      })),
      idempotency_key: this.#idempotencyKey(),
    });
  }

  async getMyCommands(): Promise<BotCommandSpec[]> {
    const result = await this.#call("getMyCommands", {});
    if (!Array.isArray(result)) return [];
    return result.flatMap((entry) => {
      const record = asRecord(entry);
      const command = asString(record?.command);
      const description = asString(record?.description);
      return command && description ? [{ command, description }] : [];
    });
  }

  async getUpdates(options: {
    offset: number;
    limit?: number;
    timeoutSeconds?: number;
    signal?: AbortSignal;
  }): Promise<Update[]> {
    const result = await this.#call(
      "getUpdates",
      {
        offset: options.offset,
        ...(options.limit !== undefined ? { limit: options.limit } : {}),
        ...(options.timeoutSeconds !== undefined ? { timeout: options.timeoutSeconds } : {}),
      },
      options.signal,
    );
    return Array.isArray(result) ? result.map((entry) => parseUpdate(entry)) : [];
  }

  async setWebhook(options: {
    url: string;
    secretToken: string;
    dropPendingUpdates?: boolean;
  }): Promise<void> {
    await this.#call("setWebhook", {
      url: options.url,
      secret_token: options.secretToken,
      ...(options.dropPendingUpdates !== undefined
        ? { drop_pending_updates: options.dropPendingUpdates }
        : {}),
      idempotency_key: this.#idempotencyKey(),
    });
  }

  async deleteWebhook(options?: { dropPendingUpdates?: boolean }): Promise<void> {
    await this.#call("deleteWebhook", {
      ...(options?.dropPendingUpdates !== undefined
        ? { drop_pending_updates: options.dropPendingUpdates }
        : {}),
      idempotency_key: this.#idempotencyKey(),
    });
  }

  async getWebhookInfo(): Promise<{
    configured: boolean;
    pendingUpdateCount: number;
    failureCount: number;
    lastErrorCode: string | null;
  }> {
    const result = asRecord(await this.#call("getWebhookInfo", {}));
    return {
      configured: result?.configured === true,
      pendingUpdateCount: asNumber(result?.pending_update_count) ?? 0,
      failureCount: asNumber(result?.failure_count) ?? 0,
      lastErrorCode: asString(result?.last_error_code),
    };
  }

  parseWebhookUpdate(body: unknown): Update {
    return parseUpdate(body);
  }

  /** Thrown rather than returned, so a caller that ignored `supports()` fails loudly. */
  unsupported(capability: TransportCapability): never {
    throw new CapabilityUnsupportedError(capability);
  }
}

/** The header the platform puts its shared secret in when it POSTs an update. */
export const LETSCUBE_WEBHOOK_SECRET_HEADER = "x-letscube-bot-webhook-secret";
