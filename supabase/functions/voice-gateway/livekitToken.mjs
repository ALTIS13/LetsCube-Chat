// Minting a LiveKit access token.
//
// A LiveKit token is a hand-rolled HS256 JWT — header, payload, HMAC — which is
// what slice 1 proved with `docs/operations/voice-probe/mint.py`. There is no
// dependency to add here and adding one would be the wrong kind of thrift.
//
// Everything in this file is pure or depends only on WebCrypto, so every claim
// the SFU will act on is asserted by a node test rather than by reading the
// code. The clock is an argument, never `Date.now()`.

import { readUuid, voiceRoomName } from "./roomName.mjs";

export const VOICE_TOKEN_TTL_SECONDS = 600;
// A tolerance for clock skew between this function and the SFU, the same ten
// seconds mint.py used.
export const VOICE_TOKEN_NOT_BEFORE_SKEW_SECONDS = 10;
// The admin token never leaves this process: it exists for the CreateRoom call
// and is discarded. One minute is more than the request needs.
export const VOICE_ADMIN_TOKEN_TTL_SECONDS = 60;

const MAX_PARTICIPANT_NAME_LENGTH = 64;

const ROLE_RANK = new Map([
  ["member", 1],
  ["admin", 2],
  ["owner", 3],
]);

/**
 * `public.chat_member_role` is ('owner', 'admin', 'member'); a channel's
 * `speak_role` is the minimum that may publish. An unrecognised role ranks
 * zero, so an enum this code has not been taught about cannot publish.
 */
export function canPublishInVoiceChannel({ memberRole, speakRole, muted }) {
  if (muted === true) return false;
  const member = ROLE_RANK.get(String(memberRole ?? "").toLowerCase()) ?? 0;
  const required = ROLE_RANK.get(String(speakRole ?? "").toLowerCase()) ?? 0;
  if (member === 0 || required === 0) return false;
  return member >= required;
}

/**
 * A display name is cosmetic and arrives from a profile row, so it is bounded
 * and stripped of control characters rather than trusted. An empty result drops
 * the claim entirely instead of sending `""`.
 */
export function boundedParticipantName(value) {
  if (typeof value !== "string") return "";
  const printable = Array.from(value.trim())
    .filter((character) => {
      const code = character.codePointAt(0);
      return code >= 0x20 && code !== 0x7f;
    })
    .join("");
  return printable.slice(0, MAX_PARTICIPANT_NAME_LENGTH).trim();
}

/**
 * The client token. Section 3.4 writes the grants as the SDK's constructor
 * options — `identity` and `name` beside a `video` grant — which serialize to
 * the standard `sub` and `name` claims; that translation happens here and
 * nowhere else.
 *
 * `roomAdmin` and `roomCreate` are literals, not parameters. There is no
 * argument to this function that can turn either on.
 */
export function buildVoiceAccessTokenClaims({
  apiKey,
  identity,
  displayName,
  channelId,
  canPublish,
  nowSeconds,
}) {
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    return { ok: false, error: "not_configured" };
  }
  const room = voiceRoomName(channelId);
  if (room === null) return { ok: false, error: "invalid_channel" };
  const subject = readIdentity(identity);
  if (subject === null) return { ok: false, error: "invalid_identity" };
  if (!Number.isFinite(nowSeconds)) return { ok: false, error: "invalid_clock" };

  const issuedAt = Math.floor(nowSeconds);
  const name = boundedParticipantName(displayName);
  const claims = {
    iss: apiKey.trim(),
    sub: subject,
    nbf: issuedAt - VOICE_TOKEN_NOT_BEFORE_SKEW_SECONDS,
    exp: issuedAt + VOICE_TOKEN_TTL_SECONDS,
    video: {
      roomJoin: true,
      room,
      canPublish: canPublish === true,
      canSubscribe: true,
      canPublishData: false,
      canUpdateOwnMetadata: false,
      roomAdmin: false,
      roomCreate: false,
      hidden: false,
    },
  };
  if (name) claims.name = name;
  return { ok: true, claims };
}

/**
 * The administrative token used for the CreateRoom call in step 5. It is minted
 * inside the gateway, used once against the SFU's own HTTP API, and never put
 * in a response body. It carries no `roomJoin`, so it cannot be used to enter a
 * call even if it did escape.
 */
export function buildVoiceAdminTokenClaims({ apiKey, channelId, nowSeconds }) {
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    return { ok: false, error: "not_configured" };
  }
  const room = voiceRoomName(channelId);
  if (room === null) return { ok: false, error: "invalid_channel" };
  if (!Number.isFinite(nowSeconds)) return { ok: false, error: "invalid_clock" };

  const issuedAt = Math.floor(nowSeconds);
  return {
    ok: true,
    claims: {
      iss: apiKey.trim(),
      sub: `voice-gateway:${room}`,
      nbf: issuedAt - VOICE_TOKEN_NOT_BEFORE_SKEW_SECONDS,
      exp: issuedAt + VOICE_ADMIN_TOKEN_TTL_SECONDS,
      video: {
        roomCreate: true,
        roomList: true,
        room,
        roomAdmin: true,
        roomJoin: false,
      },
    },
  };
}

export async function signHs256(claims, secret) {
  if (typeof secret !== "string" || !secret) {
    return { ok: false, error: "not_configured" };
  }
  const encoder = new TextEncoder();
  const header = base64UrlBytes(
    encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })),
  );
  const payload = base64UrlBytes(encoder.encode(JSON.stringify(claims)));
  const signingInput = `${header}.${payload}`;
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(signingInput),
  );
  return {
    ok: true,
    token: `${signingInput}.${base64UrlBytes(new Uint8Array(signature))}`,
  };
}

export async function mintVoiceAccessToken(options) {
  const built = buildVoiceAccessTokenClaims(options);
  if (!built.ok) return built;
  const signed = await signHs256(built.claims, options.apiSecret);
  if (!signed.ok) return signed;
  return {
    ok: true,
    token: signed.token,
    claims: built.claims,
    room: built.claims.video.room,
    canPublish: built.claims.video.canPublish,
    expiresAt: new Date(built.claims.exp * 1_000).toISOString(),
  };
}

export async function mintVoiceAdminToken(options) {
  const built = buildVoiceAdminTokenClaims(options);
  if (!built.ok) return built;
  const signed = await signHs256(built.claims, options.apiSecret);
  if (!signed.ok) return signed;
  return { ok: true, token: signed.token, claims: built.claims };
}

/**
 * `LIVEKIT_URL` is the signalling URL a client dials — `wss://…`. The Twirp API
 * this function calls lives on the same origin over http(s), so the scheme is
 * translated rather than a second environment variable being invented.
 */
export function livekitHttpOrigin(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  const scheme =
    url.protocol === "wss:" || url.protocol === "https:"
      ? "https:"
      : url.protocol === "ws:" || url.protocol === "http:"
        ? "http:"
        : null;
  if (scheme === null) return null;
  url.protocol = scheme;
  return url.origin;
}

export function base64UrlBytes(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function readIdentity(value) {
  // A participant identity is the Supabase user id, and the webhook parses it
  // straight back into `voice_participants.user_id`. Anything that is not a
  // uuid would produce a row nobody could join to a profile, so it is refused
  // at the mint rather than discovered later.
  return readUuid(value);
}
