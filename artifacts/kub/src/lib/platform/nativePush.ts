import { PushNotifications } from "@capacitor/push-notifications";
import { isNativeAndroid } from "./capabilities";
import { ANDROID_PUSH_UNAVAILABLE, PUSH_ENABLE_FAILED } from "../plainMessages";
import { parseMessageNotificationProjection } from "../messageNotificationProjection";
import { isReservedNativeVoiceData } from "./nativeVoiceContract";
import { waitForNativePushRegistration } from "./nativePushRegistration";
import { closeDeliveredChatNotification } from "./nativePushReadSync";

export type NativePushResultStatus =
  | "native_unavailable"
  | "native_inactive"
  | "native_registering"
  | "native_active"
  | "native_denied"
  | "native_setup_missing"
  | "migration_missing"
  | "native_error";

export type NativePushResult = {
  status: NativePushResultStatus;
  message: string;
};

export type NativePushTokenRegistration = (token: string) => Promise<NativePushResult | null | void>;
export type NativePushTokenUnregister = (token: string) => Promise<void>;

type PushNotificationsPlugin = typeof PushNotifications;
const NATIVE_PUSH_TIMEOUT_MS = 20_000;

/** D-132 (F2): see the note on `nativePushPendingMessage` in `capabilities.ts`. */
export function nativePushSetupMessage(): string {
  return ANDROID_PUSH_UNAVAILABLE;
}

export function nativePushPermissionHelp(): string {
  return "Разрешите уведомления в настройках приложения Android.";
}

export async function getNativePushPermissionStatus(): Promise<NativePushResult> {
  if (!isNativeAndroid()) {
    return { status: "native_unavailable", message: "Native push доступен только в Android-приложении." };
  }
  if (!hasCallableAndroidBridge()) {
    return { status: "native_setup_missing", message: nativePushSetupMessage() };
  }

  try {
    const push = PushNotifications;
    const permission = await push.checkPermissions();
    if (permission.receive === "denied") {
      return { status: "native_denied", message: nativePushPermissionHelp() };
    }
    if (permission.receive === "granted") {
      return { status: "native_inactive", message: "Уведомления Android доступны. Нажмите «Включить», чтобы зарегистрировать устройство." };
    }
    return { status: "native_inactive", message: "Нажмите «Включить», чтобы запросить разрешение Android и зарегистрировать устройство." };
  } catch (error) {
    return mapNativePushSetupError(error);
  }
}

export async function enableNativeAndroidPush(
  registerToken: NativePushTokenRegistration,
  requestPermission = true,
): Promise<NativePushResult> {
  if (!isNativeAndroid()) {
    return { status: "native_unavailable", message: "Native push доступен только в Android-приложении." };
  }
  if (!hasCallableAndroidBridge()) {
    return { status: "native_setup_missing", message: nativePushSetupMessage() };
  }

  try {
    const push = PushNotifications;
    await ensureAndroidNotificationChannels(push);

    let permission = await push.checkPermissions();
    if (permission.receive !== "granted" && requestPermission) {
      permission = await push.requestPermissions();
    }

    if (!requestPermission && permission.receive !== "granted" && permission.receive !== "denied") {
      return { status: "native_inactive", message: "Нажмите «Включить», чтобы разрешить уведомления Android." };
    }

    if (permission.receive !== "granted") {
      return { status: "native_denied", message: nativePushPermissionHelp() };
    }

    return await waitForNativePushRegistration(push, registerToken, {
      schedule: (callback) => window.setTimeout(callback, NATIVE_PUSH_TIMEOUT_MS),
      cancel: (id) => window.clearTimeout(id),
      onError: mapNativePushSetupError,
    });
  } catch (error) {
    return mapNativePushSetupError(error);
  }
}

export async function disableNativeAndroidPush(
  token: string | null,
  unregisterToken: NativePushTokenUnregister,
  canCommit: () => boolean = () => true,
): Promise<NativePushResult> {
  if (!isNativeAndroid()) {
    return { status: "native_unavailable", message: "Native push доступен только в Android-приложении." };
  }
  if (!hasCallableAndroidBridge()) {
    return { status: "native_setup_missing", message: nativePushSetupMessage() };
  }

  try {
    const push = PushNotifications;
    if (!canCommit()) return { status: "native_inactive", message: "" };
    if (token) await unregisterToken(token);
    if (!canCommit()) return { status: "native_inactive", message: "" };
    await push.unregister();
    return { status: "native_inactive", message: "Push-уведомления Android выключены для этого устройства." };
  } catch (error) {
    return mapNativePushSetupError(error);
  }
}

