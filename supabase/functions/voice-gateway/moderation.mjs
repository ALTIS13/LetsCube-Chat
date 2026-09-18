// Moderating a live voice room: who may do it, to whom, and what is sent.
//
// Slice 5 of `docs/proposals/2026-09-13-voice-channels.md` names the mechanism —
// "force-mute and remove-from-voice through `UpdateParticipant` and
// `RemoveParticipant` with a gateway-held admin token". This module is the half
// that decides; `index.ts` is the half that talks HTTP and twirp. That split is
// the one `webhookEvents.mjs` already keeps, and for the same reason: an
// authorisation rule asserted by a node test is worth more than the same rule
// read off a request handler nobody can run.
//
// ── What the deployed SFU actually accepts, measured not assumed ─────────────
//
// Probed against `livekit/livekit-server:v1.8.4` on `letscube-voice` on
// 2026-09-18, unauthenticated POSTs to `/twirp/livekit.RoomService/<method>`,
// with `NoSuchMethodZZZ` as a negative control:
//
//   ListRooms            401 unauthenticated   <- routed, then auth refused
//   ListParticipants     401 unauthenticated
//   UpdateParticipant    401 unauthenticated
//   RemoveParticipant    401 unauthenticated
//   MutePublishedTrack   401 unauthenticated
//   MuteRoomTrack        404 bad_route         <- does not exist
//   NoSuchMethodZZZ      404 bad_route         <- the control
//
// So **`MuteRoomTrack` is not a method**: it is the request *message* of
// `MutePublishedTrack`, which is what the binary's own descriptor says too
// (`MuteRoomTrackRequest { room, identity, track_sid, muted }`).
//
// `UpdateParticipant` is what this module drives, and not only because it is
// available. Three reasons, in the order they matter:
//
//   1. `room.enable_remote_unmute` is absent from `/srv/letscube/voice/livekit.yaml`,
//      so it is at its default of false, and this exact binary carries the
//      string `cannot unmute track, remote unmute is disabled`. A force-mute
//      built on `MutePublishedTrack` could therefore mute and never lift it.
//   2. `MutePublishedTrack` needs a track SID, which means a round trip to find
//      it, and a person whose microphone is off has no published track to mute —
//      so a pre-emptive server mute would be impossible.
//   3. `canPublish` is the same lever the token already pulls at mint
//      (`canPublishInVoiceChannel`), so the live action and the state a rejoin
//      computes speak one language instead of two.
//
// The request shape is read off the descriptor embedded in the running binary
// rather than from documentation:
//
//   UpdateParticipantRequest { room=1, identity=2, metadata=3,
//                              permission=4 (livekit.ParticipantPermission),
//                              name=5, attributes=6 }
//
// And one trap that shape carries: this server **discards unknown fields**
// (measured — `permissionZZZ` and `permission` produced the identical answer),
// so a misspelled field name is a silent no-op with a 200.
//
// Which is why every name in `buildParticipantPermission` was proved
// recognised, not assumed, by sending a string where a bool belongs. A field
// the server knows is type-checked and answers `400 malformed`; a field it does
// not know is discarded and the request goes on to be routed. Measured
// 2026-09-18 against `letscube-voice`:
//
//   canSubscribe canPublish canPublishData canUpdateMetadata hidden
//   recorder agent can_subscribe          -> 400 malformed   (recognised)
//   canSubscribeZZZ recorderZZZ permissionZZZ -> 503          (discarded)
//
// So all seven names this module sends exist on this build, snake_case is
// accepted too, and the bogus controls prove the probe could tell the
// difference.

import { readUuid } from "./roomName.mjs";

/** The two routes, as the path segments `parseRoute` matches. */
export const MODERATION_ACTIONS = Object.freeze(["force-mute", "remove"]);

/**
 * Who may act. `chat_members.role` is the enum `owner | admin | member`, and
 * `is_chat_admin` — which this deployment already uses in every voice policy —
 * is exactly `role in ('owner','admin')`.
 *
 * It is not *called* here, and that is worth writing down: `is_chat_admin(cid)`
 * takes no user and reads `auth.uid()` internally, which is null on a
 * service-role connection. Called from this gateway it would refuse every
 * caller alive. The gateway therefore establishes the caller the way its token
 * route already does — verify the JWT, then read the membership row for that
 * `sub` with the service role — and this predicate is the same comparison
 * `is_chat_admin` makes, applied to the row that read returned.
 */
const MODERATOR_ROLES = new Set(["owner", "admin"]);

/**
 * Who may be acted upon.
 *
 * **This set is not what protects the owner** — `moderationRefusal` refuses
 * `owner` by name, before it gets here, so that the answer carries its own
 * code. A mutation proved it: adding `owner` to this set changes nothing, and
 * the line that matters is the explicit one below. What this set does is fail
 * closed on a role this code has not been taught, which the enum makes
 * impossible today and a future value ranking above owner would not.
 * `canPublishInVoiceChannel` fails closed on an unknown role for the same
 * reason.
 */
const MODERATABLE_ROLES = new Set(["admin", "member"]);

