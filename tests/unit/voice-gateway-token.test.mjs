// The mint side of `supabase/functions/voice-gateway`.
//
// A LiveKit token is the only way into a room, so the grants in it are the
// product's actual permission boundary — not the interface, and not the table.
// Everything below is asserted against the bytes the SFU would receive, with
// the signature re-checked by node:crypto rather than by the module that made
// it, so a change to the signing shape cannot pass by agreeing with itself.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  boundedParticipantName,
  buildVoiceAccessTokenClaims,
  buildVoiceAdminTokenClaims,
  canPublishInVoiceChannel,
  livekitHttpOrigin,
  mintVoiceAccessToken,
  mintVoiceAdminToken,
  signHs256,
  VOICE_TOKEN_TTL_SECONDS,
} from "../../supabase/functions/voice-gateway/livekitToken.mjs";
import {
  readUuid,
  voiceChannelIdFromRoomName,
  voiceRoomName,
} from "../../supabase/functions/voice-gateway/roomName.mjs";

const CHANNEL_ID = "3f2a9c14-0e5b-4d7a-9b31-7c6d5e4f8a21";
const USER_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const API_KEY = "APIfixturekey";
const API_SECRET = "fixture-secret-not-a-production-value";
const NOW = 1_757_700_000;

function decodeSegment(segment) {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

test("the room name is derived from the channel id and nothing else", () => {
  assert.equal(voiceRoomName(CHANNEL_ID), `vc_${CHANNEL_ID}`);
  assert.equal(voiceRoomName(`  ${CHANNEL_ID.toUpperCase()}  `), `vc_${CHANNEL_ID}`);
  assert.equal(voiceChannelIdFromRoomName(voiceRoomName(CHANNEL_ID)), CHANNEL_ID);
});

test("anything that is not a uuid gets no room name", () => {
  for (
    const value of [
      "",
      "   ",
      "vc_" + CHANNEL_ID,
      "not-a-uuid",
      "../voice-gateway",
      `${CHANNEL_ID} or 1=1`,
      `${CHANNEL_ID}x`,
      CHANNEL_ID.slice(0, -1),
      // The nil uuid has version 0 and is not a real channel id.
      "00000000-0000-0000-0000-000000000000",
      // A valid-looking uuid with an out-of-range variant nibble.
      "3f2a9c14-0e5b-4d7a-1b31-7c6d5e4f8a21",
      null,
      undefined,
      42,
      { toString: () => CHANNEL_ID },
      [CHANNEL_ID],
    ]
  ) {
    assert.equal(voiceRoomName(value), null, `accepted ${JSON.stringify(value)}`);
    assert.equal(readUuid(value), null, `accepted ${JSON.stringify(value)}`);
  }
});

test("a room name that is not ours yields no channel id", () => {
  for (
    const value of [
      "scratch",
      CHANNEL_ID,
      `VC${CHANNEL_ID}`,
      `xvc_${CHANNEL_ID}`,
      "vc_",
      `vc_${CHANNEL_ID}-extra`,
      `vc_${CHANNEL_ID}/..`,
      null,
      7,
    ]
  ) {
    assert.equal(
      voiceChannelIdFromRoomName(value),
      null,
      `accepted ${JSON.stringify(value)}`,
    );
  }
});

test("a client token carries exactly the grants section 3.4 lists", () => {
  const built = buildVoiceAccessTokenClaims({
    apiKey: API_KEY,
    identity: USER_ID,
    displayName: "Анна",
    channelId: CHANNEL_ID,
    canPublish: true,
    nowSeconds: NOW,
  });

  assert.equal(built.ok, true);
  assert.deepEqual(built.claims.video, {
    roomJoin: true,
    room: `vc_${CHANNEL_ID}`,
    canPublish: true,
    canSubscribe: true,
    canPublishData: false,
    canUpdateOwnMetadata: false,
    roomAdmin: false,
    roomCreate: false,
    hidden: false,
  });
  assert.equal(built.claims.iss, API_KEY);
  assert.equal(built.claims.sub, USER_ID);
  assert.equal(built.claims.name, "Анна");
});

test("roomAdmin and roomCreate are false for every client token", () => {
  for (const canPublish of [true, false]) {
    for (const role of ["owner", "admin", "member"]) {
      const built = buildVoiceAccessTokenClaims({
        apiKey: API_KEY,
        identity: USER_ID,
        displayName: role,
        channelId: CHANNEL_ID,
        canPublish,
        nowSeconds: NOW,
      });
      assert.equal(built.claims.video.roomAdmin, false);
      assert.equal(built.claims.video.roomCreate, false);
      assert.equal(built.claims.video.canPublishData, false);
      assert.equal(built.claims.video.canUpdateOwnMetadata, false);
    }
  }
});

test("a room supplied by the caller is ignored in favour of the derived one", () => {
  const built = buildVoiceAccessTokenClaims({
    apiKey: API_KEY,
    identity: USER_ID,
    channelId: CHANNEL_ID,
    canPublish: true,
    nowSeconds: NOW,
    // Fields a forged request might hope to smuggle through.
    room: "vc_00000000-0000-4000-8000-000000000000",
    video: { roomAdmin: true, roomCreate: true, room: "somebody-elses-room" },
    roomAdmin: true,
  });

  assert.equal(built.claims.video.room, `vc_${CHANNEL_ID}`);
  assert.equal(built.claims.video.roomAdmin, false);
  assert.equal(built.claims.video.roomCreate, false);
});

test("the token lives ten minutes, with ten seconds of backdating", () => {
  const built = buildVoiceAccessTokenClaims({
    apiKey: API_KEY,
    identity: USER_ID,
    channelId: CHANNEL_ID,
    canPublish: true,
    nowSeconds: NOW,
  });

  assert.equal(VOICE_TOKEN_TTL_SECONDS, 600);
  assert.equal(built.claims.exp, NOW + 600);
  assert.equal(built.claims.nbf, NOW - 10);
  assert.equal(built.claims.exp - built.claims.nbf, 610);
});

test("the mint refuses a bad channel, a bad identity and a missing key", () => {
  const base = {
    apiKey: API_KEY,
    identity: USER_ID,
    channelId: CHANNEL_ID,
    canPublish: true,
    nowSeconds: NOW,
  };
  assert.equal(
    buildVoiceAccessTokenClaims({ ...base, channelId: "scratch" }).error,
    "invalid_channel",
  );
  assert.equal(
    buildVoiceAccessTokenClaims({ ...base, identity: "anonymous" }).error,
    "invalid_identity",
  );
  assert.equal(
    buildVoiceAccessTokenClaims({ ...base, apiKey: "" }).error,
    "not_configured",
  );
  assert.equal(
    buildVoiceAccessTokenClaims({ ...base, nowSeconds: Number.NaN }).error,
    "invalid_clock",
  );
});

test("canPublish defaults to false rather than to true", () => {
  const built = buildVoiceAccessTokenClaims({
    apiKey: API_KEY,
    identity: USER_ID,
    channelId: CHANNEL_ID,
    nowSeconds: NOW,
  });
  assert.equal(built.claims.video.canPublish, false);
  assert.equal(built.claims.video.roomJoin, true);
});

test("a display name is bounded, stripped of control characters, or absent", () => {
  assert.equal(boundedParticipantName("  Анна Иванова  "), "Анна Иванова");
  assert.equal(boundedParticipantName("a".repeat(200)).length, 64);
  assert.equal(
    boundedParticipantName(`name${String.fromCharCode(10)}second`),
    "namesecond",
  );
  assert.equal(boundedParticipantName(String.fromCharCode(127)), "");
  assert.equal(boundedParticipantName(null), "");

  const anonymous = buildVoiceAccessTokenClaims({
    apiKey: API_KEY,
    identity: USER_ID,
    displayName: "   ",
    channelId: CHANNEL_ID,
    canPublish: true,
    nowSeconds: NOW,
  });
  assert.equal("name" in anonymous.claims, false);
});

test("publish rights follow the member role against the channel's speak role", () => {
  const cases = [
    ["member", "member", true],
    ["admin", "member", true],
    ["owner", "member", true],
    ["member", "admin", false],
    ["admin", "admin", true],
    ["owner", "admin", true],
    ["member", "owner", false],
    ["admin", "owner", false],
    ["owner", "owner", true],
  ];
  for (const [memberRole, speakRole, expected] of cases) {
    assert.equal(
      canPublishInVoiceChannel({ memberRole, speakRole, muted: false }),
      expected,
      `${memberRole} against ${speakRole}`,
    );
  }
});

test("a mute forces canPublish false, and an unknown role cannot publish", () => {
  assert.equal(
    canPublishInVoiceChannel({ memberRole: "owner", speakRole: "member", muted: true }),
    false,
  );
  assert.equal(
    canPublishInVoiceChannel({ memberRole: "guest", speakRole: "member", muted: false }),
    false,
  );
  assert.equal(
    canPublishInVoiceChannel({ memberRole: "owner", speakRole: "moderator", muted: false }),
    false,
  );
  assert.equal(canPublishInVoiceChannel({}), false);
});

test("the signature is a real HS256 over the base64url header and payload", async () => {
  const signed = await signHs256({ iss: API_KEY, sub: USER_ID }, API_SECRET);
  assert.equal(signed.ok, true);

  const [header, payload, signature] = signed.token.split(".");
  assert.deepEqual(decodeSegment(header), { alg: "HS256", typ: "JWT" });
  assert.deepEqual(decodeSegment(payload), { iss: API_KEY, sub: USER_ID });

  const expected = createHmac("sha256", API_SECRET)
    .update(`${header}.${payload}`)
    .digest("base64url");
  assert.equal(signature, expected);
  // base64url, so no padding and none of the standard alphabet's extras.
  assert.match(signed.token, /^[A-Za-z0-9_.-]+$/);
});

test("signing without a secret is refused rather than producing an unsigned token", async () => {
  assert.deepEqual(await signHs256({ iss: API_KEY }, ""), {
    ok: false,
    error: "not_configured",
  });
});

test("a minted access token reports the room and expiry it actually carries", async () => {
  const minted = await mintVoiceAccessToken({
    apiKey: API_KEY,
    apiSecret: API_SECRET,
    identity: USER_ID,
    displayName: "Анна",
    channelId: CHANNEL_ID,
    canPublish: true,
    nowSeconds: NOW,
  });

  assert.equal(minted.ok, true);
  assert.equal(minted.room, `vc_${CHANNEL_ID}`);
  assert.equal(minted.canPublish, true);
  assert.equal(minted.expiresAt, new Date((NOW + 600) * 1_000).toISOString());

  const payload = decodeSegment(minted.token.split(".")[1]);
  assert.equal(payload.video.room, `vc_${CHANNEL_ID}`);
  assert.equal(payload.exp, NOW + 600);
  assert.equal(payload.video.roomAdmin, false);
  assert.equal(payload.video.roomCreate, false);
});

test("the admin token is a different token that cannot join a room", async () => {
  const built = buildVoiceAdminTokenClaims({
    apiKey: API_KEY,
    channelId: CHANNEL_ID,
    nowSeconds: NOW,
  });
  assert.equal(built.claims.video.roomCreate, true);
  assert.equal(built.claims.video.roomJoin, false);
  assert.equal(built.claims.video.room, `vc_${CHANNEL_ID}`);
  // Sixty seconds, not the client's ten minutes: it is used once, in-process.
  assert.equal(built.claims.exp - NOW, 60);

  const admin = await mintVoiceAdminToken({
    apiKey: API_KEY,
    apiSecret: API_SECRET,
    channelId: CHANNEL_ID,
    nowSeconds: NOW,
  });
  const client = await mintVoiceAccessToken({
    apiKey: API_KEY,
    apiSecret: API_SECRET,
    identity: USER_ID,
    channelId: CHANNEL_ID,
    canPublish: true,
    nowSeconds: NOW,
  });
  assert.notEqual(admin.token, client.token);
  assert.equal(decodeSegment(client.token.split(".")[1]).video.roomCreate, false);
});

test("the signalling URL is translated to the SFU's http origin", () => {
  assert.equal(
    livekitHttpOrigin("wss://voice.letscube.ru"),
    "https://voice.letscube.ru",
  );
  assert.equal(livekitHttpOrigin("ws://10.0.0.4:7880"), "http://10.0.0.4:7880");
  assert.equal(
    livekitHttpOrigin("https://voice.letscube.ru/"),
    "https://voice.letscube.ru",
  );
  for (const value of ["", "   ", "voice.letscube.ru", "ftp://x", "file:///etc", null, "wss://user:pass@voice.letscube.ru"]) {
    assert.equal(livekitHttpOrigin(value), null, `accepted ${JSON.stringify(value)}`);
  }
});

test("a path prefix survives the translation, because the SFU is behind one", () => {
  // This SFU is published as a path on a shared hostname so that it needs no
  // DNS record and no certificate of its own. Dropping the path -- which is
  // what `new URL(...).origin` does, and what this function used to return --
  // sends every twirp call to whatever else answers for that hostname. Here
  // that is the release catalogue, which would answer 404 and look like an SFU
  // that is down.
  assert.equal(
    livekitHttpOrigin("wss://api.letscube.ru/voice"),
    "https://api.letscube.ru/voice",
  );
  assert.equal(
    livekitHttpOrigin("wss://api.letscube.ru/voice/"),
    "https://api.letscube.ru/voice",
  );
  assert.equal(
    livekitHttpOrigin("http://letscube-voice:7880"),
    "http://letscube-voice:7880",
  );
});

test("the gateway's own modules log nothing", () => {
  for (
    const name of ["index.ts", "livekitToken.mjs", "roomName.mjs", "webhookAuth.mjs", "webhookEvents.mjs"]
  ) {
    const source = readFileSync(
      new URL(`../../supabase/functions/voice-gateway/${name}`, import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(source, /console\.[a-z]+\s*\(/, `${name} logs`);
  }
});
