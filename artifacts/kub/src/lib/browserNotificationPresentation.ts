import { parseMessageNotificationProjection } from "./messageNotificationProjection.ts";

type NotificationPresentationLike = {
  kind: string;
  payload: unknown;
};

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

export async function closeBrowserNotification(tag: string): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator))
    return;
  try {
    const registration = await navigator.serviceWorker.ready;
    registration.active?.postMessage({ type: "KUB_CLOSE_NOTIFICATION", tag });
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
