import { createClient } from "@supabase/supabase-js";

import { BotApiError } from "#bot/errors";
import {
  extractBotTokenPrefix,
  parseBotAuthorization,
  resolveBotAuthConfig,
  verifyBotTokenHash,
} from "#bot/tokenAuth";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_HASH_RE = /^[0-9a-f]{64}$/;
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export type BotRpcResult = {
  data: unknown;
  error: unknown;
};

export interface BotRpcClient {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<BotRpcResult>;
}

type SignedUrlResult = {
  data: { signedUrl?: unknown } | null;
  error: unknown;
};

export interface BotServiceClient extends BotRpcClient {
  storage: {
    from(bucket: string): {
      createSignedUrl(
        objectPath: string,
        expiresInSeconds: number,
      ): PromiseLike<SignedUrlResult>;
    };
  };
  channel(
    name: string,
    options?: Record<string, unknown>,
  ): {
    send(message: Record<string, unknown>): PromiseLike<unknown>;
  };
  removeChannel(channel: unknown): PromiseLike<unknown>;
}

export type AuthenticatedBot = {
  botId: string;
  tokenId: string;
};

export interface BotTokenRepository {
  authenticateBotToken(
    header: string | readonly string[] | undefined,
  ): Promise<AuthenticatedBot>;
}

export type BotMessageCommand = {
  botId: string;
  chatId: string;
  kind:
    | "text"
    | "image"
    | "video"
    | "file"
    | "audio"
    | "chat_action"
    | "edit"
    | "delete";
  payload: Record<string, unknown>;
  idempotencyKey: string;
  requestFingerprint: string;
};

export type BotOperationResult<T> = {
  result: T;
  duplicate: boolean;
};

export type BotFileMetadata = {
  messageId: string;
  bucket: string;
  objectPath: string;
  mimeType: string | null;
  fileName: string | null;
  sizeBytes: number | null;
};

export interface BotMethodRepository {
  getMe(botId: string): Promise<unknown>;
  preflightMediaCommand(input: {
    botId: string;
    chatId: string;
    kind: Extract<
      BotMessageCommand["kind"],
      "image" | "video" | "file" | "audio"
    >;
    idempotencyKey: string;
    requestFingerprint: string;
  }): Promise<BotOperationResult<unknown>>;
  executeMessageCommand(
    command: BotMessageCommand,
  ): Promise<BotOperationResult<unknown>>;
  authorizeMedia(input: {
    botId: string;
    chatId: string;
    bucket: string;
    objectPath: string;
    mimeType: string;
    sizeBytes: number;
    expiresInSeconds: 60;
  }): Promise<void>;
  replaceCommands(input: {
    botId: string;
    commands: Array<{ command: string; description: string }>;
    idempotencyKey: string;
    requestFingerprint: string;
  }): Promise<BotOperationResult<{ commands: unknown[] }>>;
  getCommands(botId: string): Promise<unknown[]>;
  lookupFile(
    botId: string,
    chatId: string,
    messageId: string,
  ): Promise<BotFileMetadata>;
  createSignedFileUrl(
    bucket: string,
    objectPath: string,
    expiresInSeconds: 60,
  ): Promise<string>;
  answerCallback(input: {
    botId: string;
    callbackQueryId: string;
    text: string | null;
    showAlert: boolean;
    idempotencyKey: string;
    requestFingerprint: string;
  }): Promise<BotOperationResult<boolean>>;
}

type TokenLookupRow = {
  tokenId: string;
  botId: string;
  tokenHash: string;
  tokenCreatedAt: number;
  tokenLastUsedAt: number | null;
  botState: string;
};

function unauthorized(): BotApiError {
  return new BotApiError("unauthorized");
}

function internalError(): BotApiError {
  return new BotApiError("internal_error");
}

function parseTimestamp(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "string") throw internalError();
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw internalError();
  return timestamp;
}

function projectTokenLookup(value: unknown): TokenLookupRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw internalError();
  }
  const row = value as Record<string, unknown>;
  const tokenId = row.token_id;
  const botId = row.bot_id;
  const tokenHash = row.token_hash;
  const botState = row.bot_state;
  if (
    typeof tokenId !== "string" ||
    !UUID_RE.test(tokenId) ||
    typeof botId !== "string" ||
    !UUID_RE.test(botId) ||
    typeof tokenHash !== "string" ||
    !TOKEN_HASH_RE.test(tokenHash) ||
    typeof botState !== "string" ||
    botState.length < 1 ||
    botState.length > 32
  ) {
    throw internalError();
  }
  const tokenCreatedAt = parseTimestamp(row.token_created_at);
  if (tokenCreatedAt === null) throw internalError();
  return {
    tokenId,
    botId,
    tokenHash,
    tokenCreatedAt,
    tokenLastUsedAt: parseTimestamp(row.token_last_used_at),
    botState,
  };
}

