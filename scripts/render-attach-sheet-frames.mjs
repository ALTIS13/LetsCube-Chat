#!/usr/bin/env node
/**
 * Renders the attach sheet as it ships (D-122): «Стеклянная капсула», the look
 * the owner chose on 2026-09-12, in both themes, on an iPhone Pro Max, on a
 * 390-point iPhone and on a desktop, over the chat screen he approved (option C,
 * «Капсулы и цвет»).
 *
 * There is one look now and no switch to set: the sheet is the composer's attach
 * flow on every shell, «Музыка» is not a tab, and the desktop send dialog is
 * gone. The seven states are the ones the prototype rendered, plus the scrolled
 * tab row and an open placeholder.
 *
 * Every frame is the real application on the DEV preview route, driven by real
 * input — a tap or a click on «Прикрепить», a pick through the file chooser, a
 * tap on a tab, a swipe along the tab row — over a fictional conversation, with
 * fictional photos drawn here by sharp and a fictional position handed to the
 * browser. Nothing on a network is reached: every request off this machine and
 * the font host is aborted.
 *
 * Each frame also proves what it shows before it is photographed: no camera
 * stream is asked for in any state and the position only on «Геопозиция»; the
 * sheet is no taller than what it holds; the row is at its end with «Контакт» in
 * view where the frame says so; a placeholder holds no control; and the attach
 * menu the sheet replaced is nowhere on the page.
 *
 * The iPhones are Chromium at 430x932 and 390x844, two device pixels per point,
 * with the safe areas set inside the engine and the installed app's standalone
 * answers stubbed. Chromium draws no status bar, island or home indicator, so
 * they are drawn over each iPhone frame before it is photographed.
 *
 * It does not start a server. Point it at a dev server on the fixture
 * configuration (`VITE_SUPABASE_URL=http://127.0.0.1:54321`,
 * `VITE_PUBLIC_PREVIEW_FIXTURE=1`); it refuses anything else.
 *
 * Usage:
 *   KUB_BASE_URL=http://127.0.0.1:5302 node scripts/render-attach-sheet-frames.mjs
 *     [--only dark-iphone-6-tabs-end,light-desktop-1-gallery]   re-render some frames
 *     [--sheets]                                                only rebuild the sheets
 *
 * Writes output/renders/2026-09-12-attach-sheet-final/: frame-*.png, sheet-*.png,
 * results.json and the fictional photos in media/.
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
const OUT = path.join(ROOT, "output", "renders", "2026-09-12-attach-sheet-final");
const MEDIA_DIR = path.join(OUT, "media");
const RESULTS_FILE = path.join(OUT, "results.json");
const CAPTURE_PATH = "/__qa/public-preview";
const WINDOW_KEY = "__letscubePublicPreviewFixture";
const CLOCK = new Date("2026-09-11T18:00:00+03:00");
const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost", "fonts.googleapis.com", "fonts.gstatic.com"]);
/** A public square, not anyone's address. */
const PLACE = { latitude: 55.75222, longitude: 37.61556, accuracy: 18 };

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

// ── fictional photos ────────────────────────────────────────────────────────

const W = 1800;
const H = 1350;

