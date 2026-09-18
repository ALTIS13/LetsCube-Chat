import assert from "node:assert/strict";
import test from "node:test";

import {
  chosenVoiceVolume,
  normalizeVoiceVolume,
  occupantMenuOffersSomething,
  readStoredVoiceVolumes,
  voiceVolumeLabel,
  voiceVolumeNotice,
  voiceVolumeOffer,
  voiceVolumesAfter,
  DEFAULT_VOICE_VOLUME,
  VOICE_VOLUME_STEP,
} from "../../artifacts/kub/src/lib/voiceVolume.ts";

/**
 * How loud one other person is, for this listener alone — every decision in it.
 *
 * Discord's per-user volume. What makes it worth a file of its own rather than
 * a few lines in `voice-channel.test.mts` is that three of these decisions are
 * measurements of something outside the interface and would each read as an
 * arbitrary choice to somebody simplifying them later: the 0..1 range is the
 * limit of `HTMLMediaElement.volume`, the refusal for a participant the room
 * carries under no microphone source is the behaviour of
 * `RemoteParticipant.setVolume`, and the refusal outside the current room is
 * the fact that nothing is subscribed there.
 *
 * `hooks/useVoiceVolume.ts` and the seam are deliberately not tested here: what
 * they do is touch `localStorage` and the live room, and both ask this module
 * what the answer is first.
 */

const ME = "11111111-1111-4111-8111-000000000001";
const ANNA = "11111111-1111-4111-8111-000000000002";
const PETR = "11111111-1111-4111-8111-000000000003";

const offer = (over = {}) =>
  voiceVolumeOffer({
    selfId: ME,
    target: { userId: ANNA, audioSource: "microphone" },
    ...over,
  });

test("the range stops at 1, because above it the element's own setter throws", () => {
  // Not a preference and not Discord's 200%. `createLiveKitRoom` builds its
  // `Room` without `webAudioMix` (default `false` in livekit-client 2.22.3), so
  // there is no `AudioContext` and `RemoteAudioTrack.setVolume` falls to
  // `el.volume = volume` — which throws `IndexSizeError` outside 0..1. A value
  // of 1.5 would therefore not be louder, it would be an exception thrown in
  // the middle of the loop that applies everybody's volume, taking the deafen
  // re-application down with it.
  assert.equal(normalizeVoiceVolume(1.5), 1);
  assert.equal(normalizeVoiceVolume(2), 1);
  assert.equal(normalizeVoiceVolume(-0.5), 0);
  assert.equal(normalizeVoiceVolume(0.4), 0.4);
  assert.equal(normalizeVoiceVolume(0), 0);
  // The step is finer than a finger and coarser than a pixel: twenty stops
  // under a keyboard's arrow keys.
  assert.ok(VOICE_VOLUME_STEP > 0 && VOICE_VOLUME_STEP <= 0.1);
});

test("a value nobody ever wrote is the default, never a silence", () => {
  // `Number(null)` and `Number("")` are both 0, and 0 is a volume — silence. So
  // a key that was never written, or a record with a blank in it, would arrive
  // as somebody having deliberately muted a person. Same trap
  // `lib/playbackVolume.ts` records for the media player.
  for (const empty of [null, undefined, "", "   ", {}, [], Number.NaN, Infinity, "loud"]) {
    assert.equal(
      normalizeVoiceVolume(empty),
      DEFAULT_VOICE_VOLUME,
      `«${String(empty)}» was read as a chosen volume`,
    );
  }
  assert.equal(DEFAULT_VOICE_VOLUME, 1);
});

