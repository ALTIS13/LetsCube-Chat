"use client";

import { useMemo, useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  classifyVoiceRingError,
  pickVoiceRing,
  voiceRingEndedTheCall,
  voiceRingJoinRefusalText,
  voiceRingRefusalText,
  voiceRingState,
  type VoiceRingPick,
  type VoiceRingRow,
  type VoiceRingStopReason,
} from "@/lib/voiceRing";
import { joinVoiceChannel, leaveVoiceCall, voiceAuthGenerationSnapshot, voiceAuthOwnsViewer, voiceCallSnapshot } from "@/hooks/useVoiceCall";

/**
 * The ring, and the one place it lives.
 *
 * Slice A of `docs/proposals/2026-09-18-one-to-one-calls.md`. Every rule here is
 * `lib/voiceRing.ts`'s, where `node --test` can load it; what is in this file is
 * the wiring — module state that outlives a component, the clock, and the four
 * `SECURITY DEFINER` functions the client is allowed to call.
 *
 * ## Module state, for the reason `useVoiceCall` is
 *
 * A ring has to survive a re-render and has to survive the person opening
 * another conversation, which unmounts everything inside `ChatWindow`. It also
 * has to be readable from three places at once — the surface that draws it, the
 * header control that refuses to offer a second call, and the bar that stands
 * down while it rings. So it is module state read through
 * `useSyncExternalStore`, exactly as the call itself is.
 *
 * ## The rows come from the reader that already exists
 *
 * Nothing here opens a subscription. `useVoicePresenceReader` holds the one
 * unfiltered `voice_channels` channel the whole design rests on — RLS decides
 * the audience, every signed-in client has its own, and §4a's «ring every
 * device, stop the others» falls out of that for free — and it hands its rows
 * to `publishVoiceRings`. A second subscription would buy nothing and cost a
 * channel per shell.
 *
 * ## The clock
 *
 * A ring ends by itself after 45 seconds, and nothing on the server runs to
 * notice (slice C). So the store keeps a timer at the next ring's expiry,
 * re-evaluates the rule, and — on the **caller's** device only — writes
 * `voice_call_stop(id, 'missed')` and leaves the room it was waiting in. A
 * caller who closes their laptop mid-ring leaves a ring nothing clears; that is
 * the named gap this slice does not close, and an uncleared expired ring blocks
 * nothing, because `voice_call_ring` refuses only `ringing` and `answered`.
 */

type PostgrestFailure = { code?: unknown; message?: unknown } | null;
interface LooseClient {
  rpc<T>(name: string, args: Record<string, unknown>): PromiseLike<{ data: T | null; error: PostgrestFailure }>;
}

function looseClient(): LooseClient {
  return createClient() as unknown as LooseClient;
}

/** Everything the last read returned, before the clock has an opinion about it. */
let raw: readonly VoiceRingRow[] = [];
/**
 * The caller's own ring, held until a read taken after it either confirms or
 * refutes it.
 *
 * `voice_call_ring` answers with the room and the moment, so the device that
 * pressed already knows the ring exists — and waiting for the round trip
 * through Realtime and a re-read before drawing anything would leave a person
 * looking at a screen that did nothing for a third of a second after they
 * pressed «Позвонить».
 *
 * It is not optimism about a write that might fail: the write has already
 * succeeded when this is seeded. It is only earlier knowledge of it, and
 * `seededAt` is what retires it — a read **issued after** the seed and coming
 * back without the row means the ring is genuinely gone, which is what happens
 * when the other side declines within the same second.
 */
let seed: { row: VoiceRingRow; seededAt: number } | null = null;
/** The pruned answer components read. Replaced only when it really changed. */
let held: readonly VoiceRingRow[] = [];
const listeners = new Set<() => void>();
let expiryTimer: ReturnType<typeof setTimeout> | null = null;
/** Who is reading. Set by the reader; the store needs it to know whose ring expired. */
let viewerId: string | null = null;
/** `channelId@startedAt` of every ring this client has already acted on the expiry of. */
const expiryHandled = new Set<string>();
/**
 * The room this client entered **through a ring**, and the reason it is here.
 *
 * A group's room has no ring row and never will, so «the room I am in has no
 * ring» is the ordinary state of every voice channel in the product. Without
 * this, the rule that ends a one-to-one call when its row clears would hang up
 * every group call in the application on the first read.
 */
