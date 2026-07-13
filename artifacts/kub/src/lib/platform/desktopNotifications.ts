import { getDesktopBridge, isDesktopApp } from "./desktop.ts";
import { notificationPresentationTag } from "../browserNotificationPresentation.ts";
import type { Notification } from "../../types/database.ts";

type DesktopNotificationPermission = "default" | "denied" | "granted";

export type DesktopMessageNotification = {
  title: string;
  body: string;
  tag: string;
  icon?: string;
  kind?: "message" | "task" | "system";
  route?: string;
};

type DesktopNotificationPayload = {
  id: number;
  title: string;
  body: string;
  group: string;
  icon?: string;
  extra?: {
    kind: "message" | "task" | "system";
    route: string;
  };
};

type DesktopNotificationApi = {
  isPermissionGranted(): Promise<boolean>;
  requestPermission(): Promise<DesktopNotificationPermission>;
  sendNotification(notification: DesktopNotificationPayload): void;
};

type DesktopNotificationAction = {
  extra?: Record<string, unknown>;
};

type DesktopNotificationActionListener = {
  unregister(): Promise<void>;
};

type DesktopNotificationActionApi = {
  onAction(
    callback: (notification: DesktopNotificationAction) => void,
  ): Promise<DesktopNotificationActionListener>;
};

export type DesktopNotificationApiLoader =
  () => Promise<DesktopNotificationApi>;

export type DesktopNotificationContext = {
  visibilityState?: DocumentVisibilityState;
};

async function loadDesktopNotificationApi(): Promise<DesktopNotificationApi> {
  const plugin = await import("@tauri-apps/plugin-notification");
  return {
    isPermissionGranted: plugin.isPermissionGranted,
    requestPermission: plugin.requestPermission,
    sendNotification: plugin.sendNotification,
  };
}

async function loadDesktopNotificationActionApi(): Promise<DesktopNotificationActionApi> {
  const plugin = await import("@tauri-apps/plugin-notification");
  return { onAction: plugin.onAction };
}

export async function showDesktopMessageNotification(
  notification: DesktopMessageNotification,
  loadApi: DesktopNotificationApiLoader = loadDesktopNotificationApi,
  context: DesktopNotificationContext = {},
): Promise<boolean> {
  if (!isDesktopApp()) return false;
  const visibilityState =
    context.visibilityState ??
    (typeof document === "undefined" ? "hidden" : document.visibilityState);
  if (visibilityState === "visible") return false;

  try {
    const api = await loadApi();
    const granted = await api.isPermissionGranted();
    if (!granted) {
      const permission = await api.requestPermission();
      if (permission !== "granted") return false;
    }
    const payload: DesktopNotificationPayload = {
      id: stableDesktopNotificationId(notification.tag),
      title: notification.title,
      body: notification.body,
      group: notification.tag,
    };
    if (notification.icon) payload.icon = notification.icon;
    if (notification.kind && notification.route) {
      payload.extra = {
        kind: notification.kind,
        route: notification.route,
      };
    }
    api.sendNotification(payload);
    return true;
  } catch {
    return false;
  }
}

export async function showDesktopNotificationForRow(
  item: Notification,
  loadApi: DesktopNotificationApiLoader = loadDesktopNotificationApi,
  context: DesktopNotificationContext = {},
): Promise<boolean> {
  if (item.read_at) return false;
  const presentation = desktopPresentation(item);
  return presentation
    ? showDesktopMessageNotification(presentation, loadApi, context)
    : false;
}

export async function registerDesktopNotificationNavigationListener(
  openTarget: (target: string) => void,
  loadApi: () => Promise<DesktopNotificationActionApi> = loadDesktopNotificationActionApi,
  restoreMain: () => Promise<void> = async () => {
    await getDesktopBridge()?.showMain();
  },
): Promise<() => void> {
  if (!isDesktopApp()) return () => undefined;
  try {
    const api = await loadApi();
    const listener = await api.onAction((notification) => {
      const route = safeDesktopRoute(notification.extra?.route);
      if (!route) return;
      void restoreMain()
        .then(() => openTarget(route))
        .catch(() => undefined);
    });
    return () => {
      void listener.unregister();
    };
  } catch {
    return () => undefined;
  }
}

