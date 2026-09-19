"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { createClient, getSupabasePublicUrl, getSupabasePublishableKey } from "@/lib/supabase/client";
import {
  AUDIO_SETTINGS_EVENT,
  AUDIO_SETTINGS_STORAGE_KEY,
  buildAudioTrackConstraints,
  getAudioSettings,
} from "@/hooks/useAudioSettings";
import { playCallSoundOnce } from "@/lib/callSoundPlayer";
import { createVoiceRoomSoundDriver } from "@/lib/voiceRoomSoundDriver";
import { microphonePermissionHelp } from "@/lib/platform/capabilities";
import {
  MIC_GATE_CLOSED,
  micGateNeedsLevel,
  micTalkKeyFires,
  micTalkKeyReleases,
  nextMicGate,
  type MicActivation,
  type MicGateState,
} from "@/lib/micGate";
import { openMicLevelSource, type MicLevelSource } from "@/lib/micLevel";
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
import {
  voiceJoinCurrentStage,
  voiceJoinOpenStep,
  voiceJoinProgressText,
  voiceJoinFailureText,
  voiceJoinSettled,
  voiceJoinStageBegan,
  voiceJoinStageIsSlow,
  VOICE_JOIN_JOURNAL_EMPTY,
  VOICE_JOIN_SLOW_MS,
  type VoiceJoinJournal,
  type VoiceJoinStage,
} from "@/lib/voiceJoinProgress";
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
  /**
   * Whether somebody took this client's permission to speak away **during** the
   * call.
   *
   * Distinct from `canPublish`, which is the grant the token was minted with
   * and never changes for the length of a call. This one is the room's current
   * answer, and the only thing in the product that changes it mid-call is a
   * moderator pressing «Заглушить» — the gateway calls the SFU's
   * `UpdateParticipant` with `canPublish: false` and writes no database column
   * at all, so the SFU is the only place the fact exists.
   *
   * A token minted **without** publish rights does not set this. That is the
   * listen-only grant, which the capsule already states as «Только слушаете»,
   * and reading it as a revocation would tell somebody a moderator had silenced
   * them when nobody had touched them.
   *
   * In `VoiceCallState` rather than beside it, which is the opposite of the
   * choice `speakers` gets below, and the reason is the measurement that made
   * `speakers` move out: it is replaced several times a second, so every reader
   * of this object re-renders on every syllable. A revocation happens when a
   * moderator presses a control — once in a call, or never — and it changes
   * what the capsule *says*, so a reader re-rendering for it is the point of
   * it. `deafened` is held here for the same reason and at the same rate.
   */
  speechRevoked: boolean;
  /**
   * True when the browser is refusing to sound this call.
   *
   * Not a network fault, and not a refusal of anything the person asked for:
   * the elements are attached and the packets are arriving, and the autoplay
   * policy will not start playback because the document has not been touched.
   * Recorded for one reason — the symptom is hearing nothing while every
   * number on the connection panel says the call is fine, which is
   * indistinguishable by ear from a broken call, and is the exact failure this
   * product shipped for six days.
   *
   * Almost always false: the join press is a gesture, and the join asks on it.
   * The case that survives is a call nobody pressed for — a ring answered on
   * another device, a tab restored into a call.
   */
  audioBlocked: boolean;
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
  // False here is what clears a revocation at both ends of a call's life: every
  // join publishes `{ ...IDLE, phase: "joining" }`, every leave publishes
  // `IDLE`, and both failure paths spread it too. So one call's force-mute
  // cannot survive into the next, and there is no separate reset to forget.
  speechRevoked: false,
  // Cleared with the call at both ends of its life, like `speechRevoked` above
  // and for the same reason: one call's blocked playback is not the next call's.
  audioBlocked: false,
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

