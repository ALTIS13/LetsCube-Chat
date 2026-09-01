#!/usr/bin/env node
/**
 * Captures the sanitized LETSCUBE product previews used by the public home.
 *
 * The images are taken from the shipping `ChatListItem` and `MessageBubble`
 * components, so they show the genuine interface rather than a redrawing of it.
 * Only the data is fictional: the checked-in fixture is injected into a clean
 * browser context, never imported by the application, so no demo content can
 * reach a production bundle.
 *
 * The run is deterministic. The clock and the timezone are pinned, the browser
 * context carries no storage state, and the page signals readiness with an
 * attribute instead of the script waiting on a timeout.
 *
 * Usage: node scripts/capture-public-home-previews.mjs
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import sharp from "sharp";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const WORKSPACE = path.join(ROOT, "artifacts", "kub");
const FIXTURE_FILE = path.join(ROOT, "tests", "fixtures", "public-home-demo.json");
const OUTPUT_DIRECTORY = path.join(WORKSPACE, "public", "product");

const PORT = 5189;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const CAPTURE_PATH = "/__qa/public-preview";
const READY_SELECTOR = "[data-public-preview-ready]";

const STARTUP_TIMEOUT_MS = 180_000;
const STOP_GRACE_MS = 10_000;
const ANSI_PATTERN = /\u001B\[[0-9;]*m/g;

// Pinned so `formatTime` renders the fixture's display times rather than
// whatever the wall clock happens to say. It must be later than every fixture
// time, otherwise the same helper would render a weekday instead.
const PINNED_TIME = new Date("2026-08-31T15:10:00.000Z");

const WEBP_QUALITY = 88;

const DESKTOP_VIEWPORT = { width: 1280, height: 800 };
const MOBILE_VIEWPORT = { width: 390, height: 780 };

// Captured at deviceScaleFactor 2 and downsampled, which keeps text crisp while
// staying inside the published dimension budget.
const DESKTOP_OUTPUT = { width: 1440, height: 900 };

// Canvas geometry for the framed mobile shots. The bounds are the same ones
// tests/unit/public-product-assets.test.mjs enforces.
const MOBILE_CANVAS = { width: 760, height: 1140 };
const MOBILE_DEVICE_HEIGHT = 1040;

const TARGETS = [
  { file: "windows-messenger-dark.webp", surface: "desktop", theme: "dark" },
  { file: "windows-messenger-light.webp", surface: "desktop", theme: "light" },
  { file: "android-messenger-dark.webp", surface: "mobile", theme: "dark" },
  { file: "android-messenger-light.webp", surface: "mobile", theme: "light" },
  // Apple surfaces are shown as in development by the public UI. The images
  // carry the same sanitized conversation and no store, availability or
  // certification claim of any kind.
  { file: "macos-preview-placeholder.webp", surface: "desktop", theme: "light" },
  { file: "ios-preview-placeholder.webp", surface: "mobile", theme: "dark" },
];

function log(message) {
  process.stdout.write(`${message}\n`);
}

function readFixture() {
  if (!existsSync(FIXTURE_FILE)) {
    throw new Error(`Missing fixture: ${FIXTURE_FILE}`);
  }
  const raw = readFileSync(FIXTURE_FILE, "utf8");
  const fixture = JSON.parse(raw);
  // The page validates the payload again at runtime; this is the early, local
  // check so a malformed fixture fails before a browser is launched.
  for (const key of ["currentUser", "activeChat", "chats", "messages"]) {
    if (!(key in fixture)) throw new Error(`Fixture is missing "${key}"`);
  }
  return fixture;
}

async function answersOnOrigin() {
  try {
    const response = await fetch(`${ORIGIN}/`, { signal: AbortSignal.timeout(2_000) });
    return response.ok;
  } catch {
    return false;
  }
}

function killTree(child) {
  if (process.platform !== "win32" || child.pid === undefined) {
    child.kill("SIGTERM");
    return;
  }
  spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
}

async function settlesWithin(promise, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function startCaptureServer() {
  if (await answersOnOrigin()) {
    throw new Error(
      `Port ${PORT} is already serving. This script owns that port; stop the other server first.`,
    );
  }

  const viteBin = path.join(WORKSPACE, "node_modules", "vite", "bin", "vite.js");
  if (!existsSync(viteBin)) {
    throw new Error(`Vite is not installed for @workspace/kub at ${viteBin}.`);
  }

  const child = spawn(
    process.execPath,
    [viteBin, "--config", "vite.config.ts", "--host", "127.0.0.1"],
    {
      cwd: WORKSPACE,
      env: {
        ...process.env,
        PORT: String(PORT),
        BASE_PATH: "/",
        // The other half of the capture gate. Without it the route does not
        // exist even in a development build.
        VITE_PUBLIC_PREVIEW_FIXTURE: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );

  const state = { settled: false, code: null, failure: null, announced: false };
  const transcript = [];
  const record = (chunk) => {
    const plain = String(chunk).replace(ANSI_PATTERN, "");
    if (plain.includes(`:${PORT}`)) state.announced = true;
    transcript.push(plain);
    if (transcript.length > 200) transcript.shift();
  };
  child.stdout.on("data", record);
  child.stderr.on("data", record);
  child.once("error", (failure) => {
    state.settled = true;
    state.failure = failure;
  });
  child.once("exit", (code) => {
    state.settled = true;
    state.code = code;
  });

  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise((resolve) => child.once("exit", () => resolve()));
    killTree(child);
    if (!(await settlesWithin(exited, STOP_GRACE_MS))) {
      child.kill("SIGKILL");
      await settlesWithin(exited, STOP_GRACE_MS);
    }
  };

  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (state.settled) {
      const cause = state.failure ? `failed to spawn: ${state.failure.message}` : `exited with code ${state.code}`;
      throw new Error(`The capture server ${cause}.\n${transcript.join("")}`);
    }
    if (state.announced && (await answersOnOrigin())) {
      return { stop };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  await stop();
  throw new Error(`The capture server did not answer on ${ORIGIN} in time.\n${transcript.join("")}`);
}

async function capture(browser, fixture, target) {
  const isMobile = target.surface === "mobile";
  const context = await browser.newContext({
    viewport: isMobile ? MOBILE_VIEWPORT : DESKTOP_VIEWPORT,
    deviceScaleFactor: 2,
    // Pinned so the real `formatTime` path renders the fixture's own times.
    timezoneId: "UTC",
    locale: "ru-RU",
    colorScheme: target.theme,
    reducedMotion: "reduce",
    // No storage state: the context starts with nothing carried over.
    storageState: undefined,
  });

  const page = await context.newPage();
  await page.clock.setFixedTime(PINNED_TIME);
  await page.addInitScript(
    ({ key, payload, theme }) => {
      window[key] = payload;
      localStorage.setItem("kub-theme", theme);
    },
    { key: "__letscubePublicPreviewFixture", payload: fixture, theme: target.theme },
  );

  await page.goto(`${ORIGIN}${CAPTURE_PATH}`, { waitUntil: "load", timeout: 60_000 });
  await page.waitForSelector(READY_SELECTOR, { state: "visible", timeout: 60_000 });
  // Web fonts change metrics; capturing before they settle produces a different
  // image on every run.
  await page.evaluate(() => document.fonts.ready);

  const screenshot = await page.screenshot({ type: "png", animations: "disabled" });
  await context.close();

  return isMobile ? frameMobile(screenshot) : frameDesktop(screenshot);
}

function frameDesktop(screenshot) {
  return sharp(screenshot).resize({
    width: DESKTOP_OUTPUT.width,
    height: DESKTOP_OUTPUT.height,
    fit: "fill",
  });
}

async function frameMobile(screenshot) {
  const device = await sharp(screenshot)
    .resize({ height: MOBILE_DEVICE_HEIGHT, fit: "inside" })
    .png()
    .toBuffer();
  const { width } = await sharp(device).metadata();

  return sharp({
    create: {
      width: MOBILE_CANVAS.width,
      height: MOBILE_CANVAS.height,
      channels: 4,
      background: { r: 12, g: 18, b: 26, alpha: 1 },
    },
  }).composite([
    {
      input: device,
      left: Math.round((MOBILE_CANVAS.width - width) / 2),
      top: Math.round((MOBILE_CANVAS.height - MOBILE_DEVICE_HEIGHT) / 2),
    },
  ]);
}

async function main() {
  const fixture = readFixture();
  mkdirSync(OUTPUT_DIRECTORY, { recursive: true });

  log(`Starting the capture server on ${ORIGIN}`);
  const server = await startCaptureServer();
  let browser;

  try {
    browser = await chromium.launch();
    for (const target of TARGETS) {
      const image = await capture(browser, fixture, target);
      const output = path.join(OUTPUT_DIRECTORY, target.file);
      const buffer = await image.webp({ quality: WEBP_QUALITY, effort: 6 }).toBuffer();
      writeFileSync(output, buffer);

      const { width, height } = await sharp(buffer).metadata();
      log(`  ${target.file}: ${width}x${height}, ${buffer.length} bytes`);
    }
  } finally {
    if (browser) await browser.close();
    await server.stop();
    log("Capture server stopped");
  }
}

await main();
