// Identifiers shared by both routes of the voice gateway.
//
// The room name is derived from the channel id and is never taken from the
// client (section 3.4 of docs/proposals/2026-09-13-voice-channels.md). That is
// the whole reason this module exists separately from the Deno entrypoint: the
// derivation and its refusal of anything that is not a uuid are the two rules a
// token forger would attack, so they are pure functions with their own tests
// rather than three lines buried in a request handler.

export const VOICE_ROOM_PREFIX = "vc_";

// The same shape support-gateway accepts: RFC 9562 versions 1 through 8 and the
// two RFC variant bits. `gen_random_uuid()` produces v4; the webhook event key
// derived in webhookAuth.mjs is a v8, and it has to pass this test too.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Read an untrusted value as a canonical lowercase uuid, or null.
 */
export function readUuid(value) {
  if (typeof value !== "string") return null;
  const id = value.trim().toLowerCase();
  return UUID_RE.test(id) ? id : null;
}

/**
 * The LiveKit room name for a voice channel, or null when the channel id is
 * not a uuid. There is deliberately no path that turns a client-supplied string
 * into a room name.
 */
export function voiceRoomName(channelId) {
  const id = readUuid(channelId);
  return id === null ? null : `${VOICE_ROOM_PREFIX}${id}`;
}

/**
 * The inverse, for webhook payloads: LiveKit tells us a room name and we have
 * to recover the channel id. Anything that is not `vc_` followed by a uuid is
 * not ours — an unrelated room on the same SFU, or a forged payload — and is
 * refused rather than guessed at.
 */
export function voiceChannelIdFromRoomName(room) {
  if (typeof room !== "string") return null;
  const name = room.trim();
  if (!name.startsWith(VOICE_ROOM_PREFIX)) return null;
  return readUuid(name.slice(VOICE_ROOM_PREFIX.length));
}
