import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  isAllowedExternalUrl,
  isAllowedNavigationUrl,
  isAllowedPermission,
  PRODUCTION_APP_ORIGIN,
} from "../../desktop/security.mjs";

test("Electron shell navigation is restricted to the production app origin", () => {
  assert.equal(PRODUCTION_APP_ORIGIN, "https://app.letscube.ru");
  assert.equal(isAllowedNavigationUrl("https://app.letscube.ru/"), true);
  assert.equal(isAllowedNavigationUrl("https://app.letscube.ru/tasks?view=mine"), true);
  assert.equal(isAllowedNavigationUrl("https://api.letscube.ru/releases/v1/windows/stable.json"), false);
  assert.equal(isAllowedNavigationUrl("https://example.com/"), false);
  assert.equal(isAllowedNavigationUrl("file:///C:/Windows/System32/calc.exe"), false);
});

test("External handoff accepts only safe public protocols", () => {
  assert.equal(isAllowedExternalUrl("https://api.letscube.ru/releases/files/windows/0.1.0/letscube-0.1.0.exe"), true);
  assert.equal(isAllowedExternalUrl("http://example.com/help"), true);
  assert.equal(isAllowedExternalUrl("mailto:admin@example.com"), true);
  assert.equal(isAllowedExternalUrl("javascript:alert(1)"), false);
  assert.equal(isAllowedExternalUrl("file:///C:/secret.txt"), false);
  assert.equal(isAllowedExternalUrl("custom-protocol://unsafe"), false);
});

test("Permissions are scoped to the production origin and required capabilities", () => {
  for (const permission of ["media", "geolocation", "notifications"]) {
    assert.equal(isAllowedPermission("https://app.letscube.ru/chat", permission, { isMainFrame: true }), true);
  }
  for (const permission of ["clipboard-sanitized-write", "fullscreen"]) {
    assert.equal(isAllowedPermission("https://app.letscube.ru/chat", permission, { isMainFrame: true }), true);
    assert.equal(isAllowedPermission("https://app.letscube.ru/chat", permission, { isMainFrame: false }), false);
  }
  assert.equal(isAllowedPermission("https://app.letscube.ru/", "media", { isMainFrame: true, mediaTypes: ["audio"] }), true);
  assert.equal(isAllowedPermission("https://app.letscube.ru/", "media", { isMainFrame: true, mediaTypes: ["display"] }), false);
  assert.equal(isAllowedPermission("https://app.letscube.ru/", "media", { isMainFrame: false, mediaTypes: ["audio"] }), false);
  assert.equal(isAllowedPermission("https://app.letscube.ru/", "midiSysex", { isMainFrame: true }), false);
  assert.equal(isAllowedPermission("https://example.com/", "media", { isMainFrame: true, mediaTypes: ["audio"] }), false);
});

test("BrowserWindow keeps renderer isolation and navigation guards enabled", () => {
  const main = readFileSync(new URL("../../desktop/main.mjs", import.meta.url), "utf8");
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /sandbox:\s*true/);
  assert.match(main, /setWindowOpenHandler/);
  assert.match(main, /setPermissionRequestHandler/);
  assert.match(main, /window\.webContents\.session/);
  assert.match(main, /clearCache\(\)/);
  assert.match(main, /clearStorageData\(\{\s*storages:\s*\["serviceworkers",\s*"cachestorage"\]/s);
  assert.match(main, /offline\.html/);
  assert.match(main, /loadFile/);
  assert.match(main, /will-navigate/);
  assert.match(main, /will-redirect/);
  assert.doesNotMatch(main, /session\.defaultSession/);
  assert.doesNotMatch(main, /webSecurity:\s*false/);
});

test("Offline shell is local, script-free and retries only the production origin", () => {
  const offline = readFileSync(new URL("../../desktop/offline.html", import.meta.url), "utf8");
  assert.match(offline, /LETSCUBE/);
  assert.match(offline, /https:\/\/app\.letscube\.ru\//);
  assert.match(offline, /Повторить/);
  assert.doesNotMatch(offline, /<script/i);
});

test("Windows package is an x64 NSIS build with a stable desktop identity", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  const desktopPackage = JSON.parse(readFileSync(new URL("../../desktop/package.json", import.meta.url), "utf8"));
  const builder = readFileSync(new URL("../../electron-builder.yml", import.meta.url), "utf8");

  assert.equal(packageJson.main, "desktop/main.mjs");
  assert.equal(packageJson.version, "0.1.2");
  assert.equal(packageJson.desktopBuild, 3);
  assert.equal(desktopPackage.main, "main.mjs");
  assert.equal(desktopPackage.version, packageJson.version);
  assert.equal(desktopPackage.desktopBuild, packageJson.desktopBuild);
  assert.equal(packageJson.devDependencies.electron, undefined);
  assert.equal(packageJson.devDependencies["electron-builder"], undefined);
  assert.equal(desktopPackage.devDependencies.electron, "43.1.0");
  assert.equal(desktopPackage.devDependencies["electron-builder"], "26.15.3");
  assert.match(packageJson.scripts["windows:prepare"], /--ignore-workspace/);
  assert.match(packageJson.scripts["windows:prepare"], /install-electron/);
  assert.match(packageJson.scripts["windows:build:internal"], /windows:prepare/);
  assert.match(builder, /appId:\s*ru\.letscube\.messenger/);
  assert.match(builder, /productName:\s*LETSCUBE/);
  assert.match(builder, /target:\s*nsis/);
  assert.match(builder, /-\s*x64/);
  assert.match(builder, /asar:\s*true/);
  assert.match(builder, /electronVersion:\s*43\.1\.0/);
  assert.match(builder, /electronDist:\s*desktop\/node_modules\/electron\/dist/);
  assert.match(builder, /output:\s*dist\/windows/);
  assert.match(builder, /artifactName:\s*LETSCUBE-\$\{version\}-\$\{arch\}-setup\.\$\{ext\}/);
  assert.match(builder, /icon:\s*desktop\/assets\/letscube\.ico/);
  assert.match(builder, /grantFileProtocolExtraPrivileges:\s*false/);
  assert.match(builder, /app:\s*desktop/);
  assert.match(builder, /!node_modules\/\*\*\/\*/);
});

test("Electron runtime does not enter browser push or service-worker paths", () => {
  const pwa = readFileSync(new URL("../../artifacts/kub/src/hooks/usePwa.ts", import.meta.url), "utf8");
  const push = readFileSync(new URL("../../artifacts/kub/src/hooks/usePush.ts", import.meta.url), "utf8");
  const messages = readFileSync(new URL("../../artifacts/kub/src/hooks/useMessages.ts", import.meta.url), "utf8");

  assert.match(pwa, /isNativeApp\(\) \|\| isDesktopApp\(\)/);
  assert.match(push, /if \(isDesktopApp\(\)\)/);
  assert.match(messages, /isWebBrowser\(\).*document\.hidden/s);
});
