/**
 * A group chat's call, as rules — tracker item 45, second phase.
 *
 * The database half is `supabase/migrations/20260930190000_group_chat_calls.sql`:
 * a group chat has one room, and its call lives on that room's row —
 * `call_started_at`, `call_started_by`, `call_message_id`, and `call_ringing`,
 * an object of the people being rung and when each ring began. That is
 * Discord's shape, read in its web bundle on 2026-09-30
 * (`docs/operations/reference-clients.md` §27): a call carries `ongoingRings`
 * keyed by person, and one message that is given its participants and its end.
 *
 * This module imports only the ring rules and the record's words, both as pure
 * as it is, so `node --test` decides every case here
 * (`tests/unit/group-call.test.mts`).
 */

import { VOICE_RING_TTL_SECONDS, voiceRingView, type VoiceRingView } from "./voiceRing.ts";
import { callDurationShort, callDurationSpoken } from "./callRecord.ts";

/** How long a move from a private chat's call into a group chat's stays in force. */
export const GROUP_CALL_MOVE_WINDOW_MS = 120_000;

/** One group chat's room, as the chat list's own read returns it. */
export interface GroupCallRow {
  readonly channelId: string;
  readonly chatId: string;
  /** When the running call began; null when no call is running. */
  readonly startedAt: number | null;
  readonly startedBy: string | null;
  /** The call's message; null when no call is running. */
  readonly messageId: string | null;
  /** Who is being rung, and since when (epoch milliseconds). */
  readonly ringing: ReadonlyMap<string, number>;
  /** A private room whose call went into a group chat's: that room, and when. */
  readonly movedTo: string | null;
  readonly movedAt: number | null;
  readonly participantCount: number;
}

function readInstant(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : null;
}

function readRinging(value: unknown): Map<string, number> {
  const out = new Map<string, number>();
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [person, since] of Object.entries(value as Record<string, unknown>)) {
    const at = readInstant(since);
    if (person.trim().length > 0 && at !== null) out.set(person.trim(), at);
  }
  return out;
}

/**
 * The rooms that carry a call or a move, read defensively.
 *
 * A row with neither is dropped: this store has nothing to say about a room
 * that is only somebody's server channel. An archived room is dropped for the
 * reason the ring's reader drops it — nobody can join it.
 */
export function readGroupCallRows(rows: unknown): GroupCallRow[] {
  if (!Array.isArray(rows)) return [];
  const out: GroupCallRow[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const channelId = typeof record.id === "string" ? record.id : null;
    const chatId = typeof record.chat_id === "string" ? record.chat_id : null;
    if (channelId === null || chatId === null || record.archived === true) continue;
    const messageId = typeof record.call_message_id === "string" ? record.call_message_id : null;
    const startedAt = readInstant(record.call_started_at);
    const movedTo = typeof record.call_moved_to === "string" ? record.call_moved_to : null;
    const movedAt = readInstant(record.call_moved_at);
    if (messageId === null && movedTo === null) continue;
    const count = typeof record.participant_count === "number" ? record.participant_count : 0;
    out.push({
      channelId,
      chatId,
      startedAt: messageId === null ? null : startedAt,
      startedBy: typeof record.call_started_by === "string" ? record.call_started_by : null,
      messageId: startedAt === null ? null : messageId,
      ringing: readRinging(record.call_ringing),
      movedTo: movedAt === null ? null : movedTo,
      movedAt: movedTo === null ? null : movedAt,
      participantCount: Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0,
    });
  }
  return out;
}

/** Whether a room has a call running on it. */
export function groupCallRunning(row: GroupCallRow | null | undefined): boolean {
  return Boolean(row && row.messageId !== null && row.startedAt !== null);
}

export interface GroupRingPick {
  readonly call: GroupCallRow;
  /** When this reader's ring began. */
  readonly rungAt: number;
}

/** `${channelId}@${rungAt}`: one ring, for remembering a decline until the row says so. */
export function groupRingKey(pick: { call: { channelId: string }; rungAt: number }): string {
  return `${pick.call.channelId}@${pick.rungAt}`;
}

/**
 * The group call ringing this reader, or none.
 *
 * Their own entry in `call_ringing`, younger than the ring's 45 seconds — the
 * same boundary as a private ring's, `>=` being expired — in a room they are
 * not already in, and not one they have just declined. The earliest wins, ties
 * broken by the room, so the surface does not swap under a thumb.
 */
export function pickGroupRing(input: {
  readonly calls: readonly GroupCallRow[];
  readonly selfId: string | null;
  readonly now: number;
  readonly callChannelId: string | null;
  readonly declined?: ReadonlySet<string>;
  readonly ttlSeconds?: number;
}): GroupRingPick | null {
  const { selfId } = input;
  if (!selfId) return null;
  const ttl = Math.max(input.ttlSeconds ?? VOICE_RING_TTL_SECONDS, 0) * 1000;
  let best: GroupRingPick | null = null;
  for (const call of input.calls) {
    if (!groupCallRunning(call) || call.channelId === input.callChannelId) continue;
    const rungAt = call.ringing.get(selfId);
    if (rungAt === undefined || input.now >= rungAt + ttl) continue;
    if (input.declined?.has(groupRingKey({ call, rungAt }))) continue;
    if (
      !best ||
      rungAt < best.rungAt ||
      (rungAt === best.rungAt && call.channelId < best.call.channelId)
    ) {
      best = { call, rungAt };
    }
  }
  return best;
}

