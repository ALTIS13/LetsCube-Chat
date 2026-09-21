/**
 * A one-to-one call before it is a call: the ring.
 *
 * Slice A of `docs/proposals/2026-09-18-one-to-one-calls.md`, client half. The
 * database half is `supabase/migrations/20260918220000_a_private_chat_can_ring.sql`
 * and `…230000_a_ring_cannot_be_forged.sql`, both applied and verified on
 * production; this file is the mirror of the first one's `voice_ring_state`
 * plus every word the two surfaces say.
 *
 * This module imports nothing on purpose. The lesson is in CLAUDE.md and again
 * at the head of `lib/voiceChannel.ts` and `lib/micGate.ts`: a decision inside a
 * `"use client"` module is a decision with no test, and moving the decision is
 * cheaper than building a harness around it. `tests/unit/voice-ring.test.mts`
 * holds everything here.
 *
 * ## The boundary has to agree with the database's, and it is `>=`
 *
 * `voice_ring_state` reads
 *
 *     when p_now >= p_started_at + make_interval(secs => greatest(p_ttl_seconds, 0))
 *       then 'expired'
 *
 * so a ring exactly 45 seconds old is **expired**, not ringing. Verified on
 * production at both sides of the edge: 44s answers `ringing`, 45s answers
 * `expired`. `>` here instead of `>=` would put one second of disagreement
 * between the client and the function that refuses `voice_call_answer` — the
 * interface would offer «Ответить» on a ring the database has already stopped
 * accepting, and the press would come back `not_ringing`.
 *
 * The order of the branches is the function's, not a tidier one: `answered`
 * wins over `expired`. A call answered at the 44th second is a call, and it
 * stays a call for as long as it runs; the TTL bounds the **ring**, never the
 * conversation after it.
 *
 * `greatest(ttl, 0)` is mirrored too. A negative TTL means «expire at once»
 * rather than «expire in the past», and the two differ for a ring whose
 * `startedAt` is in the future — which a clock skewed between two devices
 * really can produce.
 *
 * ## What this file does not decide
 *
 * The record in the conversation — answered, missed, how long — is slice B and
 * needs a column on `messages` that does not exist. `voice_call_stop` takes a
 * reason and discards it today; `VoiceRingStopReason` below is that vocabulary,
 * spelled here so a shell cannot send a word the function refuses with
 * `bad_reason`.
 */

/**
 * How long a ring rings, in seconds. The owner's answer on 2026-09-18, and
 * Telegram's number.
 *
 * The same default the database function carries. It is written here as well
 * rather than read from anywhere, because the two have to be compared: a client
 * that silently followed the server's default could not notice the day they
 * stopped agreeing, and the test asserts this number against the boundary the
 * migration's own self-check proves.
 */
export const VOICE_RING_TTL_SECONDS = 45;

/** What a ring is doing. The four words `voice_ring_state` answers. */
export type VoiceRingState = "idle" | "ringing" | "answered" | "expired";

/**
 * `voice_ring_state`, in TypeScript.
 *
 * Milliseconds rather than dates, and `now` passed in rather than read: the
 * same shape the SQL takes for the same reason — the rule is then something a
 * test can walk across a boundary without owning a clock.
 */
export function voiceRingState(input: {
  /** When the ring started, in epoch milliseconds. Null means nobody is calling. */
  readonly startedAt: number | null;
  /** When the other side accepted, in epoch milliseconds. */
  readonly answeredAt: number | null;
  readonly now: number;
  readonly ttlSeconds?: number;
}): VoiceRingState {
  const { startedAt, answeredAt, now } = input;
  if (startedAt === null) return "idle";
  if (answeredAt !== null) return "answered";
  const ttl = Math.max(input.ttlSeconds ?? VOICE_RING_TTL_SECONDS, 0);
  return now >= startedAt + ttl * 1000 ? "expired" : "ringing";
}

/** Why a ring stopped. Exactly the four words `voice_call_stop` accepts. */
export type VoiceRingStopReason = "cancelled" | "declined" | "answered" | "missed";

/**
 * One room with a ring on it, as the chat list's own read returns it.
 *
 * `participantCount` travels with it because the same read answers both
 * questions, and because the one place it is load-bearing is the refusal
 * `voice_call_ring` raises for an occupied room — an interface that offered
 * «Позвонить» into a room with somebody in it would be asking for
 * `already_in_call`.
 */
