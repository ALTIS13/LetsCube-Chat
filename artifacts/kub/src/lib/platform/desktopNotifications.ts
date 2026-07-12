import { isDesktopApp } from "./desktop.ts";

type DesktopNotificationPermission = "default" | "denied" | "granted";

export type DesktopMessageNotification = {
  title: string;
  body: string;
  tag: string;
  icon?: string;
};

type DesktopNotificationPayload = {
  title: string;
  body: string;
  tag?: string;
  icon?: string;
};

type DesktopNotificationApi = {
  isPermissionGranted(): Promise<boolean>;
  requestPermission(): Promise<DesktopNotificationPermission>;
  sendNotification(notification: DesktopNotificationPayload): void;
};

export type DesktopNotificationApiLoader = () => Promise<DesktopNotificationApi>;

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

export async function showDesktopMessageNotification(
  notification: DesktopMessageNotification,
  loadApi: DesktopNotificationApiLoader = loadDesktopNotificationApi,
  context: DesktopNotificationContext = {},
): Promise<boolean> {
  if (!isDesktopApp()) return false;
  const visibilityState = context.visibilityState
    ?? (typeof document === "undefined" ? "hidden" : document.visibilityState);
  if (visibilityState === "visible") return false;

  try {
    const api = await loadApi();
    const granted = await api.isPermissionGranted();
    if (!granted) {
      const permission = await api.requestPermission();
      if (permission !== "granted") return false;
    }
    api.sendNotification(notification);
    return true;
  } catch {
    return false;
  }
}
