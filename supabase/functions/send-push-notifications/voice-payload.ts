type VoiceEvent = "ring" | "cancel";

type VoiceFcmData = {
  protocol_version: "1";
  type: "voice_call";
  event: VoiceEvent;
  ring_key: string;
  chat_id: string;
  channel_id: string;
  caller_id: string;
  recipient_id: string;
  recipient_session_id: string;
  route: string;
  ring_started_at: string;
  expires_at: string;
};

export type VoiceFcmMessageEnvelope = {
  message: {
    token: string;
    data: VoiceFcmData;
    android: {
      priority: "HIGH";
      ttl: string;
    };
  };
};

const MAX_RING_LIFETIME_MS = 45_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Formatting only: turns one already-admitted authoritative outbox DTO into FCM.
 * Session validity, membership, preferences, capabilities, and authorization
 * are not admitted here; malformed input returns null without logging.
 */
export function buildVoiceFcmMessage(
  input: unknown,
  token: string,
  now: number,
): VoiceFcmMessageEnvelope | null {
  if (!isRecord(input) || !isToken(token) || !isEpochMillis(now)) return null;

  const event = input.event === "ring" || input.event === "cancel" ? input.event : null;
  const chatId = asUuid(input.chat_id);
  const channelId = asUuid(input.channel_id);
  const callerId = asUuid(input.caller_id);
  const recipientId = asUuid(input.recipient_id);
  const recipientSessionId = asUuid(input.recipient_session_id);
  const ringStartedAt = asEpochMillis(input.ring_started_at);
  const expiresAt = asEpochMillis(input.expires_at);

  if (
    !event ||
    !chatId ||
    !channelId ||
    !callerId ||
    !recipientId ||
    !recipientSessionId ||
    ringStartedAt === null ||
    expiresAt === null
  ) {
    return null;
  }

  if (callerId === recipientId) return null;
  if (ringStartedAt > now || expiresAt <= now || expiresAt <= ringStartedAt) return null;
  if (expiresAt - ringStartedAt > MAX_RING_LIFETIME_MS) return null;

  return {
    message: {
      token,
      data: {
        protocol_version: "1",
        type: "voice_call",
        event,
        ring_key: `voice:${channelId}:${ringStartedAt}`,
        chat_id: chatId,
        channel_id: channelId,
        caller_id: callerId,
        recipient_id: recipientId,
        recipient_session_id: recipientSessionId,
        route: `/chat/${chatId}`,
        ring_started_at: String(ringStartedAt),
        expires_at: String(expiresAt),
      },
      android: {
        priority: "HIGH",
        ttl: `${Math.floor((expiresAt - now) / 1_000)}s`,
      },
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 4_096 &&
    value === value.trim() &&
    !/[\s\p{Cc}]/u.test(value)
  );
}

function asUuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return null;
  return value.toLowerCase();
}

function isEpochMillis(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function asEpochMillis(value: unknown): number | null {
  return isEpochMillis(value) ? value : null;
}
