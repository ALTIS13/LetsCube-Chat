#!/usr/bin/env node
/**
 * Renders the chat screen as the owner chose it on 2026-09-11 — option C,
 * «Капсулы и цвет» — on every shell: the installed iPhone app, an Android
 * phone, the web app's two panes on a desktop, and the Windows app's frame with
 * its own window buttons. And LETSCUBE's wallpaper pattern at 1:1.
 *
 * Every frame is the real application on the DEV preview route, over a
 * fictional, checked-in private conversation. Nothing on a network is reached:
 * every request off this machine and the font host is aborted, and a server
 * that is not on the fixture configuration is refused.
 *
 * The iPhone is Chromium at 430x932 and three device pixels per point, with the
 * safe areas overridden inside the engine — `Emulation.setSafeAreaInsetsOverride`,
 * so `env()` itself reports 59 and 34 — and `navigator.standalone` and
 * `(display-mode: standalone)` answered as the home-screen app answers them.
 * Chromium draws no status bar, Dynamic Island or home indicator, so those are
 * drawn over the iPhone frames after everything is measured, and the sheets say
 * so. The Windows app is the same page with the desktop bridge stubbed, which
 * is what makes `AppTopBar` draw the window's minimise, maximise and close.
 *
 * It launches the full Chromium build, not Playwright's headless shell: the
 * shell does not paint `backdrop-filter` over the contents of a scrolling
 * container, which is where the conversation lives.
 *
 * Measured from photographed pixels, as rule 7 of
 * docs/operations/interface-material.md asks, on every frame at rest marked
 * `measure`:
 *
 *  - the text: made transparent, its backdrop photographed, the text colour
 *    composited over every pixel of that, the worst pixel reported. The chrome
 *    is measured twice — over the conversation at rest, and over the worst
 *    field a translucent surface can meet: solid white under the dark theme,
 *    solid black under the light one;
 *  - the surfaces: a few pixels of each, away from any text, with their hue and
 *    their step off the conversation's ground;
 *  - the geometry, and on the Windows frame how far the chat pane's capsules
 *    are from the window's own buttons (D-112), by layout and by hit test.
 *
 * It does not start a server. Point it at a dev server on the fixture
 * configuration (`VITE_SUPABASE_URL=http://127.0.0.1:54321`,
 * `VITE_PUBLIC_PREVIEW_FIXTURE=1`).
 *
 * Usage:
 *   KUB_BASE_URL=http://127.0.0.1:5293 node scripts/render-chat-chrome-frames.mjs
 *     [--only iphone-dark-rest,windows-dark-rest]   re-render some frames
 *     [--sheets]                                     only rebuild the sheets
 *   KUB_BEFORE_FRAMES_DIR=<frames of the 2026-09-11 assessment>  optional: puts
 *     the look before this change beside it on the sheets
 *
 * Writes output/renders/2026-09-12-chat-chrome-c/: frames/*.png,
 * measurements/*.json, measurements.md, and one sheet per platform.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const { chromium } = await import(
  pathToFileURL(path.join(ROOT, "node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs")).href
);

const BASE = process.env.KUB_BASE_URL ?? "";
const BEFORE_DIR = process.env.KUB_BEFORE_FRAMES_DIR ?? "";
const OUT = path.join(ROOT, "output", "renders", "2026-09-12-chat-chrome-c");
const FRAMES_DIR = path.join(OUT, "frames");
const MEASUREMENTS_DIR = path.join(OUT, "measurements");
const CAPTURE_PATH = "/__qa/public-preview";
const WINDOW_KEY = "__letscubePublicPreviewFixture";
const CLOCK = new Date("2026-09-11T18:00:00+03:00");
const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost", "fonts.googleapis.com", "fonts.gstatic.com"]);
/** The owner reads the sheets on a phone. */
const SHEET_MAX_HEIGHT = 2200;

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
 * The private chat of the 2026-09-11 assessment: yesterday's messages above a
 * date chip, one of them pinned, today's below it, a reaction, an edit and a
 * read receipt. The other chats carry 24 unread, which the back button counts.
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

const DEVICES = {
  iphone: {
    title: "iPhone Pro Max, установленное приложение",
    viewport: { width: 430, height: 932 },
    scale: 3,
    touch: true,
    insets: { top: 59, right: 0, bottom: 34, left: 0 },
    standalone: true,
    phone: true,
  },
  android: { title: "Android 390×844", viewport: { width: 390, height: 844 }, scale: 3, touch: true, insets: null, standalone: false, phone: true },
  desktop: { title: "Веб на компьютере 1440×900", viewport: { width: 1440, height: 900 }, scale: 1, touch: false, insets: null, standalone: false, phone: false },
  windows: {
    title: "Приложение Windows, окно 1360×860",
    viewport: { width: 1360, height: 860 },
    scale: 1,
    touch: false,
    insets: null,
    standalone: false,
    phone: false,
    windows: true,
  },
};

const STATES = {
  rest: async () => undefined,
  "message-menu": async (t) => {
    await t.center(MENU_TARGET, 0.55);
    await t.tapText(MENU_TARGET);
    await t.waitFor("[data-action-menu]");
  },
  "header-menu": async (t) => {
    const more = t.page.getByRole("button", { name: "Ещё" });
    if (t.device.touch) await more.tap();
    else await more.click();
    await t.waitFor('[role="menu"]');
  },
  /** A reply under way: the strip above the composer's capsules. */
  reply: async (t) => {
    await t.center(MENU_TARGET, 0.55);
    await t.tapText(MENU_TARGET);
    await t.waitFor("[data-action-menu]");
    // The menu's actions are menu items, named by the action they run.
    await t.page.locator('[data-action-menu] [data-message-action="reply"]').first().tap();
    await t.page.getByRole("button", { name: "Отменить ответ" }).waitFor({ state: "visible", timeout: 10_000 });
  },
};

