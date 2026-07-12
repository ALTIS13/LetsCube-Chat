import assert from "node:assert/strict";
import test from "node:test";

import {
  detectDistributionTarget,
  supportsPwaInstallForTarget,
} from "../../artifacts/kub/src/lib/platform/distribution.ts";

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

test("Windows browser uses EXE distribution and other systems stay web-only", () => {
  assert.equal(
    detectDistributionTarget({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140" }),
    "windows_download",
  );
  assert.equal(
    detectDistributionTarget({ userAgent: "Mozilla/5.0 (X11; Linux x86_64) Firefox/142" }),
    "web_only",
  );
  assert.equal(supportsPwaInstallForTarget("windows_download"), false);
  assert.equal(supportsPwaInstallForTarget("web_only"), false);
});

test("Electron Windows shell is native and never becomes a PWA target", () => {
  const target = detectDistributionTarget({
    desktop: true,
    desktopPlatform: "windows",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Electron/43.1.0",
    platform: "Win32",
  });

  assert.equal(target, "windows_native");
  assert.equal(supportsPwaInstallForTarget(target), false);
});
