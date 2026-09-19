import assert from "node:assert/strict";
import test from "node:test";

import {
  createVoiceAudioSink,
  VOICE_AUDIO_ELEMENT_CSS,
  VOICE_AUDIO_ELEMENT_MARK,
} from "../../artifacts/kub/src/lib/voiceAudioSink.ts";

/**
 * The elements a voice channel is heard through, and the leak they would be.
 *
 * **Why this file exists at all.** `tests/e2e/voice-call.spec.ts` replaces the
 * whole transport with `window.__letscubeVoiceRoom`, so an e2e green proves
 * nothing below the seam — and below the seam is where, from 2026-09-13 to
 * 2026-09-19, no remote audio track was ever attached to an element. LiveKit
 * does not attach for you: the SDK has no internal `attach()` call, and
 * `Room.startAudio()` only plays `track.attachedElements`. The product shipped
 * six days of voice channels in which nobody could hear anybody, and every test
 * was green because the only thing that could have caught it was a rule with no
 * home. This is the home.
 *
 * Everything here is driven with fakes, deliberately: the module names no
 * LiveKit value and touches no browser API, so `node --test` reaches every
 * branch including the two that only happen when something has already gone
 * wrong — a `detach` that throws, and a resubscribe with no unsubscribe.
 */

/** A document, reduced to the one question this module can get wrong. */
function fakeDocument() {
  const mounted = new Set();
  return {
    mounted,
    count: () => mounted.size,
    mount: (element) => {
      element.parent = mounted;
      mounted.add(element);
    },
  };
}

/**
 * A track, and a ledger of what was done to it.
 *
 * `detach` removes nothing from the document on purpose: that is exactly what
 * livekit-client's own `detach` does — it pauses the element and offers it to a
 * recycling pool that only accepts elements already out of the DOM — and the
 * bug this file guards is the belief that detaching is enough.
 */
function fakeTrack(kind = "audio", options = {}) {
  const track = {
    kind,
    attached: [],
    detached: [],
    attach() {
      const element = {
        attributes: {},
        style: { cssText: "" },
        parent: null,
        removed: false,
        setAttribute(name, value) {
          this.attributes[name] = value;
        },
        remove() {
          this.removed = true;
          if (this.parent) this.parent.delete(this);
          this.parent = null;
        },
      };
      track.attached.push(element);
      return element;
    },
    detach(element) {
      if (options.throwOnDetach) throw new Error("track already torn down");
      track.detached.push(element);
      return element;
    },
  };
  return track;
}

function sinkOn(doc, extra = {}) {
  return createVoiceAudioSink({ mount: doc.mount, audioKind: "audio", ...extra });
}

test("an audio track is attached, marked, put out of the layout and mounted", () => {
  const doc = fakeDocument();
  const sink = sinkOn(doc);
  const track = fakeTrack();

  sink.hear(track, "TR_one");

  assert.equal(track.attached.length, 1, "the track was never attached, which is the whole defect");
  assert.equal(doc.count(), 1, "the element was attached but never reached the document");
  const element = track.attached[0];
  assert.equal(element.attributes[VOICE_AUDIO_ELEMENT_MARK], "TR_one");
  assert.equal(element.style.cssText, VOICE_AUDIO_ELEMENT_CSS);
  assert.equal(sink.count(), 1);
});

test("the element is off screen rather than hidden, because a hidden one may be throttled", () => {
  // Read from the constant rather than restated, so the two cannot drift; what
  // is asserted is the property that matters and the two that must not appear.
  assert.match(VOICE_AUDIO_ELEMENT_CSS, /position:fixed/);
  assert.doesNotMatch(VOICE_AUDIO_ELEMENT_CSS, /display:\s*none/);
  assert.doesNotMatch(VOICE_AUDIO_ELEMENT_CSS, /visibility:\s*hidden/);
});

test("a track that is not audio is ignored entirely", () => {
  const doc = fakeDocument();
  const sink = sinkOn(doc);
  const video = fakeTrack("video");

  sink.hear(video, "TR_video");

  assert.equal(video.attached.length, 0);
  assert.equal(doc.count(), 0);
  assert.equal(sink.count(), 0);
});

test("the kind is compared against what the caller said audio is, never assumed", () => {
  // The seam passes `Track.Kind.Audio`. A sink built for a different vocabulary
  // must follow it, which is what keeps the LiveKit enum out of this module.
  const doc = fakeDocument();
  const sink = createVoiceAudioSink({ mount: doc.mount, audioKind: "AUDIO" });

  sink.hear(fakeTrack("audio"), "TR_lower");
  assert.equal(doc.count(), 0);

  sink.hear(fakeTrack("AUDIO"), "TR_upper");
  assert.equal(doc.count(), 1);
});