test("a stored record is read, and anything that is not one is not guessed at", () => {
  const chosen = readStoredVoiceVolumes(JSON.stringify({ [ANNA]: 0.4, [PETR]: -3, third: 1.4 }));
  assert.equal(chosen.get(ANNA), 0.4);
  // Clamped, not dropped: a value below the floor is somebody deliberately
  // silenced and the choice survives as the silence it asked for.
  assert.equal(chosen.get(PETR), 0);
  // And above the ceiling there is nothing to remember: it clamps to the
  // default, which is what everybody untouched already gets.
  assert.equal(chosen.has("third"), false);

  for (const raw of [null, undefined, "", "not json", "[]", '"a string"', "12"]) {
    assert.equal(
      readStoredVoiceVolumes(raw).size,
      0,
      `«${String(raw)}» produced entries out of nothing`,
    );
  }

  // A record is not a place to keep facts about nobody: a blank key, a value
  // that is not a number, and a value already at the default are all dropped,
  // so what comes back is exactly the people who were turned down.
  const tidied = readStoredVoiceVolumes(
    JSON.stringify({ "": 0.2, [ANNA]: "why", [PETR]: 1, other: 0.25 }),
  );
  assert.deepEqual([...tidied], [["other", 0.25]]);
});

test("a volume put back to the default removes the entry rather than writing 1", () => {
  const first = voiceVolumesAfter(null, ANNA, 0.3);
  assert.deepEqual(first, { [ANNA]: 0.3 });

  const second = voiceVolumesAfter(JSON.stringify(first), PETR, 0);
  assert.deepEqual(second, { [ANNA]: 0.3, [PETR]: 0 });

  // Both read back the same afterwards; the difference is that the record does
  // not grow by a line for every person a listener ever touched and put back.
  const third = voiceVolumesAfter(JSON.stringify(second), ANNA, 1);
  assert.deepEqual(third, { [PETR]: 0 });
  assert.equal(Object.prototype.hasOwnProperty.call(third, ANNA), false);

  // And a value out of range is stored as the value that can be applied, not as
  // the one that was asked for.
  assert.deepEqual(voiceVolumesAfter(null, ANNA, 7), {});
  assert.deepEqual(voiceVolumesAfter(null, ANNA, -7), { [ANNA]: 0 });
});

test("one person's chosen volume, and the default for somebody never touched", () => {
  const chosen = new Map([[ANNA, 0.5]]);
  assert.equal(chosenVoiceVolume(chosen, ANNA), 0.5);
  assert.equal(chosenVoiceVolume(chosen, PETR), DEFAULT_VOICE_VOLUME);
  assert.equal(chosenVoiceVolume(chosen, null), DEFAULT_VOICE_VOLUME);
  assert.equal(chosenVoiceVolume(undefined, ANNA), DEFAULT_VOICE_VOLUME);
  // A stored 0 is a person deliberately silenced and must survive the read.
  assert.equal(chosenVoiceVolume(new Map([[ANNA, 0]]), ANNA), 0);
});

test("the volume is offered to everybody, which is a different gate from moderation", () => {
  // The whole point of the feature: no role is consulted anywhere in this
  // module. A plain member may turn an owner down, and neither the owner nor
  // anybody else is told.
  assert.equal(offer(), "adjustable");
  assert.equal(offer({ selfId: PETR }), "adjustable");
});

test("nobody sets their own volume, and an unknown reader is not compared", () => {
  // Your own voice is not carried back to you, so the control would have
  // nothing to act on; what changes how loud you are to others is a microphone
  // gain and lives in the sound settings.
  assert.equal(offer({ target: { userId: ME, audioSource: "microphone" } }), "not_offered");
  // «I am not sure whether this is you» fails closed, as it does in
  // `voiceModeration`: a reader with no id cannot be told from the target.
  assert.equal(offer({ selfId: null }), "not_offered");
});

