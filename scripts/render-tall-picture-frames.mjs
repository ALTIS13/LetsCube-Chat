#!/usr/bin/env node
/**
 * Renders what a picture looks like in a bubble, before and after D-116.
 *
 * The owner chose option B on 2026-09-12: a tall picture gets a taller bubble
 * and is still centre-cropped. These frames are the real application on the DEV
 * preview route, over a fictional, checked-in conversation, at 430x932 with two
 * device pixels to the point, in both themes.
 *
 * "До" is the same page with the old numbers put back on the box — the aspect
 * clamped at 0.72 and the height capped at 340px — because that is the whole of
 * what changed for a picture whose size is known. Both halves are therefore
 * photographed from one build, and nothing about the comparison depends on
 * rebuilding an old revision.
 *
 * Every frame reports what it measured: the box it drew and the share of the
 * picture that survived the crop, read off the element rather than computed
 * from the fixture, so the sheet cannot claim something the page did not do.
 *
 * It does not start a server. Point it at a dev server on the fixture
 * configuration (VITE_SUPABASE_URL=http://127.0.0.1:54321,
 * VITE_PUBLIC_PREVIEW_FIXTURE=1); it refuses anything else. Nothing off this
 * machine is reached: the pictures are inline SVG, the fixture's backend is
 * answered locally, and every other host is aborted.
 *
 * Usage:
 *   KUB_BASE_URL=http://127.0.0.1:5303 node scripts/render-tall-picture-frames.mjs
 *
 * Writes output/renders/2026-09-12-tall-pictures/: frames/*.png, sheet.html and
 * sheet.png.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const { chromium } = await import(
  pathToFileURL(path.join(ROOT, "node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs")).href
);

const BASE = process.env.KUB_BASE_URL ?? "";
const OUT = path.join(ROOT, "output", "renders", "2026-09-12-tall-pictures");
const FRAMES_DIR = path.join(OUT, "frames");
const CAPTURE_PATH = "/__qa/public-preview";
const WINDOW_KEY = "__letscubePublicPreviewFixture";
const CLOCK = new Date("2026-09-12T18:00:00+03:00");
const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost", "fonts.googleapis.com", "fonts.gstatic.com"]);
const VIEWPORT = { width: 430, height: 932 };
/** One width for every tile, so "до" and "после" are photographed at one scale. */
const CLIP_WIDTH = 390;
/** The old rule, put back on the box for the "до" half. */
const BEFORE = { min: 0.72, max: 1.9, cap: 340 };

// ── the pictures ────────────────────────────────────────────────────────────