export function createBotServiceClient(
  environment: NodeJS.ProcessEnv = process.env,
): BotServiceClient {
  const { url, serviceRoleKey } = resolveBotAuthConfig(environment);
  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  }) as unknown as BotServiceClient;
}

export function createBotTokenRepository(
  environment: NodeJS.ProcessEnv = process.env,
  client: BotRpcClient = createBotServiceClient(environment),
  now: () => Date = () => new Date(),
): BotTokenRepository {
  const { pepper } = resolveBotAuthConfig(environment);

  return {
    async authenticateBotToken(header) {
      const raw = parseBotAuthorization(header);
      if (!raw) throw unauthorized();
      const prefix = extractBotTokenPrefix(raw);
      if (!prefix) throw unauthorized();

      let lookup: BotRpcResult;
      try {
        lookup = await client.rpc("bot_token_lookup_internal", {
          p_token_prefix: prefix,
        });
      } catch {
        throw internalError();
      }
      if (lookup.error || !Array.isArray(lookup.data)) throw internalError();
      if (lookup.data.length === 0) throw unauthorized();
      if (lookup.data.length !== 1) throw internalError();

      const row = projectTokenLookup(lookup.data[0]);
      if (
        row.botState !== "active" ||
        !verifyBotTokenHash(raw, pepper, row.tokenHash)
      ) {
        throw unauthorized();
      }

      const usedAt = now();
      const usedAtMs = usedAt.getTime();
      if (!Number.isFinite(usedAtMs)) throw internalError();
      if (
        row.tokenLastUsedAt === null ||
        usedAtMs - row.tokenLastUsedAt >= TOUCH_INTERVAL_MS
      ) {
        try {
          await client.rpc("bot_token_touch_internal", {
            p_token_id: row.tokenId,
            p_used_at: usedAt.toISOString(),
          });
        } catch {
          // Usage telemetry is best effort and must not expose backend details.
        }
      }

      return { botId: row.botId, tokenId: row.tokenId };
    },
  };
}

export async function authenticateBotToken(
  header: string | readonly string[] | undefined,
  repository: BotTokenRepository = createBotTokenRepository(),
): Promise<AuthenticatedBot> {
  return repository.authenticateBotToken(header);
}

function databaseError(error: unknown): BotApiError {
  const code =
    error && typeof error === "object" && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
  switch (code) {
    case "22023":
    case "22P02":
      return new BotApiError("validation_failed");
    case "42501":
      return new BotApiError("forbidden");
    case "23505":
      return new BotApiError("conflict");
    case "P0002":
      return new BotApiError("not_found");
    default:
      return internalError();
  }
}

async function callRpc(
  client: BotRpcClient,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  let response: BotRpcResult;
  try {
    response = await client.rpc(name, args);
  } catch {
    throw internalError();
  }
  if (response.error) throw databaseError(response.error);
  return response.data;
}

function operationResult<T>(value: unknown): BotOperationResult<T> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw internalError();
  }
  const row = value as Record<string, unknown>;
  if (!("result" in row) || typeof row.duplicate !== "boolean") {
    throw internalError();
  }
  return { result: row.result as T, duplicate: row.duplicate };
}

const METHOD_BY_KIND: Record<BotMessageCommand["kind"], string> = {
  text: "sendMessage",
  image: "sendPhoto",
  video: "sendVideo",
  file: "sendDocument",
  audio: "sendVoice",
  chat_action: "sendChatAction",
  edit: "editMessageText",
  delete: "deleteMessage",
};

function fileMetadata(value: unknown): BotFileMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw internalError();
  }
  const row = value as Record<string, unknown>;
  const messageId = row.message_id;
  const bucket = row.bucket_id;
  const objectPath = row.object_path;
  const mimeType = row.mime_type;
  const fileName = row.file_name;
  const rawSize = row.size_bytes;
  const sizeBytes =
    typeof rawSize === "number"
      ? rawSize
      : typeof rawSize === "string" && /^\d{1,12}$/.test(rawSize)
        ? Number(rawSize)
        : null;
  if (
    typeof messageId !== "string" ||
    !UUID_RE.test(messageId) ||
    bucket !== "chat-media" ||
    typeof objectPath !== "string" ||
    objectPath.length < 1 ||
    objectPath.length > 1024 ||
    (mimeType !== null &&
      (typeof mimeType !== "string" || mimeType.length > 128)) ||
    (fileName !== null &&
      (typeof fileName !== "string" || fileName.length > 255)) ||
    (sizeBytes !== null &&
      (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > 104_857_600))
  ) {
    throw internalError();
  }
  return {
    messageId,
    bucket,
    objectPath,
    mimeType,
    fileName,
    sizeBytes,
  };
}

