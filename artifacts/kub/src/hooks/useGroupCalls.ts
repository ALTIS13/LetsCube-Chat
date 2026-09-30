"use client";

import { useMemo, useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import { getChatDisplayInfo } from "@/lib/chatDisplay";
import {
  groupCallMoveTarget,
  groupCallRefusalText,
  groupRingKey,
  groupRingNextExpiry,
  pickGroupRing,
  type GroupCallRow,
  type GroupRingPick,
} from "@/lib/groupCall";
import { useAppStore } from "@/store/app.store";
import { joinVoiceChannel, leaveVoiceCall, voiceCallSnapshot } from "@/hooks/useVoiceCall";

/**
 * A group chat's calls, and the one place they live — tracker item 45, second
 * phase. Every rule is `lib/groupCall.ts`'s; this is the wiring.
 *
 * Nothing here opens a subscription. The rows come from `useVoicePresenceReader`,
 * the one unfiltered `voice_channels` channel every signed-in client already
 * holds, which hands them here **before** it hands the private rings to
 * `publishVoiceRings`. The order is load-bearing, and `group-call.spec.ts` goes
 * red without it: when a private call moves into a group chat, the private ring
 * clears in the same read that carries the move, and the ring store's rule «a
 * ring gone is a call over» would hang the call up before the move is read.
 * Following the move leaves the private room synchronously — `leaveVoiceCall`
 * publishes the idle state before its first await — so by the time the ring
 * store looks, this client is in no call it could hang up.
 */

type LooseClient = {
  rpc<T>(name: string, args: Record<string, unknown>): PromiseLike<{ data: T | null; error: unknown }>;
};

function looseClient(): LooseClient {
  return createClient() as unknown as LooseClient;
}

let rows: readonly GroupCallRow[] = [];
let viewerId: string | null = null;
/** Rings this reader declined, until the row stops carrying them. */
const declined = new Set<string>();
/** The room a move is already under way into, so a second read does not start it again. */
let movingTo: string | null = null;
let pick: GroupRingPick | null = null;
let expiryTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function chatTitle(chatId: string): string {
  const state = useAppStore.getState();
  const chat = state.chats.find((entry) => entry.id === chatId);
  return chat ? getChatDisplayInfo(chat, state.currentUser?.id ?? null).title : "Групповой звонок";
}

function followMove(): void {
  const call = voiceCallSnapshot();
  const callChannelId = call.channelId;
  const target = groupCallMoveTarget({ callChannelId, calls: rows, now: Date.now() });
  if (!target || callChannelId === null) {
    if (callChannelId === movingTo) movingTo = null;
    return;
  }
  if (movingTo === target.channelId) return;
  movingTo = target.channelId;
  const request = {
    channelId: target.channelId,
    chatId: target.chatId,
    channelName: chatTitle(target.chatId),
    oneToOne: true,
  };
  // A join still connecting to the private room would make `joinVoiceChannel`
  // return at once and leave this client arriving in the room the call left.
  // Cancelling it first is what `leaveVoiceCall` does during a join.
  if (call.phase === "joining") {
    void leaveVoiceCall().then(() => joinVoiceChannel(request));
    return;
  }
  void joinVoiceChannel(request);
}

function recompute(): void {
  const now = Date.now();
  // A decline is remembered only while the row still carries that ring.
  for (const key of [...declined]) {
    const [channelId, at] = key.split("@");
    const row = rows.find((entry) => entry.channelId === channelId);
    if (!row || String(row.ringing.get(viewerId ?? "")) !== at) declined.delete(key);
  }
  const next = pickGroupRing({
    calls: rows,
    selfId: viewerId,
    now,
    callChannelId: voiceCallSnapshot().channelId,
    declined,
  });
  if (expiryTimer !== null) {
    clearTimeout(expiryTimer);
    expiryTimer = null;
  }
  const expiry = groupRingNextExpiry({ calls: rows, selfId: viewerId, now });
  if (Number.isFinite(expiry) && typeof setTimeout === "function") {
    expiryTimer = setTimeout(recompute, Math.max(0, expiry - now) + 1);
  }
  const changed =
    (pick === null) !== (next === null) ||
    (pick !== null && next !== null && (pick.call !== next.call || pick.rungAt !== next.rungAt));
  pick = next;
  if (changed) notify();
}

/** The rows the chat-list reader just saw. Called before the private rings are. */
export function publishGroupCalls(next: readonly GroupCallRow[]): void {
  rows = next;
  followMove();
  recompute();
  notify();
}

/** Who is reading. */
export function setGroupCallViewer(userId: string | null): void {
  if (viewerId === userId) return;
  viewerId = userId;
  declined.clear();
  movingTo = null;
  recompute();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const rowsSnapshot = () => rows;
const pickSnapshot = () => pick;

/** Every group chat room with a call or a move, as last read. */
export function useGroupCalls(): readonly GroupCallRow[] {
  return useSyncExternalStore(subscribe, rowsSnapshot, rowsSnapshot);
}

/** The group call ringing this reader right now, or none. */
export function useGroupRingPick(): GroupRingPick | null {
  return useSyncExternalStore(subscribe, pickSnapshot, pickSnapshot);
}

/** The room of one group chat, if it carries a call. */
export function useGroupCallForChat(chatId: string | null | undefined): GroupCallRow | null {
  const calls = useGroupCalls();
  return useMemo(
    () => (chatId ? calls.find((row) => row.chatId === chatId && row.messageId !== null) ?? null : null),
    [calls, chatId],
  );
}

/** Read once, outside React. */
export function groupCallsSnapshot(): readonly GroupCallRow[] {
  return rows;
}

export type GroupCallOutcome = { ok: true } | { ok: false; refusal: string };

/**
 * Start a group chat's call, or find the one running, and join it. The start
 * rings everybody else; joining is what makes the caller a participant.
 */
export async function startGroupCall(chatId: string): Promise<GroupCallOutcome> {
  const { data, error } = await looseClient().rpc<
    { channel_id: string; message_id: string; started: boolean }[] | { channel_id: string; message_id: string; started: boolean }
  >("voice_group_call_start", { p_chat_id: chatId });
  if (error) return { ok: false, refusal: groupCallRefusalText(error) };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row.channel_id !== "string") return { ok: false, refusal: groupCallRefusalText(null) };
  await joinVoiceChannel({ channelId: row.channel_id, chatId, channelName: chatTitle(chatId), oneToOne: true });
  return { ok: true };
}

/** Answer a group ring: take a seat. The database stops the ring when the seat is taken. */
export async function answerGroupRing(ring: GroupRingPick): Promise<GroupCallOutcome> {
  // Handled here, as a decline is: the row keeps the ring until the seat's
  // webhook lands, and the band must not stand over a call being joined.
  declined.add(groupRingKey(ring));
  recompute();
  await joinVoiceChannel({
    channelId: ring.call.channelId,
    chatId: ring.call.chatId,
    channelName: chatTitle(ring.call.chatId),
    oneToOne: true,
  });
  return { ok: true };
}

/** Decline a group ring: stop one's own, as Discord's «stop-ringing» does. */
export async function declineGroupRing(ring: GroupRingPick): Promise<GroupCallOutcome> {
  declined.add(groupRingKey(ring));
  recompute();
  const { error } = await looseClient().rpc<boolean>("voice_group_call_decline", { p_channel_id: ring.call.channelId });
  if (error) return { ok: false, refusal: groupCallRefusalText(error) };
  return { ok: true };
}