let oneToOneChannelId: string | null = null;
/**
 * A ring this client has just accepted, by room, until the row itself says so.
 *
 * `voice_call_answer` returns the moment it wrote, and the row then reaches
 * this device the ordinary way — a Realtime event and a re-read. Waiting for
 * that round trip would leave the person who pressed «Ответить» looking at an
 * incoming-call card while they are already joining the call, and it would keep
 * `VoiceCallBar` standing down at the same time, so for one round trip there
 * would be nothing on screen about a call this client is in.
 *
 * Applied on top of the read rather than written into it, so that a read
 * **issued before** the answer and arriving after it cannot put the card back.
 * The entry retires as soon as the server's own row carries an `answeredAt`, or
 * the row is gone. The same shape as `seed` above, and for the same reason.
 */
const answeredLocally = new Map<string, number>();

function same(a: readonly VoiceRingRow[], b: readonly VoiceRingRow[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (
      left.channelId !== right.channelId ||
      left.chatId !== right.chatId ||
      left.name !== right.name ||
      left.caller !== right.caller ||
      left.startedAt !== right.startedAt ||
      left.answeredAt !== right.answeredAt ||
      left.participantCount !== right.participantCount
    ) {
      return false;
    }
  }
  return true;
}

/**
 * A ring that ran out, on the device that started it.
 *
 * Guarded by `expiryHandled` because `recompute` runs on every read and every
 * timer tick: without it, a ring the server has not cleared yet would be
 * stopped once per event for as long as it stayed in the table.
 */
function expired(ring: VoiceRingRow): void {
  const key = `${ring.channelId}@${ring.startedAt}`;
  if (expiryHandled.has(key)) return;
  expiryHandled.add(key);
  if (ring.caller !== viewerId || !voiceAuthOwnsViewer(viewerId)) return;
  void stopRing(ring.channelId, "missed");
  if (voiceCallSnapshot().channelId === ring.channelId) void leaveVoiceCall();
}

function recompute(): void {
  const now = Date.now();
  const seen = [...raw];
  if (seed && !seen.some((ring) => ring.channelId === seed?.row.channelId)) seen.push(seed.row);
  const merged = seen.map((ring) => {
    const at = answeredLocally.get(ring.channelId);
    return at !== undefined && ring.answeredAt === null ? { ...ring, answeredAt: at } : ring;
  });

  const live: VoiceRingRow[] = [];
  let nextExpiry = Number.POSITIVE_INFINITY;
  for (const ring of merged) {
    const state = voiceRingState({ startedAt: ring.startedAt, answeredAt: ring.answeredAt, now });
    if (state === "expired") {
      expired(ring);
      continue;
    }
    if (state === "ringing") nextExpiry = Math.min(nextExpiry, ring.startedAt + 45_000);
    live.push(ring);
  }
  live.sort((a, b) => a.channelId.localeCompare(b.channelId));

  if (expiryTimer !== null) {
    clearTimeout(expiryTimer);
    expiryTimer = null;
  }
  if (Number.isFinite(nextExpiry) && typeof setTimeout === "function") {
    // `+ 1` so the timer fires strictly past the boundary rather than on it,
    // which is the side `voice_ring_state` calls `expired` — see the note about
    // `>=` at the head of `lib/voiceRing.ts`.
    expiryTimer = setTimeout(recompute, Math.max(0, nextExpiry - now) + 1);
  }

  /**
   * A call whose ring is gone is a call that is over.
   *
   * This is the whole of «one row, every device»: a decline, a cancel from the
   * person's other phone and a hang-up all clear the row, and every client that
   * can see it leaves. It is also the only thing that tells a caller their call
   * was declined rather than answered — an answer sets a second timestamp and
   * everything else clears the row, so the two cannot be confused.
   */
  if (
    voiceRingEndedTheCall({
      callChannelId: voiceCallSnapshot().channelId,
      oneToOneChannelId,
      rings: live,
    })
  ) {
    oneToOneChannelId = null;
    void leaveVoiceCall();
  }

  if (same(held, live)) return;
  held = live;
  for (const listener of listeners) listener();
}

/**
 * The rows the chat-list reader just saw.
 *
 * `readStartedAt` is when its query went out, not when it came back. A read
 * issued **before** the ring was seeded cannot refute the seed — it simply
 * predates it — and treating it as evidence would make the caller's own surface
 * flicker off and back on for one round trip.
 */