export interface VoiceRingRow {
  readonly channelId: string;
  readonly chatId: string;
  /** The room's name, which for a private chat's room is «Звонок». */
  readonly name: string;
  /** Who is calling. Never null: the row's own CHECK ties it to `startedAt`. */
  readonly caller: string;
  readonly startedAt: number;
  readonly answeredAt: number | null;
  readonly participantCount: number;
}

/** A timestamp as PostgREST sends one, or nothing at all. */
function readInstant(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : null;
}

/**
 * The rings, read defensively out of whatever the table read returned.
 *
 * A row without both halves is dropped rather than repaired. The database's own
 * `voice_channels_ring_shape_check` makes `(ring_started_at is null) =
 * (ring_caller is null)` an invariant, so a half-filled row here means the read
 * was not the read this thinks it was — a projection missing a column, or a
 * deployment whose migration has not landed — and inventing a caller for it
 * would put a nameless incoming call on somebody's screen.
 *
 * Archived rooms are dropped for the reason `readVoicePresenceRows` drops them:
 * removing a room sets the flag rather than deleting the row, and a ring on a
 * room nobody can join is not a call.
 */
export function readVoiceRingRows(rows: unknown): VoiceRingRow[] {
  if (!Array.isArray(rows)) return [];
  const out: VoiceRingRow[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const channelId = typeof record.id === "string" ? record.id : null;
    const chatId = typeof record.chat_id === "string" ? record.chat_id : null;
    const caller = typeof record.ring_caller === "string" ? record.ring_caller : null;
    const startedAt = readInstant(record.ring_started_at);
    if (channelId === null || chatId === null || caller === null || startedAt === null) continue;
    if (record.archived === true) continue;
    const count = typeof record.participant_count === "number" ? record.participant_count : 0;
    out.push({
      channelId,
      chatId,
      name: (typeof record.name === "string" ? record.name : "").trim() || "Звонок",
      caller,
      startedAt,
      answeredAt: readInstant(record.ring_answered_at),
      participantCount: Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0,
    });
  }
  return out;
}

/** Which end of the ring this client is. */
export type VoiceRingDirection = "incoming" | "outgoing";

export interface VoiceRingPick {
  readonly ring: VoiceRingRow;
  readonly direction: VoiceRingDirection;
}

/**
 * The one ring this client should be doing something about, or none.
 *
 * **Only `ringing`.** An `answered` ring is a call that is running: the caller
 * was already in the room and the answerer joins on the strength of its own
 * write, so both surfaces stand down and `VoiceCallBar` carries the call from
 * there. An `expired` one is over, and §4a's second trap is exactly this — a
 * laptop woken ten minutes late receives the row on resubscribe and must not
 * ring at a call that is long finished. The expiry is evaluated on arrival
 * rather than trusted, which is what passing `now` in here buys.
 *
 * **The earliest wins, and ties break on the room's id.** Two people calling at
 * once is rare and a list that reorders itself between two evaluations of the
 * same facts is worse than rare — it is a surface that changes which button is
 * under the thumb. Incoming is not preferred over outgoing: a person who is
 * calling somebody is not available to answer anybody, and telling them about
 * the call they started is the more useful of the two.
 */
export function pickVoiceRing(input: {
  readonly rings: readonly VoiceRingRow[];
  /** Null before the account is known; nothing is drawn then. */
  readonly selfId: string | null;
  readonly now: number;
  readonly ttlSeconds?: number;
}): VoiceRingPick | null {
  const { selfId } = input;
  if (!selfId) return null;
  let best: VoiceRingRow | null = null;
  for (const ring of input.rings) {
    const state = voiceRingState({
      startedAt: ring.startedAt,
      answeredAt: ring.answeredAt,
      now: input.now,
      ttlSeconds: input.ttlSeconds,
    });
    if (state !== "ringing") continue;
    if (
      !best ||
      ring.startedAt < best.startedAt ||
      (ring.startedAt === best.startedAt && ring.channelId < best.channelId)
    ) {
      best = ring;
    }
  }
  if (!best) return null;
  return { ring: best, direction: best.caller === selfId ? "outgoing" : "incoming" };
}

/**
 * Whether one particular room is still waiting to be answered.
 *
 * Asked by `VoiceCallBar`, which has to stand down while a call it is
 * technically connected to is still ringing at the other end, and by the header
 * control, which must not offer a second «Позвонить» into a chat that is already
 * ringing. Not the same question as `pickVoiceRing`: that one asks «what should
 * this person be looking at», this one asks about a room somebody names.
 */
