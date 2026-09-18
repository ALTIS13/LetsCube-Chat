/**
 * How loud the microphone is right now, for the gate in `lib/micGate.ts`.
 *
 * Everything in this file is a browser fact. No rule lives here: the thresholds,
 * the hysteresis and the tail are all in `micGate.ts`, where `node --test` can
 * reach them, and this module answers one question — a number, several times a
 * second, from a capture that is already open.
 *
 * ## Why the analyser reads a **clone** of the track
 *
 * The gate closes the microphone by disabling the published `MediaStreamTrack`,
 * which is the quietest way to stop being heard: the publication stays, nobody
 * is told a mute they did not press, and the encoder stops sending. Measured on
 * 2026-09-18 against a loopback `RTCPeerConnection` with Chromium's fake
 * capture device: with the sender enabled, `media-source.audioLevel` reached
 * 0.99997 and 4902 bytes went out in two seconds; with the same track disabled,
 * `audioLevel` was 0 and 482 bytes went out — comfort noise, a tenth of the
 * bitrate. Re-enabled, 6382 bytes and the level back.
 *
 * And an `AnalyserNode` reading that same disabled track answers **0**, also
 * measured the same day: the live track read 0 while a clone of it, in the same
 * `AudioContext`, still read up to 0.99. A gate that measured the track it
 * closes would therefore close once and never open again — the level it needs
 * to reopen is exactly the level it has just destroyed.
 *
 * So the analyser reads `track.clone()`: the same hardware source, an
 * independent `enabled`, no second `getUserMedia` and no second permission
 * prompt. Stopping the clone does not stop the original (measured:
 * `readyState` stayed `live` and the level went on arriving), and stopping the
 * original does not stop the clone — which is why `close()` below stops its own
 * clone rather than leaving the capture alive with nothing reading it.
 *
 * ## Why a timer and not `requestAnimationFrame`
 *
 * `rAF` does not run for a hidden document — that is what it is specified to
 * do, not an implementation detail — and a gate driven by it would freeze in
 * whatever state it was in the moment somebody switched windows. A timer is
 * throttled in a hidden page (Chrome clamps a background page's timers to a
 * second, with documented exemptions for a page that is playing audio or
 * holding a WebRTC connection, both of which a call does) but it keeps
 * arriving, so the worst case is a gate that reacts late rather than one that
 * sticks. That clamping could not be measured here: Playwright's
 * `bringToFront` does not make another page hidden in this environment
 * (`document.hidden` stayed false in both headless and headed runs) and
 * `Emulation.setPageVisibilityOverride` no longer exists in the protocol. So it
 * is stated as the documented behaviour rather than as a measurement, and the
 * one failure that must not happen — a held talk key whose release is never
 * delivered — is closed by event rather than by clock: see
 * `MIC_TALK_RELEASE_EVENTS`.
 *
 * ## What one reading costs
 *
 * 6.6 microseconds, measured over 2000 polls in the same session — a copy of
 * 2048 bytes out of the analyser and one pass over them. At the 50 ms period
 * below that is 0.13 ms of main thread per second, which is 0.013% of one core.
 * The `AudioContext` itself is the real cost, which is why a call only opens one
 * when the mode needs it (`micGateNeedsLevel`) and closes it with the capture.
 */

/**
 * How often the level is read.
 *
 * 50 ms for two reasons that agree. A syllable is around 150 ms, so three
 * readings inside the shortest thing worth opening the gate for is the fewest
 * that can be called responsive; and each reading already covers 2048 samples,
 * which is 42.7 ms at 48 kHz, so a faster timer would mostly re-read audio it
 * had already seen. The peak over that window is the smoothing — there is no
 * separate filter, and none is needed, because a 42.7 ms peak does not flicker
 * the way an instantaneous sample does.
 */
export const MIC_LEVEL_PERIOD_MS = 50;

/** The analyser's window: 2048 samples, 42.7 ms at 48 kHz. */
export const MIC_LEVEL_WINDOW = 2048;

export interface MicLevelSource {
  /** Safe to call twice, and after the capture has already ended. */
  close(): void;
}

type AudioContextCtor = typeof AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  return (
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: AudioContextCtor }).webkitAudioContext ??
    null
  );
}

declare global {
  interface Window {
    /**
     * A DEV-only stand-in for the microphone's level, on the same terms as
     * `window.__letscubeVoiceRoom`.
     *
     * A spec cannot make a browser hear a voice. Chromium's fake capture device
     * is a pulse — measured: a peak of 0.0078 most of the time with a spike to
     * 1.0 about once a second — so a test that waited for the gate to open
     * would be waiting on a beep, and one that set a threshold to keep it shut
     * would be asserting against the same beep from the other side. With the
     * level replaceable, `tests/e2e/voice-call.spec.ts` can prove the whole
     * path that matters — mode, threshold, tail, mute — against the real
     * track's `enabled`, which is the thing a listener actually hears.
     *
     * Gated on `import.meta.env.DEV`, so the condition folds to `false` at
     * build time and a production bundle has no path to it.
     */
    __letscubeMicLevel?: (onLevel: (level: number) => void) => MicLevelSource;
  }
}

/**
 * Start reading the level of an open capture.
 *
 * `null` means this browser could not: no `AudioContext`, or a graph that threw
 * on construction. The caller must treat that as «no level available» rather
 * than as «silence» — `useVoiceCall` keeps the microphone open in that case,
 * because for a call, not being heard at all is a worse and far more confusing
 * failure than publishing a room the gate was supposed to hold back.
 */
export function openMicLevelSource(
  track: MediaStreamTrack,
  onLevel: (level: number) => void,
  periodMs: number = MIC_LEVEL_PERIOD_MS,
): MicLevelSource | null {
  if (import.meta.env.DEV && typeof window !== "undefined" && window.__letscubeMicLevel) {
    return window.__letscubeMicLevel(onLevel);
  }

  const Ctor = audioContextCtor();
  if (!Ctor) return null;

  let clone: MediaStreamTrack | null = null;
  let context: AudioContext | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  try {
    clone = track.clone();
    context = new Ctor();
    // The call starts from a press, so the document has sticky activation and
    // the context comes back `running` — measured in Chromium with
    // `--autoplay-policy=user-gesture-required`. `resume()` is here for the
    // case that is not true, which is a call restored without a gesture; a
    // suspended context runs no graph at all and its analyser reads silence,
    // which the gate would read as «nobody is talking».
    if (context.state === "suspended") void context.resume().catch(() => undefined);
    const analyser = context.createAnalyser();
    analyser.fftSize = MIC_LEVEL_WINDOW;
    context.createMediaStreamSource(new MediaStream([clone])).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    timer = setInterval(() => {
      analyser.getByteTimeDomainData(samples);
      let peak = 0;
      for (const sample of samples) {
        const distance = Math.abs(sample - 128);
        if (distance > peak) peak = distance;
      }
      onLevel(peak / 128);
    }, periodMs);
  } catch {
    if (timer !== null) clearInterval(timer);
    try {
      clone?.stop();
    } catch {
      /* a track that never started is not an error worth surfacing */
    }
    void context?.close().catch(() => undefined);
    return null;
  }

  let closed = false;
  return {
    close() {
      if (closed) return;
      closed = true;
      if (timer !== null) clearInterval(timer);
      timer = null;
      try {
        clone?.stop();
      } catch {
        /* already ended */
      }
      clone = null;
      // The context is what keeps an audio thread alive, so a call that ends
      // has to close it rather than drop it: a meter left running after a
      // conversation is a battery defect nobody can see.
      void context?.close().catch(() => undefined);
      context = null;
    },
  };
}
