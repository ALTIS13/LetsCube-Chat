"use client";

import { useCallback, useSyncExternalStore } from "react";
import { createClient, getSupabasePublicUrl, getSupabasePublishableKey } from "@/lib/supabase/client";
import {
  AUDIO_SETTINGS_EVENT,
  AUDIO_SETTINGS_STORAGE_KEY,
  buildAudioTrackConstraints,
  getAudioSettings,
} from "@/hooks/useAudioSettings";
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
   * True when the browser refused to send this call's audio to the chosen
   * output device.
   *
   * Recorded rather than swallowed, because the alternative is an interface
   * that shows a headset selected while the call is still coming out of the
   * laptop. Firefox has no `setSinkId` at all; a device that has been unplugged
   * since it was chosen is refused everywhere.
   */
  outputDeviceRefused: boolean;
  micMuted: boolean;
  /**
   * Whether this person has stopped hearing the room (Discord's «deafen»).
   *
   * Local, and nobody else is told: it is a decision about their own ears.
   * Self-mute is the opposite and the SFU propagates it, because a silent
   * microphone is a fact about the conversation rather than about one listener.
   */
  deafened: boolean;
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
  outputDeviceRefused: false,
  micMuted: false,
  deafened: false,
  canPublish: true,
  refusal: null,
};

let state: VoiceCallState = IDLE;
const listeners = new Set<() => void>();

/**
 * Who is speaking right now, by user id — the SDK's own answer, replaced whole
 * and never patched.
 *
 * **Beside `VoiceCallState` rather than inside it, and the reason is a
 * measurement.** It was a field of the state for an afternoon, which is the
 * obvious place for it: same store, same listeners, one snapshot. Then
 * `tests/e2e/voice-call.spec.ts` counted the React commits. With eight people
 * in a room and nineteen faces on screen, ten speaker changes rendered
 * `VoiceSpeakingAvatar` 190 times — **every face on screen, on every syllable**
 * — and with it `ChatWindow`, `ChatInfoPanel`, `VoiceChannelRow`,
 * `VoiceCallCapsule` and the message list, ten times each.
 *
 * Nothing read `state.speakers`. The cost came from its being in the object at
 * all: `useVoiceCall` hands out `state`, `patch` makes a new one, and every
 * reader of the call — `ChatWindow` above all — therefore renders its whole
 * subtree each time the SFU changes its mind about who is talking. A leaf that
 * subscribes to a boolean cannot help while its parents are being rebuilt
 * around it.
 *
 * Held here, the same listener set can still be notified: every subscriber's
 * `getSnapshot` runs, `useVoiceCall`'s returns the **unchanged** `state`
 * object, and `useSyncExternalStore` compares with `Object.is` and renders
 * nothing. Only `useVoiceSpeaking`, whose snapshot is a boolean for one person,
 * sees a change — and only for the person whose turn it was. The same
 * measurement after the move is in the spec.
 *
 * Do not move it back into `VoiceCallState`. The test that would go red is the
 * one named above, and it is red for the right reason.
 */
let speakers: readonly string[] = [];

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
 * Whether the microphone was already muted when this person deafened.
 *
 * Module state beside `room`, not a field of the view: it is not something a
 * screen draws, and putting it in the state would make every consumer re-render
 * when it changed. Reset with the call, because a new call is not the old one.
 */
let mutedBeforeDeafened = false;

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

/**
 * The speaker list, replaced and announced.
 *
 * The same listeners as `publish`, on purpose: a reader of the call state will
 * run its `getSnapshot`, find the object it already had, and not render. That
 * is what makes this cheap, and it is why there is no second listener set to
 * keep in step with the first.
 */
function publishSpeakers(next: readonly string[]) {
  speakers = next;
  for (const listener of listeners) listener();
}

