import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = new URL("../../", import.meta.url);
const windowsTauriRoot = new URL("../../windows-tauri/", import.meta.url);
const srcTauriRoot = new URL("../../windows-tauri/src-tauri/", import.meta.url);
const rootPackage = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const workspaceConfig = readFileSync(new URL("../../pnpm-workspace.yaml", import.meta.url), "utf8");

function readText(relativePath) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

test("Windows Tauri shell stays isolated from the root workspace and exposes only the root launcher scripts", () => {
  assert.equal(existsSync(windowsTauriRoot), true, "windows-tauri package is missing");
  assert.doesNotMatch(workspaceConfig, /windows-tauri/, "windows-tauri must stay outside the pnpm workspace");

  assert.match(rootPackage.scripts["windows:tauri:run"], /windows-tauri/);
  assert.match(rootPackage.scripts["windows:tauri:run"], /tauri dev/);
  assert.match(rootPackage.scripts["windows:tauri:run"], /\.cargo\\bin/);
  assert.equal(rootPackage.scripts["windows:tauri:test"], "node --test tests/unit/tauri-shell.test.mjs");
  assert.match(rootPackage.scripts["windows:tauri:build:internal"], /windows-tauri/);
  assert.match(rootPackage.scripts["windows:tauri:build:internal"], /tauri build/);
  assert.match(rootPackage.scripts["windows:tauri:build:internal"], /\.cargo\\bin/);
  assert.equal(rootPackage.scripts["windows:tauri:qa"], "node scripts/windows-tauri-qa.mjs");

  const shellPackage = readJson("windows-tauri/package.json");
  assert.equal(shellPackage.private, true);
  assert.equal(Number.isSafeInteger(shellPackage.desktopBuild), true);
  assert.ok(shellPackage.desktopBuild > 0);

  const pinnedDependencies = {
    ...(shellPackage.dependencies ?? {}),
    ...(shellPackage.devDependencies ?? {}),
  };

  for (const [name, version] of Object.entries(pinnedDependencies)) {
    assert.doesNotMatch(
      version,
      /^[~^]/,
      `${name} must be pinned exactly so the Windows toolchain stays reproducible`,
    );
  }
});

