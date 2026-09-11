import { isIncomingMessage } from "./messageActor.ts";
import { sameData } from "./structuralSharing.ts";

/**
 * What one Realtime event changes in the chat list, worked out without asking
 * the server.
 *
 * Every `messages` INSERT or UPDATE the client could see, and every UPDATE of
 * this user's own `chat_members` row — which is what a read receipt writes —
 * used to refetch the whole list: the memberships, the chats with their members
 * and profiles, and the summaries RPC. Each of those refetches built every row
 * as a new object, so every row rendered, for one message in one chat (D-088).
 *
 * An event names one chat and carries the row that changed, and that is enough
 * for almost everything a row shows: the preview, the unread count, the pin and
 * the order. Each function here returns the list untouched — the same array —
 * when the event changes nothing, and otherwise the list with that one chat
 * replaced, together with what the event could not settle on its own:
 *
 * - `unknown-chat`: the chat is not in the list. It is new to this user, or it
 *   was hidden and a message is bringing it back, so the list must be fetched.
 * - `needs-row`: a bot's message. A group's preview names the bot, and the
 *   Realtime row carries only its id.
 * - `needs-summary`: the preview or the count depends on messages the event
 *   does not describe — the preview itself was deleted, an unread message was,
 *   or a read stopped short of the newest message.
 * - `needs-refetch`: a membership change the list is filtered by (hidden,
 *   cleared).
 *
 * Every function is idempotent, and that is load-bearing. `useChats` applies an
 * event as it arrives and applies it once more on top of any full fetch that
 * was already in flight, so the fetch's older snapshot cannot put back what the
 * event changed. Applied twice, an event must land once.
 *
 * Sorting is left to the caller, whose sort knows about saved and pinned chats.
 */

/** The columns of a `messages` row read here. Realtime sends every column, and the rest are carried through. */
export interface MessageRowLike {
  id: string;
  chat_id: string;
  user_id: string | null;
  bot_id: string | null;
  type?: string | null;
  created_at: string;
  deleted_at?: string | null;
  client_message_id?: string | null;
  sender?: unknown;
  bot?: unknown;
}

export interface MemberLike {
  user_id: string;
  role?: string | null;
  joined_at?: string | null;
  last_read_at?: string | null;
  last_delivered_at?: string | null;
  profile?: unknown;
}

export interface ChatLike {
  id: string;
  updated_at: string;
  unread_count?: number;
  cleared_at?: string | null;
  hidden_at?: string | null;
  is_pinned?: boolean;
  pinned_at?: string | null;
  pinned_order?: number | null;
  last_message?: MessageRowLike | null;
  members?: readonly MemberLike[];
}

/** A `chat_members` row as Realtime sends it. */
export interface MembershipRowLike {
  chat_id: string;
  user_id: string;
  role?: string | null;
  joined_at?: string | null;
  last_read_at?: string | null;
  last_delivered_at?: string | null;
  hidden_at?: string | null;
  cleared_at?: string | null;
  pinned?: boolean | null;
  pinned_at?: string | null;
  pinned_order?: number | null;
}

export interface ChatListEventContext {
  currentUserId: string;
  /**
   * The chat on screen, while the page is visible. A message that lands there
   * is marked read as it arrives, so it is not counted as unread.
   */
  readingChatId: string | null;
}

export type IncomingMessageOutcome = "applied" | "ignored" | "unknown-chat" | "needs-row";
export type MessageUpdateOutcome = "applied" | "ignored" | "needs-summary";
export type MembershipUpdateOutcome = "applied" | "ignored" | "unknown-chat" | "needs-summary" | "needs-refetch";

export type ChatListEvent =
  | { kind: "message-insert"; row: MessageRowLike }
  | { kind: "message-update"; row: MessageRowLike }
  | { kind: "own-membership"; row: MembershipRowLike }
  | { kind: "peer-receipt"; row: MembershipRowLike };

export type ChatListEventOutcome = IncomingMessageOutcome | MessageUpdateOutcome | MembershipUpdateOutcome;