test("the volume is re-applied after the element exists, not before", () => {
  // The ordering is the point, and the case it saves is deafening.
  // `RemoteAudioTrack.attach` does re-apply a chosen loudness to a new element
  // — behind `if (this.elementVolume)`, and zero is falsy (livekit-client
  // 2.22.3). So silence is the one value an attach drops, and somebody who
  // deafened before a track arrived would hear that person at full volume.
  const doc = fakeDocument();
  const order = [];
  const sink = createVoiceAudioSink({
    mount: (element) => {
      order.push("mount");
      doc.mount(element);
    },
    audioKind: "audio",
    onMounted: () => {
      order.push("volumes");
    },
  });

  sink.hear(fakeTrack(), "TR_one");

  assert.deepEqual(order, ["mount", "volumes"]);
});

test("forgetting detaches the track AND takes the element out of the document", () => {
  // Two statements, and the second is the one the leak depends on. LiveKit's
  // `recycleElement` only takes an element whose `parentElement` is null, so an
  // element detached and left in the body is neither re-used nor released.
  const doc = fakeDocument();
  const sink = sinkOn(doc);
  const track = fakeTrack();

  sink.hear(track, "TR_one");
  const element = track.attached[0];
  sink.forget("TR_one");

  assert.deepEqual(track.detached, [element], "the track was never detached");
  assert.equal(element.removed, true, "the element was detached but left in the document");
  assert.equal(doc.count(), 0);
  assert.equal(sink.count(), 0);
});

test("a detach that throws still takes the element out of the document", () => {
  // The real case: `leave` disconnects, the SDK tears the media down, and a
  // detach afterwards throws rather than answering. The element must still go.
  const doc = fakeDocument();
  const sink = sinkOn(doc);
  const track = fakeTrack("audio", { throwOnDetach: true });

  sink.hear(track, "TR_one");
  const element = track.attached[0];
  assert.doesNotThrow(() => sink.forget("TR_one"));

  assert.equal(element.removed, true, "a throwing detach stranded the element in the document");
  assert.equal(doc.count(), 0);
  assert.equal(sink.count(), 0);
});

test("hearing the same sid twice replaces its element rather than stranding one", () => {
  // A resubscribe with no unsubscribe in between. Without the forget at the
  // head of `hear` the first element is lost: off the map, still in the
  // document, still holding a decoder, unreachable for ever.
  const doc = fakeDocument();
  const sink = sinkOn(doc);
  const first = fakeTrack();
  const second = fakeTrack();

  sink.hear(first, "TR_one");
  sink.hear(second, "TR_one");

  assert.equal(first.attached[0].removed, true, "the first element was stranded");
  assert.equal(doc.count(), 1);
  assert.equal(sink.count(), 1);
  assert.ok(doc.mounted.has(second.attached[0]));
});

test("forgetting something nobody is hearing is a no-op", () => {
  const doc = fakeDocument();
  const sink = sinkOn(doc);
  sink.hear(fakeTrack(), "TR_one");

  assert.doesNotThrow(() => sink.forget("TR_nothing"));
  assert.equal(doc.count(), 1, "an unknown sid removed somebody else's element");
});

test("forgetAll empties the document, and survives being called twice", () => {
  const doc = fakeDocument();
  const sink = sinkOn(doc);
  for (const sid of ["a", "b", "c"]) sink.hear(fakeTrack(), sid);
  assert.equal(doc.count(), 3);

  sink.forgetAll();
  assert.equal(doc.count(), 0, "leave left elements in the document");
  assert.equal(sink.count(), 0);

  assert.doesNotThrow(() => sink.forgetAll());
  assert.equal(doc.count(), 0);
});

test("the leak check: forty reconnect cycles leave nothing behind", () => {
  // Not a hypothetical number. Production is running a full reconnect roughly
  // every fifteen seconds — measured on the SFU on 2026-09-19, ~8 new RTC
  // sessions a minute across two participants — and each one resubscribes every
  // track under a **new** sid. Forty cycles is ten minutes of a call.
  const doc = fakeDocument();
  const sink = sinkOn(doc);
  let peak = 0;

  for (let cycle = 0; cycle < 40; cycle += 1) {
    const sids = [`TR_a${cycle}`, `TR_b${cycle}`];
    for (const sid of sids) sink.hear(fakeTrack(), sid);
    peak = Math.max(peak, doc.count());
    for (const sid of sids) sink.forget(sid);
  }

  assert.equal(peak, 2, "more elements were live at once than there were tracks");
  assert.equal(doc.count(), 0, "the reconnect cycle leaks an element per track per cycle");
  assert.equal(sink.count(), 0);
});

test("the leak check again, for the cycle that never unsubscribes", () => {
  // The harsher shape of the same ten minutes: the SDK tears the transport down
  // without an unsubscribe reaching us, so only `forgetAll` on the disconnect
  // and the forget at the head of `hear` stand between this and eighty
  // elements. Sids are reused here, which is what makes the head-forget the
  // thing being measured.
  const doc = fakeDocument();
  const sink = sinkOn(doc);

  for (let cycle = 0; cycle < 40; cycle += 1) {
    sink.hear(fakeTrack(), "TR_a");
    sink.hear(fakeTrack(), "TR_b");
    assert.ok(doc.count() <= 2, `held ${doc.count()} elements on cycle ${cycle}`);
  }

  sink.forgetAll();
  assert.equal(doc.count(), 0);
});
