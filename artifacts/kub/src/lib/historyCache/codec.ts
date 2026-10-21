import { parseMessageMentions, type MessageMentionsV1 } from "../memberMentions.ts";
import { timestampMicros } from "../readMarkWatermark.ts";

export interface HistoryCacheScope {
  chatId: string;
  mode: "all" | "root" | "topic";
  topicId: string | null;
  before: { createdAt: string; id: string } | null;
}

export interface CachedTextRow {
  id: string;
  user_id: string;
  content: string | null;
  created_at: string;
  edited_at: string | null;
  pinned: boolean;
  topic_id: string | null;
  mention_entities: MessageMentionsV1 | null;
}

export interface HistoryCachePage {
  version: 1;
  chat_id: string;
  scope: HistoryCacheScope["mode"];
  topic_id: string | null;
  general_topic_ids: string[];
  before_created_at: string | null;
  before_id: string | null;
  cleared_at: string | null;
  has_more: boolean;
  next_before_created_at: string | null;
  next_before_id: string | null;
  rows: CachedTextRow[];
}

export interface HistoryCacheSnapshot { payload: string; digest: string }
export interface AdmittedHistoryCachePage extends HistoryCacheSnapshot { page: HistoryCachePage }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const MAX_PAYLOAD_BYTES = 1_048_576;
const PAGE_KEYS = ["version", "chat_id", "scope", "topic_id", "general_topic_ids",
  "before_created_at", "before_id", "cleared_at", "has_more", "next_before_created_at", "next_before_id", "rows"];
const ROW_KEYS = ["id", "user_id", "content", "created_at", "edited_at", "pinned", "topic_id", "mention_entities"];

function record(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  const actual = Reflect.ownKeys(value);
  return actual.length === keys.length && actual.every(key => {
    if (typeof key !== "string" || !keys.includes(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && "value" in descriptor;
  });
}

const uuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
const nullableUuid = (value: unknown): value is string | null => value === null || uuid(value);

function timestamp(value: unknown): value is string {
  if (typeof value !== "string" || !UTC.test(value)) return false;
  const millis = Date.parse(value);
  const micros = timestampMicros(value);
  return Number.isFinite(millis) && Number.isSafeInteger(micros) &&
    new Date(millis).toISOString().slice(0, -1) === value.slice(0, -4);
}

function tupleBefore(at: string, id: string, upperAt: string, upperId: string): boolean {
  const a = timestampMicros(at), b = timestampMicros(upperAt);
  return a !== null && b !== null && (a < b || (a === b && id < upperId));
}

function decode(payload: string, expected: HistoryCacheScope): HistoryCachePage | null {
  if (!uuid(expected.chatId) || !nullableUuid(expected.topicId) ||
      !["all", "root", "topic"].includes(expected.mode) ||
      ((expected.mode === "topic") !== (expected.topicId !== null))) return null;
  const p: unknown = JSON.parse(payload);
  if (!record(p, PAGE_KEYS) || p.version !== 1 || p.chat_id !== expected.chatId ||
      p.scope !== expected.mode || p.topic_id !== expected.topicId ||
      !nullableUuid(p.before_id) || !(p.before_created_at === null || timestamp(p.before_created_at)) ||
      !Array.isArray(p.general_topic_ids) || p.general_topic_ids.length > 100 ||
      !p.general_topic_ids.every(uuid) || typeof p.has_more !== "boolean" ||
      !Array.isArray(p.rows) || p.rows.length > 100 ||
      !nullableUuid(p.next_before_id) || !(p.next_before_created_at === null || timestamp(p.next_before_created_at)) ||
      !(p.cleared_at === null || timestamp(p.cleared_at))) return null;
  if (expected.mode !== "root" && p.general_topic_ids.length !== 0) return null;
  if (p.general_topic_ids.some((value, index, ids) => index > 0 && value <= ids[index - 1])) return null;
  if (expected.before) {
    const beforeMicros = timestampMicros(expected.before.createdAt);
    if (!uuid(expected.before.id) || !Number.isSafeInteger(beforeMicros) ||
        p.before_id !== expected.before.id || !p.before_created_at ||
        timestampMicros(p.before_created_at as string) !== beforeMicros) return null;
  } else if (p.before_created_at !== null || p.before_id !== null) return null;
  if (p.has_more) {
    if (!p.next_before_created_at || !p.next_before_id) return null;
    if (p.before_created_at !== null && !tupleBefore(p.next_before_created_at as string, p.next_before_id,
        p.before_created_at as string, p.before_id as string)) return null;
    if (p.cleared_at !== null && timestampMicros(p.next_before_created_at as string)! <= timestampMicros(p.cleared_at as string)!) return null;
  } else if (p.next_before_created_at !== null || p.next_before_id !== null) return null;
  let previous: CachedTextRow | null = null;
  const ids = new Set<string>();
  for (const value of p.rows) {
    if (!record(value, ROW_KEYS) || !uuid(value.id) || !uuid(value.user_id) ||
        ids.has(value.id) || !(value.content === null || typeof value.content === "string") ||
        !timestamp(value.created_at) || !(value.edited_at === null || timestamp(value.edited_at)) ||
        typeof value.pinned !== "boolean" || !nullableUuid(value.topic_id)) return null;
    const mentions = value.mention_entities ?? { version: 1, revision: null, items: [] };
    if (!parseMessageMentions(value.content ?? "", mentions)) return null;
    if (p.scope === "topic" && value.topic_id !== p.topic_id) return null;
    if (p.scope === "root" && value.topic_id !== null && !p.general_topic_ids.includes(value.topic_id)) return null;
    if (p.cleared_at !== null && timestampMicros(value.created_at)! <= timestampMicros(p.cleared_at as string)!) return null;
    if (previous && !tupleBefore(value.created_at, value.id, previous.created_at, previous.id)) return null;
    if (p.before_created_at !== null && !tupleBefore(value.created_at, value.id, p.before_created_at as string, p.before_id as string)) return null;
    if (p.next_before_created_at !== null && tupleBefore(value.created_at, value.id,
        p.next_before_created_at as string, p.next_before_id as string)) return null;
    previous = value as unknown as CachedTextRow;
    ids.add(value.id);
  }
  return p as unknown as HistoryCachePage;
}

/** A cache snapshot supplies bytes, never access. Only a fresh matching server
 * answer under the caller's still-current owner/privacy fence can admit them. */
export async function admitHistoryCacheReply(
  reply: unknown,
  scope: HistoryCacheScope,
  saved: HistoryCacheSnapshot | null,
  isCurrent: () => boolean,
): Promise<AdmittedHistoryCachePage | null> {
  try {
    if (!isCurrent() || !record(reply, ["status", "payload", "digest"]) ||
        typeof reply.digest !== "string" || !DIGEST.test(reply.digest)) return null;
    let payload: string;
    if (reply.status === "fresh" && typeof reply.payload === "string") payload = reply.payload;
    else if (reply.status === "unchanged" && reply.payload === null && saved?.digest === reply.digest &&
        typeof saved.payload === "string") payload = saved.payload;
    else return null;
    if (payload.length > MAX_PAYLOAD_BYTES) return null;
    const bytes = new TextEncoder().encode(payload);
    if (bytes.byteLength > MAX_PAYLOAD_BYTES) return null;
    const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    const digest = Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, "0")).join("");
    if (!isCurrent() || digest !== reply.digest) return null;
    const page = decode(payload, scope);
    if (!page || !isCurrent()) return null;
    return { payload, digest, page };
  } catch { return null; }
}