const svg = (body, width, height) =>
  `data:image/svg+xml;base64,${Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`,
  ).toString("base64")}`;

/** A phone screenshot, 1290x2796, with ten numbered rows so a crop can be counted. */
const TALL_PICTURE = (() => {
  const rows = Array.from({ length: 10 }, (_, index) => {
    const y = 330 + index * 228;
    return (
      `<rect x="60" y="${y}" width="1170" height="188" rx="26" fill="#ffffff"/>` +
      `<circle cx="156" cy="${y + 94}" r="52" fill="#c7d7ea"/>` +
      `<rect x="236" y="${y + 48}" width="600" height="28" rx="14" fill="#9fb3c8"/>` +
      `<rect x="236" y="${y + 104}" width="410" height="24" rx="12" fill="#c9d5e1"/>` +
      `<text x="1170" y="${y + 122}" font-family="Arial, sans-serif" font-size="92" font-weight="700" fill="#2d6cdf" text-anchor="end">${index + 1}</text>`
    );
  }).join("");
  return svg(
    `<rect width="1290" height="2796" fill="#eef3f8"/>` +
      `<rect width="1290" height="250" fill="#2d6cdf"/>` +
      `<text x="64" y="112" font-family="Arial, sans-serif" font-size="52" fill="#cfe0fb">09:41</text>` +
      `<text x="64" y="206" font-family="Arial, sans-serif" font-size="78" font-weight="700" fill="#ffffff">Сводка за день</text>` +
      rows +
      `<rect x="0" y="2630" width="1290" height="166" fill="#2d6cdf"/>` +
      `<text x="645" y="2736" font-family="Arial, sans-serif" font-size="72" font-weight="700" fill="#ffffff" text-anchor="middle">конец списка</text>`,
    1290,
    2796,
  );
})();

/** An ordinary photograph, 4032x3024, numbered at all four corners. */
const PHOTO_4_3 = (() => {
  const corner = (x, y, anchor, label) =>
    `<text x="${x}" y="${y}" font-family="Arial, sans-serif" font-size="300" font-weight="700" fill="#ffffff" text-anchor="${anchor}">${label}</text>`;
  return svg(
    `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="#5b9bd8"/><stop offset="1" stop-color="#cfe4f5"/></linearGradient></defs>` +
      `<rect width="4032" height="3024" fill="url(#sky)"/>` +
      `<circle cx="3200" cy="700" r="280" fill="#ffd66b"/>` +
      `<path d="M0 2100 L1100 1250 L2050 2100 Z" fill="#8fa7bb"/>` +
      `<path d="M1500 2100 L2600 1150 L3700 2100 Z" fill="#7d94a8"/>` +
      `<rect x="0" y="2100" width="4032" height="924" fill="#6f8d5e"/>` +
      `<rect x="1500" y="1700" width="900" height="400" fill="#c96a4a"/>` +
      `<rect x="1700" y="1810" width="180" height="180" fill="#f4e7d4"/>` +
      `<rect x="2050" y="1810" width="180" height="180" fill="#f4e7d4"/>` +
      corner(160, 330, "start", "1") +
      corner(3880, 330, "end", "2") +
      corner(160, 2900, "start", "3") +
      corner(3880, 2900, "end", "4"),
    4032,
    3024,
  );
})();

/** A panorama, 2400x1000, in eight numbered columns. */
const WIDE_PICTURE = (() => {
  const columns = Array.from({ length: 8 }, (_, index) => {
    const x = index * 300;
    return (
      `<rect x="${x}" y="0" width="300" height="1000" fill="${index % 2 === 0 ? "#20455f" : "#2a5878"}"/>` +
      `<text x="${x + 150}" y="560" font-family="Arial, sans-serif" font-size="150" font-weight="700" fill="#ffffff" text-anchor="middle">${index + 1}</text>`
    );
  }).join("");
  return svg(
    columns +
      `<rect x="0" y="760" width="2400" height="240" fill="#123047" opacity="0.65"/>` +
      `<text x="1200" y="910" font-family="Arial, sans-serif" font-size="96" font-weight="700" fill="#cfe4f5" text-anchor="middle">панорама</text>`,
    2400,
    1000,
  );
})();

// ── the conversations ───────────────────────────────────────────────────────

const CHAT = "Аня Смирнова";

function conversation(caption, image) {
  return {
    currentUser: { name: "Максим", username: "maksim" },
    activeChat: { name: CHAT, memberCount: 2, type: "private", readers: [{ name: CHAT, time: "12:06" }] },
    chats: [
      { name: CHAT, preview: caption, time: "12:05", unread: 0 },
      { name: "Команда проекта", preview: "Макет главной готов", time: "11:40", unread: 3 },
    ],
    messages: [
      { sender: CHAT, text: "Привет! Смотрел, что пришло вчера?", time: "12:01", own: false },
      { sender: "Максим", text: "Ещё нет, скинь сюда", time: "12:03", own: true },
      { sender: CHAT, text: caption, time: "12:05", own: false, image },
    ],
  };
}

const KINDS = [
  {
    id: "tall",
    title: "Высокий скриншот 1290×2796",
    caption: "Скриншот со сводкой",
    picture: { url: TALL_PICTURE, width: 1290, height: 2796 },
  },
  {
    id: "photo",
    title: "Обычное фото 4:3 — 4032×3024",
    caption: "Фото с площадки",
    picture: { url: PHOTO_4_3, width: 4032, height: 3024 },
  },
  {
    id: "wide",
    title: "Широкая картинка 2400×1000",
    caption: "Панорама набережной",
    picture: { url: WIDE_PICTURE, width: 2400, height: 1000 },
  },
];

const THEMES = [
  { id: "light", label: "светлая" },
  { id: "dark", label: "тёмная" },
];
const MODES = [
  { id: "before", label: "до" },
  { id: "after", label: "после" },
];

const FRAMES = KINDS.flatMap((kind) =>
  THEMES.flatMap((theme) =>
    MODES.map((mode) => ({ id: `${kind.id}-${theme.id}-${mode.id}`, kind, theme, mode })),
  ),
);

// ── rendering ───────────────────────────────────────────────────────────────

