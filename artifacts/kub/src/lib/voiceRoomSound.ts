/**
 * When a voice channel may make a sound.
 *
 * `lib/callSounds.ts` says what the four sounds **are**; this says when one may
 * fire. Written as its own module for the reason recorded at the head of that
 * one, of `lib/micGate.ts` and again in CLAUDE.md: a decision inside a
 * `"use client"` module is a decision with no test, and moving the decision is
 * cheaper than building a harness around it. This imports nothing, so
 * `node --test` walks all of it, and `tests/unit/voice-room-sound.test.mjs`
 * holds every rule below.
 *
 * ## Why it is a rule and not a handler
 *
 * The naive implementation hangs a join sound on «a participant appeared». Two
 * things measured on 2026-09-19 say that implementation would be unusable, and
 * neither of them is hypothetical.
 *
 * **A reconnect storm.** Until that afternoon `livekit-client` was restarting
 * its own session on a saved token — ~8 new RTC sessions a minute across two
 * participants, a median of 15–16 seconds between one participant's successive
 * sessions, and Kong logging 7 token requests against 92 new sessions, which is
 * how it is known the application was not re-joining. The server was moved to
 * `v1.13.7` for it (`docs/operations/voice.md`). But the class of fault is not
 * gone — a transport re-establishes whenever a network changes — and a sound
 * that fires four times a minute per person is worse than no sound at all. So:
 * **a reconnect re-baselines.** The first roster after the transport comes back
 * replaces what is known and sounds nothing. Whoever moved while the socket was
 * down did not move as far as anybody's ears are concerned.
 *
 * **Joining a populated channel.** Arriving where four people already sit must
 * not play four join sounds. So the first roster that contains **us** is a
 * baseline rather than a set of arrivals: only somebody who was absent from a
 * roster taken after our own join has arrived.
 *
 * ## The three answers that are judgement rather than measurement
 *
 * **You hear your own arrival, and your own departure.** Discord does, the
 * owner asked for that idiom, and there is a better reason than the idiom: this
 * product spent 2026-09-19 with a voice feature in which every check passed and
 * nobody could hear anybody, because a subscribed track was never attached to
 * anything that could play it. A sound at your own join is the cheapest
 * possible proof that the output path works at all — and the only proof that
 * the browser's autoplay gate let this page through, which it silently may not
 * have. It fires **once per stay**, never on a reconnect, because `inRoom` is
 * cleared only by leaving.
 *
 * **Several people arriving within a second make one sound.** Arrivals in one
 * reading collapse to a single `join`, and two sounds are never closer together
 * than `VOICE_SOUND_MIN_GAP_MS` — 400 ms, which is longer than any of the four
 * sounds, so nothing overlaps anything. A sound refused by that floor is
 * **dropped, not queued**: a queue would still rattle, only later, and the fact
 * it carries — «somebody came in» — has already been said.
 *
 * **A departure waits `VOICE_DEPARTURE_GRACE_MS` before it is believed.** The
 * re-baseline above covers *our* transport; this covers *theirs*. Somebody
 * whose client restarts vanishes from our roster and comes back a second later,
 * and without the grace that is a leave followed by a join for an event that
 * never happened. Coming back inside the grace cancels both, so a flap is
 * silent in both directions rather than noisy in one. The cost is named: a real
 * departure is announced 2.5 seconds late, which nobody can perceive as wrong
 * because nobody is holding a stopwatch against somebody else's exit.
 *
 * ## The setting
 *
 * There is already one, and this does not invent a second.
 * `AudioSettings.callSoundEnabled` — «Звуки → Звонок» — is the switch a person
 * who wants silence turns off, and a voice channel is a call. `enabled` below
 * is that value, read at the call site. The separate
 * `notificationSoundEnabled` stays what it is: somebody who wants a silent
 * office still wants their telephone to ring.
 *
 * There is no application-wide mute-all beyond those two switches, and none is
 * added here.
 */

/** The four sounds a voice channel may ask for. A subset of `CallSoundName`. */
export type VoiceRoomSoundName = "join" | "leave" | "mute" | "unmute";

/**
 * Where the transport is, which is the same question as «may the roster be
 * believed».
 *
 *  - `away` — the application is not trying to be in this room. Before a join,
 *    and after a leave. **Not** a transport that dropped;
 *  - `connected` — in the room, and the roster means what it says;
 *  - `reconnecting` — the transport is being re-established. The roster during
 *    this says nothing about anybody, and the first one after it is a baseline.
 *
 * A dropped call that the client is recovering from is `reconnecting`, never
 * `away`. That distinction is the whole difference between a storm that is
 * silent and a storm that plays a leave and a join on every cycle.
 */
export type VoiceRoomPhase = "away" | "connected" | "reconnecting";

/** Somebody last seen going, and when. Still inside the grace. */
export interface VoiceRoomDeparture {
  readonly userId: string;
  readonly atMs: number;
}