export function voiceRingIsWaiting(input: {
  readonly rings: readonly VoiceRingRow[];
  readonly channelId: string | null;
  readonly now: number;
  readonly ttlSeconds?: number;
}): boolean {
  if (input.channelId === null) return false;
  return input.rings.some(
    (ring) =>
      ring.channelId === input.channelId &&
      voiceRingState({
        startedAt: ring.startedAt,
        answeredAt: ring.answeredAt,
        now: input.now,
        ttlSeconds: input.ttlSeconds,
      }) === "ringing",
  );
}

/** What the incoming and outgoing surfaces draw. One shape, because it is one surface. */
export interface VoiceRingView {
  readonly visible: boolean;
  readonly direction: VoiceRingDirection | null;
  readonly channelId: string | null;
  readonly chatId: string | null;
  /** The person on the other end, as the reader's own chat list names them. */
  readonly who: string;
  /** One line under the name. Never a number, never a code. */
  readonly detail: string;
  readonly answer: boolean;
  readonly decline: boolean;
  readonly cancel: boolean;
  readonly answerLabel: string;
  readonly declineLabel: string;
  readonly cancelLabel: string;
  /** Something is in flight; the controls are drawn and refuse a second press. */
  readonly busy: boolean;
  readonly tone: "live" | "neutral";
}

const NO_RING: VoiceRingView = {
  visible: false,
  direction: null,
  channelId: null,
  chatId: null,
  who: "",
  detail: "",
  answer: false,
  decline: false,
  cancel: false,
  answerLabel: "Ответить",
  declineLabel: "Отклонить",
  cancelLabel: "Отменить",
  busy: false,
  tone: "neutral",
};

/**
 * What the surface says, for every state it can be in.
 *
 * The words are Telegram's, which is the mechanic this follows: a name, one
 * line saying which way the call is going, and two buttons for a call coming in
 * or one for a call going out. No duration and no countdown — Telegram shows
 * neither while it rings, and a number ticking down on an incoming call reads
 * as a deadline rather than as a telephone.
 *
 * `who` falls back to «Собеседник» rather than to an empty line for the reason
 * `resolveVoiceParticipants` falls back to «Участник»: a blank name reads as a
 * defect where a placeholder reads as somebody whose name has not arrived. It
 * happens for the moment between a chat appearing in the list and its profile
 * arriving, which is exactly when a first call can land.
 *
 * `busy` covers the press and its round trip. The controls stay **drawn** and
 * refuse rather than disappearing, for the reason `VoiceCallCapsule` states
 * about a silenced microphone: a control that vanishes reads as a feature that
 * went away.
 */
export function voiceRingView(input: {
  readonly pick: VoiceRingPick | null;
  /** The other person's name, from the list the reader already has. */
  readonly who: string | null;
  /** True while an answer, a decline or a cancel is in flight. */
  readonly busy: boolean;
}): VoiceRingView {
  const { pick } = input;
  if (!pick) return NO_RING;
  const who = (input.who ?? "").trim() || "Собеседник";
  const incoming = pick.direction === "incoming";
  return {
    ...NO_RING,
    visible: true,
    direction: pick.direction,
    channelId: pick.ring.channelId,
    chatId: pick.ring.chatId,
    who,
    detail: input.busy
      ? incoming
        ? "Соединяем…"
        : "Отменяем…"
      : incoming
        ? "Входящий звонок"
        : "Звоним…",
    answer: incoming,
    decline: incoming,
    cancel: !incoming,
    busy: input.busy,
    tone: incoming ? "live" : "neutral",
  };
}

/**
 * Whether this client's own call has to end because its ring is gone.
 *
 * This is the whole of «one row, every device», and it is also how a hang-up
 * reaches the other side. The protocol the two surfaces run on is three states
 * of one row and nothing else:
 *
 *  - `ringing` — the caller is in the room, waiting;
 *  - `answered` — both are in it, and `VoiceCallBar` carries the call;
 *  - **gone** — the call is over, for whatever reason. Declined, cancelled from
 *    another device, or hung up by whoever left first.
 *
 * So a caller cannot mistake a decline for an answer: an answer sets a second
 * timestamp, and everything else clears the row. Without that distinction the
 * caller would sit in an empty room after a decline with nothing saying so.
 *
 * **`oneToOne` is not decoration and removing it hangs up every group call.** A
 * group's room has no ring row and never will, so «no ring for the room I am
 * in» is the ordinary state of every voice channel in the product. Only a call
 * this client entered *through* a ring is governed by one.
 */
