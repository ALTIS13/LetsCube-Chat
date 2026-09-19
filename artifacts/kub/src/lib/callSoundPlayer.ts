/**
 * The half of the sound that needs a browser.
 *
 * `lib/callSounds.ts` holds every rule — the cadence, the envelope, which sound
 * belongs to which state, when one must stop — and imports nothing, so
 * `node --test` can walk all of it. This file owns an `AudioContext` and owns
 * no rule at all. It is the same split `lib/micGate.ts` and `lib/micLevel.ts`
 * already have, for the same reason.
 *
 * ## Browsers will not sound anything until the page has been touched
 *
 * An `AudioContext` created on a page nobody has interacted with starts
 * `suspended`, and an incoming call is precisely the moment nobody has
 * interacted with anything. So:
 *
 *  - **the context is resumed on every gesture the application already
 *    receives** (`primeCallSoundsOnGesture`). A page somebody has used this
 *    session — opened a chat, typed a line, pressed anything — can ring;
 *  - **a refusal is recorded, never swallowed.** `callSoundReadiness()`
 *    answers `blocked`, the settings screen says so in words, and nothing
 *    anywhere claims a sound was made;
 *  - **the visual surface is the whole of the notice** regardless.
 *    `VoiceCallRing` is built so that a person who hears nothing still cannot
 *    miss the call, which is the other half of the same request.
 *
 * ### What was actually measured, 2026-09-18
 *
 * Under Playwright — the bundled Chromium and the real branded Chrome alike,
 * headless and headed — a context created before any gesture came back
 * **`running`**, its clock advanced, and `resume()` resolved. That is not
 * Chrome being permissive: `navigator.userActivation.hasBeenActive` was already
 * `true` on a page that had only been navigated to, because the automation
 * driver's own navigation counts as an activation. Adding
 * `--autoplay-policy=document-user-activation-required` explicitly changed
 * nothing, which is how it is known the probe could not have seen a block at
 * all rather than that there was none.
 *
 * So **the gate is not observable from this fixture**, and no test here claims
 * it. What is tested instead is the behaviour either way: `callSoundReadiness`
 * is driven from the context's own state after the attempt, and the fixture can
 * hand the player a context that refuses, through the DEV-only seam below.
 *
 * Expected elsewhere, stated as expectation rather than as measurement:
 * **Safari** is the strictest — it suspends on a gesture-less start and also
 * re-suspends when a tab is backgrounded, so a ring reaching a Safari tab that
 * has been idle since it was opened will be silent and visible; **the installed
 * Android app** is a WebView the person has necessarily tapped to reach the
 * conversation list, so the gesture is already spent and it should sound.
 * Neither is verified on a device, and both stay unverified until they are.
 */
import {
  CALL_SOUNDS,
  callSoundBursts,
  callSoundCycleMs,
  callSoundEnvelope,
  callSoundEnvelopeCurve,
  callSoundToneGain,
  callSoundTransition,
  type CallSoundBurst,
  type CallSoundName,
  type CallSoundSpec,
} from "./callSounds.ts";

/**
 * Whether anything can be heard, as three facts rather than a boolean.
 *
 * `unsupported` is a browser with no Web Audio at all and `blocked` is one that
 * has it and refused; the interface says different things about the two, and
 * collapsing them would make the sentence wrong for half its audience.
 */
export type CallSoundReadiness = "idle" | "running" | "blocked" | "unsupported";

type AudioContextCtor = typeof AudioContext;

/**
 * The seam, and it is an observation rather than an injection.
 *
 * `window.__letscubeVoiceRoom` lets a spec *replace* the SFU; this lets a spec
 * *read* what the player was asked to do, because a sound cannot be
 * photographed and «it rang» has to be provable as something other than a
 * screenshot. `__letscubeAudioContext` is the injection half, for the one thing
 * the fixture cannot otherwise produce: a context that refuses to resume.
 *
 * Both are gated on `import.meta.env.DEV`, like the voice-room seam and the
 * public-preview capture route, so a production bundle has no path to either:
 * the condition folds to `false` at build time and the branch is dropped.
 */
