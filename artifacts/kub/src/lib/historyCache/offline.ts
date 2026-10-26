import type { AuthSessionIdentity } from "../authSessionIdentity";
import type { BotProfile, ChatWithLastMessage, MessageWithSender, Profile } from "../../types/database";
import type { HistoryCacheLease, HistoryCacheStorage } from "./storage";

export interface OfflineMessageScope {
  chatId: string;
  topicId: string | null | undefined;
  generalTopicIds: readonly string[];
}
export interface OfflineMessageSnapshot { messages: MessageWithSender[]; hasMore: boolean }
export interface OfflineHistoryOwner {
  userId: string;
  readProfile(): Promise<Profile | null>;
  writeProfile(value: Profile, isCurrent?: () => boolean): Promise<boolean>;
  readChats(): Promise<ChatWithLastMessage[] | null>;
  writeChats(value: ChatWithLastMessage[], isCurrent?: () => boolean): Promise<boolean>;
  readMessages(scope: OfflineMessageScope): Promise<OfflineMessageSnapshot | null>;
  /** Last observed default view, for display while channel topology is unknown. */
  readDefaultMessages(chatId: string): Promise<OfflineMessageSnapshot | null>;
  writeMessages(scope: OfflineMessageScope, rows: MessageWithSender[], page: { hasMore: boolean }, isCurrent?: () => boolean): Promise<boolean>;
  invalidateChat(chatId: string): Promise<void>;
  invalidate(): Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PAYLOAD = 2 * 1024 * 1024;
const MAX_MESSAGES = 1000;
const encoder = new TextEncoder();
type Row = Record<string, unknown>;
function record(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("OFFLINE_SNAPSHOT_INVALID");
  return value as Row;
}
function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) throw Error("OFFLINE_SNAPSHOT_INVALID");
  return value;
}
function text(value: unknown, max = 65536): string | null {
  return typeof value === "string" && value.length <= max ? value : null;
}
function timestamp(value: unknown): string {
  if (typeof value !== "string" || value.length > 40 || !Number.isFinite(Date.parse(value))) throw Error("OFFLINE_SNAPSHOT_INVALID");
  return value;
}
function pick(value: Row, keys: readonly string[]): Row {
  return Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
}

/** Display only: no contact details, signed URLs or cached role/online authority. */
function profileProjection(value: unknown): Profile {
  const row = record(value);
  return { id: uuid(row.id), full_name: text(row.full_name, 256), username: text(row.username, 256),
    avatar_url: null, bio: null, is_test_account: row.is_test_account === true,
    profile_frame: null, profile_background: null, online_at: null, presence_status: null,
    role: "user", created_at: timestamp(row.created_at), updated_at: timestamp(row.updated_at) };
}

function botProjection(value: unknown) {
  const row = record(value);
  return { id: uuid(row.id), username: text(row.username, 256) ?? "", display_name: text(row.display_name, 256) ?? "",
    description: "", avatar_url: null, state: "active" as const,
    // The sidebar membership join deliberately carries no bot timestamps.
    ...(row.created_at == null ? {} : { created_at: timestamp(row.created_at) }),
    ...(row.updated_at == null ? {} : { updated_at: timestamp(row.updated_at) }) } as BotProfile;
}

function replyProjection(value: unknown): MessageWithSender {
  const row = record(value);
  const sender = row.sender ? record(row.sender) : null;
  // The production reply embed is intentionally partial: it has no timestamps,
  // chat id or full profile. Preserve that shape, not invented timeline fields.
  return { id: uuid(row.id), content: text(row.content), type: row.type,
    deleted_at: row.deleted_at == null ? null : timestamp(row.deleted_at),
    user_id: row.user_id == null ? null : uuid(row.user_id), bot_id: row.bot_id == null ? null : uuid(row.bot_id),
    media_url: null, media_metadata: null,
    sender: sender ? { id: uuid(sender.id), full_name: text(sender.full_name, 256), username: text(sender.username, 256), avatar_url: null } : null,
    bot: row.bot ? botProjection(row.bot) : null,
  } as MessageWithSender;
}