export function voiceRingEndedTheCall(input: {
  /** The room this client's call is in, or null when there is no call. */
  readonly callChannelId: string | null;
  /** The room this client entered through a ring, or null. */
  readonly oneToOneChannelId: string | null;
  /** Every live ring this client can see. */
  readonly rings: readonly VoiceRingRow[];
}): boolean {
  const { callChannelId, oneToOneChannelId } = input;
  if (callChannelId === null || oneToOneChannelId === null) return false;
  if (callChannelId !== oneToOneChannelId) return false;
  return !input.rings.some((ring) => ring.channelId === callChannelId);
}

/** Why no «Позвонить» is offered here. Each is a different fact, not a shade of one. */
export type VoiceCallOfferRefusal =
  /** A group or a channel. One-to-one calls are private chats only. */
  | "not_private"
  /** «Избранное» — a private chat with yourself. */
  | "saved"
  /** Nobody on the other end: a bot chat, or a chat whose member list has not arrived. */
  | "no_person"
  /** This reader blocked them. The other direction is the database's to refuse. */
  | "blocked"
  /** A call is already running, here or somewhere else. */
  | "in_a_call"
  /** This conversation is already ringing — from another of this person's devices. */
  | "ringing";

export type VoiceCallOfferVerdict =
  | { readonly offered: true; readonly label: string; readonly title: string }
  | { readonly offered: false; readonly reason: VoiceCallOfferRefusal };

/**
 * Whether the conversation offers a call at all.
 *
 * **Offered to both participants**, which is the point of the whole slice: in a
 * private chat one of the two holds `owner` and the other `member`, and the
 * INSERT policy on `voice_channels` is `is_chat_admin`, so until
 * `voice_private_room` existed exactly one of the two people in every private
 * conversation could create the room a call needs. Nothing here asks about a
 * role, deliberately — a role test would put the asymmetry back in the
 * interface after the database had just been taught to close it.
 *
 * `blocked` is only the half this client can see. `usePersonalBlocks` holds who
 * **I** blocked; whether they blocked me is `blocked_from_chat`'s to answer, and
 * it does, inside `voice_private_room`. So the control is hidden for the
 * direction the interface knows and refused with a sentence for the one it does
 * not — which is the honest split rather than a guess.
 *
 * `in_a_call` is refused rather than offered-and-refused. `voice_call_ring`
 * would allow a ring in a *different* chat while this client is in a call, and
 * joining the new room is what ends the old one (section 3.6's duplicate
 * identity) — so the offer would be a control that hangs up a conversation
 * without saying it was going to. `voiceCapsuleState` already declines the same
 * press with «Вы в другом голосовом чате».
 */
export function voiceCallOffer(input: {
  readonly chatType: string | null | undefined;
  readonly isSaved: boolean;
  /** The other participant of a private chat, from the chat row. */
  readonly otherUserId: string | null | undefined;
  readonly selfId: string | null | undefined;
  /** Whether this reader has blocked that person. */
  readonly iBlockedThem: boolean;
  /** The room this client's call is in, or null. */
  readonly callChannelId: string | null;
  /**
   * Whether this conversation is ringing already.
   *
   * Not the same state as `in_a_call` and it is reachable: a person's phone is
   * ringing at an incoming call and they open the same chat on their computer,
   * where they are in no call at all. The press would come back
   * `already_ringing`, and a control that is only ever refused is a control
   * that should not have been drawn.
   */
  readonly ringingHere: boolean;
}): VoiceCallOfferVerdict {
  if (input.chatType !== "private") return { offered: false, reason: "not_private" };
  if (input.isSaved) return { offered: false, reason: "saved" };
  const other = input.otherUserId ?? null;
  if (!other || !input.selfId || other === input.selfId) {
    return { offered: false, reason: "no_person" };
  }
  if (input.iBlockedThem) return { offered: false, reason: "blocked" };
  if (input.callChannelId !== null) return { offered: false, reason: "in_a_call" };
  if (input.ringingHere) return { offered: false, reason: "ringing" };
  return { offered: true, label: "Позвонить", title: "Позвонить" };
}

/**
 * Why a ring, an answer or a stop did not happen.
 *
 * The names are the ones the four functions raise, so a refusal that arrives
 * unrecognised is a function that changed its vocabulary rather than a shrug.
 */
export type VoiceRingRefusal =
  | "already_ringing"
  | "already_in_call"
  | "not_a_private_chat"
  | "not_a_member"
  | "blocked"
  | "no_such_chat"
  | "no_such_room"
  | "not_ringing"
  | "caller_cannot_answer"
  | "bad_reason"
  | "not_authenticated"
  | "unsupported"
  | "network"
  | "unknown";