/** The joins a preview carries that are not columns, so an UPDATE row can never overwrite them. */
const JOINED_KEYS = new Set(["sender", "bot", "reactions", "reply_to"]);

function timeOf(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

/**
 * Whether two timestamps are the same instant.
 *
 * PostgREST and Realtime write the same `timestamptz` differently, so string
 * equality would call a receipt that moved nothing a change, and render a row
 * for it.
 */
function sameInstant(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return (a || null) === (b || null);
  return timeOf(a) === timeOf(b);
}

/** The value already held when it is the same instant, so an unchanged field keeps its string. */
function instantOr(existing: string | null | undefined, incoming: string | null | undefined): string | null {
  return sameInstant(existing, incoming) ? (existing ?? incoming ?? null) : (incoming ?? null);
}

function laterTimestamp(a: string, b: string): string {
  return timeOf(b) > timeOf(a) ? b : a;
}

function replaceAt<T>(chats: readonly T[], index: number, chat: T): T[] {
  const next = chats.slice();
  next[index] = chat;
  return next;
}

function isSameMessage(current: MessageRowLike, row: MessageRowLike): boolean {
  if (current.id === row.id) return true;
  return Boolean(
    current.client_message_id &&
      current.client_message_id === row.client_message_id &&
      current.user_id === row.user_id &&
      current.bot_id === row.bot_id,
  );
}

function incoming(row: MessageRowLike, currentUserId: string): boolean {
  return isIncomingMessage({ type: row.type ?? null, user_id: row.user_id, bot_id: row.bot_id }, currentUserId);
}

/**
 * When this user last read the chat, as the server counts unread: the latest of
 * the read mark, the join and the clear. `chat_list_summaries` takes exactly
 * this `greatest(...)`.
 */
export function readWatermark(chat: ChatLike, currentUserId: string): number {
  const me = chat.members?.find((member) => member.user_id === currentUserId);
  return Math.max(timeOf(me?.last_read_at), timeOf(me?.joined_at), timeOf(chat.cleared_at));
}

/**
 * The row as a preview, or `null` when it cannot be one yet.
 *
 * A sender is filled in from the chat's own members, who carry full profiles;
 * a preview does not need one to render, so a sender nobody knows is left empty
 * rather than fetched. A bot is not a member, and a group's preview names it. A
 * row that carries the `bot` join at all — a fetched one — is complete, even
 * when the bot has since been deleted and the join is null.
 */
function previewOf(row: MessageRowLike, chat: ChatLike): MessageRowLike | null {
  if (row.bot_id !== null) return Object.prototype.hasOwnProperty.call(row, "bot") ? row : null;
  if (row.sender) return row;
  if (row.user_id === null) return { ...row, sender: null, bot: null };
  const profile = chat.members?.find((member) => member.user_id === row.user_id)?.profile ?? null;
  return { ...row, sender: profile, bot: null };
}

/** A new message: the preview, the count, and the time the list orders by. */
export function applyIncomingMessage<T extends ChatLike>(
  chats: readonly T[],
  row: MessageRowLike,
  context: ChatListEventContext,
): { chats: T[]; outcome: IncomingMessageOutcome } {
  const unchanged = chats as T[];
  const index = chats.findIndex((chat) => chat.id === row.chat_id);
  if (index === -1) return { chats: unchanged, outcome: "unknown-chat" };
  const chat = chats[index];
  if (row.deleted_at) return { chats: unchanged, outcome: "ignored" };

  const createdAt = timeOf(row.created_at);
  if (chat.cleared_at && createdAt <= timeOf(chat.cleared_at)) return { chats: unchanged, outcome: "ignored" };

  const last = chat.last_message ?? null;
  // Already the preview: applied before, or brought in by the fetch this event
  // is being replayed over.
  if (last && isSameMessage(last, row)) return { chats: unchanged, outcome: "ignored" };
  // Older than the preview: delivered out of order, or already counted by the
  // fetch the preview came from. Leaving it can only under-count until the
  // next revalidation; counting it could count it twice.
  if (last && createdAt < timeOf(last.created_at)) return { chats: unchanged, outcome: "ignored" };

  const preview = previewOf(row, chat);
  if (!preview) return { chats: unchanged, outcome: "needs-row" };

  const counts =
    incoming(row, context.currentUserId) &&
    context.readingChatId !== chat.id &&
    createdAt > readWatermark(chat, context.currentUserId);

  const next = {
    ...chat,
    last_message: preview,
    unread_count: (chat.unread_count ?? 0) + (counts ? 1 : 0),
    updated_at: laterTimestamp(chat.updated_at, row.created_at),
  } as T;
  return { chats: replaceAt(chats, index, next), outcome: "applied" };
}

/** An edit, a deletion or any other change to a message row. */
export function applyMessageUpdate<T extends ChatLike>(
  chats: readonly T[],
  row: MessageRowLike,
  context: Pick<ChatListEventContext, "currentUserId">,
): { chats: T[]; outcome: MessageUpdateOutcome } {
  const unchanged = chats as T[];
  const index = chats.findIndex((chat) => chat.id === row.chat_id);
  if (index === -1) return { chats: unchanged, outcome: "ignored" };
  const chat = chats[index];
  const createdAt = timeOf(row.created_at);
  if (chat.cleared_at && createdAt <= timeOf(chat.cleared_at)) return { chats: unchanged, outcome: "ignored" };

  const last = chat.last_message ?? null;
  if (last && last.id === row.id) {
    const columns = Object.fromEntries(
      Object.entries(row).filter(([key, value]) => value !== undefined && !JOINED_KEYS.has(key)),
    );
    const patched = { ...last, ...columns } as MessageRowLike;
    // The preview is the newest message that is not deleted, so deleting it
    // hands the row to a message this event says nothing about. Until the
    // summary names that one, the row says the message was deleted.
    const outcome: MessageUpdateOutcome = row.deleted_at ? "needs-summary" : "applied";
    if (sameData(patched, last)) return { chats: unchanged, outcome: row.deleted_at ? "needs-summary" : "ignored" };
    return { chats: replaceAt(chats, index, { ...chat, last_message: patched } as T), outcome };
  }

  if (!row.deleted_at) {
    // Newer than the preview, or a preview where there was none: the list
    // missed this message's insert.
    const missed = !last || createdAt > timeOf(last.created_at);
    return { chats: unchanged, outcome: missed ? "needs-summary" : "ignored" };
  }

  const mayHaveBeenUnread =
    (chat.unread_count ?? 0) > 0 &&
    incoming(row, context.currentUserId) &&
    createdAt > readWatermark(chat, context.currentUserId);
  return { chats: unchanged, outcome: mayHaveBeenUnread ? "needs-summary" : "ignored" };
}

/**
 * This user's own membership changed: a read from this or another device, a
 * delivery mark, a pin, a hide or a clear.
 */
export function applyOwnMembershipUpdate<T extends ChatLike>(
  chats: readonly T[],
  row: MembershipRowLike,
  context: Pick<ChatListEventContext, "currentUserId">,
): { chats: T[]; outcome: MembershipUpdateOutcome } {
  const unchanged = chats as T[];
  if (row.user_id !== context.currentUserId) return { chats: unchanged, outcome: "ignored" };
  const index = chats.findIndex((chat) => chat.id === row.chat_id);
  if (index === -1) return { chats: unchanged, outcome: "unknown-chat" };
  const chat = chats[index];

  if (
    ("hidden_at" in row && !sameInstant(row.hidden_at, chat.hidden_at)) ||
    ("cleared_at" in row && !sameInstant(row.cleared_at, chat.cleared_at))
  ) {
    return { chats: unchanged, outcome: "needs-refetch" };
  }

  const patch: Partial<ChatLike> = {};
  if ("pinned" in row) {
    patch.is_pinned = Boolean(row.pinned);
    patch.pinned_at = instantOr(chat.pinned_at, row.pinned_at);
    patch.pinned_order = row.pinned_order ?? null;
  }

  const members = chat.members;
  const meIndex = members ? members.findIndex((member) => member.user_id === row.user_id) : -1;
  const me = members && meIndex !== -1 ? members[meIndex] : null;
  const readAdvanced = "last_read_at" in row && timeOf(row.last_read_at) > timeOf(me?.last_read_at);
  if (members && me) {
    const nextMe: MemberLike = { ...me };
    if ("last_read_at" in row) nextMe.last_read_at = instantOr(me.last_read_at, row.last_read_at);
    if ("last_delivered_at" in row) nextMe.last_delivered_at = instantOr(me.last_delivered_at, row.last_delivered_at);
    if (row.role) nextMe.role = row.role;
    if (!sameData(nextMe, me)) {
      const nextMembers = members.slice();
      nextMembers[meIndex] = nextMe;
      patch.members = nextMembers;
    }
  }

  let outcome: MembershipUpdateOutcome = "applied";
  const unread = chat.unread_count ?? 0;
  if (readAdvanced && unread > 0) {
    const readUntil = Math.max(
      timeOf(row.last_read_at),
      timeOf(row.joined_at ?? me?.joined_at),
      timeOf(chat.cleared_at),
    );
    const last = chat.last_message ?? null;
    if (!last || timeOf(last.created_at) <= readUntil) patch.unread_count = 0;
    else outcome = "needs-summary";
  }

  const next = { ...chat, ...patch } as T;
  if (sameData(next, chat)) {
    return { chats: unchanged, outcome: outcome === "needs-summary" ? "needs-summary" : "ignored" };
  }
  return { chats: replaceAt(chats, index, next), outcome };
}

/** Someone else in a chat read or received up to a point. Only that chat changes. */
export function applyPeerReceipt<T extends ChatLike>(
  chats: readonly T[],
  row: MembershipRowLike,
  context: Pick<ChatListEventContext, "currentUserId">,
): T[] {
  const unchanged = chats as T[];
  if (!row.chat_id || row.user_id === context.currentUserId) return unchanged;
  const index = chats.findIndex((chat) => chat.id === row.chat_id);
  if (index === -1) return unchanged;
  const chat = chats[index];
  const members = chat.members;
  const memberIndex = members ? members.findIndex((member) => member.user_id === row.user_id) : -1;
  if (!members || memberIndex === -1) return unchanged;

  const member = members[memberIndex];
  const nextMember: MemberLike = { ...member };
  if ("last_read_at" in row) nextMember.last_read_at = instantOr(member.last_read_at, row.last_read_at);
  if ("last_delivered_at" in row) {
    nextMember.last_delivered_at = instantOr(member.last_delivered_at, row.last_delivered_at);
  }
  if (sameData(nextMember, member)) return unchanged;

  const nextMembers = members.slice();
  nextMembers[memberIndex] = nextMember;
  return replaceAt(chats, index, { ...chat, members: nextMembers } as T);
}

/** What `chat_list_summaries` answers for a chat. */
export interface ChatSummaryLike {
  lastMessage: MessageRowLike | null;
  unreadCount: number;
}

/**
 * Fresh previews and counts for a few chats, and nothing else about them.
 *
 * A summary is a snapshot from when it was asked for. A message that has
 * arrived since is newer than its answer, so a chat whose preview is already
 * newer than the summary's — and not a deleted one waiting to be replaced — is
 * left as it is.
 */
export function applyChatSummaries<T extends ChatLike>(
  chats: readonly T[],
  summaries: ReadonlyMap<string, ChatSummaryLike>,
): T[] {
  let next: T[] | null = null;
  for (let index = 0; index < chats.length; index += 1) {
    const chat = chats[index];
    const summary = summaries.get(chat.id);
    if (!summary) continue;
    const current = chat.last_message ?? null;
    const fresh = summary.lastMessage;
    if (current && !current.deleted_at && fresh && timeOf(current.created_at) > timeOf(fresh.created_at)) continue;
    const candidate = {
      ...chat,
      last_message: fresh ?? undefined,
      unread_count: summary.unreadCount,
    } as T;
    if (sameData(candidate, chat)) continue;
    if (!next) next = chats.slice();
    next[index] = candidate;
  }
  return next ?? (chats as T[]);
}

/** The columns a chat row draws from its preview, or sorts, searches or dedupes it by. */
const PREVIEW_COLUMNS = [
  "id",
  "chat_id",
  "type",
  "content",
  "media_url",
  "media_metadata",
  "created_at",
  "edited_at",
  "deleted_at",
  "user_id",
  "bot_id",
  "client_message_id",
] as const;

const LOCAL_SEND_STATES = ["pending", "checking", "failed"] as const;

function identityOf(value: unknown): unknown {
  return value && typeof value === "object" ? ((value as { id?: unknown }).id ?? null) : null;
}

function botFaceOf(value: unknown): unknown {
  if (!value || typeof value !== "object") return null;
  const bot = value as Record<string, unknown>;
  return [bot.id ?? null, bot.state ?? null, bot.display_name ?? null, bot.username ?? null, bot.avatar_url ?? null];
}

/**
 * Whether two copies of one message draw the same chat row.
 *
 * A message in the open chat reaches its preview three times: the Realtime row,
 * the provisional copy the conversation renders at once, and the joined row
 * fetched after it. Each carries different joins, so comparing them whole
 * replaced the preview — and rendered the row — once per copy. Only what the
 * row reads is compared: the columns above, the local send states, who sent it
 * and, for a bot, the name and state a group's preview shows.
 */
export function samePreviewMessage(
  a: MessageRowLike | null | undefined,
  b: MessageRowLike | null | undefined,
): boolean {
  if (!a || !b) return !a && !b;
  const left = a as unknown as Record<string, unknown>;
  const right = b as unknown as Record<string, unknown>;
  for (const key of PREVIEW_COLUMNS) {
    if (!sameData(left[key] ?? null, right[key] ?? null)) return false;
  }
  for (const key of LOCAL_SEND_STATES) {
    if (Boolean(left[key]) !== Boolean(right[key])) return false;
  }
  return identityOf(a.sender) === identityOf(b.sender) && sameData(botFaceOf(a.bot), botFaceOf(b.bot));
}

/** Zero a chat's count, or hand back the same list when it is already zero. */
export function clearUnread<T extends ChatLike>(chats: readonly T[], chatId: string): T[] {
  const index = chats.findIndex((chat) => chat.id === chatId);
  if (index === -1 || !chats[index].unread_count) return chats as T[];
  return replaceAt(chats, index, { ...chats[index], unread_count: 0 } as T);
}

export function reduceChatListEvent<T extends ChatLike>(
  chats: readonly T[],
  event: ChatListEvent,
  context: ChatListEventContext,
): { chats: T[]; outcome: ChatListEventOutcome } {
  switch (event.kind) {
    case "message-insert":
      return applyIncomingMessage(chats, event.row, context);
    case "message-update":
      return applyMessageUpdate(chats, event.row, context);
    case "own-membership":
      return applyOwnMembershipUpdate(chats, event.row, context);
    case "peer-receipt": {
      const next = applyPeerReceipt(chats, event.row, context);
      return { chats: next, outcome: next === chats ? "ignored" : "applied" };
    }
    default:
      return { chats: chats as T[], outcome: "ignored" };
  }
}

/** The events that arrived while a fetch was in flight, over what the fetch returned. */
export function replayChatListEvents<T extends ChatLike>(
  chats: readonly T[],
  events: readonly ChatListEvent[],
  context: ChatListEventContext,
): T[] {
  let next = chats as T[];
  for (const event of events) next = reduceChatListEvent(next, event, context).chats;
  return next;
}
