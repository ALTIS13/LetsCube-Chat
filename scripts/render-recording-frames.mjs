#!/usr/bin/env node
/**
 * Renders the composer's recording gesture as it now works (D-130), in both
 * themes, on an iPhone and on a desktop, over the checked-in fictional
 * conversation.
 *
 * Five states, and they are the gesture's own: held at rest, slid part of the
 * way towards the cancel, locked hands-free, stopped for a listen, and the hint
 * a press too short to be a recording leaves behind.
 *
 * Every frame is the real application on the DEV preview route, driven by real
 * input — a finger's touch and drag on the iPhone, the mouse on the desktop —
 * and it measures what it shows before it is photographed: which phase the row
 * is in, what the timer reads, how full the lock rail is, how far the row has
 * followed the finger, and that exactly one microphone was opened and no camera.
 * The numbers go into results.json beside the pictures, so what the owner is
 * looking at is described by the frame rather than by me.
 *
 * The microphone is Chromium's fake device, so nothing real is recorded and no
 * permission dialog is ever shown. Nothing on a network is reached: every
 * request off this machine and the font host is aborted.
 *
 * It does not start a server. Point it at a dev server on the fixture
 * configuration (`VITE_SUPABASE_URL=http://127.0.0.1:54321`,
 * `VITE_PUBLIC_PREVIEW_FIXTURE=1`); it refuses anything else.
 *
 * Usage:
 *   KUB_BASE_URL=http://127.0.0.1:5310 node scripts/render-recording-frames.mjs
 *     [--only dark-iphone-3-locked,light-desktop-1-holding]
 *     [--sheets]
 *
 * Writes output/renders/2026-09-12-recording-gesture/.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const { chromium } = await import(
  pathToFileURL(path.join(ROOT, "node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs")).href
);
const sharp = createRequire(import.meta.url)("sharp");

const BASE = process.env.KUB_BASE_URL ?? "";
const OUT = path.join(ROOT, "output", "renders", "2026-09-12-recording-gesture");
const RESULTS_FILE = path.join(OUT, "results.json");
const CAPTURE_PATH = "/__qa/public-preview";
const WINDOW_KEY = "__letscubePublicPreviewFixture";
const CLOCK = new Date("2026-09-11T18:00:00+03:00");
const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost", "fonts.googleapis.com", "fonts.gstatic.com"]);

/** How long each frame lets the recording run, on the page's own clock. */
const RECORD_MS = 3_000;
/** The two distances the gesture is measured against, from lib/recordingGesture.ts. */
const CANCEL_SLIDE_PX = 96;
const LOCK_DRAG_PX = 72;

const argValue = (flag) => {
  const index = process.argv.indexOf(flag);
  return index > 0 ? process.argv[index + 1] ?? null : null;
};
const only = argValue("--only") ? new Set(argValue("--only").split(",").map((id) => id.trim())) : null;
const sheetsOnly = process.argv.includes("--sheets");

// ── the conversation ────────────────────────────────────────────────────────

const CHAT = "Витрина на Садовой";

const FIXTURE = {
  currentUser: { name: "Максим", username: "maksim" },
  activeChat: { name: CHAT, memberCount: 4 },
  chats: [
    { name: CHAT, preview: "И геопозицию для курьера", time: "17:52", unread: 0 },
    { name: "Аня Смирнова", preview: "До завтра!", time: "16:10", unread: 2 },
    { name: "Борис", preview: "Созвонимся вечером?", time: "15:20", unread: 0 },
  ],
  messages: [
    { sender: "Аня", text: "Добрый вечер! Монтаж закончили?", time: "17:31", own: false },
    { sender: "Максим", text: "Да, только что. Сейчас пришлю фото витрины и полок", time: "17:40", own: true },
    { sender: "Борис", text: "И вход сфотографируйте, пожалуйста", time: "17:46", own: false },
    { sender: "Вера", text: "Смету пришлите файлом, чтобы цифры не поплыли", time: "17:48", own: false },
    { sender: "Аня", text: "И геопозицию для курьера — он завтра везёт стенды", time: "17:52", own: false },
  ],
  recentReactions: ["👍", "🔥", "😂", "🎉", "😮", "🙏"],
};

// ── what is rendered ────────────────────────────────────────────────────────

const THEMES = [
  { id: "dark", title: "Тёмная тема" },
  { id: "light", title: "Светлая тема" },
];