async function assertFixtureServer() {
  let url;
  try {
    url = new URL(BASE);
  } catch {
    throw new Error("KUB_BASE_URL must be a loopback dev server, e.g. http://127.0.0.1:5303");
  }
  const loopback = url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if (!loopback || !url.port) {
    throw new Error("KUB_BASE_URL must be a loopback dev server, e.g. http://127.0.0.1:5303");
  }
  const client = await fetch(`${BASE}/src/lib/supabase/client.ts`).then((response) => response.text());
  if (!client.includes("127.0.0.1:54321")) throw new Error("The dev server is not on the fixture configuration.");
  const capture = await fetch(`${BASE}${CAPTURE_PATH}`);
  if (!capture.ok) throw new Error(`The capture route answered ${capture.status}.`);
}

async function renderFrame(browser, frame) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    colorScheme: frame.theme.id,
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
  });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    // The fixture's backend does not exist. Answering its variant query with an
    // empty list keeps the run offline and deterministic.
    if (url.port === "54321") {
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    }
    return ALLOWED_HOSTS.has(url.hostname) ? route.continue() : route.abort();
  });

  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.clock.setFixedTime(CLOCK);
  await page.addInitScript(
    ({ key, fixture, theme }) => {
      window[key] = fixture;
      localStorage.setItem("kub-theme", theme);
    },
    { key: WINDOW_KEY, fixture: conversation(frame.kind.caption, frame.kind.picture), theme: frame.theme.id },
  );
  await page.goto(`${BASE}${CAPTURE_PATH}`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-public-preview-ready="true"]').waitFor({ state: "attached", timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  const picture = page.locator('button[aria-label="Открыть фото"] img').first();
  await picture.waitFor({ state: "visible", timeout: 20_000 });
  // Past the entry lock and its settle passes, which pull the conversation back
  // to the bottom after any scroll of ours.
  await page.waitForTimeout(4_700);

  if (frame.mode.id === "before") {
    await page.evaluate(
      ({ width, height, before }) => {
        const ratio = Math.min(before.max, Math.max(before.min, width / height));
        for (const button of document.querySelectorAll('button[aria-label="Открыть фото"]')) {
          button.style.aspectRatio = ratio.toFixed(4);
          button.style.maxHeight = `${before.cap}px`;
        }
      },
      { width: frame.kind.picture.width, height: frame.kind.picture.height, before: BEFORE },
    );
  }

  // Put the picture in the middle of what the reader can see, so a taller box
  // is photographed whole rather than under the composer.
  await page.evaluate(() => {
    const button = document.querySelector('button[aria-label="Открыть фото"]');
    const row = button?.closest("[data-message-id]");
    const scroller = document.querySelector('[data-testid="message-scroll-container"]');
    if (!row || !scroller) return;
    const rowBox = row.getBoundingClientRect();
    const box = scroller.getBoundingClientRect();
    const style = getComputedStyle(scroller);
    const top = box.top + Number.parseFloat(style.paddingTop);
    const bottom = box.bottom - Number.parseFloat(style.paddingBottom);
    scroller.scrollTop += rowBox.top - (top + (bottom - top) / 2 - rowBox.height / 2);
  });
  await page.waitForTimeout(500);

  const measured = await page.evaluate(() => {
    const button = document.querySelector('button[aria-label="Открыть фото"]');
    const image = button?.querySelector("img");
    if (!button || !image) return null;
    const box = button.getBoundingClientRect();
    // What `object-cover` does: scale until the picture covers the box, then
    // crop what hangs over.
    const scale = Math.max(box.width / image.naturalWidth, box.height / image.naturalHeight);
    return {
      boxWidth: Math.round(box.width),
      boxHeight: Math.round(box.height),
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      heightShare: box.height / (image.naturalHeight * scale),
      widthShare: box.width / (image.naturalWidth * scale),
      painted: image.complete && image.naturalWidth > 0,
    };
  });
  if (!measured) throw new Error("no picture on the page");
  if (!measured.painted) throw new Error("the picture did not paint");

  const bubble = page.locator('[data-message-bubble="true"]').filter({ hasText: frame.kind.caption }).last();
  const box = await bubble.boundingBox();
  if (!box) throw new Error("no bubble to clip");
  const margin = 14;
  const x = Math.min(Math.max(0, box.x - margin), VIEWPORT.width - CLIP_WIDTH);
  const y = Math.max(0, box.y - margin);
  const file = path.join(FRAMES_DIR, `${frame.id}.png`);
  await page.screenshot({
    path: file,
    clip: {
      x,
      y,
      width: CLIP_WIDTH,
      height: Math.min(VIEWPORT.height - y, box.height + margin * 2),
    },
    animations: "disabled",
  });
  await context.close();
  return { file, measured, errors };
}