export function publishVoiceRings(rows: readonly VoiceRingRow[], readStartedAt: number): void {
  raw = rows;
  if (seed && seed.seededAt < readStartedAt && !rows.some((ring) => ring.channelId === seed?.row.channelId)) {
    seed = null;
  }
  if (seed && rows.some((ring) => ring.channelId === seed?.row.channelId)) seed = null;
  for (const channelId of [...answeredLocally.keys()]) {
    const row = rows.find((ring) => ring.channelId === channelId);
    if (!row || row.answeredAt !== null) answeredLocally.delete(channelId);
  }
  recompute();
}

/** Who is reading, so the store knows whose ring ran out. */
export function setVoiceRingViewer(userId: string | null): void {
  if (viewerId === userId) return;
  viewerId = userId;
  recompute();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const snapshot = () => held;

/** Every live ring this client can see. The same array for every reader. */
export function useVoiceRings(): readonly VoiceRingRow[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/**
 * The one ring to do something about, for this reader, right now.
 *
 * `useMemo` over the held array rather than a second store, and the clock is
 * safe to read inside it for one reason: the array's identity changes exactly
 * when the answer can change. A ring arriving replaces it, a ring being cleared
 * replaces it, and a ring **running out** replaces it too, because the store's
 * own timer re-prunes at the boundary. There is no moment where the answer is
 * stale and nothing has notified.
 */
export function useVoiceRingPick(selfId: string | null): VoiceRingPick | null {
  const rings = useVoiceRings();
  return useMemo(() => pickVoiceRing({ rings, selfId, now: Date.now() }), [rings, selfId]);
}

/** Read once, outside React, for a probe or a decision that is not a render. */
export function voiceRingsSnapshot(): readonly VoiceRingRow[] {
  return held;
}

export type VoiceRingOutcome = { ok: true } | { ok: false; refusal: string };

function refuse(error: unknown): VoiceRingOutcome {
  return { ok: false, refusal: voiceRingRefusalText(classifyVoiceRingError(error)) };
}

function authChanged(): VoiceRingOutcome {
  return { ok: false, refusal: voiceRingRefusalText("not_authenticated") };
}

/** `voice_call_stop`, which is idempotent: stopping an idle room is not an error. */
async function stopRing(channelId: string, reason: VoiceRingStopReason): Promise<VoiceRingOutcome> {
  const auth = voiceAuthGenerationSnapshot();
  if (!voiceAuthOwnsViewer(viewerId)) return authChanged();
  const { error } = await looseClient().rpc<unknown>("voice_call_stop", {
    p_channel_id: channelId,
    p_reason: reason,
  });
  if (auth !== voiceAuthGenerationSnapshot()) return authChanged();
  if (error) return refuse(error);
  if (seed?.row.channelId === channelId) seed = null;
  answeredLocally.delete(channelId);
  raw = raw.filter((ring) => ring.channelId !== channelId);
  recompute();
  return { ok: true };
}

/**
 * Start calling.
 *
 * The order is the proposal's: ring first, then join. Ringing is what the other
 * side's devices see, and the caller joins the room straight away so that the
 * moment somebody answers there is already a connection waiting for them rather
 * than a microphone prompt and a token request.
 *
 * `channelName` is the **person**, not the room. A private chat's room is called
 * «Звонок» in the database, and `VoiceCallBar` prints the room's name as the
 * thing somebody is looking for — «Звонок · Вы в разговоре» names nothing,
 * where «Анна Смирнова · Вы в разговоре» is the fact. The chat's own name is
 * null for a private conversation, so the bar's second line stays empty and
 * this is the only place the name can come from.
 */
export async function startVoiceRing(input: {
  chatId: string;
  /** The other person, as this reader's own list names them. */
  who: string;
}): Promise<VoiceRingOutcome> {
  const auth = voiceAuthGenerationSnapshot();
  const caller = viewerId;
  if (!voiceAuthOwnsViewer(caller)) return authChanged();
  const { data, error } = await looseClient().rpc<unknown>("voice_call_ring", {
    p_chat_id: input.chatId,
  });
  if (auth !== voiceAuthGenerationSnapshot()) return authChanged();
  if (error) return refuse(error);
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  const channelId = typeof row?.channel_id === "string" ? row.channel_id : null;
  const startedAt = typeof row?.ring_started_at === "string" ? Date.parse(row.ring_started_at) : NaN;
  if (!channelId || !caller || !Number.isFinite(startedAt)) {
    return { ok: false, refusal: voiceRingRefusalText("unknown") };
  }

  seed = {
    row: {
      channelId,
      chatId: input.chatId,
      name: input.who,
      caller,
      startedAt,
      answeredAt: null,
      participantCount: 0,
    },
    seededAt: Date.now(),
  };
  oneToOneChannelId = channelId;
  recompute();

  await joinVoiceChannel({ channelId, chatId: input.chatId, channelName: input.who });
  if (auth !== voiceAuthGenerationSnapshot()) return authChanged();
  const call = voiceCallSnapshot();
  if (call.phase === "failed" && call.channelId === channelId) {
    // The microphone was refused, or the gateway was. The ring has to go with
    // it: a caller who cannot hear anything must not leave the other person's
    // devices ringing at a call nobody could take.
    oneToOneChannelId = null;
    await stopRing(channelId, "cancelled");
    return { ok: false, refusal: voiceRingJoinRefusalText(call) };
  }
  return { ok: true };
}

/**
 * Answer.
 *
 * Two of somebody's devices can press within the same second; the second one's
 * call comes back `not_ringing`, because `voice_call_answer` refuses anything
 * that is not still ringing. That is §4a's first trap and it is handled here by
 * doing nothing further — the row now says `answered`, every device's surface
 * stands down on the next read, and the sentence the loser shows says the call
 * was taken elsewhere rather than that something went wrong.
 */
export async function answerVoiceRing(ring: VoiceRingRow, who: string): Promise<VoiceRingOutcome> {
  const auth = voiceAuthGenerationSnapshot();
  if (!voiceAuthOwnsViewer(viewerId)) return authChanged();
  const { error } = await looseClient().rpc<unknown>("voice_call_answer", {
    p_channel_id: ring.channelId,
  });
  if (auth !== voiceAuthGenerationSnapshot()) return authChanged();
  if (error) return refuse(error);
  oneToOneChannelId = ring.channelId;
  // The row now says `answered`; this device knows it a round trip before the
  // row gets here, and the incoming card has to stand down on the press rather
  // than on the echo of it.
  answeredLocally.set(ring.channelId, Date.now());
  recompute();
  await joinVoiceChannel({ channelId: ring.channelId, chatId: ring.chatId, channelName: who });
  if (auth !== voiceAuthGenerationSnapshot()) return authChanged();
  const call = voiceCallSnapshot();
  if (call.phase === "failed" && call.channelId === ring.channelId) {
    oneToOneChannelId = null;
    // `answered` rather than `declined`: the ring **was** answered — the caller
    // was told so — and what failed afterwards is this client's transport. The
    // reason is discarded today; spelling it truthfully is what makes slice B a
    // change to one function body rather than to every call site.
    await stopRing(ring.channelId, "answered");
    return { ok: false, refusal: voiceRingJoinRefusalText(call) };
  }
  return { ok: true };
}

/** Decline. The caller's row clears, their surface goes, and they leave the room. */
export function declineVoiceRing(ring: VoiceRingRow): Promise<VoiceRingOutcome> {
  return stopRing(ring.channelId, "declined");
}

/** Cancel, from the caller's side: clear the ring and leave the room it was waiting in. */
export async function cancelVoiceRing(ring: VoiceRingRow): Promise<VoiceRingOutcome> {
  const auth = voiceAuthGenerationSnapshot();
  oneToOneChannelId = null;
  const outcome = await stopRing(ring.channelId, "cancelled");
  if (auth !== voiceAuthGenerationSnapshot()) return authChanged();
  if (voiceCallSnapshot().channelId === ring.channelId) await leaveVoiceCall();
  return outcome;
}

/**
 * Leave a call, whatever kind it is.
 *
 * For a group room this is `leaveVoiceCall` and nothing else. For a one-to-one
 * call it also clears the ring, which is what ends the call for the other side —
 * hanging up on a private call ends it, as it does everywhere else, and without
 * this the row would stay `answered` and the next «Позвонить» between those two
 * people would be refused with `already_ringing`.
 */
export async function endVoiceCall(): Promise<void> {
  const auth = voiceAuthGenerationSnapshot();
  const channelId = voiceCallSnapshot().channelId;
  const ringing = channelId !== null && channelId === oneToOneChannelId;
  oneToOneChannelId = null;
  if (ringing && channelId) await stopRing(channelId, "answered");
  if (auth !== voiceAuthGenerationSnapshot()) return;
  await leaveVoiceCall();
}
