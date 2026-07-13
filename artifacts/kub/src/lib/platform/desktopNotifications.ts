import { getDesktopBridge, isDesktopApp } from "./desktop.ts";
import { notificationPresentationTag } from "../browserNotificationPresentation.ts";
import type { Notification } from "../../types/database.ts";

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
  kind: "message" | "task" | "system";
  route: string;
};

type DesktopNotificationApi = {
  sendNotification(notification: DesktopNotificationPayload): Promise<boolean>;
  removeNotification?(notification: Pick<DesktopNotificationPayload, "id" | "kind">): Promise<boolean>;
};

type DesktopNotificationActionListener = {
  unregister(): Promise<void>;
};

type DesktopNotificationActionApi = {
  onAction(
    callback: (route: unknown) => void,
  ): Promise<DesktopNotificationActionListener>;
  takePendingRoute?(): Promise<unknown>;
};

export type DesktopNotificationApiLoader =
  () => Promise<DesktopNotificationApi>;

export type DesktopNotificationContext = {
  visibilityState?: DocumentVisibilityState;
  isMainForeground?: () => Promise<boolean | null>;
};

async function loadDesktopNotificationApi(): Promise<DesktopNotificationApi> {
  const bridge = getDesktopBridge();
  if (!bridge) throw new Error("desktop_runtime_unavailable");
  return {
    sendNotification: (notification) => bridge.notify(notification),
    removeNotification: (notification) => bridge.removeNotification(notification),
  };
}

async function loadDesktopNotificationActionApi(): Promise<DesktopNotificationActionApi> {
  const bridge = getDesktopBridge();
  if (typeof window === "undefined" || !bridge) throw new Error("desktop_runtime_unavailable");
  return {
    async onAction(callback) {
      const listener = () => {
        void bridge.takePendingNotificationRoute()
          .then((route) => {
            if (route != null) callback(route);
          })
          .catch(() => undefined);
      };
      window.addEventListener("letscube:desktop-notification-action", listener);
      return {
        async unregister() {
          window.removeEventListener("letscube:desktop-notification-action", listener);
        },
      };
    },
    takePendingRoute: () => bridge.takePendingNotificationRoute(),
  };
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
  let nativeVisibility: boolean | null = null;
  const resolveNativeVisibility =
    context.isMainForeground ?? getDesktopBridge()?.isMainForeground;
  if (resolveNativeVisibility) {
    try {
      nativeVisibility = await resolveNativeVisibility();
    } catch {
      nativeVisibility = null;
    }
  }
  if (nativeVisibility ?? visibilityState === "visible") return false;

  try {
    const api = await loadApi();
    const payload: DesktopNotificationPayload = {
      id: stableDesktopNotificationId(notification.tag),
      title: notification.title,
      body: notification.body,
      kind: notification.kind ?? "system",
      route: notification.route ?? "/",
    };
    return await api.sendNotification(payload);
  } catch {
    return false;
  }
}

export async function closeDesktopNotificationForRow(
  item: Notification,
  loadApi: DesktopNotificationApiLoader = loadDesktopNotificationApi,
): Promise<boolean> {
  if (!isDesktopApp()) return false;
  const presentation = desktopPresentation(item);
  if (!presentation) return false;
  try {
    const api = await loadApi();
    if (!api.removeNotification) return false;
    return await api.removeNotification({
      id: stableDesktopNotificationId(presentation.tag),
      kind: presentation.kind ?? "system",
    });
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
    const openRoute = (rawRoute: unknown) => {
      const route = safeDesktopRoute(rawRoute);
      if (!route) return;
      void restoreMain()
        .then(() => openTarget(route))
        .catch(() => undefined);
    };
    const listener = await api.onAction(openRoute);
    const pendingRoute = await api.takePendingRoute?.();
    if (pendingRoute != null) openRoute(pendingRoute);
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
