export type SafeWebPushPayload = {
  title: string;
  body: string;
  url: string;
  tag: string;
  kind: string;
  chatId: string;
  messageId: string;
  senderKind: "user" | "bot" | "";
  senderId: string;
  botId: string;
  senderName: string;
  senderAvatarUrl: string;
  messageType: string;
  preview: string;
  groupTag: string;
  renotify: boolean;
};

export function buildDeclarativeWebPushPayload(
  payload: SafeWebPushPayload,
  configuredAppOrigin: string | undefined,
): SafeWebPushPayload & Record<string, unknown> {
  // A subscription can outlive the account in this browser, and an already
  // accepted push can arrive after logout. WebKit may display this declarative
  // fallback without running our service worker, so both display paths must
  // carry no sender or message content. Keep only routing/grouping metadata.
  const neutral: SafeWebPushPayload = {
    ...payload,
    title: "LETSCUBE",
    body: "Новое уведомление",
    senderKind: "",
    senderId: "",
    botId: "",
    senderName: "",
    senderAvatarUrl: "",
    messageType: "",
    preview: "",
  };
  const appOrigin = safeHttpsOrigin(configuredAppOrigin);
  if (!appOrigin) return neutral;

  return {
    ...neutral,
    web_push: 8030,
    notification: {
      title: neutral.title,
      body: neutral.body,
      navigate: new URL(neutral.url, appOrigin).href,
      tag: neutral.tag,
    },
  };
}

export async function createWebPushTopic(tag: string): Promise<string | null> {
  const normalized = tag.trim();
  if (!normalized || normalized === "kub-notification") return null;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(normalized),
  );
  return base64UrlBytes(new Uint8Array(digest)).slice(0, 32);
}

export function getWebPushUrgency(kind: string): "high" | "normal" {
  const normalized = kind.toLowerCase();
  return normalized.includes("message") ||
    normalized.includes("task") ||
    normalized.includes("invite")
    ? "high"
    : "normal";
}

export function readWebPushErrorReason(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const body = (error as { body?: unknown }).body;
  let parsed: unknown = body;
  if (typeof body === "string") {
    try {
      parsed = JSON.parse(body);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object") return null;
  const reason = (parsed as { reason?: unknown }).reason;
  return typeof reason === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(reason)
    ? reason
    : null;
}

export function isPermanentWebPushSubscriptionError(
  status: number | undefined,
  reason: string | null,
): boolean {
  return (
    status === 404 ||
    status === 410 ||
    (status === 403 && reason === "VapidPkHashMismatch")
  );
}

function safeHttpsOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hostname === "localhost"
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

function base64UrlBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
