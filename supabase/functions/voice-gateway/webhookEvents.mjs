// Turning a verified LiveKit webhook into one RPC call.
//
// This is a pure function of the payload and the moment it arrived: no clock,
// no network, no database. Every decision the webhook route makes about *what*
// to write lives here so that the whole routing table is asserted by node tests
// and the Deno entrypoint is left with transport.
//
// The four events the product cares about are the four named in section 3.6's
// layer 2. Everything else LiveKit sends — `track_published`, `egress_*`,
// `room_started` for somebody else's room — is ignored without touching the
// database, which also keeps the idempotency table from filling with events
// nothing acts on.

import { readUuid, voiceChannelIdFromRoomName } from "./roomName.mjs";

export const HANDLED_VOICE_WEBHOOK_EVENTS = Object.freeze([
  "room_started",
  "room_finished",
  "participant_joined",
  "participant_left",
]);

// Sanity bounds for a LiveKit int64 seconds field: after 2001-09-09 and before
// 2100. Protobuf's default for an unset field is 0, so a missing timestamp
// arrives as a value this rejects rather than as 1970.
const MIN_EPOCH_SECONDS = 1_000_000_000;
const MAX_EPOCH_SECONDS = 4_102_444_800;

export function routeVoiceWebhookEvent(event, options) {
  const receivedAt = readIsoTimestamp(options?.receivedAt);
  if (receivedAt === null) return { ok: false, error: "invalid_clock" };
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return { ok: false, error: "invalid_event" };
  }

  const kind = typeof event.event === "string" ? event.event.trim() : "";
  if (!kind) return { ok: false, error: "invalid_event" };
  if (!HANDLED_VOICE_WEBHOOK_EVENTS.includes(kind)) {
    return { ok: true, action: "ignore", event: kind, reason: "unhandled_event" };
  }

  const room = event.room && typeof event.room === "object" ? event.room : null;
  const channelId = voiceChannelIdFromRoomName(room?.name);
  if (channelId === null) {
    // Either a room on this SFU that is not a voice channel, or a forged name.
    // Neither is an error the sender should be told apart from the other.
    return { ok: true, action: "ignore", event: kind, reason: "foreign_room" };
  }

  if (kind === "room_started") {
    const activeSince =
      epochSecondsToIso(room?.creationTime) ??
      epochSecondsToIso(event.createdAt) ??
      receivedAt;
    return {
      ok: true,
      action: "rpc",
      event: kind,
      channelId,
      rpc: "voice_channel_set_active",
      args: { p_channel_id: channelId, p_active_since: activeSince },
    };
  }

  if (kind === "room_finished") {
    // null clears it. This is the one call that must never fall back to a
    // timestamp, so it is written as a literal.
    return {
      ok: true,
      action: "rpc",
      event: kind,
      channelId,
      rpc: "voice_channel_set_active",
      args: { p_channel_id: channelId, p_active_since: null },
    };
  }

  const participant =
    event.participant && typeof event.participant === "object"
      ? event.participant
      : null;
  const userId = readUuid(participant?.identity);
  if (userId === null) return { ok: false, error: "invalid_identity" };

  // `joined_at` is required on both participant events, and is deliberately not
  // defaulted to now. Section 3.6: a late `participant_left` from a kicked
  // earlier session must lose the comparison against the row the new session
  // wrote. A `left` carrying "now" would always win it and would delete the
  // live participant — precisely the bug the column exists to prevent.
  const joinedAt = epochSecondsToIso(participant?.joinedAt);
  if (joinedAt === null) return { ok: false, error: "invalid_joined_at" };

  return {
    ok: true,
    action: "rpc",
    event: kind,
    channelId,
    rpc:
      kind === "participant_joined"
        ? "voice_participant_joined"
        : "voice_participant_left",
    args: {
      p_channel_id: channelId,
      p_user_id: userId,
      p_joined_at: joinedAt,
    },
  };
}

/**
 * LiveKit's int64 fields arrive through protojson as decimal strings, and
 * sometimes as numbers. Both are read; anything outside the sanity window is
 * not a timestamp.
 */
export function epochSecondsToIso(value) {
  let seconds = null;
  if (typeof value === "number") seconds = value;
  else if (typeof value === "string" && value.trim()) seconds = Number(value.trim());
  if (seconds === null || !Number.isFinite(seconds)) return null;
  const floored = Math.floor(seconds);
  if (floored < MIN_EPOCH_SECONDS || floored > MAX_EPOCH_SECONDS) return null;
  return new Date(floored * 1_000).toISOString();
}

function readIsoTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
