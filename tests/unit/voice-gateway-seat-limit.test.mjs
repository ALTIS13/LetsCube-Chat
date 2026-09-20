// How many people a voice channel admits.
//
// `supabase/functions/voice-gateway/seatLimit.mjs` is three small functions and
// they are the difference between the call the owner asked for («изначально
// ограничения быть не должно») and a cap nobody chose. They live in their own
// module for the reason `roomName.mjs` does: a decision inside a request
// handler cannot be mutation-tested, and this one has four readers that
// disagreed with each other until today.
//
// The end-to-end half is in `voice-gateway-routes.test.mjs`, which drives the
// real handler. What is pinned here is the arithmetic, including the two cases
// a route test cannot reach cheaply: a broken column, and a count that is not a
// number.
import assert from "node:assert/strict";
import test from "node:test";

import {
  VOICE_SEATS_LIVEKIT_CONFIG_MUST_BE_ZERO,
  VOICE_SEATS_PRIVATE_CHAT,
  VOICE_SEATS_UNLIMITED,
  liveKitMaxParticipants,
  readSeatLimit,
  seatsAreUnlimited,
  voiceChannelIsFull,
} from "../../supabase/functions/voice-gateway/seatLimit.mjs";

test("zero is «no limit», and it is the value the column now defaults to", () => {
  assert.equal(VOICE_SEATS_UNLIMITED, 0);
  assert.equal(seatsAreUnlimited(0), true);
  assert.equal(seatsAreUnlimited(2), false);
  assert.equal(seatsAreUnlimited(10), false);
});

test("a private chat's two is a definition, and it is written down as one", () => {
  // Discord answers «a third person is needed in a DM» with a group DM — a
  // different object — rather than with a wider DM. So this number is not a
  // capacity value and must never be lifted to make room for somebody.
  assert.equal(VOICE_SEATS_PRIVATE_CHAT, 2);
});

test("the column is read as a non-negative integer or not at all", () => {
  assert.equal(readSeatLimit(0), 0);
  assert.equal(readSeatLimit(10), 10);
  assert.equal(readSeatLimit("10"), 10);
  assert.equal(readSeatLimit(99), 99);

  // A negative number is a broken row and is **not** folded into «unlimited»:
  // reading corruption as an open door is how a cap disappears silently.
  assert.equal(readSeatLimit(-1), null);
  assert.equal(readSeatLimit(7.5), null);
  assert.equal(readSeatLimit(null), null);
  assert.equal(readSeatLimit(undefined), null);
  assert.equal(readSeatLimit(""), null);
  assert.equal(readSeatLimit("many"), null);
  assert.equal(readSeatLimit(Number.NaN), null);
  assert.equal(readSeatLimit(Number.POSITIVE_INFINITY), null);
});

test("an unlimited channel is never full, however many people are in it", () => {
  assert.equal(voiceChannelIsFull({ limit: 0, participantCount: 0 }), false);
  assert.equal(voiceChannelIsFull({ limit: 0, participantCount: 10 }), false);
  assert.equal(voiceChannelIsFull({ limit: 0, participantCount: 400 }), false);
});

test("a channel with a limit still refuses at it, which is the half that proves the cap was not simply deleted", () => {
  assert.equal(voiceChannelIsFull({ limit: 10, participantCount: 9 }), false);
  assert.equal(voiceChannelIsFull({ limit: 10, participantCount: 10 }), true);
  // Over the cap — which the reconciler can produce for a moment when a webhook
  // and a reconciliation disagree — is still full.
  assert.equal(voiceChannelIsFull({ limit: 10, participantCount: 11 }), true);

  // The private chat's two.
  assert.equal(voiceChannelIsFull({ limit: 2, participantCount: 1 }), false);
  assert.equal(voiceChannelIsFull({ limit: 2, participantCount: 2 }), true);
  assert.equal(voiceChannelIsFull({ limit: 2, participantCount: 3 }), true);
});

test("an unknown participant count admits, because the mirror lags a join", () => {
  // `participant_count` is the SFU's mirror and it is one webhook behind. This
  // is the shipped behaviour and it is deliberate: a deployment that cannot
  // count its participants must not stop taking calls, and the SFU's own
  // per-room cap is the enforcement that binds.
  assert.equal(voiceChannelIsFull({ limit: 10, participantCount: null }), false);
  assert.equal(voiceChannelIsFull({ limit: 10, participantCount: "many" }), false);
  assert.equal(voiceChannelIsFull({ limit: 10, participantCount: undefined }), false);

  // A limit that could not be read is not an admission decision at all — the
  // caller refuses on `readSeatLimit` returning null, before it gets here.
  assert.equal(voiceChannelIsFull({ limit: null, participantCount: 99 }), false);
});

test("the number goes to LiveKit unchanged, and the config it depends on is named in the source", () => {
  assert.equal(liveKitMaxParticipants(0), 0);
  assert.equal(liveKitMaxParticipants(10), 10);
  assert.equal(liveKitMaxParticipants(99), 99);

  // Measured against the production SFU on 2026-09-20: `CreateRoom` asking for
  // 0 came back holding 10, because 0 is proto3's zero value, an absent field
  // takes the config default, and the config said 10. So this module's 0 only
  // means «unbounded» while `livekit.yaml` carries `room.max_participants: 0`.
  // That dependency is greppable rather than only commented, and this pins the
  // string somebody would grep for.
  assert.equal(VOICE_SEATS_LIVEKIT_CONFIG_MUST_BE_ZERO, "room.max_participants: 0");
});