/** Everything the rule remembers between one reading of the room and the next. */
export interface VoiceRoomSoundState {
  /**
   * Whether we are, as far as sound is concerned, in the room.
   *
   * Set by the first `connected` roster that lists us, cleared only by `away`.
   * A reconnect does not touch it, which is what stops our own arrival sounding
   * again every time the socket comes back.
   */
  readonly inRoom: boolean;
  /** Who was in the room at the last trusted reading, sorted. */
  readonly present: readonly string[];
  /** Departures waiting out the grace, oldest first. */
  readonly leaving: readonly VoiceRoomDeparture[];
  /**
   * When the last sound was allowed.
   *
   * `-Infinity` rather than 0 so that the first sound of a session is never
   * refused by the floor. A zero would make the rule depend on how large the
   * clock's numbers happen to be, which is true of `Date.now()` and false of
   * every test that counts from nothing — a difference that would have hidden
   * here rather than in the behaviour.
   */
  readonly lastSoundAtMs: number;
  /** True from a reconnect until the next connected roster replaces what is known. */
  readonly rebaseline: boolean;
}

/** One reading of the room, as the surface can take it. */
export interface VoiceRoomReading {
  readonly phase: VoiceRoomPhase;
  /** Our own user id, or null before it is known. */
  readonly selfUserId: string | null;
  /** Everybody the room reports, ourselves included. Order is not read. */
  readonly userIds: readonly string[];
  readonly nowMs: number;
  /** `AudioSettings.callSoundEnabled`. Off means off, in every phase. */
  readonly enabled: boolean;
  /**
   * Whether this listener has stopped hearing the room.
   *
   * Suppresses every roster sound, our own arrival included. Somebody who
   * pressed «заглушить» asked not to hear the room, and another person walking
   * into it is the room. Their own control blips are a different question and
   * are not refused — see `voiceSelfControlSound`.
   */
  readonly deafened: boolean;
}

/** What to sound now, what to remember, and when to ask again unprompted. */
export interface VoiceRoomSoundDecision {
  readonly state: VoiceRoomSoundState;
  readonly sound: VoiceRoomSoundName | null;
  /**
   * When to call again with no new reading, or null.
   *
   * A departure matures on a clock rather than on an event — the roster does
   * not change again just because somebody stayed gone — so the caller has to
   * come back. Nothing else here needs waking.
   */
  readonly wakeAtMs: number | null;
}

/**
 * How long somebody has to stay gone before they have left.
 *
 * 2.5 seconds. A LiveKit session restart reconnects over UDP in well under a
 * second — 127 of 127 attempts on 2026-09-19 — so this clears a flap with
 * margin, and it is short enough that a real departure is not announced into a
 * conversation that has moved on.
 */
export const VOICE_DEPARTURE_GRACE_MS = 2_500;

/**
 * The shortest interval between two roster sounds.
 *
 * 400 ms, which is longer than the longest of the four (290 ms), so two of them
 * can never overlap. Four people arriving at once is one sound; four arriving
 * over a second is at most three.
 */
export const VOICE_SOUND_MIN_GAP_MS = 400;

/** Nothing known, nobody here, and no sound owed. */
export function voiceRoomSoundInitial(): VoiceRoomSoundState {
  return {
    inRoom: false,
    present: [],
    leaving: [],
    lastSoundAtMs: Number.NEGATIVE_INFINITY,
    rebaseline: false,
  };
}

/** When the oldest pending departure matures, or null. */
function wakeFor(state: VoiceRoomSoundState): number | null {
  let earliest: number | null = null;
  for (const entry of state.leaving) {
    if (earliest === null || entry.atMs < earliest) earliest = entry.atMs;
  }
  return earliest === null ? null : earliest + VOICE_DEPARTURE_GRACE_MS;
}

/** The floor and the two switches, applied in one place so none can be missed. */
function emit(
  state: VoiceRoomSoundState,
  sound: VoiceRoomSoundName,
  reading: VoiceRoomReading,
): VoiceRoomSoundDecision {
  const silent = { state, sound: null, wakeAtMs: wakeFor(state) } as const;
  if (!reading.enabled || reading.deafened) return silent;
  if (reading.nowMs - state.lastSoundAtMs < VOICE_SOUND_MIN_GAP_MS) return silent;
  const next = { ...state, lastSoundAtMs: reading.nowMs };
  return { state: next, sound, wakeAtMs: wakeFor(next) };
}

/**
 * What this reading of the room sounds, and what to remember.
 *
 * Driven by the roster rather than by events, for the reason the ring's sound
 * is driven by state: `VoiceRoomEvents.onParticipants` hands over **the whole
 * list, every time — never a diff**, so a missed message cannot leave the rule
 * believing in somebody who is not there. Everything below is a set difference
 * against the last list that was worth believing.
 *
 * At most one sound per call, and an arrival wins a tie with a departure: an
 * arrival is the thing the owner asked to hear, and a departure is the quieter
 * fact. The departure that lost is dropped rather than held, on the same
 * grounds as the floor — it has already been superseded by what the arrival
 * says about the room.
 */
