import { nativePushCategory, nativePushDisplay } from "./native-push-privacy.ts";

export type PushPayload = Record<string, unknown>;

type FcmData = Record<string, string>;

export type FcmMessageEnvelope = {
  message: {
    token: string;
    notification?: {
      title: string;
      body: string;
      image?: string;
    };
    android: {
      priority: "HIGH" | "NORMAL";
      ttl: string;
      collapse_key?: string;
      notification?: {
        channel_id: "messages" | "tasks" | "system";
        tag: string;
        image?: string;
      };
    };
    data: FcmData;
  };
};

export function buildFcmMessage(payload: PushPayload, token: string, appVersion?: string | null): FcmMessageEnvelope {
  const kind = safeText(payload.kind, "system", 60);
  const category = nativePushCategory(kind);
  const chatId = safeText(payload.chatId ?? payload.chat_id, "", 80);
  const messageId = safeText(payload.messageId ?? payload.message_id, "", 80);
  const taskId = safeText(payload.taskId ?? payload.task_id, "", 80);
  const notificationId = safeText(payload.notificationId ?? payload.notification_id, "", 80);
  const defaultTag = category === "message" && chatId
    ? `message:chat:${chatId}`
    : category === "task" && taskId
      ? `task:${taskId}`
      : `system:${kind}`;
  const tag = safeText(payload.tag, defaultTag, 100);
  const route = safeRelativeUrl(payload.url ?? payload.route);
  const channelId = category === "message" ? "messages" : category === "task" ? "tasks" : "system";
  const data: FcmData = {
    type: category,
    route,
  };

  if (chatId) data.chat_id = chatId;
  if (messageId) data.message_id = messageId;
  if (taskId) data.task_id = taskId;
  if (notificationId) data.notification_id = notificationId;
  if (tag) data.tag = tag;
  if (category === "message" && chatId) data.group_tag = `message:chat:${chatId}`;

  const { title, body } = nativePushDisplay(category);
  // Notification messages ignore collapse_key in FCM's offline queue. New
  // Android shells display chat data themselves; older APKs retain auto-display.
  if (category === "message" && supportsNativeChatData(appVersion)) {
    return {
      message: {
        token,
        android: { priority: "HIGH", ttl: "86400s" },
        data: { ...data, title, body, native_chat_v: "1" },
      },
    };
  }

  return {
    message: {
      token,
      notification: { title, body },
      android: {
        priority: category === "message" || category === "task" ? "HIGH" : "NORMAL",
        ttl: "86400s",
        collapse_key: tag,
        notification: { channel_id: channelId, tag },
      },
      data,
    },
  };
}

function supportsNativeChatData(version: string | null | undefined): boolean {
  const parts = /^(\d+)\.(\d+)\.(\d+)(?:$|[+-])/.exec(version ?? "");
  if (!parts) return false;
  const [major, minor, patch] = parts.slice(1).map(Number);
  return major > 0 || minor > 1 || (minor === 1 && patch >= 8);
}

export function isPermanentFcmTokenError(status: number, body: unknown): boolean {
  if (!body || typeof body !== "object") return false;

  const error = (body as { error?: unknown }).error;
  if (!error || typeof error !== "object") return false;
  const details = (error as { details?: unknown }).details;
  if (!Array.isArray(details)) return false;

  if (status === 400 && details.some((detail) =>
    detail && typeof detail === "object" &&
    (detail as { "@type"?: unknown })["@type"] === "type.googleapis.com/google.rpc.BadRequest"
  )) return false;

  return details.some((detail) => {
    if (!detail || typeof detail !== "object") return false;
    const type = (detail as { "@type"?: unknown })["@type"];
    const code = (detail as { errorCode?: unknown }).errorCode;
    if (type !== "type.googleapis.com/google.firebase.fcm.v1.FcmError") return false;
    return (
      (status === 404 && code === "UNREGISTERED") ||
      (status === 403 && code === "SENDER_ID_MISMATCH") ||
      (status === 400 && code === "INVALID_ARGUMENT")
    );
  });
}

function safeText(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== "string") return fallback;
  const text = value.trim();
  if (!text || looksSensitive(text)) return fallback;
  return text.slice(0, maxLength);
}

function safeRelativeUrl(value: unknown): string {
  if (typeof value !== "string" || looksSensitive(value)) return "/";
  try {
    const url = new URL(value, "https://app.letscube.ru");
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

function looksSensitive(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    lower.includes("/storage/v1/") ||
    lower.includes("/object/sign/") ||
    lower.includes("token=") ||
    lower.includes("password=") ||
    lower.includes("authorization=") ||
    lower.includes("signedurl") ||
    lower.includes("signed_url")
  );
}
