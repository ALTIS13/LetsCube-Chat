import { parseMessageNotificationProjection } from "./messageNotificationProjection.ts";

type NotificationPresentationLike = {
  kind: string;
  payload: unknown;
};

export type BrowserNotificationReadBoundary = {
  notificationId: string;
  chatId: string;
  messageId: string;
} | {
  notificationId: string;
  subjectKind: "task" | "invite";
  subjectId: string;
};

export function browserNotificationReadBoundary(
  item: NotificationPresentationLike & { id: string; user_id: string; read_at: string | null },
  ownerId: string | null,
): BrowserNotificationReadBoundary | null {
  if (!notificationUuid(ownerId) || item.user_id !== ownerId || !item.read_at || !notificationUuid(item.id)) return null;
  const payload = item.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const row = payload as Record<string, unknown>;
  if (item.kind.includes("message")) {
    if (!notificationUuid(row.chat_id) || !notificationUuid(row.message_id)) return null;
    return { notificationId: item.id, chatId: row.chat_id, messageId: row.message_id };
  }
  const subjectKind = item.kind.startsWith("task_") ? "task" : item.kind === "group_invite" ? "invite" : null;
  const subjectId = subjectKind === "task" ? row.task_id : row.invite_id;
  return subjectKind && notificationUuid(subjectId) ? { notificationId: item.id, subjectKind, subjectId } : null;
}

function notificationUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
}

function notificationReadBoundaryTag(value: BrowserNotificationReadBoundary): string | null {
  if (Object.keys(value).length !== 3 || !notificationUuid(value.notificationId)) return null;
  if ("chatId" in value && "messageId" in value && notificationUuid(value.chatId) && notificationUuid(value.messageId)) {
    return `message:chat:${value.chatId}`;
  }
  if ("subjectKind" in value && "subjectId" in value && (value.subjectKind === "task" || value.subjectKind === "invite")
    && notificationUuid(value.subjectId)) return `${value.subjectKind}:${value.subjectId}`;
  return null;
}

export function notificationPresentationTag(
  item: NotificationPresentationLike,
): string | null {
  if (item.kind.includes("message")) {
    const projection = parseMessageNotificationProjection(item.payload);
    if (projection) return projection.groupTag;
  }
  const payload =
    item.payload && typeof item.payload === "object"
      ? (item.payload as Record<string, unknown>)
      : {};
  const explicit = safeValue(payload.tag);
  if (explicit) return explicit;

  const chatId = safeValue(payload.chat_id);
  if (item.kind.includes("message") && chatId) return `message:chat:${chatId}`;
  const taskId = safeValue(payload.task_id);
  if (taskId) return `task:${taskId}`;
  const inviteId = safeValue(payload.invite_id);
  if (inviteId) return `invite:${inviteId}`;
  return null;
}

export async function closeBrowserNotification(
  tag: string,
  isCurrent: () => boolean = () => true,
  expected: BrowserNotificationReadBoundary | null = null,
): Promise<void> {
  if (!expected || notificationReadBoundaryTag(expected) !== tag) return;
  // Snapshot before readiness yields; a queued close only owns this exact card.
  const boundary = { ...expected };
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator) || !isCurrent())
    return;
  try {
    const registration = await navigator.serviceWorker.ready;
    if (!isCurrent()) return;
    registration.active?.postMessage({ type: "KUB_CLOSE_NOTIFICATION_IF_MATCH", v: 1, tag, expected: boundary });
  } catch {
    // Notification read state remains authoritative even if presentation cleanup is unavailable.
  }
}

export async function updateBrowserAppBadge(
  unreadCount: number,
): Promise<void> {
  if (typeof navigator === "undefined") return;
  const badgeNavigator = navigator as Navigator & {
    setAppBadge?: (contents?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  try {
    if (unreadCount > 0 && badgeNavigator.setAppBadge) {
      await badgeNavigator.setAppBadge(unreadCount);
    } else if (unreadCount === 0 && badgeNavigator.clearAppBadge) {
      await badgeNavigator.clearAppBadge();
    }
  } catch {
    // Badging is optional and must not affect in-app notification state.
  }
}

function safeValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return /^[A-Za-z0-9:_-]{1,120}$/.test(normalized) ? normalized : null;
}
