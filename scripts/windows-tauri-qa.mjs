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
const lifecycleModes = Object.freeze([
  "success",
  "offline",
  "catalog_failure",
  "normal_update",
  "critical_update",
]);
const requestedMode = process.env.LETSCUBE_TAURI_QA_STARTUP_MODE;

if (process.platform !== "win32") {
  console.error("Windows Tauri QA can run only on Windows.");
  process.exit(1);
}
if (!existsSync(cargoPath)) {
  console.error("Rust/Cargo is not installed at the expected user toolchain path.");
  process.exit(1);
}
if (requestedMode && !lifecycleModes.includes(requestedMode)) {
  console.error("LETSCUBE_TAURI_QA_STARTUP_MODE is invalid.");
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

let activeScenario = null;
let signalHandled = false;

process.on("SIGINT", () => handleSignal(130));
process.on("SIGTERM", () => handleSignal(143));

const scenarios = requestedMode
  ? [{ name: requestedMode, mode: requestedMode, spec: "tests/e2e/windows-tauri-startup.spec.ts" }]
  : [
      { name: "baseline", mode: null, spec: "tests/e2e/windows-tauri-shell.spec.ts" },
      ...lifecycleModes.map((mode) => ({
        name: mode,
        mode,
        spec: "tests/e2e/windows-tauri-startup.spec.ts",
      })),
    ];

for (const scenario of scenarios) {
  console.log(`\n[windows-tauri-qa] Running ${scenario.name}...`);
  const result = await runScenario(scenario);
  if (result !== 0) {
    process.exitCode = result;
    break;
  }
}

async function runScenario({ name, mode, spec }) {
  const debugPort = await reserveLoopbackPort();
  const profilePath = mkdtempSync(path.join(os.tmpdir(), `letscube-tauri-qa-${name}-`));
  const scenario = { profilePath, qaProcess: null, client: null, cleanupPromise: null };
  activeScenario = scenario;

  try {
    const outputPath = path.join("output", "playwright-test", "windows-tauri-qa", name);
    const cdpUrl = `http://127.0.0.1:${debugPort}`;
    const qaEnv = {
      ...process.env,
      LETSCUBE_TAURI_CDP_URL: cdpUrl,
    };
    const clientEnv = {
      ...process.env,
      LETSCUBE_WEBVIEW2_DATA_DIR: profilePath,
      LETSCUBE_WEBVIEW2_DEBUG_PORT: String(debugPort),
      LETSCUBE_TAURI_QA_HOLD_PREFLIGHT: "1",
    };
    if (mode) {
      qaEnv.LETSCUBE_TAURI_QA_STARTUP_MODE = mode;
      clientEnv.LETSCUBE_TAURI_QA_STARTUP_MODE = mode;
    } else {
      delete qaEnv.LETSCUBE_TAURI_QA_STARTUP_MODE;
      delete clientEnv.LETSCUBE_TAURI_QA_STARTUP_MODE;
    }

    scenario.qaProcess = spawn(
      process.env.ComSpec || "cmd.exe",
      [
        "/d",
        "/s",
        "/c",
        "pnpm.cmd",
        "exec",
        "playwright",
        "test",
        spec,
        "--project",
        "chromium-desktop-1440",
        "--output",
        outputPath,
      ],
      { cwd: root, env: qaEnv, stdio: "inherit" },
    );
    scenario.client = spawn(executablePath, [], {
      cwd: root,
      env: clientEnv,
      stdio: "ignore",
    });
    scenario.client.once("error", (error) => {
      console.error(`Windows Tauri QA client failed to start: ${error.message}`);
    });
    return await waitForExit(scenario.qaProcess);
  } finally {
    const clean = await cleanupOwnedResources(scenario);
    if (activeScenario === scenario) activeScenario = null;
    if (!clean) process.exitCode = 1;
  }
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

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

function handleSignal(exitCode) {
  if (signalHandled) return;
  signalHandled = true;
  void cleanupOwnedResources(activeScenario).then((clean) => process.exit(clean ? exitCode : 1));
}

async function cleanupOwnedResources(scenario) {
  if (!scenario) return true;
  if (scenario.cleanupPromise) return scenario.cleanupPromise;

  scenario.cleanupPromise = (async () => {
    const { qaProcess, client, profilePath } = scenario;
    let clean = await terminateOwnedProcess(qaProcess);
    clean = (await terminateOwnedProcess(client)) && clean;
    clean = (await removeProfile(profilePath)) && clean;
    if (!clean) console.error("Windows Tauri QA cleanup did not complete safely.");
    return clean;
  })();
  return scenario.cleanupPromise;
}

async function terminateOwnedProcess(child) {
  if (!child?.pid || !isPidRunning(child.pid)) return true;
  spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
    stdio: "ignore",
  });
  await delay(500);
  return !isPidRunning(child.pid);
}

async function removeProfile(profilePath) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      rmSync(profilePath, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 });
    } catch {
      // A just-killed WebView2 child can briefly retain a profile handle.
    }
    if (!existsSync(profilePath)) return true;
    await delay(750);
  }
  return false;
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
