export type NativeVoiceBinding = { recipientId: string; recipientSessionId: string };
export type NativeVoiceSession = {
  recipientId: string;
  recipientSessionId: string | null;
  accessToken: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const WIRE_KEYS = [
  "protocol_version", "type", "event", "ring_key", "chat_id", "channel_id",
  "caller_id", "recipient_id", "recipient_session_id", "route", "ring_started_at", "expires_at",
] as const;
export type NativeVoiceAction = Record<(typeof WIRE_KEYS)[number], string>;

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function isVoiceUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** Claims identify the expected context only. Only an RPC response grants eligibility. */
export function readNativeVoiceSession(value: unknown): NativeVoiceSession | null {
  if (!record(value) || !record(value.user) || !isVoiceUuid(value.user.id)
    || typeof value.access_token !== "string" || !value.access_token) return null;
  let recipientSessionId: string | null = null;
  try {
    const part = value.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims: unknown = JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, "=")));
    if (record(claims) && claims.sub === value.user.id && isVoiceUuid(claims.session_id)) {
      recipientSessionId = claims.session_id;
    }
  } catch { /* A legacy/malformed claim cannot authorize native voice. */ }
  return { recipientId: value.user.id, recipientSessionId, accessToken: value.access_token };
}

export function verifiedNativeVoiceBinding(data: unknown, expected: NativeVoiceSession | NativeVoiceBinding): NativeVoiceBinding | null {
  if (!Array.isArray(data) || data.length !== 1 || !record(data[0])) return null;
  const row = data[0];
  if (!isVoiceUuid(row.recipient_id) || !isVoiceUuid(row.recipient_session_id)
    || row.recipient_id !== expected.recipientId
    || row.recipient_session_id !== expected.recipientSessionId) return null;
  return { recipientId: row.recipient_id, recipientSessionId: row.recipient_session_id };
}

export function isMissingVoiceRegistrationRpc(error: unknown): boolean {
  if (!record(error) || (error.code !== "PGRST202" && error.code !== "42883")) return false;
  const text = [error.message, error.details].filter((value) => typeof value === "string").join(" ");
  return /\bregister_push_device\b/.test(text) && /\bp_voice_call_protocol\b/.test(text)
    && (text.includes("schema cache") || text.includes("does not exist"));
}

export function isReservedNativeVoiceData(value: unknown): boolean {
  return record(value) && (value.type === "voice_call" || "protocol_version" in value
    || (typeof value.ring_key === "string" && value.ring_key.startsWith("voice:")));
}

function epoch(value: unknown): number | null {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

export function parseNativeVoiceAction(value: unknown, binding: NativeVoiceBinding, now: number): NativeVoiceAction | null {
  if (!record(value) || Object.keys(value).length !== WIRE_KEYS.length
    || !WIRE_KEYS.every((key) => typeof value[key] === "string")) return null;
  if (value.protocol_version !== "1" || value.type !== "voice_call" || value.event !== "ring") return null;
  if (![value.chat_id, value.channel_id, value.caller_id, value.recipient_id, value.recipient_session_id].every(isVoiceUuid)) return null;
  if (value.recipient_id !== binding.recipientId || value.recipient_session_id !== binding.recipientSessionId
    || value.caller_id === value.recipient_id) return null;
  const start = epoch(value.ring_started_at);
  const expiry = epoch(value.expires_at);
  if (start === null || expiry === null || !Number.isSafeInteger(now) || now < 0
    || start > now || now >= expiry || expiry <= start || expiry - start > 45_000) return null;
  if (value.ring_key !== `voice:${value.channel_id}:${start}` || value.route !== `/chat/${value.chat_id}`) return null;
  return value as NativeVoiceAction;
}

export function nativeForegroundRingKey(channelId: string | null, startedAt: number | null, incomingVisible: boolean): string | null {
  if (!incomingVisible || !isVoiceUuid(channelId) || typeof startedAt !== "number") return null;
  return Number.isSafeInteger(startedAt) && startedAt >= 0 ? `voice:${channelId}:${startedAt}` : null;
}