export interface CallSoundAsk {
  /** `Date.now()` when the player was asked. */
  readonly at: number;
  readonly ask: "prime" | "start" | "stop" | "once" | "stop-all";
  readonly sound: CallSoundName | null;
  /** What came of it. `same` means the player was already doing exactly this. */
  readonly outcome: CallSoundReadiness | "same";
  /** How many bursts were scheduled by this ask. Zero when nothing sounded. */
  readonly bursts: number;
}

export interface CallSoundLog {
  readonly asks: CallSoundAsk[];
  readiness: CallSoundReadiness;
  /** The sound the player believes it is making. */
  playing: CallSoundName | null;
  /**
   * How many oscillators are scheduled and not yet finished.
   *
   * The one thing `playing` cannot say. A stop that cleared the bookkeeping and
   * left the graph running would report `playing: null` and go on sounding for
   * the two cycles already scheduled ahead — which is six seconds of ringtone
   * after a call was declined, and exactly the defect «the ring must stop»
   * means. A test asserting this reaches zero is asserting silence rather than
   * a variable.
   */
  scheduled: number;
}

declare global {
  interface Window {
    __letscubeCallSounds?: CallSoundLog;
    __letscubeAudioContext?: AudioContextCtor;
  }
}

/**
 * How far ahead bursts are scheduled, as a multiple of the cadence.
 *
 * Two cycles, re-armed every one. A background tab's timers are clamped to
 * about a second, so the re-arm can be late; scheduling two cycles and
 * consuming one leaves a full cycle of margin before a gap could be heard.
 * Everything is scheduled against the context's own clock, so a late re-arm
 * moves nothing — it only risks running out, which the margin covers.
 */
const LOOKAHEAD_CYCLES = 2;

interface Voice {
  readonly osc: OscillatorNode;
  readonly gain: GainNode;
  /** Counted down exactly once, whether it ended or was stopped. */
  done: boolean;
}

interface Playing {
  readonly spec: CallSoundSpec;
  /** The context time the sound's own millisecond zero sits at. */
  readonly originSec: number;
  /** How far into the sound has already been scheduled. */
  cursorMs: number;
  timer: ReturnType<typeof setTimeout> | null;
  readonly voices: Set<Voice>;
}

let context: AudioContext | null = null;
let readiness: CallSoundReadiness = "idle";
let loop: Playing | null = null;
/**
 * The ring the state wants, whether or not the browser let it sound.
 *
 * The difference between this and `loop` is the whole point of the gesture
 * listener. A call arriving at a page nobody has touched is refused; the person
 * then touches the page — to look at the band, to switch conversation, to do
 * anything at all — and that gesture both resumes the context and starts the
 * ring that is still wanted. Without this the ring would wait for a re-render
 * that may not come for forty-five seconds.
 */
let wanted: CallSoundName | null = null;
/** Every one-shot in flight, so that a stop-all really stops everything. */
const oneShots = new Set<Playing>();
let gestureListenersInstalled = false;
/** Oscillators scheduled and not yet over. See `CallSoundLog.scheduled`. */
let scheduledVoices = 0;

function retire(voice: Voice): void {
  if (voice.done) return;
  voice.done = true;
  scheduledVoices = Math.max(0, scheduledVoices - 1);
}

function contextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  if (import.meta.env.DEV && window.__letscubeAudioContext) return window.__letscubeAudioContext;
  return (
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: AudioContextCtor }).webkitAudioContext ??
    null
  );
}

function log(): CallSoundLog | null {
  if (!import.meta.env.DEV || typeof window === "undefined") return null;
  if (!window.__letscubeCallSounds) {
    window.__letscubeCallSounds = { asks: [], readiness, playing: null, scheduled: 0 };
  }
  return window.__letscubeCallSounds;
}

function record(ask: CallSoundAsk["ask"], sound: CallSoundName | null, outcome: CallSoundAsk["outcome"], bursts: number): void {
  const held = log();
  if (!held) return;
  held.asks.push({ at: Date.now(), ask, sound, outcome, bursts });
  held.readiness = readiness;
  held.playing = loop?.spec.name ?? null;
  held.scheduled = scheduledVoices;
}

/** What the player knows about whether anything can be heard. */
export function callSoundReadiness(): CallSoundReadiness {
  return readiness;
}

