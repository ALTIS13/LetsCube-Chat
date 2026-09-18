"use client";

import { useSyncExternalStore } from "react";
import { createClient, getSupabasePublicUrl, getSupabasePublishableKey } from "@/lib/supabase/client";
import { buildAudioTrackConstraints, getAudioSettings } from "@/hooks/useAudioSettings";
import { microphonePermissionHelp } from "@/lib/platform/capabilities";
import {
  classifyMicrophoneError,
  microphoneRefusalText,
  type VoiceCallPhase,
  type VoiceParticipant,
} from "@/lib/voiceChannel";
import {
  readVoiceTokenResponse,
  voiceGatewayRefusalText,
  voiceTokenEndpoint,
  voiceTokenRequestBody,
  type VoiceTokenOutcome,
} from "@/lib/voiceGateway";
import { loadVoiceRoom, type VoiceRoom } from "@/hooks/voiceRoom";

/**
 * The call, and the one place it lives.
 *
 * **Why this is module state and not a component's.** A call has to survive a
 * re-render, and it has to survive the person opening a different conversation
 * — which unmounts `ChatWindow` and everything inside it. State held in a
 * component dies with the component, so a `useState` here would hang up the
 * call every time somebody looked at another chat. The connection, the captured
 * microphone and the phase therefore live in module scope, which outlives every
 * component, and React reads them through `useSyncExternalStore`.
 *
 * What that does **not** buy, stated plainly rather than implied: slice 2 has no
 * bar outside the conversation, so while the call keeps running its capsule is
 * only visible from the chat whose channel it is in. Somewhere else in the
 * application the call is audible and invisible. The bar that follows the
 * person is slice 3 of docs/proposals/2026-09-13-voice-channels.md, and this
 * store is the shape it will read from — nothing about it needs to change.
 *
 * Everything asynchronous and browser-bound is here; every rule this file obeys
 * is in `lib/voiceChannel.ts` and `lib/voiceGateway.ts`, where `node --test`
 * can reach it. This module contributes no rule of its own.
 */

export interface VoiceCallState {
  phase: VoiceCallPhase;
  /** The channel the call is in, or is being joined. */
  channelId: string | null;
  /** The chat that channel belongs to, so a capsule elsewhere knows it is elsewhere. */
  chatId: string | null;
  channelName: string | null;
  /** The SDK's own view, replaced whole on every event. Never patched. */
  participants: VoiceParticipant[];
  /**
   * Who is speaking right now, by user id — the SDK's own answer, replaced
   * whole like the list above.
   *
   * Separate from `participants` rather than a flag on each, because the two
   * change at completely different rates: the membership moves when somebody
   * joins, the speakers move several times a second. Merging them would rebuild
   * every row of the rail on every syllable.
   */
  speakers: string[];
  micMuted: boolean;
  /**
   * Whether the token this call was joined with may publish. Always true in
   * slice 2 — `speak_role` defaults to «member» and nothing sets it otherwise —
   * but the gateway already computes it, so reading it costs nothing now and
   * stops the interface lying on the day slice 5 starts refusing.
   */
  canPublish: boolean;
  /** A Russian sentence when the last attempt was refused; null otherwise. */
  refusal: string | null;
}

const IDLE: VoiceCallState = {
  phase: "idle",
  channelId: null,
  chatId: null,
  channelName: null,
  participants: [],
  speakers: [],
  micMuted: false,
  canPublish: true,
  refusal: null,
};

let state: VoiceCallState = IDLE;
const listeners = new Set<() => void>();

/**
 * Monotonic, incremented by every join and every leave.
 *
 * The join sequence has four awaits in it — the microphone, the token, the SDK
 * chunk, the connection — and a person who presses «Отмена» in the middle of
 * any of them must not end up in a call. Every await compares against the
 * generation it started under; a stale continuation releases what it acquired
 * and returns, which is `useVoiceRecorder.ts:142-205`'s session token applied
 * to a longer sequence.
 */
