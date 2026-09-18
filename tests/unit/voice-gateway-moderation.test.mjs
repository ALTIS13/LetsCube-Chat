// The moderation half of `supabase/functions/voice-gateway`.
//
// Two things are asserted here and nowhere else: the authorisation matrix, as a
// pure function of what the database said, and the exact bytes an
// `UpdateParticipant` carries. The second matters more than it looks — the
// deployed SFU discards fields it does not recognise (measured on 2026-09-18:
// `permissionZZZ` and `permission` produced identical answers), so a typo in a
// permission name is a 200 that changes nothing at all. The request path that
// calls these lives in `voice-gateway-routes.test.mjs`.
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildParticipantPermission,
  buildRemoveParticipantPayload,
  buildUpdateParticipantPayload,
  MODERATION_ACTIONS,
  moderationRefusal,
  readModerationRequest,
  readTwirpCode,
} from "../../supabase/functions/voice-gateway/moderation.mjs";
import { createVoiceModerationRateLimiter } from "../../supabase/functions/voice-gateway/moderationRateLimit.mjs";
import { buildVoiceAccessTokenClaims } from "../../supabase/functions/voice-gateway/livekitToken.mjs";

const CHANNEL_ID = "3f2a9c14-0e5b-4d7a-9b31-7c6d5e4f8a21";
const OWNER_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ADMIN_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5e";
const MEMBER_ID = "2a3b4c5d-6e7f-4a8b-8c9d-0e1f2a3b4c5f";
const STRANGER_ID = "3a4b5c6d-7e8f-4a9b-8c9d-0e1f2a3b4c60";

// ── the request body ─────────────────────────────────────────────────────────

test("both actions need two real uuids", () => {
  for (const action of MODERATION_ACTIONS) {
    for (
      const body of [
        null,
        undefined,
        "not an object",
        [],
        {},
        { channelId: CHANNEL_ID },
        { userId: MEMBER_ID },
        { channelId: "scratch", userId: MEMBER_ID, muted: true },
        { channelId: CHANNEL_ID, userId: `${MEMBER_ID} or 1=1`, muted: true },
        { channelId: CHANNEL_ID, userId: "00000000-0000-0000-0000-000000000000", muted: true },
      ]
    ) {
      const read = readModerationRequest(action, body);
      assert.equal(read.ok, false, `${action} accepted ${JSON.stringify(body)}`);
      assert.equal(read.error, "invalid_request");
    }
  }
});

test("a force-mute needs a real boolean, not something truthy", () => {
  for (const muted of ["true", "false", 1, 0, null, undefined, "", [], {}]) {
    const read = readModerationRequest("force-mute", {
      channelId: CHANNEL_ID,
      userId: MEMBER_ID,
      muted,
    });
    assert.equal(read.ok, false, `accepted muted=${JSON.stringify(muted)}`);
  }
  for (const muted of [true, false]) {
    const read = readModerationRequest("force-mute", {
      channelId: CHANNEL_ID,
      userId: MEMBER_ID,
      muted,
    });
    assert.equal(read.ok, true);
    assert.equal(read.value.muted, muted);
  }
});

test("a remove needs no boolean and is given none", () => {
  const read = readModerationRequest("remove", {
    channelId: CHANNEL_ID,
    userId: MEMBER_ID,
    muted: true,
  });
  assert.equal(read.ok, true);
  assert.equal(read.value.muted, null);
  assert.equal(read.value.channelId, CHANNEL_ID);
  assert.equal(read.value.userId, MEMBER_ID);
});

test("a uuid is canonicalised the way the room name is", () => {
  const read = readModerationRequest("remove", {
    channelId: `  ${CHANNEL_ID.toUpperCase()}  `,
    userId: MEMBER_ID.toUpperCase(),
  });
  assert.equal(read.ok, true);
  assert.equal(read.value.channelId, CHANNEL_ID);
  assert.equal(read.value.userId, MEMBER_ID);
});

test("an action this module does not have is not found", () => {
  for (const action of ["mute", "kick", "", null, "force-mute ", "FORCE-MUTE"]) {
    assert.equal(
      readModerationRequest(action, { channelId: CHANNEL_ID, userId: MEMBER_ID }).error,
      "not_found",
      `accepted action ${JSON.stringify(action)}`,
    );
  }
});

// ── the authorisation matrix ─────────────────────────────────────────────────

function refusal(overrides) {
  return moderationRefusal({
    action: "force-mute",
    callerId: ADMIN_ID,
    callerRole: "admin",
    targetId: MEMBER_ID,
    targetRole: "member",
    ...overrides,
  });
}

test("an owner and an administrator may act; a plain member may not", () => {
  assert.equal(refusal({ callerRole: "owner", callerId: OWNER_ID }), null);
  assert.equal(refusal({ callerRole: "admin" }), null);

  const member = refusal({ callerRole: "member", callerId: MEMBER_ID, targetId: STRANGER_ID });
  assert.deepEqual(member, { error: "not_a_moderator", status: 403 });
});