test("Windows Tauri shell files encode the minimum-capability production contract", () => {
  const cargoTomlPath = new URL("./Cargo.toml", srcTauriRoot);
  const libRsPath = new URL("./src/lib.rs", srcTauriRoot);
  const mainRsPath = new URL("./src/main.rs", srcTauriRoot);
  const buildRsPath = new URL("./build.rs", srcTauriRoot);
  const tauriConfig = readJson("windows-tauri/src-tauri/tauri.conf.json");
  const capability = readJson("windows-tauri/src-tauri/capabilities/production.json");
  const cargoToml = readFileSync(cargoTomlPath, "utf8");
  const libRs = readFileSync(libRsPath, "utf8");
  const mainRs = readFileSync(mainRsPath, "utf8");
  const buildRs = readFileSync(buildRsPath, "utf8");

  assert.equal(existsSync(cargoTomlPath), true);
  assert.equal(existsSync(libRsPath), true);
  assert.equal(existsSync(mainRsPath), true);
  assert.equal(existsSync(buildRsPath), true);

  assert.match(cargoToml, /^name = "letscube-windows-tauri"$/m);
  assert.match(cargoToml, /^tauri = \{ version = "2\.11\.[^"]+"/m);
  assert.match(cargoToml, /^tauri-build = \{ version = "2\.[^"]+"/m);
  assert.match(cargoToml, /^tauri-plugin-notification = "2\.[^"]+"/m);
  assert.match(cargoToml, /^tauri-plugin-opener = "2\.[^"]+"/m);
  assert.match(cargoToml, /^tauri-plugin-single-instance = "2\.[^"]+"/m);

  assert.match(mainRs, /letscube_windows_tauri::run\(\)/);
  assert.match(buildRs, /tauri_build::build\(\)/);
  assert.match(buildRs, /package\.json/);
  assert.match(buildRs, /LETSCUBE_DESKTOP_BUILD/);

  assert.match(libRs, /https:\/\/app\.letscube\.ru\//);
  assert.match(libRs, /webview-production-v1/);
  assert.match(libRs, /window\.letscubeDesktop/);
  assert.match(libRs, /Object\.freeze/);
  assert.match(libRs, /version:\s*runtimeInfo\.version/);
  assert.match(libRs, /build:\s*runtimeInfo\.build/);
  assert.match(libRs, /platform:\s*"windows"/);
  assert.match(libRs, /build:/);
  assert.match(libRs, /is_dev\(\)|cfg!\(debug_assertions\)/);
  assert.match(libRs, /LETSCUBE_WEBVIEW2_DATA_DIR/);
  assert.match(libRs, /single_instance/);
  assert.match(libRs, /Открыть LETSCUBE/);
  assert.match(libRs, /Выйти/);
  assert.match(libRs, /hide\(\)/);
  assert.match(libRs, /show\(\)/);
  assert.match(libRs, /notify|notification/i);
  assert.match(libRs, /on_new_window/);
  assert.match(libRs, /is_safe_external_url/);
  assert.match(libRs, /opener\(\)\s*\.open_url/);
  assert.match(libRs, /MAIN_READY/);
  assert.match(libRs, /restore_startup_surface/);
  assert.match(
    libRs,
    /window\.label\(\)\s*!=\s*"splash"/,
    "the retry command must reject calls from the remote production window",
  );

  assert.equal(tauriConfig.productName, "LETSCUBE");
  assert.equal(tauriConfig.identifier, "ru.letscube.messenger");
  assert.equal(tauriConfig.bundle.active, true);
  assert.deepEqual(tauriConfig.bundle.targets, ["nsis"]);
  assert.equal(tauriConfig.bundle.windows.webviewInstallMode.type, "skip");

  assert.equal(capability.identifier, "production");
  assert.deepEqual(capability.windows, ["main"]);
  assert.deepEqual(capability.remote.urls, ["https://app.letscube.ru/*"]);
  assert.ok(Array.isArray(capability.permissions), "production capability permissions must be explicit");
  assert.ok(
    capability.permissions.every((permission) => !/fs|shell|process|updater|sql|http:default|opener/i.test(permission)),
    "production capability must not expose filesystem, shell, process, updater, generic opener or wildcard HTTP access",
  );
  assert.ok(
    capability.permissions.some((permission) => /^notification:/.test(permission)),
    "production capability must expose only the notification plugin methods needed by the app origin",
  );
});

test("Windows Tauri splash and icons exist as local bundled assets", () => {
  const splashPath = new URL("../../windows-tauri/ui/splash.html", import.meta.url);
  assert.equal(existsSync(splashPath), true, "splash.html is missing");

  const splashHtml = readFileSync(splashPath, "utf8");
  const splashCss = readText("windows-tauri/ui/splash.css");
  assert.match(splashHtml, /LETSCUBE/);
  assert.match(splashHtml, /retry|повтор/i);
  assert.match(splashHtml, /failed|ошиб/i);
  assert.match(splashCss, /prefers-reduced-motion/);

  const iconsDir = new URL("../../windows-tauri/icons/", import.meta.url);
  assert.equal(existsSync(iconsDir), true, "icons directory is missing");
  const iconNames = readdirSync(iconsDir).map((entry) => path.basename(entry).toLowerCase());
  assert.ok(iconNames.some((entry) => entry.endsWith(".ico")), "Windows icon asset is missing");
  assert.ok(iconNames.some((entry) => entry.endsWith(".png")), "PNG icon asset is missing");
});

test("Windows Tauri exposes main-WebView automation only through a debug-only opt-in port", () => {
  const libRs = readText("windows-tauri/src-tauri/src/lib.rs");

  assert.match(libRs, /LETSCUBE_WEBVIEW2_DEBUG_PORT/);
  assert.match(libRs, /additional_browser_args/);
  assert.match(
    libRs,
    /#\[cfg\(debug_assertions\)\]\s*fn debug_browser_args\(\)/,
    "release builds must ignore the WebView2 automation port",
  );
  assert.match(libRs, /#\[cfg\(not\(debug_assertions\)\)\]\s*fn debug_browser_args\(\)/);
  assert.doesNotMatch(
    libRs,
    /--remote-allow-origins=\*/,
    "debug automation must not allow arbitrary remote origins",
  );
});

test("Windows Tauri QA wrapper owns an isolated process, profile and loopback CDP endpoint", () => {
  const scriptPath = new URL("../../scripts/windows-tauri-qa.mjs", import.meta.url);
  assert.equal(existsSync(scriptPath), true, "Windows Tauri QA wrapper is missing");
  const script = readFileSync(scriptPath, "utf8");

  assert.match(script, /LETSCUBE_WEBVIEW2_DATA_DIR/);
  assert.match(script, /LETSCUBE_WEBVIEW2_DEBUG_PORT/);
  assert.match(script, /LETSCUBE_TAURI_CDP_URL/);
  assert.match(script, /windows-tauri-shell\.spec\.ts/);
  assert.match(script, /chromium-desktop-1440/);
  assert.match(script, /mkdtemp/);
  assert.match(script, /rmSync/);
  assert.match(script, /tasklist/i);
  assert.match(script, /\.origin\s*===\s*PRODUCTION_ORIGIN/);
  assert.doesNotMatch(script, /startsWith\("https:\/\/app\.letscube\.ru/);
  assert.match(script, /process\.on\("SIGINT"/);
  assert.match(script, /process\.on\("SIGTERM"/);
  assert.doesNotMatch(script, /process\.once\("SIG(?:INT|TERM)"/);
  assert.match(script, /cleanupOwnedResources/);
  assert.match(script, /process\.exitCode\s*=\s*1/);
  assert.match(script, /existsSync\(profilePath\)/);
  assert.doesNotMatch(script, /remote-allow-origins=\*/);

  const spec = readText("tests/e2e/windows-tauri-shell.spec.ts");
  assert.match(spec, /validateCdpUrl/);
  assert.match(spec, /hostname\s*!==\s*"127\.0\.0\.1"/);
  assert.match(spec, /protocol\s*!==\s*"http:"/);
  assert.match(spec, /await page\.reload/);
});