const DEVICES = {
  iphone: {
    viewport: { width: 430, height: 932 },
    scale: 2,
    touch: true,
    insets: { top: 59, right: 0, bottom: 34, left: 0 },
    standalone: true,
  },
  desktop: { viewport: { width: 1440, height: 900 }, scale: 1, touch: false, insets: null, standalone: false },
};

const STATE_LIST = [
  { id: "1-holding", title: "1. Удержание: идёт запись" },
  { id: "2-sliding", title: "2. Сдвиг влево: на пути к отмене" },
  { id: "3-locked", title: "3. Закреплено: руки свободны" },
  { id: "4-paused", title: "4. Остановлено: можно прослушать" },
  { id: "5-hint", title: "5. Слишком короткое нажатие" },
];

const FRAMES = [];
for (const theme of THEMES) {
  for (const device of Object.keys(DEVICES)) {
    for (const state of STATE_LIST) {
      FRAMES.push({ id: `${theme.id}-${device}-${state.id}`, theme: theme.id, device, state: state.id });
    }
  }
}

const framePath = (id) => path.join(OUT, `frame-${id}.png`);

// ── driving the gesture ─────────────────────────────────────────────────────

/**
 * A finger or a mouse on the record button, as raw input rather than a
 * synthesized helper: the composer reads pointer events and captures the
 * pointer, so the frames have to come from something the browser itself
 * dispatches.
 */
function gesture(page, device, cdp) {
  const touch = device.touch;
  let origin = null;

  const press = async () => {
    const box = await page.locator('[data-testid="composer-recorder-button"]').boundingBox();
    if (!box) throw new Error("the record button is not on screen");
    origin = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
    if (touch) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: origin.x, y: origin.y }] });
      // A finger has to stay down past the long press before it is a recording,
      // and that is a `setTimeout` — which the installed clock fakes. Waiting in
      // real time would never fire it, and the frame would photograph a composer
      // that had quietly not started recording, so the clock is advanced instead.
      await page.clock.runFor(400);
    } else {
      await page.mouse.move(origin.x, origin.y);
      await page.mouse.down();
    }
    // Real time, this one: the microphone resolves on its own clock, not the
    // page's, and the row cannot be read until it has.
    await page.waitForTimeout(400);
  };

  const moveTo = async (dx, dy) => {
    if (!origin) throw new Error("nothing is being held");
    const x = origin.x + dx;
    const y = origin.y + dy;
    if (touch) {
      // In steps, as a finger travels, so every threshold on the way is seen.
      for (let step = 1; step <= 6; step += 1) {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: Math.round(origin.x + (dx * step) / 6), y: Math.round(origin.y + (dy * step) / 6) }],
        });
        await page.waitForTimeout(24);
      }
    } else {
      await page.mouse.move(x, y, { steps: 6 });
    }
  };

  const release = async (dx = 0, dy = 0) => {
    if (!origin) return;
    const x = origin.x + dx;
    const y = origin.y + dy;
    if (touch) await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    else await page.mouse.up({ x, y });
    origin = null;
  };

  return { press, moveTo, release };
}

const STATES = {
  "1-holding": async (g, page) => {
    await g.press();
    await page.clock.runFor(RECORD_MS);
  },
  "2-sliding": async (g, page) => {
    await g.press();
    await page.clock.runFor(RECORD_MS);
    // Two thirds of the way to the cancel: far enough to read as going, short
    // of the point where the recording would already be gone.
    await g.moveTo(-Math.round(CANCEL_SLIDE_PX * 0.65), 0);
  },
  "3-locked": async (g, page) => {
    await g.press();
    await page.clock.runFor(RECORD_MS);
    await g.moveTo(0, -(LOCK_DRAG_PX + 24));
    await g.release(0, -(LOCK_DRAG_PX + 24));
    await page.clock.runFor(2_000);
  },
  "4-paused": async (g, page) => {
    await STATES["3-locked"](g, page);
    await page.locator('[data-testid="composer-locked-recording-stop"]').click();
    await page.locator('[data-testid="composer-recording-preview"]').waitFor({ state: "visible", timeout: 10_000 });
  },
  "5-hint": async (g, page) => {
    await g.press();
    // Long enough to be a hold, far short of a recording.
    await page.clock.runFor(400);
    await g.release();
    await page.locator('[data-testid="composer-short-press-hint"]').waitFor({ state: "visible", timeout: 10_000 });
  },
};