test("somebody with no membership row at all is not a member", () => {
  for (const callerRole of [null, undefined, "", "   "]) {
    assert.deepEqual(
      refusal({ callerRole, callerId: STRANGER_ID }),
      { error: "not_a_member", status: 403 },
      `accepted callerRole ${JSON.stringify(callerRole)}`,
    );
  }
});

test("a role this code has not been taught cannot moderate", () => {
  for (const callerRole of ["moderator", "founder", "admins", "OWNER!", 7, {}]) {
    const answer = refusal({ callerRole });
    assert.notEqual(answer, null, `accepted callerRole ${JSON.stringify(callerRole)}`);
  }
  // The two that do exist, in any casing the enum could be read back in.
  assert.equal(refusal({ callerRole: "OWNER", callerId: OWNER_ID }), null);
  assert.equal(refusal({ callerRole: " Admin " }), null);
});

test("nobody may mute or remove the chat's owner — not even another owner", () => {
  for (const action of MODERATION_ACTIONS) {
    for (const callerRole of ["owner", "admin"]) {
      assert.deepEqual(
        moderationRefusal({
          action,
          callerId: callerRole === "owner" ? ADMIN_ID : ADMIN_ID,
          callerRole,
          targetId: OWNER_ID,
          targetRole: "owner",
        }),
        { error: "target_is_owner", status: 403 },
        `${callerRole} was allowed to ${action} the owner`,
      );
    }
  }
});

test("a target whose role is not one this code knows is protected", () => {
  assert.deepEqual(
    refusal({ targetRole: "founder" }),
    { error: "target_protected", status: 403 },
  );
});

test("nobody may act on themselves, by either route", () => {
  for (const action of MODERATION_ACTIONS) {
    for (const role of ["owner", "admin"]) {
      assert.deepEqual(
        moderationRefusal({
          action,
          callerId: ADMIN_ID,
          callerRole: role,
          targetId: ADMIN_ID.toUpperCase(),
          targetRole: role,
        }),
        { error: "self_not_allowed", status: 403 },
        `${role} was allowed to ${action} themselves`,
      );
    }
  }
});

test("the caller's standing is settled before anything is said about the target", () => {
  // A plain member asking about the owner learns only that they are not a
  // moderator. If this ever answered `target_is_owner`, the route would be a
  // way to discover who owns a chat.
  assert.deepEqual(
    moderationRefusal({
      action: "remove",
      callerId: MEMBER_ID,
      callerRole: "member",
      targetId: OWNER_ID,
      targetRole: "owner",
    }),
    { error: "not_a_moderator", status: 403 },
  );
  assert.deepEqual(
    moderationRefusal({
      action: "remove",
      callerId: STRANGER_ID,
      callerRole: null,
      targetId: OWNER_ID,
      targetRole: "owner",
    }),
    { error: "not_a_member", status: 403 },
  );
});

test("somebody who is no longer a member may be removed but not force-muted", () => {
  assert.equal(
    moderationRefusal({
      action: "remove",
      callerId: ADMIN_ID,
      callerRole: "admin",
      targetId: STRANGER_ID,
      targetRole: null,
    }),
    null,
  );
  assert.deepEqual(
    moderationRefusal({
      action: "force-mute",
      callerId: ADMIN_ID,
      callerRole: "admin",
      targetId: STRANGER_ID,
      targetRole: null,
    }),
    { error: "target_not_a_member", status: 403 },
  );
});

test("an identity that is not a uuid is refused even past the role checks", () => {
  assert.deepEqual(
    refusal({ targetId: "scratch" }),
    { error: "invalid_request", status: 400 },
  );
  assert.deepEqual(
    refusal({ callerId: "scratch" }),
    { error: "invalid_request", status: 400 },
  );
});

// ── what goes on the wire ────────────────────────────────────────────────────

test("the permission is the whole set, so a mute is not also a deafen", () => {
  const muted = buildParticipantPermission({ canPublish: false });
  // `permission` replaces rather than merges: proto3 reads an absent bool as
  // false, so an omitted `canSubscribe` would leave the person unable to hear
  // the room they were only meant to be quiet in.
  assert.equal(muted.canSubscribe, true);
  assert.equal(muted.canPublish, false);
  assert.deepEqual(muted, {
    canSubscribe: true,
    canPublish: false,
    canPublishData: false,
    canUpdateMetadata: false,
    hidden: false,
    recorder: false,
    agent: false,
  });
  assert.equal(buildParticipantPermission({ canPublish: true }).canPublish, true);
  // Nothing other than a real `true` grants publication.
  for (const value of ["true", 1, {}, [], "yes"]) {
    assert.equal(buildParticipantPermission({ canPublish: value }).canPublish, false);
  }
});

test("the permission grants exactly what a fresh token would grant", () => {
  // One policy, two expressions of it. If the token's grants ever change and
  // this does not, the same person gets one set of rights on joining and a
  // different set the moment a moderator unmutes them.
  const claims = buildVoiceAccessTokenClaims({
    apiKey: "APIfixturekey",
    identity: MEMBER_ID,
    displayName: "",
    channelId: CHANNEL_ID,
    canPublish: true,
    nowSeconds: 1_757_700_000,
  });
  assert.equal(claims.ok, true);
  const permission = buildParticipantPermission({ canPublish: true });
  assert.equal(permission.canSubscribe, claims.claims.video.canSubscribe);
  assert.equal(permission.canPublish, claims.claims.video.canPublish);
  assert.equal(permission.canPublishData, claims.claims.video.canPublishData);
  assert.equal(permission.canUpdateMetadata, claims.claims.video.canUpdateOwnMetadata);
  assert.equal(permission.hidden, claims.claims.video.hidden);
});

