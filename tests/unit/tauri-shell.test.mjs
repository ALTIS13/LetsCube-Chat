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

test("Windows release version and build metadata stay aligned", () => {
  const shellPackage = readJson("windows-tauri/package.json");
  const tauriConfig = readJson("windows-tauri/src-tauri/tauri.conf.json");
  const cargoToml = readText("windows-tauri/src-tauri/Cargo.toml");
  const cargoVersion = cargoToml.match(/^version = "([^"]+)"$/m)?.[1] ?? null;
  const startupHtml = readText("windows-tauri/ui/startup.html");
  const libRs = readText("windows-tauri/src-tauri/src/lib.rs");
  const publisherPublicKey = readText("scripts/windows-updater-public.key").trim();

  assert.equal(shellPackage.version, "0.2.7");
  assert.equal(shellPackage.desktopBuild, 11);
  assert.equal(tauriConfig.version, shellPackage.version);
  assert.equal(cargoVersion, shellPackage.version);
  assert.equal(tauriConfig.plugins.updater.pubkey, publisherPublicKey);
  assert.doesNotMatch(startupHtml, /Desktop\s+\d+\.\d+\.\d+/);
  assert.match(libRs, /startup_runtime_script[\s\S]*CARGO_PKG_VERSION/);
});

test("Windows Tauri shell files encode the minimum-capability production contract", () => {
  const cargoTomlPath = new URL("./Cargo.toml", srcTauriRoot);
  const libRsPath = new URL("./src/lib.rs", srcTauriRoot);
  const mainRsPath = new URL("./src/main.rs", srcTauriRoot);
  const buildRsPath = new URL("./build.rs", srcTauriRoot);
  const tauriConfig = readJson("windows-tauri/src-tauri/tauri.conf.json");
  const capability = readJson("windows-tauri/src-tauri/capabilities/production.json");
  const startupCapability = readJson("windows-tauri/src-tauri/capabilities/startup.json");
  const cargoToml = readFileSync(cargoTomlPath, "utf8");
  const libRs = readFileSync(libRsPath, "utf8");
  const updaterRs = readText("windows-tauri/src-tauri/src/updater.rs");
  const mainRs = readFileSync(mainRsPath, "utf8");
  const buildRs = readFileSync(buildRsPath, "utf8");

  assert.equal(existsSync(cargoTomlPath), true);
  assert.equal(existsSync(libRsPath), true);
  assert.equal(existsSync(mainRsPath), true);
  assert.equal(existsSync(buildRsPath), true);

  assert.match(cargoToml, /^name = "letscube-windows-tauri"$/m);
  assert.match(cargoToml, /^tauri = \{ version = "2\.11\.[^"]+"/m);
  assert.match(cargoToml, /^tauri-build = \{ version = "2\.[^"]+"/m);
  assert.doesNotMatch(cargoToml, /^tauri-plugin-notification\s*=/m);
  assert.match(cargoToml, /^windows = \{ version = "0\.61", features = \[[^\]]*"UI_Notifications"/m);
  assert.match(cargoToml, /^tauri-plugin-opener = "2\.[^"]+"/m);
  assert.match(cargoToml, /^tauri-plugin-deep-link = "=?2\.[^"]+"/m);
  assert.match(
    cargoToml,
    /^tauri-plugin-single-instance = \{[^\n]*features = \["deep-link"\][^\n]*\}$/m,
  );
  assert.match(cargoToml, /^tauri-plugin-updater = "=2\.10\.1"$/m);
  assert.equal((cargoToml.match(/^reqwest\s*=/gm) ?? []).length, 1);
  assert.match(cargoToml, /^reqwest = \{[^\n]*version = "=0\.13\.4"[^\n]*features = \[[^\]]*"json"[^\]]*\]/m);

  assert.match(mainRs, /letscube_windows_tauri::run\(\)/);
  assert.match(buildRs, /tauri_build::try_build\(/);
  assert.match(buildRs, /package\.json/);
  assert.match(buildRs, /LETSCUBE_DESKTOP_BUILD/);
  for (const command of [
    "retry_main",
    "begin_startup_qa",
    "desktop_get_update_state",
    "desktop_get_update_channel",
    "desktop_set_update_channel",
    "desktop_check_update",
    "desktop_install_update",
    "desktop_show_main",
    "desktop_is_main_foreground",
    "desktop_notify",
    "desktop_remove_notification",
    "desktop_take_pending_notification_route",
  ]) {
    assert.match(
      buildRs,
      new RegExp(`const\\s+COMMANDS[\\s\\S]*?${command}`),
      `${command} must be registered in the application ACL manifest`,
    );
    const permissionPath = `windows-tauri/src-tauri/permissions/autogenerated/${command}.toml`;
    assert.equal(existsSync(new URL(`../../${permissionPath}`, import.meta.url)), true);
    const permission = readText(permissionPath);
    assert.match(permission, new RegExp(`identifier = "allow-${command.replaceAll("_", "-")}"`));
    assert.match(permission, new RegExp(`commands\\.allow = \\["${command}"\\]`));
  }
  assert.match(buildRs, /AppManifest::new\(\)\.commands\(COMMANDS\)/);

  assert.match(libRs, /https:\/\/app\.letscube\.ru\//);
  assert.match(libRs, /webview-production-v1/);
  assert.match(libRs, /window\.letscubeDesktop/);
  assert.match(libRs, /desktop_show_main/);
  assert.match(libRs, /showMain: async \(\) => call\("desktop_show_main"\)/);
  assert.match(libRs, /desktop_is_main_foreground/);
  assert.match(libRs, /isMainForeground: async \(\) => call\("desktop_is_main_foreground"\)/);
  assert.match(libRs, /desktop_notify/);
  assert.match(libRs, /notify: async \(notification\) => call\("desktop_notify"/);
  assert.match(libRs, /desktop_remove_notification/);
  assert.match(libRs, /removeNotification: async \(notification\) => call\("desktop_remove_notification"/);
  assert.match(libRs, /desktop_take_pending_notification_route/);
  assert.match(libRs, /takePendingNotificationRoute: async \(\) => call\("desktop_take_pending_notification_route"\)/);
  assert.equal(capability.permissions.includes("allow-desktop-show-main"), true);
  assert.equal(capability.permissions.includes("allow-desktop-is-main-foreground"), true);
  assert.equal(capability.permissions.includes("allow-desktop-notify"), true);
  assert.equal(capability.permissions.includes("allow-desktop-remove-notification"), true);
  assert.equal(capability.permissions.includes("allow-desktop-take-pending-notification-route"), true);
  assert.match(libRs, /window\s*\.is_visible\(\)/);
  assert.match(libRs, /window\s*\.is_minimized\(\)/);
  assert.match(libRs, /window\s*\.is_focused\(\)/);
  assert.match(libRs, /NotificationSetting::Enabled/);
  assert.match(libRs, /RemoveGroupedTagWithId/);
  assert.match(
    libRs,
    /RemoveGroupWithId[\s\S]*"messages"/,
    "the first grouped build must remove legacy per-chat replacement cards",
  );
  assert.match(libRs, /PendingNotificationRoute/);
  assert.match(
    libRs,
    /activationType="protocol"[\s\S]*launch="\{\}"/,
    "Windows toast cards must use durable protocol activation from Notification Center",
  );
  assert.match(libRs, /notification_route_from_activation_url/);
  assert.match(libRs, /notification_route_from_args/);
  assert.match(libRs, /tauri_plugin_deep_link::init\(\)/);
  assert.match(
    libRs,
    /DeepLinkExt[\s\S]*\.deep_link\(\)\.on_open_url/,
    "the running Windows instance must consume protocol URLs emitted by the deep-link bridge",
  );
  assert.doesNotMatch(libRs, /ActiveWindowsNotifications/);
  assert.deepEqual(tauriConfig.plugins["deep-link"].desktop.schemes, [
    "letscube-notification",
  ]);
  assert.match(libRs, /Object\.freeze/);
  assert.match(libRs, /version:\s*runtimeInfo\.version/);
  assert.match(libRs, /build:\s*runtimeInfo\.build/);
  assert.match(libRs, /platform:\s*"windows"/);
  assert.match(libRs, /build:/);
  assert.match(libRs, /#\[cfg\(debug_assertions\)\]/);
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
  assert.doesNotMatch(libRs, /dangerous_accept_invalid_certs|dangerous_accept_invalid_hostnames/);
  assert.match(libRs, /tauri_plugin_updater::Builder::new\(\)\.build\(\)/);
  assert.match(libRs, /update\.timeout\s*=\s*Some\(UPDATE_TIMEOUT\)/);
  assert.match(libRs, /transition_update_failed/);
  assert.match(updaterRs, /File::open\(path\)/);
  assert.match(updaterRs, /file\.metadata\(\)/);
  assert.match(updaterRs, /take\(MAX_CHANNEL_FILE_BYTES\s*\+\s*1\)/);
  assert.match(updaterRs, /read_to_end/);
  assert.doesNotMatch(updaterRs, /fs::metadata\(path\)|fs::read\(path\)/);
  const updaterCommands = [
    "desktop_get_update_state",
    "desktop_get_update_channel",
    "desktop_set_update_channel",
    "desktop_check_update",
    "desktop_install_update",
  ];
  for (const command of updaterCommands) {
    assert.match(libRs, new RegExp(command));
    const commandBody = libRs.match(
      new RegExp(`(?:async\\s+)?fn\\s+${command}[\\s\\S]*?(?=\\n#\\[tauri::command\\]|\\npub fn run)`),
    )?.[0] ?? "";
    assert.match(commandBody, /require_production_main\(&window\)/, `${command} must use the production/main guard`);
  }
  const productionGuard = libRs.match(
    /fn require_production_main[\s\S]*?(?=\nfn is_safe_external_url)/,
  )?.[0] ?? "";
  assert.match(productionGuard, /window\.label\(\)\s*!=\s*"main"/);
  assert.match(productionGuard, /window\s*\.url\(\)/);
  assert.match(productionGuard, /is_allowed_navigation\(&url\)/);
  assert.match(libRs, /getUpdateState:\s*async/);
  assert.match(libRs, /getUpdateChannel:\s*async/);
  assert.match(libRs, /setUpdateChannel:\s*async/);
  assert.match(libRs, /checkUpdate:\s*async/);
  assert.match(libRs, /installUpdate:\s*async/);
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
  assert.equal(tauriConfig.bundle.createUpdaterArtifacts, true);
  assert.equal(typeof tauriConfig.plugins.updater.pubkey, "string");
  assert.ok(tauriConfig.plugins.updater.pubkey.length > 40);
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
    capability.permissions.every((permission) => !/^notification:/.test(permission)),
    "remote production origin must use the guarded native toast command instead of plugin-wide notification access",
  );
  assert.ok(
    capability.permissions.every((permission) => !/^updater:/.test(permission)),
    "remote production pages must use only the origin-guarded Rust updater commands",
  );
  assert.deepEqual(
    capability.permissions.filter((permission) => /^allow-desktop-/.test(permission)).sort(),
    [
      "allow-desktop-check-update",
      "allow-desktop-get-update-channel",
      "allow-desktop-get-update-state",
      "allow-desktop-install-update",
      "allow-desktop-is-main-foreground",
      "allow-desktop-notify",
      "allow-desktop-remove-notification",
      "allow-desktop-set-update-channel",
      "allow-desktop-show-main",
      "allow-desktop-take-pending-notification-route",
    ],
    "remote production origin must receive only the ten guarded desktop commands",
  );
  assert.deepEqual(startupCapability.permissions.sort(), ["allow-begin-startup-qa", "allow-retry-main"]);
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
  assert.match(html, /data-testid="startup-client-port"/);
  assert.match(html, /data-testid="startup-server-port"/);
  assert.match(html, /data-testid="startup-center-seal"/);
  assert.match(html, /id="startup-status"/);
  assert.match(html, /id="startup-retry"/);
  assert.match(css, /grid-template-columns:\s*1fr\s+34px\s+1fr/);
  assert.match(css, /\.endpoint-client\s*\{\s*grid-column:\s*1;/);
  assert.match(css, /\.endpoint-server\s*\{\s*grid-column:\s*3;/);
  assert.match(css, /grid-template-rows:\s*74px\s+20px\s+126px\s+20px\s+19px\s+4px\s+14px/);
  assert.match(css, /\.connection-port-client\s*\{\s*right:\s*-18px;/);
  assert.match(css, /\.connection-port-server\s*\{\s*top:\s*53px;\s*left:\s*-22px;/);
  assert.match(css, /\.rail-left\s*\{\s*left:\s*calc\(25% \+ 83\.5px\);/);
  assert.match(css, /\.rail-right\s*\{[^}]*right:\s*calc\(25% \+ 75\.5px\);/s);
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

test("production startup handoff keeps one stable scene long enough to read", () => {
  const html = readText("windows-tauri/ui/startup-overlay.html");
  const css = readText("windows-tauri/ui/startup-overlay.css");
  const script = readText("windows-tauri/ui/startup-overlay.js");

  assert.match(html, /startup-overlay-endpoint-client/);
  assert.match(html, /startup-overlay-endpoint-server/);
  assert.match(html, /data-testid="production-startup-client-port"/);
  assert.match(html, /data-testid="production-startup-server-port"/);
  assert.match(html, /__LETSCUBE_LOGO_SVG__/);
  assert.match(html, /startup-overlay-stages/);
  assert.match(css, /\.startup-overlay-endpoint-client\s*\{\s*grid-column:\s*1;/);
  assert.match(css, /\.startup-overlay-endpoint-server\s*\{\s*grid-column:\s*3;/);
  assert.match(css, /\.startup-overlay-fingerprint\s*\{[^}]*height:\s*74px;/s);
  assert.match(css, /grid-template-rows:\s*74px\s+20px\s+126px\s+20px\s+19px\s+4px\s+14px/);
  assert.match(css, /\.startup-overlay-port-server\s*\{\s*top:\s*53px;\s*left:\s*-22px;/);
  assert.match(css, /\.startup-overlay-rail:first-child\s*\{[^}]*left:\s*calc\(25% \+ 83\.5px\);/s);
  assert.match(css, /\.startup-overlay-rail:last-child\s*\{[^}]*right:\s*calc\(25% \+ 75\.5px\);/s);
  assert.match(script, /minimumVisibleDuration\s*=\s*2_200/);
  assert.match(script, /successHoldDuration\s*=\s*900/);
  assert.match(script, /Math\.max\(minimumVisibleDuration[^)]*successHoldDuration/s);
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
  assert.doesNotMatch(
    libRs,
    /#\[cfg\(not\(debug_assertions\)\)\]\s*fn debug_browser_args\(\)/,
    "release builds must not compile a debug browser helper",
  );
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
  assert.match(script, /--output/);
  assert.match(script, /windows-tauri-qa/);
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

test("Windows lifecycle QA modes are bounded to debug state sources", () => {
  const wrapper = readText("scripts/windows-tauri-qa.mjs");
  const startupSpecPath = new URL("../../tests/e2e/windows-tauri-startup.spec.ts", import.meta.url);
  const libRs = readText("windows-tauri/src-tauri/src/lib.rs");
  const tauriConfig = readJson("windows-tauri/src-tauri/tauri.conf.json");
  const modes = [
    "success",
    "offline",
    "catalog_failure",
    "normal_update",
    "critical_update",
  ];

  assert.equal(existsSync(startupSpecPath), true, "dedicated startup lifecycle spec is missing");
  assert.match(wrapper, /LETSCUBE_TAURI_QA_STARTUP_MODE/);
  assert.match(wrapper, /windows-tauri-startup\.spec\.ts/);
  for (const mode of modes) {
    assert.match(wrapper, new RegExp(`["']${mode}["']`), `${mode} QA mode is not orchestrated`);
  }

  assert.match(
    libRs,
    /#\[cfg\(debug_assertions\)\][\s\S]*fn qa_startup_mode\(\)[\s\S]*LETSCUBE_TAURI_QA_STARTUP_MODE/,
    "QA mode lookup must compile only in debug builds",
  );
  assert.doesNotMatch(
    libRs,
    /#\[cfg\(not\(debug_assertions\)\)\][\s\S]*fn qa_startup_mode/,
    "release builds must not compile a startup QA mode helper",
  );
  assert.match(libRs, /QaStartupMode::Offline/);
  assert.match(libRs, /QaStartupMode::CatalogFailure/);
  assert.match(libRs, /QaStartupMode::NormalUpdate/);
  assert.match(libRs, /QaStartupMode::CriticalUpdate/);
  assert.doesNotMatch(
    libRs,
    /qa_startup_mode[\s\S]{0,900}(PRODUCTION_ORIGIN|update_endpoint|updater_builder|pubkey)/,
    "debug injection must not replace production origin, updater endpoint, or signing key",
  );

  assert.equal(tauriConfig.app.windows[0].url, "startup.html");
  assert.deepEqual(tauriConfig.plugins.updater.endpoints ?? [], []);
  assert.equal(typeof tauriConfig.plugins.updater.pubkey, "string");
  assert.ok(tauriConfig.plugins.updater.pubkey.length > 40);
});

test("Windows lifecycle fixtures are deterministic and cleanup remains single-flight", () => {
  const wrapper = readText("scripts/windows-tauri-qa.mjs");
  const libRs = readText("windows-tauri/src-tauri/src/lib.rs");
  const fixtureState = libRs.match(
    /#\[cfg\(debug_assertions\)\]\s*fn apply_qa_update_state[\s\S]*?(?=\nfn desktop_bridge_script)/,
  )?.[0] ?? "";

  assert.match(
    fixtureState,
    /state\.set_channel\(UpdateChannel::Stable\)/,
    "debug fixture state must not inherit a persisted Test channel",
  );
  assert.match(
    wrapper,
    /cleanupPromise:\s*null/,
    "each spawned scenario must retain one shared cleanup promise",
  );
  assert.match(
    wrapper,
    /scenario\.cleanupPromise/,
    "signal and finally cleanup must converge on the same promise",
  );
});

test("Windows lifecycle wrapper owns a profile before either child can exist", () => {
  const wrapper = readText("scripts/windows-tauri-qa.mjs");
  const scenarioSetup = wrapper.match(
    /async function runScenario[\s\S]*?(?=\nfunction hasRunningClient)/,
  )?.[0] ?? "";

  assert.match(
    scenarioSetup,
    /const profilePath = mkdtempSync\([^\n]+\);\s*const scenario = \{\s*profilePath,\s*qaProcess: null,\s*client: null,\s*cleanupPromise: null,?\s*\};\s*activeScenario = scenario;\s*try \{/,
    "profile ownership must be registered immediately before setup or a child spawn can race a signal",
  );
  assert.match(scenarioSetup, /scenario\.qaProcess = spawn\(/);
  assert.match(scenarioSetup, /scenario\.client = spawn\(/);
  assert.match(scenarioSetup, /cleanupOwnedResources\(scenario\)/);
});

test("Windows lifecycle spec observes real native updater UI and all startup text geometry", () => {
  const spec = readText("tests/e2e/windows-tauri-startup.spec.ts");

  assert.match(spec, /loginAsRoleOrSkip/);
  assert.match(spec, /desktop-update-pill/);
  assert.match(spec, /desktop-critical-update-gate/);
  assert.match(spec, /startup-client-fingerprint.*span/);
  assert.match(spec, /startup-server-fingerprint.*span/);
  assert.match(spec, /\.endpoint-client h2/);
  assert.match(spec, /\.endpoint-client p/);
  assert.match(spec, /\.endpoint-server h2/);
  assert.match(spec, /\.endpoint-server p/);
  assert.match(spec, /\.stages li/);
  assert.match(spec, /startup-offline-retry-\$\{viewport\.width\}x\$\{viewport\.height\}/);
});

test("Windows update UI contract confirms Test to Stable reversal", () => {
  const spec = readText("tests/e2e/windows-tauri-shell.spec.ts");

  assert.match(spec, /set:stable/);
  assert.match(
    spec,
    /\[\s*"set:test",\s*"check",\s*"set:stable",\s*"check",?\s*\]/,
  );
  assert.match(
    spec,
    /toMatchObject\(\{\s*channel: "stable",\s*phase: "current",\s*mandatory: false,?\s*\}\)/,
  );
});