// ── the server the frames come from ─────────────────────────────────────────

/** The modules these renders depend on, as the server serves them now. */
const SERVED_MARKERS = [
  ["/src/components/chat/MessageInput.tsx", "ComposerRecordingRow"],
  ["/src/components/chat/MessageInput.tsx", "readRecordingHold"],
  ["/src/components/chat/ComposerRecordingRow.tsx", "data-recording-phase"],
  ["/src/lib/recordingGesture.ts", "releaseRecording"],
];

async function assertFixtureServer() {
  let url;
  try {
    url = new URL(BASE);
  } catch {
    throw new Error("KUB_BASE_URL must be a loopback dev server, e.g. http://127.0.0.1:5310");
  }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || !url.port || url.pathname !== "/") {
    throw new Error("KUB_BASE_URL must be a loopback dev server, e.g. http://127.0.0.1:5310");
  }
  const client = await fetch(`${BASE}/src/lib/supabase/client.ts`).then((response) => response.text());
  if (!client.includes("127.0.0.1:54321")) throw new Error("The dev server is not on the fixture configuration.");
  for (const [modulePath, marker] of SERVED_MARKERS) {
    const served = await fetch(`${BASE}${modulePath}`).then((response) => response.text());
    if (!served.includes(marker)) throw new Error(`The dev server serves a stale ${modulePath} (no «${marker}»). Restart it.`);
    // A module Vite has hot-updated is served under a timestamped URL, and the
    // page then holds two copies of it. Stale code photographs as new code.
    if (served.includes("app.store.ts?t=")) throw new Error(`${modulePath} carries a hot-update URL. Restart the server.`);
  }
  const capture = await fetch(`${BASE}${CAPTURE_PATH}`);
  if (!capture.ok) throw new Error(`The capture route answered ${capture.status}.`);
}

/** What the frame shows, read off the page rather than assumed. */
async function measure(page, frame) {
  return page.evaluate(() => {
    const row = document.querySelector('[data-testid="composer-recording-lock-indicator"]');
    const button = document.querySelector('[data-testid="composer-recorder-button"]');
    const hint = document.querySelector('[data-testid="composer-short-press-hint"]');
    const rail = document.querySelector('[data-testid="composer-recording-lock-progress"]');
    const probe = window.__recordingProbe ?? { audio: -1, video: -1 };
    const rowBox = row?.getBoundingClientRect();
    const styles = row ? getComputedStyle(row) : null;
    return {
      phase: row?.getAttribute("data-recording-phase") ?? null,
      hold: row?.getAttribute("data-recording-hold") ?? null,
      mode: row?.getAttribute("data-recording-row") ?? null,
      timer: row?.querySelector('[data-testid="composer-recording-timer"]')?.textContent?.trim() ?? null,
      label: row?.querySelector('[data-testid="composer-recording-hint"]')?.textContent?.trim() ?? null,
      lockFill: rail?.getAttribute("data-lock-progress") ?? null,
      transform: styles?.transform ?? null,
      opacity: styles?.opacity ?? null,
      rowWidth: rowBox ? Math.round(rowBox.width) : null,
      recorderButtonOnScreen: Boolean(button),
      preview: Boolean(document.querySelector('[data-testid="composer-recording-preview"]')),
      deleteControl: Boolean(document.querySelector('[data-testid="composer-recording-delete"]')),
      sendControl: Boolean(document.querySelector('[data-testid="composer-recording-send"]')),
      hint: hint?.textContent?.trim() ?? null,
      // Nothing may be waiting in the tray: a released recording is sent, and a
      // cancelled one is gone.
      trayItems: document.querySelectorAll('[data-testid="staged-attachment-item"]').length,
      audioOpened: probe.audio,
      videoOpened: probe.video,
    };
  });
}

