#!/usr/bin/env node
// Real WebView2 and production readiness code; no installed profile or account.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { newestSource, readBundleEnvironment } from "./windows-tauri-frontend-bundle.mjs";
import { readWindowsProcessIdentity, stopOwnedWindowsProcess } from "./windows-tauri-boot-process.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundle = path.join(root, "artifacts/kub/dist/public");
const exe = path.join(root, "windows-tauri/src-tauri/target/debug/letscube-windows-tauri.exe");
const origin = "https://app.letscube.ru";
const bootUrl = "http://tauri.localhost/startup.html";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
assert.equal(process.platform, "win32");
assert.equal(process.env.KUB_QA_ALLOW_MUTATIONS, "0", "explicit read-only QA flag required");
const html = readFileSync(path.join(bundle, "index.html"), "utf8");
assert(newestSource(root).mtimeMs <= statSync(path.join(bundle, "index.html")).mtimeMs, "rebuild frontend: source is newer than the bundle");
const publicEnv = readBundleEnvironment(bundle);
assert(new URL(publicEnv.VITE_SUPABASE_URL).hostname === "127.0.0.1", "this guest QA requires the dummy localhost frontend build");
assert(html.includes('id="kub-boot-controller"'), "build the current frontend first");
const entry = html.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1];
assert(entry, "built entry must exist");
const entrySource = readFileSync(path.join(bundle, entry), "utf8");
assert(entrySource.includes("kubAppReady"), "built entry must acknowledge its real React commit");
assert(!entrySource.includes("VITE_PUBLIC_PREVIEW_FIXTURE"), "do not run a preview-capture build");

const running = spawnSync("pwsh.exe", ["-NoProfile", "-NonInteractive", "-Command",
  "Get-CimInstance Win32_Process -Filter \"Name='letscube-windows-tauri.exe'\" | ForEach-Object { $_.ExecutablePath }"],
{ encoding: "utf8", windowsHide: true });
assert.equal(running.status, 0, "must verify the debug executable is not owned by another run");
assert(!running.stdout.split(/\r?\n/).some((value) => value.trim().toLowerCase() === exe.toLowerCase()), "debug client already running");
const build = spawnSync(path.join(os.homedir(), ".cargo/bin/cargo.exe"), ["build", "--offline", "--locked", "--manifest-path", "windows-tauri/src-tauri/Cargo.toml"],
  { cwd: root, stdio: "inherit", windowsHide: true });
assert.equal(build.status, 0, "current native debug build required");
assert(existsSync(exe));

const owned = mkdtempSync(path.join(os.tmpdir(), "letscube-native-boot-"));
const port = await new Promise((resolve, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const port = server.address().port;
    server.close(() => resolve(port));
  });
});
const client = spawn(exe, [], {
  cwd: root, windowsHide: true, stdio: "ignore",
  env: { ...process.env, LETSCUBE_TAURI_QA_ISOLATED_IDENTITY: "1", LETSCUBE_TAURI_QA_HOLD_PREFLIGHT: "1",
    LETSCUBE_TAURI_QA_STARTUP_MODE: "catalog_failure", LETSCUBE_APP_DATA_DIR: path.join(owned, "app"),
    LETSCUBE_WEBVIEW2_DATA_DIR: path.join(owned, "webview"), LETSCUBE_WEBVIEW2_DEBUG_PORT: String(port) },
});
let clientIdentity;
let browser;
let page;
let mode = "healthy";
let entryRequests = 0;
let fulfilledRequests = 0;
let abortedEntries = 0;
let blockedRequests = 0;
let localIpcRequests = 0;
let releaseEntry = () => {};
let watchdog;
const results = [];
let closing;
let stopping = false;
async function cleanup() {
  if (closing) return closing;
  closing = (async () => {
    clearTimeout(watchdog);
    stopping = true;
    // Keep interception attached until the owned native/renderer tree is stopped.
    // CDP Browser.close disconnects the transport; it does not stop this app.
    if (client.exitCode === null && client.signalCode === null && client.pid) {
      const exited = new Promise((resolve) => client.once("exit", resolve));
      stopOwnedWindowsProcess(clientIdentity);
      await Promise.race([exited, pause(5000)]);
      assert(client.exitCode !== null || client.signalCode !== null, "owned debug process did not exit");
    }
    releaseEntry();
    if (browser) await browser.close().catch(() => {});
    // Keep removal native to PowerShell and verify the exact temporary target.
    const remove = spawnSync("pwsh.exe", ["-NoProfile", "-NonInteractive", "-Command", `
      $target=[IO.Path]::GetFullPath($env:LETSCUBE_BOOT_QA_TEMP)
      $parent=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\\')
      if ([IO.Path]::GetDirectoryName($target) -ne $parent -or [IO.Path]::GetFileName($target) -notlike 'letscube-native-boot-*') { exit 2 }
      $until=(Get-Date).AddSeconds(45)
      do {
        try { if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction Stop } } catch { Start-Sleep -Milliseconds 500 }
      } while ((Test-Path -LiteralPath $target) -and (Get-Date) -lt $until)
      if (Test-Path -LiteralPath $target) { exit 3 }
    `], { env: { ...process.env, LETSCUBE_BOOT_QA_TEMP: owned }, encoding: "utf8", windowsHide: true });
    assert.equal(remove.status, 0, "temporary WebView2 profile cleanup failed");
  })();
  return closing;
}
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { void cleanup().finally(() => process.exit(130)); });
watchdog = setTimeout(() => { console.error("Native boot QA exceeded its 5-minute deadline"); void cleanup().finally(() => process.exit(1)); }, 300_000);

