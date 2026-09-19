import assert from "node:assert/strict";
import test from "node:test";

import {
  MIC_SILENCE_CLEAR,
  nextMicSilence,
  type MicSilenceState,
} from "../../artifacts/kub/src/lib/micSilence.ts";

/**
 * What a moderator's silence does to somebody's own microphone, measured
 * without a browser, an SFU or a React tree.
 *
 * The defect these hold: «Разрешить говорить» restored the permission and left
 * the person silent, because the SFU unpublishes on the way in and restores
 * nothing on the way out. The mechanism is in the header of
 * `lib/micSilence.ts`, read off livekit-client 2.22.3 and the LiveKit server's
 * own `SetPermission`.
 *
 * Every assertion below was watched go red under the mutation it exists for;
 * the mutations are named in the comments and listed in the report.
 */

/** The ordinary case: nobody has touched their own microphone. */
const SPEAKING = { muted: false, deafened: false };

test("a silence remembers the microphone it found, and the lift gives it back", () => {
  const down = nextMicSilence(MIC_SILENCE_CLEAR, { silenced: true, ...SPEAKING });
  // The interface must not draw a live microphone over audio the room has
  // stopped carrying, so the control goes to «выключен» whatever it said.
  //
  // Mutation: `muted: true` -> `muted: input.muted` on the silencing edge.
  assert.equal(down.muted, true);
  // And nothing is asked of the transport: the publication is already gone and
  // `VoiceRoom.setMuted` refuses while the permission is revoked, so a call
  // here would be a press no human made.
  assert.equal(down.tellTransport, false);
  assert.deepEqual(down.next, { silenced: true, mutedBefore: false });

  const up = nextMicSilence(down.next, { silenced: false, muted: true, deafened: false });
  // The whole defect, in one line: the microphone comes back on its own.
  //
  // Mutation: `tellTransport: muted !== input.muted` -> `false`. Under it the
  // state says «включён» and nothing is republished, which is the shipping
  // behaviour this test exists to refuse.
  assert.equal(up.muted, false);
  assert.equal(up.tellTransport, true);
  assert.deepEqual(up.next, MIC_SILENCE_CLEAR);
});

test("somebody who muted themselves first stays muted after the lift", () => {
  // The property the owner's instruction names: restoring a permission is not
  // consent to open somebody's microphone.
  const down = nextMicSilence(MIC_SILENCE_CLEAR, { silenced: true, muted: true, deafened: false });
  assert.deepEqual(down.next, { silenced: true, mutedBefore: true });

  const up = nextMicSilence(down.next, { silenced: false, muted: true, deafened: false });
  // Mutation: `mutedBefore: input.muted` -> `mutedBefore: false` on the
  // silencing edge. Under it this person's own press is discarded and the lift
  // puts them on the air.
  assert.equal(up.muted, true);
  // And nothing is republished: their next press of the microphone is what
  // does that, and `VoiceRoom.setMuted` already republishes on that path.
  //
  // Mutation: `tellTransport: muted !== input.muted` -> `true`. Under it the
  // transport is asked to unmute somebody who is still muted.
  assert.equal(up.tellTransport, false);
  assert.deepEqual(up.next, MIC_SILENCE_CLEAR);
});

test("a deafened person is not put back on the air by somebody else's press", () => {
  // Deafening already implies a mute — `setVoiceDeafened` holds that pair — and
  // a permission change nobody in this room asked for must not break it:
  // somebody who cannot hear the room cannot hear themselves being asked to
  // stop.
  const down = nextMicSilence(MIC_SILENCE_CLEAR, { silenced: true, ...SPEAKING });
  assert.deepEqual(down.next, { silenced: true, mutedBefore: false });

  const up = nextMicSilence(down.next, { silenced: false, muted: true, deafened: true });
  // Mutation: `input.deafened || prev.mutedBefore` -> `prev.mutedBefore`.
  // Under it this person was speaking before the silence, so the lift unmutes
  // them into a room they cannot hear.
  assert.equal(up.muted, true);
  assert.equal(up.tellTransport, false);
});

test("the same answer twice does not overwrite what is being held", () => {
  // The caller guards on the change, but the rule has to hold on its own: a
  // version that recomputed on every announcement would replace `mutedBefore`
  // with the `true` the first announcement had just forced, and the lift would
  // then restore a mute nobody pressed — the same defect wearing the opposite
  // coat.
  //
  // Mutation: drop the `input.silenced === prev.silenced` branch.
  const held: MicSilenceState = { silenced: true, mutedBefore: false };
  const again = nextMicSilence(held, { silenced: true, muted: true, deafened: false });
  assert.equal(again.next, held, "the held state is not even a new object");
  assert.equal(again.muted, true, "an unchanged answer leaves the mute exactly as it found it");
  assert.equal(again.tellTransport, false);

  // And the lift after it still restores what was true before the silence.
  const up = nextMicSilence(again.next, { silenced: false, muted: true, deafened: false });
  assert.equal(up.muted, false);
  assert.equal(up.tellTransport, true);
});

test("a call that was never silenced is left alone", () => {
  // Every announcement of the ordinary state reaches this, including the one
  // the transport makes at the end of a join.
  for (const muted of [false, true]) {
    const step = nextMicSilence(MIC_SILENCE_CLEAR, { silenced: false, muted, deafened: false });
    assert.equal(step.next, MIC_SILENCE_CLEAR);
    assert.equal(step.muted, muted);
    assert.equal(step.tellTransport, false);
  }
});