test("the two payloads carry the derived room and nothing else", () => {
  const update = buildUpdateParticipantPayload({
    room: `vc_${CHANNEL_ID}`,
    identity: MEMBER_ID,
    canPublish: false,
  });
  assert.deepEqual(Object.keys(update).sort(), ["identity", "permission", "room"]);
  assert.equal(update.room, `vc_${CHANNEL_ID}`);
  assert.equal(update.identity, MEMBER_ID);

  assert.deepEqual(
    buildRemoveParticipantPayload({ room: `vc_${CHANNEL_ID}`, identity: MEMBER_ID }),
    { room: `vc_${CHANNEL_ID}`, identity: MEMBER_ID },
  );
});

// ── telling the two 404s apart ───────────────────────────────────────────────

test("a twirp not_found is read, and a bad_route is not mistaken for one", () => {
  // Both measured coming out of this SFU on 2026-09-18. The first means «that
  // person is not in the room»; the second means «this build has no such
  // method», which is an outage dressed as an empty room.
  assert.equal(
    readTwirpCode('{"code":"not_found","msg":"participant not found"}'),
    "not_found",
  );
  assert.equal(
    readTwirpCode(
      '{"code":"bad_route","msg":"no handler for path \\"/twirp/livekit.RoomService/MuteRoomTrack\\""}',
    ),
    "bad_route",
  );
  assert.equal(
    readTwirpCode('{"code":"unavailable","msg":"no response from servers"}'),
    "unavailable",
  );
  for (const text of ["", "   ", "not json", "[]", "null", '{"msg":"x"}', '{"code":""}', null, 7]) {
    assert.equal(readTwirpCode(text), null, `read a code out of ${JSON.stringify(text)}`);
  }
});

// ── the rate limit ───────────────────────────────────────────────────────────

test("a caller gets the limit and then a retry-after", () => {
  let clock = 1_000_000;
  const limiter = createVoiceModerationRateLimiter({
    now: () => clock,
    windowMs: 60_000,
    limit: 3,
  });

  for (let index = 0; index < 3; index += 1) {
    assert.deepEqual(limiter.check(ADMIN_ID), { ok: true }, `action ${index} refused`);
    clock += 1_000;
  }
  const refused = limiter.check(ADMIN_ID);
  assert.equal(refused.ok, false);
  // Three actions at 0s, 1s, 2s; now 3s. The window frees at 60s, so 57s.
  assert.equal(refused.retryAfterSeconds, 57);

  clock += 1_000;
  assert.equal(limiter.check(ADMIN_ID).retryAfterSeconds, 56);

  // And the window really does free.
  clock += 60_000;
  assert.deepEqual(limiter.check(ADMIN_ID), { ok: true });
});

test("a refusal records nothing, so hammering cannot extend the lockout", () => {
  // Written after a mutation stayed green. `retryAfterSeconds` always reads
  // the *oldest* entry, so a limiter that recorded its own refusals reported
  // the same number while quietly holding the caller past the window. The only
  // timeline that can tell the two apart is one where the refusal lands inside
  // the window and the question is asked after the original entry has aged out.
  let clock = 0;
  const limiter = createVoiceModerationRateLimiter({
    now: () => clock,
    windowMs: 10_000,
    limit: 1,
  });

  assert.deepEqual(limiter.check(ADMIN_ID), { ok: true });
  clock = 5_000;
  assert.equal(limiter.check(ADMIN_ID).ok, false);
  // The one allowed action was at 0 and the window is ten seconds, so at 11s
  // the caller is owed their next action whatever they did at 5s.
  clock = 11_000;
  assert.deepEqual(
    limiter.check(ADMIN_ID),
    { ok: true },
    "a refused attempt was recorded and extended the lockout",
  );
});

test("the limit is per caller", () => {
  let clock = 0;
  const limiter = createVoiceModerationRateLimiter({
    now: () => clock,
    windowMs: 10_000,
    limit: 1,
  });
  assert.deepEqual(limiter.check(ADMIN_ID), { ok: true });
  assert.equal(limiter.check(ADMIN_ID).ok, false);
  assert.deepEqual(limiter.check(OWNER_ID), { ok: true });
});

test("the default limit is above any hand and below any loop", () => {
  let clock = 0;
  const limiter = createVoiceModerationRateLimiter({ now: () => clock });
  // Twenty in a burst is allowed; the twenty-first in the same minute is not.
  for (let index = 0; index < 20; index += 1) {
    assert.deepEqual(limiter.check(ADMIN_ID), { ok: true }, `burst action ${index}`);
  }
  assert.equal(limiter.check(ADMIN_ID).ok, false);
});