/**
 * The looping sound the player is making, or none.
 *
 * Asked by the notification, which must not ping over a ringtone. Read from the
 * player rather than re-derived from the ring's state, deliberately: what
 * matters to that decision is whether something is **audible**, and a ring the
 * browser refused to start is not.
 */
export function playingCallSound(): CallSoundName | null {
  return loop?.spec.name ?? null;
}

/**
 * Open the context, or resume one a browser has suspended.
 *
 * Cheap to call as often as you like: a context already `running` is returned
 * without a promise's worth of work, which is what makes it safe on every
 * pointer event on the page.
 */
export async function primeCallSounds(): Promise<CallSoundReadiness> {
  const Ctor = contextCtor();
  if (!Ctor) {
    readiness = "unsupported";
    record("prime", null, readiness, 0);
    return readiness;
  }
  if (!context) {
    try {
      context = new Ctor();
    } catch {
      // A browser that has the constructor and refuses to build one — an
      // exhausted context budget is the real case, and Safari's is six.
      readiness = "unsupported";
      record("prime", null, readiness, 0);
      return readiness;
    }
  }
  if (context.state !== "running") {
    try {
      await context.resume();
    } catch {
      // Deliberately not rethrown and deliberately not ignored: `readiness`
      // below is read from the context's own state, so a refusal that resolved
      // and a refusal that threw reach the interface as the same fact.
    }
  }
  readiness = context.state === "running" ? "running" : "blocked";
  record("prime", null, readiness, 0);
  return readiness;
}

/**
 * Resume the context on any gesture the application already receives.
 *
 * Capturing and passive, on the window, and it never stops listening: a browser
 * may suspend a context again when the page has been in the background for a
 * while, so the second gesture has to be able to do what the first did. The
 * work is one comparison when the context is already running.
 *
 * Returns the removal, so the one component that installs it can take it away.
 */
export function primeCallSoundsOnGesture(): () => void {
  if (typeof window === "undefined" || gestureListenersInstalled) return () => {};
  gestureListenersInstalled = true;
  const wake = () => {
    if (context && context.state === "running") {
      // Already running and something is still wanted that never started: the
      // ring was refused before this gesture and the context has since come up
      // some other way. Cheap, and it is the only path that catches that.
      if (wanted !== null && loop === null) void resumeWantedRing();
      return;
    }
    void primeCallSounds().then((state) => {
      if (state === "running" && wanted !== null && loop === null) void resumeWantedRing();
    });
  };
  const events: (keyof WindowEventMap)[] = ["pointerdown", "keydown", "touchend"];
  for (const name of events) window.addEventListener(name, wake, { capture: true, passive: true });
  return () => {
    gestureListenersInstalled = false;
    for (const name of events) window.removeEventListener(name, wake, { capture: true });
  };
}

/**
 * One burst, as oscillators.
 *
 * Everything numeric here is asked of `lib/callSounds.ts` — which tones, what
 * level each of them gets, how the burst is shaped. The tones come from the
 * **burst** rather than from the spec, which is what lets a sound be two
 * different notes in sequence, and each tone's level comes from the tone, which
 * is what lets a note be an instrument rather than a test tone.
 *
 * ## Two ways to schedule one envelope, and why they are not the same way
 *
 * A **linear** decay is four automation calls, exactly as they were written on
 * 2026-09-18. They are left alone rather than folded into the curve below for a
 * reason that has nothing to do with sound: `silence` cancels a ring in flight,
 * and cancelling a value **curve** is the one case browsers disagree about.
 * The ring and the ringback are the only sounds that ever have to be stopped
 * mid-flight, they are the only ones that loop, and they are linear — so the
 * path that must never fail is the path that never changed.
 *
 * An **exponential** decay is one `setValueCurveAtTime` sampled from
 * `callSoundEnvelopeCurve`, so the shape exists once and the same function
 * renders the `.wav` files the owner judges. The trade is stated rather than
 * hidden: if `stopAllCallSounds` lands inside one of these — a tab being torn
 * down, a component unmounting — a browser may refuse to schedule over a
 * running curve and `silence`'s 20 ms fade will throw into its own catch. The
 * oscillator is still stopped 30 ms later, so the worst case is a click during
 * teardown on a sound that is at most 290 ms long. That is a better thing to
 * risk than two descriptions of the same envelope.
 */