let generation = 0;
let room: VoiceRoom | null = null;

/**
 * The transport of the call that is running, or null.
 *
 * Exported for the connection panel and for nothing else. It is deliberately a
 * function rather than the binding: a module that imported `room` would capture
 * whatever it was at import time, which is `null` for the whole lifetime of the
 * application, and would appear to work because a panel that samples nothing
 * simply draws an empty graph.
 *
 * It does not widen what a caller may do — `VoiceRoom` is the same three-method
 * seam plus the readings — and it is not a way around `useVoiceCall`. Joining
 * and leaving stay here, where the generation counter is.
 */
export function currentVoiceRoom(): VoiceRoom | null {
  return room;
}
let capture: MediaStream | null = null;

function publish(next: VoiceCallState) {
  state = next;
  for (const listener of listeners) listener();
}

function patch(fields: Partial<VoiceCallState>) {
  publish({ ...state, ...fields });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const snapshot = () => state;

/** The call, as a component reads it. The same object for every reader. */
export function useVoiceCall(): VoiceCallState {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Read once, outside React — for a decision that is not a render. */
export function voiceCallSnapshot(): VoiceCallState {
  return state;
}

function stopCapture() {
  if (!capture) return;
  for (const track of capture.getTracks()) {
    try {
      track.stop();
    } catch {
      /* a track already ended is not an error worth surfacing */
    }
  }
  capture = null;
}

/**
 * The microphone, asked for at the moment somebody joins.
 *
 * Never on mount: a permission prompt that appears because a person opened a
 * group is a prompt they cannot answer, since nothing has told them what it is
 * for. The prompt belongs to the press.
 *
 * The `OverconstrainedError` retry is `useVoiceRecorder.ts`'s, for the same
 * reason: the stored input device may have been unplugged since it was chosen,
 * and falling back to the default microphone is better than telling somebody
 * their microphone is missing when it is only a different one.
 */
async function captureMicrophone(): Promise<MediaStream> {
  const constraints = buildAudioTrackConstraints(getAudioSettings());
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: constraints });
  } catch (error) {
    if (error instanceof Error && error.name === "OverconstrainedError") {
      return navigator.mediaDevices.getUserMedia({ audio: true });
    }
    throw error;
  }
}

/**
 * The gateway call, in the one place that makes it.
 *
 * `apikey` goes alongside the bearer token because Kong wants it on every
 * request to a function on this deployment, the way `supportGateway.ts` sends
 * it. A `fetch` that throws is reported as status 0, which is this client's
 * convention for «nothing answered» — see `readVoiceTokenResponse`.
 */
async function requestVoiceToken(channelId: string): Promise<VoiceTokenOutcome> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) return { ok: false, code: "unauthenticated" };
  try {
    const response = await fetch(voiceTokenEndpoint(getSupabasePublicUrl()), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
        apikey: getSupabasePublishableKey(),
      },
      body: JSON.stringify(voiceTokenRequestBody(channelId)),
    });
    const payload = await response.json().catch(() => null);
    return readVoiceTokenResponse(response.status, payload);
  } catch {
    return readVoiceTokenResponse(0, null);
  }
}

function fail(refusal: string) {
  stopCapture();
  room = null;
  publish({ ...IDLE, phase: "failed", channelId: state.channelId, chatId: state.chatId, channelName: state.channelName, refusal });
}

export interface VoiceJoinRequest {
  channelId: string;
  chatId: string;
  channelName: string;
}

/**
 * Join, in the order that costs the least when it goes wrong.
 *
 * The microphone is asked for **before** the token. A person who declines then
 * costs the gateway nothing, creates no room and occupies no seat in the
 * participant cap — whereas minting first would leave a token outstanding for
 * someone who never arrives. It is also the order that puts the browser's own
 * prompt closest to the press that caused it.
 */
