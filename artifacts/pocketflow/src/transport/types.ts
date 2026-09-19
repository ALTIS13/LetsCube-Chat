/**
 * The boundary between PocketFlow and whichever Bot API it is talking to.
 *
 * This file is the whole of the compatibility claim, so it is worth saying
 * plainly what it is for. The owner's brief asks that the same bot source run
 * against LETSCUBE and against Telegram with only `BOT_API_BASE_URL` and
 * `BOT_TOKEN` changed. Measured against the two wire formats, that cannot be
 * literally true today — the two disagree on the shape of an identifier, on how
 * a file is addressed, and on whether a write carries an idempotency key:
 *
 *   |                | LETSCUBE                   | Telegram            |
 *   |----------------|----------------------------|---------------------|
 *   | chat / message | UUID strings               | 64-bit integers     |
 *   | a file to send | a storage object reference | a file_id or upload |
 *   | a write        | `idempotency_key` required | no such field       |
 *   | a date         | timestamptz string         | unix seconds        |
 *
 * So the promise is kept one level up instead: `app/` is written against the
 * types below and never sees a UUID, a storage path or an idempotency key.
 * `transport/letscube.ts` is the only module that knows this platform's wire
 * format, and a `transport/telegram.ts` beside it would be the only module that
 * knows Telegram's. Nothing in `app/` changes when the second one arrives.
 *
 * That is also why the identifiers below are opaque strings rather than a union
 * of `string | number`. An opaque id cannot be arithmetic'd, compared for order
 * or truncated by a 32-bit assumption, which is the failure §19 of the brief
 * asks to be designed out ("Bot/user/chat IDs хранить безопасно для значений
 * больше signed 32-bit"). A Telegram adapter stringifies on the way in and
 * parses on the way out; the application never holds the number.
 *
 * `idempotencyKey` deliberately does NOT appear on the send options. It is not
 * a property of "send this message" — it is a property of "this HTTP call may
 * be retried", which is the transport's business. The LETSCUBE adapter mints
 * one per logical send and reuses it across its own retries; a Telegram adapter
 * throws it away. An application that had to invent one would be an application
 * that knows which platform it is on.
 */

/** Opaque on purpose — see the file comment. */
export type ChatId = string & { readonly __brand?: "ChatId" };
export type MessageId = string & { readonly __brand?: "MessageId" };
export type UserId = string & { readonly __brand?: "UserId" };
export type CallbackQueryId = string & { readonly __brand?: "CallbackQueryId" };

export type ChatKind = "private" | "group" | "channel" | "unknown";

export type BotIdentity = {
  id: UserId;
  username: string | null;
  displayName: string | null;
};

/**
 * Something attached to a received message.
 *
 * `fileId` is the handle the platform gave us and the only thing worth
 * persisting. On LETSCUBE it happens to be the message's own id; that is the
 * platform's business, not ours, and the application must never assume it.
 */
export type Attachment = {
  fileId: string;
  kind: "image" | "video" | "file" | "audio" | "unknown";
  mimeType: string | null;
  fileName: string | null;
  byteSize: number | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
};

export type Chat = {
  id: ChatId;
  kind: ChatKind;
  title: string | null;
};

export type Sender = {
  id: UserId | null;
  isBot: boolean;
  displayName: string | null;
  username: string | null;
};

export type IncomingMessage = {
  id: MessageId;
  chat: Chat;
  from: Sender;
  /** When the platform says it was sent. Always a real Date, never a string. */
  date: Date;
  text: string | null;
  replyToMessageId: MessageId | null;
  topicId: string | null;
  attachment: Attachment | null;
};

export type IncomingCallbackQuery = {
  id: CallbackQueryId;
  from: Sender;
  data: string;
  /** The message the button is on. Some platforms send the whole message; we keep only what every platform has. */
  message: { id: MessageId; chatId: ChatId };
};

export type MembershipAction = "added" | "removed" | "privacy_changed";

export type IncomingMembership = {
  chatId: ChatId;
  action: MembershipAction;
  /** Whether the platform restricts what the bot sees in this chat, if it says. */
  privacyMode: string | null;
  actor: Sender | null;
};

/**
 * One update, in the form the application handles.
 *
 * A closed union rather than an open bag: §19 of the brief requires that an
 * unknown update type from a future platform version must not crash the bot,
 * and the adapter enforces that by returning `{kind: "unsupported"}` instead of
 * throwing. The application must handle that arm, which is why it is in the
 * union rather than filtered away silently — a dropped update that nobody can
 * see is how a delivery bug stays invisible for a month.
 */
export type Update =
  | { updateId: number; kind: "message"; message: IncomingMessage }
  | { updateId: number; kind: "edited_message"; message: IncomingMessage }
  | { updateId: number; kind: "callback_query"; callbackQuery: IncomingCallbackQuery }
  | { updateId: number; kind: "membership"; membership: IncomingMembership }
  | { updateId: number; kind: "unsupported"; rawType: string; raw: unknown };