/* ── Which step of the join is running, and how long each one took ────────
 *
 * The owner asked for this on 2026-09-19, after somebody’s join failed three
 * times at 15.2 s, 14.6 s and 15.0 s and the whole of what they could report was
 * «не подключается». Finding out that the signalling socket had connected and
 * the peer connection had not took an evening and a read of the media server’s
 * logs; every fact in that sentence was in this module at the time.
 *
 * **Beside `VoiceCallState` rather than inside it**, which is the same place
 * `speakers` and `talkHeld` sit, for two reasons that are not the render-cost
 * one they were moved out for:
 *
 *   1. **It has to outlive the phase.** `fail()` publishes `{ ...IDLE, phase:
 *      "failed" }` and so does every other ending; a field of the state would be
 *      wiped by the very transition whose cause it exists to name, and every
 *      future `{ ...IDLE }` spread would be one more chance to drop it silently.
 *      Here there is exactly one place that clears it — the next join.
 *   2. **What a surface draws from it is a moving clock, not a value.** «this
 *      stage has been running eight seconds» changes without anything happening,
 *      so the reader has to tick; a field of the state would mean re-publishing
 *      the call once a second for the length of every join, rendering
 *      `ChatWindow`’s whole subtree each time. `useVoiceJoinProgress` owns its own
 *      timer, starts it only once the running stage is over its budget, and
 *      re-renders the two surfaces that draw the line.
 *
 * Every rule about it — the order of the stages, the budgets, the words, and the
 * refusal to let a stage move backwards — is `lib/voiceJoinProgress.ts`’s, where
 * `node --test` can drive it. What is here is the wiring.
 */
let journal: VoiceJoinJournal = VOICE_JOIN_JOURNAL_EMPTY;

/**
 * Whether the browser refused to sound this call **at any point**, as opposed
 * to right now.
 *
 * `VoiceCallState.audioBlocked` is the live fact and is cleared the moment
 * playback starts, which is correct for a capsule and useless for a report: by
 * the time somebody presses a button the refusal they are reporting has already
 * been resolved by that very press. Kept beside the state and cleared with the
 * call, like `mutedBeforeDeafened` above and for the same reason — nothing draws
 * it, and a field of the view would re-render every reader when it moved.
 */
let audioEverBlocked = false;

/** The stage history of the join that ran, or is running. Read once, outside React. */
export function voiceJoinJournalSnapshot(): VoiceJoinJournal {
  return journal;
}

/** Whether this call’s audio was ever refused by the autoplay policy. */
export function voiceAudioEverBlockedSnapshot(): boolean {
  return audioEverBlocked;
}

/**
 * Record that a stage of the join has begun, and tell the surfaces drawing it.
 *
 * The listener set is `publish`’s, deliberately: a reader of `VoiceCallState`
 * runs its `getSnapshot`, finds the object it already had, and renders nothing.
 * Only `useVoiceJoinProgress`, whose snapshots are a string and a number, sees a
 * change.
 */
function enterStage(stage: VoiceJoinStage): void {
  const next = voiceJoinStageBegan(journal, stage, Date.now());
  if (next === journal) return;
  journal = next;
  for (const listener of listeners) listener();
}

/** Close the journal: connected, failed, or cancelled. Safe to call twice. */
function settleJournal(): void {
  const next = voiceJoinSettled(journal, Date.now());
  if (next === journal) return;
  journal = next;
  for (const listener of listeners) listener();
}
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
 * Exported for the hooks that have to reach the transport directly rather than
 * through the call's state: `useVoiceHealth` samples it on a timer, and
 * `useVoiceVolume` pushes a chosen loudness into it. It is deliberately a
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

/* ── The four sounds a channel makes ───────────────────────────────────────
 *
 * Who is here, who just arrived, who just left, and the blip a control answers
 * with. Every rule is `lib/voiceRoomSound.ts`'s and every browser fact is
 * `lib/callSoundPlayer.ts`'s; what the two cannot be — remembering the last
 * reading, noticing a move, and coming back on a clock for a departure that
 * matures with nothing else happening — is `lib/voiceRoomSoundDriver.ts`'s,
 * where `node --test` can drive it through a reconnect storm.
 *
 * **Nothing here primes the audio context.** A browser sounds nothing until the
 * page has been touched, the join press is such a touch, and
 * `useCallSoundPriming` — installed by `VoiceCallRing`, which `MainLayout`
 * mounts for the whole signed-in session — already resumes the context on every
 * `pointerdown`, `keydown` and `touchend` the window sees. The join button's own
 * `pointerdown` runs that listener before its `click` ever reaches this module,
 * so a second mechanism here would be a second thing to keep in step with the
 * first for no behaviour at all. `playCallSoundOnce` asks again regardless, and
 * a refusal is recorded rather than swallowed.
 */
