#!/usr/bin/env node

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "windows-tauri", "src-tauri", "Cargo.toml");
const executablePath = path.join(
  root,
  "windows-tauri",
  "src-tauri",
  "target",
  "debug",
  "letscube-windows-tauri.exe",
);
const cargoPath = path.join(os.homedir(), ".cargo", "bin", "cargo.exe");
const processImage = "letscube-windows-tauri.exe";
const PRODUCTION_ORIGIN = "https://app.letscube.ru";

if (process.platform !== "win32") {
  console.error("Windows Tauri QA can run only on Windows.");
  process.exit(1);
}
if (!existsSync(cargoPath)) {
  console.error("Rust/Cargo is not installed at the expected user toolchain path.");
  process.exit(1);
}
if (hasRunningClient()) {
  console.error("Close the running LETSCUBE Windows client before starting isolated Tauri QA.");
  process.exit(1);
}

const build = spawnSync(cargoPath, ["build", "--manifest-path", manifestPath], {
  cwd: root,
  stdio: "inherit",
});
if (build.status !== 0 || !existsSync(executablePath)) {
  console.error("Tauri debug build failed.");
  process.exit(build.status ?? 1);
}

const debugPort = await reserveLoopbackPort();
const profilePath = mkdtempSync(path.join(os.tmpdir(), "letscube-tauri-qa-"));
const cdpUrl = `http://127.0.0.1:${debugPort}`;
const client = spawn(executablePath, [], {
  cwd: root,
  env: {
    ...process.env,
    LETSCUBE_WEBVIEW2_DATA_DIR: profilePath,
    LETSCUBE_WEBVIEW2_DEBUG_PORT: String(debugPort),
  },
  stdio: "ignore",
});
let qaProcess = null;
let cleanupPromise = null;
let signalHandled = false;

process.on("SIGINT", () => handleSignal(130));
process.on("SIGTERM", () => handleSignal(143));

try {
  await waitForProductionTarget(cdpUrl, client);
  qaProcess = spawn(
    process.env.ComSpec || "cmd.exe",
    [
      "/d",
      "/s",
      "/c",
      "pnpm.cmd",
      "exec",
      "playwright",
      "test",
      "tests/e2e/windows-tauri-shell.spec.ts",
      "--project",
      "chromium-desktop-1440",
    ],
    {
      cwd: root,
      env: { ...process.env, LETSCUBE_TAURI_CDP_URL: cdpUrl },
      stdio: "inherit",
    },
  );
  process.exitCode = await waitForExit(qaProcess);
} finally {
  if (!(await cleanupOwnedResources())) process.exitCode = 1;
}

function hasRunningClient() {
  const result = spawnSync(
    "tasklist.exe",
    ["/FI", `IMAGENAME eq ${processImage}`, "/FO", "CSV", "/NH"],
    { encoding: "utf8" },
  );
  return result.status === 0 && result.stdout.toLowerCase().includes(processImage);
}

function reserveLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => {
        if (error) reject(error);
        else if (port) resolve(port);
        else reject(new Error("Could not reserve a loopback port."));
      });
    });
  });
}

async function waitForProductionTarget(cdpUrl, client) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (client.exitCode !== null) throw new Error("Tauri client exited before WebView2 was ready.");
    try {
      const response = await fetch(`${cdpUrl}/json/list`, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) {
        const targets = await response.json();
        if (Array.isArray(targets) && targets.some((target) => hasProductionOrigin(target?.url))) {
          return;
        }
      }
    } catch {
      // The main WebView starts after the local splash closes.
    }
    await delay(250);
  }
  throw new Error("Timed out waiting for the production Tauri WebView CDP target.");
}

function hasProductionOrigin(value) {
  try {
    return new URL(value).origin === PRODUCTION_ORIGIN;
  } catch {
    return false;
  }
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

function handleSignal(exitCode) {
  if (signalHandled) return;
  signalHandled = true;
  void cleanupOwnedResources().then((clean) => process.exit(clean ? exitCode : 1));
}

function cleanupOwnedResources() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    let clean = await terminateOwnedProcess(qaProcess);
    clean = (await terminateOwnedProcess(client)) && clean;
    await delay(750);
    try {
      rmSync(profilePath, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 });
    } catch {
      clean = false;
    }
    if (existsSync(profilePath)) clean = false;
    if (!clean) console.error("Windows Tauri QA cleanup did not complete safely.");
    return clean;
  })();
  return cleanupPromise;
}

async function terminateOwnedProcess(child) {
  if (!child?.pid || !isPidRunning(child.pid)) return true;
  const result = spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
    stdio: "ignore",
  });
  await delay(500);
  return result.status === 0 && !isPidRunning(child.pid);
}

function isPidRunning(pid) {
  const result = spawnSync("tasklist.exe", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
    encoding: "utf8",
  });
  if (result.status !== 0) return true;
  return result.stdout.includes(`"${pid}"`);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