/** Nobody is speaking in a call that is not running. */
function forgetSpeakers() {
  if (speakers.length === 0) return;
  publishSpeakers([]);
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

/**
 * Whether one person is speaking right now — a boolean, and that is the whole
 * point of it.
 *
 * `speakers` is replaced several times a second, so every reader of the state
 * object renders on every syllable anybody in the room utters. This hands a row
 * a **primitive** instead: `useSyncExternalStore` compares snapshots with
 * `Object.is`, so a component subscribed through here renders only when its own
 * person started or stopped talking — and a room where three people are talking
 * over each other costs three rows, not the list.
 *
 * The measurement, rather than the claim, is in `tests/e2e/voice-call.spec.ts`:
 * "a speaker change renders the rows that changed and nothing else".
 *
 * `channelId` scopes the answer to one room. The speaker list belongs to the
 * call this client is connected to and to no other, while the rail draws a row
 * per person per room from a table that is up to one reconciliation period
 * stale — so without the scope, somebody who has just moved rooms would be
 * ringed in the room they left, for as long as the table still said they were
 * in it.
 */
export function useVoiceSpeaking(userId: string | null, channelId: string | null): boolean {
  const read = useCallback(
    () => userId !== null && state.channelId === channelId && speakers.includes(userId),
    [channelId, userId],
  );
  return useSyncExternalStore(subscribe, read, read);
}

/** Read once, outside React. The whole set, as the SDK last sent it. */
export function voiceSpeakersSnapshot(): readonly string[] {
  return speakers;
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

/* ── Where the call's audio comes out ──────────────────────────────────────
 *
 * Until 2026-09-18 the chosen output device reached a voice **message**, media
 * playback and the composer's preview — `lib/audioOutput.ts` applied to three
 * `<audio>` elements — and reached a call nowhere at all. Picking a headset
 * moved everything except the one thing people pick a headset for.
 *
 * Two differences from `applyAudioOutputDevice`, both deliberate:
 *
 *   - **`default` is applied rather than skipped.** The element helper may skip
 *     it, because an `<audio>` element is created fresh per media and starts on
 *     the system device anyway. A room is not: it outlives the choice, so
 *     somebody moving back to the system device mid-call would otherwise stay
 *     on the headset they have just unplugged.
 *   - **A refusal is recorded rather than swallowed.** `setOutputDevice`
 *     answers `false` where the browser would not do it — Firefox ships no
 *     `setSinkId`, and any browser refuses a device that has gone — and
 *     `outputDeviceRefused` is what stops the capsule reporting a move that did
 *     not happen.
 *
 * The listener belongs to the module rather than to a component for the reason
 * at the top of this file: a call outlives every component that can draw it, so
 * a device chosen in settings while another conversation is open still has to
 * reach it. `storage` beside the custom event, because `useAudioSettings`
 * listens to both — the choice may have been made in another tab.
 */
let appliedOutputDevice: string | null = null;
let stopWatchingOutputDevice: (() => void) | null = null;

async function applyOutputDevice(target: VoiceRoom, deviceId: string, mine: number): Promise<void> {
  if (appliedOutputDevice === deviceId) return;
  let taken = false;
  try {
    taken = await target.setOutputDevice(deviceId);
  } catch {
    // A transport that threw moved no audio. That is the same answer as
    // `false` and has to read the same way round.
    taken = false;
  }
  // The call this was asked for may be over, or be a different one.
  if (mine !== generation || room !== target) return;
  // Only a device the transport actually took is remembered, so a refusal is
  // asked again next time rather than mistaken for work already done.
  appliedOutputDevice = taken ? deviceId : null;
  patch({ outputDeviceRefused: !taken });
}

function watchOutputDevice(target: VoiceRoom, mine: number): void {
  forgetOutputDevice();
  if (typeof window === "undefined") return;
  const apply = () => {
    if (mine !== generation || room !== target) return;
    void applyOutputDevice(target, getAudioSettings().selectedOutputDeviceId, mine);
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === AUDIO_SETTINGS_STORAGE_KEY) apply();
  };
  window.addEventListener(AUDIO_SETTINGS_EVENT, apply);
  window.addEventListener("storage", onStorage);
  stopWatchingOutputDevice = () => {
    window.removeEventListener(AUDIO_SETTINGS_EVENT, apply);
    window.removeEventListener("storage", onStorage);
  };
}

/** Safe to call twice, during a join, and when there was never a call. */
function forgetOutputDevice(): void {
  stopWatchingOutputDevice?.();
  stopWatchingOutputDevice = null;
  appliedOutputDevice = null;
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
  forgetOutputDevice();
  forgetSpeakers();
  room = null;
  mutedBeforeDeafened = false;
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
  forgetSpeakers();
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
      onSpeakers: (talking) => {
        if (mine !== generation) return;
        publishSpeakers(talking);
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
        forgetOutputDevice();
        forgetSpeakers();
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
  // The stored choice, reaching a call for the first time. After the patch, so
  // that a refusal lands on a capsule which already exists: a sentence about a
  // call has nowhere to appear while the capsule still says «Подключаемся…».
  watchOutputDevice(opened, mine);
  void applyOutputDevice(opened, getAudioSettings().selectedOutputDeviceId, mine);
}

/** Leave. Safe during a join, after a failure, and when there is no call at all. */
export async function leaveVoiceCall(): Promise<void> {
  generation += 1;
  const open = room;
  room = null;
  stopCapture();
  forgetOutputDevice();
  forgetSpeakers();
  publish(IDLE);
  if (open) await open.leave().catch(() => undefined);
}

/**
 * Deafen, and the one thing it does beyond going quiet.
 *
 * Deafening also mutes, because that is what every product with the control
 * does and because the alternative is worse than inconsistent: somebody who
 * cannot hear the room cannot hear themselves being asked to stop talking.
 * Undeafening does **not** unmute — somebody who was muted before they
 * deafened stays muted, and the state remembers which.
 *
 * Optimistic in the same direction as the mute above, and for the same reason:
 * the thing a person is trying to do is stop hearing something *now*. On a
 * refusal the flag goes back, because «заглушено» over audio that is still
 * playing is the lie this ordering exists to avoid.
 */
export async function setVoiceDeafened(deafened: boolean): Promise<void> {
  if (!room) return;
  const beforeDeafened = state.deafened;
  const beforeMuted = state.micMuted;
  // Remembered before the patch, so undeafening restores what was true rather
  // than unmuting somebody who had muted themselves first.
  const mutedNext = deafened ? true : mutedBeforeDeafened;
  if (deafened) mutedBeforeDeafened = beforeMuted;
  patch({ deafened, micMuted: mutedNext });
  try {
    await room.setDeafened(deafened);
    if (mutedNext !== beforeMuted) await room.setMuted(mutedNext);
  } catch {
    patch({ deafened: beforeDeafened, micMuted: beforeMuted });
  }
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
