export type MessagePreviewChoice = "none" | "sender" | "message";
export type MessagePreviewSession = { recipientId: string; recipientSessionId: string; expiresAt: number };
export type MessagePreviewBinding = { recipientId: string; recipientSessionId: string; deviceId: string };
export type QaMessagePreviewChoiceOwner = MessagePreviewBinding & { accountEpoch: number };
export type QaMessagePreviewChoiceContext = QaMessagePreviewChoiceOwner & { contextId: string; expiresAt: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CAPABILITY_KEYS = ["preview_v", "recipient_id", "session_id", "device_id", "preview_level"];
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
export function isMessagePreviewChoice(value: unknown): value is MessagePreviewChoice {
  return value === "none" || value === "sender" || value === "message";
}

/** Claims identify the candidate context only; the authenticated RPC is authoritative. */
export function readMessagePreviewSession(value: unknown, now = Date.now()): MessagePreviewSession | null {
  if (!record(value) || !record(value.user) || !uuid(value.user.id) || typeof value.access_token !== "string") return null;
  try {
    const parts = value.access_token.split(".");
    if (parts.length !== 3 || !parts.every(Boolean)) return null;
    const part = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims: unknown = JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, "=")));
    if (!record(claims) || claims.role !== "authenticated" || claims.is_anonymous !== false
      || claims.sub !== value.user.id || !uuid(claims.session_id)
      || !Number.isSafeInteger(claims.exp) || (claims.exp as number) <= 0 || (claims.exp as number) > 999_999_999_999
      || (claims.exp as number) * 1000 <= now) return null;
    return { recipientId: value.user.id, recipientSessionId: claims.session_id, expiresAt: (claims.exp as number) * 1000 };
  } catch { return null; }
}

export function readMessagePreviewBinding(value: unknown, expected: Pick<MessagePreviewSession, "recipientId" | "recipientSessionId">): MessagePreviewBinding | null {
  if (!record(value) || value.protocol !== 1 || !uuid(value.recipientId) || !uuid(value.recipientSessionId) || !uuid(value.deviceId)
    || value.recipientId !== expected.recipientId || value.recipientSessionId !== expected.recipientSessionId) return null;
  return { recipientId: value.recipientId, recipientSessionId: value.recipientSessionId, deviceId: value.deviceId };
}

export function readMessagePreviewCapability(data: unknown, expected: MessagePreviewBinding): MessagePreviewChoice | null {
  if (!Array.isArray(data) || data.length !== 1 || !record(data[0])) return null;
  const row = data[0];
  if (Object.keys(row).length !== CAPABILITY_KEYS.length || !CAPABILITY_KEYS.every(key => Object.hasOwn(row, key))
    || row.preview_v !== 1 || !uuid(row.recipient_id) || !uuid(row.session_id) || !uuid(row.device_id)
    || row.recipient_id !== expected.recipientId || row.session_id !== expected.recipientSessionId
    || row.device_id !== expected.deviceId || !isMessagePreviewChoice(row.preview_level)) return null;
  return row.preview_level;
}

export function readMessagePreviewConsent(data: unknown, owner: string, choice: MessagePreviewChoice): MessagePreviewChoice | null {
  if (!Array.isArray(data) || data.length !== 1 || !record(data[0])) return null;
  const row = data[0];
  return Object.keys(row).length === 2 && row.user_id === owner && row.preview_level === choice
    && isMessagePreviewChoice(row.preview_level) ? row.preview_level : null;
}

const QA_CONTEXT_KEYS = ["qa_choice_v", "purpose", "contextId", "recipientId", "recipientSessionId", "deviceId", "accountEpoch", "expiresAt"];
export function readQaMessagePreviewChoiceContext(value: unknown, expected: QaMessagePreviewChoiceOwner,
  now: number): QaMessagePreviewChoiceContext | null {
  if (!record(value) || !record(expected) || !Number.isSafeInteger(now) || now < 0
    || Object.keys(value).length !== 8 || !QA_CONTEXT_KEYS.every(key => Object.hasOwn(value, key))
    || value.qa_choice_v !== 1 || value.purpose !== "consent-only" || !uuid(value.contextId)
    || !uuid(value.recipientId) || !uuid(value.recipientSessionId) || !uuid(value.deviceId)
    || !Number.isSafeInteger(value.accountEpoch) || (value.accountEpoch as number) < 0
    || !Number.isSafeInteger(value.expiresAt) || (value.expiresAt as number) <= now
    || (value.expiresAt as number) - now > 120_000
    || value.recipientId !== expected.recipientId || value.recipientSessionId !== expected.recipientSessionId
    || value.deviceId !== expected.deviceId || value.accountEpoch !== expected.accountEpoch) return null;
  return Object.freeze({ contextId: value.contextId, recipientId: value.recipientId,
    recipientSessionId: value.recipientSessionId, deviceId: value.deviceId,
    accountEpoch: value.accountEpoch as number, expiresAt: value.expiresAt as number });
}