export function voiceRoomSound(
  state: VoiceRoomSoundState,
  reading: VoiceRoomReading,
): VoiceRoomSoundDecision {
  if (reading.phase === "away") {
    // Our own departure. The only one this module learns from the absence of a
    // roster rather than from a difference between two of them.
    const wasIn = state.inRoom;
    const cleared: VoiceRoomSoundState = {
      ...voiceRoomSoundInitial(),
      lastSoundAtMs: state.lastSoundAtMs,
    };
    if (!wasIn) return { state: cleared, sound: null, wakeAtMs: null };
    return emit(cleared, "leave", reading);
  }

  if (reading.phase === "reconnecting") {
    // Nobody left because our socket did. Pending departures are dropped for
    // the same reason: one noticed a moment before a reconnect is the reconnect.
    return { state: { ...state, leaving: [], rebaseline: true }, sound: null, wakeAtMs: null };
  }

  const self = reading.selfUserId;
  const present = [...new Set(reading.userIds)].sort();
  if (self === null || !present.includes(self)) {
    // Connected, and the room has not listed us yet. Every roster before the
    // one containing us is a roster of a room we are not in — which is also
    // what makes «only arrivals after our own join are arrivals» true.
    return { state, sound: null, wakeAtMs: wakeFor(state) };
  }

  if (!state.inRoom) {
    // The first roster of this stay. Everybody already here was already here,
    // however many of them there are; the one arrival is our own.
    const baseline: VoiceRoomSoundState = {
      ...state,
      inRoom: true,
      present,
      leaving: [],
      rebaseline: false,
    };
    return emit(baseline, "join", reading);
  }

  if (state.rebaseline) {
    // The first roster after the transport came back. Silent whatever it says.
    return {
      state: { ...state, present, leaving: [], rebaseline: false },
      sound: null,
      wakeAtMs: null,
    };
  }

  const before = new Set(state.present);
  const here = new Set(present);
  // A person inside the grace who is back is a person who never left: their
  // pending departure is cancelled, and their return is not an arrival either.
  const returned = new Set(
    state.leaving.filter((entry) => here.has(entry.userId)).map((entry) => entry.userId),
  );
  let leaving = state.leaving.filter((entry) => !here.has(entry.userId));

  const arrivals = present.filter(
    (id) => id !== self && !before.has(id) && !returned.has(id),
  );
  for (const id of state.present) {
    if (id === self || here.has(id)) continue;
    if (leaving.some((entry) => entry.userId === id)) continue;
    leaving = [...leaving, { userId: id, atMs: reading.nowMs }];
  }

  const matured = leaving.filter(
    (entry) => reading.nowMs - entry.atMs >= VOICE_DEPARTURE_GRACE_MS,
  );
  if (matured.length > 0) leaving = leaving.filter((entry) => !matured.includes(entry));

  const next: VoiceRoomSoundState = { ...state, present, leaving };
  if (arrivals.length > 0) return emit(next, "join", reading);
  if (matured.length > 0) return emit(next, "leave", reading);
  return { state: next, sound: null, wakeAtMs: wakeFor(next) };
}

/**
 * The blip a control you pressed answers with.
 *
 * **Deafen and undeafen reuse these two sounds rather than getting their own**,
 * and that is a decision rather than an omission. The fact being confirmed is
 * the same in both cases — a control took effect — and it runs in the same
 * direction, something silenced or something restored. Two more pitches would
 * dilute a set that is deliberately two notes wide, and would ask a listener to
 * tell four near-identical blips apart by ear when the interface has already
 * told them apart with two unmistakable glyphs. The sound only has to say «the
 * press registered»; the screen says which press. Nobody asked for four.
 *
 * Not subject to the roster floor and not refused while deafened: this answers
 * something a person did a quarter of a second ago, and a press that produces
 * silence is the defect it exists to close. `enabled` still silences it — that
 * is the setting, and the setting is the one thing that means «no sounds».
 *
 * `previous === null` is the first reading rather than a change, and answers
 * nothing: joining a call already muted is a state, not a press.
 */
export function voiceSelfControlSound(input: {
  /** Whether the control is now in its silencing position. */
  readonly silenced: boolean;
  /** What it was, or null if this is the first reading of it. */
  readonly previous: boolean | null;
  /** `AudioSettings.callSoundEnabled`. */
  readonly enabled: boolean;
}): VoiceRoomSoundName | null {
  if (!input.enabled) return null;
  if (input.previous === null) return null;
  if (input.silenced === input.previous) return null;
  return input.silenced ? "mute" : "unmute";
}
