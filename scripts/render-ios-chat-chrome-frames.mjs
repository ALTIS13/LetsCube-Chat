#!/usr/bin/env node
/**
 * Renders the phone chat screen's design options for the owner (2026-09-11):
 * the current look and the three DEV options of `lib/chatChromeOptions.ts`, in
 * both themes, on an iPhone Pro Max, with an Android-size phone and a desktop as
 * the check that nothing else broke.
 *
 * Every frame is the real application on the DEV preview route, over a
 * fictional, checked-in private conversation. The iPhone is Chromium at 430x932
 * and three device pixels per point, with the safe areas overridden inside the
 * engine — `Emulation.setSafeAreaInsetsOverride`, so `env()` itself reports 59
 * and 34 — and with `navigator.standalone` and `(display-mode: standalone)`
 * answered the way the home-screen app answers them. Nothing on a network is
 * reached: every request off this machine and the font host is aborted.
 *
 * Chromium draws no status bar, Dynamic Island or home indicator, so the iPhone
 * frames have them drawn over the page, and the sheets say so. They go on after
 * everything is measured and come off before anything else happens, so no
 * measurement and no hit test ever sees them.
 *
 * Two things are measured on every iPhone frame at rest, both from photographed
 * pixels, the way rule 7 of docs/operations/interface-material.md asks:
 *
 *  - the text: made transparent, its backdrop photographed, the text colour
 *    composited over every pixel of that, the worst pixel reported. The chrome
 *    is measured twice — over the conversation at rest, and over the worst field
 *    a translucent surface can meet: solid white under the dark theme, solid
 *    black under the light one;
 *  - the surfaces: a few pixels of the ground, each bubble, the header, the
 *    status bar's band and the composer, away from any text. How far apart they
 *    composite, and on which hue, is what "one monotone navy" is made of.
 *
 * It does not start a server. Point it at a dev server on the fixture
 * configuration (`VITE_SUPABASE_URL=http://127.0.0.1:54321`,
 * `VITE_PUBLIC_PREVIEW_FIXTURE=1`); it refuses anything else.
 *
 * Usage:
 *   KUB_BASE_URL=http://127.0.0.1:5292 node scripts/render-ios-chat-chrome-frames.mjs
 *     [--only dark-capsules-iphone-rest,light-depth-android-rest]   re-render some frames
 *     [--sheets]                                                    only rebuild the sheets
 *
 * Writes output/renders/2026-09-11-ios-chat-chrome/: frames/*.png,
 * measurements/*.json, measurements.md, and sheet-dark.png / sheet-light.png
 * with their HTML.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const { chromium } = await import(
  pathToFileURL(path.join(ROOT, "node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs")).href
);

const BASE = process.env.KUB_BASE_URL ?? "";
const OUT = path.join(ROOT, "output", "renders", "2026-09-11-ios-chat-chrome");
const FRAMES_DIR = path.join(OUT, "frames");
const MEASUREMENTS_DIR = path.join(OUT, "measurements");
const CAPTURE_PATH = "/__qa/public-preview";
const WINDOW_KEY = "__letscubePublicPreviewFixture";
const OPTION_KEY = "kub-dev-chat-chrome";
const CLOCK = new Date("2026-09-11T18:00:00+03:00");
const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost", "fonts.googleapis.com", "fonts.gstatic.com"]);

const argValue = (flag) => {
  const index = process.argv.indexOf(flag);
  return index > 0 ? process.argv[index + 1] ?? null : null;
};
const only = argValue("--only") ? new Set(argValue("--only").split(",").map((id) => id.trim())) : null;
const sheetsOnly = process.argv.includes("--sheets");

// ── the conversation ────────────────────────────────────────────────────────

const CHAT = "Аня Смирнова";
const MENU_TARGET = "Возьми, пожалуйста, распечатку сметы";
const OWN_PROBE = "Напомнил, он заберёт ключи в шесть";
const IN_PROBE = "До встречи у входа";

/**
 * A private chat, as in the owner's screenshots: yesterday's messages above a
 * date chip, one of them pinned, today's below it, a reaction, an edit and a
 * read receipt. The other chats carry 24 unread, which is what the capsule back
 * button counts.
 */
const FIXTURE = {
  currentUser: { name: "Максим", username: "maksim" },
  activeChat: { name: CHAT, memberCount: 2, type: "private", readers: [{ name: CHAT, time: "17:52" }] },
  chats: [
    { name: CHAT, preview: IN_PROBE, time: "17:54", unread: 0 },
    { name: "Команда проекта", preview: "Макет главной готов", time: "17:40", unread: 12 },
    { name: "Дизайн", preview: "Обновил палитру", time: "16:05", unread: 7 },
    { name: "Борис", preview: "Созвонимся вечером?", time: "15:20", unread: 5 },
  ],
  messages: [
    { sender: CHAT, text: "Привет! Ты завтра будешь на площадке?", time: "19:40", own: false, daysAgo: 1 },
    { sender: "Максим", text: "Да, с утра. Нужно проверить витрину после монтажа.", time: "19:44", own: true, daysAgo: 1 },
    { sender: CHAT, text: "Адрес: ул. Садовая, 12, вход со двора, домофон 14", time: "19:46", own: false, daysAgo: 1, pinned: true },
    { sender: CHAT, text: "Доброе утро! Подрядчик подтвердил, приедет к одиннадцати.", time: "09:12", own: false },
    { sender: "Максим", text: "Хорошо, буду к половине одиннадцатого", time: "09:15", own: true },
    { sender: CHAT, text: `${MENU_TARGET} — обсудим сроки прямо на месте, если что-то поменялось.`, time: "12:30", own: false },
    { sender: "Максим", text: "Взял. По срокам всё в силе, две недели", time: "12:41", own: true, reactions: [{ emoji: "👍", users: [CHAT] }] },
    { sender: "Максим", text: "Витрину сфотографирую после обеда и пришлю сюда", time: "15:05", own: true, editedAt: "15:06" },
    { sender: CHAT, text: "Жду. И напомни Борису про ключи от склада", time: "17:20", own: false },
    { sender: "Максим", text: OWN_PROBE, time: "17:48", own: true },
    { sender: CHAT, text: IN_PROBE, time: "17:54", own: false },
  ],
  recentReactions: ["👍", "🔥", "😂", "🎉", "😮", "🙏"],
};