const FRAMES = [
  { id: "iphone-dark-rest", device: "iphone", theme: "dark", state: "rest", measure: true },
  { id: "iphone-dark-message-menu", device: "iphone", theme: "dark", state: "message-menu" },
  { id: "iphone-light-rest", device: "iphone", theme: "light", state: "rest", measure: true },
  { id: "iphone-light-message-menu", device: "iphone", theme: "light", state: "message-menu" },
  { id: "iphone-dark-header-menu", device: "iphone", theme: "dark", state: "header-menu" },
  { id: "iphone-dark-reply", device: "iphone", theme: "dark", state: "reply" },
  { id: "iphone-light-reply", device: "iphone", theme: "light", state: "reply" },
  { id: "android-dark-rest", device: "android", theme: "dark", state: "rest", measure: true },
  { id: "android-dark-message-menu", device: "android", theme: "dark", state: "message-menu" },
  { id: "desktop-dark-rest", device: "desktop", theme: "dark", state: "rest", measure: true },
  { id: "desktop-light-rest", device: "desktop", theme: "light", state: "rest", measure: true },
  { id: "desktop-dark-header-menu", device: "desktop", theme: "dark", state: "header-menu" },
  { id: "windows-dark-rest", device: "windows", theme: "dark", state: "rest", measure: true },
];

/** Text measured on every frame marked `measure`. */
const TARGETS = [
  { id: "own-text", label: "Своё сообщение — текст", kind: "bubble-text", own: true, text: OWN_PROBE },
  { id: "own-time", label: "Своё сообщение — время", kind: "bubble-time", own: true, text: OWN_PROBE },
  { id: "in-text", label: "Входящее — текст", kind: "bubble-text", own: false, text: IN_PROBE },
  { id: "in-time", label: "Входящее — время", kind: "bubble-time", own: false, text: IN_PROBE },
  { id: "sender", label: "Имя над входящим", kind: "sender-name" },
  { id: "date-chip", label: "Дата «Сегодня»", kind: "date-chip", text: "Сегодня" },
  { id: "back-count", label: "«Назад» — счётчик", kind: "back-count" },
  { id: "header-name", label: "Шапка — имя", kind: "header-name" },
  { id: "header-status", label: "Шапка — статус", kind: "header-status" },
  { id: "pinned-label", label: "Закреп — заголовок", kind: "pinned-label" },
  { id: "pinned-text", label: "Закреп — текст", kind: "pinned-text" },
  { id: "placeholder", label: "Поле ввода — подсказка", kind: "placeholder" },
];

/** The chrome again, over the worst field a translucent surface can meet. */
const WORST_TARGETS = TARGETS.filter((target) =>
  ["back-count", "header-name", "header-status", "pinned-label", "pinned-text", "placeholder"].includes(target.id),
);

/** The surfaces photographed on every frame marked `measure`. */
const SWATCHES = [
  { id: "ground", label: "Фон переписки" },
  { id: "bubble-in", label: "Входящий пузырь" },
  { id: "bubble-own", label: "Свой пузырь" },
  { id: "date-chip", label: "Подложка даты" },
  { id: "status-bar", label: "Под статус-баром" },
  { id: "header", label: "Капсула с именем" },
  { id: "composer-field", label: "Капсула поля ввода" },
];

// ── driving a frame ─────────────────────────────────────────────────────────

function tools(page, device) {
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
    device,
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
    throw new Error("KUB_BASE_URL must be a loopback dev server, e.g. http://127.0.0.1:5293");
  }
  const client = await fetch(`${BASE}/src/lib/supabase/client.ts`).then((response) => response.text());
  if (!client.includes("127.0.0.1:54321")) throw new Error("The dev server is not on the fixture configuration.");
  const capture = await fetch(`${BASE}${CAPTURE_PATH}`);
  if (!capture.ok) throw new Error(`The capture route answered ${capture.status}.`);
}

/**
 * The page opened on the right terms, or an error saying which term is
 * missing: the theme, the installed app recognised where it should be and
 * nowhere else, the insets reaching the layout, the wallpaper's pattern
 * painted, the capsule row, the back button only where no chat list is beside
 * it, no trace of the retired DEV switch, and on the Windows frame the window's
 * own buttons. A frame taken without any of these would photograph something
 * other than what its caption says.
 */