export type InlineButton =
  | { text: string; callbackData: string }
  | { text: string; url: string };

export type InlineKeyboard = { rows: InlineButton[][] };

export type SendTextOptions = {
  chatId: ChatId;
  text: string;
  replyToMessageId?: MessageId;
  topicId?: string;
  keyboard?: InlineKeyboard;
};

export type EditTextOptions = {
  chatId: ChatId;
  messageId: MessageId;
  text: string;
  keyboard?: InlineKeyboard;
};

export type ChatAction =
  | "typing"
  | "upload_photo"
  | "upload_video"
  | "upload_document"
  | "record_voice";

export type SentMessage = {
  id: MessageId;
  chatId: ChatId;
  date: Date | null;
};

export type FileHandle = {
  fileId: string;
  mimeType: string | null;
  fileName: string | null;
  byteSize: number | null;
  /** A short-lived URL. Download it now; do not persist it. */
  url: string;
  expiresInSeconds: number;
};

export type BotCommandSpec = { command: string; description: string };

/**
 * A capability the transport either has or does not have.
 *
 * `/selftest` reads this, and the reason it is a declaration rather than a
 * try-and-see is the brief's §22.13: an unsupported capability must report
 * UNSUPPORTED, never FAIL. Those are different facts about the platform, and a
 * failed call cannot tell them apart — a 404 from a method that does not exist
 * and a 404 from a method that broke look identical on the wire.
 */
export type TransportCapability =
  | "sendText"
  | "sendPhoto"
  | "sendDocument"
  | "editMessageText"
  | "editMessageReplyMarkup"
  | "deleteMessage"
  | "replyToMessage"
  | "inlineKeyboard"
  | "callbackQuery"
  | "answerCallbackQuery"
  | "chatAction"
  | "getFile"
  | "sendFileById"
  | "uploadFile"
  | "setMyCommands"
  | "getMyCommands"
  | "polling"
  | "webhook"
  | "inlineMode"
  | "poll"
  | "reactions"
  | "topics"
  | "richMessages"
  | "streaming"
  | "ephemeral"
  | "miniApp";

export class TransportError extends Error {
  readonly code: string;
  readonly status: number | null;
  readonly retryAfterSeconds: number | null;
  readonly requestId: string | null;

  constructor(input: {
    code: string;
    message: string;
    status?: number | null;
    retryAfterSeconds?: number | null;
    requestId?: string | null;
  }) {
    super(input.message);
    this.name = "TransportError";
    this.code = input.code;
    this.status = input.status ?? null;
    this.retryAfterSeconds = input.retryAfterSeconds ?? null;
    this.requestId = input.requestId ?? null;
  }

  /** Whether trying the same call again could plausibly succeed. */
  get retryable(): boolean {
    if (this.code === "rate_limited") return true;
    if (this.status === null) return true; // a transport-level failure: no answer at all
    return this.status >= 500;
  }
}

/** Raised when the application asks for something this platform does not have. */
export class CapabilityUnsupportedError extends TransportError {
  constructor(capability: TransportCapability) {
    super({ code: "unsupported", message: `capability not supported: ${capability}` });
    this.name = "CapabilityUnsupportedError";
  }

  override get retryable(): boolean {
    return false;
  }
}

export interface BotTransport {
  /** What this platform is, for logs and for the selftest report. */
  readonly platform: string;

  supports(capability: TransportCapability): boolean;

  getMe(): Promise<BotIdentity>;

  sendText(options: SendTextOptions): Promise<SentMessage>;
  editText(options: EditTextOptions): Promise<void>;
  deleteMessage(chatId: ChatId, messageId: MessageId): Promise<void>;
  sendChatAction(chatId: ChatId, action: ChatAction, topicId?: string): Promise<void>;

  answerCallbackQuery(
    id: CallbackQueryId,
    options?: { text?: string; showAlert?: boolean },
  ): Promise<void>;

  getFile(chatId: ChatId, fileId: string): Promise<FileHandle>;

  setMyCommands(commands: BotCommandSpec[]): Promise<void>;
  getMyCommands(): Promise<BotCommandSpec[]>;

  /** Long-poll. Returns as soon as there is anything, or when the timeout expires. */
  getUpdates(options: {
    offset: number;
    limit?: number;
    timeoutSeconds?: number;
    signal?: AbortSignal;
  }): Promise<Update[]>;

  setWebhook(options: { url: string; secretToken: string; dropPendingUpdates?: boolean }): Promise<void>;
  deleteWebhook(options?: { dropPendingUpdates?: boolean }): Promise<void>;
  getWebhookInfo(): Promise<{
    configured: boolean;
    pendingUpdateCount: number;
    failureCount: number;
    lastErrorCode: string | null;
  }>;

  /**
   * Turn one delivered webhook body into an update.
   *
   * The webhook and the long poll carry the same payload on every platform
   * worth supporting, but only the adapter knows that, so the parse lives here
   * rather than in the HTTP layer.
   */
  parseWebhookUpdate(body: unknown): Update;
}
