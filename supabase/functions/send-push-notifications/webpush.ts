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
  previewSelector?: unknown,
  compatibleWorker: boolean = false,
): SafeWebPushPayload & Record<string, unknown> {
  // A subscription can outlive the account in this browser, and an already
  // accepted push can arrive after logout. WebKit may display this declarative
  // fallback without running our service worker, so both display paths must
  // carry no sender or message content. Keep only routing/grouping metadata.
  const neutral: SafeWebPushPayload & Record<string, unknown> = {
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
  delete neutral.web_preview;
  delete neutral.notificationId;
  const selector = previewSelector && typeof previewSelector === "object" && !Array.isArray(previewSelector)
    ? previewSelector as Record<string, unknown>
    : null;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if ((payload.kind.startsWith("task_") || payload.kind === "group_invite")
    && typeof selector?.subscriptionId === "string" && uuid.test(selector.subscriptionId)
    && typeof selector.notificationId === "string" && uuid.test(selector.notificationId)) {
    neutral.notificationId = selector.notificationId.toLowerCase();
  }
  if (payload.kind === "message" && typeof selector?.subscriptionId === "string" &&
    uuid.test(selector.subscriptionId) && typeof selector.notificationId === "string" && uuid.test(selector.notificationId)) {
    // Selectors are not display authority. The worker must obtain fresh content.
    neutral.web_preview = {
      preview_v: 1,
      subscription_id: selector.subscriptionId.toLowerCase(),
      notification_id: selector.notificationId.toLowerCase(),
    };
  }
  const appOrigin = safeHttpsOrigin(configuredAppOrigin);
  if (!appOrigin) return neutral;

  return {
    ...neutral,
    web_push: 8030,
    // Declarative clients skip the worker unless mutation is requested. Their
    // PushEvent carries Notification.data rather than the original JSON bytes.
    // Older mutable workers reject extra Notification.data fields. Nonmessage
    // cards are already generic, so preserve their exact route/data directly.
    mutable: compatibleWorker === true && !neutral.notificationId,
    notification: {
      title: neutral.title,
      body: neutral.body,
      navigate: new URL(neutral.url, appOrigin).href,
      tag: neutral.tag,
      data: {
        kind: neutral.kind,
        url: neutral.url,
        tag: neutral.tag,
        chatId: neutral.chatId,
        messageId: neutral.messageId,
        renotify: neutral.renotify,
        ...(neutral.notificationId ? { notificationId: neutral.notificationId } : {}),
        ...(neutral.web_preview ? { web_preview: neutral.web_preview } : {}),
      },
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