/** What each state must be true of, checked before the picture is taken. */
function verdict(frame, found) {
  const problems = [];
  const expected = {
    "1-holding": "holding",
    "2-sliding": "holding",
    "3-locked": "locked",
    "4-paused": "paused",
    "5-hint": null,
  }[frame.state];

  if (found.phase !== expected) problems.push(`phase ${found.phase}, expected ${expected}`);
  if (found.trayItems !== 0) problems.push(`${found.trayItems} item(s) waiting in the tray`);
  if (found.videoOpened !== 0) problems.push(`a camera was opened ${found.videoOpened} time(s)`);

  if (frame.state === "5-hint") {
    if (!found.hint) problems.push("no hint was left beside the button");
    if (!found.recorderButtonOnScreen) problems.push("the record button is gone");
  } else {
    if (found.audioOpened !== 1) problems.push(`the microphone was opened ${found.audioOpened} time(s)`);
  }

  if (frame.state === "1-holding") {
    if (found.timer === "00:00") problems.push("the timer never moved");
    if (!found.label) problems.push("the row says nothing about the way out");
    if (found.transform && found.transform !== "none") problems.push(`the row has moved: ${found.transform}`);
    if (!found.recorderButtonOnScreen) problems.push("the button left from under the finger");
  }
  if (frame.state === "2-sliding") {
    if (!found.transform || found.transform === "none") problems.push("the row did not follow the finger");
    if (Number(found.opacity) >= 1) problems.push("the row did not fade along the slide");
  }
  if (frame.state === "3-locked") {
    if (found.lockFill !== null) problems.push("the lock rail is still drawn after locking");
    if (!found.deleteControl || !found.sendControl) problems.push("the locked row has no delete or no send");
    if (found.recorderButtonOnScreen) problems.push("the record button is still there with the finger gone");
  }
  if (frame.state === "4-paused") {
    if (!found.preview) problems.push("there is nothing to listen to");
    if (!found.deleteControl || !found.sendControl) problems.push("the paused row has no delete or no send");
  }
  return problems;
}

async function renderFrame(browser, frame) {
  const device = DEVICES[frame.device];
  const context = await browser.newContext({
    viewport: device.viewport,
    deviceScaleFactor: device.scale,
    hasTouch: device.touch,
    isMobile: device.touch,
    colorScheme: frame.theme,
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
    permissions: ["microphone", "camera"],
  });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.protocol !== "http:" && url.protocol !== "https:") return route.continue();
    return ALLOWED_HOSTS.has(url.hostname) ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/ERR_CONNECTION_REFUSED|ERR_FAILED|websocket|Failed to load resource/i.test(text)) return;
    errors.push(text);
  });

  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: device.insets ?? { top: 0, right: 0, bottom: 0, left: 0 } });
  // Controllable rather than frozen: the conversation's times are worked out
  // once at load, and the recording's own clock is then advanced deliberately,
  // so a timer reads a real number instead of standing at zero.
  await page.clock.install({ time: CLOCK });
  await page.addInitScript(
    ({ key, fixture, theme, standalone }) => {
      if (standalone) {
        try {
          Object.defineProperty(Navigator.prototype, "standalone", { configurable: true, get: () => true });
        } catch {
          /* the media query below still answers */
        }
        const native = window.matchMedia.bind(window);
        window.matchMedia = (query) => {
          const compact = String(query).split(" ").join("").toLowerCase();
          if (!compact.includes("(display-mode:")) return native(query);
          const mode = compact.split("(display-mode:")[1].split(")")[0];
          return {
            matches: mode === "standalone",
            media: String(query),
            onchange: null,
            addListener() {},
            removeListener() {},
            addEventListener() {},
            removeEventListener() {},
            dispatchEvent: () => false,
          };
        };
      }
      // Which devices the page opened, and of what kind: a voice recording must
      // ask for a microphone and never for a camera.
      const probe = { audio: 0, video: 0 };
      window.__recordingProbe = probe;
      if (navigator.mediaDevices?.getUserMedia) {
        const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = (constraints) => {
          if (constraints?.audio) probe.audio += 1;
          if (constraints?.video) probe.video += 1;
          return getUserMedia(constraints);
        };
      }
      window[key] = fixture;
      localStorage.setItem("kub-theme", theme);
    },
    { key: WINDOW_KEY, fixture: FIXTURE, theme: frame.theme, standalone: device.standalone },
  );

  await page.goto(`${BASE}${CAPTURE_PATH}`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-public-preview-ready="true"]').waitFor({ state: "attached", timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  const inter = await page.evaluate(() => document.fonts.check("16px Inter"));
  await page.waitForTimeout(1_500);

  await STATES[frame.state](gesture(page, device, cdp), page);
  await page.waitForTimeout(400);

  const found = await measure(page, frame);
  const problems = verdict(frame, found);
  if (problems.length) throw new Error(`${frame.id}: ${problems.join("; ")}`);

  if (device.touch) await drawDeviceChrome(page, frame.theme, device);
  await page.screenshot({ path: framePath(frame.id), animations: "disabled" });
  await context.close();
  return { id: frame.id, inter, errors, ...found };
}

