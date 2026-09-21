import assert from "node:assert/strict";
import test from "node:test";

const voicePayloadModule = await import(
  "../../supabase/functions/send-push-notifications/voice-payload.ts"
).catch(() => null);

const CHAT_ID = "11111111-1111-4111-8111-11111111111a";
const CHANNEL_ID = "22222222-2222-4222-8222-22222222222b";
const CALLER_ID = "33333333-3333-4333-8333-33333333333c";
const RECIPIENT_ID = "44444444-4444-4444-8444-44444444444d";
const RECIPIENT_SESSION_ID = "55555555-5555-4555-8555-55555555555e";
const STARTED_AT = 1_795_000_000_000;
const EXPIRES_AT = STARTED_AT + 45_000;

function api() {
  assert.ok(voicePayloadModule, "voice FCM payload builder must exist");
  return voicePayloadModule;
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    event: "ring",
    chat_id: CHAT_ID,
    channel_id: CHANNEL_ID,
    caller_id: CALLER_ID,
    recipient_id: RECIPIENT_ID,
    recipient_session_id: RECIPIENT_SESSION_ID,
    ring_started_at: STARTED_AT,
    expires_at: EXPIRES_AT,
    ...overrides,
  };
}

test("a valid ring becomes a short-lived data-only HIGH priority message", () => {
  const { buildVoiceFcmMessage } = api();
  const result = buildVoiceFcmMessage(event(), "fcm-device-token", STARTED_AT);

  assert.deepEqual(result, {
    message: {
      token: "fcm-device-token",
      data: {
        protocol_version: "1",
        type: "voice_call",
        event: "ring",
        ring_key: `voice:${CHANNEL_ID}:${STARTED_AT}`,
        chat_id: CHAT_ID,
        channel_id: CHANNEL_ID,
        caller_id: CALLER_ID,
        recipient_id: RECIPIENT_ID,
        recipient_session_id: RECIPIENT_SESSION_ID,
        route: `/chat/${CHAT_ID}`,
        ring_started_at: String(STARTED_AT),
        expires_at: String(EXPIRES_AT),
      },
      android: {
        priority: "HIGH",
        ttl: "45s",
      },
    },
  });
  assert.equal("notification" in result.message, false);
  assert.equal("collapse_key" in result.message.android, false);
});

test("ring and cancel share a key while a later ring in the same channel does not", () => {
  const { buildVoiceFcmMessage } = api();
  const ring = buildVoiceFcmMessage(event(), "token", STARTED_AT);
  const cancel = buildVoiceFcmMessage(event({ event: "cancel" }), "token", STARTED_AT + 10_000);
  const nextStartedAt = STARTED_AT + 60_000;
  const next = buildVoiceFcmMessage(
    event({ ring_started_at: nextStartedAt, expires_at: nextStartedAt + 45_000 }),
    "token",
    nextStartedAt,
  );

  assert.equal(cancel?.message.data.ring_key, ring?.message.data.ring_key);
  assert.notEqual(next?.message.data.ring_key, ring?.message.data.ring_key);
  assert.equal(cancel?.message.data.event, "cancel");
});

test("TTL floors the remaining seconds and deliberately permits zero", () => {
  const { buildVoiceFcmMessage } = api();

  assert.equal(
    buildVoiceFcmMessage(event(), "token", EXPIRES_AT - 1_999)?.message.android.ttl,
    "1s",
  );
  assert.equal(
    buildVoiceFcmMessage(event(), "token", EXPIRES_AT - 999)?.message.android.ttl,
    "0s",
  );
});

test("UUIDs are runtime-validated and canonicalized without changing ring identity", () => {
  const { buildVoiceFcmMessage } = api();
  const result = buildVoiceFcmMessage(
    event({
      chat_id: CHAT_ID.toUpperCase(),
      channel_id: CHANNEL_ID.toUpperCase(),
      caller_id: CALLER_ID.toUpperCase(),
      recipient_id: RECIPIENT_ID.toUpperCase(),
      recipient_session_id: RECIPIENT_SESSION_ID.toUpperCase(),
    }),
    "token",
    STARTED_AT,
  );

  assert.equal(result?.message.data.chat_id, CHAT_ID);
  assert.equal(result?.message.data.channel_id, CHANNEL_ID);
  assert.equal(result?.message.data.caller_id, CALLER_ID);
  assert.equal(result?.message.data.recipient_id, RECIPIENT_ID);
  assert.equal(result?.message.data.recipient_session_id, RECIPIENT_SESSION_ID);
  assert.equal(result?.message.data.ring_key, `voice:${CHANNEL_ID}:${STARTED_AT}`);
});