const roomSound = createVoiceRoomSoundDriver({
  now: () => Date.now(),
  schedule: (delayMs, fire) => {
    const handle = setTimeout(fire, delayMs);
    return () => clearTimeout(handle);
  },
  // Non-looping by name, and the player refuses a looping one outright — the
  // ring is the only sound in this product that must be stopped by something
  // other than its own length, and it is not started from here.
  play: (sound) => {
    void playCallSoundOnce(sound).catch(() => undefined);
  },
});

/**
 * Who the roster calls us.
 *
 * Read from the session the token request already makes, because that is the
 * identity the gateway mints the token with — `"identity": "<user id>"` — and
 * therefore the exact string `VoiceParticipant.userId` carries for this client.
 * Not taken from the first entry of the participant list, which happens to be
 * the local one today and is a property of `report()` rather than of the seam's
 * contract; and not from the profile store, which can be empty for reasons that
 * have nothing to do with a call. A wrong answer here is silent — the rule
 * would never see us in the room and would never sound anything at all — so it
 * comes from the one place a join cannot proceed without.
 */
let selfUserId: string | null = null;

/**
 * Who the roster calls us, read once outside React.
 *
 * The same value `observeCallSound` uses, exported for the connection report
 * so that its «you» line names this client from the session the token was
 * minted with rather than from `participants[0]` — which is the local
 * participant only as a property of `report()`'s ordering, and would be wrong
 * silently on the day that ordering changed.
 */
export function voiceSelfIdSnapshot(): string | null {
  return selfUserId;
}

/** One reading of the call, taken wherever the call's state is published. */
function observeCallSound() {
  roomSound.observe({
    phase: state.phase,
    participants: state.participants,
    selfUserId,
    micMuted: state.micMuted,
    deafened: state.deafened,
    enabled: getAudioSettings().callSoundEnabled,
  });
}

function publish(next: VoiceCallState) {
  state = next;
  // Before the listeners rather than after them: every path that ends a call
  // publishes, and the sound that answers it should not queue behind React
  // being told about a component tree that is about to be thrown away. The
  // driver touches nothing in this module, so the order cannot be observed from
  // anywhere else.
  observeCallSound();
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

/**
 * The whole stage history, for the surface that draws it as a list.
 *
 * A reference rather than a primitive, which is the one place in this module
 * that is deliberate rather than reluctant: the journal is replaced by a new
 * array only when a stage actually moves — six times in a join and never
 * again — so `Object.is` does exactly the right thing and a subscriber renders
 * once per step.
 */
export function useVoiceJoinJournal(): VoiceJoinJournal {
  return useSyncExternalStore(subscribe, voiceJoinJournalSnapshot, voiceJoinJournalSnapshot);
}

/** The running stage, or null when no join is in flight. A primitive, on purpose. */
const currentStage = (): VoiceJoinStage | null => voiceJoinCurrentStage(journal);
/** When that stage began. `0` when none is running, which nothing reads. */
const currentStageSince = (): number => voiceJoinOpenStep(journal)?.at ?? 0;

/** What a surface draws about a join in flight. */
export interface VoiceJoinProgress {
  readonly stage: VoiceJoinStage;
  readonly elapsedMs: number;
  /** Past this stage’s budget — `lib/voiceJoinProgress.ts` holds the numbers. */
  readonly slow: boolean;
  /** The one line to draw, already in Russian. */
  readonly text: string;
}

/**
 * Which step of the join is running, and how long it has been running.
 *
 * Two `useSyncExternalStore` reads of **primitives** rather than one of the
 * journal, for the reason `useVoiceSpeaking` gives: the journal is a new array
 * on every stage change, so a component subscribed to it would render on every
 * change of any kind, while a component subscribed to a string renders when its
 * own answer moves.
 *
 * **The timer does not run for an ordinary join, and that is the point of the
 * two-step schedule.** A join that connects in under a second has nothing to
 * say beyond its sentence, so the only thing scheduled is one `setTimeout` to
 * the moment the running stage would become slow — which for almost every join
 * is cancelled before it fires. The once-a-second tick starts only then, and
 * only then does anything re-render, because only then is there a number on
 * screen that moves.
 */
export function useVoiceJoinProgress(): VoiceJoinProgress | null {
  const stage = useSyncExternalStore(subscribe, currentStage, currentStage);
  const since = useSyncExternalStore(subscribe, currentStageSince, currentStageSince);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (stage === null) return;
    let ticking = 0;
    const start = () => {
      setNow(Date.now());
      ticking = window.setInterval(() => setNow(Date.now()), 1000);
    };
    // `Math.max(0, …)` so a stage that is **already** over its budget when
    // something mounts — a conversation opened while a join is hanging — starts
    // ticking immediately rather than waiting out a negative delay.
    const waiting = window.setTimeout(start, Math.max(0, since + VOICE_JOIN_SLOW_MS[stage] - Date.now()));
    return () => {
      window.clearTimeout(waiting);
      if (ticking) window.clearInterval(ticking);
    };
  }, [since, stage]);

  if (stage === null) return null;
  const elapsedMs = Math.max(0, now - since);
  return {
    stage,
    elapsedMs,
    slow: voiceJoinStageIsSlow(stage, elapsedMs),
    text: voiceJoinProgressText(stage, elapsedMs),
  };
}

