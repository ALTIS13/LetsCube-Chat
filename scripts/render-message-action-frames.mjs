#!/usr/bin/env node
/**
 * Renders the message-action frames the owner approves before they ship.
 *
 * Every frame is the real application on the DEV preview route, driven by real
 * input — a tap, a double tap, a long press, a swipe, a hover, a right click —
 * over a fictional, checked-in conversation. Nothing on a network is reached:
 * every request outside this machine and the font host is aborted, and the
 * pictures are inline SVG.
 *
 * It does not start a server. Point it at a dev server started with the fixture
 * configuration (`VITE_SUPABASE_URL=http://127.0.0.1:54321`,
 * `VITE_PUBLIC_PREVIEW_FIXTURE=1`); it refuses anything else.
 *
 * Usage:
 *   KUB_BASE_URL=http://127.0.0.1:5310 node scripts/render-message-action-frames.mjs [--only P1,D3]
 *
 * Writes one PNG per frame and a contact sheet per platform, captions on the
 * sheet, to output/message-actions/.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const { chromium } = await import(
  pathToFileURL(path.join(ROOT, "node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs")).href
);

const BASE = process.env.KUB_BASE_URL ?? "";
const OUT = path.join(ROOT, "output", "message-actions");
const FRAMES_DIR = path.join(OUT, "frames");
const CAPTURE_PATH = "/__qa/public-preview";
const WINDOW_KEY = "__letscubePublicPreviewFixture";
const CLOCK = new Date("2026-09-11T18:00:00+03:00");
const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost", "fonts.googleapis.com", "fonts.gstatic.com"]);
const only = (() => {
  const index = process.argv.indexOf("--only");
  return index > 0 ? new Set(process.argv[index + 1].split(",").map((id) => id.trim())) : null;
})();

// ── pictures ────────────────────────────────────────────────────────────────

const svg = (body, width, height) =>
  `data:image/svg+xml;base64,${Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`,
  ).toString("base64")}`;

const SITE_PHOTO = svg(
  '<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7fb6ea"/><stop offset="1" stop-color="#cfe6f7"/></linearGradient></defs>' +
    '<rect width="480" height="320" fill="url(#s)"/><circle cx="380" cy="70" r="34" fill="#ffd66b"/>' +
    '<rect x="40" y="150" width="170" height="150" fill="#9aa7b4"/><rect x="60" y="175" width="40" height="40" fill="#e8f1f8"/><rect x="130" y="175" width="40" height="40" fill="#e8f1f8"/>' +
    '<rect x="230" y="120" width="210" height="180" fill="#b9c3cc"/><rect x="250" y="145" width="50" height="45" fill="#e8f1f8"/><rect x="330" y="145" width="50" height="45" fill="#e8f1f8"/>' +
    '<rect x="0" y="290" width="480" height="30" fill="#6f7d5a"/><rect x="300" y="215" width="80" height="85" fill="#4d6f95"/>',
  480,
  320,
);

const SHOWCASE_PHOTO = svg(
  '<rect width="480" height="360" fill="#f3e9dc"/><rect x="40" y="40" width="400" height="250" rx="10" fill="#2f3b4c"/>' +
    '<rect x="60" y="60" width="360" height="210" fill="#e9eef4"/><rect x="80" y="170" width="90" height="100" fill="#ed1e7a"/>' +
    '<rect x="190" y="130" width="100" height="140" fill="#427fc2"/><rect x="310" y="190" width="90" height="80" fill="#f5b942"/>' +
    '<rect x="0" y="300" width="480" height="60" fill="#c9b79f"/>',
  480,
  360,
);

// ── conversations ───────────────────────────────────────────────────────────

const RECENT = ["👍", "🔥", "😂", "🎉", "😮", "🙏"];

const GROUP = {
  currentUser: { name: "Максим", username: "maksim" },
  activeChat: {
    name: "Команда проекта",
    memberCount: 5,
    // Five named members, so no placeholder reads anything: Олег last read the
    // chat at 09:40, before Максим's text at 09:45, so that text reads 3 of 4.
    readers: [
      { name: "Аня", time: "09:50" },
      { name: "Борис", time: "09:48" },
      { name: "Вера", time: "09:46" },
      { name: "Олег", time: "09:40" },
    ],
  },
  chats: [
    { name: "Команда проекта", preview: "Ок, буду", time: "09:58", unread: 0 },
    { name: "Аня", preview: "Могу к десяти", time: "09:21", unread: 0 },
    { name: "Дизайн", preview: "Обновил палитру", time: "08:40", unread: 3 },
    { name: "Борис", preview: "Созвонимся вечером?", time: "08:15", unread: 0 },
  ],
  messages: [
    { sender: "Аня", text: "Доброе утро! Созвон сегодня в 11:00, ссылку пришлю ближе к делу.", time: "09:12", own: false },
    { sender: "Борис", text: "Я подключусь, но минут на десять позже.", time: "09:14", own: false },
    { sender: "Максим", text: "Отлично, тогда начнём с макета главной.", time: "09:20", own: true },
    {
      sender: "Аня",
      text: "Макет главной готов — посмотрите, пожалуйста, до созвона",
      time: "09:24",
      own: false,
      reactions: [
        { emoji: "❤️", users: ["Борис", "Вера"] },
        { emoji: "👍", users: ["Максим"] },
      ],
    },
    { sender: "Максим", text: "Вот фото с площадки", time: "09:30", own: true, image: { url: SITE_PHOTO, width: 480, height: 320 } },
    { sender: "Вера", text: "Витрина после монтажа", time: "09:33", own: false, image: { url: SHOWCASE_PHOTO, width: 480, height: 360 } },
    { sender: "Борис", text: "Смета от подрядчика: итог 1,2 млн, сроки — две недели", time: "09:40", own: false, forwardedFrom: "Гена Петров" },
    { sender: "Максим", text: "Смету посмотрю после обеда и отпишусь", time: "09:45", own: true, editedAt: "09:47" },
    {
      sender: "Аня",
      text: "Напоминаю про созвон: в повестке макет главной, смета и сроки монтажа. Если что-то не успеваете посмотреть заранее, напишите сюда — перенесём обсуждение на четверг.",
      time: "09:52",
      own: false,
    },
    { sender: "Вера", text: "Ок, буду", time: "09:58", own: false },
  ],
  recentReactions: RECENT,
};

const PRIVATE = {
  currentUser: { name: "Максим", username: "maksim" },
  activeChat: { name: "Аня", memberCount: 2, type: "private", readers: [{ name: "Аня", time: "09:25" }] },
  chats: [
    { name: "Аня", preview: "Могу к десяти", time: "09:21", unread: 0 },
    { name: "Команда проекта", preview: "Ок, буду", time: "09:58", unread: 4 },
  ],
  messages: [
    { sender: "Аня", text: "Привет! Скинешь фото витрины, когда будешь на месте?", time: "09:02", own: false },
    { sender: "Максим", text: "Да, уже подъезжаю", time: "09:05", own: true },
    { sender: "Максим", text: "Вот, с улицы", time: "09:12", own: true, image: { url: SHOWCASE_PHOTO, width: 480, height: 360 } },
    { sender: "Аня", text: "Супер, спасибо! Так гораздо понятнее", time: "09:14", own: false, reactions: [{ emoji: "🔥", users: ["Максим"] }] },
    { sender: "Максим", text: "Во сколько завтра встречаемся?", time: "09:20", own: true, editedAt: "09:21" },
    { sender: "Максим", text: "Могу к десяти", time: "09:21", own: true },
  ],
  recentReactions: RECENT,
};

const FORWARD_TARGET = {
  currentUser: { name: "Максим", username: "maksim" },
  activeChat: { name: "Дизайн", memberCount: 5 },
  chats: [
    { name: "Дизайн", preview: "Да, заголовки не трогаем", time: "08:40", unread: 0 },
    { name: "Команда проекта", preview: "Ок, буду", time: "09:58", unread: 0 },
  ],
  // Enough of a conversation to fill a phone, so the frame shows a chat in use
  // rather than four messages over an empty ground.
  messages: [
    { sender: "Олег", text: "Доброе утро! Собираю правки по лендингу в одну ветку", time: "08:05", own: false },
    { sender: "Лена", text: "Свои добавлю к обеду", time: "08:07", own: false },
    { sender: "Максим", text: "Главную пока не трогайте, там ждём макет", time: "08:12", own: true },
    { sender: "Олег", text: "Понял. Тогда начну с футера и страницы загрузок", time: "08:15", own: false },
    { sender: "Лена", text: "Иконки для загрузок выложила в общую папку", time: "08:24", own: false },
    { sender: "Лена", text: "Обновила палитру для лендинга, посмотрите", time: "08:32", own: false },
    { sender: "Олег", text: "Бриф от клиента", time: "08:36", own: false, forwardedFrom: "Аня Смирнова" },
    { sender: "Олег", text: "Шрифт в заголовках оставляем прежний?", time: "08:38", own: false },
    { sender: "Максим", text: "Да, заголовки не трогаем", time: "08:40", own: true },
  ],
  recentReactions: RECENT,
  pendingForward: {
    messages: [
      { sender: "Аня", text: "Макет главной готов — посмотрите, пожалуйста, до созвона" },
      { sender: "Борис", text: "Смета от подрядчика: итог 1,2 млн, сроки — две недели" },
    ],
    comment: "Это по главной",
  },
};

// ── frames ──────────────────────────────────────────────────────────────────

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

const FRAMES = [
  {
    id: "P1",
    platform: "phone",
    theme: "light",
    fixture: GROUP,
    caption: "P1. Касание входящего сообщения с реакциями: фон затемнён, над сообщением реакции, под ним меню.",
    async run(t) {
      await t.center("Макет главной готов");
      await t.tapText("Макет главной готов");
      await t.waitFor("[data-action-menu]");
    },
  },
  {
    id: "P2",
    platform: "phone",
    theme: "light",
    fixture: GROUP,
    caption: "P2. Касание своего фото по подписи: то же меню, «Изменить» правит подпись.",
    async run(t) {
      await t.center("Вот фото с площадки", 0.55);
      await t.tapText("Вот фото с площадки");
      await t.waitFor("[data-action-menu]");
    },
  },
  {
    id: "P3",
    platform: "phone",
    theme: "light",
    fixture: GROUP,
    caption: "P3. Двойное касание по «Ок, буду»: на сообщении только что появилась ❤️.",
    async run(t) {
      // The pop lasts 320ms, too short to photograph reliably beside other
      // work on the machine. Once the double tap has put the reaction, the
      // chip's own pop is played again and held at 230ms, past its peak.
      await t.doubleTapText("Ок, буду");
      const chip = t.bubbleOf("Ок, буду").locator("[data-reaction-chip]");
      await chip.waitFor({ timeout: 5_000 });
      await chip.evaluate((node) => {
        node.classList.remove("kub-reaction-pop");
        void node.getBoundingClientRect();
        node.classList.add("kub-reaction-pop");
        for (const animation of node.getAnimations()) {
          animation.pause();
          animation.currentTime = 230;
        }
      });
    },
  },
  {
    id: "P4",
    platform: "phone",
    theme: "light",
    fixture: GROUP,
    caption: "P4. Долгое нажатие и ещё одно касание: выделены два сообщения, сверху панель выделения.",
    async run(t) {
      await t.longPressText("Смету посмотрю после обеда");
      await t.waitFor('[data-testid="chat-selection-bar"]');
      await t.tapText("Смета от подрядчика");
      await t.page.waitForFunction(() => document.querySelectorAll('[data-message-selected-band]').length === 2);
    },
  },
  {
    id: "P5",
    platform: "phone",
    theme: "light",
    fixture: GROUP,
    caption: "P5. Свайп влево посередине жеста: сообщение идёт за пальцем, справа проявляется стрелка ответа.",
    async run(t) {
      await t.center("Я подключусь", 0.45);
      await t.swipeText("Я подключусь", -58);
      await t.waitFor("[data-message-swipe-reply]");
    },
  },
  {
    id: "P6",
    platform: "phone",
    theme: "light",
    fixture: PRIVATE,
    caption: "P6. «Удалить» для двух своих сообщений в личном чате: одна галочка «Также удалить для Аня».",
    async run(t) {
      await t.longPressText("Во сколько завтра встречаемся");
      await t.waitFor('[data-testid="chat-selection-bar"]');
      await t.tapText("Могу к десяти");
      await t.page.waitForFunction(() => document.querySelectorAll('[data-message-selected-band]').length === 2);
      await t.page.locator('[data-testid="chat-selection-bar"]').getByRole("button", { name: "Удалить" }).tap();
      await t.waitFor('[data-testid="message-delete-confirm"]');
    },
  },
  {
    id: "P7",
    platform: "phone",
    theme: "light",
    fixture: FORWARD_TARGET,
    caption: "P7. Пересылка: в чате «Дизайн» над полем — «Переслать 2 сообщения» и комментарий, выше — пересланное сообщение.",
    async run(t) {
      await t.waitFor('[data-testid="composer-forward-draft"]');
      await t.page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
    },
  },
  {
    id: "P8",
    platform: "phone",
    theme: "light",
    fixture: GROUP,
    caption: "P8. Полная панель эмодзи: сверху «Недавние», ваша реакция отмечена.",
    async run(t) {
      await t.center("Макет главной готов", 0.3);
      await t.tapText("Макет главной готов");
      await t.waitFor("[data-reaction-bar]");
      await t.page.locator("[data-reaction-bar]").getByRole("button", { name: "Больше реакций" }).tap();
      await t.waitFor('[data-testid="reaction-emoji-recent"]');
    },
  },
  {
    id: "P9",
    platform: "phone",
    theme: "light",
    fixture: PRIVATE,
    caption: "P9. «Детали» своего сообщения в личном чате: когда отправлено, изменено и прочитано.",
    async run(t) {
      await t.center("Во сколько завтра встречаемся", 0.4);
      await t.tapText("Во сколько завтра встречаемся");
      await t.waitFor("[data-action-menu]");
      await t.page.locator('[data-message-action="details"]').tap();
      await t.waitFor("[data-message-details]");
    },
  },
  {
    id: "P1-dark",
    platform: "phone",
    theme: "dark",
    fixture: GROUP,
    caption: "P1, тёмная тема. Касание входящего сообщения с реакциями.",
    async run(t) {
      await t.center("Макет главной готов");
      await t.tapText("Макет главной готов");
      await t.waitFor("[data-action-menu]");
    },
  },
  {
    id: "D1",
    platform: "desktop",
    theme: "light",
    fixture: GROUP,
    caption: "D1. Наведение на входящее сообщение: у времени появилась круглая кнопка ❤️.",
    async run(t) {
      await t.center("Смета от подрядчика", 0.72);
      await t.hoverText("Смета от подрядчика");
      await t.page.waitForTimeout(250);
    },
  },
  {
    id: "D2",
    platform: "desktop",
    theme: "light",
    fixture: GROUP,
    caption: "D2. Наведение на кнопку ❤️: открылась колонка частых реакций, ❤️ первой, «Больше реакций» в конце.",
    async run(t) {
      // An own message: its ❤️ stands on the bubble's left, in the gap beside
      // the incoming messages above it, so the column rises past them rather
      // than over their text or time.
      await t.center("Смету посмотрю после обеда", 0.72);
      await t.hoverText("Смету посмотрю после обеда");
      const button = t.rowOf("Смету посмотрю после обеда").locator("[data-message-react-button]");
      await button.hover();
      await t.waitFor("[data-reaction-column]");
    },
  },
  {
    id: "D3",
    platform: "desktop",
    theme: "light",
    fixture: GROUP,
    caption: "D3. Правый клик по своему тексту в группе: реакции сверху, «Прочитали: 3» и пункты для текста.",
    async run(t) {
      await t.center("Смету посмотрю после обеда", 0.62);
      await t.rightClickText("Смету посмотрю после обеда");
      await t.waitFor("[data-action-menu]");
    },
  },
  {
    id: "D4",
    platform: "desktop",
    theme: "light",
    fixture: GROUP,
    caption: "D4. Правый клик по своему фото: «Изменить подпись», «Сохранить как…», «Копировать изображение».",
    async run(t) {
      // The menu is taller than the photo, so it covers something. High in the
      // conversation and from the bubble's left edge it opens downwards over
      // the photo itself and the empty side below, covering the caption whole
      // and leaving the time in view, rather than over the messages above it.
      await t.center("Вот фото с площадки", 0.35);
      const image = t.bubbleOf("Вот фото с площадки").locator("img");
      const box = await image.boundingBox();
      await t.page.mouse.click(box.x - 6, box.y + box.height * 0.7, { button: "right" });
      await t.waitFor("[data-action-menu]");
    },
  },
  {
    id: "D5",
    platform: "desktop",
    theme: "light",
    fixture: GROUP,
    caption: "D5. Наведение на реакцию ❤️: кто её поставил.",
    async run(t) {
      await t.center("Макет главной готов", 0.55);
      await t.bubbleOf("Макет главной готов").locator('[data-reaction-chip="❤️"]').hover();
      await t.waitFor('[data-reaction-people="❤️"]');
    },
  },
  {
    id: "D6",
    platform: "desktop",
    theme: "light",
    fixture: GROUP,
    caption: "D6. Режим выделения: выделены три сообщения, сверху панель с «Переслать», «Копировать», «Удалить» и «Отмена».",
    async run(t) {
      await t.center("Смета от подрядчика", 0.5);
      await t.rightClickText("Смета от подрядчика");
      await t.page.locator('[data-message-action="select"]').click();
      await t.waitFor('[data-testid="chat-selection-bar"]');
      await t.clickText("Смету посмотрю после обеда");
      await t.clickText("Напоминаю про созвон");
      await t.page.waitForFunction(() => document.querySelectorAll('[data-message-selected-band]').length === 3);
      await t.page.mouse.move(700, 880);
    },
  },
  {
    id: "D7",
    platform: "desktop",
    theme: "light",
    fixture: GROUP,
    viewport: { width: 800, height: 900 },
    caption: "D7. Узкое окно 800 px с боковой панелью: ❤️ у длинного входящего сообщения, место под неё оставлено справа.",
    async run(t) {
      await t.center("Напоминаю про созвон", 0.5);
      await t.hoverText("Напоминаю про созвон");
      await t.page.waitForTimeout(250);
    },
  },
  {
    id: "D3-dark",
    platform: "desktop",
    theme: "dark",
    fixture: GROUP,
    caption: "D3, тёмная тема. Правый клик по своему тексту в группе.",
    async run(t) {
      await t.center("Смету посмотрю после обеда", 0.62);
      await t.rightClickText("Смету посмотрю после обеда");
      await t.waitFor("[data-action-menu]");
    },
  },
];

// ── tools each frame is driven with ─────────────────────────────────────────

function tools(page, cdp) {
  const bubbleOf = (text) => page.locator('[data-message-bubble="true"]').filter({ hasText: text }).last();
  const rowOf = (text) => page.locator('[data-message-row="true"]').filter({ hasText: text }).last();

  /** A point on the first line of a message's own text, away from any link or chip. */
  async function textPoint(text, dx = 20, dy = 12) {
    const bubble = bubbleOf(text);
    const node = bubble.locator('[data-message-text-content="true"], p').first();
    const box = (await node.count()) ? await node.boundingBox() : await bubble.boundingBox();
    if (!box) throw new Error(`no box for «${text}»`);
    return { x: Math.round(box.x + Math.min(dx, box.width / 2)), y: Math.round(box.y + Math.min(dy, box.height / 2)) };
  }

  async function touchAt(type, point) {
    await cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x: point.x, y: point.y, id: 1, radiusX: 4, radiusY: 4, force: 1 }],
    });
  }

  return {
    page,
    bubbleOf,
    rowOf,
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
    /** Two taps as a thumb makes them: each short, 60ms apart, on one spot. */
    async doubleTapText(text) {
      const point = await textPoint(text);
      await touchAt("touchStart", point);
      await touchAt("touchEnd", point);
      await page.waitForTimeout(60);
      await touchAt("touchStart", point);
      await touchAt("touchEnd", point);
    },
    async longPressText(text) {
      const point = await textPoint(text);
      await touchAt("touchStart", point);
      await page.waitForTimeout(700);
      await touchAt("touchEnd", point);
      await page.waitForTimeout(450);
    },
    async swipeText(text, distance) {
      const point = await textPoint(text, 60, 12);
      await touchAt("touchStart", point);
      const steps = 8;
      for (let step = 1; step <= steps; step += 1) {
        await touchAt("touchMove", { x: point.x + Math.round((distance * step) / steps), y: point.y });
        await page.waitForTimeout(24);
      }
      await page.waitForTimeout(120);
    },
    async hoverText(text) {
      const point = await textPoint(text, 40, 10);
      await page.mouse.move(point.x, point.y, { steps: 4 });
    },
    async clickText(text) {
      const point = await textPoint(text, 30, 10);
      await page.mouse.click(point.x, point.y);
      await page.waitForTimeout(200);
    },
    async rightClickText(text) {
      const point = await textPoint(text, 30, 10);
      await page.mouse.click(point.x, point.y, { button: "right" });
      await page.waitForTimeout(150);
    },
    /** Holds one CSS animation at a moment, so a transient state can be photographed. */
    async freezeAnimation(name, at) {
      await page.waitForFunction((name) => document.getAnimations().some((animation) => animation.animationName === name), name);
      await page.evaluate(
        ({ name, at }) => {
          for (const animation of document.getAnimations()) {
            if (animation.animationName !== name) continue;
            animation.pause();
            animation.currentTime = at;
          }
        },
        { name, at },
      );
    },
  };
}