export async function registerNativePushNavigationListeners(
  openTarget: (rawTarget: string) => void,
): Promise<() => void> {
  if (!isNativeAndroid()) return () => undefined;
  if (!hasCallableAndroidBridge()) return () => undefined;

  try {
    const push = PushNotifications;
    const received = await push.addListener("pushNotificationReceived", () => {
      // Foreground notifications are already represented by in-app notification state.
      // OS delivery remains a transport layer, not a second notification source.
    });
    const action = await push.addListener("pushNotificationActionPerformed", (event) => {
      const target = getNotificationTarget(event.notification.data);
      if (target) openTarget(target);
    });
    return () => {
      void received.remove();
      void action.remove();
    };
  } catch {
    return () => undefined;
  }
}

export async function closeNativeChatNotification(tag: string): Promise<void> {
  if (!isNativeAndroid() || !hasCallableAndroidBridge()) return;
  try {
    await closeDeliveredChatNotification(PushNotifications, tag);
  } catch {
    // The server read state remains authoritative if Android card cleanup fails.
  }
}

async function ensureAndroidNotificationChannels(push: PushNotificationsPlugin): Promise<void> {
  const channels = [
    {
      id: "messages",
      name: "Сообщения",
      description: "Сообщения из чатов LETSCUBE",
      importance: 3 as const,
      visibility: 0 as const,
      vibration: true,
    },
    {
      id: "tasks",
      name: "Задачи",
      description: "Назначения, сроки и рабочие задачи",
      importance: 4 as const,
      visibility: 0 as const,
      vibration: true,
    },
    {
      id: "system",
      name: "Системные",
      description: "Приглашения и системные уведомления",
      importance: 3 as const,
      visibility: 0 as const,
      vibration: true,
    },
  ];

  for (const channel of channels) {
    try {
      await push.createChannel(channel);
    } catch {
      // Channel creation is Android-only and idempotent; delivery can still
      // continue if an old WebView/bridge rejects a duplicate channel.
    }
  }
}

function getNotificationTarget(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  if (isReservedNativeVoiceData(data)) return null;
  const payload = data as Record<string, unknown>;
  const messageProjection = parseMessageNotificationProjection(payload);
  if (messageProjection) return messageProjection.route;
  const route = typeof payload.route === "string" ? payload.route : null;
  if (route) return route;

  const chatId = typeof payload.chat_id === "string" ? payload.chat_id : null;
  if (chatId) {
    const params = new URLSearchParams({ chat: chatId });
    const messageId = typeof payload.message_id === "string" ? payload.message_id : null;
    if (messageId) params.set("message", messageId);
    return `/?${params.toString()}`;
  }

  const taskId = typeof payload.task_id === "string" ? payload.task_id : null;
  if (taskId) return `/tasks?task=${encodeURIComponent(taskId)}`;

  return null;
}

/**
 * The provider's own words, read for the status they imply and then dropped.
 *
 * D-132 (F2). The text this reads is an Android/Firebase message in English;
 * matching on it is the only way to tell a missing delivery configuration from
 * a refused permission, so the matching stays. What changed is that the text
 * itself no longer travels to the screen: the caller gets the status and a
 * sentence about the situation. Provider text is never logged: it may carry a
 * registration token or a payload.
 */
function mapNativePushSetupError(error: unknown): NativePushResult {
  const text = getErrorText(error);
  const lower = text.toLowerCase();
  console.error("native push setup failed");
  if (
    lower.includes("firebase") ||
    lower.includes("fcm") ||
    lower.includes("google") ||
    lower.includes("missing") ||
    lower.includes("default firebaseapp")
  ) {
    return { status: "native_setup_missing", message: ANDROID_PUSH_UNAVAILABLE };
  }
  if (lower.includes("permission") || lower.includes("denied")) {
    return { status: "native_denied", message: nativePushPermissionHelp() };
  }
  return { status: "native_error", message: PUSH_ENABLE_FAILED };
}

function getErrorText(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object") {
    const item = error as { error?: unknown; message?: unknown };
    return [item.error, item.message].filter((value) => typeof value === "string").join(" ");
  }
  return "";
}

function hasCallableAndroidBridge(): boolean {
  if (typeof window === "undefined") return false;
  const bridge = (window as Window & { androidBridge?: { postMessage?: unknown } }).androidBridge;
  return Boolean(bridge && typeof bridge.postMessage === "function");
}
