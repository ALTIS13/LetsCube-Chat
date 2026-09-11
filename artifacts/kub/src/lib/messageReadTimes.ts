import type { GroupReadReceiptInfo, GroupReadReceiptUser } from "./groupReadReceipts.ts";
import type { RpcAvailability } from "./rpcAvailability.ts";

/**
 * When each person read a message of yours — the time they read that message,
 * not the time they last read the chat.
 *
 * Until 2026-09-11 «Прочитано» in a private chat's details and the times in
 * «Кто прочитал» were the reader's chat-wide read pointer, `last_read_at`: the
 * moment they last read anything in the chat, the same for every message they
 * had read. `message_read_times` (20260911141000) answers the sender with each
 * reader's exact time, or with no time when there is none to show — the message
 * is older than seven days, or the reader or the sender hides their presence.
 *
 * Where that function is not deployed the details show the pointer, as they
 * did; that is the `unavailable` state, and it is also what a surface without
 * a loader — the DEV capture page — shows.
 *
 * Kept free of React and Supabase so `node --test` can load it.
 */

export const READ_TIMES_RPC = "message_read_times";

export interface MessageReadTime {
  readerId: string;
  hasRead: boolean;
  /** Null when there is no time to show, which is not the same as unread. */
  readAt: string | null;
}

export type ReadTimesState =
  /** No loader, or the server has no such function: show the pointer, as before. */
  | { status: "unavailable" }
  /** A loader, but nothing asked for yet. */
  | { status: "idle" }
  /** Asked; `previous` is the last answer for the same message, kept on screen. */
  | { status: "loading"; previous: MessageReadTime[] | null }
  | { status: "ready"; times: MessageReadTime[] };

export type ReadTimesLoader = (messageId: string) => Promise<MessageReadTime[] | null>;

export function parseMessageReadTimes(data: unknown): MessageReadTime[] | null {
  if (!Array.isArray(data)) return null;
  const times: MessageReadTime[] = [];
  for (const entry of data) {
    if (!entry || typeof entry !== "object") return null;
    const row = entry as Record<string, unknown>;
    if (typeof row.reader_id !== "string" || typeof row.has_read !== "boolean") return null;
    if (row.read_at !== null && row.read_at !== undefined && typeof row.read_at !== "string") return null;
    times.push({ readerId: row.reader_id, hasRead: row.has_read, readAt: typeof row.read_at === "string" ? row.read_at : null });
  }
  return times;
}

/**
 * The loader the conversation uses. It answers null — show the pointer — when
 * the function is missing, when the call fails, or when the answer is not the
 * shape this client knows.
 */
export function createReadTimesLoader(deps: {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
  availability: RpcAvailability;
  isMissingRpc: (error: unknown) => boolean;
}): ReadTimesLoader {
  return async (messageId) => {
    if (!deps.availability.shouldTry(READ_TIMES_RPC)) return null;
    try {
      const { data, error } = await deps.rpc(READ_TIMES_RPC, { p_message_id: messageId });
      if (error) {
        if (deps.isMissingRpc(error)) deps.availability.markMissing(READ_TIMES_RPC);
        return null;
      }
      deps.availability.markPresent(READ_TIMES_RPC);
      return parseMessageReadTimes(data);
    } catch {
      return null;
    }
  };
}

/** What a private chat says about the other person reading one message. */
export interface PrivateReadDisplay {
  read: boolean;
  readAt: string | null;
  /** Read, and its time is on the way. */
  pending: boolean;
}

/**
 * @param pointerReadAt the recipient's `last_read_at` when it reaches the
 *   message, else null — what the details showed before.
 */
export function privateReadDisplay(
  pointerReadAt: string | null,
  recipientId: string | null | undefined,
  state: ReadTimesState,
): PrivateReadDisplay {
  const pointerRead = Boolean(pointerReadAt);
  const fromTimes = (times: MessageReadTime[]): PrivateReadDisplay => {
    const time = times.find((entry) => entry.readerId === recipientId);
    if (!time) return { read: pointerRead, readAt: null, pending: false };
    const read = time.hasRead || pointerRead;
    return { read, readAt: time.hasRead ? time.readAt : null, pending: false };
  };
  switch (state.status) {
    case "unavailable":
    case "idle":
      return { read: pointerRead, readAt: pointerReadAt, pending: false };
    case "loading":
      return state.previous ? fromTimes(state.previous) : { read: pointerRead, readAt: null, pending: pointerRead };
    case "ready":
      return fromTimes(state.times);
  }
}

/**
 * A group's receipt with each reader's exact time. The readers and the count
 * are the server's when it has answered, since the members this client holds
 * may be a receipt behind.
 */
export function groupReadInfoWithTimes(
  info: GroupReadReceiptInfo | null,
  state: ReadTimesState,
  profiles: ReadonlyMap<string, GroupReadReceiptUser["profile"]>,
): GroupReadReceiptInfo | null {
  if (!info) return info;
  const times = state.status === "ready" ? state.times : state.status === "loading" ? state.previous : null;
  if (!times) {
    // Asked and not answered yet: the names, without the pointer's times.
    if (state.status === "loading") {
      return { ...info, readers: info.readers.map((reader) => ({ ...reader, readAt: null })) };
    }
    return info;
  }
  const readers: GroupReadReceiptUser[] = times
    .filter((time) => time.hasRead)
    .map((time) => ({
      userId: time.readerId,
      readAt: time.readAt,
      profile: profiles.get(time.readerId) ?? info.readers.find((reader) => reader.userId === time.readerId)?.profile ?? null,
    }));
  return {
    readCount: readers.length,
    totalRecipients: times.length,
    allRead: times.length > 0 && readers.length === times.length,
    readers,
  };
}

/**
 * Changes whenever another member's read pointer moves — the moment an open
 * details view asks again, which is how a read on another device reaches it.
 */
export function readMarksSignature(
  members: readonly { user_id: string; last_read_at?: string | null }[] | null | undefined,
  senderId: string | null | undefined,
): string {
  return (members ?? [])
    .filter((member) => member.user_id !== senderId)
    .map((member) => `${member.user_id}:${member.last_read_at ?? ""}`)
    .sort()
    .join("|");
}