/**
 * Whether the talk control — the key or the button — is being held right now.
 *
 * Beside `VoiceCallState` rather than inside it, for the reason `speakers` is:
 * it changes once per sentence in a push-to-talk conversation, and a field of
 * the state object rebuilds `ChatWindow`'s whole subtree every time it moves.
 * A primitive read through `useSyncExternalStore` renders the two controls that
 * draw it and nothing else.
 *
 * Not scoped by channel, unlike `useVoiceSpeaking`: there is one call and one
 * key, and the two surfaces that draw the control already only draw it for the
 * call that is running.
 */
let talkHeld = false;

export function useVoiceTalkHeld(): boolean {
  const read = useCallback(() => talkHeld, []);
  return useSyncExternalStore(subscribe, read, read);
}

/** Read once, outside React. */
export function voiceTalkHeldSnapshot(): boolean {
  return talkHeld;
}

/**
 * Whether a moderator has silenced this client in one particular room.
 *
 * A primitive, and scoped by `channelId`, for the same two reasons
 * `useVoiceSpeaking` is: a component subscribed through here renders only when
 * the answer for **its** room changes, and a capsule drawing some other chat's
 * channel must not say that this person has been silenced in it.
 *
 * It reads the store directly rather than arriving as a prop because the
 * capsule's `view` is built by `voiceCapsuleState`, whose whole job is to be a
 * rule a `node --test` process can load — and this is not a rule, it is one
 * live fact about one client. The precedent is `VoiceSpeakingAvatar`, a leaf
 * inside the same capsule that subscribes to a boolean of its own.
 */
export function useVoiceSpeechRevoked(channelId: string | null): boolean {
  const read = useCallback(
    () => state.speechRevoked && state.channelId === channelId,
    [channelId],
  );
  return useSyncExternalStore(subscribe, read, read);
}

/**
 * Whether the browser is refusing to sound the call in one particular room.
 *
 * Scoped by `channelId` and read off the store directly, for the two reasons
 * `useVoiceSpeechRevoked` above is: only the capsule for the room this is true
 * of re-renders, and a capsule drawing another chat's channel must not offer a
 * control for a call it is not in.
 */
export function useVoiceAudioBlocked(channelId: string | null): boolean {
  const read = useCallback(
    () => state.audioBlocked && state.channelId === channelId,
    [channelId],
  );
  return useSyncExternalStore(subscribe, read, read);
}

/**
 * Ask the browser again, from a gesture.
 *
 * A plain exported function rather than the component reaching through
 * `currentVoiceRoom`, so the module that owns the call's lifetime stays the one
 * that touches it: a press arriving after the call ended finds no room and is a
 * no-op rather than a throw.
 */