function normalizeRole(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * The request body, read as the two or three values that matter.
 *
 * `force-mute` carries `muted`, and it must be a real boolean: `"false"`,
 * `0` and `null` are all truthy-or-falsy in a way that would decide a
 * moderation action by accident, so they are refused rather than coerced.
 */
export function readModerationRequest(action, body) {
  if (!MODERATION_ACTIONS.includes(action)) {
    return { ok: false, error: "not_found" };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "invalid_request" };
  }
  const channelId = readUuid(body.channelId);
  const userId = readUuid(body.userId);
  if (channelId === null || userId === null) {
    return { ok: false, error: "invalid_request" };
  }
  if (action === "remove") {
    return { ok: true, value: { action, channelId, userId, muted: null } };
  }
  if (typeof body.muted !== "boolean") {
    return { ok: false, error: "invalid_request" };
  }
  return { ok: true, value: { action, channelId, userId, muted: body.muted } };
}

/**
 * The authorisation decision, whole, as a pure function of four facts the
 * database supplied.
 *
 * `null` means allowed. The order of the refusals is part of the contract: the
 * caller's own standing is settled before anything at all is said about the
 * target, so a plain member cannot use the route's answers to learn who the
 * owner of a chat is.
 *
 * - **Nobody may mute or remove the owner.** Stricter than
 *   `enforce_chat_member_update`, which lets an owner change a co-owner's role;
 *   here an owner may not silence a co-owner either. "Nobody" is the rule as
 *   the product states it, and a mute war between two owners is not a feature.
 * - **Nobody may act on themselves.** Leaving is `leave()` on the client and
 *   self-mute is the microphone button; both already work. Refusing self also
 *   closes a real hole, because the unmute path restores *the policy answer*
 *   and a second door to it is one door too many.
 * - **A target with no membership row** may be removed (they have no standing
 *   to protect, and getting somebody out of a room they no longer belong in is
 *   the whole point of the route) but may not be force-muted: the permission a
 *   mute writes is computed from their role, and there is no role to compute
 *   it from.
 */
export function moderationRefusal({ action, callerId, callerRole, targetId, targetRole }) {
  if (!MODERATION_ACTIONS.includes(action)) {
    return { error: "not_found", status: 404 };
  }
  const caller = normalizeRole(callerRole);
  if (!caller) return { error: "not_a_member", status: 403 };
  if (!MODERATOR_ROLES.has(caller)) return { error: "not_a_moderator", status: 403 };

  const callerUuid = readUuid(callerId);
  const targetUuid = readUuid(targetId);
  if (callerUuid === null || targetUuid === null) {
    return { error: "invalid_request", status: 400 };
  }
  if (callerUuid === targetUuid) return { error: "self_not_allowed", status: 403 };

  const target = normalizeRole(targetRole);
  if (!target) {
    if (action === "remove") return null;
    return { error: "target_not_a_member", status: 403 };
  }
  if (target === "owner") return { error: "target_is_owner", status: 403 };
  if (!MODERATABLE_ROLES.has(target)) return { error: "target_protected", status: 403 };
  return null;
}

/**
 * The `livekit.ParticipantPermission` an `UpdateParticipant` carries.
 *
 * **It replaces rather than merges.** Omitting `canSubscribe` would set it to
 * proto3's default of false and leave the person deaf in a room they can still
 * see — a force-mute that accidentally becomes a force-deafen. So the whole set
 * is written, and it is written to mirror `buildVoiceAccessTokenClaims` field
 * for field: whatever a fresh token would grant this person, this permission
 * grants, with `canPublish` as the single variable.
 *
 * Every name is the descriptor's json_name. The server discards names it does
 * not know, so a typo here would be a 200 that changed nothing; the only value
 * that grants anything is `canSubscribe`, and that is the one to check first if
 * a mute ever appears to work while the room goes silent.
 */
export function buildParticipantPermission({ canPublish }) {
  return {
    canSubscribe: true,
    canPublish: canPublish === true,
    canPublishData: false,
    canUpdateMetadata: false,
    hidden: false,
    recorder: false,
    agent: false,
  };
}

/** The `UpdateParticipant` body. `room` is derived, never taken from a client. */
export function buildUpdateParticipantPayload({ room, identity, canPublish }) {
  return {
    room,
    identity,
    permission: buildParticipantPermission({ canPublish }),
  };
}

/** The `RemoveParticipant` body: `RoomParticipantIdentity { room, identity }`. */
export function buildRemoveParticipantPayload({ room, identity }) {
  return { room, identity };
}

/**
 * The twirp error code from a refusal body, or null.
 *
 * This exists because two different 404s are measured coming out of this SFU
 * and they mean opposite things:
 *
 *   RemoveParticipant on somebody who is not there -> 404 {"code":"not_found"}
 *   a method that does not exist                   -> 404 {"code":"bad_route"}
 *
 * Reporting the second as «they already left» would be a lie the day a LiveKit
 * upgrade renames a method, and it would read as an ordinary empty room. The
 * body is parsed for this one field and nothing else; no part of it is ever put
 * in a response.
 */
export function readTwirpCode(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return typeof parsed.code === "string" && parsed.code ? parsed.code : null;
}