function messageProjection(value: unknown, chatId: string, depth = 0): MessageWithSender {
  const row = record(value);
  if (row.pending || row.failed || row.checking || row.chat_id !== chatId) throw Error("OFFLINE_SNAPSHOT_INVALID");
  const type = row.type;
  if (!["text", "image", "video", "audio", "file", "sticker", "system"].includes(String(type))) throw Error("OFFLINE_SNAPSHOT_INVALID");
  const metadata = row.media_metadata && typeof row.media_metadata === "object" && !Array.isArray(row.media_metadata)
    ? pick(row.media_metadata as Row, ["width", "height", "duration", "duration_ms", "size", "size_bytes", "mime_type", "file_name", "filename", "is_voice", "is_round",
      "album_id", "album_index", "album_count", "uncompressed", "optimized", "original_size_bytes", "original_mime_type", "kind", "shape"]) : null;
  // Metadata leaves are scalar; never copy arbitrary nested provider payloads.
  if (metadata) for (const key of Object.keys(metadata)) {
    if (!["string", "number", "boolean"].includes(typeof metadata[key]) || String(metadata[key]).length > 1024) delete metadata[key];
  }
  const result = {
    id: uuid(row.id), chat_id: uuid(chatId), topic_id: row.topic_id == null ? null : uuid(row.topic_id),
    user_id: row.user_id == null ? null : uuid(row.user_id), bot_id: row.bot_id == null ? null : uuid(row.bot_id),
    type, content: text(row.content), created_at: timestamp(row.created_at),
    edited_at: row.edited_at == null ? null : timestamp(row.edited_at),
    deleted_at: row.deleted_at == null ? null : timestamp(row.deleted_at), pinned: row.pinned === true,
    client_message_id: row.client_message_id == null ? null : uuid(row.client_message_id),
    client_sent_at: row.client_sent_at == null ? null : timestamp(row.client_sent_at),
    media_bucket: text(row.media_bucket, 128), media_path: text(row.media_path, 2048), media_url: null,
    media_metadata: metadata, system_payload: null, bot_reply_markup: null, bot_input_field_placeholder: null,
    reply_to_id: row.reply_to_id == null ? null : uuid(row.reply_to_id),
    forwarded_from_id: row.forwarded_from_id == null ? null : uuid(row.forwarded_from_id),
    forward_origin_name: text(row.forward_origin_name, 256), forward_origin_hidden: row.forward_origin_hidden === true,
    sender: row.sender ? profileProjection(row.sender) : null,
    bot: row.bot ? botProjection(row.bot) : null,
  } as MessageWithSender;
  if (depth === 0 && result.reply_to_id && row.reply_to) {
    // PostgREST self joins may be arrays. Never guess among multiple rows or
    // let a reverse/mismatched join stand in for the actual parent FK.
    const reply = Array.isArray(row.reply_to) ? row.reply_to.length === 1 ? row.reply_to[0] : null : row.reply_to;
    if (reply) {
      try {
        const projected = replyProjection(reply);
        if (projected.id === result.reply_to_id) result.reply_to = projected;
      } catch { /* Keep the message and parent slot, not an unreadable quote. */ }
    }
  }
  return result;
}

function chatProjection(value: unknown): ChatWithLastMessage {
  const row = record(value), id = uuid(row.id);
  if (!["private", "group", "channel", "dm_group"].includes(String(row.type))) throw Error("OFFLINE_SNAPSHOT_INVALID");
  return { id, type: row.type as ChatWithLastMessage["type"], name: text(row.name, 256),
    description: null, avatar_url: null, created_by: row.created_by == null ? null : uuid(row.created_by),
    is_forum: row.is_forum === true, invite_policy: "owner_admin_only",
    created_at: timestamp(row.created_at), updated_at: timestamp(row.updated_at),
    other_user: row.other_user ? profileProjection(row.other_user) : undefined,
    contact_alias: text(row.contact_alias, 256),
    last_message: row.last_message ? messageProjection(row.last_message, id) : undefined,
    unread_count: Number.isSafeInteger(row.unread_count) && (row.unread_count as number) >= 0 ? row.unread_count as number : 0,
    is_pinned: row.is_pinned === true, pinned_order: typeof row.pinned_order === "number" ? row.pinned_order : null,
    pinned_at: row.pinned_at == null ? null : timestamp(row.pinned_at),
    hidden_at: row.hidden_at == null ? null : timestamp(row.hidden_at),
    cleared_at: row.cleared_at == null ? null : timestamp(row.cleared_at),
    bots: Array.isArray(row.bots) ? row.bots.slice(0, 100).map(botProjection) : [],
  };
}

function messageKey(scope: OfflineMessageScope, legacy = false): string {
  uuid(scope.chatId);
  if (scope.topicId) uuid(scope.topicId);
  return `messages:${scope.chatId}:` + JSON.stringify([scope.topicId === undefined ? "all" : scope.topicId,
    typeof scope.topicId === "string" && !legacy ? [] : [...new Set(scope.generalTopicIds.map(uuid))].sort()]);
}

function defaultScopeKey(chatId: string): string {
  return `messages:${uuid(chatId)}:default-scope`;
}

