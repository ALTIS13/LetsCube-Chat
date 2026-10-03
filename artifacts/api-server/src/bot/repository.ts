import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { INLINE_MEDIA_EXTENSION, type InlineMediaMime } from "#bot/inlineMedia";

import { BotApiError } from "#bot/errors";
import {
  extractBotTokenPrefix,
  parseBotAuthorization,
  resolveBotAuthConfig,
  verifyBotTokenHash,
} from "#bot/tokenAuth";
import { MAX_INLINE_PHOTO_BYTES } from "#bot/schemas";
import type { BotMethodInputMap } from "#bot/schemas";

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

type StorageUploadResult = {
  data: { path?: unknown } | null;
  error: unknown;
};

export interface BotServiceClient extends BotRpcClient {
  auth: {
    getUser(accessToken: string): PromiseLike<{
      data: { user: { id?: unknown } | null } | null;
      error: unknown;
    }>;
  };
  storage: {
    from(bucket: string): {
      upload(
        objectPath: string,
        bytes: Buffer,
        options: { contentType: string; upsert: false },
      ): PromiseLike<StorageUploadResult>;
      createSignedUrl(
        objectPath: string,
        expiresInSeconds: number,
      ): PromiseLike<SignedUrlResult>;
      download(path: string, options: Record<string, never>, parameters: { signal: AbortSignal; cache: "no-store" }): {
        asStream(): PromiseLike<{ data: ReadableStream<Uint8Array> | null; error: unknown }>;
      };
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

export type BotViewerActiveReceipt = {
  interface_id: string;
  version: number;
  expires_at: string;
};

export type BotViewerClosedReceipt = {
  interface_id: string;
  version: number;
  closed_at: string;
};

type BotViewerState = BotMethodInputMap["setViewerInterface"]["state"];
type BotViewerWriteBase = {
  botId: string;
  tokenId: string;
  idempotencyKey: string;
  requestFingerprint: string;
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
  uploadPhoto(input: {
    botId: string;
    chatId: string;
    tokenId: string; idempotencyKey: string; requestFingerprint: string; leaseId: string;
    objectPath: string;
    mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
    bytes: Buffer;
  }): Promise<void>;
  uploadInlineMedia(input: {
    botId: string; chatId: string; objectPath: string;
    tokenId: string; idempotencyKey: string; requestFingerprint: string; leaseId: string;
    mimeType: InlineMediaMime; bytes: Buffer;
  }): Promise<void>;
  reserveInlineMedia(input: {
    botId: string; tokenId: string; chatId: string;
    kind: Extract<BotMessageCommand["kind"], "image" | "video" | "file" | "audio">;
    idempotencyKey: string; requestFingerprint: string; objectPath: string;
    mimeType: InlineMediaMime; sizeBytes: number; contentSha256: string; leaseId: string;
  }): Promise<BotOperationResult<unknown> & { leaseId: string | null }>;
  commitInlineMedia(input: {
    botId: string; tokenId: string; idempotencyKey: string; requestFingerprint: string;
    leaseId: string; payload: Record<string, unknown>;
  }): Promise<BotOperationResult<unknown>>;
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
  setViewerInterface(input: BotViewerWriteBase & {
    callbackQueryId: string;
    state: BotViewerState;
  }): Promise<BotOperationResult<BotViewerActiveReceipt>>;
  editViewerInterface(input: BotViewerWriteBase & {
    interfaceId: string;
    expectedVersion: number;
    state: BotViewerState;
  }): Promise<BotOperationResult<BotViewerActiveReceipt>>;
  closeViewerInterface(input: BotViewerWriteBase & {
    interfaceId: string;
    expectedVersion: number;
  }): Promise<BotOperationResult<BotViewerClosedReceipt>>;
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
    global: {
      fetch: (input, init) => fetch(input, {
        ...init,
        signal: init?.signal
          ? AbortSignal.any([init.signal, AbortSignal.timeout(45_000)])
          : AbortSignal.timeout(45_000),
      }),
    },
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

function idempotentMessageWrite(method: string, args: Record<string, unknown>): boolean {
  if (typeof args.p_idempotency_key !== "string" ||
      !/^[A-Za-z0-9._:-]{8,128}$/.test(args.p_idempotency_key) ||
      typeof args.p_request_fingerprint !== "string" ||
      !TOKEN_HASH_RE.test(args.p_request_fingerprint)) return false;
  // Exact RPCs with SQL replay receipts; never infer safety from a bot_* prefix.
  switch (method) {
    case "bot_message_command_internal":
      return ["sendMessage", "sendPhoto", "sendVideo", "sendDocument", "sendVoice",
        "editMessageText", "deleteMessage"].includes(args.p_method as string);
    case "bot_media_command_preflight_internal":
      return ["sendPhoto", "sendVideo", "sendDocument", "sendVoice"].includes(args.p_method as string);
    case "bot_media_ingest_commit_internal":
      return true;
    default:
      return false;
  }
}

function databaseError(error: unknown, method: string, args: Record<string, unknown>): BotApiError {
  if ((method.startsWith("bot_media_ingest_") || method.startsWith("bot_media_upload_")) && error && typeof error === "object") {
    const row = error as Record<string, unknown>;
    if (row.code === "55000" && row.message === "bot_media_ingest_busy") {
      const retry = typeof row.details === "string" && /^\d{1,3}$/.test(row.details) ? Number(row.details) : 120;
      return new BotApiError("rate_limited", Math.max(1, Math.min(120, retry)));
    }
    if (row.code === "55000" && row.message === "bot_media_ingest_lease_expired") return new BotApiError("rate_limited", 1);
    if (row.code === "54000" && row.message === "bot_media_ingest_quota_exceeded") return new BotApiError("quota_exceeded");
    if (row.code === "54000" && row.message === "bot_media_upload_attempts_exceeded") return new BotApiError("quota_exceeded");
    if (row.code === "42501" && row.message === "bot_media_ingest_token_revoked") return new BotApiError("unauthorized");
  }
  const code =
    error && typeof error === "object" && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
  switch (code) {
    case "55P03":
      return idempotentMessageWrite(method, args)
        ? new BotApiError("service_unavailable", 2)
        : internalError();
    case "22023":
    case "22P02":
      return new BotApiError("validation_failed");
    case "42501":
      return new BotApiError("forbidden");
    case "23505":
      return new BotApiError("conflict");
    case "40001":
    case "54000":
      return method.startsWith("bot_viewer_interface_")
        ? new BotApiError("conflict")
        : internalError();
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
  if (response.error) throw databaseError(response.error, name, args);
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

export function projectBotViewerReceipt(value: unknown, kind: "active"): BotViewerActiveReceipt;
export function projectBotViewerReceipt(value: unknown, kind: "closed"): BotViewerClosedReceipt;
export function projectBotViewerReceipt(
  value: unknown,
  kind: "active" | "closed",
): BotViewerActiveReceipt | BotViewerClosedReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw internalError();
  }
  const row = value as Record<string, unknown>;
  const timestamp = kind === "active" ? row.expires_at : row.closed_at;
  if (
    typeof row.interface_id !== "string" ||
    !UUID_RE.test(row.interface_id) ||
    typeof row.version !== "number" ||
    !Number.isSafeInteger(row.version) ||
    row.version < 1 ||
    typeof timestamp !== "string" ||
    !Number.isFinite(Date.parse(timestamp))
  ) {
    throw internalError();
  }
  return kind === "active"
    ? { interface_id: row.interface_id, version: row.version, expires_at: timestamp }
    : { interface_id: row.interface_id, version: row.version, closed_at: timestamp };
}

function viewerOperationResult(value: unknown, kind: "active"): BotOperationResult<BotViewerActiveReceipt>;
function viewerOperationResult(value: unknown, kind: "closed"): BotOperationResult<BotViewerClosedReceipt>;
function viewerOperationResult(
  value: unknown,
  kind: "active" | "closed",
): BotOperationResult<BotViewerActiveReceipt | BotViewerClosedReceipt> {
  const operation = operationResult<unknown>(value);
  return {
    result: kind === "active"
      ? projectBotViewerReceipt(operation.result, "active")
      : projectBotViewerReceipt(operation.result, "closed"),
    duplicate: operation.duplicate,
  };
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

// A Supabase bucket id, and nothing that could be spliced into a storage path.
const BUCKET_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
function uploadAlreadyExists(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const row = error as Record<string, unknown>;
  const status = Number(row.status ?? row.statusCode);
  const code = [row.statusCode, row.code, row.error].find(
    (value) => typeof value === "string" && !/^\d+$/.test(value),
  );
  return (
    (status === 409 &&
      (code === "ResourceAlreadyExists" ||
        code === "KeyAlreadyExists" ||
        (code === undefined && row.statusCode === "409"))) ||
    ((status === 400 || status === 409) && code === "Duplicate")
  );
}

// `bot_file_lookup_internal` builds its result with `jsonb_strip_nulls`, so a
// fact it does not know arrives as an ABSENT key rather than a null one. No
// production message carries `media_metadata.file_name` at all, so reading
// `undefined` as a type error would have turned D-249's 404 into a 500 for
// every file the moment the database started answering.
function optionalText(value: unknown, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length > maxLength) {
    throw internalError();
  }
  return value;
}

function optionalByteSize(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const size =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^[0-9]{1,15}$/.test(value)
        ? Number(value)
        : null;
  // No upper bound of the gateway's own. The number is the object's real
  // length in `storage.objects`, or a size the client declared, and both are
  // already bounded by the bucket's `file_size_limit` at upload time. The cap
  // this replaces was 100 MiB, smaller than the `media` bucket's 250 MB limit,
  // so a legitimate large file would have been answered with a 500.
  if (size !== null && (!Number.isSafeInteger(size) || size < 0)) {
    throw internalError();
  }
  return size;
}

function fileMetadata(value: unknown): BotFileMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw internalError();
  }
  const row = value as Record<string, unknown>;
  const messageId = row.message_id;
  const bucket = row.bucket_id;
  const objectPath = row.object_path;
  const mimeType = optionalText(row.mime_type, 128);
  const fileName = optionalText(row.file_name, 255);
  const sizeBytes = optionalByteSize(row.size_bytes);
  if (
    typeof messageId !== "string" ||
    !UUID_RE.test(messageId) ||
    // WHICH bucket a bot may reach is the database's decision, and only the
    // database's: `bot_file_lookup_internal` admits an object whose bucket is
    // public, or whose path is scoped to this very chat (D-249). Naming a
    // bucket here once meant `getFile` answered 404 for every file in the
    // product; naming the new one would put the same rule in two places and
    // let them drift apart again. The gateway checks the SHAPE instead.
    typeof bucket !== "string" ||
    !BUCKET_ID_RE.test(bucket) ||
    typeof objectPath !== "string" ||
    objectPath.length < 1 ||
    objectPath.length > 1024
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
  type UploadInput = Parameters<BotMethodRepository["uploadInlineMedia"]>[0];
  const checkUploadAttempt = (value: unknown, attemptId: string, state: string) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw internalError();
    const row = value as Record<string, unknown>;
    if (typeof row.attempt_id !== "string" || row.attempt_id.toLowerCase() !== attemptId.toLowerCase() ||
        row.state !== state) throw internalError();
  };
  const beginUploadAttempt = async (input: UploadInput) => {
    const value = await callRpc(client, "bot_media_upload_begin_internal", {
      p_bot_id: input.botId, p_token_id: input.tokenId, p_chat_id: input.chatId,
      p_idempotency_key: input.idempotencyKey, p_request_fingerprint: input.requestFingerprint,
      p_lease_id: input.leaseId, p_object_path: input.objectPath, p_content_type: input.mimeType,
      p_byte_size: input.bytes.length,
      p_content_sha256: createHash("sha256").update(input.bytes).digest("hex"),
    });
    checkUploadAttempt(value, input.leaseId, "pending");
  };
  const finishUploadAttempt = async (input: UploadInput, outcome: "acknowledged" | "unknown") => {
    const value = await callRpc(client, "bot_media_upload_finish_internal", {
      p_bot_id: input.botId, p_idempotency_key: input.idempotencyKey,
      p_attempt_id: input.leaseId, p_outcome: outcome,
    });
    checkUploadAttempt(value, input.leaseId, outcome);
  };
  const uploadBytes = async (input: UploadInput) => {
    let response: StorageUploadResult;
    try {
      response = await client.storage.from("chat-media").upload(input.objectPath, input.bytes,
        { contentType: input.mimeType, upsert: false });
    } catch { throw internalError(); }
    if (!response.error) {
      if (response.data?.path !== input.objectPath) throw internalError();
      return;
    }
    if (!uploadAlreadyExists(response.error)) throw internalError();
    // A 409 proves a name exists, not that it contains the bytes we reserved.
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(45_000)]);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const downloaded = await client.storage.from("chat-media").download(input.objectPath, {},
        { signal, cache: "no-store" }).asStream();
      if (downloaded.error || !downloaded.data) throw internalError();
      reader = downloaded.data.getReader();
      const hash = createHash("sha256");
      let length = 0;
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.byteLength;
        if (length > input.bytes.length) throw new BotApiError("conflict");
        hash.update(part.value);
      }
      if (length !== input.bytes.length || hash.digest("hex") !== createHash("sha256").update(input.bytes).digest("hex")) {
        throw new BotApiError("conflict");
      }
    } catch (error) {
      throw error instanceof BotApiError ? error : internalError();
    } finally {
      controller.abort();
      await reader?.cancel().catch(() => {});
      reader?.releaseLock();
    }
  };
  const uploadInlineMedia: BotMethodRepository["uploadInlineMedia"] = async (input) => {
    const suffix = INLINE_MEDIA_EXTENSION[input.mimeType];
    const prefix = `${input.chatId.toLowerCase()}/bots/${input.botId.toLowerCase()}/`;
    if (!UUID_RE.test(input.botId) || !UUID_RE.test(input.chatId) || !suffix ||
        !UUID_RE.test(input.tokenId) || !UUID_RE.test(input.leaseId) ||
        typeof input.idempotencyKey !== "string" ||
        !/^[A-Za-z0-9._:-]{8,128}$/.test(input.idempotencyKey) ||
        !TOKEN_HASH_RE.test(input.requestFingerprint) ||
        input.objectPath !== prefix + input.requestFingerprint + "." + suffix ||
        !input.objectPath.startsWith(prefix) ||
        !new RegExp(`^[0-9a-f]{64}\\.${suffix}$`).test(input.objectPath.slice(prefix.length)) ||
        !Buffer.isBuffer(input.bytes) || input.bytes.length < 1 || input.bytes.length > MAX_INLINE_PHOTO_BYTES) {
      throw internalError();
    }
    // Preserve the bytes admitted by SQL even across an asynchronous RPC wait.
    input = { ...input, bytes: Buffer.from(input.bytes) };
    await beginUploadAttempt(input);
    try {
      await uploadBytes(input);
    } catch (error) {
      // A failed request is not proof that Storage stopped processing PUT.
      // If this write also fails, the durable pending row remains a hold.
      await finishUploadAttempt(input, "unknown").catch(() => {});
      throw error instanceof BotApiError ? error : internalError();
    }
    // Lost acknowledgement never permits message commit; do not replace
    // an observed successful outcome with unknown if its RPC reply is lost.
    await finishUploadAttempt(input, "acknowledged");
  };
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

    uploadPhoto: uploadInlineMedia,
    uploadInlineMedia,
    async reserveInlineMedia(input) {
      const value = await callRpc(client, "bot_media_ingest_reserve_internal", {
        p_bot_id: input.botId, p_token_id: input.tokenId, p_chat_id: input.chatId,
        p_method: METHOD_BY_KIND[input.kind], p_idempotency_key: input.idempotencyKey,
        p_request_fingerprint: input.requestFingerprint, p_object_path: input.objectPath,
        p_content_type: input.mimeType, p_byte_size: input.sizeBytes,
        p_content_sha256: input.contentSha256, p_lease_id: input.leaseId,
      });
      const result = operationResult(value);
      const leaseId = (value as Record<string, unknown>).lease_id;
      if (result.duplicate ? leaseId !== null : typeof leaseId !== "string" || !UUID_RE.test(leaseId)) throw internalError();
      return { ...result, leaseId: leaseId as string | null };
    },
    async commitInlineMedia(input) {
      return operationResult(await callRpc(client, "bot_media_ingest_commit_internal", {
        p_bot_id: input.botId, p_token_id: input.tokenId, p_idempotency_key: input.idempotencyKey,
        p_request_fingerprint: input.requestFingerprint, p_lease_id: input.leaseId, p_payload: input.payload,
      }));
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

    async setViewerInterface(input) {
      return viewerOperationResult(
        await callRpc(client, "bot_viewer_interface_set_internal", {
          p_bot_id: input.botId,
          p_token_id: input.tokenId,
          p_callback_query_id: input.callbackQueryId,
          p_state: input.state,
          p_idempotency_key: input.idempotencyKey,
          p_request_fingerprint: input.requestFingerprint,
        }),
        "active",
      );
    },

    async editViewerInterface(input) {
      return viewerOperationResult(
        await callRpc(client, "bot_viewer_interface_edit_internal", {
          p_bot_id: input.botId,
          p_token_id: input.tokenId,
          p_interface_id: input.interfaceId,
          p_expected_version: input.expectedVersion,
          p_state: input.state,
          p_idempotency_key: input.idempotencyKey,
          p_request_fingerprint: input.requestFingerprint,
        }),
        "active",
      );
    },

    async closeViewerInterface(input) {
      return viewerOperationResult(
        await callRpc(client, "bot_viewer_interface_close_internal", {
          p_bot_id: input.botId,
          p_token_id: input.tokenId,
          p_interface_id: input.interfaceId,
          p_expected_version: input.expectedVersion,
          p_idempotency_key: input.idempotencyKey,
          p_request_fingerprint: input.requestFingerprint,
        }),
        "closed",
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
