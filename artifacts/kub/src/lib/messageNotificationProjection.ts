const TRUSTED_NOTIFICATION_AVATAR_ORIGINS = new Set([
  "https://app.letscube.ru",
  "https://api.letscube.ru",
]);

type MessageNotificationPayload = Record<string, unknown>;

export type MessageNotificationProjection = {
  chatId: string;
  messageId: string;
  senderKind: "user" | "bot";
  senderId: string | null;
  botId: string | null;
  senderName: string;
  senderAvatarUrl: string | null;
  messageType: string;
  preview: string;
  route: string;
  groupTag: string;
};

export function parseMessageNotificationProjection(
  payload: unknown,
): MessageNotificationProjection | null {
  const row = asPayload(payload);
  const chatId = safeId(row.chat_id);
  const messageId = safeId(row.message_id);
  const senderKind = row.sender_kind === "user" || row.sender_kind === "bot"
    ? row.sender_kind
    : null;
  const senderId = safeId(row.sender_id);
  const botId = safeId(row.bot_id);
  if (!chatId || !messageId || !senderKind) return null;
  if (senderKind === "user" && (!senderId || botId)) return null;
  if (senderKind === "bot" && (!botId || senderId)) return null;

  const expectedRoute = `/?chat=${encodeURIComponent(chatId)}&message=${encodeURIComponent(messageId)}`;
  const expectedGroupTag = `message:chat:${chatId}`;
  return {
    chatId,
    messageId,
    senderKind,
    senderId: senderKind === "user" ? senderId : null,
    botId: senderKind === "bot" ? botId : null,
    senderName: safeText(row.sender_name, senderKind === "bot" ? "Бот" : "Участник", 128),
    senderAvatarUrl: safeNotificationAvatarUrl(row.sender_avatar_url),
    messageType: safeText(row.message_type, "text", 32),
    preview: safeText(row.preview, "Сообщение", 180),
    route: expectedRoute,
    groupTag: expectedGroupTag,
  };
}

export function isSelfMessageNotification(
  payload: unknown,
  currentUserId: string | null | undefined,
): boolean {
  if (!currentUserId) return false;
  const row = asPayload(payload);
  if (row.sender_kind === "user") {
    return safeId(row.sender_id) === currentUserId && safeId(row.bot_id) === null;
  }
  if (row.sender_kind !== undefined || row.bot_id !== undefined) return false;
  return safeId(row.sender_id) === currentUserId;
}

export function safeNotificationAvatarUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!candidate || looksSensitive(candidate)) return null;
  if (candidate.startsWith("/") && !candidate.startsWith("//")) return candidate.slice(0, 2048);
  try {
    const url = new URL(candidate);
    const currentOrigin = typeof globalThis.location?.origin === "string"
      ? globalThis.location.origin
      : null;
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (!TRUSTED_NOTIFICATION_AVATAR_ORIGINS.has(url.origin) && url.origin !== currentOrigin)
    ) {
      return null;
    }
    return url.href.slice(0, 2048);
  } catch {
    return null;
  }
}

function asPayload(value: unknown): MessageNotificationPayload {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as MessageNotificationPayload
    : {};
}

function safeId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return /^[A-Za-z0-9:_-]{1,120}$/.test(normalized) ? normalized : null;
}

function safeText(value: unknown, fallback: string, limit: number): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized && !looksSensitive(normalized)
    ? normalized.slice(0, limit)
    : fallback;
}

function looksSensitive(value: string): boolean {
  const lower = value.toLowerCase();
  return lower.includes("/storage/v1/") ||
    lower.includes("/object/sign/") ||
    lower.includes("token=") ||
    lower.includes("password=") ||
    lower.includes("authorization=") ||
    lower.includes("signedurl") ||
    lower.includes("signed_url");
}