export async function resumeVoiceAudio(): Promise<void> {
  await room?.resumeAudio();
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

/* ── How the microphone decides to be open ─────────────────────────────────
 *
 * Three modes, and a call has to hold whatever the second and third need: a
 * level to compare against a threshold, a key that may be held anywhere in the
 * application, and the releases that are not keyups. All of it belongs to the
 * module rather than to a component for the reason at the top of this file — a
 * call outlives every screen that can draw it, and a person who alt-tabs out of
 * a conversation is exactly the case a held key has to survive.
 *
 * Every decision below is `lib/micGate.ts`'s. What is here is the wiring: when
 * the level source exists, what the settings cache is refreshed by, which
 * events release a hold, and the one place the answer is pushed at the
 * transport.
 */

/**
 * The mode, the threshold and the key, cached.
 *
 * Read from storage on the join and refreshed by the same two events
 * `watchOutputDevice` listens to. It is a cache rather than a call to
 * `getAudioSettings()` at the point of use because the point of use is a
 * `keydown` handler on `window`: that function reads `localStorage` and parses
 * JSON, and doing it for every key somebody types in the composer is a cost
 * nobody asked for.
 */
let gateSettings: { activation: MicActivation; threshold: number; talkKey: string } | null = null;
let gate: MicGateState = MIC_GATE_CLOSED;
/** The last reading, or 0 when nothing is measuring. Never stale on purpose. */
let micLevel = 0;
let levelSource: MicLevelSource | null = null;
let stopWatchingGate: (() => void) | null = null;

function publishTalkHeld(next: boolean): void {
  if (talkHeld === next) return;
  talkHeld = next;
  for (const listener of listeners) listener();
}

/** What the gate should be, from the stored mode and the live facts. */
function evaluateGate(): void {
  const settings = gateSettings;
  const target = room;
  if (!settings || !target) return;
  const next = nextMicGate(gate, {
    activation: settings.activation,
    // The store's own value, which is what the interface is drawing. A mute
    // wins over every mode; `nextMicGate` is where that is decided.
    muted: state.micMuted,
    held: talkHeld,
    level: micLevel,
    threshold: settings.threshold,
    now: Date.now(),
  });
  const moved = next.open !== gate.open;
  // Assigned even when the answer did not move, because the tail's deadline
  // does: a version that only stored a change would restart the 400ms from the
  // last *transition* and cut a person off inside a sentence.
  gate = next;
  if (moved) void target.setMicrophoneOpen(next.open).catch(() => undefined);
}

/**
 * Start or stop the level source to match the mode.
 *
 * Only «По голосу» needs one, which is `micGateNeedsLevel`'s whole job: an
 * `AudioContext` and a 50ms timer running for a call in «Всегда» or «Рация»
 * would be a battery cost with nothing reading it.
 *
 * A browser that cannot measure — no `AudioContext`, or a graph that threw —
 * leaves the microphone **open**. For a call that is the safer failure: not
 * being heard at all reads as a broken microphone and is the thing a person
 * cannot diagnose, while a gate that did not engage is merely the behaviour
 * they had yesterday.
 */
function syncLevelSource(): void {
  const settings = gateSettings;
  const needed = Boolean(settings && micGateNeedsLevel(settings.activation));
  if (!needed) {
    levelSource?.close();
    levelSource = null;
    // Reset rather than kept: a loud reading from a minute ago must not open
    // the gate for the first 50ms of the next time this mode is chosen.
    micLevel = 0;
    return;
  }
  if (levelSource) return;
  const track = capture?.getAudioTracks()[0] ?? null;
  if (!track) return;
  levelSource = openMicLevelSource(track, (level) => {
    micLevel = level;
    evaluateGate();
  });
  if (!levelSource) {
    micLevel = 1;
    evaluateGate();
  }
}

/**
 * The talk key, and the releases that are not a keyup.
 *
 * **Capture phase**, like `MainLayout`'s own `keydown` listener and for the
 * same reason (D-194): Radix's `DismissableLayer` listens on `document` in the
 * capture phase and calls `preventDefault()` for any layer it has mounted, so a
 * bubble-phase listener here would find the press already spent whenever a
 * menu, a hint or a popover happened to be up. Nothing is prevented from here —
 * the key is left to do whatever it would have done, which for a key that
 * prints is to print.
 *
 * **The keyup is not guarded the way the keydown is.** A release always
 * releases: the modifier test and the text-field test both exist to stop a
 * press from talking, and applying either of them to a release is how a
 * microphone is left open. `micTalkKeyReleases` therefore asks only for the
 * code, and the four events below cover the releases that never arrive as a
 * keyup at all — a window losing focus to `Alt+Tab`, a pointer released
 * outside the button that was pressed, a tab going to the background.
 */
function watchTalkKey(): () => void {
  if (typeof window === "undefined") return () => undefined;

  const onKeyDown = (event: KeyboardEvent) => {
    const settings = gateSettings;
    // The mode test is a **cost** guard rather than a rule, and it is worth
    // saying so: `nextMicGate` ignores `held` in every mode but «Рация», so
    // removing this line changes no audio — it was mutated out on 2026-09-18
    // and every test stayed green. What it saves is a store notification, and
    // with it a render of the capsule and the call bar, on each press of that
    // key in a call that has no use for it.
    if (!settings || settings.activation !== "ptt") return;
    const target = event.target as HTMLElement | null;
    const tagName = target?.tagName;
    const editable = tagName === "INPUT" || tagName === "TEXTAREA" || Boolean(target?.isContentEditable);
    if (
      !micTalkKeyFires(
        {
          code: event.code,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          metaKey: event.metaKey,
          editable,
          repeat: event.repeat,
        },
        settings.talkKey,
      )
    ) {
      return;
    }
    holdVoiceTalk(true);
  };

  const onKeyUp = (event: KeyboardEvent) => {
    const settings = gateSettings;
    if (!settings) return;
    if (!micTalkKeyReleases(event.code, settings.talkKey)) return;
    holdVoiceTalk(false);
  };

  const release = () => {
    if (!talkHeld) return;
    holdVoiceTalk(false);
  };
  const onVisibility = () => {
    if (document.visibilityState === "hidden") release();
  };

  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("blur", release);
  window.addEventListener("pointerup", release);
  window.addEventListener("pointercancel", release);
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("blur", release);
    window.removeEventListener("pointerup", release);
    window.removeEventListener("pointercancel", release);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

/** The mode as it is right now, for a gate that is about to be applied. */
function readGateSettings(): { activation: MicActivation; threshold: number; talkKey: string } {
  const settings = getAudioSettings();
  return {
    activation: settings.micActivation,
    threshold: settings.micGateThreshold,
    talkKey: settings.micTalkKey,
  };
}

/**
 * Watch the mode for the length of one call.
 *
 * The mode can be changed **during** a call — the settings screen is the call's
 * settings screen, which is what `docs/proposals/2026-09-13-voice-channels.md`
 * says in as many words — so this listens to the same two events
 * `watchOutputDevice` does: the in-page custom event, and `storage` for a
 * change made in another tab.
 */
function watchMicrophoneGate(mine: number): void {
  // Only the listeners, never `forgetMicrophoneGate()`. The join has already
  // decided the opening state and pushed it at the transport; a full reset here
  // would put `gate` back to closed and the first evaluation would then push
  // the same answer a second time — measured on 2026-09-18 as `micOpen:
  // [true, true]` for a call in «Всегда», which is one redundant round trip per
  // call and a state the store and the seam briefly disagree about.
  stopWatchingGate?.();
  stopWatchingGate = null;
  if (typeof window === "undefined") return;
  const apply = () => {
    if (mine !== generation) return;
    gateSettings = readGateSettings();
    syncLevelSource();
    evaluateGate();
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === AUDIO_SETTINGS_STORAGE_KEY) apply();
  };
  window.addEventListener(AUDIO_SETTINGS_EVENT, apply);
  window.addEventListener("storage", onStorage);
  const stopKeys = watchTalkKey();
  stopWatchingGate = () => {
    window.removeEventListener(AUDIO_SETTINGS_EVENT, apply);
    window.removeEventListener("storage", onStorage);
    stopKeys();
  };
  apply();
}

/** Safe to call twice, during a join, and when there was never a call. */
function forgetMicrophoneGate(): void {
  stopWatchingGate?.();
  stopWatchingGate = null;
  levelSource?.close();
  levelSource = null;
  micLevel = 0;
  gate = MIC_GATE_CLOSED;
  gateSettings = null;
  publishTalkHeld(false);
}

/**
 * Hold the microphone open, or let it go.
 *
 * One function for the key and for the button, which is what makes the phone
 * and the computer the same feature rather than two: `VoiceCallCapsule` and
 * `VoiceCallBar` call it from a pointer, `watchTalkKey` calls it from a key,
 * and both release through the same path.
 */
export function holdVoiceTalk(down: boolean): void {
  publishTalkHeld(down);
  evaluateGate();
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
async function requestVoiceToken(channelId: string): Promise<{
  outcome: VoiceTokenOutcome;
  /**
   * The identity the gateway mints this token with, taken from the session this
   * request already reads. Carried out with the outcome rather than read again
   * somewhere else, so there is one answer to «who are we in this room» and it
   * comes from the same session the token does.
   */
  selfUserId: string | null;
}> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  const userId = data.session?.user?.id ?? null;
  if (!accessToken) return { outcome: { ok: false, code: "unauthenticated" }, selfUserId: userId };
  const answer = (outcome: VoiceTokenOutcome) => ({ outcome, selfUserId: userId });
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
    return answer(readVoiceTokenResponse(response.status, payload));
  } catch {
    return answer(readVoiceTokenResponse(0, null));
  }
}