const RAISED: readonly VoiceRingRefusal[] = [
  "already_ringing",
  "already_in_call",
  "not_a_private_chat",
  "not_a_member",
  "blocked",
  "no_such_chat",
  "no_such_room",
  "not_ringing",
  "caller_cannot_answer",
  "bad_reason",
  "not_authenticated",
];

function errorFields(error: unknown): { code: string; message: string } {
  if (typeof error === "string") return { code: "", message: error.toLocaleLowerCase("ru-RU") };
  if (!error || typeof error !== "object") return { code: "", message: "" };
  const record = error as Record<string, unknown>;
  return {
    code: typeof record.code === "string" ? record.code : "",
    message: typeof record.message === "string" ? record.message.toLocaleLowerCase("ru-RU") : "",
  };
}

/**
 * One PostgREST answer, read as a reason.
 *
 * **The message carries the name, not the code.** `raise exception 'blocked'
 * using errcode = '42501'` reaches the client as `{code: "42501", message:
 * "blocked"}`, and three of the four functions raise more than one thing under
 * the same SQLSTATE — `already_ringing` and `already_in_call` are both `55006`,
 * `not_a_member` and `blocked` are both `42501`. So the code alone cannot tell
 * «this person blocked you» from «you are not in this chat», and the two are
 * very different sentences. The code is the fallback, not the evidence.
 *
 * The three table-absent codes are `classifyVoiceChannelWriteError`'s, and mean
 * the same thing here: a deployment whose migration has not landed. supabase-js
 * reports a fetch that reached nothing as an error with no code at all, which is
 * why the message is the only evidence for `network`.
 */
export function classifyVoiceRingError(error: unknown): VoiceRingRefusal {
  const { code, message } = errorFields(error);
  for (const name of RAISED) {
    if (message.includes(name)) return name;
  }
  if (code === "42P01" || code === "PGRST202" || code === "PGRST205") return "unsupported";
  if (code === "PGRST301" || code === "42501") return "not_a_member";
  if (code === "55006") return "already_ringing";
  if (code === "" && (message.includes("fetch") || message.includes("network") || message.includes("load failed"))) {
    return "network";
  }
  return "unknown";
}

/**
 * What a refusal means to a person.
 *
 * One line, in the voice `microphoneRefusalText` and
 * `voiceChannelStartRefusalText` already speak in: no code, nothing about rows
 * or policies, and nothing the reader cannot act on.
 *
 * `not_ringing` is the one worth reading twice, because it is the ordinary
 * outcome of §4a rather than an error: two of somebody's devices ring, one
 * answers, and the other's press arrives a moment late. «Уже ответили на другом
 * устройстве» is what Telegram shows, and it is what actually happened — the
 * alternative, «звонок завершён», would be wrong exactly when the call is still
 * running in the person's other hand.
 */
export function voiceRingRefusalText(code: VoiceRingRefusal | "channel_full"): string {
  switch (code) {
    case "already_ringing":
      return "Звонок уже идёт.";
    case "already_in_call":
      return "В этом чате уже разговаривают.";
    case "channel_full":
      return "Разговор уже идёт.";
    case "not_a_private_chat":
      return "Звонки доступны только в личных чатах.";
    case "not_a_member":
      return "Вы больше не участник этого чата.";
    case "blocked":
      return "Этот человек недоступен для звонка.";
    case "no_such_chat":
    case "no_such_room":
      return "Звонок уже завершён.";
    case "not_ringing":
      return "Уже ответили на другом устройстве.";
    case "caller_cannot_answer":
      return "Это ваш собственный звонок.";
    case "bad_reason":
      return "Не удалось завершить звонок.";
    case "not_authenticated":
      return "Войдите в аккаунт, чтобы звонить.";
    case "unsupported":
      return "Звонки здесь пока недоступны.";
    case "network":
      return "Нет связи с сервером, проверьте подключение.";
    default:
      return "Не удалось позвонить.";
  }
}

/**
 * Resolve a failed join in the context of a one-to-one ring.
 *
 * Only the gateway's room-capacity reason changes meaning here. Group voice
 * keeps its gateway wording; every other private-call failure keeps the
 * already-rendered fallback from the call store.
 */
export function voiceRingJoinRefusalText(call: {
  refusalCode: string | null;
  refusal: string | null;
}): string {
  if (call.refusalCode === "channel_full") return voiceRingRefusalText("channel_full");
  return call.refusal ?? voiceRingRefusalText("unknown");
}