test("a room whose audio is not arriving offers nothing, and the reading is what says so", () => {
  // The rail lists every room's occupants, and a slider under somebody in a
  // room this client is not receiving would store a number and move no audio —
  // the control that does nothing, one room over.
  //
  // What refuses it is `audioSource`, not a channel id. Outside a call, and in
  // every other room, the answer comes from `voice_participants`, which carries
  // presence and no publications at all — so the reading is `null`, and unknown
  // is a statement about this reader's information rather than about the
  // person. There *was* an `inThisRoom` parameter beside this; a mutation
  // forcing it true left every test green, because this check had already done
  // the work and does it more accurately — a channel id matches during a join
  // that has not connected, where nothing is subscribed yet.
  assert.equal(offer({ target: { userId: ANNA, audioSource: null } }), "not_offered");

  // And a reading this build has not been taught fails the same way rather than
  // falling through to «adjustable». Not hypothetical: a stand-in transport
  // that reports a roster without the field hands `undefined` here, and the
  // version of this rule that asked `=== null` read that as a reading and
  // offered the slider.
  for (const unknown of [undefined, "", "loud", 0, {}]) {
    assert.equal(
      offer({ target: { userId: ANNA, audioSource: unknown } }),
      "not_offered",
      `«${String(unknown)}» was acted on as a reading of how the room carries a voice`,
    );
  }
});

test("somebody the room carries under no microphone source is said so, not given a slider", () => {
  // The trap this feature is built on top of. `RemoteParticipant.setVolume`
  // finds its publication by source; every build before 2026-09-18 published
  // its capture as `Unknown`, so for those participants the call stores a value
  // in the SDK's own map and changes nothing at all — silently, with no error
  // anywhere. That is the one state the interface has to name.
  assert.equal(offer({ target: { userId: ANNA, audioSource: "unnamed" } }), "unreachable");

  // Carrying no audio yet is **not** that state: a listener the gateway refused
  // publication to, or a track that has not arrived. The SDK keeps a chosen
  // volume per participant and applies it when a microphone track is
  // subscribed, so a choice made now is not lost.
  assert.equal(offer({ target: { userId: ANNA, audioSource: "none" } }), "adjustable");
});

test("the two moments the control will not do what it looks like are both said out loud", () => {
  const OLD = "Изменить нельзя: участник подключился из старой версии приложения.";
  const DEAF = "Вы не слушаете канал — громкость применится, когда включите звук.";

  assert.equal(voiceVolumeNotice("unreachable", false), OLD);
  // Deafening is this listener's own and one press from being over; the old
  // build is about the person and lasts their whole session. So the second does
  // not hide the first.
  assert.equal(voiceVolumeNotice("unreachable", true), OLD);
  assert.equal(voiceVolumeNotice("adjustable", true), DEAF);
  // Nothing to say in the ordinary case: a sentence under every slider is a
  // sentence nobody reads when it matters.
  assert.equal(voiceVolumeNotice("adjustable", false), null);
  assert.equal(voiceVolumeNotice("not_offered", true), null);
});

test("a person turned all the way down is a word, not «0%»", () => {
  // Zero is a per-person silence, which is what a listener reaches for the
  // slider to do. A row of zeroes reads as a control that lost its value.
  assert.equal(voiceVolumeLabel(0), "Выключен");
  assert.equal(voiceVolumeLabel(1), "100%");
  assert.equal(voiceVolumeLabel(0.4), "40%");
  assert.equal(voiceVolumeLabel(0.05), "5%");
  // Junk is the default rather than a blank or a NaN reaching the screen.
  assert.equal(voiceVolumeLabel(Number.NaN), "100%");
});

test("a volume alone is worth opening the menu for; nothing at all is not", () => {
  // The rule that makes the occupant row pressable, in one place, so the row
  // and the menu cannot disagree about whether a press does anything.
  assert.equal(occupantMenuOffersSomething("adjustable", 0), true);
  // `unreachable` counts, and that is the deliberate part: the surface then
  // carries the sentence explaining it, and a reader who can find out why is
  // better off than one whose row simply does not respond.
  assert.equal(occupantMenuOffersSomething("unreachable", 0), true);
  assert.equal(occupantMenuOffersSomething("not_offered", 0), false);
  // A moderator outside the room still has their three items.
  assert.equal(occupantMenuOffersSomething("not_offered", 3), true);
});
