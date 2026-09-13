// Verifying a LiveKit webhook.
//
// LiveKit signs a webhook with an HS256 JWT in the `Authorization` header whose
// `sha256` claim is the SHA-256 of the raw request body. Both halves matter: the
// signature proves the SFU sent *a* request, the body hash proves this is the
// body it sent. Checking only the first accepts a replayed header on any
// payload at all.
//
// Every failure below is reported with a distinct code so a test can name it,
// and the entrypoint collapses all of them into one 401 so a caller cannot use
// the gateway as an oracle for which check it failed.

import { readUuid } from "./roomName.mjs";

const MAX_WEBHOOK_TOKEN_BYTES = 8_192;
const DEFAULT_CLOCK_LEEWAY_SECONDS = 30;

export function readBearerToken(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const space = trimmed.indexOf(" ");
  if (space < 0) return null;
  if (trimmed.slice(0, space).toLowerCase() !== "bearer") return null;
  const token = trimmed.slice(space + 1).trim();
  return token || null;
}

/**
 * The webhook's `Authorization` header, which is **not** a Bearer header.
 *
 * Measured against LiveKit 1.8.4 on the probe on 2026-09-13: the SFU sets
 * `Authorization: <compact JWS>` with no scheme at all. `readBearerToken`
 * refuses that, so the webhook route built on it would have answered 401 to
 * every real delivery and the product would have looked like a silent SFU. A
 * scheme is still accepted, because the documentation describes one and a later
 * version may start sending it; anything other than `bearer` is refused.
 */
export function readWebhookAuthToken(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const space = trimmed.indexOf(" ");
  if (space >= 0) {
    if (trimmed.slice(0, space).toLowerCase() !== "bearer") return null;
    const token = trimmed.slice(space + 1).trim();
    return token || null;
  }
  // With no scheme the header *is* the token, so only something shaped like a
  // compact JWS is read as one. Without that shape check a lone `Bearer` -- a
  // header whose token went missing -- would be handed to the verifier as if it
  // were the token.
  const parts = trimmed.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) return null;
  return trimmed;
}

export async function sha256Bytes(bytes) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(digest);
}

export function toHex(bytes) {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/**
 * LiveKit emits the `sha256` claim as standard base64 with padding -- measured,
 * not read: a capture on 2026-09-13 matched the standard alphabet and neither
 * the url-safe one nor hex. Decoding both alphabets and treating padding as
 * optional means the comparison is over the 32 digest bytes rather than over a
 * spelling, which is the thing that actually has to match.
 */
export function decodeBase64Loose(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replaceAll("-", "+").replaceAll("_", "/");
  if (!normalized) return null;
  const remainder = normalized.length % 4;
  if (remainder === 1) return null;
  const padded =
    remainder === 0 ? normalized : normalized + "=".repeat(4 - remainder);
  let binary;
  try {
    binary = atob(padded);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function timingSafeEqualBytes(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

/**
 * Split a compact JWS and decode its two JSON segments without verifying
 * anything. Nothing that comes out of here may be trusted until
 * `verifyLiveKitWebhookToken` has returned ok.
 */
export function decodeJwt(token) {
  if (typeof token !== "string" || !token) {
    return { ok: false, error: "malformed_token" };
  }
  if (new TextEncoder().encode(token).byteLength > MAX_WEBHOOK_TOKEN_BYTES) {
    return { ok: false, error: "malformed_token" };
  }
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) {
    return { ok: false, error: "malformed_token" };
  }
  const header = decodeJsonSegment(parts[0]);
  const payload = decodeJsonSegment(parts[1]);
  const signature = decodeBase64Loose(parts[2]);
  if (header === null || payload === null || signature === null) {
    return { ok: false, error: "malformed_token" };
  }
  return {
    ok: true,
    header,
    payload,
    signature,
    signingInput: `${parts[0]}.${parts[1]}`,
  };
}

export async function verifyLiveKitWebhookToken(token, options) {
  const {
    apiKey,
    apiSecret,
    bodyBytes,
    nowSeconds,
    leewaySeconds = DEFAULT_CLOCK_LEEWAY_SECONDS,
  } = options ?? {};
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    return { ok: false, error: "not_configured" };
  }
  if (typeof apiSecret !== "string" || !apiSecret) {
    return { ok: false, error: "not_configured" };
  }

  const decoded = decodeJwt(token);
  if (!decoded.ok) return decoded;

  // `alg` is read before anything else and only HS256 is accepted. `none` and a
  // swap to an asymmetric algorithm are the two classic forgeries against a
  // hand-rolled verifier, and both die here.
  if (decoded.header.alg !== "HS256") {
    return { ok: false, error: "unsupported_algorithm" };
  }
  if (decoded.payload.iss !== apiKey.trim()) {
    return { ok: false, error: "unknown_issuer" };
  }

  const encoder = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(apiSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = new Uint8Array(
    await globalThis.crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(decoded.signingInput),
    ),
  );
  if (!timingSafeEqualBytes(expected, decoded.signature)) {
    return { ok: false, error: "bad_signature" };
  }

  if (!Number.isFinite(nowSeconds)) return { ok: false, error: "invalid_clock" };
  const { exp, nbf } = decoded.payload;
  if (!Number.isFinite(exp)) return { ok: false, error: "missing_expiry" };
  if (nowSeconds > exp + leewaySeconds) return { ok: false, error: "expired" };
  if (Number.isFinite(nbf) && nowSeconds + leewaySeconds < nbf) {
    return { ok: false, error: "not_yet_valid" };
  }

  const claimed = decoded.payload.sha256;
  if (typeof claimed !== "string" || !claimed) {
    return { ok: false, error: "missing_body_hash" };
  }
  const claimedBytes = decodeBase64Loose(claimed);
  const actual = await sha256Bytes(bodyBytes ?? new Uint8Array(0));
  if (!timingSafeEqualBytes(claimedBytes, actual)) {
    return { ok: false, error: "body_hash_mismatch" };
  }

  return { ok: true, claims: decoded.payload };
}

/**
 * `voice_webhook_event_seen` takes a uuid, and **LiveKit's event id is not a
 * uuid** — it is `EV_` followed by twelve base62 characters. The id is mapped
 * onto a uuid here, deterministically, so that a redelivery of the same event
 * produces the same key and is dropped.
 *
 * An id that already is a uuid passes through unchanged, so a future LiveKit
 * release (or a test harness) that sends one stays legible in the table. Where
 * the event carries no id at all the body's own digest is used, which still
 * dedupes a byte-identical redelivery.
 *
 * The result is a version 8 uuid (RFC 9562, "custom") with the RFC variant
 * bits, so Postgres and this repository's own uuid check both accept it.
 */
export async function webhookEventKey(eventId, bodyBytes) {
  const passthrough = readUuid(eventId);
  if (passthrough !== null) return passthrough;

  const source =
    typeof eventId === "string" && eventId.trim() && eventId.length <= 256
      ? `livekit-event:${eventId.trim()}`
      : `livekit-body:${toHex(await sha256Bytes(bodyBytes ?? new Uint8Array(0)))}`;
  const digest = await sha256Bytes(new TextEncoder().encode(source));
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = toHex(bytes);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

function decodeJsonSegment(segment) {
  const bytes = decodeBase64Loose(segment);
  if (bytes === null) return null;
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed
    : null;
}