function scheduleBurst(ctx: AudioContext, playing: Playing, atSec: number, burst: CallSoundBurst): void {
  const spec = playing.spec;
  const durationMs = burst.durationMs;
  const { attackMs, releaseMs } = callSoundEnvelope(spec, durationMs);
  const endSec = atSec + durationMs / 1000;
  const shape = spec.decay === "exponential" ? callSoundEnvelopeCurve(spec, durationMs) : null;
  for (const tone of burst.tones) {
    const peak = callSoundToneGain(spec, burst, tone);
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(tone.hz, atSec);
    const gain = ctx.createGain();
    if (shape) {
      // A fresh curve per tone: `setValueCurveAtTime` keeps a reference to the
      // array it is given, so one shared instance scaled in place would be the
      // same object at three different levels.
      const curve = new Float32Array(shape.length);
      for (let index = 0; index < shape.length; index += 1) curve[index] = shape[index] * peak;
      gain.gain.setValueCurveAtTime(curve, atSec, durationMs / 1000);
    } else {
      gain.gain.setValueAtTime(0, atSec);
      gain.gain.linearRampToValueAtTime(peak, atSec + attackMs / 1000);
      gain.gain.setValueAtTime(peak, endSec - releaseMs / 1000);
      gain.gain.linearRampToValueAtTime(0, endSec);
    }
    osc.connect(gain);
    gain.connect(ctx.destination);
    const voice: Voice = { osc, gain, done: false };
    playing.voices.add(voice);
    scheduledVoices += 1;
    osc.onended = () => {
      playing.voices.delete(voice);
      retire(voice);
      const held = log();
      if (held) held.scheduled = scheduledVoices;
      try {
        gain.disconnect();
        osc.disconnect();
      } catch {
        // Already torn down by `silence`. Disconnecting twice is not an error
        // worth telling anybody about.
      }
    };
    osc.start(atSec);
    osc.stop(endSec + 0.01);
  }
}

/** Schedule everything due in the lookahead window, and re-arm. */
function pump(ctx: AudioContext, playing: Playing): number {
  const cycle = callSoundCycleMs(playing.spec);
  const elapsedMs = (ctx.currentTime - playing.originSec) * 1000;
  const untilMs = elapsedMs + cycle * LOOKAHEAD_CYCLES;
  const bursts = callSoundBursts(playing.spec, { fromMs: playing.cursorMs, untilMs });
  for (const burst of bursts) {
    scheduleBurst(ctx, playing, playing.originSec + burst.atMs / 1000, burst);
  }
  playing.cursorMs = Math.max(playing.cursorMs, untilMs);
  if (playing.spec.loop && typeof setTimeout === "function") {
    playing.timer = setTimeout(() => {
      if (loop === playing) pump(ctx, playing);
    }, cycle);
  }
  return bursts.length;
}

/** Stop everything one sound has scheduled, now, without a click. */
function silence(playing: Playing): void {
  if (playing.timer !== null) {
    clearTimeout(playing.timer);
    playing.timer = null;
  }
  const ctx = context;
  const now = ctx ? ctx.currentTime : 0;
  for (const voice of [...playing.voices]) {
    try {
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
      // 20 ms rather than zero: a sine cut at full amplitude is a click, and a
      // click at the end of a call is the sound of something breaking.
      voice.gain.gain.linearRampToValueAtTime(0, now + 0.02);
      voice.osc.stop(now + 0.03);
    } catch {
      // A node already stopped, or one scheduled to start after the stop it has
      // just been given. Both are over, which is what was asked for.
    }
    retire(voice);
  }
  playing.voices.clear();
  const held = log();
  if (held) held.scheduled = scheduledVoices;
}

async function begin(name: CallSoundName): Promise<{ readiness: CallSoundReadiness; bursts: number }> {
  const state = await primeCallSounds();
  const ctx = context;
  if (state !== "running" || !ctx) return { readiness: state, bursts: 0 };
  const spec = CALL_SOUNDS[name];
  const playing: Playing = {
    spec,
    // A margin, so the first burst is scheduled rather than already late. Under
    // 30 ms nothing is perceptible and every node has a future start time,
    // which is the only kind a browser schedules exactly.
    originSec: ctx.currentTime + 0.02,
    cursorMs: 0,
    timer: null,
    voices: new Set(),
  };
  if (spec.loop) {
    loop = playing;
  } else {
    oneShots.add(playing);
    setTimeout(() => oneShots.delete(playing), callSoundCycleMs(spec) + 500);
  }
  const bursts = pump(ctx, playing);
  return { readiness: state, bursts };
}