function fail(refusal: string) {
  // Before anything else, so the last stage’s duration is the length of the
  // attempt rather than the length of the tidying that follows it.
  settleJournal();
  stopCapture();
  forgetOutputDevice();
  forgetMicrophoneGate();
  forgetSpeakers();
  room = null;
  mutedBeforeDeafened = false;
  selfUserId = null;
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
  // The journal is emptied here and nowhere else. A failure’s history has to
  // survive the failure — it is the evidence for the sentence the person was
  // shown — so the only thing that discards it is the next attempt.
  journal = VOICE_JOIN_JOURNAL_EMPTY;
  audioEverBlocked = false;
  enterStage("microphone");
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

  enterStage("token");
  const { outcome, selfUserId: identity } = await requestVoiceToken(request.channelId);
  if (mine !== generation) {
    stopCapture();
    return;
  }
  // Before the first roster can arrive, which is inside `opened.join` below.
  // The rule reads every roster that does not list us as a room we are not in,
  // so an identity that landed after the join would make the first reading of
  // this stay a roster of somebody else's room and lose the arrival.
  selfUserId = identity;
  if (!outcome.ok) {
    fail(voiceGatewayRefusalText(outcome.code));
    return;
  }

  enterStage("runtime");
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
      onSpeechAllowed: (allowed) => {
        if (mine !== generation) return;
        // Unknown is not a refusal. The SFU may simply not have said yet, and
        // treating the gap as `false` would accuse a moderator of something at
        // the start of every call.
        if (allowed === null) return;
        // Only a permission that the token was granted and the room now refuses
        // is a revocation. Without the second half, the listen-only grant —
        // which the capsule already states as «Только слушаете» — would be
        // reported as a moderator's doing.
        const revoked = !allowed && outcome.grant.canPublish;
        if (state.speechRevoked === revoked) return;
        // `micMuted` goes with it on the way in: the person is not being heard,
        // so a microphone control reading «on» would be the lie. It is left
        // alone on the way out, because a restored permission does not put the
        // track back — pressing the control is what does that, and that press
        // is the one thing that can also be `canPublish`-checked by the SFU.
        patch({ speechRevoked: revoked, micMuted: revoked ? true : state.micMuted });
      },
      onAudioBlocked: (blocked) => {
        if (mine !== generation) return;
        // Recorded before the guard below, because the sticky fact is the one a
        // report needs and the guard exists to suppress a **re-render**, not a
        // measurement: a refusal followed by a success is exactly the sequence
        // a press produces, and only the live flag should come back down.
        if (blocked) audioEverBlocked = true;
        // Guarded, because the SDK re-announces on every status change and an
        // unchanged patch would re-render every reader of the call.
        if (state.audioBlocked === blocked) return;
        patch({ audioBlocked: blocked });
      },
      // The two steps inside `room.connect()` that nothing above the transport
      // can tell apart. The journal refuses a stage that is not later than the
      // one running, which is what makes `SignalConnected` firing again after
      // every reconnect cost nothing here.
      onJoinStage: (stage) => {
        if (mine !== generation) return;
        enterStage(stage);
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
        settleJournal();
        stopCapture();
        forgetOutputDevice();
        forgetMicrophoneGate();
        forgetSpeakers();
        room = null;
        selfUserId = null;
        publish({ ...IDLE, phase: "failed", refusal: "Звонок прерван." });
      },
    });
  } catch {
    // The SDK's chunk failed to load — an offline reload, or a deploy that
    // removed the hashed file while the tab stayed open. The sentence is the
    // stage’s own, from the one place every stage’s sentence lives.
    fail(voiceJoinFailureText("runtime"));
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

  // The socket, and everything the transport itself announces after it. The
  // hook can see only the entry to this stage; `media` and `publish` arrive
  // through `onJoinStage` because they happen inside one await.
  enterStage("signal");
  try {
    // A token that may not publish still joins and still hears. What it must
    // not do is hand the SFU a track it would refuse, so the capture is
    // released here rather than held open with the microphone light on for a
    // stream nobody will ever receive.
    if (!outcome.grant.canPublish) {
      stopCapture();
      await opened.join(outcome.grant.url, outcome.grant.token, null);
    } else {
      // The gate's opening state, set **before** the join rather than after
      // it. A call in «Рация» that published first and closed second would be
      // audible for the length of one event loop, which is the one moment
      // nobody is watching for.
      gateSettings = readGateSettings();
      gate = nextMicGate(MIC_GATE_CLOSED, {
        activation: gateSettings.activation,
        muted: false,
        held: false,
        level: 0,
        threshold: gateSettings.threshold,
        now: Date.now(),
      });
      await opened.setMicrophoneOpen(gate.open);
      await opened.join(outcome.grant.url, outcome.grant.token, microphone);
    }
  } catch {
    void opened.leave().catch(() => undefined);
    if (mine !== generation) return;
    /**
     * The sentence that started all of this.
     *
     * It used to be «Не удалось подключиться к голосовому серверу» for every
     * way this await can reject, which is three different faults wearing one
     * coat: no socket, a socket with no peer connection behind it, and a peer
     * connection that would not take the microphone. The first sends a person
     * to their network, the second to a firewall or a media server, the third
     * nowhere at all — and the second is the one that actually happened.
     *
     * The stage the journal is holding is what tells them apart, because the
     * transport announced each boundary as it crossed it. A rejection before
     * any boundary was crossed is still `signal`, which is the honest answer:
     * the socket never came up.
     */
    fail(voiceJoinFailureText(voiceJoinCurrentStage(journal) ?? "signal"));
    return;
  }

  if (mine !== generation) {
    stopCapture();
    void opened.leave().catch(() => undefined);
    return;
  }

  room = opened;
  // The journal stops here, so the report of a call that connected carries the
  // length of each step rather than the age of the call.
  settleJournal();
  patch({ phase: "connected", canPublish: outcome.grant.canPublish, refusal: null });
  // The stored choice, reaching a call for the first time. After the patch, so
  // that a refusal lands on a capsule which already exists: a sentence about a
  // call has nowhere to appear while the capsule still says «Подключаемся…».
  watchOutputDevice(opened, mine);
  void applyOutputDevice(opened, getAudioSettings().selectedOutputDeviceId, mine);
  // The gate, for the length of the call: the level source if the mode needs
  // one, the talk key, and the watcher that follows a mode changed mid-call.
  // Only for a token that may publish — there is nothing to gate otherwise, and
  // the capture has already been released above.
  if (outcome.grant.canPublish) watchMicrophoneGate(mine);
}

/** Leave. Safe during a join, after a failure, and when there is no call at all. */
export async function leaveVoiceCall(): Promise<void> {
  // A cancel during a join is the one case where this does anything: it stops
  // the stage that was running at the moment «Отмена» was pressed, so the report
  // says how long it had been running rather than how long ago the call was.
  settleJournal();
  generation += 1;
  const open = room;
  room = null;
  stopCapture();
  forgetOutputDevice();
  forgetMicrophoneGate();
  forgetSpeakers();
  // After the publish below the driver has already answered the departure; this
  // only stops a stale identity being read into the next call's first roster.
  selfUserId = null;
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
    // The mute that deafening implies reaches the gate as well: an unmute on
    // the way back out must not leave a «Рация» call transmitting with nothing
    // held, and the seam's own re-application only knows the value this pushes.
    evaluateGate();
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
    // And the gate is re-evaluated against the new mute. On the way in it is
    // belt and braces — the SDK's own mute disables the track — and on the way
    // out it is the whole of the correctness: `setTrackMuted(false)` re-enables
    // the track, so a «Рация» call whose microphone was just turned back on has
    // to be closed again with nothing held.
    evaluateGate();
  } catch {
    patch({ micMuted: before });
    evaluateGate();
  }
}
