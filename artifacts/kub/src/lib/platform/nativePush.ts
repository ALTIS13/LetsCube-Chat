import { PushNotifications } from "@capacitor/push-notifications";
import { isNativeAndroid } from "./capabilities";

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
type PluginListenerHandle = Awaited<ReturnType<PushNotificationsPlugin["addListener"]>>;

const NATIVE_PUSH_TIMEOUT_MS = 20_000;

export function nativePushSetupMessage(): string {
  return "Android push работает через Firebase/FCM. Для доставки нужны локальный google-services.json, применённая migration user_push_devices и backend FCM credentials.";
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
    if (permission.receive !== "granted") {
      permission = await push.requestPermissions();
    }

    if (permission.receive !== "granted") {
      return { status: "native_denied", message: nativePushPermissionHelp() };
    }

    return await waitForRegistration(push, registerToken);
  } catch (error) {
    return mapNativePushSetupError(error);
  }
}

export async function disableNativeAndroidPush(
  token: string | null,
  unregisterToken: NativePushTokenUnregister,
): Promise<NativePushResult> {
  if (!isNativeAndroid()) {
    return { status: "native_unavailable", message: "Native push доступен только в Android-приложении." };
  }
  if (!hasCallableAndroidBridge()) {
    return { status: "native_setup_missing", message: nativePushSetupMessage() };
  }

  try {
    const push = PushNotifications;
    if (token) await unregisterToken(token);
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

async function waitForRegistration(
  push: PushNotificationsPlugin,
  registerToken: NativePushTokenRegistration,
): Promise<NativePushResult> {
  let registrationHandle: PluginListenerHandle | null = null;
  let errorHandle: PluginListenerHandle | null = null;

  return new Promise<NativePushResult>((resolve) => {
    let settled = false;
    const finish = (result: NativePushResult) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      void registrationHandle?.remove();
      void errorHandle?.remove();
      resolve(result);
    };

    const timeoutId = window.setTimeout(() => {
      finish({
        status: "native_setup_missing",
        message: "Не удалось зарегистрировать устройство для push-уведомлений. Проверьте настройку Firebase/FCM.",
      });
    }, NATIVE_PUSH_TIMEOUT_MS);

    Promise.all([
      push.addListener("registration", async (token) => {
        try {
          const backendResult = await registerToken(token.value);
          finish(backendResult ?? {
            status: "native_active",
            message: "Push-уведомления Android включены для этого устройства.",
          });
        } catch (error) {
          finish(mapNativePushSetupError(error));
        }
      }),
      push.addListener("registrationError", (error) => {
        finish(mapNativePushSetupError(error));
      }),
    ])
      .then(([registration, registrationError]) => {
        registrationHandle = registration;
        errorHandle = registrationError;
        return push.register();
      })
      .catch((error) => finish(mapNativePushSetupError(error)));
  });
}

function getNotificationTarget(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const payload = data as Record<string, unknown>;
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

function mapNativePushSetupError(error: unknown): NativePushResult {
  const text = getErrorText(error);
  const lower = text.toLowerCase();
  if (
    lower.includes("firebase") ||
    lower.includes("fcm") ||
    lower.includes("google") ||
    lower.includes("missing") ||
    lower.includes("default firebaseapp")
  ) {
    return {
      status: "native_setup_missing",
      message: "Firebase/FCM не настроен для Android push. Проверьте google-services.json и backend credentials.",
    };
  }
  if (lower.includes("permission") || lower.includes("denied")) {
    return { status: "native_denied", message: nativePushPermissionHelp() };
  }
  return {
    status: "native_error",
    message: "Не удалось включить Android push. Проверьте настройки приложения и попробуйте ещё раз.",
  };
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