function defaultScope(value: unknown, chatId: string): OfflineMessageScope {
  const row = record(value);
  if (row.chatId !== uuid(chatId) || !["all", "root"].includes(String(row.mode))
    || !Array.isArray(row.generalTopicIds) || row.generalTopicIds.length > 1000) throw Error("OFFLINE_DEFAULT_SCOPE");
  const ids = row.generalTopicIds.map(uuid);
  if (new Set(ids).size !== ids.length) throw Error("OFFLINE_DEFAULT_SCOPE");
  return { chatId, topicId: row.mode === "all" ? undefined : null, generalTopicIds: ids };
}

function scopedMessage(value: unknown, scope: OfflineMessageScope): MessageWithSender {
  const result = messageProjection(value, scope.chatId);
  if (scope.topicId !== undefined && (scope.topicId
    ? result.topic_id !== scope.topicId
    : result.topic_id !== null && !scope.generalTopicIds.includes(result.topic_id))) throw Error("OFFLINE_TOPIC");
  return result;
}

async function digest(payload: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", encoder.encode(payload));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

/** Local last-known display, deliberately distinct from fresh SQL admission. */
export function createOfflineHistory({ storage, namespace, now = Date.now }: {
  storage: HistoryCacheStorage; namespace: string; now?: () => number;
}) {
  let identity: AuthSessionIdentity | null = null, revision = 0;
  let retirementFailed = false;
  const listeners = new Set<(chatId: string | null, broadcast: boolean) => void>();
  const writes = new Map<string, Promise<boolean>>();
  const defaultWrites = new Map<string, Promise<boolean>>();
  const notify = (chatId: string | null, broadcast = true) => { for (const listener of listeners) listener(chatId, broadcast); };
  let pendingRetirement: Promise<unknown> = Promise.resolve();
  const partition = (id: AuthSessionIdentity) => `${namespace}|offline-v1|${id.sessionId ?? "legacy"}`;
  const capture = (): OfflineHistoryOwner | null => {
    if (!identity) return null;
    const owner = { ...identity }, version = revision, ns = partition(owner);
    const active = () => !retirementFailed && revision === version && identity?.userId === owner.userId && identity?.sessionId === owner.sessionId;
    const lease = async (): Promise<HistoryCacheLease> => { await pendingRetirement; return storage.capture(ns, owner.userId); };
    const read = async <T>(key: string, project: (value: unknown) => T): Promise<T | null> => {
      try {
        if (!active()) return null;
        const held = await lease(); if (!active()) return null;
        const saved = await storage.read(held, key, now());
        if (!saved || !active() || encoder.encode(saved.payload).byteLength > MAX_PAYLOAD ||
          saved.digest !== await digest(saved.payload) || !active()) return null;
        const envelope = record(JSON.parse(saved.payload));
        if (envelope.version !== 1 || envelope.key !== key) return null;
        const value = project(envelope.value);
        const final = await storage.capture(ns, owner.userId);
        return active() && final.generation === held.generation ? value : null;
      } catch { return null; }
    };
    const write = async (key: string, project: () => unknown, isCurrent = () => true): Promise<boolean> => {
      try {
        if (!active() || !isCurrent()) return false;
        // Project synchronously before callers can mutate the input across await.
        const payload = JSON.stringify({ version: 1, key, value: project() });
        if (encoder.encode(payload).byteLength > MAX_PAYLOAD) return false;
        const queueKey = JSON.stringify([ns, owner.userId, key]);
        // Preserve invocation order across asynchronous hashing and IDB. A slow
        // earlier writer must not become the final durable version of a page.
        const task = (writes.get(queueKey) ?? Promise.resolve(false)).then(async () => {
          if (!active() || !isCurrent()) return false;
          const held = await lease(); if (!active() || !isCurrent()) return false;
          const hash = await digest(payload); if (!active() || !isCurrent()) return false;
          return await storage.write(held, key, { payload, digest: hash }, now) && active() && isCurrent();
        }).catch(() => false);
        writes.set(queueKey, task);
        try { return await task; } finally { if (writes.get(queueKey) === task) writes.delete(queueKey); }
      } catch { return false; }
    };
    const invalidate = async () => {
      if (!active()) return;
      revision += 1;
      notify(null);
      pendingRetirement = pendingRetirement.catch(() => {}).then(() => storage.invalidate(ns, owner.userId))
        .catch(() => { retirementFailed = true; });
      await pendingRetirement;
    };
    const readMessages = async (scope: OfflineMessageScope): Promise<OfflineMessageSnapshot | null> => {
      try {
        const held = { ...scope, generalTopicIds: [...scope.generalTopicIds] };
        const key = messageKey(held);
        const project = (value: unknown) => {
          const row = record(value);
          if (!Array.isArray(row.messages) || row.messages.length > MAX_MESSAGES || typeof row.hasMore !== "boolean") throw Error("OFFLINE_MESSAGES");
          return { messages: row.messages.map(item => scopedMessage(item, held)), hasMore: row.hasMore };
        };
        const snapshot = await read(key, project);
        // Explicit topics do not depend on unrelated general-channel metadata.
        // Retain exact legacy reads when that old metadata is still available.
        const legacyKey = messageKey(held, true);
        return snapshot ?? (legacyKey !== key ? await read(legacyKey, project) : null);
      } catch { return null; }
    };
    return {
      userId: owner.userId,
      readProfile: () => read("profile", value => {
        const result = profileProjection(value); if (result.id !== owner.userId) throw Error("OFFLINE_OWNER"); return result;
      }),
      writeProfile: (value, current) => write("profile", () => {
        const result = profileProjection(value); if (result.id !== owner.userId) throw Error("OFFLINE_OWNER"); return result;
      }, current),
      readChats: () => read("chats", value => {
        if (!Array.isArray(value) || value.length > 1000) throw Error("OFFLINE_CHATS"); return value.map(chatProjection);
      }),
      writeChats: (value, current) => write("chats", () => value.slice(0, 1000).map(chatProjection), current),
      readMessages,
      readDefaultMessages: async chatId => {
        try {
          const scope = await read(defaultScopeKey(chatId), value => defaultScope(value, chatId));
          return scope ? readMessages(scope) : null;
        } catch { return null; }
      },
      writeMessages: (scope, rows, page, current) => {
        try {
          const key = messageKey(scope);
          const value = { messages: rows.slice(-MAX_MESSAGES).map(row => scopedMessage(row, scope)),
            hasMore: page.hasMore || rows.length > MAX_MESSAGES };
          if (typeof scope.topicId === "string") return write(key, () => value, current);
          const index = { chatId: scope.chatId, mode: scope.topicId === undefined ? "all" : "root",
            generalTopicIds: [...new Set(scope.generalTopicIds.map(uuid))].sort() };
          const queueKey = JSON.stringify([ns, owner.userId, scope.chatId]);
          // Publish only a committed page. Default-scope changes share FIFO order;
          // an older all/root writer must not replace the newer display pointer.
          const task = (defaultWrites.get(queueKey) ?? Promise.resolve(false)).then(async () => {
            if (!active() || (current && !current())) return false;
            if (!await write(key, () => value, current)) return false;
            return write(defaultScopeKey(index.chatId), () => index, current);
          }).catch(() => false);
          defaultWrites.set(queueKey, task);
          void task.then(() => { if (defaultWrites.get(queueKey) === task) defaultWrites.delete(queueKey); });
          return task;
        } catch { return Promise.resolve(false); }
      },
      invalidateChat: async chatId => {
        if (!active()) return;
        uuid(chatId); revision += 1;
        notify(chatId);
        pendingRetirement = pendingRetirement.catch(() => {}).then(async () => {
          // Clearing every scope is the conservative fallback for old adapters.
          if (storage.invalidatePrefix) await storage.invalidatePrefix(ns, owner.userId, `messages:${chatId}:`);
          else await storage.invalidate(ns, owner.userId);
          // The sidebar preview may contain the very message just retired.
          await storage.invalidate(ns, owner.userId, "chats");
        }).catch(() => { retirementFailed = true; });
        await pendingRetirement;
      },
      invalidate,
    };
  };
  return { capture,
    subscribe(listener: (chatId: string | null, broadcast: boolean) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    receiveRetirement(value: unknown) {
      try {
        const row = record(value);
        if (!identity || row.namespace !== namespace || row.userId !== identity.userId || row.sessionId !== identity.sessionId) return;
        if (row.chatId !== null) uuid(row.chatId);
        const current = { ...identity }, ns = partition(current);
        revision += 1; notify(row.chatId as string | null, false);
        pendingRetirement = pendingRetirement.catch(() => {}).then(async () => {
          if (row.chatId !== null && storage.invalidatePrefix) {
            await storage.invalidatePrefix(ns, current.userId, `messages:${row.chatId}:`);
            await storage.invalidate(ns, current.userId, "chats");
          } else await storage.invalidate(ns, current.userId);
        }).catch(() => { retirementFailed = true; });
      } catch { /* Ignore malformed/unrelated document messages. */ }
    },
    identity: () => identity ? { namespace, ...identity } : null,
    setIdentity(next: AuthSessionIdentity | null) {
    if (identity?.userId === next?.userId && identity?.sessionId === next?.sessionId) return;
    const previous = identity;
    identity = next ? { ...next } : null; revision += 1;
    notify(null, false);
    if (previous) pendingRetirement = pendingRetirement.catch(() => {}).then(() => storage.invalidate(partition(previous), previous.userId))
      .catch(() => { retirementFailed = true; });
    // The promise is also awaited before the next read; do not leak an unhandled rejection.
    void pendingRetirement.catch(() => {});
  } };
}