const SCENES = [
  {
    name: "vitrina.jpg",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fb9e3"/><stop offset="1" stop-color="#dcecf8"/></linearGradient>
<linearGradient id="glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d6ebf9"/><stop offset="1" stop-color="#7fa9cc"/></linearGradient></defs>
<rect width="${W}" height="${H}" fill="url(#sky)"/>
<rect x="160" y="260" width="1480" height="1090" fill="#d9c6a8"/>
<rect x="120" y="190" width="1560" height="120" fill="#3d78b8"/>
<rect x="260" y="420" width="600" height="620" fill="url(#glass)" stroke="#f4efe6" stroke-width="22"/>
<rect x="940" y="420" width="600" height="620" fill="url(#glass)" stroke="#f4efe6" stroke-width="22"/>
<rect x="340" y="820" width="140" height="220" fill="#e9a23b"/><rect x="520" y="760" width="120" height="280" fill="#f04a92"/><rect x="680" y="860" width="110" height="180" fill="#4dcd5e"/>
<rect x="1020" y="780" width="150" height="260" fill="#ffffff" opacity="0.85"/><rect x="1220" y="840" width="160" height="200" fill="#3d78b8"/><circle cx="1450" cy="900" r="70" fill="#e9a23b"/>
<rect y="1180" width="${W}" height="170" fill="#8b8f93"/>
</svg>`,
  },
  {
    name: "polki.jpg",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="#efe8dc"/>
<rect x="100" y="80" width="1600" height="1190" fill="#e3d6c2"/>
${[0, 1, 2, 3]
  .map(
    (row) =>
      `<rect x="120" y="${340 + row * 280}" width="1560" height="28" fill="#8a6a4d"/>` +
      [0, 1, 2, 3, 4, 5]
        .map((col) => {
          const colours = ["#3d78b8", "#f04a92", "#e9a23b", "#4dcd5e", "#6d5bd0", "#ef4444"];
          const height = 120 + ((row * 7 + col * 5) % 5) * 22;
          return `<rect x="${170 + col * 250}" y="${340 + row * 280 - height}" width="190" height="${height}" rx="12" fill="${colours[(row + col) % colours.length]}"/>`;
        })
        .join(""),
  )
  .join("")}
</svg>`,
  },
  {
    name: "vhod.jpg",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><linearGradient id="wall" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c98f6b"/><stop offset="1" stop-color="#a86f50"/></linearGradient></defs>
<rect width="${W}" height="${H}" fill="url(#wall)"/>
${Array.from({ length: 14 }, (_, index) => `<line x1="0" y1="${index * 100}" x2="${W}" y2="${index * 100}" stroke="#b67c5c" stroke-width="6"/>`).join("")}
<rect x="600" y="300" width="600" height="880" fill="#2f3b4a"/>
<rect x="640" y="340" width="520" height="820" fill="#4d6178"/>
<rect x="520" y="230" width="760" height="90" rx="10" fill="#3d78b8"/>
<circle cx="1110" cy="780" r="18" fill="#e9c46a"/>
<rect x="420" y="1180" width="960" height="60" fill="#8b8f93"/><rect x="360" y="1240" width="1080" height="110" fill="#6f7478"/>
<circle cx="300" cy="1000" r="150" fill="#4f7a3c"/><rect x="250" y="1100" width="100" height="150" fill="#7a4a2e"/>
<circle cx="1500" cy="1000" r="150" fill="#4f7a3c"/><rect x="1450" y="1100" width="100" height="150" fill="#7a4a2e"/>
</svg>`,
  },
];

/** A photograph-like JPEG: the drawing under grain. */
async function makeMedia() {
  mkdirSync(MEDIA_DIR, { recursive: true });
  const files = [];
  for (const scene of SCENES) {
    const file = path.join(MEDIA_DIR, scene.name);
    if (!existsSync(file)) {
      const noise = await sharp({ create: { width: W, height: H, channels: 3, noise: { type: "gaussian", mean: 128, sigma: 26 } } })
        .raw()
        .toBuffer();
      const buffer = await sharp(Buffer.from(scene.svg))
        .composite([{ input: noise, raw: { width: W, height: H, channels: 3 }, blend: "soft-light" }])
        .jpeg({ quality: 86 })
        .toBuffer();
      writeFileSync(file, buffer);
    }
    files.push(file);
  }
  return files;
}

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
  // The narrower iPhone, where the tab row is cut off sooner: the owner judges its scrolling at both widths.
  iphone390: {
    viewport: { width: 390, height: 844 },
    scale: 2,
    touch: true,
    insets: { top: 47, right: 0, bottom: 34, left: 0 },
    standalone: true,
  },
};

const SHEET_STATES = [
  { id: "1-gallery", title: "1. «Галерея», ничего не выбрано" },
  { id: "2-picked", title: "2. Выбраны три фото" },
  { id: "3-send-menu", title: "3. «…»: «Отправить без сжатия»" },
  { id: "4-file", title: "4. Вкладка «Файл»" },
  { id: "5-location", title: "5. Вкладка «Геопозиция»" },
  { id: "6-tabs-end", title: "6. Ряд вкладок до конца: «Контакт»" },
  { id: "7-placeholder", title: "7. Заглушка «Опрос»" },
];

/** Which states each device renders; the 390-point iPhone is there for the tab row. */
const DEVICE_STATES = {
  iphone: SHEET_STATES.map((state) => state.id),
  desktop: SHEET_STATES.map((state) => state.id),
  iphone390: ["1-gallery", "6-tabs-end"],
};

const TAB_ROW = '[role="tablist"][data-attach-tabs]';

function tools(page, frame, media, cdp) {
  const touch = DEVICES[frame.device].touch;
  const press = async (locator) => {
    if (touch) await locator.tap();
    else await locator.click();
  };
  return {
    page,
    press,
    async openAttach() {
      await press(page.getByRole("button", { name: "Прикрепить", exact: true }));
    },
    async waitSheet() {
      await page.locator('[data-testid="attach-sheet"]').waitFor({ state: "visible", timeout: 10_000 });
    },
    async pickPhotos() {
      const chooser = page.waitForEvent("filechooser");
      await press(page.locator('[data-attach-entry="library"]'));
      await (await chooser).setFiles(media);
      await page.waitForFunction((count) => document.querySelectorAll("[data-attach-pick]").length >= count, media.length);
      await page.waitForFunction(() =>
        [...document.querySelectorAll("[data-attach-pick] img")].every((image) => image.complete && image.naturalWidth > 0),
      );
    },
    async tab(id) {
      await press(page.locator(`button[data-attach-tab="${id}"]`));
    },
    /**
     * A finger's swipe along the tab row on an iPhone, the wheel on a desktop,
     * until the row stops at its end. The swipe is raw touch input — a touch
     * down near the row's right end, sixteen moves a frame apart, and a lift near
     * its left end — so the browser pans the row itself. (Chromium's synthesized
     * scroll gesture refuses a path that leaves the screen and, kept on it, did
     * not move the row.)
     */
    async scrollTabsToEnd() {
      // The sheet slides in; a row measured mid-slide is not where the finger lands.
      await settle(page);
      const atEnd = () =>
        page.evaluate((selector) => {
          const row = document.querySelector(selector);
          return Boolean(row) && row.scrollWidth - row.clientWidth - row.scrollLeft <= 1;
        }, TAB_ROW);
      for (let swipe = 0; swipe < 3 && !(await atEnd()); swipe += 1) {
        const box = await page.locator(TAB_ROW).boundingBox();
        if (!box) throw new Error("there is no tab row to scroll");
        if (touch) {
          const y = Math.round(box.y + box.height / 2);
          const from = Math.round(box.x + box.width - 12);
          const to = Math.round(box.x + 12);
          const steps = 16;
          await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from, y }] });
          for (let step = 1; step <= steps; step += 1) {
            await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: Math.round(from + ((to - from) * step) / steps), y }] });
            await page.waitForTimeout(16);
          }
          await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        } else {
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.wheel(0, 1200);
        }
        await page.waitForTimeout(600);
      }
      await page.waitForFunction(
        (selector) => {
          const row = document.querySelector(selector);
          return Boolean(row) && row.scrollWidth - row.clientWidth - row.scrollLeft <= 1;
        },
        TAB_ROW,
        { timeout: 10_000 },
      );
    },
  };
}

const STATES = {
  "1-gallery": async (t) => {
    await t.openAttach();
    await t.waitSheet();
  },
  "2-picked": async (t) => {
    await t.openAttach();
    await t.waitSheet();
    await t.pickPhotos();
  },
  "3-send-menu": async (t) => {
    await STATES["2-picked"](t);
    await t.press(t.page.locator('[data-testid="attach-more"]'));
    await t.page.locator('[data-testid="attach-send-menu"]').waitFor({ state: "visible", timeout: 10_000 });
  },
  "4-file": async (t) => {
    await t.openAttach();
    await t.waitSheet();
    await t.tab("file");
    await t.page.locator("[data-attach-file-sources]").waitFor({ state: "visible", timeout: 10_000 });
  },
  "5-location": async (t) => {
    await t.openAttach();
    await t.waitSheet();
    await t.tab("location");
    await t.page.locator('[data-attach-location="ready"]').waitFor({ state: "visible", timeout: 15_000 });
  },
  "6-tabs-end": async (t) => {
    await t.openAttach();
    await t.waitSheet();
    await t.scrollTabsToEnd();
  },
  "7-placeholder": async (t) => {
    await t.openAttach();
    await t.waitSheet();
    await t.tab("poll");
    await t.page.locator('[data-attach-placeholder="poll"]').waitFor({ state: "visible", timeout: 10_000 });
  },
};

const FRAMES = [];
for (const theme of THEMES) {
  for (const device of Object.keys(DEVICES)) {
    for (const state of DEVICE_STATES[device]) {
      FRAMES.push({ id: `${theme.id}-${device}-${state}`, theme: theme.id, device, state });
    }
  }
}

const framePath = (id) => path.join(OUT, `frame-${id}.png`);

// ── driving a frame ─────────────────────────────────────────────────────────

async function settle(page) {
  await page.evaluate(async () => {
    const finite = document
      .getAnimations()
      .filter((animation) => animation.playState === "running" && animation.effect?.getTiming().iterations !== Infinity);
    await Promise.race([
      Promise.all(finite.map((animation) => animation.finished.catch(() => undefined))),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

/** Each module the renders depend on, as the server serves it now: a stale one would photograph old code. */
const SERVED_MARKERS = [
  ["/src/components/chat/MessageInput.tsx", "attach/AttachSheet"],
  // The approved chat screen, option C, under the sheet.
  ["/src/components/chat/MessageInput.tsx", "CAPSULE_CONTROL_GLASS"],
  ["/src/components/chat/attach/AttachSheet.tsx", "data-attach-content"],
  ["/src/components/chat/attach/AttachTabs.tsx", "data-attach-tabs-overflow"],
  ["/src/components/chat/attach/AttachGalleryPanel.tsx", "data-attach-arrangement"],
  ["/src/components/chat/attach/AttachPlaceholderPanel.tsx", "data-attach-placeholder"],
  ["/src/components/chat/attach/AttachMoreMenu.tsx", "attach-send-original"],
  ["/src/components/chat/attach/AttachLocationPanel.tsx", "data-attach-location-coordinates"],
  ["/src/lib/attachSheet.ts", "attachGalleryArrangement"],
  ["/src/lib/attachSheet.ts", "sheetContentHeight"],
];

async function assertFixtureServer() {
  let url;
  try {
    url = new URL(BASE);
  } catch {
    throw new Error("KUB_BASE_URL must be a loopback dev server, e.g. http://127.0.0.1:5301");
  }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || !url.port || url.pathname !== "/") {
    throw new Error("KUB_BASE_URL must be a loopback dev server, e.g. http://127.0.0.1:5301");
  }
  const client = await fetch(`${BASE}/src/lib/supabase/client.ts`).then((response) => response.text());
  if (!client.includes("127.0.0.1:54321")) throw new Error("The dev server is not on the fixture configuration.");
  for (const [modulePath, marker] of SERVED_MARKERS) {
    const served = await fetch(`${BASE}${modulePath}`).then((response) => response.text());
    if (!served.includes(marker)) throw new Error(`The dev server serves a stale ${modulePath} (no «${marker}»). Restart it.`);
  }
  const capture = await fetch(`${BASE}${CAPTURE_PATH}`);
  if (!capture.ok) throw new Error(`The capture route answered ${capture.status}.`);
}

async function assertConditions(page, frame) {
  const device = DEVICES[frame.device];
  const found = await page.evaluate(() => {
    const root = document.documentElement;
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;visibility:hidden;padding-top:var(--kub-safe-top);padding-bottom:var(--kub-safe-bottom)";
    document.body.appendChild(probe);
    const insets = { top: parseFloat(getComputedStyle(probe).paddingTop), bottom: parseFloat(getComputedStyle(probe).paddingBottom) };
    probe.remove();
    return {
      theme: root.classList.contains("dark") ? "dark" : root.classList.contains("light") ? "light" : null,
      standalone: root.hasAttribute("data-ios-standalone"),
      insets,
      coarse: window.matchMedia("(pointer: coarse)").matches,
    };
  });
  const problems = [];
  if (found.theme !== frame.theme) problems.push(`theme ${found.theme}`);
  if (device.standalone !== found.standalone) problems.push(`standalone ${found.standalone}`);
  const insets = device.insets ?? { top: 0, bottom: 0 };
  if (found.insets.top !== insets.top || found.insets.bottom !== insets.bottom) problems.push(`insets ${JSON.stringify(found.insets)}`);
  if (found.coarse !== device.touch) problems.push(`coarse pointer ${found.coarse}`);
  if (problems.length) throw new Error(`${frame.id}: ${problems.join("; ")}`);
}

async function assertOpened(page, frame) {
  const found = await page.evaluate((rowSelector) => {
    const sheet = document.querySelector('[data-testid="attach-sheet"]');
    const probe = window.__attachProbe ?? { media: -1, geo: -1 };
    const row = sheet?.querySelector(rowSelector) ?? null;
    const rowBox = row?.getBoundingClientRect();
    const lastBox = row?.querySelector('[data-attach-tab="contact"]')?.getBoundingClientRect();
    const scroller = sheet?.querySelector("[data-attach-scroll]");
    const content = sheet?.querySelector("[data-attach-content]");
    const placeholder = sheet?.querySelector("[data-attach-placeholder]") ?? null;
    return {
      open: Boolean(sheet),
      shape: sheet?.getAttribute("data-attach-shape") ?? null,
      tab: sheet?.getAttribute("data-attach-tab") ?? null,
      menu: Boolean(document.querySelector('[data-testid="composer-attach-menu"]')),
      music: Boolean(row?.querySelector('[data-attach-tab="music"]')),
      media: probe.media,
      geo: probe.geo,
      rowOverflow: row?.getAttribute("data-attach-tabs-overflow") ?? null,
      lastTabInView: rowBox && lastBox ? lastBox.left >= rowBox.left - 1 && lastBox.right <= rowBox.right + 1 : null,
      gap: scroller && content ? Math.round(scroller.clientHeight - content.getBoundingClientRect().height) : null,
      placeholder: placeholder?.getAttribute("data-attach-placeholder") ?? null,
      placeholderControls: placeholder ? placeholder.querySelectorAll("button, input, textarea, select, a, [tabindex]").length : null,
    };
  }, TAB_ROW);
  const problems = [];
  if (!found.open) problems.push("the sheet is not open");
  if (found.menu) problems.push("the attach menu is drawn beside the sheet");
  if (found.music) problems.push("«Музыка» is a tab again");
  const shape = DEVICES[frame.device].touch ? "phone" : "desktop";
  if (found.shape !== shape) problems.push(`shape ${found.shape}`);
  if (found.gap === null || found.gap > 2) problems.push(`the sheet is ${found.gap}px taller than what it holds`);
  if (frame.state === "6-tabs-end" && (found.rowOverflow !== "start" || found.lastTabInView !== true || found.tab !== "gallery")) {
    problems.push(`the row is not at its end with «Контакт» in view and «Галерея» chosen: ${JSON.stringify(found)}`);
  }
  if (frame.state === "7-placeholder" && (found.placeholder !== "poll" || found.placeholderControls !== 0)) {
    problems.push(`«Опрос» is not an inert placeholder: ${JSON.stringify(found)}`);
  }
  if (found.media !== 0) problems.push(`a camera or microphone stream was asked for ${found.media} time(s)`);
  const expectGeo = frame.state === "5-location";
  if (expectGeo ? found.geo < 1 : found.geo !== 0) problems.push(`the position was asked for ${found.geo} time(s)`);
  if (problems.length) throw new Error(`${frame.id}: ${problems.join("; ")}`);
  return { cameraRequests: found.media, positionRequests: found.geo, fitGap: found.gap };
}

/** The status bar, the Dynamic Island and the home indicator of an iPhone, drawn over the page for scale. */
async function drawDeviceChrome(page, theme, device) {
  await page.evaluate(
    ({ theme, width, top }) => {
      const ink = theme === "dark" ? "#FFFFFF" : "#000000";
      const side = (width - 126) / 2;
      const layer = document.createElement("div");
      layer.id = "render-device-chrome";
      layer.setAttribute("aria-hidden", "true");
      layer.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none";
      layer.innerHTML =
        `<div style="position:absolute;left:${side}px;top:11px;width:126px;height:37px;border-radius:19px;background:#000"></div>` +
        `<div style="position:absolute;left:0;top:0;width:${side}px;height:${top}px;display:flex;align-items:center;justify-content:center;font:600 17px/1 Inter,-apple-system,sans-serif;letter-spacing:-0.2px;color:${ink}">18:00</div>` +
        `<svg style="position:absolute;left:${width - 112}px;top:${Math.round(top / 2 - 6.5)}px" width="80" height="14" viewBox="0 0 80 14" fill="${ink}">` +
        '<rect x="0" y="9" width="3" height="4" rx="0.8"/><rect x="5" y="6" width="3" height="7" rx="0.8"/><rect x="10" y="3" width="3" height="10" rx="0.8"/><rect x="15" y="0" width="3" height="13" rx="0.8"/>' +
        '<path d="M30 4.6a9.5 9.5 0 0 1 13 0l-1.5 1.6a7.3 7.3 0 0 0-10 0z M33 7.6a5.5 5.5 0 0 1 7 0l-1.6 1.6a3.3 3.3 0 0 0-3.8 0z M36.5 13l-2-2.1a2.8 2.8 0 0 1 4 0z"/>' +
        `<rect x="52" y="0.5" width="24" height="12.5" rx="3.8" fill="none" stroke="${ink}" stroke-opacity="0.45"/>` +
        '<rect x="54" y="2.5" width="18" height="8.5" rx="2.2"/><path d="M77.5 4.8v3.9a2 2 0 0 0 0-3.9z" fill-opacity="0.45"/></svg>' +
        `<div style="position:absolute;left:${(width - 134) / 2}px;bottom:8px;width:134px;height:5px;border-radius:3px;background:${ink}"></div>`;
      document.body.appendChild(layer);
    },
    { theme, width: device.viewport.width, top: device.insets.top },
  );
}

async function renderFrame(browser, frame, media) {
  const device = DEVICES[frame.device];
  const context = await browser.newContext({
    viewport: device.viewport,
    deviceScaleFactor: device.scale,
    hasTouch: device.touch,
    isMobile: device.touch,
    colorScheme: frame.theme,
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
    geolocation: PLACE,
    permissions: ["geolocation"],
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
    // The fixture backend does not exist; its refusals are expected.
    if (/ERR_CONNECTION_REFUSED|ERR_FAILED|websocket|Failed to load resource/i.test(text)) return;
    errors.push(text);
  });

  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: device.insets ?? { top: 0, right: 0, bottom: 0, left: 0 } });
  await page.clock.setFixedTime(CLOCK);
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
      // What the sheet must not do on its own: count every camera stream and
      // every position asked for.
      const probe = { media: 0, geo: 0 };
      window.__attachProbe = probe;
      if (navigator.mediaDevices?.getUserMedia) {
        const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = (constraints) => {
          probe.media += 1;
          return getUserMedia(constraints);
        };
      }
      if (navigator.geolocation) {
        const getCurrentPosition = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
        navigator.geolocation.getCurrentPosition = (...args) => {
          probe.geo += 1;
          return getCurrentPosition(...args);
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
  await page.waitForTimeout(2_500);
  await assertConditions(page, frame);
  await STATES[frame.state](tools(page, frame, media, cdp));
  await settle(page);
  const probe = await assertOpened(page, frame);
  const box = await page.evaluate(() => {
    const node = document.querySelector('[data-testid="attach-sheet"]');
    const rect = node?.getBoundingClientRect();
    return rect ? { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } : null;
  });

  if (device.touch) await drawDeviceChrome(page, frame.theme, device);
  await page.screenshot({ path: framePath(frame.id), animations: "disabled" });
  await context.close();
  return { id: frame.id, inter, errors, box, ...probe };
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
    const empty = await sharp({ create: { width: cell.width, height: cell.height, channels: 4, background: "#d5dde7" } })
      .composite([{ input: mask, blend: "dest-in" }])
      .png()
      .toBuffer();
    return empty;
  }
  let image = sharp(file);
  if (cell.crop) image = image.extract(cell.crop);
  const resized = await image.resize({ width: cell.width, height: cell.height, fit: "cover", position: "top" }).png().toBuffer();
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

const CHAT_NOTE = "Под листом — утверждённый экран чата, вариант C «Капсулы и цвет».";

const DEVICE_SHEETS = {
  iphone: {
    label: "iPhone 430",
    // 860x1864 frames at 280 wide keep a two-theme sheet well under 2200px.
    cell: { width: 280, height: 607 },
    subtitle: `Настоящие компоненты приложения на DEV-маршруте, вымышленные переписка и фото. iPhone 430×932, режим установленного приложения; статус-бар, «остров» и полоска «домой» дорисованы для масштаба. ${CHAT_NOTE}`,
  },
  iphone390: {
    label: "iPhone 390",
    // 780x1688 frames at 280 wide.
    cell: { width: 280, height: 606 },
    subtitle: `Те же компоненты на iPhone 390×844, где ряд вкладок обрезается раньше. Статус-бар, «остров» и полоска «домой» дорисованы для масштаба. ${CHAT_NOTE}`,
  },
  desktop: {
    label: "компьютер",
    // The left of the conversation pane above the composer, where the panel opens.
    cell: { width: 420, height: 525, crop: { left: 388, top: 200, width: 560, height: 700 } },
    subtitle: `Настоящие компоненты на DEV-маршруте, вымышленные данные. Окно 1440×900; показан угол переписки над полем ввода, где открывается панель. ${CHAT_NOTE}`,
  },
};

/** What the reader should know about the states, said once under each sheet. */
const SHEET_NOTE =
  "Лист всегда по высоте содержимого. Кнопка отправки шлёт со сжатием и ничего не спрашивает; «Отправить без сжатия» — под «…», где его держит Telegram на iOS. Карта — нейтральная заглушка с координатами: превью будет рисовать наш собственный сервер по данным OpenStreetMap, чтобы ничего о человеке не уходило третьей стороне. Ряд вкладок прокручен настоящим жестом пальца, на компьютере — колесом мыши; выбрана при этом по-прежнему «Галерея». Заглушка — значок, название и строка о том, что функция скоро появится: кнопок нет, отправить нечего. Вкладки «Музыка» больше нет.";

async function buildSheets() {
  const sheets = [];
  for (const [device, spec] of Object.entries(DEVICE_SHEETS)) {
    const states = SHEET_STATES.filter((entry) => DEVICE_STATES[device].includes(entry.id));
    const rows = THEMES.map((theme) => ({
      label: theme.title,
      frames: states.map((state) => framePath(`${theme.id}-${device}-${state.id}`)),
    }));
    const file = path.join(OUT, `sheet-${device}.png`);
    sheets.push(
      await buildSheet({
        file,
        title: `Вложения · ${spec.label} · «Стеклянная капсула»`,
        subtitle: `${spec.subtitle} ${SHEET_NOTE}`,
        columns: states.map((state) => state.title),
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
    const media = await makeMedia();
    // The full Chromium build, not Playwright's headless shell: the shell does
    // not frost a scrolling container under backdrop-filter, and the sheet's
    // glass would photograph as a flat tint.
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      for (const frame of FRAMES) {
        if (only && !only.has(frame.id)) continue;
        try {
          const result = await renderFrame(browser, frame, media);
          results[frame.id] = result;
          console.log(
            `${frame.id}: ok${result.inter ? "" : " (Inter did not load)"} camera=${result.cameraRequests} position=${result.positionRequests} gap=${result.fitGap}` +
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
