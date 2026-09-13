// The receipt side of `supabase/functions/voice-gateway`.
//
// Two independent things have to hold for a webhook to be acted on: the JWT is
// signed by the SFU's secret, and the body in front of us is the body that JWT
// was issued for. The second is the one that is easy to leave out and easy to
// believe is covered by the first, so it has its own tests, including a body
// that hashes to something else.
//
// The tokens below are built with node:crypto in the same shape LiveKit builds
// them — standard base64 for the `sha256` claim, HS256 over the compact
// serialization — so the verifier is checked against the real format rather
// than against its own output.
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";

import {
  decodeBase64Loose,
  decodeJwt,
  readBearerToken,
  readWebhookAuthToken,
  sha256Bytes,
  timingSafeEqualBytes,
  toHex,
  verifyLiveKitWebhookToken,
  webhookEventKey,
} from "../../supabase/functions/voice-gateway/webhookAuth.mjs";
import {
  epochSecondsToIso,
  HANDLED_VOICE_WEBHOOK_EVENTS,
  routeVoiceWebhookEvent,
} from "../../supabase/functions/voice-gateway/webhookEvents.mjs";
import { readUuid } from "../../supabase/functions/voice-gateway/roomName.mjs";

const API_KEY = "APIfixturekey";
const API_SECRET = "fixture-secret-not-a-production-value";
const CHANNEL_ID = "3f2a9c14-0e5b-4d7a-9b31-7c6d5e4f8a21";
const USER_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const NOW = 1_757_700_000;
const RECEIVED_AT = new Date(NOW * 1_000).toISOString();
const JOINED_SECONDS = 1_757_699_400;
const JOINED_AT = new Date(JOINED_SECONDS * 1_000).toISOString();

function bodyOf(event) {
  return new Uint8Array(Buffer.from(JSON.stringify(event), "utf8"));
}

function standardBase64Digest(bytes) {
  return createHash("sha256").update(bytes).digest("base64");
}