// ── the sheet ───────────────────────────────────────────────────────────────

function caption(frame, measured) {
  const share = Math.min(measured.heightShare, measured.widthShare);
  const axis = measured.heightShare <= measured.widthShare ? "высоты" : "ширины";
  const visible = share > 0.999 ? "видно целиком" : `видно ${Math.round(share * 100)}% ${axis}`;
  return `${frame.theme.label}, ${frame.mode.label} — ${measured.boxWidth}×${measured.boxHeight}, ${visible}`;
}

function sheetHtml(rendered) {
  const sections = KINDS.map((kind) => {
    const tiles = rendered
      .filter((entry) => entry.frame.kind.id === kind.id)
      .map(
        ({ frame, file, measured }) => `
        <figure class="${frame.mode.id}">
          <img src="data:image/png;base64,${readFileSync(file).toString("base64")}" alt="">
          <figcaption>${caption(frame, measured)}</figcaption>
        </figure>`,
      )
      .join("");
    return `<section><h2>${kind.title}</h2><div class="grid">${tiles}</div></section>`;
  }).join("");

  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>
    body { margin: 0; padding: 26px 30px 30px; background: #e9eef4; font: 14px/1.4 Inter, "Segoe UI", sans-serif; color: #10233b; }
    h1 { margin: 0 0 4px; font-size: 21px; }
    p.lead { margin: 0 0 18px; font-size: 13px; color: #43576f; max-width: 980px; }
    section { margin-bottom: 18px; }
    h2 { margin: 0 0 8px; font-size: 15px; font-weight: 600; }
    .grid { display: grid; grid-template-columns: repeat(4, 215px); gap: 10px 14px; align-items: start; }
    figure { margin: 0; }
    figure.after img { outline: 2px solid #2d6cdf; outline-offset: 1px; }
    img { display: block; width: 215px; border-radius: 8px; box-shadow: 0 1px 0 #c3cfdc, 0 5px 14px rgba(16, 35, 59, 0.12); }
    figcaption { margin-top: 5px; font-size: 12px; color: #43576f; }
  </style></head><body>
    <h1>LETSCUBE — высокие картинки в пузыре, iPhone 430×932</h1>
    <p class="lead">Вариант B: у высокой картинки пропорция опускается до 0,5, высота пузыря — до 480 px.
    «До» — те же кадры со старыми числами (0,72 и 340 px). Обрезка по-прежнему по центру.
    Проценты измерены на самом элементе, а не посчитаны заранее. Кадры «после» обведены синим.<br>
    Здесь iPhone 430×932: пузырь шириной 310 px, поэтому у скриншота видно 71% высоты вместо 51%.
    На узком телефоне пузырь уже, а высота та же, и видно больше: 82% при 390 px и 92% при 360 px.
    Это и есть те «примерно 82%», по которым принималось решение.</p>
    ${sections}
  </body></html>`;
}

async function main() {
  await assertFixtureServer();
  mkdirSync(FRAMES_DIR, { recursive: true });
  const browser = await chromium.launch();
  const rendered = [];
  const failures = [];
  try {
    for (const frame of FRAMES) {
      try {
        const result = await renderFrame(browser, frame);
        rendered.push({ frame, ...result });
        const { boxWidth, boxHeight, heightShare, widthShare } = result.measured;
        console.log(
          `${frame.id}: ${boxWidth}x${boxHeight}, height ${(heightShare * 100).toFixed(1)}%, width ${(widthShare * 100).toFixed(1)}%` +
            (result.errors.length ? ` errors: ${JSON.stringify(result.errors)}` : ""),
        );
      } catch (error) {
        failures.push(frame.id);
        console.error(`${frame.id}: FAILED ${error instanceof Error ? error.message.split("\n")[0] : error}`);
      }
    }
    if (failures.length) {
      process.exitCode = 1;
      return;
    }
    const html = sheetHtml(rendered);
    writeFileSync(path.join(OUT, "sheet.html"), html);
    const page = await browser.newPage({ viewport: { width: 1024, height: 900 } });
    await page.setContent(html, { waitUntil: "load" });
    await page.screenshot({ path: path.join(OUT, "sheet.png"), fullPage: true });
    await page.close();
    console.log(`sheet: ${path.join(OUT, "sheet.png")}`);
  } finally {
    await browser.close();
  }
}

await main();