/** When the next ring this reader can see runs out, for the store's timer. */
export function groupRingNextExpiry(input: {
  readonly calls: readonly GroupCallRow[];
  readonly selfId: string | null;
  readonly now: number;
  readonly ttlSeconds?: number;
}): number {
  if (!input.selfId) return Number.POSITIVE_INFINITY;
  const ttl = Math.max(input.ttlSeconds ?? VOICE_RING_TTL_SECONDS, 0) * 1000;
  let next = Number.POSITIVE_INFINITY;
  for (const call of input.calls) {
    const rungAt = call.ringing.get(input.selfId);
    if (rungAt === undefined) continue;
    const ends = rungAt + ttl;
    if (ends > input.now) next = Math.min(next, ends);
  }
  return next;
}

/**
 * Where this reader's call has to go, if its room moved.
 *
 * Only a move younger than the window, and only into a room whose call is in
 * this read — the target's chat is needed to join it, and a read that has not
 * reached the new group chat yet will have it on the next one.
 */
export function groupCallMoveTarget(input: {
  readonly callChannelId: string | null;
  readonly calls: readonly GroupCallRow[];
  readonly now: number;
}): { channelId: string; chatId: string } | null {
  if (input.callChannelId === null) return null;
  const here = input.calls.find((row) => row.channelId === input.callChannelId);
  if (!here || here.movedTo === null || here.movedAt === null) return null;
  if (input.now - here.movedAt >= GROUP_CALL_MOVE_WINDOW_MS) return null;
  const target = input.calls.find((row) => row.channelId === here.movedTo);
  if (!target) return null;
  return { channelId: target.channelId, chatId: target.chatId };
}

/** Why a group chat's header offers no call. Each is a different fact. */
export type GroupCallOfferRefusal =
  /** Not a group chat; a private chat has its own control and a server its channels. */
  | "not_group_chat"
  /** This reader is in this call already; the call bar carries it. */
  | "in_this_call"
  /** In a call somewhere else. Pressing would hang that one up without saying so. */
  | "in_a_call";

export type GroupCallOfferVerdict =
  | { readonly offered: true; readonly mode: "start" | "join"; readonly label: string; readonly title: string }
  | { readonly offered: false; readonly reason: GroupCallOfferRefusal };

/**
 * The header's call control in a group chat: «Позвонить» when nothing is
 * running, «Присоединиться» when a call is — Discord's call bar offers a join
 * to whoever is not in a running call — and nothing while this reader is in
 * one.
 */
export function groupCallOffer(input: {
  readonly chatType: string | null | undefined;
  readonly call: GroupCallRow | null | undefined;
  readonly callChannelId: string | null;
}): GroupCallOfferVerdict {
  if (input.chatType !== "dm_group") return { offered: false, reason: "not_group_chat" };
  const running = groupCallRunning(input.call);
  if (input.call && input.callChannelId === input.call.channelId) return { offered: false, reason: "in_this_call" };
  if (input.callChannelId !== null) return { offered: false, reason: "in_a_call" };
  if (running) return { offered: true, mode: "join", label: "Присоединиться", title: "Присоединиться к звонку" };
  return { offered: true, mode: "start", label: "Позвонить", title: "Позвонить всем" };
}

/* ── The record ───────────────────────────────────────────────────────────── */

/** A group call's message, once it has been shown to be one. */
export interface GroupCallRecord {
  readonly caller: string;
  readonly endedAt: number | null;
  readonly durationMs: number | null;
  readonly participants: readonly string[];
}

/**
 * One `system_payload`, read as a group call, or null.
 *
 * Null sends the row to `content`, which the database wrote as a neutral line
 * for exactly that: «Звонок» while it runs, then «Звонок, 3 мин 12 с» or
 * «Звонок без ответа». A private chat's record has no `mode` and is
 * `callRecord.ts`'s.
 */
export function readGroupCallRecord(payload: unknown): GroupCallRecord | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  if (record.kind !== "call" || record.mode !== "group") return null;
  const caller = typeof record.caller === "string" ? record.caller.trim() : "";
  if (caller.length === 0) return null;
  const endedAt = readInstant(record.ended_at);
  const raw = record.duration_ms;
  const durationMs =
    endedAt !== null && typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : null;
  const participants = Array.isArray(record.participants)
    ? record.participants.filter((person): person is string => typeof person === "string" && person.trim().length > 0)
    : [];
  return { caller, endedAt, durationMs, participants };
}

