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
const REQUIRED_FONT_FAMILY = "Inter";

// The component reserves the footer's width plus 8px for an inline time.
// Four is that with room for rounding at deviceScaleFactor 2 — enough to
// pass a close call and nowhere near enough to pass a collision, which
// measures zero or less.
const MIN_META_GAP_PX = 4;
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
  // Nor does `document.fonts.check` prove it: it answers whether the face is
  // usable, and a family that never loaded falls back and still counts. It
  // returned true in the sibling frame renderer on 2026-09-12 with both font
  // hosts blocked, and the frames were measured in Segoe UI — about 5px
  // narrower a label than the product. So the face is proved by measuring it:
  // the same string laid out with the page's stack and again with Inter struck
  // out of the stack must come to different widths.
  const fontLoaded = await page.evaluate((family) => {
    const probe = document.createElement("span");
    probe.textContent = "Сообщение";
    probe.style.cssText = "position:absolute;left:-9999px;top:0;font-size:16px;white-space:nowrap";
    document.body.appendChild(probe);
    const stack = getComputedStyle(document.body).fontFamily;
    probe.style.fontFamily = stack;
    const withFace = probe.getBoundingClientRect().width;
    probe.style.fontFamily = stack.split(",").filter((name) => !name.toLowerCase().includes(family.toLowerCase())).join(",");
    const withoutFace = probe.getBoundingClientRect().width;
    probe.remove();
    return withFace !== withoutFace;
  }, REQUIRED_FONT_FAMILY);
  if (!fontLoaded) {
    throw new Error(
      `The web font (${REQUIRED_FONT}) did not load, so this capture would not match a normal run.`,
    );
  }

  // The face arrives after the ready attribute and re-wraps the conversation.
  // Without this wait the shot can freeze a state no reader ever sees, which
  // is how android-messenger-dark.webp came to print a time against the last
  // word of its message on 2026-09-12 while its three siblings were clean.
  await waitForSettledLayout(page);
  await assertMetaStandsClear(page, target.file);

  const background = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--kub-bg").trim(),
  );
  const screenshot = await page.screenshot({ type: "png", animations: "disabled" });
  await context.close();

  void background;
  return sharp(screenshot).resize({ width: target.output.width });
}


/**
 * Until the placements and the paragraph boxes have been unchanged for 2.5
 * seconds. Copied in spirit from `message-meta-spacer-line.spec.ts`, which
 * needed the same wait for the same reason: WebKit re-lays the conversation
 * out about 1.3s after the route reports ready, and Chromium does it when
 * Inter arrives. A plateau shorter than the wait is not settled.
 */
async function waitForSettledLayout(page) {
  const signature = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-message-text-meta-group="true"]'))
        .map((group) => {
          const paragraph = group.querySelector("[data-message-text-flow]");
          const box = paragraph ? paragraph.getBoundingClientRect() : null;
          return group.getAttribute("data-message-meta-placement") + ":" + (box ? Math.round(box.width) : 0) + "x" + (box ? Math.round(box.height) : 0);
        })
        .join("|"),
    );
  let previous = await signature();
  let unchanged = 0;
  for (let sample = 0; sample < 80 && unchanged < 10; sample += 1) {
    await page.waitForTimeout(250);
    const current = await signature();
    unchanged = current === previous ? unchanged + 1 : 0;
    previous = current;
  }
  if (unchanged < 10) {
    throw new Error(
      "The conversation never stopped re-laying itself out, so this capture would freeze a state the reader never sees.",
    );
  }
}

/**
 * An inline time must stand clear of the text it sits beside, measured on the
 * geometry about to be written rather than on a class name. Refuses a scene
 * where nothing could be measured, so the check cannot pass by finding no
 * messages.
 */
async function assertMetaStandsClear(page, file) {
  const spacing = await page.evaluate((minimum) => {
    const lineBoxes = (rects) => {
      const lines = [];
      for (const rect of rects) {
        if (rect.width <= 0.5 || rect.height <= 0.5) continue;
        const centre = (rect.top + rect.bottom) / 2;
        const line = lines.find((candidate) => {
          const candidateCentre = (candidate.top + candidate.bottom) / 2;
          return Math.abs(candidateCentre - centre) <= Math.max(4, Math.min(candidate.bottom - candidate.top, rect.height) * 0.7);
        });
        if (line) {
          line.top = Math.min(line.top, rect.top);
          line.bottom = Math.max(line.bottom, rect.bottom);
          line.right = Math.max(line.right, rect.right);
        } else {
          lines.push({ top: rect.top, bottom: rect.bottom, right: rect.right });
        }
      }
      return lines.sort((a, b) => a.top - b.top);
    };
    const rectsOf = (node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = Array.from(range.getClientRects());
      range.detach();
      return rects;
    };
    const tight = [];
    let measured = 0;
    for (const group of Array.from(document.querySelectorAll('[data-message-text-meta-group="true"]'))) {
      if (group.getAttribute("data-message-meta-placement") !== "inline") continue;
      const content = group.querySelector('[data-message-text-content="true"]');
      const footer = group.querySelector('[data-message-footer="true"]');
      if (!content || !footer) continue;
      const lines = lineBoxes(rectsOf(content));
      const last = lines.length > 0 ? lines[lines.length - 1] : null;
      if (!last) continue;
      measured += 1;
      const gap = footer.getBoundingClientRect().left - last.right;
      if (gap < minimum) {
        tight.push((content.textContent || "").slice(0, 32).trim() + " -> " + gap.toFixed(1) + "px");
      }
    }
    return { measured, tight };
  }, MIN_META_GAP_PX);

  if (spacing.measured === 0) {
    throw new Error(
      file + ": no inline message time could be measured, so the spacing of the published image is unproven.",
    );
  }
  if (spacing.tight.length > 0) {
    throw new Error(
      file + ": a time would be printed against its message (" + MIN_META_GAP_PX + "px minimum): " + spacing.tight.join("; "),
    );
  }
  log(`  ${file}: ${spacing.measured} inline times, all clear of their text`);
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