export async function joinVoiceChannel(request: VoiceJoinRequest): Promise<void> {
  if (state.phase === "joining") return;
  if (room) await leaveVoiceCall();

  const mine = ++generation;
  publish({
    ...IDLE,
    phase: "joining",
    channelId: request.channelId,
    chatId: request.chatId,
    channelName: request.channelName,
  });

  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    fail(microphoneRefusalText("unsupported"));
    return;
  }

  let stream: MediaStream;
  try {
    stream = await captureMicrophone();
  } catch (error) {
    if (mine !== generation) return;
    const code = classifyMicrophoneError(error);
    fail(
      code === "permission_denied"
        ? `${microphoneRefusalText(code)} ${microphonePermissionHelp()}`
        : microphoneRefusalText(code),
    );
    return;
  }

  if (mine !== generation) {
    for (const track of stream.getTracks()) track.stop();
    return;
  }
  capture = stream;

  const outcome = await requestVoiceToken(request.channelId);
  if (mine !== generation) {
    stopCapture();
    return;
  }
  if (!outcome.ok) {
    fail(voiceGatewayRefusalText(outcome.code));
    return;
  }

  let opened: VoiceRoom;
  try {
    opened = await loadVoiceRoom({
      onParticipants: (participants) => {
        // A late event from a room this client has already left must not
        // repopulate a capsule that is gone.
        if (mine !== generation) return;
        patch({ participants });
      },
      onSpeakers: (speakers) => {
        if (mine !== generation) return;
        patch({ speakers });
      },
      onReconnecting: () => {
        if (mine !== generation) return;
        patch({ phase: "reconnecting" });
      },
      onReconnected: () => {
        if (mine !== generation) return;
        patch({ phase: "connected" });
      },
      onClosed: () => {
        if (mine !== generation) return;
        stopCapture();
        room = null;
        publish({ ...IDLE, phase: "failed", refusal: "Звонок прерван." });
      },
    });
  } catch {
    // The SDK's chunk failed to load — an offline reload, or a deploy that
    // removed the hashed file while the tab stayed open.
    fail("Не удалось загрузить голосовой модуль.");
    return;
  }

  if (mine !== generation) {
    stopCapture();
    void opened.leave().catch(() => undefined);
    return;
  }

  const [microphone] = stream.getAudioTracks();
  if (!microphone) {
    fail(microphoneRefusalText("no_device"));
    return;
  }

  try {
    // A token that may not publish still joins and still hears. What it must
    // not do is hand the SFU a track it would refuse, so the capture is
    // released here rather than held open with the microphone light on for a
    // stream nobody will ever receive.
    if (!outcome.grant.canPublish) {
      stopCapture();
      await opened.join(outcome.grant.url, outcome.grant.token, null);
    } else {
      await opened.join(outcome.grant.url, outcome.grant.token, microphone);
    }
  } catch {
    void opened.leave().catch(() => undefined);
    if (mine !== generation) return;
    fail("Не удалось подключиться к голосовому серверу.");
    return;
  }

  if (mine !== generation) {
    stopCapture();
    void opened.leave().catch(() => undefined);
    return;
  }

  room = opened;
  patch({ phase: "connected", canPublish: outcome.grant.canPublish, refusal: null });
}

/** Leave. Safe during a join, after a failure, and when there is no call at all. */
export async function leaveVoiceCall(): Promise<void> {
  generation += 1;
  const open = room;
  room = null;
  stopCapture();
  publish(IDLE);
  if (open) await open.leave().catch(() => undefined);
}

/**
 * Self-mute.
 *
 * The state moves first and the SDK follows, because a mute control that waits
 * for a round trip before it changes reads as broken on a slow link — and the
 * thing a person is trying to do is stop being heard *now*. If the SDK refuses,
 * the state goes back, which is the only honest way round: saying «выключён»
 * over a microphone that is still publishing is the failure this ordering has
 * to avoid.
 */
export async function setVoiceMuted(muted: boolean): Promise<void> {
  if (!room) return;
  const before = state.micMuted;
  patch({ micMuted: muted });
  try {
    await room.setMuted(muted);
  } catch {
    patch({ micMuted: before });
  }
}