export interface GroupCallRecordView {
  readonly state: "running" | "ended";
  readonly headline: string;
  readonly duration: string | null;
  /** A call that ended without this reader in it. The one red line. */
  readonly missed: boolean;
  /** A call still running that this reader is not in: the chip offers a join. */
  readonly joinable: boolean;
  readonly icon: "phoneIncoming" | "phoneOutgoing";
  readonly spoken: string;
}

/**
 * What one reader sees of a group call's message.
 *
 * Discord's rule, read in its bundle: missed is `!isCallActive &&
 * !participants.includes(me)`, and a running call offers a join. Two things
 * are ours. «Идёт звонок» is only said of a call the room confirms is running
 * (`running`), so a message whose end has not arrived yet does not offer a
 * join into nothing. And the one who called and was the only one there sees
 * «Отменённый звонок», which is what a private chat's record says of a call
 * nobody answered, rather than a length of time spent alone.
 */
export function groupCallRecordView(
  payload: unknown,
  viewerId: string | null | undefined,
  context: { readonly running: boolean; readonly inThisCall: boolean },
): GroupCallRecordView | null {
  const record = readGroupCallRecord(payload);
  if (!record) return null;
  const viewer = typeof viewerId === "string" ? viewerId.trim() : "";
  if (viewer.length === 0) return null;
  const outgoing = record.caller === viewer;
  const icon = outgoing ? "phoneOutgoing" : "phoneIncoming";

  if (record.endedAt === null) {
    if (context.running) {
      const joinable = !context.inThisCall;
      return {
        state: "running",
        headline: "Идёт звонок",
        duration: null,
        missed: false,
        joinable,
        icon,
        spoken: joinable ? "Идёт звонок. Присоединиться" : "Идёт звонок",
      };
    }
    return { state: "running", headline: "Звонок", duration: null, missed: false, joinable: false, icon, spoken: "Звонок" };
  }

  const present = record.participants.includes(viewer);
  if (!present) {
    return { state: "ended", headline: "Пропущенный звонок", duration: null, missed: true, joinable: false, icon, spoken: "Пропущенный звонок" };
  }
  if (outgoing && record.participants.length <= 1) {
    return { state: "ended", headline: "Отменённый звонок", duration: null, missed: false, joinable: false, icon, spoken: "Отменённый звонок" };
  }
  const duration = callDurationShort(record.durationMs);
  const spokenDuration = callDurationSpoken(record.durationMs);
  return {
    state: "ended",
    headline: "Звонок",
    duration,
    missed: false,
    joinable: false,
    icon,
    spoken: spokenDuration ? `Звонок, ${spokenDuration}` : "Звонок",
  };
}

/** The chat list's line for a group call's message, or null for «not one». */
export function groupCallRecordPreview(
  payload: unknown,
  viewerId: string | null | undefined,
  context: { readonly running: boolean; readonly inThisCall: boolean },
): string | null {
  return groupCallRecordView(payload, viewerId, context)?.headline ?? null;
}

/** What a group ring's surface says. The same shape a private ring's has. */
export function groupRingDetail(busy: boolean): string {
  return busy ? "Соединяем…" : "Входящий групповой звонок";
}

/**
 * The band for a group ring, in the shape a private ring's band has, so one
 * surface draws both. Always incoming: a group call's caller is in the room
 * at once and the call bar carries it, as in Discord, rather than waiting on
 * «Звоним…» for one answer among several.
 */
export function groupRingView(input: {
  readonly pick: GroupRingPick | null;
  /** The group chat's name, as the reader's own list draws it. */
  readonly who: string | null;
  readonly busy: boolean;
}): VoiceRingView {
  const none = voiceRingView({ pick: null, who: null, busy: false });
  if (!input.pick) return none;
  return {
    ...none,
    visible: true,
    direction: "incoming",
    channelId: input.pick.call.channelId,
    chatId: input.pick.call.chatId,
    who: (input.who ?? "").trim() || "Групповой чат",
    detail: groupRingDetail(input.busy),
    answer: true,
    decline: true,
    cancel: false,
    busy: input.busy,
    tone: "live",
  };
}

/** Why a group call did not start, as one line. The names the functions raise. */
export function groupCallRefusalText(error: unknown): string {
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message: unknown }).message).toLocaleLowerCase("ru-RU")
      : typeof error === "string"
        ? error.toLocaleLowerCase("ru-RU")
        : "";
  if (message.includes("not_a_member")) return "Вы больше не участник этого чата.";
  if (message.includes("not_a_group_chat")) return "Звонок для всех — только в групповом чате.";
  if (message.includes("no_such_chat") || message.includes("no_such_room")) return "Этого группового чата больше нет.";
  if (message.includes("not_authenticated")) return "Войдите в аккаунт, чтобы звонить.";
  if (message.includes("fetch") || message.includes("network") || message.includes("load failed")) {
    return "Нет связи с сервером, проверьте подключение.";
  }
  return "Не удалось позвонить.";
}