async function assertConditions(page, frame) {
  const device = DEVICES[frame.device];
  const found = await page.evaluate(() => {
    const root = document.documentElement;
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;visibility:hidden;padding-top:var(--kub-safe-top);padding-bottom:var(--kub-safe-bottom)";
    document.body.appendChild(probe);
    const insets = { top: parseFloat(getComputedStyle(probe).paddingTop), bottom: parseFloat(getComputedStyle(probe).paddingBottom) };
    probe.remove();
    const row = document.querySelector('[data-testid="chat-control-row"]');
    const back = document.querySelector('[data-testid="chat-control-row"] [aria-label="Назад"]');
    const scroller = document.querySelector('[data-testid="message-scroll-container"]');
    return {
      theme: root.classList.contains("dark") ? "dark" : root.classList.contains("light") ? "light" : null,
      standalone: root.hasAttribute("data-ios-standalone"),
      insets,
      retiredSwitch: [...root.attributes].some((attribute) => attribute.name.startsWith("data-kub-chat-")),
      pattern: scroller ? getComputedStyle(scroller).backgroundImage.includes("data:image/svg+xml") : false,
      capsuleRow: row ? getComputedStyle(row).display === "grid" : false,
      backShown: back ? back.getBoundingClientRect().width > 0 : false,
      windowControls: Boolean(document.querySelector('[data-testid="desktop-window-controls"]')),
    };
  });
  const problems = [];
  if (found.theme !== frame.theme) problems.push(`theme ${found.theme}`);
  if (device.standalone !== found.standalone) problems.push(`standalone ${found.standalone}`);
  const insets = device.insets ?? { top: 0, bottom: 0 };
  if (found.insets.top !== insets.top || found.insets.bottom !== insets.bottom) problems.push(`insets ${JSON.stringify(found.insets)}`);
  if (found.retiredSwitch) problems.push("a data-kub-chat-* attribute of the retired DEV switch is on <html>");
  if (!found.pattern) problems.push("the conversation's scroller does not paint the pattern");
  if (!found.capsuleRow) problems.push("the header's control row is not the capsule grid");
  if (found.backShown !== device.phone) problems.push(`back button shown: ${found.backShown}`);
  if (found.windowControls !== Boolean(device.windows)) problems.push(`window controls: ${found.windowControls}`);
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
      } else if (target.kind === "back-count") {
        element =
          leaves(document.querySelector('[data-testid="chat-control-row"] [aria-label="Назад"]')).find((node) =>
            /^\d+\+?$/.test(node.textContent.trim()),
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
        // beside it. Only what the element shows counts.
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

/** Where each surface is sampled: a few pixels of it that carry no text and no rim. */
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
      // A chip in the open conversation, clear of the scroll edges: yesterday's
      // can be scrolled up under the status bar, where it samples the edge.
      const chrome = document.querySelector('[data-testid="chat-chrome-stack"]')?.getBoundingClientRect();
      const dock = document.querySelector('[data-testid="chat-composer-dock"]')?.getBoundingClientRect();
      const chip = [...document.querySelectorAll("[data-message-date-separator] > span")].find((node) => {
        const box = node.getBoundingClientRect();
        return box.height > 0 && (!chrome || box.top > chrome.bottom + 24) && (!dock || box.bottom < dock.top - 24);
      });
      if (chip) {
        const box = chip.getBoundingClientRect();
        rects["date-chip"] = { x: box.left + 4, y: box.top + box.height / 2 - 1, width: 4, height: 2 };
      }
      const row = document.querySelector('[data-testid="chat-control-row"]');
      const info = document.querySelector('[data-testid="chat-header-info-button"]');
      if (row && info) {
        const infoBox = info.getBoundingClientRect();
        rects.header = { x: infoBox.left + infoBox.width / 2 - 8, y: infoBox.top + 2, width: 16, height: 2 };
        // Only where the chat header is the top of the screen and pads a status
        // bar's inset out of itself; on a desktop the app's own top bar is there.
        const topBar = document.querySelector('[data-testid="app-top-bar"]');
        const rowBox = row.getBoundingClientRect();
        if (rowBox.top >= 30 && !(topBar instanceof HTMLElement && topBar.offsetHeight > 0)) {
          rects["status-bar"] = { x: 12, y: 18, width: 24, height: 8 };
        }
      }
      const textarea = document.querySelector('[data-testid="chat-composer-dock"] textarea');
      if (textarea) {
        const box = textarea.getBoundingClientRect();
        rects["composer-field"] = { x: box.right - 40, y: box.top + 3, width: 16, height: 3 };
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

/** Where the chrome is, in CSS pixels, stated from the layout rather than read off a picture. */
async function measureGeometry(page) {
  return page.evaluate(() => {
    const box = (node) => {
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return null;
      return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
    };
    const find = (selector) => document.querySelector(selector);
    const pinned = [...document.querySelectorAll('[data-testid="chat-chrome-stack"] [role="button"]')].find((node) =>
      node.textContent.includes("Закреплённое сообщение"),
    );
    const pane = box(find('[data-testid="chat-chrome-stack"]'));
    const title = box(find('[data-testid="chat-header-info-button"]'));
    return {
      pane,
      chromeStack: pane,
      controlRow: box(find('[data-testid="chat-control-row"]')),
      back: box(find('[data-testid="chat-control-row"] [aria-label="Назад"]')),
      title,
      titleOffCentre: pane && title ? Number((title.x + title.width / 2 - (pane.x + pane.width / 2)).toFixed(1)) : null,
      menu: box(find('[data-testid="chat-control-row"] [aria-label="Ещё"]')),
      pinned: box(pinned?.parentElement ?? null),
      composerDock: box(find('[data-testid="chat-composer-dock"]')),
      attach: box(find('[data-testid="chat-composer-dock"] [aria-label="Прикрепить"]')),
      field: box(find('[data-testid="chat-composer-dock"] textarea')),
      recorder: box(find('[data-testid="composer-recorder-button"]')),
    };
  });
}

/**
 * D-112: in the Windows app the window's own buttons sat over a page's top-right
 * controls and took their clicks. This asks the same two questions of the chat
 * pane — do the capsules' boxes meet the buttons' boxes, and does a click at
 * the middle of each capsule reach that capsule — and says how far apart they
 * are.
 */
async function measureWindowsClearance(page) {
  return page.evaluate(() => {
    const rectOf = (node) => {
      const rect = node.getBoundingClientRect();
      return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
    };
    const controls = document.querySelector('[data-testid="desktop-window-controls"]');
    const topBar = document.querySelector('[data-testid="app-top-bar"]');
    if (!controls || !topBar) return null;
    const zone = rectOf(controls);
    const capsules = [
      ["title", '[data-testid="chat-header-info-button"]'],
      ["menu", '[data-testid="chat-control-row"] [aria-label="Ещё"]'],
      ["pinned", '[data-testid="chat-chrome-stack"] [role="button"]'],
    ].map(([id, selector]) => {
      const node = document.querySelector(selector);
      if (!node) return { id, missing: true };
      const rect = rectOf(node);
      const overlapX = Math.max(0, Math.min(rect.x + rect.width, zone.x + zone.width) - Math.max(rect.x, zone.x));
      const overlapY = Math.max(0, Math.min(rect.y + rect.height, zone.y + zone.height) - Math.max(rect.y, zone.y));
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return {
        id,
        rect,
        overlapArea: overlapX * overlapY,
        gapBelowControls: rect.y - (zone.y + zone.height),
        centreReachesCapsule: Boolean(hit && node.contains(hit)),
      };
    });
    const buttons = [...controls.querySelectorAll("button")].map((button) => {
      const rect = rectOf(button);
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return { label: button.getAttribute("aria-label"), rect, centreReachesButton: Boolean(hit && button.contains(hit)) };
    });
    return { zone, topBar: rectOf(topBar), capsules, buttons };
  });
}

/** Outlines the window-button zone and the capsules for the annotated Windows frame. */
async function drawClearance(page, clearance) {
  await page.evaluate((clearance) => {
    const layer = document.createElement("div");
    layer.id = "render-clearance";
    layer.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none;font:600 12px/1 Inter,'Segoe UI',sans-serif";
    // Each label beside its own box, on a side where no other box or label is.
    const outline = ({ x, y, width, height }, colour, label, side) => {
      const box = document.createElement("div");
      box.style.cssText = `position:absolute;left:${x - 2}px;top:${y - 2}px;width:${width + 4}px;height:${height + 4}px;border:2px dashed ${colour};border-radius:6px`;
      const tag = document.createElement("div");
      tag.textContent = label;
      const place = side === "left" ? "right:100%;margin-right:6px;top:50%;transform:translateY(-50%)" : "top:100%;margin-top:4px;right:0";
      tag.style.cssText = `position:absolute;${place};white-space:nowrap;padding:3px 6px;border-radius:4px;background:${colour};color:#fff`;
      box.appendChild(tag);
      layer.appendChild(box);
    };
    outline(clearance.zone, "#E5484D", "Кнопки окна", "left");
    const sides = { title: "below", menu: "left", pinned: "below" };
    const names = { title: "Капсула с именем", menu: "«Ещё»", pinned: "Закреп" };
    for (const capsule of clearance.capsules) {
      if (capsule.missing) continue;
      outline(capsule.rect, "#30A46C", names[capsule.id], sides[capsule.id]);
    }
    document.body.appendChild(layer);
  }, clearance);
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

// ── one frame ───────────────────────────────────────────────────────────────

async function openPage(browser, deviceId, theme) {
  const device = DEVICES[deviceId];
  const context = await browser.newContext({
    viewport: device.viewport,
    deviceScaleFactor: device.scale,
    hasTouch: device.touch,
    isMobile: device.touch,
    colorScheme: theme,
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
    ({ key, fixture, theme, standalone, windows }) => {
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
      if (windows) {
        // What the Tauri shell hands the page: enough of the bridge for
        // `AppTopBar` to draw the window's own buttons, none of which does
        // anything here.
        const idle = async () => undefined;
        Object.defineProperty(window, "letscubeDesktop", {
          configurable: true,
          value: {
            platform: "windows",
            version: "0.2.14",
            build: 14,
            isMaximized: async () => false,
            minimize: idle,
            toggleMaximize: idle,
            closeToTray: idle,
            startDragging: idle,
            getRuntimeInfo: async () => ({ platform: "windows", version: "0.2.14", build: 14 }),
          },
        });
      }
      window[key] = fixture;
      localStorage.setItem("kub-theme", theme);
    },
    { key: WINDOW_KEY, fixture: FIXTURE, theme, standalone: device.standalone, windows: Boolean(device.windows) },
  );

  await page.goto(`${BASE}${CAPTURE_PATH}`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-public-preview-ready="true"]').waitFor({ state: "attached", timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  return { context, page, errors, device };
}

async function renderFrame(browser, frame) {
  const { context, page, errors, device } = await openPage(browser, frame.device, frame.theme);
  const inter = await page.evaluate(() => document.fonts.check("16px Inter"));
  await assertConditions(page, frame);
  // Past the entry lock and its settle passes, which would otherwise pull a
  // conversation scrolled for the frame back to the bottom.
  await page.waitForTimeout(4_700);
  await STATES[frame.state](tools(page, device));
  await settle(page);

  const result = { id: frame.id, frame, inter, errors, text: null, worst: null, surfaces: null, geometry: null, clearance: null };
  if (frame.measure) {
    result.text = [];
    for (const target of TARGETS) result.text.push(await measureText(page, target));
    result.surfaces = await measureSwatches(page);
    result.geometry = await measureGeometry(page);
    if (device.windows) result.clearance = await measureWindowsClearance(page);
  }

  if (frame.device === "iphone") await drawDeviceChrome(page, frame.theme);
  await page.screenshot({ path: path.join(FRAMES_DIR, `${frame.id}.png`), animations: "disabled" });
  await page.evaluate(() => document.getElementById("render-device-chrome")?.remove());

  if (result.clearance) {
    await drawClearance(page, result.clearance);
    await page.screenshot({ path: path.join(FRAMES_DIR, `${frame.id}-clearance.png`), animations: "disabled" });
    await page.evaluate(() => document.getElementById("render-clearance")?.remove());
  }

  if (frame.measure) {
    await paintWorstField(page, frame.theme);
    result.worst = [];
    for (const target of WORST_TARGETS) result.worst.push(await measureText(page, target));
  }
  await context.close();
  writeFileSync(path.join(MEASUREMENTS_DIR, `${frame.id}.json`), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

/**
 * The wallpaper at 1:1, in both themes, as the application paints it: the
 * conversation's scroller photographed with everything in front of it hidden.
 * And one tile of the pattern, enlarged and drawn at full strength, so the
 * motifs can be told apart.
 */
async function renderPattern(browser) {
  const clips = {};
  let tileSvg = null;
  for (const theme of ["dark", "light"]) {
    const { context, page } = await openPage(browser, "desktop", theme);
    await page.addStyleTag({
      content:
        '[data-testid="chat-chrome-stack"], [data-testid="chat-composer-dock"], [data-message-id], [data-message-date-separator], [data-message-history-status] { visibility: hidden !important; }' +
        ".kub-chat-chrome-stack::before, .kub-chat-composer-dock::before { display: none !important; }",
    });
    await page.waitForTimeout(400);
    const box = await page.locator('[data-testid="message-scroll-container"]').boundingBox();
    if (!box) throw new Error("no conversation scroller to photograph");
    const clip = { x: Math.round(box.x + 40), y: Math.round(box.y + 180), width: 640, height: 480 };
    const file = path.join(FRAMES_DIR, `pattern-${theme}-1to1.png`);
    await page.screenshot({ path: file, clip, animations: "disabled" });
    clips[theme] = file;
    if (!tileSvg) {
      const token = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--kub-chat-pattern"));
      const encoded = token.trim().replace(/^url\("?data:image\/svg\+xml,/, "").replace(/"?\)$/, "");
      tileSvg = decodeURIComponent(encoded);
    }
    await context.close();
  }
  const ink = tileSvg.replace(/stroke='[^']*'/, "stroke='#1B2A6B'").replace(/stroke-opacity='[^']*'/, "stroke-opacity='1'");
  const tile = await sharp(Buffer.from(ink), { density: 288 }).resize(480, 480).flatten({ background: "#F4F6FB" }).png().toBuffer();
  await sharp(tile).toFile(path.join(FRAMES_DIR, "pattern-tile-x3.png"));

  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>
    body { margin: 0; padding: 28px 32px 32px; background: #e9eef4; font: 15px/1.45 Inter, "Segoe UI", sans-serif; color: #10233b; width: 1824px; }
    h1 { margin: 0 0 6px; font-size: 24px; }
    p { margin: 0 0 18px; color: #3a4f66; max-width: 1760px; }
    .row { display: flex; gap: 32px; align-items: flex-start; }
    figure { margin: 0; }
    img { display: block; }
    figcaption { margin-top: 8px; font-size: 14px; }
  </style></head><body>
    <h1>Узор LETSCUBE — 1:1</h1>
    <p>Куб, сообщение, галочка задачи, метка на карте и ключ, маленький куб и точки. Плитка 160×160, линия 1,6 px одним цветом при непрозрачности 10–11 %, поверх трёх пятен фирменных оттенков и вертикального градиента. Ни одна фигура не пересекает край плитки, поэтому узор повторяется без шва. Слева и в центре — фон переписки, как его рисует приложение, пиксель в пиксель; справа — одна плитка ×3 в полную силу, чтобы разглядеть мотивы.</p>
    <div class="row">
      <figure><img src="frames/pattern-dark-1to1.png" width="640" height="480"><figcaption>Тёмная тема, 1:1</figcaption></figure>
      <figure><img src="frames/pattern-light-1to1.png" width="640" height="480"><figcaption>Светлая тема, 1:1</figcaption></figure>
      <figure><img src="frames/pattern-tile-x3.png" width="480" height="480"><figcaption>Одна плитка ×3, линии в полную силу</figcaption></figure>
    </div>
  </body></html>`;
  const file = path.join(OUT, "pattern.html");
  writeFileSync(file, html);
  const page = await browser.newPage({ viewport: { width: 1888, height: 700 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
  await page.screenshot({ path: path.join(FRAMES_DIR, "pattern-1to1.png"), fullPage: true });
  await page.close();
  return clips;
}

// ── the sheets ──────────────────────────────────────────────────────────────

const escapeHtml = (value) =>
  String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
const frameSrc = (name) => (existsSync(path.join(FRAMES_DIR, name)) ? `frames/${name}` : null);
const beforeSrc = (name) => (existsSync(path.join(OUT, "before", name)) ? `before/${name}` : null);

function readResult(id) {
  const file = path.join(MEASUREMENTS_DIR, `${id}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

/** The look before this change, from the assessment's renders, when they are given. */
function copyBeforeFrames() {
  if (!BEFORE_DIR || !existsSync(BEFORE_DIR)) return;
  mkdirSync(path.join(OUT, "before"), { recursive: true });
  for (const name of [
    "dark-current-iphone-rest.png",
    "light-current-iphone-rest.png",
    "dark-current-android-rest.png",
    "dark-current-desktop-rest.png",
    "light-current-desktop-rest.png",
  ]) {
    const source = path.join(BEFORE_DIR, name);
    if (existsSync(source)) copyFileSync(source, path.join(OUT, "before", name));
  }
}

const SHEET_STYLE = `
  body { margin: 0; padding: 28px 32px 36px; background: #e9eef4; font: 15px/1.45 Inter, "Segoe UI", sans-serif; color: #10233b; width: 1376px; }
  h1 { margin: 0 0 6px; font-size: 24px; }
  h2 { margin: 26px 0 12px; font-size: 18px; }
  .lede { margin: 0; color: #3a4f66; }
  .grid { display: grid; gap: 18px 16px; align-items: start; }
  figure { margin: 0; }
  img { display: block; width: 100%; border-radius: 10px; box-shadow: 0 1px 0 #c3cfdc, 0 6px 18px rgba(16, 35, 59, 0.14); }
  figcaption { margin-top: 7px; font-size: 13.5px; }
  figcaption span { color: #6a7d92; }
  .missing { height: 180px; display: grid; place-items: center; background: #d5dde7; border-radius: 10px; color: #6a7d92; }
  .crop { overflow: hidden; border-radius: 10px; box-shadow: 0 1px 0 #c3cfdc, 0 6px 18px rgba(16, 35, 59, 0.14); }
  .crop img { border-radius: 0; box-shadow: none; }
  table { border-collapse: collapse; background: #fff; border-radius: 10px; overflow: hidden; width: 100%; }
  th, td { padding: 6px 12px; border-bottom: 1px solid #e3e9f0; text-align: left; font-size: 13.5px; }
  thead th { background: #f3f6fa; }
  td span { color: #6a7d92; font-size: 12px; }
  td.pass { color: #1f6b35; font-weight: 600; }
  td.fail { color: #b3261e; font-weight: 700; }
  .note { margin-top: 8px; font-size: 13px; color: #3a4f66; }
`;

function figure(src, caption, extra = "") {
  return `<figure${extra}>${src ? `<img src="${src}">` : '<div class="missing">кадра нет</div>'}<figcaption>${caption}</figcaption></figure>`;
}

function contrastTable(rows) {
  const ids = rows.map((row) => row.id);
  const cells = (entry) => {
    if (!entry) return "<td>—</td>";
    if (entry.missing) return '<td class="muted">нет на экране</td>';
    return `<td class="${entry.worst >= 4.5 ? "pass" : "fail"}">${entry.worst.toFixed(2)}<span> / ${entry.median.toFixed(2)}</span></td>`;
  };
  const results = ids.map((id) => readResult(id));
  const body = TARGETS.map((target) => {
    const over = results.map((result) => cells(result?.text?.find((entry) => entry.id === target.id)));
    const worst = WORST_TARGETS.includes(target)
      ? results.map((result) => cells(result?.worst?.find((entry) => entry.id === target.id)))
      : results.map(() => "<td>—</td>");
    return `<tr><th>${escapeHtml(target.label)}</th>${over.join("")}${worst.join("")}</tr>`;
  }).join("");
  const head = rows.map((row) => `<th>${escapeHtml(row.title)}</th>`).join("");
  const headWorst = rows.map((row) => `<th>${escapeHtml(row.title)}, худший фон</th>`).join("");
  return `<table><thead><tr><th>Текст, худший пиксель / медиана, порог 4,5:1</th>${head}${headWorst}</tr></thead><tbody>${body}</tbody></table>`;
}

function sheetIphone() {
  const cols = [
    BEFORE_DIR ? figure(beforeSrc("dark-current-iphone-rest.png"), "<b>Было</b> <span>тёмная</span>") : "",
    figure(frameSrc("iphone-dark-rest.png"), "<b>Стало</b> <span>тёмная, покой</span>"),
    figure(frameSrc("iphone-dark-message-menu.png"), "<b>Стало</b> <span>тёмная, меню сообщения</span>"),
    BEFORE_DIR ? figure(beforeSrc("light-current-iphone-rest.png"), "<b>Было</b> <span>светлая</span>") : "",
    figure(frameSrc("iphone-light-rest.png"), "<b>Стало</b> <span>светлая, покой</span>"),
    figure(frameSrc("iphone-light-message-menu.png"), "<b>Стало</b> <span>светлая, меню сообщения</span>"),
  ].filter(Boolean);
  const crop = (name, caption) =>
    `<figure><div class="crop" style="height:300px">${frameSrc(name) ? `<img src="frames/${name}">` : ""}</div><figcaption>${caption}</figcaption></figure>`;
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>${SHEET_STYLE}</style></head><body>
    <h1>LETSCUBE — экран чата на iPhone: вариант C</h1>
    <p class="lede">Настоящие компоненты на DEV-маршруте, вымышленная переписка. iPhone Pro Max 430×932 ×3, отступы 59 и 34 заданы внутри движка, режим установленного приложения. Статус-бар, остров и полоска «домой» дорисованы для масштаба. Свой пузырь — королевский синий, фон — узор LETSCUBE.</p>
    <div class="grid" style="grid-template-columns: repeat(${cols.length}, 1fr); margin-top: 16px">${cols.join("")}</div>
    <h2>Ответ на сообщение и меню «Ещё»</h2>
    <div class="grid" style="grid-template-columns: repeat(6, 1fr)">
      ${figure(frameSrc("iphone-dark-reply.png"), "<b>Стало</b> <span>тёмная, ответ</span>")}
      ${figure(frameSrc("iphone-light-reply.png"), "<b>Стало</b> <span>светлая, ответ</span>")}
      ${figure(frameSrc("iphone-dark-header-menu.png"), "<b>Стало</b> <span>тёмная, меню «Ещё»</span>")}
    </div>
    <h2>Верх экрана у острова, крупно</h2>
    <div class="grid" style="grid-template-columns: repeat(2, 1fr)">
      ${crop("iphone-dark-rest.png", "Тёмная")}${crop("iphone-light-rest.png", "Светлая — синяя полоса под статус-баром остаётся: iOS сам выбирает цвет значков")}
    </div>
    <h2>Контраст, сфотографированный</h2>
    ${contrastTable([{ id: "iphone-dark-rest", title: "Тёмная" }, { id: "iphone-light-rest", title: "Светлая" }])}
    <p class="note">Худший фон — сплошной белый под стеклом в тёмной теме и сплошной чёрный в светлой: ярче или темнее стекло стать не может.</p>
  </body></html>`;
}

function sheetAndroid() {
  const cols = [
    BEFORE_DIR ? figure(beforeSrc("dark-current-android-rest.png"), "<b>Было</b> <span>тёмная</span>") : "",
    figure(frameSrc("android-dark-rest.png"), "<b>Стало</b> <span>тёмная, покой</span>"),
    figure(frameSrc("android-dark-message-menu.png"), "<b>Стало</b> <span>тёмная, меню сообщения</span>"),
  ].filter(Boolean);
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>${SHEET_STYLE}</style></head><body>
    <h1>LETSCUBE — экран чата на Android: вариант C</h1>
    <p class="lede">390×844 ×3, без вырезов: капсулы идут вдоль верхнего края. Тот же код, что в приложении APK и в браузере телефона.</p>
    <div class="grid" style="grid-template-columns: repeat(${cols.length}, 1fr); margin-top: 16px">${cols.join("")}</div>
    <h2>Контраст, сфотографированный</h2>
    ${contrastTable([{ id: "android-dark-rest", title: "Тёмная" }])}
  </body></html>`;
}

function sheetDesktop() {
  const pair = (before, after, caption) =>
    BEFORE_DIR
      ? `<div class="grid" style="grid-template-columns: 1fr 1fr">${figure(beforeSrc(before), `<b>Было</b> <span>${caption}</span>`)}${figure(frameSrc(after), `<b>Стало</b> <span>${caption}</span>`)}</div>`
      : figure(frameSrc(after), `<b>Стало</b> <span>${caption}</span>`);
  const geometry = readResult("desktop-dark-rest")?.geometry;
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>${SHEET_STYLE}</style></head><body>
    <h1>LETSCUBE — веб на компьютере: вариант C в двух панелях</h1>
    <p class="lede">1440×900. Шапка — капсулы над перепиской: кнопки «Назад» нет, потому что список чатов рядом; капсула с именем — по центру панели чата${geometry?.titleOffCentre != null ? ` (смещение от центра ${geometry.titleOffCentre} px)` : ""}; «Ещё» — круглая капсула. Закреп — капсула, поле ввода — три капсулы.</p>
    <h2>Тёмная тема</h2>
    ${pair("dark-current-desktop-rest.png", "desktop-dark-rest.png", "тёмная")}
    <h2>Светлая тема</h2>
    ${pair("light-current-desktop-rest.png", "desktop-light-rest.png", "светлая")}
    <h2>Меню «Ещё» открывается под капсулой</h2>
    <figure><div class="crop" style="height:420px"><img src="frames/desktop-dark-header-menu.png" style="width:2160px;margin-left:-784px;margin-top:-66px"></div><figcaption>Правая часть панели чата, увеличено ×1,5.</figcaption></figure>
    <h2>Контраст, сфотографированный</h2>
    ${contrastTable([{ id: "desktop-dark-rest", title: "Тёмная" }, { id: "desktop-light-rest", title: "Светлая" }])}
  </body></html>`;
}

function sheetWindows() {
  const clearance = readResult("windows-dark-rest")?.clearance;
  const rows = (clearance?.capsules ?? [])
    .filter((capsule) => !capsule.missing)
    .map(
      (capsule) =>
        `<tr><th>${escapeHtml({ title: "Капсула с именем", menu: "«Ещё»", pinned: "Закреп" }[capsule.id])}</th><td>${capsule.rect.width}×${capsule.rect.height} в ${capsule.rect.x},${capsule.rect.y}</td><td class="${capsule.overlapArea === 0 ? "pass" : "fail"}">${capsule.overlapArea}</td><td>${capsule.gapBelowControls} px</td><td class="${capsule.centreReachesCapsule ? "pass" : "fail"}">${capsule.centreReachesCapsule ? "да" : "нет"}</td></tr>`,
    )
    .join("");
  const buttons = (clearance?.buttons ?? [])
    .map((button) => `${escapeHtml(button.label)} — ${button.centreReachesButton ? "нажимается" : "перекрыта"}`)
    .join(" · ");
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>${SHEET_STYLE}</style></head><body>
    <h1>LETSCUBE — приложение Windows: вариант C и кнопки окна</h1>
    <p class="lede">Окно 1360×860 без рамки системы: кнопки «Свернуть», «Развернуть» и «Закрыть» рисует само приложение в верхней полосе. D-112 записал, что на других страницах они ложатся на кнопки страницы и забирают клики. Панель чата начинается под этой полосой, поэтому её капсулы в другой строке и до кнопок окна не достают.</p>
    <div style="margin-top: 16px">${figure(frameSrc("windows-dark-rest.png"), "<b>Стало</b> <span>тёмная</span>")}</div>
    <h2>Правый верхний угол, размечен после измерений</h2>
    <figure><div class="crop" style="height:360px"><img src="frames/windows-dark-rest-clearance.png" style="width:2720px;margin-left:-1344px"></div><figcaption>Красное — кнопки окна, зелёное — капсулы панели чата. Увеличено ×2.</figcaption></figure>
    <h2>Измерено по раскладке и попаданием клика</h2>
    <table><thead><tr><th>Капсула</th><th>Где</th><th>Площадь пересечения с кнопками окна, px²</th><th>Зазор под кнопками окна</th><th>Клик в центр попадает в капсулу</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="note">Кнопки окна: ${buttons || "—"}. Полоса с кнопками — ${clearance ? `${clearance.topBar.height} px` : "—"} высотой над обеими панелями.</p>
  </body></html>`;
}

function measurementsMarkdown() {
  const lines = [
    "# Chat screen, option C, measured from photographed pixels",
    "",
    "Text: worst pixel / median, threshold 4.5:1. The worst field is solid white under the dark theme and solid black under the light one. Surfaces: median rgb, hue, contrast against the conversation's ground. Geometry in CSS pixels.",
    "",
  ];
  const measured = FRAMES.filter((frame) => frame.measure);
  const results = measured.map((frame) => readResult(frame.id));
  const header = `| | ${measured.map((frame) => frame.id).join(" | ")} |`;
  const rule = `|---|${measured.map(() => "---").join("|")}|`;
  for (const [key, title, targets] of [
    ["text", "Text over the conversation at rest", TARGETS],
    ["worst", "Chrome text over the worst field", WORST_TARGETS],
  ]) {
    lines.push(`## ${title}`, "", header, rule);
    for (const target of targets) {
      const cells = results.map((result) => {
        const entry = result?.[key]?.find((item) => item.id === target.id);
        if (!entry) return "—";
        if (entry.missing) return "not on screen";
        return `${entry.worst.toFixed(2)} / ${entry.median.toFixed(2)}${entry.worst < 4.5 ? " ✗" : ""}`;
      });
      lines.push(`| ${target.id} | ${cells.join(" | ")} |`);
    }
    lines.push("");
  }
  lines.push("## Surfaces", "", header, rule);
  for (const swatch of SWATCHES) {
    const cells = results.map((result) => {
      const entry = result?.surfaces?.find((item) => item.id === swatch.id);
      if (!entry || entry.missing) return "—";
      return `rgb(${entry.rgb.join(",")}) ${entry.hue ?? "—"}° ${entry.againstGround?.toFixed(2)}:1`;
    });
    lines.push(`| ${swatch.id} | ${cells.join(" | ")} |`);
  }
  lines.push("");
  lines.push("## Geometry", "", header, rule);
  const size = (rect) => (rect ? `${rect.width}×${rect.height} at ${rect.x},${rect.y}` : "—");
  for (const [label, render] of [
    ["chrome stack", (g) => size(g?.chromeStack)],
    ["control row", (g) => size(g?.controlRow)],
    ["back", (g) => size(g?.back)],
    ["title", (g) => size(g?.title)],
    ["title off the pane's centre", (g) => (g?.titleOffCentre ?? "—")],
    ["menu", (g) => size(g?.menu)],
    ["pinned", (g) => size(g?.pinned)],
    ["composer dock", (g) => size(g?.composerDock)],
    ["attach", (g) => size(g?.attach)],
    ["field", (g) => size(g?.field)],
    ["recorder", (g) => size(g?.recorder)],
  ]) {
    lines.push(`| ${label} | ${results.map((result) => render(result?.geometry)).join(" | ")} |`);
  }
  lines.push("");
  const clearance = readResult("windows-dark-rest")?.clearance;
  if (clearance) {
    lines.push(
      "## The Windows app: the chat pane's capsules against the window's own buttons (D-112)",
      "",
      `Window buttons: ${size(clearance.zone)}, in a top bar ${clearance.topBar.height}px tall across both panes.`,
      "",
      "| capsule | box | overlap with the buttons, px² | gap below the buttons | a click at its centre reaches it |",
      "|---|---|---|---|---|",
      ...clearance.capsules
        .filter((capsule) => !capsule.missing)
        .map((capsule) => `| ${capsule.id} | ${size(capsule.rect)} | ${capsule.overlapArea} | ${capsule.gapBelowControls}px | ${capsule.centreReachesCapsule} |`),
      "",
      ...clearance.buttons.map((button) => `- ${button.label}: ${size(button.rect)}, a click at its centre reaches it: ${button.centreReachesButton}`),
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}

async function buildSheets(browser) {
  writeFileSync(path.join(OUT, "measurements.md"), measurementsMarkdown());
  copyBeforeFrames();
  for (const [name, html] of [
    ["iphone", sheetIphone()],
    ["android", sheetAndroid()],
    ["desktop", sheetDesktop()],
    ["windows", sheetWindows()],
  ]) {
    const file = path.join(OUT, `sheet-${name}.html`);
    writeFileSync(file, html);
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
    const png = path.join(OUT, `sheet-${name}.png`);
    await page.screenshot({ path: png, fullPage: true });
    await page.close();
    const { height } = await sharp(png).metadata();
    console.log(`sheet: ${path.relative(ROOT, png)} ${height}px tall${height > SHEET_MAX_HEIGHT ? " — OVER THE LIMIT" : ""}`);
  }
}

async function main() {
  mkdirSync(FRAMES_DIR, { recursive: true });
  mkdirSync(MEASUREMENTS_DIR, { recursive: true });
  // The full Chromium build: see the note at the top.
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
          // The back button is drawn only on a phone, and a status bar's band
          // exists only where the hardware takes the top of the screen.
          const applies = (entry) =>
            (entry.id !== "back-count" || DEVICES[frame.device].phone) &&
            (entry.id !== "status-bar" || Boolean(DEVICES[frame.device].insets));
          const missing = [...(result.text ?? []), ...(result.worst ?? []), ...(result.surfaces ?? [])].filter(
            (entry) => entry.missing && applies(entry),
          );
          const overlap = (result.clearance?.capsules ?? []).filter((capsule) => capsule.overlapArea > 0 || capsule.centreReachesCapsule === false);
          console.log(
            `${frame.id}: ok${result.inter ? "" : " (Inter did not load)"}` +
              `${result.errors.length ? ` errors: ${JSON.stringify(result.errors)}` : ""}` +
              `${low.length ? ` under 4.5: ${low.map((entry) => `${entry.id}=${entry.worst}`).join(", ")}` : ""}` +
              `${missing.length ? ` not found: ${missing.map((entry) => entry.id).join(", ")}` : ""}` +
              `${overlap.length ? ` WINDOW BUTTONS: ${overlap.map((capsule) => capsule.id).join(", ")}` : ""}`,
          );
        } catch (error) {
          failures.push(frame.id);
          console.error(`${frame.id}: FAILED ${error instanceof Error ? error.message.split("\n")[0] : error}`);
        }
      }
      if (!only || only.has("pattern")) {
        await renderPattern(browser);
        console.log("pattern: ok");
      }
    }
    await buildSheets(browser);
    const known = new Set([
      ...FRAMES.map((frame) => `${frame.id}.png`),
      "windows-dark-rest-clearance.png",
      "pattern-1to1.png",
      "pattern-dark-1to1.png",
      "pattern-light-1to1.png",
      "pattern-tile-x3.png",
    ]);
    const unused = readdirSync(FRAMES_DIR).filter((name) => !known.has(name));
    if (unused.length) console.log(`frames not in this script's list: ${unused.join(", ")}`);
  } finally {
    await browser.close();
  }
  if (failures.length) process.exitCode = 1;
}

await main();