/** The status bar, the island and the home indicator, drawn over the page for scale. */
async function drawDeviceChrome(page, theme, device) {
  await page.evaluate(
    ({ theme, width, top }) => {
      const ink = theme === "dark" ? "#FFFFFF" : "#000000";
      const side = (width - 126) / 2;
      const layer = document.createElement("div");
      layer.setAttribute("aria-hidden", "true");
      layer.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none";
      layer.innerHTML =
        `<div style="position:absolute;left:${side}px;top:11px;width:126px;height:37px;border-radius:19px;background:#000"></div>` +
        `<div style="position:absolute;left:0;top:0;width:${side}px;height:${top}px;display:flex;align-items:center;justify-content:center;font:600 17px/1 Inter,-apple-system,sans-serif;letter-spacing:-0.2px;color:${ink}">18:00</div>` +
        `<div style="position:absolute;left:${(width - 134) / 2}px;bottom:8px;width:134px;height:5px;border-radius:3px;background:${ink}"></div>`;
      document.body.appendChild(layer);
    },
    { theme, width: device.viewport.width, top: device.insets.top },
  );
}

// ── the sheets ──────────────────────────────────────────────────────────────

const INK = "#10233b";
const MUTED = "#3a4f66";
const PAPER = "#e9eef4";
const FONT_FILE = existsSync("C:/Windows/Fonts/segoeui.ttf") ? "C:/Windows/Fonts/segoeui.ttf" : undefined;

const escapeMarkup = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function text(markup, { size = 20, width, colour = INK } = {}) {
  const { data, info } = await sharp({
    text: {
      text: `<span foreground="${colour}">${markup}</span>`,
      font: `Segoe UI ${size}`,
      ...(FONT_FILE ? { fontfile: FONT_FILE } : {}),
      rgba: true,
      dpi: 96,
      ...(width ? { width, wrap: "word" } : {}),
    },
  })
    .png()
    .toBuffer({ resolveWithObject: true });
  return { input: data, width: info.width, height: info.height };
}

async function tile(file, cell) {
  const radius = 14;
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${cell.width}" height="${cell.height}"><rect width="${cell.width}" height="${cell.height}" rx="${radius}" ry="${radius}"/></svg>`,
  );
  if (!file || !existsSync(file)) {
    return sharp({ create: { width: cell.width, height: cell.height, channels: 4, background: "#d5dde7" } })
      .composite([{ input: mask, blend: "dest-in" }])
      .png()
      .toBuffer();
  }
  let image = sharp(file);
  if (cell.crop) image = image.extract(cell.crop);
  const resized = await image.resize({ width: cell.width, height: cell.height, fit: "cover", position: "bottom" }).png().toBuffer();
  return sharp(resized).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
}

async function buildSheet({ file, title, subtitle, columns, rows, cell }) {
  const margin = 32;
  const gap = 20;
  const width = margin * 2 + columns.length * cell.width + (columns.length - 1) * gap;
  const titleImage = await text(`<b>${escapeMarkup(title)}</b>`, { size: 26, width: width - margin * 2 });
  const subtitleImage = await text(escapeMarkup(subtitle), { size: 15, width: width - margin * 2, colour: MUTED });
  const columnImages = await Promise.all(columns.map((column) => text(`<b>${escapeMarkup(column)}</b>`, { size: 18, width: cell.width })));
  const columnHeight = Math.max(...columnImages.map((image) => image.height));
  const rowImages = await Promise.all(rows.map((row) => text(escapeMarkup(row.label), { size: 15, colour: MUTED })));
  const rowLabelHeight = Math.max(...rowImages.map((image) => image.height));

  const layers = [];
  let y = margin;
  layers.push({ input: titleImage.input, left: margin, top: y });
  y += titleImage.height + 6;
  layers.push({ input: subtitleImage.input, left: margin, top: y });
  y += subtitleImage.height + 18;
  columnImages.forEach((image, index) => layers.push({ input: image.input, left: margin + index * (cell.width + gap), top: y }));
  y += columnHeight + 10;
  for (const [rowIndex, row] of rows.entries()) {
    layers.push({ input: rowImages[rowIndex].input, left: margin, top: y });
    y += rowLabelHeight + 6;
    for (const [index, frameFile] of row.frames.entries()) {
      const left = margin + index * (cell.width + gap);
      const frame = await tile(frameFile, cell);
      const edge = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${cell.width + 2}" height="${cell.height + 2}"><rect x="0.5" y="0.5" width="${cell.width + 1}" height="${cell.height + 1}" rx="15" ry="15" fill="#c3cfdc"/></svg>`,
      );
      layers.push({ input: edge, left: left - 1, top: y - 1 });
      layers.push({ input: frame, left, top: y });
    }
    y += cell.height + gap;
  }
  const height = y + margin - gap;
  await sharp({ create: { width, height, channels: 3, background: PAPER } }).composite(layers).png().toFile(file);
  console.log(`sheet: ${path.relative(ROOT, file)} ${width}x${height}`);
  return { file, width, height };
}