// ── what is rendered ────────────────────────────────────────────────────────

const OPTIONS = [
  { id: "current", title: "Сейчас", note: "Как в приложении сегодня." },
  {
    id: "capsules",
    title: "A. Капсулы у острова",
    note: "Только геометрия: под статус-баром нет полосы, шапка, закреп и поле ввода — отдельные стеклянные капсулы. Палитра прежняя.",
  },
  {
    id: "depth",
    title: "B. Глубина цвета",
    note: "Только цвет: обои с узором и оттенками, насыщенные свои сообщения с белым текстом, входящие без обводки, дата на подложке. Полосы прежние.",
  },
  { id: "capsules-depth", title: "C. Капсулы и цвет", note: "A и B вместе — ближе всего к Telegram." },
];

const THEMES = [
  { id: "dark", title: "тёмная тема" },
  { id: "light", title: "светлая тема" },
];

const DEVICES = {
  iphone: {
    viewport: { width: 430, height: 932 },
    scale: 3,
    touch: true,
    insets: { top: 59, right: 0, bottom: 34, left: 0 },
    standalone: true,
  },
  android: { viewport: { width: 390, height: 844 }, scale: 3, touch: true, insets: null, standalone: false },
  desktop: { viewport: { width: 1440, height: 900 }, scale: 1, touch: false, insets: null, standalone: false },
};

const STATES = {
  rest: async () => undefined,
  "message-menu": async (t) => {
    await t.center(MENU_TARGET, 0.55);
    await t.tapText(MENU_TARGET);
    await t.waitFor("[data-action-menu]");
  },
  "header-menu": async (t) => {
    await t.page.getByRole("button", { name: "Ещё" }).tap();
    await t.waitFor('[role="menu"]');
  },
};

const FRAMES = [];
for (const theme of THEMES) {
  for (const option of OPTIONS) {
    for (const [device, state] of [
      ["iphone", "rest"],
      ["iphone", "message-menu"],
      ["iphone", "header-menu"],
      ["android", "rest"],
      ["desktop", "rest"],
    ]) {
      FRAMES.push({ id: `${theme.id}-${option.id}-${device}-${state}`, theme: theme.id, option: option.id, device, state });
    }
  }
}

/** Text measured on every iPhone frame at rest. */
const TARGETS = [
  { id: "own-text", label: "Своё сообщение — текст", kind: "bubble-text", own: true, text: OWN_PROBE },
  { id: "own-time", label: "Своё сообщение — время", kind: "bubble-time", own: true, text: OWN_PROBE },
  { id: "in-text", label: "Входящее — текст", kind: "bubble-text", own: false, text: IN_PROBE },
  { id: "in-time", label: "Входящее — время", kind: "bubble-time", own: false, text: IN_PROBE },
  { id: "sender", label: "Имя над входящим", kind: "sender-name" },
  { id: "date-chip", label: "Дата «Сегодня»", kind: "date-chip", text: "Сегодня" },
  { id: "header-name", label: "Шапка — имя", kind: "header-name" },
  { id: "header-status", label: "Шапка — статус", kind: "header-status" },
  { id: "pinned-label", label: "Закреп — заголовок", kind: "pinned-label" },
  { id: "pinned-text", label: "Закреп — текст", kind: "pinned-text" },
  { id: "placeholder", label: "Поле ввода — подсказка", kind: "placeholder" },
];

/** The chrome again, over the worst field a translucent surface can meet. */
const WORST_TARGETS = TARGETS.filter((target) =>
  ["header-name", "header-status", "pinned-label", "pinned-text", "placeholder"].includes(target.id),
);

/** The surfaces photographed on every iPhone frame at rest. */
const SWATCHES = [
  { id: "ground", label: "Фон переписки" },
  { id: "bubble-in", label: "Входящий пузырь" },
  { id: "bubble-own", label: "Свой пузырь" },
  { id: "status-bar", label: "Под статус-баром" },
  { id: "header", label: "Шапка" },
  { id: "composer-band", label: "Над полем ввода" },
  { id: "composer-field", label: "Поле ввода" },
];

// ── driving a frame ─────────────────────────────────────────────────────────

function tools(page) {
  const bubbleOf = (text) => page.locator('[data-message-bubble="true"]').filter({ hasText: text }).last();

  async function textPoint(text, dx = 20, dy = 12) {
    const bubble = bubbleOf(text);
    const node = bubble.locator('[data-message-text-content="true"], p').first();
    const box = (await node.count()) ? await node.boundingBox() : await bubble.boundingBox();
    if (!box) throw new Error(`no box for «${text}»`);
    return { x: Math.round(box.x + Math.min(dx, box.width / 2)), y: Math.round(box.y + Math.min(dy, box.height / 2)) };
  }

  return {
    page,
    async waitFor(selector) {
      await page.locator(selector).first().waitFor({ state: "visible", timeout: 10_000 });
    },
    /** Puts a message at a fraction of the conversation's visible height. */
    async center(text, at = 0.5) {
      await page.evaluate(
        ({ text, at }) => {
          const rows = Array.from(document.querySelectorAll("[data-message-id]"));
          const row = rows.filter((node) => node.textContent?.includes(text)).at(-1);
          const scroller = document.querySelector('[data-testid="message-scroll-container"]');
          if (!row || !scroller) throw new Error(`no message «${text}»`);
          const rowBox = row.getBoundingClientRect();
          const box = scroller.getBoundingClientRect();
          const style = getComputedStyle(scroller);
          const top = box.top + parseFloat(style.paddingTop);
          const bottom = box.bottom - parseFloat(style.paddingBottom);
          const target = top + (bottom - top) * at - rowBox.height / 2;
          scroller.scrollTop += rowBox.top - target;
        },
        { text, at },
      );
      await page.waitForTimeout(350);
    },
    async tapText(text) {
      const point = await textPoint(text);
      await page.touchscreen.tap(point.x, point.y);
      await page.waitForTimeout(650);
    },
  };
}

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