export function createBotMethodRepository(
  client: BotServiceClient = createBotServiceClient(),
): BotMethodRepository {
  return {
    async getMe(botId) {
      const value = await callRpc(client, "bot_get_me_internal", {
        p_bot_id: botId,
      });
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw internalError();
      }
      return value;
    },

    async executeMessageCommand(command) {
      return operationResult(
        await callRpc(client, "bot_message_command_internal", {
          p_bot_id: command.botId,
          p_chat_id: command.chatId,
          p_method: METHOD_BY_KIND[command.kind],
          p_payload: command.payload,
          p_idempotency_key: command.idempotencyKey,
          p_request_fingerprint: command.requestFingerprint,
        }),
      );
    },

    async preflightMediaCommand(input) {
      return operationResult(
        await callRpc(client, "bot_media_command_preflight_internal", {
          p_bot_id: input.botId,
          p_chat_id: input.chatId,
          p_method: METHOD_BY_KIND[input.kind],
          p_idempotency_key: input.idempotencyKey,
          p_request_fingerprint: input.requestFingerprint,
        }),
      );
    },

    async authorizeMedia(input) {
      await callRpc(client, "bot_upload_authorize_internal", {
        p_bot_id: input.botId,
        p_chat_id: input.chatId,
        p_bucket_id: input.bucket,
        p_object_path: input.objectPath,
        p_content_type: input.mimeType,
        p_byte_size: input.sizeBytes,
        p_expires_in_seconds: input.expiresInSeconds,
      });
    },

    async replaceCommands(input) {
      return operationResult(
        await callRpc(client, "bot_commands_replace_internal", {
          p_bot_id: input.botId,
          p_commands: input.commands,
          p_idempotency_key: input.idempotencyKey,
          p_request_fingerprint: input.requestFingerprint,
        }),
      );
    },

    async getCommands(botId) {
      const value = await callRpc(client, "bot_commands_list_internal", {
        p_bot_id: botId,
      });
      if (!Array.isArray(value) || value.length > 100) throw internalError();
      return value;
    },

    async lookupFile(botId, chatId, messageId) {
      return fileMetadata(
        await callRpc(client, "bot_file_lookup_internal", {
          p_bot_id: botId,
          p_chat_id: chatId,
          p_message_id: messageId,
        }),
      );
    },

    async createSignedFileUrl(bucket, objectPath, expiresInSeconds) {
      let response: SignedUrlResult;
      try {
        response = await client.storage
          .from(bucket)
          .createSignedUrl(objectPath, expiresInSeconds);
      } catch {
        throw internalError();
      }
      const signedUrl = response.data?.signedUrl;
      if (
        response.error ||
        typeof signedUrl !== "string" ||
        signedUrl.length > 4096
      ) {
        throw internalError();
      }
      try {
        const parsed = new URL(signedUrl);
        if (
          !["https:", "http:"].includes(parsed.protocol) ||
          parsed.username ||
          parsed.password
        ) {
          throw internalError();
        }
      } catch (error) {
        if (error instanceof BotApiError) throw error;
        throw internalError();
      }
      return signedUrl;
    },

    async answerCallback(input) {
      return operationResult<boolean>(
        await callRpc(client, "bot_callback_answer_internal", {
          p_bot_id: input.botId,
          p_callback_query_id: input.callbackQueryId,
          p_text: input.text,
          p_show_alert: input.showAlert,
          p_idempotency_key: input.idempotencyKey,
          p_request_fingerprint: input.requestFingerprint,
        }),
      );
    },
  };
}

export function createBotChatActionPublisher(client: BotServiceClient): (
  payload: {
    botId: string;
    chatId: string;
    action: string;
    topicId?: string;
  },
) => Promise<void> {
  return async (payload) => {
    const channel = client.channel(`bot-chat-actions:${payload.chatId}`, {
      config: { broadcast: { self: false } },
    });
    try {
      const status = await channel.send({
        type: "broadcast",
        event: "bot_chat_action",
        payload: {
          botId: payload.botId,
          action: payload.action,
          ...(payload.topicId ? { topicId: payload.topicId } : {}),
        },
      });
      if (status !== "ok") throw internalError();
    } finally {
      try {
        await client.removeChannel(channel);
      } catch {
        // Channel cleanup is best effort after a bounded publish attempt.
      }
    }
  };
}
