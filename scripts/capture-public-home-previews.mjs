#!/usr/bin/env node
/**
 * Captures the sanitized LETSCUBE product previews used by the public home.
 *
 * The images are taken from the shipping application components, so they show
 * the genuine interface rather than a redrawing of it. Only the data is
 * fictional: the checked-in fixture is injected into a clean browser context,
 * never imported by the application, so no demo content can reach a production
 * bundle.
 *
 * The run is deterministic. The clock, timezone and locale are pinned, every
 * request outside the capture origin and the font host is blocked, the web font
 * is verified to have actually loaded, the browser context carries no storage
 * state, and the page signals readiness with an attribute rather than the
 * script waiting on a timeout.
 *
 * Usage: node scripts/capture-public-home-previews.mjs
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import sharp from "sharp";

// Imported rather than copied: renaming any of these must break the run at the
// source, not silently after a 60 second selector timeout.
import {
  PUBLIC_PREVIEW_CAPTURE_PATH,
  PUBLIC_PREVIEW_READY_ATTRIBUTE,
  PUBLIC_PREVIEW_WINDOW_KEY,
} from "../artifacts/kub/src/lib/publicPreviewFixture.ts";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const WORKSPACE = path.join(ROOT, "artifacts", "kub");
const FIXTURE_FILE = path.join(ROOT, "tests", "fixtures", "public-home-demo.json");
const OUTPUT_DIRECTORY = path.join(WORKSPACE, "public", "product");

const PORT = 5189;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const READY_SELECTOR = `[${PUBLIC_PREVIEW_READY_ATTRIBUTE}]`;

const STARTUP_TIMEOUT_MS = 180_000;
const STOP_GRACE_MS = 10_000;
const ANSI_PATTERN = /\u001B\[[0-9;]*m/g;

// Pinned so `formatTime` renders the fixture's display times rather than
// whatever the wall clock says. `todayAt` throws if a fixture time is later
// than this, which would otherwise render a weekday name instead.
const PINNED_TIME = new Date("2026-08-31T15:10:00.000Z");

// The application refuses to start without public Supabase configuration, and
// the shipping chat and sidebar components construct a client while rendering.
// These are obviously fake loopback values, they are not credentials, and every
// request they could produce is blocked below.
const FIXTURE_SUPABASE_URL = "http://127.0.0.1:54321";
const FIXTURE_SUPABASE_KEY = "public-preview-fixture";

// The only hosts a capture may talk to. Everything else is aborted, so a
// component reaching for a backend cannot make the run non-deterministic and
// cannot contact anything real.
const ALLOWED_HOSTS = ["127.0.0.1", "localhost", "fonts.googleapis.com", "fonts.gstatic.com"];

const REQUIRED_FONT = "16px Inter";
const WEBP_QUALITY = 88;

/**
 * One asset per released platform and theme. Everything is captured at
 * deviceScaleFactor 2 and downsampled by width, which keeps text crisp and
 * keeps the aspect ratio self-correcting. Every viewport is chosen so its
 * doubled pixels already satisfy the published bounds, so no asset needs a mat
 * around it.
 *
 * Platforms without a published build are deliberately not illustrated: a
 * single image cannot be theme matched, and reusing another platform's render
 * under an unreleased heading would suggest a product that does not exist.
 */
const TARGETS = [
  {
    file: "windows-messenger-dark.webp",
    theme: "dark",
    viewport: { width: 1280, height: 800 },
    output: { width: 1440 },
  },
  {
    file: "windows-messenger-light.webp",
    theme: "light",
    viewport: { width: 1280, height: 800 },
    output: { width: 1440 },
  },
  {
    file: "android-messenger-dark.webp",
    theme: "dark",
    // 390x596 at deviceScaleFactor 2 is 780x1192, which clears the published
    // minimum width without a surrounding mat. Framing the phone on a canvas
    // published mostly empty background and read as a strange aspect ratio on
    // the page.
    viewport: { width: 390, height: 596 },
    output: { width: 780 },
  },
  {
    file: "android-messenger-light.webp",
    theme: "light",
    viewport: { width: 390, height: 596 },
    output: { width: 780 },
  },
];

function log(message) {
  process.stdout.write(`${message}\n`);
}

