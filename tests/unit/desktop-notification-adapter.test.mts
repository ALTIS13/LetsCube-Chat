import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  closeDesktopNotificationForRow,
  showDesktopMessageNotification,
} from "../../artifacts/kub/src/lib/platform/desktopNotifications.ts";
import * as desktopNotifications from "../../artifacts/kub/src/lib/platform/desktopNotifications.ts";

type WindowWithDesktopBridge = typeof window & {
  letscubeDesktop?: {
    platform: "windows";
    getRuntimeInfo(): Promise<{
      platform: "windows";
      version: string;
      build: number;
    }>;
  };
};

function installDesktopBridge(): typeof window | undefined {
  const previousWindow = globalThis.window;
  const runtimeInfo = {
    platform: "windows" as const,
    version: "0.2.0",
    build: 4,
  };

  globalThis.window = {
    letscubeDesktop: {
      platform: "windows",
      getRuntimeInfo: async () => runtimeInfo,
    },
  } as WindowWithDesktopBridge;

  return previousWindow;
}

test("desktop notification adapter stays inert for a regular browser", async () => {
  const previousWindow = globalThis.window;
  let loaderCalls = 0;

  try {
    globalThis.window = undefined as typeof window;

    const delivered = await showDesktopMessageNotification(
      { title: "LETSCUBE", body: "Новое сообщение", tag: "chat-1" },
      async () => {
        loaderCalls += 1;
        return {
          sendNotification: async () => true,
        };
      },
    );

    assert.equal(delivered, false);
    assert.equal(loaderCalls, 0);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("desktop notification adapter stays inert for Capacitor Android", async () => {
  const previousWindow = globalThis.window;
  let loaderCalls = 0;

  try {
    globalThis.window = {
      Capacitor: {
        getPlatform: () => "android",
        isNativePlatform: () => true,
      },
    } as typeof window;

    const delivered = await showDesktopMessageNotification(
      { title: "LETSCUBE", body: "Новое сообщение", tag: "chat-android" },
      async () => {
        loaderCalls += 1;
        throw new Error("Tauri loader must not run on Android");
      },
      { visibilityState: "hidden" },
    );

    assert.equal(delivered, false);
    assert.equal(loaderCalls, 0);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("desktop notification adapter maps a stable tag and route to native Windows options", async () => {
  const previousWindow = installDesktopBridge();
  const notifications: Array<Record<string, unknown>> = [];
  let loaderCalls = 0;

  try {
    const delivered = await showDesktopMessageNotification(
      {
        title: "LETSCUBE",
        body: "Новое сообщение",
        tag: "message:chat:chat-1",
        kind: "message",
        route: "/?chat=chat-1&message=message-1",
      },
      async () => {
        loaderCalls += 1;
        return {
          sendNotification: async (notification) => {
            notifications.push(notification);
            return true;
          },
        };
      },
      { visibilityState: "hidden" },
    );

    assert.equal(delivered, true);
    assert.equal(loaderCalls, 1);
    assert.equal(notifications.length, 1);
    const { id, ...nativeOptions } = notifications[0] ?? {};
    assert.equal(Number.isInteger(id), true);
    assert.equal(Number(id) > 0, true);
    assert.deepEqual(nativeOptions, {
      title: "LETSCUBE",
      body: "Новое сообщение",
      kind: "message",
      route: "/?chat=chat-1&message=message-1",
    });
  } finally {
    globalThis.window = previousWindow;
  }
});

test("desktop notification adapter stays silent while the app window is visible", async () => {
  const previousWindow = installDesktopBridge();
  let loaderCalls = 0;

  try {
    const delivered = await showDesktopMessageNotification(
      { title: "LETSCUBE", body: "Новое сообщение", tag: "chat-visible" },
      async () => {
        loaderCalls += 1;
        throw new Error("notification API must not load for a visible chat");
      },
      { visibilityState: "visible" },
    );

    assert.equal(delivered, false);
    assert.equal(loaderCalls, 0);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("desktop notification adapter trusts the native background-window state over WebView visibility", async () => {
  const previousWindow = installDesktopBridge();
  let sent = false;

  try {
    const delivered = await showDesktopMessageNotification(
      { title: "LETSCUBE", body: "Новое сообщение", tag: "chat-native-hidden" },
      async () => ({
        sendNotification: async () => {
          sent = true;
          return true;
        },
      }),
      {
        visibilityState: "visible",
        isMainForeground: async () => false,
      },
    );

    assert.equal(delivered, true);
    assert.equal(sent, true);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("desktop notification adapter reports a sanitized native delivery failure", async () => {
  const previousWindow = installDesktopBridge();
  let sent = false;

  try {
    const delivered = await showDesktopMessageNotification(
      { title: "LETSCUBE", body: "Новое сообщение", tag: "chat-1" },
      async () => ({
        sendNotification: async () => {
          sent = true;
          return false;
        },
      }),
      { visibilityState: "hidden" },
    );

    assert.equal(delivered, false);
    assert.equal(sent, true);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("desktop notification adapter removes a read notification by the same stable tag and group", async () => {
  const previousWindow = installDesktopBridge();
  const removed: Array<Record<string, unknown>> = [];
  try {
    const row = {
      id: "notification-1",
      user_id: "user-2",
      kind: "message",
      read_at: "2026-07-13T18:05:00.000Z",
      created_at: "2026-07-13T18:00:00.000Z",
      payload: {
        chat_id: "chat-1",
        message_id: "message-1",
        chat_type: "private",
        sender_name: "Никита",
        preview: "Привет",
      },
    };

    const removedNative = await closeDesktopNotificationForRow(
      row,
      async () => ({
        sendNotification: async () => true,
        removeNotification: async (notification) => {
          removed.push(notification);
          return true;
        },
      }),
    );

    assert.equal(removedNative, true);
    assert.equal(removed.length, 1);
    assert.equal(Number.isInteger(removed[0]?.id), true);
    assert.equal(removed[0]?.kind, "message");
  } finally {
    globalThis.window = previousWindow;
  }
});

test("Windows settings copy describes tray delivery without claiming killed-process push", () => {
  const source = readFileSync(
    new URL("../../artifacts/kub/src/hooks/usePush.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /пока LETSCUBE запущен/i);
  assert.match(source, /полного выхода/i);

  const settingsSource = readFileSync(
    new URL("../../artifacts/kub/src/components/sidebar/SettingsModal.tsx", import.meta.url),
    "utf8",
  );
  assert.match(settingsSource, /пока приложение запущено/i);
  assert.doesNotMatch(settingsSource, /Системные уведомления Windows готовятся/i);
});

test("desktop notification delivery is owned by Notification Center realtime, not the active chat hook", () => {
  const notificationHook = readFileSync(
    new URL("../../artifacts/kub/src/hooks/useNotifications.ts", import.meta.url),
    "utf8",
  );
  const messagesHook = readFileSync(
    new URL("../../artifacts/kub/src/hooks/useMessages.ts", import.meta.url),
    "utf8",
  );

  assert.match(notificationHook, /showDesktopNotificationForRow/);
  assert.match(notificationHook, /isDesktopApp\(\)[\s\S]*presentDesktopNotification/);
  assert.match(notificationHook, /desktopBaselineLoadedRef/);
  assert.match(notificationHook, /refresh\(\{ presentNewDesktop: true \}\)/);
  assert.match(notificationHook, /closeDesktopNotificationForRow/);
  assert.match(notificationHook, /presentedDesktopIdsRef\.current\.delete/);
  assert.doesNotMatch(messagesHook, /showDesktopMessageNotification/);
});

test("desktop notification action restores the main window before opening a safe route", async () => {
  const register = (
    desktopNotifications as typeof desktopNotifications & {
      registerDesktopNotificationNavigationListener?: (
        openTarget: (target: string) => void,
        loadApi: () => Promise<{
          onAction: (callback: (route: unknown) => void) => Promise<{
            unregister(): Promise<void>;
          }>;
          takePendingRoute?: () => Promise<unknown>;
        }>,
        restoreMain: () => Promise<void>,
      ) => Promise<() => void>;
    }
  ).registerDesktopNotificationNavigationListener;
  assert.equal(typeof register, "function");

  const previousWindow = installDesktopBridge();
  const events: string[] = [];
  let action: ((route: unknown) => void) | null = null;
  let unregistered = false;
  try {
    const cleanup = await register!(
      (target) => events.push(`open:${target}`),
      async () => ({
        onAction: async (callback) => {
          action = callback;
          return {
            async unregister() {
              unregistered = true;
            },
          };
        },
        takePendingRoute: async () => "/tasks?task=pending-task",
      }),
      async () => {
        events.push("restore");
      },
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(events, ["restore", "open:/tasks?task=pending-task"]);

    action?.("/?chat=chat-1&message=message-1");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(events, [
      "restore",
      "open:/tasks?task=pending-task",
      "restore",
      "open:/?chat=chat-1&message=message-1",
    ]);

    action?.("https://evil.example/chat");
    action?.("//evil.example/chat");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(events, [
      "restore",
      "open:/tasks?task=pending-task",
      "restore",
      "open:/?chat=chat-1&message=message-1",
    ]);

    cleanup();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(unregistered, true);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("push navigation registers the desktop action listener and shares the authenticated queue", () => {
  const source = readFileSync(
    new URL("../../artifacts/kub/src/hooks/usePush.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /registerDesktopNotificationNavigationListener/);
  assert.match(source, /isNativeAndroid\(\) \|\| isDesktopApp\(\)/);
});

test("notification rows collapse messages by chat, isolate tasks and sanitize media URLs", async () => {
  const previousWindow = installDesktopBridge();
  const sent: Array<Record<string, unknown>> = [];
  const loader = async () => ({
    sendNotification: async (notification: Record<string, unknown>) => {
      sent.push(notification);
      return true;
    },
  });
  const context = { visibilityState: "hidden" as const };
  try {
    const firstMessage = {
      id: "notification-1",
      user_id: "user-2",
      kind: "message",
      read_at: null,
      created_at: "2026-07-13T18:00:00.000Z",
      payload: {
        chat_id: "chat-1",
        message_id: "message-1",
        chat_type: "private",
        sender_name: "Никита",
        preview: "Фото https://storage.example.test/private/image.jpg",
      },
    };
    const secondMessage = {
      ...firstMessage,
      id: "notification-2",
      payload: { ...firstMessage.payload, message_id: "message-2", preview: "Второе сообщение" },
    };
    const task = {
      ...firstMessage,
      id: "notification-3",
      kind: "task_assigned",
      payload: { task_id: "task-1", title: "Проверить компьютеры" },
    };

    assert.equal(
      await desktopNotifications.showDesktopNotificationForRow(firstMessage, loader, context),
      true,
    );
    assert.equal(
      await desktopNotifications.showDesktopNotificationForRow(secondMessage, loader, context),
      true,
    );
    assert.equal(await desktopNotifications.showDesktopNotificationForRow(task, loader, context), true);

    assert.equal(sent.length, 3);
    assert.equal(sent[0]?.id, sent[1]?.id);
    assert.notEqual(sent[0]?.id, sent[2]?.id);
    assert.equal(sent[0]?.title, "Никита");
    assert.equal(sent[0]?.body, "Фото вложение");
    assert.equal(sent[0]?.kind, "message");
    assert.equal(sent[0]?.route, "/?chat=chat-1&message=message-1");
    assert.equal(sent[2]?.title, "Новая задача");
    assert.equal(sent[2]?.kind, "task");
    assert.equal(sent[2]?.route, "/tasks?task=task-1");
  } finally {
    globalThis.window = previousWindow;
  }
});
