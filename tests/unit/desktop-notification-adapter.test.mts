import assert from "node:assert/strict";
import test from "node:test";

import { showDesktopMessageNotification } from "../../artifacts/kub/src/lib/platform/desktopNotifications.ts";

type WindowWithDesktopBridge = typeof window & {
  letscubeDesktop?: {
    platform: "windows";
    version: string;
    build: number;
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
      ...runtimeInfo,
      getRuntimeInfo: async () => runtimeInfo,
    },
  } as WindowWithDesktopBridge;

  return previousWindow;
}

test("desktop notification adapter stays inert for browser and Android paths", async () => {
  const previousWindow = globalThis.window;
  let loaderCalls = 0;

  try {
    globalThis.window = undefined as typeof window;

    const delivered = await showDesktopMessageNotification(
      { title: "LETSCUBE", body: "Новое сообщение", tag: "chat-1" },
      async () => {
        loaderCalls += 1;
        return {
          isPermissionGranted: async () => true,
          requestPermission: async () => "granted" as const,
          sendNotification: () => undefined,
        };
      },
    );

    assert.equal(delivered, false);
    assert.equal(loaderCalls, 0);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("desktop notification adapter lazy-loads Tauri only after synchronous bridge detection", async () => {
  const previousWindow = installDesktopBridge();
  const notifications: Array<{ title: string; body: string; tag: string }> = [];
  let loaderCalls = 0;

  try {
    const delivered = await showDesktopMessageNotification(
      { title: "LETSCUBE", body: "Новое сообщение", tag: "chat-1" },
      async () => {
        loaderCalls += 1;
        return {
          isPermissionGranted: async () => true,
          requestPermission: async () => "granted" as const,
          sendNotification: (notification) => {
            notifications.push(notification);
          },
        };
      },
    );

    assert.equal(delivered, true);
    assert.equal(loaderCalls, 1);
    assert.deepEqual(notifications, [
      { title: "LETSCUBE", body: "Новое сообщение", tag: "chat-1" },
    ]);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("desktop notification adapter does not send when native permission is denied", async () => {
  const previousWindow = installDesktopBridge();
  let sent = false;

  try {
    const delivered = await showDesktopMessageNotification(
      { title: "LETSCUBE", body: "Новое сообщение", tag: "chat-1" },
      async () => ({
        isPermissionGranted: async () => false,
        requestPermission: async () => "denied" as const,
        sendNotification: () => {
          sent = true;
        },
      }),
    );

    assert.equal(delivered, false);
    assert.equal(sent, false);
  } finally {
    globalThis.window = previousWindow;
  }
});
