import assert from "node:assert/strict";
import test from "node:test";

import {
  detectDistributionTarget,
  supportsPwaInstallForTarget,
} from "../../artifacts/kub/src/lib/platform/distribution.ts";
import {
  getDesktopRuntimeInfo,
  isDesktopApp,
  isDesktopShell,
} from "../../artifacts/kub/src/lib/platform/desktop.ts";

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

test("iPhone and touch iPad are the only PWA installation targets", () => {
  const iphone = detectDistributionTarget({ userAgent: IPHONE_UA, platform: "iPhone", maxTouchPoints: 5 });
  const ipad = detectDistributionTarget({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15",
    platform: "MacIntel",
    maxTouchPoints: 5,
  });

  assert.equal(iphone, "ios_pwa");
  assert.equal(ipad, "ios_pwa");
  assert.equal(supportsPwaInstallForTarget(iphone), true);
  assert.equal(supportsPwaInstallForTarget(ipad), true);
});

test("Android browser and Capacitor Android use APK distribution", () => {
  assert.equal(
    detectDistributionTarget({ userAgent: "Mozilla/5.0 (Linux; Android 15) Chrome/140 Mobile" }),
    "android_download",
  );
  assert.equal(
    detectDistributionTarget({ native: true, nativePlatform: "android", userAgent: "Android" }),
    "android_native",
  );
  assert.equal(supportsPwaInstallForTarget("android_download"), false);
});

test("Windows browser uses EXE distribution and unsupported desktop systems stay web-only", () => {
  assert.equal(
    detectDistributionTarget({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140" }),
    "windows_download",
  );
  assert.equal(
    detectDistributionTarget({ userAgent: "Mozilla/5.0 (X11; Linux x86_64) Firefox/142" }),
    "web_only",
  );
  assert.equal(
    detectDistributionTarget({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) Safari/605.1.15" }),
    "web_only",
  );
  assert.equal(supportsPwaInstallForTarget("windows_download"), false);
  assert.equal(supportsPwaInstallForTarget("web_only"), false);
});

test("Tauri Windows shell is native and never becomes a PWA target", () => {
  const target = detectDistributionTarget({
    desktop: true,
    desktopPlatform: "windows",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Tauri/2.11.5",
    platform: "Win32",
  });

  assert.equal(target, "windows_native");
  assert.equal(supportsPwaInstallForTarget(target), false);
});

test("Tauri desktop bridge is synchronous and wins over Windows browser heuristics", async () => {
  const previousWindow = globalThis.window;
  const runtimeInfo = {
    platform: "windows" as const,
    version: "0.2.0",
    build: 4,
  };

  globalThis.window = {
    letscubeDesktop: {
      platform: "windows",
      version: "9.9.9",
      build: 999,
      getRuntimeInfo: async () => runtimeInfo,
    },
  } as typeof window;

  try {
    assert.equal(isDesktopShell(), true);
    assert.equal(isDesktopApp(), true);
    assert.deepEqual(await getDesktopRuntimeInfo(), runtimeInfo);
    assert.equal(
      detectDistributionTarget({
        desktop: isDesktopApp(),
        desktopPlatform: window.letscubeDesktop?.platform,
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0.0.0 Safari/537.36",
        platform: "Win32",
      }),
      "windows_native",
    );
  } finally {
    globalThis.window = previousWindow;
  }
});

test("desktop shell detection is platform-neutral without widening Windows capabilities", () => {
  const previousWindow = globalThis.window;

  globalThis.window = {
    letscubeDesktop: {
      platform: "macos",
    },
  } as unknown as typeof window;

  try {
    assert.equal(isDesktopShell(), true);
    assert.equal(isDesktopApp(), false);
  } finally {
    globalThis.window = previousWindow;
  }
});
