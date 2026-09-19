/**
 * Where a voice channel becomes audible: the elements the room is heard
 * through, and their lifetime.
 *
 * **This existed nowhere until 2026-09-19, and that was the defect.** LiveKit
 * does not play a remote track for you. The SDK contains no internal `attach()`
 * call at all, and `Room.startAudio()` iterates `track.attachedElements` — with
 * none attached it plays nothing, for ever, while the connection panel reports
 * a perfect link because the transport really is perfect. Two people sat in a
 * channel hearing silence and every number on screen told them the call was
 * fine.
 *
 * It is also why three controls that looked implemented were no-ops.
 * `RemoteAudioTrack.setVolume` is `for (const el of this.attachedElements)`,
 * `setSinkId` is applied per element, and deafening is `setVolume(0)` — so
 * per-person volume, the chosen output device and deafen all reached an empty
 * list and returned having done nothing. None of that code changed; the
 * elements arriving is the whole fix.
 *
 * It imports nothing, on purpose, and it names no LiveKit value. The lesson is
 * in CLAUDE.md and again at the head of `lib/micGate.ts` and
 * `lib/callSounds.ts`: a decision inside `createLiveKitRoom` is a decision no
 * test can reach — `tests/e2e/voice-call.spec.ts` replaces that whole function
 * with a stand-in, so an e2e green proves nothing below the seam. Moving the
 * bookkeeping out is cheaper than building a harness around it, and
 * `tests/unit/voice-audio-sink.test.mjs` drives every path below with fakes,
 * the leak included.
 *
 * ## The two statements that are not one statement
 *
 * `Track.detach` pauses the element and offers it to the SDK's recycling pool,
 * and that pool only accepts an element whose `parentElement` is null
 * (`recycleElement`, livekit-client 2.22.3). An element detached but left in
 * the document is therefore neither re-used nor released — it just accumulates,
 * each one holding a decoder. That is not theoretical: production is running a
 * fifteen-second reconnect cycle right now, which republishes every track four
 * times a minute per person. So `forget` detaches **and** removes, in that
 * order, and removes even when the detach throws.
 *
 * ## Keyed by sid, and replacing rather than stacking
 *
 * `hear` calls `forget` on its own key first. A resubscribe that arrives
 * without an intervening unsubscribe then replaces its element instead of
 * stranding the previous one, which bounds the leak at one element per track
 * whatever order the SDK's events arrive in.
 */

/** A subscribed track, as the only thing that makes it audible needs to see it. */
export interface VoiceAudioTrack {
  /** Compared against the `audioKind` the sink was built with. Never assumed. */
  readonly kind: string;
  attach(): VoiceAudioElement;
  detach(element: VoiceAudioElement): unknown;
}

/**
 * An `HTMLMediaElement`, narrowed to what this module touches.
 *
 * `style.cssText` rather than eight property writes: one string is one
 * assertion in a test and one constant to read here, and the alternative types
 * a `CSSStyleDeclaration` that a fake would have to reproduce.
 */
export interface VoiceAudioElement {
  readonly style: { cssText: string };
  setAttribute(name: string, value: string): void;
  remove(): void;
}

/**
 * Off screen rather than `display: none` or `hidden`.
 *
 * A media element that is not rendered may be throttled or have its playback
 * de-prioritised by the browser, and this one is the conversation. One
 * transparent pixel in the corner is rendered, costs nothing, and cannot be
 * clicked.
 */
export const VOICE_AUDIO_ELEMENT_CSS =
  "position:fixed;left:-1px;top:-1px;width:1px;height:1px;opacity:0;pointer-events:none;";

/**
 * The attribute every element this module mounts carries.
 *
 * So the leak can be counted from the document itself — the thing that actually
 * accumulates — rather than only from this module's own map, which is the
 * bookkeeping being tested and therefore not evidence about itself.
 */
export const VOICE_AUDIO_ELEMENT_MARK = "data-kub-voice-audio";

export interface VoiceAudioSink {
  /** Start hearing one subscribed track. A non-audio track is ignored. */
  hear(track: VoiceAudioTrack, sid: string): void;
  /** Stop hearing one track, and take its element out of the document. */
  forget(sid: string): void;
  /** Every track. Used on leave and on a disconnect nobody asked for. */
  forgetAll(): void;
  /** How many elements are mounted right now. Zero is what a leave must reach. */
  count(): number;
}

export function createVoiceAudioSink(input: {
  /** Put the element in the document. The seam passes `document.body.append`. */
  readonly mount: (element: VoiceAudioElement) => void;
  /** What `track.kind` reads for audio. The seam passes `Track.Kind.Audio`. */
  readonly audioKind: string;
  /**
   * Called after an element is mounted, before `hear` returns.
   *
   * The seam passes `applyVolumes`, and it is load-bearing for one value in
   * particular. `RemoteAudioTrack.attach` does carry a chosen loudness onto a
   * new element — but behind `if (this.elementVolume)`, and **zero is falsy**
   * (livekit-client 2.22.3). So the one setting that does not survive an
   * attach is silence: somebody who deafened, or turned one person all the way
   * down, before that person's track arrived would hear them at full volume.
   * That is exactly the case `voice-room-seam.test.mjs` already has a rule for
   * — «somebody who joins while you are deafened arrives silent» — and until
   * there were elements at all, it was a rule about nothing.
   */
  readonly onMounted?: () => void;
}): VoiceAudioSink {
  const { mount, audioKind, onMounted } = input;
  const held = new Map<string, { track: VoiceAudioTrack; element: VoiceAudioElement }>();

  const forget = (sid: string) => {
    const one = held.get(sid);
    if (!one) return;
    // Removed from the map first, so a `detach` that throws cannot leave a key
    // pointing at an element that is already gone from the document.
    held.delete(sid);
    try {
      one.track.detach(one.element);
    } catch {
      // A track the SDK has already torn down throws rather than answering.
      // The element still has to leave the document, which is the next line —
      // and that line is the one the leak depends on.
    }
    one.element.remove();
  };

  return {
    hear(track, sid) {
      if (track.kind !== audioKind) return;
      forget(sid);
      const element = track.attach();
      element.setAttribute(VOICE_AUDIO_ELEMENT_MARK, sid);
      element.style.cssText = VOICE_AUDIO_ELEMENT_CSS;
      mount(element);
      held.set(sid, { track, element });
      onMounted?.();
    },
    forget,
    forgetAll() {
      // Over a copy of the keys: `forget` mutates the map it is iterating.
      for (const sid of [...held.keys()]) forget(sid);
    },
    count() {
      return held.size;
    },
  };
}