function livekitToken(options = {}) {
  const {
    apiKey = API_KEY,
    apiSecret = API_SECRET,
    issuer = apiKey,
    algorithm = "HS256",
    exp = NOW + 300,
    omitExpiry = false,
    nbf,
    bodyBytes,
    bodyHash,
    omitBodyHash = false,
    signature: forcedSignature,
  } = options;

  const header = Buffer.from(
    JSON.stringify({ alg: algorithm, typ: "JWT" }),
  ).toString("base64url");
  const claims = { iss: issuer };
  if (!omitExpiry) claims.exp = exp;
  if (nbf !== undefined) claims.nbf = nbf;
  if (!omitBodyHash) {
    claims.sha256 = bodyHash ?? standardBase64Digest(bodyBytes);
  }
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = forcedSignature ??
    createHmac("sha256", apiSecret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

const PARTICIPANT_JOINED = {
  event: "participant_joined",
  id: "EV_7pQm2Lx9RtVb",
  createdAt: String(NOW),
  room: { sid: "RM_abc", name: `vc_${CHANNEL_ID}`, numParticipants: 2 },
  participant: {
    sid: "PA_abc",
    identity: USER_ID,
    name: "Анна",
    state: "ACTIVE",
    joinedAt: String(JOINED_SECONDS),
  },
};

// ── the authorization header ─────────────────────────────────────────────────

test("a bearer header is read case-insensitively, or not at all", () => {
  assert.equal(readBearerToken("Bearer abc.def.ghi"), "abc.def.ghi");
  assert.equal(readBearerToken("  bearer   abc  "), "abc");
  for (const value of ["", "abc.def.ghi", "Basic abc", "Bearer", "Bearer   ", null, 7]) {
    assert.equal(readBearerToken(value), null, `accepted ${JSON.stringify(value)}`);
  }
});

test("the webhook header has no scheme at all, which is what LiveKit sends", () => {
  // Measured on the probe against LiveKit 1.8.4 on 2026-09-13: six deliveries,
  // every one of them `authorization: <compact JWS>` with no `Bearer` in front
  // of it. `readBearerToken` refuses that form, so the route that used it would
  // have answered 401 to every real webhook -- the product would have looked
  // like an SFU that never reports anything, with nothing in any log to say so.
  assert.equal(readWebhookAuthToken("abc.def.ghi"), "abc.def.ghi");
  assert.equal(readBearerToken("abc.def.ghi"), null);

  // A scheme is still accepted: the documentation describes one.
  assert.equal(readWebhookAuthToken("Bearer abc.def.ghi"), "abc.def.ghi");
  assert.equal(readWebhookAuthToken("  bearer   abc  "), "abc");

  for (const value of ["", "   ", "Basic abc", "Bearer", "Bearer   ", null, 7]) {
    assert.equal(
      readWebhookAuthToken(value),
      null,
      `accepted ${JSON.stringify(value)}`,
    );
  }
});

// ── the signature and the body hash ──────────────────────────────────────────

test("a webhook signed by the SFU over this exact body is accepted", async () => {
  const bodyBytes = bodyOf(PARTICIPANT_JOINED);
  const result = await verifyLiveKitWebhookToken(livekitToken({ bodyBytes }), {
    apiKey: API_KEY,
    apiSecret: API_SECRET,
    bodyBytes,
    nowSeconds: NOW,
  });

  assert.equal(result.ok, true);
  assert.equal(result.claims.iss, API_KEY);
});

test("a body that hashes to something else is refused", async () => {
  const signedFor = bodyOf(PARTICIPANT_JOINED);
  const token = livekitToken({ bodyBytes: signedFor });

  // The classic replay: a genuine, unexpired, correctly signed header put in
  // front of a payload that would evict someone from a call they are in.
  const tampered = bodyOf({
    ...PARTICIPANT_JOINED,
    event: "participant_left",
  });
  const result = await verifyLiveKitWebhookToken(token, {
    apiKey: API_KEY,
    apiSecret: API_SECRET,
    bodyBytes: tampered,
    nowSeconds: NOW,
  });

  assert.deepEqual(result, { ok: false, error: "body_hash_mismatch" });
});

test("a single flipped byte in the body is refused", async () => {
  const bodyBytes = bodyOf(PARTICIPANT_JOINED);
  const token = livekitToken({ bodyBytes });
  const altered = Uint8Array.from(bodyBytes);
  altered[altered.length - 2] ^= 0x01;

  const result = await verifyLiveKitWebhookToken(token, {
    apiKey: API_KEY,
    apiSecret: API_SECRET,
    bodyBytes: altered,
    nowSeconds: NOW,
  });
  assert.equal(result.error, "body_hash_mismatch");
});

test("the body hash is accepted in either base64 alphabet", async () => {
  const bodyBytes = bodyOf(PARTICIPANT_JOINED);
  const urlSafe = standardBase64Digest(bodyBytes)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  const result = await verifyLiveKitWebhookToken(
    livekitToken({ bodyBytes, bodyHash: urlSafe }),
    { apiKey: API_KEY, apiSecret: API_SECRET, bodyBytes, nowSeconds: NOW },
  );
  assert.equal(result.ok, true);
});

test("a webhook with no body hash at all is refused", async () => {
  const bodyBytes = bodyOf(PARTICIPANT_JOINED);
  const result = await verifyLiveKitWebhookToken(
    livekitToken({ bodyBytes, omitBodyHash: true }),
    { apiKey: API_KEY, apiSecret: API_SECRET, bodyBytes, nowSeconds: NOW },
  );
  assert.deepEqual(result, { ok: false, error: "missing_body_hash" });
});

test("an unsigned or differently signed token is refused", async () => {
  const bodyBytes = bodyOf(PARTICIPANT_JOINED);
  const context = {
    apiKey: API_KEY,
    apiSecret: API_SECRET,
    bodyBytes,
    nowSeconds: NOW,
  };

  const wrongSecret = livekitToken({ bodyBytes, apiSecret: "not-the-secret" });
  assert.equal((await verifyLiveKitWebhookToken(wrongSecret, context)).error, "bad_signature");

  const wrongIssuer = livekitToken({ bodyBytes, issuer: "APIsomeoneelse" });
  assert.equal((await verifyLiveKitWebhookToken(wrongIssuer, context)).error, "unknown_issuer");

  // `alg: none` with an empty signature is not a token this verifier will even
  // parse; with a non-empty one it dies on the algorithm.
  const algNone = livekitToken({ bodyBytes, algorithm: "none", signature: "" });
  assert.equal((await verifyLiveKitWebhookToken(algNone, context)).error, "malformed_token");
  const algNoneSigned = livekitToken({ bodyBytes, algorithm: "none" });
  assert.equal(
    (await verifyLiveKitWebhookToken(algNoneSigned, context)).error,
    "unsupported_algorithm",
  );

  // Algorithm confusion: claim RS256, sign with the HMAC anyway.
  const confused = livekitToken({ bodyBytes, algorithm: "RS256" });
  assert.equal(
    (await verifyLiveKitWebhookToken(confused, context)).error,
    "unsupported_algorithm",
  );
});

test("an expired or not-yet-valid token is refused outside the leeway", async () => {
  const bodyBytes = bodyOf(PARTICIPANT_JOINED);
  const context = {
    apiKey: API_KEY,
    apiSecret: API_SECRET,
    bodyBytes,
    nowSeconds: NOW,
  };

  const expired = livekitToken({ bodyBytes, exp: NOW - 31 });
  assert.equal((await verifyLiveKitWebhookToken(expired, context)).error, "expired");
  const justExpired = livekitToken({ bodyBytes, exp: NOW - 29 });
  assert.equal((await verifyLiveKitWebhookToken(justExpired, context)).ok, true);

  const future = livekitToken({ bodyBytes, nbf: NOW + 31 });
  assert.equal((await verifyLiveKitWebhookToken(future, context)).error, "not_yet_valid");

  const noExpiry = livekitToken({ bodyBytes, omitExpiry: true });
  assert.equal((await verifyLiveKitWebhookToken(noExpiry, context)).error, "missing_expiry");
});

test("a malformed token or a missing key is refused before any hashing", async () => {
  const bodyBytes = bodyOf(PARTICIPANT_JOINED);
  const context = {
    apiKey: API_KEY,
    apiSecret: API_SECRET,
    bodyBytes,
    nowSeconds: NOW,
  };
  for (const value of ["", "a.b", "a.b.c.d", "....", "not a token", "%%%.%%%.%%%", null]) {
    const result = await verifyLiveKitWebhookToken(value, context);
    assert.equal(result.ok, false, `accepted ${JSON.stringify(value)}`);
  }
  const configured = await verifyLiveKitWebhookToken(livekitToken({ bodyBytes }), {
    ...context,
    apiSecret: "",
  });
  assert.deepEqual(configured, { ok: false, error: "not_configured" });
});

test("base64 decoding and the constant-time compare behave", () => {
  assert.deepEqual(Array.from(decodeBase64Loose("AQID")), [1, 2, 3]);
  assert.deepEqual(Array.from(decodeBase64Loose("AQI=")), [1, 2]);
  assert.deepEqual(Array.from(decodeBase64Loose("AQI")), [1, 2]);
  assert.equal(decodeBase64Loose("A"), null);
  assert.equal(decodeBase64Loose(""), null);
  assert.equal(decodeBase64Loose(null), null);

  assert.equal(timingSafeEqualBytes(Uint8Array.of(1, 2), Uint8Array.of(1, 2)), true);
  assert.equal(timingSafeEqualBytes(Uint8Array.of(1, 2), Uint8Array.of(1, 3)), false);
  assert.equal(timingSafeEqualBytes(Uint8Array.of(1), Uint8Array.of(1, 2)), false);
  assert.equal(timingSafeEqualBytes(null, Uint8Array.of(1)), false);
});

test("the digest helper agrees with node's own sha256", async () => {
  const bytes = bodyOf(PARTICIPANT_JOINED);
  assert.equal(toHex(await sha256Bytes(bytes)), createHash("sha256").update(bytes).digest("hex"));
  const decoded = decodeJwt(livekitToken({ bodyBytes: bytes }));
  assert.equal(decoded.ok, true);
  assert.equal(decoded.header.alg, "HS256");
  assert.equal(decoded.payload.iss, API_KEY);
});

// ── the idempotency key ──────────────────────────────────────────────────────

test("LiveKit's event id is not a uuid, and is mapped onto one deterministically", async () => {
  const bodyBytes = bodyOf(PARTICIPANT_JOINED);
  // This is the actual shape LiveKit emits: `EV_` and twelve base62 characters.
  assert.equal(readUuid("EV_7pQm2Lx9RtVb"), null);

  const key = await webhookEventKey("EV_7pQm2Lx9RtVb", bodyBytes);
  assert.equal(readUuid(key), key, "the derived key must be a usable uuid");
  assert.equal(await webhookEventKey("EV_7pQm2Lx9RtVb", bodyBytes), key);
  assert.notEqual(await webhookEventKey("EV_differentevent", bodyBytes), key);
  // The key is the event's, not the body's: a retry with a re-serialized body
  // still dedupes.
  assert.equal(
    await webhookEventKey("EV_7pQm2Lx9RtVb", bodyOf({ ...PARTICIPANT_JOINED, extra: 1 })),
    key,
  );
});

test("an id that already is a uuid passes through unchanged", async () => {
  const bodyBytes = bodyOf(PARTICIPANT_JOINED);
  assert.equal(await webhookEventKey(CHANNEL_ID, bodyBytes), CHANNEL_ID);
  assert.equal(await webhookEventKey(`  ${CHANNEL_ID.toUpperCase()} `, bodyBytes), CHANNEL_ID);
});

test("an event with no id falls back to the body, so a byte-identical retry dedupes", async () => {
  const first = await webhookEventKey(undefined, bodyOf(PARTICIPANT_JOINED));
  assert.equal(readUuid(first), first);
  assert.equal(await webhookEventKey(undefined, bodyOf(PARTICIPANT_JOINED)), first);
  assert.equal(await webhookEventKey("", bodyOf(PARTICIPANT_JOINED)), first);
  assert.notEqual(
    await webhookEventKey(undefined, bodyOf({ ...PARTICIPANT_JOINED, id: "EV_other" })),
    first,
  );
});

// ── routing ──────────────────────────────────────────────────────────────────

test("a participant joining becomes one upsert with the SFU's own joined_at", () => {
  const routed = routeVoiceWebhookEvent(PARTICIPANT_JOINED, { receivedAt: RECEIVED_AT });
  assert.deepEqual(routed, {
    ok: true,
    action: "rpc",
    event: "participant_joined",
    channelId: CHANNEL_ID,
    rpc: "voice_participant_joined",
    args: {
      p_channel_id: CHANNEL_ID,
      p_user_id: USER_ID,
      p_joined_at: JOINED_AT,
    },
  });
});

test("a participant leaving carries the session's joined_at, never the receipt time", () => {
  const routed = routeVoiceWebhookEvent(
    { ...PARTICIPANT_JOINED, event: "participant_left", id: "EV_left" },
    { receivedAt: RECEIVED_AT },
  );

  assert.equal(routed.rpc, "voice_participant_left");
  assert.equal(routed.args.p_joined_at, JOINED_AT);
  // Section 3.6: a `left` stamped "now" would always beat the row a newer
  // session wrote, and would delete a participant who is sitting in the room.
  assert.notEqual(routed.args.p_joined_at, RECEIVED_AT);
});

test("a participant event with no joined_at is refused rather than defaulted", () => {
  for (const event of ["participant_joined", "participant_left"]) {
    for (const joinedAt of [undefined, null, 0, "0", "", "yesterday", -1, 1_700]) {
      const routed = routeVoiceWebhookEvent(
        {
          ...PARTICIPANT_JOINED,
          event,
          participant: { ...PARTICIPANT_JOINED.participant, joinedAt },
        },
        { receivedAt: RECEIVED_AT },
      );
      assert.deepEqual(
        routed,
        { ok: false, error: "invalid_joined_at" },
        `${event} accepted ${JSON.stringify(joinedAt)}`,
      );
    }
  }
});

test("joined_at is read as a protojson string or as a number, identically", () => {
  const asNumber = routeVoiceWebhookEvent(
    {
      ...PARTICIPANT_JOINED,
      participant: { ...PARTICIPANT_JOINED.participant, joinedAt: JOINED_SECONDS },
    },
    { receivedAt: RECEIVED_AT },
  );
  assert.equal(asNumber.args.p_joined_at, JOINED_AT);
});

test("a participant whose identity is not a user id is refused", () => {
  for (const identity of [undefined, "", "anonymous", "EV_x", 42, `${USER_ID}x`]) {
    const routed = routeVoiceWebhookEvent(
      {
        ...PARTICIPANT_JOINED,
        participant: { ...PARTICIPANT_JOINED.participant, identity },
      },
      { receivedAt: RECEIVED_AT },
    );
    assert.deepEqual(
      routed,
      { ok: false, error: "invalid_identity" },
      `accepted ${JSON.stringify(identity)}`,
    );
  }
});

test("room_started marks the channel active from the room's creation time", () => {
  const started = {
    event: "room_started",
    id: "EV_started",
    createdAt: String(NOW),
    room: { name: `vc_${CHANNEL_ID}`, creationTime: String(JOINED_SECONDS) },
  };
  assert.deepEqual(routeVoiceWebhookEvent(started, { receivedAt: RECEIVED_AT }), {
    ok: true,
    action: "rpc",
    event: "room_started",
    channelId: CHANNEL_ID,
    rpc: "voice_channel_set_active",
    args: { p_channel_id: CHANNEL_ID, p_active_since: JOINED_AT },
  });

  // Without a creation time it falls back to the event, then to receipt — never
  // to null, which would clear the very thing it is meant to set.
  const noCreation = routeVoiceWebhookEvent(
    { ...started, room: { name: `vc_${CHANNEL_ID}` } },
    { receivedAt: RECEIVED_AT },
  );
  assert.equal(noCreation.args.p_active_since, new Date(NOW * 1_000).toISOString());
  const nothing = routeVoiceWebhookEvent(
    { event: "room_started", room: { name: `vc_${CHANNEL_ID}` } },
    { receivedAt: RECEIVED_AT },
  );
  assert.equal(nothing.args.p_active_since, RECEIVED_AT);
});

test("room_finished clears active_since with a literal null", () => {
  const routed = routeVoiceWebhookEvent(
    {
      event: "room_finished",
      id: "EV_finished",
      createdAt: String(NOW),
      room: { name: `vc_${CHANNEL_ID}`, creationTime: String(JOINED_SECONDS) },
    },
    { receivedAt: RECEIVED_AT },
  );
  assert.equal(routed.rpc, "voice_channel_set_active");
  assert.equal(routed.args.p_active_since, null);
  assert.equal("p_user_id" in routed.args, false);
});

test("only the four events of layer 2 reach the database", () => {
  assert.deepEqual(HANDLED_VOICE_WEBHOOK_EVENTS, [
    "room_started",
    "room_finished",
    "participant_joined",
    "participant_left",
  ]);
  for (
    const event of [
      "track_published",
      "track_unpublished",
      "egress_started",
      "ingress_ended",
      "participant_joined_v2",
      "PARTICIPANT_JOINED",
    ]
  ) {
    const routed = routeVoiceWebhookEvent(
      { ...PARTICIPANT_JOINED, event },
      { receivedAt: RECEIVED_AT },
    );
    assert.deepEqual(routed, {
      ok: true,
      action: "ignore",
      event,
      reason: "unhandled_event",
    });
  }
});

test("a room that is not a voice channel is ignored, not guessed at", () => {
  for (const name of ["scratch", "vc_", `vc_${CHANNEL_ID}-2`, CHANNEL_ID, undefined, 5]) {
    const routed = routeVoiceWebhookEvent(
      { ...PARTICIPANT_JOINED, room: { name } },
      { receivedAt: RECEIVED_AT },
    );
    assert.deepEqual(
      routed,
      { ok: true, action: "ignore", event: "participant_joined", reason: "foreign_room" },
      `acted on ${JSON.stringify(name)}`,
    );
  }
  assert.equal(
    routeVoiceWebhookEvent({ ...PARTICIPANT_JOINED, room: undefined }, {
      receivedAt: RECEIVED_AT,
    }).reason,
    "foreign_room",
  );
});

test("a payload that is not an event at all is refused", () => {
  for (const event of [null, undefined, "participant_joined", [], 5, {}, { event: "" }, { event: 7 }]) {
    const routed = routeVoiceWebhookEvent(event, { receivedAt: RECEIVED_AT });
    assert.deepEqual(
      routed,
      { ok: false, error: "invalid_event" },
      `accepted ${JSON.stringify(event)}`,
    );
  }
  assert.deepEqual(routeVoiceWebhookEvent(PARTICIPANT_JOINED, { receivedAt: "soon" }), {
    ok: false,
    error: "invalid_clock",
  });
  assert.deepEqual(routeVoiceWebhookEvent(PARTICIPANT_JOINED, {}), {
    ok: false,
    error: "invalid_clock",
  });
});

test("the payload shape LiveKit 1.8.4 really sends routes to one rpc", () => {
  // Field-for-field the shape captured from the probe on 2026-09-13, with the
  // identifiers replaced by fixture ones. Everything is camelCase, `joinedAt`
  // is a decimal *string*, `joinedAtMs` sits beside it, the event id is `EV_`
  // and twelve base62 characters, and `room` carries no participant count at
  // all because LiveKit does not emit unpopulated fields.
  const captured = {
    event: "participant_joined",
    id: "EV_7bQ2mK4xZp1t",
    createdAt: String(NOW),
    room: {
      sid: "RM_fixtureRoomSid",
      name: `vc_${CHANNEL_ID}`,
      emptyTimeout: 60,
      departureTimeout: 20,
      maxParticipants: 5,
      creationTime: String(NOW - 120),
      creationTimeMs: String((NOW - 120) * 1_000),
      turnPassword: "fixture-turn-password",
      enabledCodecs: [{ mime: "audio/opus" }],
    },
    participant: {
      sid: "PA_fixtureParticipant",
      identity: USER_ID,
      state: "JOINED",
      joinedAt: String(JOINED_SECONDS),
      joinedAtMs: String(JOINED_SECONDS * 1_000),
      version: 2,
      permission: { canSubscribe: true, canPublish: true },
    },
  };

  const routed = routeVoiceWebhookEvent(captured, { receivedAt: RECEIVED_AT });

  assert.equal(routed.ok, true);
  assert.equal(routed.action, "rpc");
  assert.equal(routed.rpc, "voice_participant_joined");
  assert.deepEqual(routed.args, {
    p_channel_id: CHANNEL_ID,
    p_user_id: USER_ID,
    p_joined_at: JOINED_AT,
  });
});

test("the two track events of a real call are ignored without a database call", () => {
  // They arrive between the join and the leave on every call that publishes
  // audio -- four of the six deliveries captured were not among the handled
  // four -- and each one recorded would be a row in the idempotency table for
  // an event nothing acts on.
  for (const event of ["track_published", "track_unpublished"]) {
    const routed = routeVoiceWebhookEvent(
      {
        event,
        id: "EV_7bQ2mK4xZp1t",
        room: { sid: "RM_fixture", name: `vc_${CHANNEL_ID}` },
        participant: { sid: "PA_fixture", identity: USER_ID },
        track: { sid: "TR_fixture", type: "AUDIO" },
      },
      { receivedAt: RECEIVED_AT },
    );
    assert.equal(routed.ok, true, event);
    assert.equal(routed.action, "ignore", event);
  }
});

test("epoch seconds are bounded on both sides", () => {
  assert.equal(epochSecondsToIso(JOINED_SECONDS), JOINED_AT);
  assert.equal(epochSecondsToIso(String(JOINED_SECONDS)), JOINED_AT);
  assert.equal(epochSecondsToIso(1_000_000_000), "2001-09-09T01:46:40.000Z");
  assert.equal(epochSecondsToIso(999_999_999), null);
  assert.equal(epochSecondsToIso(4_102_444_801), null);
  for (const value of [0, "0", -1, "", "   ", null, undefined, Number.NaN, {}, "1e9999"]) {
    assert.equal(epochSecondsToIso(value), null, `accepted ${JSON.stringify(value)}`);
  }
});