async function settle(page) {
  await page.evaluate(async () => {
    const finite = document
      .getAnimations()
      .filter((animation) => animation.playState === "running" && animation.effect?.getTiming().iterations !== Infinity);
    await Promise.race([Promise.all(finite.map((animation) => animation.finished.catch(() => undefined))), new Promise((r) => setTimeout(r, 1500))]);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function assertFixtureServer() {
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(BASE)) {
    throw new Error("KUB_BASE_URL must be a loopback dev server, e.g. http://127.0.0.1:5310");
  }
  const client = await fetch(`${BASE}/src/lib/supabase/client.ts`).then((response) => response.text());
  if (!client.includes("127.0.0.1:54321")) throw new Error("The dev server is not on the fixture configuration.");
  const capture = await fetch(`${BASE}${CAPTURE_PATH}`);
  if (!capture.ok) throw new Error(`The capture route answered ${capture.status}.`);
}

async function renderFrame(browser, frame) {
  const phone = frame.platform === "phone";
  const viewport = frame.viewport ?? (phone ? PHONE : DESKTOP);
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: phone ? 2 : 1,
    hasTouch: phone,
    isMobile: phone,
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
  await page.clock.setFixedTime(CLOCK);
  await page.addInitScript(
    ({ key, fixture, theme }) => {
      window[key] = fixture;
      localStorage.setItem("kub-theme", theme);
    },
    { key: WINDOW_KEY, fixture: frame.fixture, theme: frame.theme },
  );
  await page.goto(`${BASE}${CAPTURE_PATH}`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-public-preview-ready="true"]').waitFor({ state: "attached", timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  const inter = await page.evaluate(() => document.fonts.check("16px Inter"));
  // Past the entry lock and its settle passes, which would otherwise pull a
  // conversation scrolled for the frame back to the bottom.
  await page.waitForTimeout(4_700);
  const cdp = phone ? await context.newCDPSession(page) : null;
  await frame.run(tools(page, cdp));
  if (!frame.id.startsWith("P3") && !frame.id.startsWith("P5")) await settle(page);
  const file = path.join(FRAMES_DIR, `${frame.id}.png`);
  await page.screenshot({ path: file, animations: frame.id.startsWith("P3") ? "allow" : "disabled" });
  await context.close();
  return { file, errors, inter };
}

function sheetHtml(title, frames, columns, tileWidth) {
  const tiles = frames
    .map(
      ({ frame, file }) => `
      <figure>
        <img src="data:image/png;base64,${readFileSync(file).toString("base64")}" alt="">
        <figcaption>${frame.caption}</figcaption>
      </figure>`,
    )
    .join("");
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>
    body { margin: 0; padding: 32px; background: #e9eef4; font: 15px/1.4 Inter, "Segoe UI", sans-serif; color: #10233b; }
    h1 { margin: 0 0 24px; font-size: 22px; }
    .grid { display: grid; grid-template-columns: repeat(${columns}, ${tileWidth}px); gap: 28px 24px; }
    figure { margin: 0; }
    img { display: block; width: ${tileWidth}px; border-radius: 10px; box-shadow: 0 1px 0 #c3cfdc, 0 6px 18px rgba(16, 35, 59, 0.12); }
    figcaption { margin-top: 10px; font-size: 14px; }
  </style></head><body><h1>${title}</h1><div class="grid">${tiles}</div></body></html>`;
}

async function main() {
  await assertFixtureServer();
  mkdirSync(FRAMES_DIR, { recursive: true });
  const browser = await chromium.launch();
  const rendered = [];
  const failures = [];
  try {
    for (const frame of FRAMES) {
      if (only && !only.has(frame.id)) continue;
      let result;
      try {
        result = await renderFrame(browser, frame);
      } catch (error) {
        failures.push(frame.id);
        console.error(`${frame.id}: FAILED ${error instanceof Error ? error.message.split("\n")[0] : error}`);
        continue;
      }
      rendered.push({ frame, ...result });
      console.log(`${frame.id}: ${path.relative(ROOT, result.file)}${result.inter ? "" : " (Inter did not load)"}${result.errors.length ? ` errors: ${JSON.stringify(result.errors)}` : ""}`);
    }
    if (failures.length) process.exitCode = 1;
    if (!only && !failures.length) {
      const sheets = [
        { name: "phone-sheet.png", title: "LETSCUBE — действия с сообщением, телефон 390×844", platform: "phone", columns: 5, tile: 300 },
        { name: "desktop-sheet.png", title: "LETSCUBE — действия с сообщением, компьютер 1440×900", platform: "desktop", columns: 2, tile: 720 },
      ];
      for (const sheet of sheets) {
        const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
        const html = sheetHtml(sheet.title, rendered.filter(({ frame }) => frame.platform === sheet.platform), sheet.columns, sheet.tile);
        writeFileSync(path.join(OUT, sheet.name.replace(".png", ".html")), html);
        await page.setContent(html, { waitUntil: "load" });
        await page.screenshot({ path: path.join(OUT, sheet.name), fullPage: true });
        await page.close();
        console.log(`sheet: ${path.relative(ROOT, path.join(OUT, sheet.name))}`);
      }
    }
  } finally {
    await browser.close();
  }
}

await main();