async function assertFixtureServer() {
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(BASE)) {
    throw new Error("KUB_BASE_URL must be a loopback dev server, e.g. http://127.0.0.1:5292");
  }
  const client = await fetch(`${BASE}/src/lib/supabase/client.ts`).then((response) => response.text());
  if (!client.includes("127.0.0.1:54321")) throw new Error("The dev server is not on the fixture configuration.");
  const capture = await fetch(`${BASE}${CAPTURE_PATH}`);
  if (!capture.ok) throw new Error(`The capture route answered ${capture.status}.`);
}

/**
 * The page opened on the right terms, or an error saying which term is missing:
 * the option applied and its stylesheet loaded, the theme, the installed app
 * recognised, the insets reaching the layout, and the capsules where — and only
 * where — a phone is. A frame taken without any of these would photograph
 * something other than what its caption says.
 */
async function assertConditions(page, frame) {
  const device = DEVICES[frame.device];
  const expected = { capsules: frame.option.includes("capsules"), depth: frame.option.includes("depth") };
  const found = await page.evaluate(async (expected) => {
    const root = document.documentElement;
    const deadline = Date.now() + 5_000;
    // The stylesheet arrives by a dynamic import; wait for one of its values.
    while ((expected.capsules || expected.depth) && Date.now() < deadline) {
      const style = getComputedStyle(root);
      const loaded = expected.depth
        ? style.getPropertyValue("--chat-option-ground").trim()
        : style.getPropertyValue("--chat-option-edge").trim();
      if (loaded) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;visibility:hidden;padding-top:var(--kub-safe-top);padding-bottom:var(--kub-safe-bottom)";
    document.body.appendChild(probe);
    const insets = { top: parseFloat(getComputedStyle(probe).paddingTop), bottom: parseFloat(getComputedStyle(probe).paddingBottom) };
    probe.remove();
    const style = getComputedStyle(root);
    const row = document.querySelector('[data-testid="chat-control-row"]');
    return {
      capsules: root.hasAttribute("data-kub-chat-capsules"),
      depth: root.hasAttribute("data-kub-chat-depth"),
      stylesheet: Boolean(style.getPropertyValue("--chat-option-edge").trim() || style.getPropertyValue("--chat-option-ground").trim()),
      standalone: root.hasAttribute("data-ios-standalone"),
      theme: root.classList.contains("dark") ? "dark" : root.classList.contains("light") ? "light" : null,
      insets,
      capsuleRow: row ? getComputedStyle(row).display === "grid" : null,
    };
  }, expected);
  const problems = [];
  if (found.capsules !== expected.capsules || found.depth !== expected.depth) problems.push(`option attributes ${JSON.stringify(found)}`);
  if ((expected.capsules || expected.depth) && !found.stylesheet) problems.push("the options' stylesheet never loaded");
  if (!expected.capsules && !expected.depth && found.stylesheet) problems.push("the options' stylesheet loaded for the current look");
  if (found.theme !== frame.theme) problems.push(`theme ${found.theme}`);
  if (device.standalone !== found.standalone) problems.push(`standalone ${found.standalone}`);
  const insets = device.insets ?? { top: 0, bottom: 0 };
  if (found.insets.top !== insets.top || found.insets.bottom !== insets.bottom) problems.push(`insets ${JSON.stringify(found.insets)}`);
  const phone = frame.device !== "desktop";
  if (found.capsuleRow !== (expected.capsules && phone)) problems.push(`capsule row ${found.capsuleRow}`);
  if (problems.length) throw new Error(`${frame.id}: ${problems.join("; ")}`);
}

// ── colour, photographed ────────────────────────────────────────────────────

const PROBE = "data-render-contrast-probe";

function luminance([r, g, b]) {
  const channel = (value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function hue([r, g, b]) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return null;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round((h * 60 + 360) % 360);
}

async function photograph(page, clip) {
  const shot = await page.screenshot({ clip, animations: "disabled" });
  return sharp(shot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
}

async function locateProbe(page, target) {
  return page.evaluate(
    ({ target, chat, probe }) => {
      const leaves = (root) =>
        root ? [...root.querySelectorAll("*")].filter((node) => node.children.length === 0 && node.textContent.trim()) : [];
      const inView = (node) => {
        const box = node.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < window.innerHeight;
      };
      const bubble = (own, text) =>
        [...document.querySelectorAll(`[data-message-bubble="true"][data-message-own="${own}"]`)]
          .filter((node) => node.textContent.includes(text))
          .at(-1) ?? null;

      let element = null;
      let placeholder = false;
      if (target.kind === "bubble-text") {
        const host = bubble(target.own, target.text);
        element = host?.querySelector('[data-message-text-content="true"]') ?? host?.querySelector("p") ?? null;
      } else if (target.kind === "bubble-time") {
        element = leaves(bubble(target.own, target.text)).find((node) => /^\d{2}:\d{2}$/.test(node.textContent.trim())) ?? null;
      } else if (target.kind === "sender-name") {
        element =
          leaves(document.querySelector('[data-testid="message-scroll-container"]'))
            .filter((node) => node.textContent.trim() === chat && !node.closest("[data-message-bubble]") && inView(node))
            .at(-1) ?? null;
      } else if (target.kind === "date-chip") {
        element =
          [...document.querySelectorAll("[data-message-date-separator] > span")].find(
            (node) => node.textContent.trim() === target.text && inView(node),
          ) ?? null;
      } else if (target.kind === "header-name" || target.kind === "header-status") {
        const texts = leaves(document.querySelector('[data-testid="chat-header-info-button"]'));
        const at = texts.findIndex((node) => node.textContent.trim() === chat);
        element = at < 0 ? null : texts[target.kind === "header-name" ? at : at + 1] ?? null;
      } else if (target.kind === "pinned-label" || target.kind === "pinned-text") {
        const label = leaves(document.querySelector('[data-testid="chat-chrome-stack"]')).find(
          (node) => node.textContent.trim() === "Закреплённое сообщение",
        );
        element = target.kind === "pinned-label" ? label ?? null : label?.parentElement?.parentElement?.lastElementChild ?? null;
      } else if (target.kind === "placeholder") {
        element = document.querySelector('[data-testid="chat-composer-dock"] textarea');
        placeholder = true;
      }
      if (!element || !inView(element)) return null;

      let rect;
      if (placeholder) {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const left = box.left + parseFloat(style.paddingLeft);
        const top = box.top + parseFloat(style.paddingTop);
        const width = box.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        const height = box.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
        // The placeholder's own words, not the empty rest of the field.
        rect = { x0: left, y0: top, x1: left + Math.min(110, width), y1: top + height };
      } else {
        const range = document.createRange();
        range.selectNodeContents(element);
        const rects = [...range.getClientRects()].filter((box) => box.width > 1 && box.height > 1);
        if (!rects.length) return null;
        // A truncated line's text runs on past its own box, under whatever sits
        // beside it — the pinned bar's icons are the same grey as its text, and
        // measured 1.00:1 against themselves. Only what the element shows counts.
        const own = element.getBoundingClientRect();
        rect = {
          x0: Math.max(own.left, Math.min(...rects.map((box) => box.left))),
          y0: Math.max(own.top, Math.min(...rects.map((box) => box.top))),
          x1: Math.min(own.right, Math.max(...rects.map((box) => box.right))),
          y1: Math.min(own.bottom, Math.max(...rects.map((box) => box.bottom))),
        };
        if (rect.x1 - rect.x0 < 1 || rect.y1 - rect.y0 < 1) return null;
      }

      const cssColour = placeholder ? getComputedStyle(element, "::placeholder").color : getComputedStyle(element).color;
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext("2d");
      context.fillStyle = cssColour;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
      let opacity = 1;
      for (let node = element; node; node = node.parentElement) {
        const value = parseFloat(getComputedStyle(node).opacity);
        opacity *= Number.isFinite(value) ? value : 1;
      }

      element.setAttribute(probe, "");
      if (!document.getElementById("render-contrast-style")) {
        const style = document.createElement("style");
        style.id = "render-contrast-style";
        style.textContent =
          `[${probe}], [${probe}] * { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; }` +
          `[${probe}]::placeholder { color: transparent !important; -webkit-text-fill-color: transparent !important; }`;
        document.head.appendChild(style);
      }
      const x = Math.max(0, Math.floor(rect.x0));
      const y = Math.max(0, Math.floor(rect.y0));
      return {
        clip: {
          x,
          y,
          width: Math.max(1, Math.min(window.innerWidth, Math.ceil(rect.x1)) - x),
          height: Math.max(1, Math.min(window.innerHeight, Math.ceil(rect.y1)) - y),
        },
        colour: [r, g, b, (a / 255) * opacity],
        text: (placeholder ? element.getAttribute("placeholder") : element.textContent).trim().slice(0, 48),
      };
    },
    { target, chat: CHAT, probe: PROBE },
  );
}

async function measureText(page, target) {
  const probe = await locateProbe(page, target);
  if (!probe) return { id: target.id, label: target.label, missing: true };
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const { data, info } = await photograph(page, probe.clip);
  await page.evaluate((probe) => {
    for (const node of document.querySelectorAll(`[${probe}]`)) node.removeAttribute(probe);
  }, PROBE);
  const [tr, tg, tb, ta] = probe.colour;
  const ratios = [];
  for (let index = 0; index < data.length; index += info.channels) {
    const ground = [data[index], data[index + 1], data[index + 2]];
    const ink = [tr * ta + ground[0] * (1 - ta), tg * ta + ground[1] * (1 - ta), tb * ta + ground[2] * (1 - ta)];
    ratios.push(contrast(ink, ground));
  }
  ratios.sort((a, b) => a - b);
  return {
    id: target.id,
    label: target.label,
    text: probe.text,
    colour: probe.colour.map((value, index) => (index === 3 ? Number(value.toFixed(3)) : value)),
    worst: Number(ratios[0].toFixed(2)),
    median: Number(ratios[Math.floor(ratios.length / 2)].toFixed(2)),
  };
}

/** Where each surface is sampled: a few pixels of it that carry no text. */
async function swatchRects(page) {
  return page.evaluate(
    ({ own, incoming }) => {
      const bubble = (isOwn, text) =>
        [...document.querySelectorAll(`[data-message-bubble="true"][data-message-own="${isOwn}"]`)]
          .filter((node) => node.textContent.includes(text))
          .at(-1) ?? null;
      const rects = {};
      const ownBox = bubble(true, own)?.getBoundingClientRect();
      const inBox = bubble(false, incoming)?.getBoundingClientRect();
      if (ownBox) {
        // Beside the reader's own bubble, which leaves the start of the row to the ground.
        rects.ground = { x: Math.max(4, ownBox.left - 40), y: ownBox.top + ownBox.height / 2 - 2, width: 16, height: 4 };
        // The bubble's top padding, over its middle: no text and no rounded corner.
        rects["bubble-own"] = { x: ownBox.left + ownBox.width / 2 - 10, y: ownBox.top + 2, width: 20, height: 3 };
      }
      if (inBox) rects["bubble-in"] = { x: inBox.left + inBox.width / 2 - 10, y: inBox.top + 2, width: 20, height: 3 };
      const row = document.querySelector('[data-testid="chat-control-row"]');
      const info = document.querySelector('[data-testid="chat-header-info-button"]');
      if (row && info) {
        const rowBox = row.getBoundingClientRect();
        const infoBox = info.getBoundingClientRect();
        rects.header =
          getComputedStyle(row).display === "grid"
            ? { x: infoBox.left + infoBox.width / 2 - 8, y: infoBox.top + 3, width: 16, height: 3 }
            : { x: rowBox.left + rowBox.width * 0.72, y: rowBox.top + 3, width: 16, height: 4 };
        if (rowBox.top >= 30) rects["status-bar"] = { x: 12, y: rowBox.top - 42, width: 24, height: 8 };
      }
      const textarea = document.querySelector('[data-testid="chat-composer-dock"] textarea');
      if (textarea) {
        const box = textarea.getBoundingClientRect();
        rects["composer-field"] = { x: box.right - 40, y: box.top + 3, width: 16, height: 3 };
        const rowBox = textarea.parentElement.getBoundingClientRect();
        rects["composer-band"] = { x: rowBox.left + rowBox.width / 2 - 12, y: rowBox.top - 6, width: 24, height: 3 };
      }
      return rects;
    },
    { own: OWN_PROBE, incoming: IN_PROBE },
  );
}

async function measureSwatches(page) {
  const rects = await swatchRects(page);
  const found = {};
  for (const swatch of SWATCHES) {
    const rect = rects[swatch.id];
    if (!rect) continue;
    const { data, info } = await photograph(page, rect);
    const channels = [[], [], []];
    for (let index = 0; index < data.length; index += info.channels) {
      for (let channel = 0; channel < 3; channel += 1) channels[channel].push(data[index + channel]);
    }
    found[swatch.id] = channels.map((values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]);
  }
  return SWATCHES.map((swatch) => {
    const rgb = found[swatch.id];
    if (!rgb) return { id: swatch.id, label: swatch.label, missing: true };
    return {
      id: swatch.id,
      label: swatch.label,
      rgb,
      hue: hue(rgb),
      againstGround: found.ground ? Number(contrast(rgb, found.ground).toFixed(2)) : null,
    };
  });
}

/** Rule 7's worst field under the chrome: every message hidden, the scroller painted solid. */
async function paintWorstField(page, theme) {
  await page.addStyleTag({
    content:
      `.chat-bg { background: ${theme === "dark" ? "#FFFFFF" : "#000000"} !important; }` +
      "[data-message-row=\"true\"], [data-message-id], [data-message-date-separator], [data-system-message] { visibility: hidden !important; }",
  });
  await page.waitForTimeout(300);
  await settle(page);
}

// ── what Chromium does not draw ─────────────────────────────────────────────

/**
 * The status bar, the Dynamic Island and the home indicator of an iPhone Pro
 * Max, drawn over the page for scale. The glyphs are white over the dark theme;
 * over the light theme they are dark, which is what the owner's own screenshots
 * show iOS doing there.
 */
async function drawDeviceChrome(page, theme) {
  await page.evaluate((theme) => {
    const ink = theme === "dark" ? "#FFFFFF" : "#000000";
    const layer = document.createElement("div");
    layer.id = "render-device-chrome";
    layer.setAttribute("aria-hidden", "true");
    layer.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none";
    layer.innerHTML =
      '<div style="position:absolute;left:152px;top:11px;width:126px;height:37px;border-radius:19px;background:#000"></div>' +
      `<div style="position:absolute;left:0;top:0;width:152px;height:59px;display:flex;align-items:center;justify-content:center;font:600 17px/1 Inter,-apple-system,sans-serif;letter-spacing:-0.2px;color:${ink}">18:00</div>` +
      `<svg style="position:absolute;left:318px;top:23px" width="80" height="14" viewBox="0 0 80 14" fill="${ink}">` +
      '<rect x="0" y="9" width="3" height="4" rx="0.8"/><rect x="5" y="6" width="3" height="7" rx="0.8"/><rect x="10" y="3" width="3" height="10" rx="0.8"/><rect x="15" y="0" width="3" height="13" rx="0.8"/>' +
      '<path d="M30 4.6a9.5 9.5 0 0 1 13 0l-1.5 1.6a7.3 7.3 0 0 0-10 0z M33 7.6a5.5 5.5 0 0 1 7 0l-1.6 1.6a3.3 3.3 0 0 0-3.8 0z M36.5 13l-2-2.1a2.8 2.8 0 0 1 4 0z"/>' +
      `<rect x="52" y="0.5" width="24" height="12.5" rx="3.8" fill="none" stroke="${ink}" stroke-opacity="0.45"/>` +
      '<rect x="54" y="2.5" width="18" height="8.5" rx="2.2"/><path d="M77.5 4.8v3.9a2 2 0 0 0 0-3.9z" fill-opacity="0.45"/></svg>' +
      `<div style="position:absolute;left:148px;bottom:8px;width:134px;height:5px;border-radius:3px;background:${ink}"></div>`;
    document.body.appendChild(layer);
  }, theme);
}

async function removeDeviceChrome(page) {
  await page.evaluate(() => document.getElementById("render-device-chrome")?.remove());
}

// ── one frame ───────────────────────────────────────────────────────────────

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
  });
  await context.route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname;
    return ALLOWED_HOSTS.has(host) ? route.continue() : route.abort();
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

  // Always set — zero where the device has none — so the engine's own env()
  // is what every surface reads, on every frame.
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: device.insets ?? { top: 0, right: 0, bottom: 0, left: 0 } });
  await page.clock.setFixedTime(CLOCK);
  await page.addInitScript(
    ({ key, fixture, theme, optionKey, option, standalone }) => {
      if (standalone) {
        try {
          Object.defineProperty(Navigator.prototype, "standalone", { configurable: true, get: () => true });
        } catch {
          /* the media query below still answers */
        }
        const native = window.matchMedia.bind(window);
        const displayMode = /\(\s*display-mode\s*:\s*([a-z-]+)\s*\)/i;
        window.matchMedia = (query) => {
          const mode = displayMode.exec(String(query));
          if (!mode) return native(query);
          return {
            matches: mode[1].toLowerCase() === "standalone",
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
      window[key] = fixture;
      localStorage.setItem("kub-theme", theme);
      localStorage.setItem(optionKey, option);
    },
    { key: WINDOW_KEY, fixture: FIXTURE, theme: frame.theme, optionKey: OPTION_KEY, option: frame.option, standalone: device.standalone },
  );

  await page.goto(`${BASE}${CAPTURE_PATH}`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-public-preview-ready="true"]').waitFor({ state: "attached", timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  const inter = await page.evaluate(() => document.fonts.check("16px Inter"));
  await assertConditions(page, frame);
  // Past the entry lock and its settle passes, which would otherwise pull a
  // conversation scrolled for the frame back to the bottom.
  await page.waitForTimeout(4_700);
  await STATES[frame.state](tools(page));
  await settle(page);

  const result = { id: frame.id, inter, errors, text: null, worst: null, surfaces: null };
  const measured = frame.device === "iphone" && frame.state === "rest";
  if (measured) {
    result.text = [];
    for (const target of TARGETS) result.text.push(await measureText(page, target));
    result.surfaces = await measureSwatches(page);
    // Where the chrome is, in points, so the geometry around the island is
    // stated from the layout rather than read off a picture.
    result.geometry = await page.evaluate(() => {
      const box = (node) => {
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
      };
      const find = (selector) => document.querySelector(selector);
      const pinned = [...document.querySelectorAll('[data-testid="chat-chrome-stack"] [role="button"]')].find((node) =>
        node.textContent.includes("Закреплённое сообщение"),
      );
      return {
        chromeStack: box(find('[data-testid="chat-chrome-stack"]')),
        controlRow: box(find('[data-testid="chat-control-row"]')),
        back: box(find('[data-testid="chat-control-row"] [aria-label="Назад"]')),
        title: box(find('[data-testid="chat-header-info-button"]')),
        menu: box(find('[data-testid="chat-control-row"] [aria-label="Ещё"]')),
        pinned: box(pinned?.parentElement ?? null),
        composerDock: box(find('[data-testid="chat-composer-dock"]')),
        attach: box(find('[data-testid="chat-composer-dock"] [aria-label="Прикрепить"]')),
        field: box(find('[data-testid="chat-composer-dock"] textarea')),
        recorder: box(find('[data-testid="composer-recorder-button"]')),
      };
    });
  }

  if (frame.device === "iphone") await drawDeviceChrome(page, frame.theme);
  await page.screenshot({ path: path.join(FRAMES_DIR, `${frame.id}.png`), animations: "disabled" });
  if (frame.device === "iphone") await removeDeviceChrome(page);

  if (measured) {
    await paintWorstField(page, frame.theme);
    result.worst = [];
    for (const target of WORST_TARGETS) result.worst.push(await measureText(page, target));
  }
  await context.close();
  writeFileSync(path.join(MEASUREMENTS_DIR, `${frame.id}.json`), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

// ── the sheets ──────────────────────────────────────────────────────────────

const escapeHtml = (value) =>
  String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
const frameSrc = (id) => (existsSync(path.join(FRAMES_DIR, `${id}.png`)) ? `frames/${id}.png` : null);

function readResult(id) {
  const file = path.join(MEASUREMENTS_DIR, `${id}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

const entryFor = (theme, option, key, id) => readResult(`${theme}-${option}-iphone-rest`)?.[key]?.find((item) => item.id === id);

function textTable(theme, key, title) {
  const rows = (key === "text" ? TARGETS : WORST_TARGETS).map((target) => {
    const cells = OPTIONS.map((option) => {
      const entry = entryFor(theme, option.id, key, target.id);
      if (!entry) return "<td>—</td>";
      if (entry.missing) return '<td class="muted">нет на экране</td>';
      return `<td class="${entry.worst >= 4.5 ? "pass" : "fail"}">${entry.worst.toFixed(2)}<span> / ${entry.median.toFixed(2)}</span></td>`;
    }).join("");
    return `<tr><th>${escapeHtml(target.label)}</th>${cells}</tr>`;
  });
  return `<h3>${escapeHtml(title)}</h3><table><thead><tr><th></th>${OPTIONS.map((option) => `<th>${escapeHtml(option.title)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

function surfaceTable(theme) {
  const rows = SWATCHES.map((swatch) => {
    const cells = OPTIONS.map((option) => {
      const entry = entryFor(theme, option.id, "surfaces", swatch.id);
      if (!entry || entry.missing) return "<td>—</td>";
      const [r, g, b] = entry.rgb;
      return `<td><i style="background:rgb(${r},${g},${b})"></i>rgb(${r}, ${g}, ${b})<span> · тон ${entry.hue ?? "—"}° · ${entry.againstGround?.toFixed(2)}:1 к фону</span></td>`;
    }).join("");
    return `<tr><th>${escapeHtml(swatch.label)}</th>${cells}</tr>`;
  });
  return `<h3>Поверхности, сфотографированные</h3><table class="surfaces"><thead><tr><th></th>${OPTIONS.map((option) => `<th>${escapeHtml(option.title)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

function sheetHtml(theme) {
  const tile = (id, caption, width) => {
    const src = frameSrc(id);
    return `<figure style="width:${width}px">${src ? `<img src="${src}" style="width:${width}px">` : '<div class="missing">кадра нет</div>'}<figcaption>${caption}</figcaption></figure>`;
  };
  const crop = (id, caption) => {
    const src = frameSrc(id);
    return `<figure style="width:700px"><div class="crop">${src ? `<img src="${src}" style="width:700px">` : ""}</div><figcaption>${caption}</figcaption></figure>`;
  };
  const row = (device, state, width) =>
    OPTIONS.map((option) => tile(`${theme.id}-${option.id}-${device}-${state}`, `<b>${escapeHtml(option.title)}</b>`, width)).join("");
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>
    body { margin: 0; padding: 36px 40px 48px; background: #e9eef4; font: 15px/1.45 Inter, "Segoe UI", sans-serif; color: #10233b; width: 1560px; }
    h1 { margin: 0 0 8px; font-size: 26px; }
    h2 { margin: 36px 0 14px; font-size: 19px; }
    h3 { margin: 22px 0 8px; font-size: 16px; }
    .lede { margin: 0; max-width: 1480px; color: #3a4f66; }
    .options { display: grid; grid-template-columns: repeat(4, 360px); gap: 24px; margin-top: 18px; }
    .options p { margin: 4px 0 0; font-size: 13.5px; color: #3a4f66; }
    .grid { display: grid; gap: 22px 24px; }
    .cols-4 { grid-template-columns: repeat(4, 360px); }
    .cols-2 { grid-template-columns: repeat(2, 740px); }
    .crops { grid-template-columns: repeat(2, 700px); }
    figure { margin: 0; }
    img { display: block; border-radius: 12px; box-shadow: 0 1px 0 #c3cfdc, 0 6px 18px rgba(16, 35, 59, 0.14); }
    .crop { height: 470px; overflow: hidden; border-radius: 12px; box-shadow: 0 1px 0 #c3cfdc, 0 6px 18px rgba(16, 35, 59, 0.14); }
    .crop img { border-radius: 0; box-shadow: none; }
    figcaption { margin-top: 8px; font-size: 13.5px; }
    .missing { height: 200px; display: grid; place-items: center; background: #d5dde7; border-radius: 12px; }
    table { border-collapse: collapse; background: #fff; border-radius: 10px; overflow: hidden; }
    th, td { padding: 7px 14px; border-bottom: 1px solid #e3e9f0; text-align: left; font-size: 14px; }
    thead th { background: #f3f6fa; }
    td span { color: #6a7d92; font-size: 12px; }
    td.pass { color: #1f6b35; font-weight: 600; }
    td.fail { color: #b3261e; font-weight: 700; }
    td.muted { color: #6a7d92; }
    table.surfaces td { font-size: 13px; white-space: nowrap; }
    table.surfaces i { display: inline-block; width: 14px; height: 14px; margin-right: 6px; border-radius: 4px; vertical-align: -2px; box-shadow: inset 0 0 0 1px rgba(16, 35, 59, 0.25); }
    .note { margin-top: 8px; font-size: 13px; color: #3a4f66; }
  </style></head><body>
    <h1>LETSCUBE — экран чата на iPhone: сейчас и три варианта · ${escapeHtml(theme.title)}</h1>
    <p class="lede">Настоящие компоненты приложения на DEV-маршруте, вымышленная переписка. iPhone Pro Max 430×932 ×3, отступы безопасной зоны 59 и 34 заданы внутри движка, режим установленного приложения. Статус-бар, Dynamic Island и полоска «домой» дорисованы поверх кадра для масштаба — эмулятор их не рисует.</p>
    <div class="options">${OPTIONS.map((option) => `<div><b>${escapeHtml(option.title)}</b><p>${escapeHtml(option.note)}</p></div>`).join("")}</div>
    <h2>iPhone — чат в покое</h2>
    <div class="grid cols-4">${row("iphone", "rest", 360)}</div>
    <h2>Верх экрана у Dynamic Island, крупно</h2>
    <div class="grid crops">${OPTIONS.map((option) => crop(`${theme.id}-${option.id}-iphone-rest`, `<b>${escapeHtml(option.title)}</b>`)).join("")}</div>
    <h2>Касание сообщения — меню действий</h2>
    <div class="grid cols-4">${row("iphone", "message-menu", 360)}</div>
    <h2>Меню «Ещё» в шапке</h2>
    <div class="grid cols-4">${row("iphone", "header-menu", 360)}</div>
    <h2>Проверка: Android 390×844, без вырезов</h2>
    <div class="grid cols-4">${row("android", "rest", 360)}</div>
    <h2>Проверка: компьютер 1440×900, две панели</h2>
    <div class="grid cols-2">${row("desktop", "rest", 740)}</div>
    <h2>Цвет и контраст, сфотографированные</h2>
    <p class="note">Текст: худший пиксель / медиана, порог 4,5:1 — текст сделан прозрачным, фон под ним сфотографирован, цвет текста наложен на каждый пиксель. Поверхности: медиана нескольких пикселей без текста, её тон и контраст к фону переписки.</p>
    ${surfaceTable(theme.id)}
    ${textTable(theme.id, "text", "Текст над перепиской в покое")}
    ${textTable(theme.id, "worst", theme.id === "dark" ? "Текст на хроме над худшим фоном: сплошной белый под стеклом" : "Текст на хроме над худшим фоном: сплошной чёрный под стеклом")}
  </body></html>`;
}

function measurementsMarkdown() {
  const lines = [
    "# Chat chrome options, measured from photographed pixels",
    "",
    "iPhone 430×932 at rest. Text: worst pixel / median, threshold 4.5:1. Surfaces: median rgb, hue, contrast against the conversation ground.",
    "",
  ];
  for (const theme of THEMES) {
    const geometry = (option) => readResult(`${theme.id}-${option.id}-iphone-rest`)?.geometry ?? null;
    const span = (rect) => (rect ? `${rect.y}–${rect.y + rect.height} (${rect.height})` : "—");
    const size = (rect) => (rect ? `${rect.width}×${rect.height} at ${rect.x},${rect.y}` : "—");
    lines.push(`## ${theme.id}: geometry, in points`, "", `| | ${OPTIONS.map((option) => option.id).join(" | ")} |`, `|---|${OPTIONS.map(() => "---").join("|")}|`);
    for (const [label, render] of [
      ["chrome stack", (g) => span(g?.chromeStack)],
      ["control row", (g) => span(g?.controlRow)],
      ["back", (g) => size(g?.back)],
      ["title", (g) => size(g?.title)],
      ["menu", (g) => size(g?.menu)],
      ["pinned", (g) => size(g?.pinned)],
      ["composer dock", (g) => span(g?.composerDock)],
      ["attach", (g) => size(g?.attach)],
      ["field", (g) => size(g?.field)],
      ["recorder", (g) => size(g?.recorder)],
    ]) {
      lines.push(`| ${label} | ${OPTIONS.map((option) => render(geometry(option))).join(" | ")} |`);
    }
    lines.push("");
    lines.push(`## ${theme.id}: surfaces`, "", `| | ${OPTIONS.map((option) => option.id).join(" | ")} |`, `|---|${OPTIONS.map(() => "---").join("|")}|`);
    for (const swatch of SWATCHES) {
      const cells = OPTIONS.map((option) => {
        const entry = entryFor(theme.id, option.id, "surfaces", swatch.id);
        if (!entry || entry.missing) return "—";
        return `rgb(${entry.rgb.join(",")}) ${entry.hue ?? "—"}° ${entry.againstGround?.toFixed(2)}:1`;
      });
      lines.push(`| ${swatch.id} | ${cells.join(" | ")} |`);
    }
    lines.push("");
    for (const [key, title] of [
      ["text", "text over the conversation at rest"],
      ["worst", theme.id === "dark" ? "chrome text over a solid white field" : "chrome text over a solid black field"],
    ]) {
      lines.push(`## ${theme.id}: ${title}`, "", `| | ${OPTIONS.map((option) => option.id).join(" | ")} |`, `|---|${OPTIONS.map(() => "---").join("|")}|`);
      for (const target of key === "text" ? TARGETS : WORST_TARGETS) {
        const cells = OPTIONS.map((option) => {
          const entry = entryFor(theme.id, option.id, key, target.id);
          if (!entry) return "—";
          if (entry.missing) return "not on screen";
          return `${entry.worst.toFixed(2)} / ${entry.median.toFixed(2)}${entry.worst < 4.5 ? " ✗" : ""}`;
        });
        lines.push(`| ${target.id} | ${cells.join(" | ")} |`);
      }
      lines.push("");
    }
  }
  return `${lines.join("\n")}\n`;
}

async function buildSheets(browser) {
  writeFileSync(path.join(OUT, "measurements.md"), measurementsMarkdown());
  for (const theme of THEMES) {
    const html = sheetHtml(theme);
    const file = path.join(OUT, `sheet-${theme.id}.html`);
    writeFileSync(file, html);
    const page = await browser.newPage({ viewport: { width: 1640, height: 1200 } });
    await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
    await page.screenshot({ path: path.join(OUT, `sheet-${theme.id}.png`), fullPage: true });
    await page.close();
    console.log(`sheet: ${path.relative(ROOT, path.join(OUT, `sheet-${theme.id}.png`))}`);
  }
}

async function main() {
  mkdirSync(FRAMES_DIR, { recursive: true });
  mkdirSync(MEASUREMENTS_DIR, { recursive: true });
  // The full Chromium build, not Playwright's default headless shell. The shell
  // paints `backdrop-filter` over ordinary content but not over the contents of
  // a scrolling container, and that is exactly where this conversation lives:
  // measured on this machine, text inside a scroller stayed crisp under a
  // blur(20px) sheet in the shell and was frosted in the full build. Taken in
  // the shell, every glass surface here reads as a flat tint over legible
  // messages — not what an iPhone draws, and not what the owner should judge.
  const browser = await chromium.launch({ channel: "chromium" });
  const failures = [];
  try {
    if (!sheetsOnly) {
      await assertFixtureServer();
      for (const frame of FRAMES) {
        if (only && !only.has(frame.id)) continue;
        try {
          const result = await renderFrame(browser, frame);
          const low = [...(result.text ?? []), ...(result.worst ?? [])].filter((entry) => !entry.missing && entry.worst < 4.5);
          const missing = [...(result.text ?? []), ...(result.worst ?? []), ...(result.surfaces ?? [])].filter((entry) => entry.missing);
          console.log(
            `${frame.id}: ok${result.inter ? "" : " (Inter did not load)"}` +
              `${result.errors.length ? ` errors: ${JSON.stringify(result.errors)}` : ""}` +
              `${low.length ? ` under 4.5: ${low.map((entry) => `${entry.id}=${entry.worst}`).join(", ")}` : ""}` +
              `${missing.length ? ` not found: ${missing.map((entry) => entry.id).join(", ")}` : ""}`,
          );
        } catch (error) {
          failures.push(frame.id);
          console.error(`${frame.id}: FAILED ${error instanceof Error ? error.message.split("\n")[0] : error}`);
        }
      }
    }
    await buildSheets(browser);
    const unused = readdirSync(FRAMES_DIR).filter((name) => !FRAMES.some((frame) => `${frame.id}.png` === name));
    if (unused.length) console.log(`frames not in this script's list: ${unused.join(", ")}`);
  } finally {
    await browser.close();
  }
  if (failures.length) process.exitCode = 1;
}

await main();