/**
 * The ring, driven by state rather than by an event.
 *
 * Told what the ring **should** be sounding, not what just happened, and the
 * difference is the whole of «every path stops the sound»: a decline, an answer
 * on another device, an expiry, a hang-up, the row simply gone and the component
 * unmounting all arrive here as `null`, and none of them needs a handler of its
 * own. A missed event cannot leave a tone running, because there is no event.
 *
 * Idempotent on the sound it is already making, so a re-render does not restart
 * the cadence — a ring that restarted on every render would never reach its
 * second burst and would sound like a stutter rather than a telephone.
 */
export async function setVoiceRingSound(next: CallSoundName | null): Promise<void> {
  const move = callSoundTransition({ playing: loop?.spec.name ?? null, wanted: next });
  // Held whatever the browser says, so that the next gesture can start a ring
  // this one was refused. Set before anything is awaited: a stop that arrives
  // while a start is still resuming must win, and it does because this is the
  // value the resumed start is checked against.
  wanted = next;
  if (move.stop === null && move.start === null) {
    if (next !== null) record("start", next, "same", 0);
    return;
  }
  if (move.stop !== null && loop) {
    silence(loop);
    loop = null;
    record("stop", move.stop, readiness, 0);
  }
  if (move.start !== null) await startRing(move.start);
}

/**
 * Start one ring, and undo it if the state moved on while the context resumed.
 *
 * `primeCallSounds` is awaited, so between «start the ring» and the ring
 * existing there is a moment in which the call can be declined on another
 * device — §4a's ordinary case, not an edge. Without the check below that
 * decline would silence a ring that had not been created yet, and the create
 * would land afterwards on a call that is over.
 */
async function startRing(next: CallSoundName): Promise<void> {
  const outcome = await begin(next);
  if (wanted !== next && loop) {
    silence(loop);
    loop = null;
    record("stop", next, readiness, 0);
    return;
  }
  record("start", next, outcome.readiness, outcome.bursts);
}

/** Start the ring a gesture has just made possible, if it is still wanted. */
async function resumeWantedRing(): Promise<void> {
  const next = wanted;
  if (next === null || loop !== null) return;
  await startRing(next);
}

/**
 * One short sound, for something that has just happened. Never loops.
 *
 * A looping name is **refused** rather than special-cased: `begin` puts a
 * looping spec into `loop`, where the ring's state machine is the only thing
 * that ever takes it out again, so a `ring` started through this door would
 * sound until something unrelated stopped it. That is the single way a tone can
 * be left running in this module, and this is the door it would come through.
 */
export async function playCallSoundOnce(name: CallSoundName): Promise<void> {
  if (CALL_SOUNDS[name].loop) {
    record("once", name, "same", 0);
    return;
  }
  const outcome = await begin(name);
  record("once", name, outcome.readiness, outcome.bursts);
}

/** One short tone, for a notification. Never loops, whatever else is happening. */
export async function playNotificationSound(): Promise<void> {
  await playCallSoundOnce("notification");
}

/**
 * Stop every sound this module is making.
 *
 * For an unmount, and for the one case a state machine cannot see: the tab is
 * being torn down. Synchronous on purpose — `setVoiceRingSound(null)` awaits a
 * resume that a closing page may never finish.
 */
export function stopAllCallSounds(): void {
  wanted = null;
  if (loop) {
    silence(loop);
    loop = null;
  }
  for (const playing of [...oneShots]) silence(playing);
  oneShots.clear();
  record("stop-all", null, readiness, 0);
}

/** How many oscillators are scheduled and not yet over. */
export function scheduledCallSoundVoices(): number {
  return scheduledVoices;
}

/** For a test, and for nothing else: forget the context and everything playing. */
export function resetCallSoundsForTest(): void {
  stopAllCallSounds();
  context = null;
  readiness = "idle";
}
