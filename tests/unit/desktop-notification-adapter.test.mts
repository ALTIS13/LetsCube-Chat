import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { showDesktopMessageNotification } from "../../artifacts/kub/src/lib/platform/desktopNotifications.ts";

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
      { visibilityState: "hidden" },
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
      { visibilityState: "hidden" },
    );

    assert.equal(delivered, false);
    assert.equal(sent, false);
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
});