const SHEET_NOTE =
  "Настоящие компоненты приложения на DEV-маршруте, вымышленная переписка, микрофон — тестовое устройство Chromium. " +
  "Удержание записывает; сдвиг влево за 96 точек отменяет сразу, не дожидаясь отпускания; отпускание отправляет, " +
  "а не кладёт во вложения; сдвиг вверх за 72 точки закрепляет запись, и тогда её можно остановить, прослушать и уже " +
  "потом отправить или удалить. Слишком короткое нажатие оставляет подсказку у кнопки вместо модального окна. " +
  "Показан нижний край экрана — там, где находится строка ввода.";

const DEVICE_SHEETS = {
  iphone: {
    label: "iPhone 430",
    cell: { width: 300, height: 420, crop: { left: 0, top: 1024, width: 860, height: 840 } },
    subtitle: "iPhone 430×932, режим установленного приложения; статус-бар и полоска «домой» дорисованы для масштаба.",
  },
  desktop: {
    label: "компьютер",
    cell: { width: 380, height: 300, crop: { left: 360, top: 560, width: 1000, height: 340 } },
    subtitle: "Окно 1440×900; показан низ переписки со строкой ввода.",
  },
};

async function buildSheets() {
  const sheets = [];
  for (const [device, spec] of Object.entries(DEVICE_SHEETS)) {
    const rows = THEMES.map((theme) => ({
      label: theme.title,
      frames: STATE_LIST.map((state) => framePath(`${theme.id}-${device}-${state.id}`)),
    }));
    sheets.push(
      await buildSheet({
        file: path.join(OUT, `sheet-${device}.png`),
        title: `Запись голосового · ${spec.label}`,
        subtitle: `${spec.subtitle} ${SHEET_NOTE}`,
        columns: STATE_LIST.map((state) => state.title),
        rows,
        cell: spec.cell,
      }),
    );
  }
  const tallest = Math.max(...sheets.map((sheet) => sheet.height));
  if (tallest > 2200) throw new Error(`A sheet is ${tallest}px tall; keep each under 2200 to read on a phone.`);
  return sheets;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const failures = [];
  const results = existsSync(RESULTS_FILE) ? JSON.parse(readFileSync(RESULTS_FILE, "utf8")) : {};
  if (!sheetsOnly) {
    await assertFixtureServer();
    // The full Chromium build, not the headless shell, which does not frost a
    // scrolling container under backdrop-filter — the glass would photograph
    // as a flat tint. The fake microphone means nothing real is ever recorded.
    const browser = await chromium.launch({
      channel: "chromium",
      args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
    });
    try {
      for (const frame of FRAMES) {
        if (only && !only.has(frame.id)) continue;
        try {
          const result = await renderFrame(browser, frame);
          results[frame.id] = result;
          console.log(
            `${frame.id}: ok phase=${result.phase} timer=${result.timer ?? "-"} lock=${result.lockFill ?? "-"} ` +
              `label=${JSON.stringify(result.label ?? result.hint ?? "")} mic=${result.audioOpened} cam=${result.videoOpened}` +
              `${result.errors.length ? ` errors: ${JSON.stringify(result.errors)}` : ""}`,
          );
        } catch (error) {
          failures.push(frame.id);
          console.error(`${frame.id}: FAILED ${error instanceof Error ? error.message.split(String.fromCharCode(10))[0] : error}`);
        }
      }
    } finally {
      await browser.close();
    }
    writeFileSync(RESULTS_FILE, `${JSON.stringify(results, null, 2)}${String.fromCharCode(10)}`);
  }
  await buildSheets();
  if (failures.length) {
    console.error(`failed: ${failures.join(", ")}`);
    process.exitCode = 1;
  }
}

await main();