try {
  clientIdentity = readWindowsProcessIdentity(client.pid);
  assert(clientIdentity && clientIdentity.path.toLowerCase() === exe.toLowerCase(), "debug process identity not verified");
  for (let attempt = 0; attempt < 100; attempt++) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1000 }); break; }
    catch { await pause(200); }
  }
  assert(browser, "owned WebView2 CDP endpoint unavailable");
  const contexts = browser.contexts();
  assert.equal(contexts.length, 1);
  const context = contexts[0];
  assert.equal(context.pages().length, 1);
  page = context.pages()[0];
  await page.waitForURL(bootUrl);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setBypassServiceWorker", { bypass: true });
  await context.routeWebSocket("**/*", (socket) => socket.close());
  await context.addInitScript(() => {
    window.__bootQaStates = [];
    window.addEventListener("letscube://startup-state", (event) => {
      const { stage, connected, documentId, errorCode } = event.detail;
      window.__bootQaStates.push({ stage, connected, documentId, errorCode });
    });
    localStorage.setItem("kub-theme", "dark");
  });
  // Every renderer resource is local/intercepted. Only native's unchanged public
  // HTTPS preflight runs remotely; catalog_failure mode skips its catalog GET.
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (["http://tauri.localhost", "http://ipc.localhost"].includes(url.origin)) { localIpcRequests++; return route.continue(); }
    if (url.origin !== origin || url.pathname === "/sw.js") { blockedRequests++; return route.fulfill({ status: 503, body: "" }); }
    const fulfill = async (options) => { await route.fulfill(options); fulfilledRequests++; };
    if (url.pathname === entry) {
      entryRequests++;
      if (mode === "abort") { abortedEntries++; return route.abort(); }
      if (mode === "throw") return fulfill({ contentType: "application/javascript", body: 'throw new Error("fixture-module-failure")' });
      if (mode === "hold") await new Promise((resolve) => { releaseEntry = resolve; });
      if (stopping) return;
    }
    const candidate = path.resolve(bundle, `.${decodeURIComponent(url.pathname)}`);
    if (!candidate.startsWith(bundle + path.sep) && candidate !== bundle) return fulfill({ status: 404, body: "" });
    if (url.pathname === "/" || url.pathname.startsWith("/login")) return fulfill({ contentType: "text/html", body: html });
    if (!existsSync(candidate)) return fulfill({ status: 404, body: "" });
    const type = { ".js": "application/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" }[path.extname(candidate)];
    return fulfill({ path: candidate, contentType: type, headers: { "cache-control": "no-store" } });
  });
  await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("begin_startup_qa"));
  await page.waitForURL((url) => url.origin === origin, { timeout: 25000 });
  const isReady = () => page.evaluate(() => {
    const receipt = window.__letscubeReadiness?.();
    return Boolean(receipt?.state === "ready" && receipt.loaded && window.__bootQaStates?.some(
      (state) => state.stage === "complete" && state.connected && state.documentId === receipt.documentId));
  });
  await expect.poll(isReady, { timeout: 15000 }).toBe(true);
  await expect(page.locator('#root[data-kub-app-ready="true"]')).toBeVisible();
  await expect(page.getByTestId("production-startup-overlay")).toHaveCount(0, { timeout: 6000 });
  results.push({ scenario: "healthy-real-react", passed: true });
  const engine = await browser.version();
  const url = origin + "/login?returnTo=%2Fchat%2Ffixture#retained";
  const prepare = async (next) => {
    mode = next;
    const previousRequests = entryRequests;
    const previousDocument = await page.evaluate(() => window.__letscubeReadiness?.().documentId);
    await page.evaluate(() => {
      sessionStorage.removeItem("letscube:startup-overlay-complete");
      localStorage.setItem("qa-local", "retained"); sessionStorage.setItem("qa-session", "retained");
    });
    // Repeating a URL containing a fragment can be same-document navigation.
    // Fault injection requires a real new document and an actual entry request.
    if (page.url() === url) await page.reload({ waitUntil: "commit" });
    else await page.goto(url, { waitUntil: "commit" });
    await expect.poll(() => entryRequests).toBeGreaterThan(previousRequests);
    await expect.poll(() => page.evaluate((previous) => {
      const current = window.__letscubeReadiness?.().documentId;
      return Boolean(current && current !== previous);
    }, previousDocument)).toBe(true);
    console.log(JSON.stringify({ scenarioStarted: next, entryRequests }));
  };
  const retained = async () => {
    assert.equal(page.url(), url);
    assert.deepEqual(await page.evaluate(() => [localStorage.getItem("qa-local"), sessionStorage.getItem("qa-session")]), ["retained", "retained"]);
  };
  for (const failure of ["abort", "throw"]) {
    await prepare(failure);
    const retry = page.getByRole("button", { name: "Повторить загрузку", exact: true });
    await expect(retry).toBeVisible({ timeout: 15000 });
    await retry.click({ trial: true });
    await expect(page.getByTestId("production-startup-overlay")).toHaveCount(0);
    assert.equal(await isReady(), false);
    mode = "healthy";
    await retry.click();
    await expect(page.getByTestId("auth-form-shell")).toBeVisible();
    await expect.poll(isReady, { timeout: 8000 }).toBe(true);
    await retained();
    results.push({ scenario: failure + "-retry", passed: true });
  }
  for (const afterDeadline of [false, true]) {
    await prepare("hold");
    await expect(page.getByRole("button", { name: "Повторить загрузку", exact: true })).toBeVisible({ timeout: 16000 });
    assert.equal(await isReady(), false);
    await expect(page.getByTestId("production-startup-overlay")).toHaveCount(0);
    if (afterDeadline) await expect.poll(() => page.evaluate(() => window.__bootQaStates?.some((state) => state.stage === "workspace_unconfirmed")), { timeout: 24000 }).toBe(true);
    mode = "healthy";
    releaseEntry();
    await expect(page.getByTestId("auth-form-shell")).toBeVisible();
    await expect(page.locator("#kub-boot-recovery")).toHaveCount(0);
    if (afterDeadline) { await pause(1000); assert.equal(await isReady(), false); }
    else await expect.poll(isReady, { timeout: 8000 }).toBe(true);
    await retained();
    // Real native controls and bridge remain callable after an unconfirmed boot.
    assert.equal(typeof await page.evaluate(() => window.letscubeDesktop.isMaximized()), "boolean");
    results.push({ scenario: afterDeadline ? "native-deadline-late-react" : "watchdog-late-react", passed: true });
  }
  await prepare("healthy");
  await expect(page.getByTestId("auth-form-shell")).toBeVisible();
  await expect.poll(isReady, { timeout: 8000 }).toBe(true);
  await retained();
  results.push({ scenario: "new-document-after-deadline", passed: true });
  assert.equal(context.serviceWorkers().length, 0, "service workers must not bypass renderer interception");
  console.log(JSON.stringify({ engine, results, fulfilledRequests, abortedEntries, blockedRequests, localIpcRequests,
    nativePublicPreflight: true, serviceWorkers: context.serviceWorkers().length, accountSignedIn: false }));
} catch (error) {
  if (page && !page.isClosed()) console.error(JSON.stringify({ mode, entryRequests, completed: results.length,
    diagnostic: await page.evaluate(() => ({ boot: document.documentElement.dataset.kubBootState,
      ready: document.getElementById("root")?.dataset.kubAppReady, recovery: !!document.getElementById("kub-boot-recovery"),
      states: window.__bootQaStates?.map(({ stage, connected }) => ({ stage, connected })),
      receipt: window.__letscubeReadiness?.().state })).catch(() => null) }));
  throw error;
} finally { await cleanup(); }