function desktopPresentation(
  item: Notification,
): DesktopMessageNotification | null {
  const tag = notificationPresentationTag(item) ?? `system:${item.kind}`;
  const payload = asPayload(item.payload);
  const chatId = payloadValue(payload, "chat_id");
  const messageId = payloadValue(payload, "message_id");
  const taskId = payloadValue(payload, "task_id");
  const sender = payloadText(payload, "sender_name");
  const chatName = payloadText(payload, "chat_name");
  const taskTitle = payloadText(payload, "title");
  const preview = sanitizeDesktopText(
    payloadText(payload, "preview") ??
      payloadText(payload, "body") ??
      payloadText(payload, "message") ??
      payloadText(payload, "content"),
  );

  if (item.kind.includes("message") && chatId) {
    const privateChat = payloadText(payload, "chat_type") === "private";
    return {
      title: truncateDesktopText(
        privateChat
          ? (sender ?? "Новое сообщение")
          : (chatName ?? "Новое сообщение"),
      ),
      body: truncateDesktopText(
        privateChat
          ? preview || "Откройте чат, чтобы посмотреть сообщение."
          : sender && preview
            ? `${sender}: ${preview}`
            : preview || "Откройте чат, чтобы посмотреть сообщение.",
      ),
      tag,
      kind: "message",
      route: `/?chat=${encodeURIComponent(chatId)}${messageId ? `&message=${encodeURIComponent(messageId)}` : ""}`,
    };
  }

  if (item.kind.includes("task")) {
    return {
      title:
        item.kind === "task_assigned" ? "Новая задача" : "Обновление задачи",
      body: taskTitle
        ? truncateDesktopText(taskTitle)
        : "Откройте LETSCUBE, чтобы посмотреть задачу.",
      tag,
      kind: "task",
      route: taskId ? `/tasks?task=${encodeURIComponent(taskId)}` : "/tasks",
    };
  }

  const inviteId = payloadValue(payload, "invite_id");
  if (item.kind === "group_invite" || item.kind === "chat_added") {
    return {
      title: item.kind === "group_invite" ? "Новое приглашение" : "Новый чат",
      body: chatName
        ? truncateDesktopText(chatName)
        : "Откройте LETSCUBE, чтобы посмотреть детали.",
      tag: inviteId ? `invite:${inviteId}` : tag,
      kind: "system",
      route: chatId ? `/?chat=${encodeURIComponent(chatId)}` : "/",
    };
  }

  return {
    title: "LETSCUBE",
    body: preview || "Новое системное уведомление.",
    tag,
    kind: "system",
    route: "/",
  };
}

function stableDesktopNotificationId(tag: string): number {
  let hash = 2166136261;
  for (let index = 0; index < tag.length; index += 1) {
    hash ^= tag.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) & 0x7fffffff || 1;
}

function safeDesktopRoute(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//")
  )
    return null;
  try {
    const route = new URL(value, "https://local.letscube.invalid");
    if (route.origin !== "https://local.letscube.invalid") return null;
    return `${route.pathname}${route.search}${route.hash}`;
  } catch {
    return null;
  }
}

function asPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function payloadValue(
  payload: Record<string, unknown>,
  key: string,
): string | null {
  const value = payload[key];
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return /^[A-Za-z0-9:_-]{1,120}$/.test(normalized) ? normalized : null;
}

function payloadText(
  payload: Record<string, unknown>,
  key: string,
): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sanitizeDesktopText(value: string | null): string {
  if (!value) return "";
  return truncateDesktopText(value.replace(/https?:\/\/\S+/gi, "вложение"));
}

function truncateDesktopText(value: string, limit = 140): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > limit
    ? `${normalized.slice(0, limit - 1)}…`
    : normalized;
}
