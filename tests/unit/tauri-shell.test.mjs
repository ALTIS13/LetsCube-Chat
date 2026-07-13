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
  assert.match(libRs, /#\[cfg\(debug_assertions\)\][\s\S]*LETSCUBE_TAURI_QA_HOLD_PREFLIGHT/);
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
  assert.match(libRs, /WebviewWindowBuilder::from_config/);
  assert.match(libRs, /StartupState/);
  assert.match(libRs, /letscube:\/\/startup-state/);
  assert.match(libRs, /PageLoadEvent::Finished/);
  assert.match(libRs, /is_allowed_navigation\([^)]*url/);
  assert.doesNotMatch(libRs, /thread::sleep|letscube:\/\/load-timeout/);
  const retryMain = libRs.match(/fn retry_main[\s\S]*?#\[tauri::command\]\s*fn begin_startup_qa/)?.[0] ?? "";
  assert.match(
    retryMain,
    /window\s*\.url\(\)[\s\S]*is_local_startup_url/,
    "retry_main must positively require the exact bundled startup URL",
  );
  assert.doesNotMatch(
    retryMain,
    /window\s*\.url\(\)[\s\S]*is_allowed_navigation/,
    "retry_main must not authorize every URL that is merely non-production",
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

test("Windows startup uses one main window and a local approved handshake scene", () => {
  const config = readJson("windows-tauri/src-tauri/tauri.conf.json");
  assert.deepEqual(config.app.windows.map((window) => window.label), ["main"]);
  assert.equal(config.app.windows[0].url, "startup.html");
  assert.equal(config.app.windows[0].visible, true);
  assert.equal(config.app.windows[0].decorations, true);
  assert.equal(config.app.windows[0].resizable, true);
  assert.equal(config.app.windows[0].center, true);
  assert.equal(config.app.windows[0].minWidth, 960);
  assert.equal(config.app.windows[0].minHeight, 640);
  assert.equal(existsSync(new URL("../../windows-tauri/ui/splash.html", import.meta.url)), false);

  const html = readText("windows-tauri/ui/startup.html");
  const css = readText("windows-tauri/ui/startup.css");
  const script = readText("windows-tauri/ui/startup.js");
  assert.match(html, /data-testid="startup-client-fingerprint"/);
  assert.match(html, /data-testid="startup-server-fingerprint"/);
  assert.match(html, /data-testid="startup-center-seal"/);
  assert.match(html, /id="startup-status"/);
  assert.match(html, /id="startup-retry"/);
  assert.match(css, /grid-template-columns:\s*1fr\s+34px\s+1fr/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(script, /letscube:\/\/startup-state/);
  assert.match(script, /snapshot\.stage\s*===\s*"complete"\s*&&\s*snapshot\.connected\s*===\s*true/);
  assert.doesNotMatch(script, /setTimeout|setInterval/);

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
  assert.match(script, /LETSCUBE_TAURI_QA_HOLD_PREFLIGHT/);
  assert.match(script, /LETSCUBE_TAURI_CDP_URL/);
  assert.match(script, /windows-tauri-shell\.spec\.ts/);
  assert.match(script, /chromium-desktop-1440/);
  assert.match(script, /mkdtemp/);
  assert.match(script, /rmSync/);
  assert.match(script, /tasklist/i);
  assert.match(script, /qaProcess\s*=\s*spawn[\s\S]*client\s*=\s*spawn/);
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
  assert.match(spec, /startup-center-seal/);
  assert.match(spec, /startup-status/);
  assert.match(spec, /contexts\(\)\.flatMap/);
  assert.match(spec, /waitForURL/);
  assert.match(spec, /connectToTauri/);
});