test("malformed DTOs, invalid tokens, and invalid clocks are rejected", () => {
  const { buildVoiceFcmMessage } = api();
  const { recipient_session_id: _recipientSessionId, ...missingSession } = event();
  const cases: Array<[unknown, unknown, number]> = [
    [null, "token", STARTED_AT],
    [[], "token", STARTED_AT],
    [{}, "token", STARTED_AT],
    [event({ event: "answer" }), "token", STARTED_AT],
    [event({ chat_id: "not-a-uuid" }), "token", STARTED_AT],
    [event({ channel_id: "not-a-uuid" }), "token", STARTED_AT],
    [event({ caller_id: "not-a-uuid" }), "token", STARTED_AT],
    [event({ recipient_id: "not-a-uuid" }), "token", STARTED_AT],
    [missingSession, "token", STARTED_AT],
    [event({ recipient_session_id: "not-a-uuid" }), "token", STARTED_AT],
    [event(), "", STARTED_AT],
    [event(), " token-with-spaces ", STARTED_AT],
    [event(), "token with-space", STARTED_AT],
    [event(), "token\nline", STARTED_AT],
    [event(), "token\u0000control", STARTED_AT],
    [event(), "token", Number.NaN],
    [event(), "token", Number.POSITIVE_INFINITY],
  ];

  for (const [input, token, now] of cases) {
    assert.equal(buildVoiceFcmMessage(input, token as string, now), null);
  }
});

test("future, expired, reversed, non-canonical, and overlong windows are rejected", () => {
  const { buildVoiceFcmMessage } = api();
  const cases = [
    [event(), STARTED_AT - 1],
    [event(), EXPIRES_AT],
    [event({ expires_at: STARTED_AT }), STARTED_AT],
    [event({ expires_at: STARTED_AT - 1 }), STARTED_AT],
    [event({ expires_at: EXPIRES_AT + 1 }), STARTED_AT],
    [event({ ring_started_at: STARTED_AT + 0.5 }), STARTED_AT + 1],
    [event({ expires_at: EXPIRES_AT + 0.5 }), STARTED_AT],
    [event({ ring_started_at: -1, expires_at: 1 }), 0],
  ] as const;

  for (const [input, now] of cases) {
    assert.equal(buildVoiceFcmMessage(input, "token", now), null);
  }
});

test("a caller cannot be their own recipient even with different UUID case", () => {
  const { buildVoiceFcmMessage } = api();

  assert.equal(
    buildVoiceFcmMessage(event({ recipient_id: CALLER_ID.toUpperCase() }), "token", STARTED_AT),
    null,
  );
});

test("self-call rejection compares user identities, not the recipient session namespace", () => {
  const { buildVoiceFcmMessage } = api();

  assert.ok(
    buildVoiceFcmMessage(
      event({ recipient_session_id: CALLER_ID }),
      "token",
      STARTED_AT,
    ),
  );
});

test("only allowlisted fields leave the authoritative DTO and the token stays transport-only", () => {
  const { buildVoiceFcmMessage } = api();
  const result = buildVoiceFcmMessage(
    event({
      title: "spoofed caller",
      body: "private text",
      caller_name: "private name",
      media_url: "https://example.invalid/private.jpg",
      token: "payload-token",
      route: "/tasks",
      secret: "private",
    }),
    "transport-token",
    STARTED_AT,
  );

  assert.ok(result);
  assert.deepEqual(Object.keys(result.message.data).sort(), [
    "caller_id",
    "channel_id",
    "chat_id",
    "event",
    "expires_at",
    "protocol_version",
    "recipient_id",
    "recipient_session_id",
    "ring_key",
    "ring_started_at",
    "route",
    "type",
  ]);
  assert.equal(result.message.token, "transport-token");
  assert.equal(JSON.stringify(result.message.data).includes("transport-token"), false);
  assert.equal(JSON.stringify(result.message).includes("private"), false);
});

test("the builder does not mutate its input", () => {
  const { buildVoiceFcmMessage } = api();
  const input = Object.freeze(event());
  const before = JSON.stringify(input);

  assert.ok(buildVoiceFcmMessage(input, "token", STARTED_AT));
  assert.equal(JSON.stringify(input), before);
});