function readFixture() {
  if (!existsSync(FIXTURE_FILE)) throw new Error(`Missing fixture: ${FIXTURE_FILE}`);
  const fixture = JSON.parse(readFileSync(FIXTURE_FILE, "utf8"));
  // The page validates the payload again at runtime; this is the early check so
  // a malformed fixture fails before a browser is launched.
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
  if (!existsSync(viteBin)) throw new Error(`Vite is not installed for @workspace/kub at ${viteBin}.`);

  const child = spawn(
    process.execPath,
    [viteBin, "--config", "vite.config.ts", "--host", "127.0.0.1"],
    {
      cwd: WORKSPACE,
      env: {
        ...process.env,
        PORT: String(PORT),
        BASE_PATH: "/",
        VITE_SUPABASE_URL: FIXTURE_SUPABASE_URL,
        VITE_SUPABASE_ANON_KEY: FIXTURE_SUPABASE_KEY,
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

  // An external kill of this process would otherwise orphan the server.
  const onSignal = () => {
    killTree(child);
    process.exit(130);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (state.settled) {
      const cause = state.failure
        ? `failed to spawn: ${state.failure.message}`
        : `exited with code ${state.code}`;
      throw new Error(`The capture server ${cause}.\n${transcript.join("")}`);
    }
    if (state.announced && (await answersOnOrigin())) return { stop };
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  await stop();
  throw new Error(`The capture server did not answer on ${ORIGIN} in time.\n${transcript.join("")}`);
}

async function capture(browser, fixture, target) {
  const context = await browser.newContext({
    viewport: target.viewport,
    deviceScaleFactor: 2,
    timezoneId: "UTC",
    locale: "ru-RU",
    colorScheme: target.theme,
    reducedMotion: "reduce",
    // No storage state: the context starts with nothing carried over.
    storageState: undefined,
  });

  // Nothing outside the capture origin and the font host may be contacted. A
  // component reaching for a backend is aborted rather than left to time out.
  await context.route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname;
    if (ALLOWED_HOSTS.includes(host)) return route.continue();
    return route.abort();
  });

  const page = await context.newPage();
  await page.clock.setFixedTime(PINNED_TIME);
  await page.addInitScript(
    ({ key, payload, theme }) => {
      window[key] = payload;
      localStorage.setItem("kub-theme", theme);
    },
    { key: PUBLIC_PREVIEW_WINDOW_KEY, payload: fixture, theme: target.theme },
  );

  await page.goto(`${ORIGIN}${PUBLIC_PREVIEW_CAPTURE_PATH}`, {
    waitUntil: "load",
    timeout: 60_000,
  });
  await page.waitForSelector(READY_SELECTOR, { state: "visible", timeout: 60_000 });

  // `document.fonts.ready` resolves even when the stylesheet request failed, so
  // it proves nothing on its own. Without this check an offline or blocked run
  // would silently fall back to the system stack and produce different pixels.
  await page.evaluate(() => document.fonts.ready);
  const fontLoaded = await page.evaluate((font) => document.fonts.check(font), REQUIRED_FONT);
  if (!fontLoaded) {
    throw new Error(
      `The web font (${REQUIRED_FONT}) did not load, so this capture would not match a normal run.`,
    );
  }

  const background = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--kub-bg").trim(),
  );
  const screenshot = await page.screenshot({ type: "png", animations: "disabled" });
  await context.close();

  void background;
  return sharp(screenshot).resize({ width: target.output.width });
}


function pruneOutputDirectory() {
  mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
  const expected = new Set(TARGETS.map((target) => target.file));
  for (const name of readdirSync(OUTPUT_DIRECTORY)) {
    if (expected.has(name)) continue;
    // A renamed target would otherwise leave an orphan that only surfaces later
    // as a confusing directory-listing failure.
    rmSync(path.join(OUTPUT_DIRECTORY, name), { force: true });
    log(`  removed stale asset ${name}`);
  }
}

async function main() {
  const fixture = readFixture();
  pruneOutputDirectory();

  log(`Starting the capture server on ${ORIGIN}`);
  const server = await startCaptureServer();
  let browser;

  try {
    browser = await chromium.launch();
    for (const target of TARGETS) {
      const image = await capture(browser, fixture, target);
      const buffer = await image.webp({ quality: WEBP_QUALITY, effort: 6 }).toBuffer();
      writeFileSync(path.join(OUTPUT_DIRECTORY, target.file), buffer);

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
