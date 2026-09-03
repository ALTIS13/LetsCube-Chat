import { chromium } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.argv[2] ?? "https://app.letscube.ru";

const env = Object.fromEntries(
  fs
    .readFileSync(path.join(os.homedir(), ".kub-messenger-qa.env"), "utf8")
    .replace(/^﻿/, "")
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const at = line.indexOf("=");
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
    }),
);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark", locale: "ru-RU" });
const page = await context.newPage();

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.locator('input[type="email"]').first().fill(env.KUB_QA_OWNER_EMAIL);
await page.locator('input[type="password"]').first().fill(env.KUB_QA_OWNER_PASSWORD);
await page.locator('button[type="submit"]').first().click();
await page.getByRole("button", { name: "Меню" }).first().waitFor({ state: "visible", timeout: 60000 });
await page.waitForTimeout(2500);

const chats = page.locator('[data-testid="chat-list-item"][data-has-messages="true"]');
const scroller = page.getByTestId("message-scroll-container");

let found = false;
const count = await chats.count();
for (let index = 0; index < Math.min(count, 6); index += 1) {
  await chats.nth(index).click();
  await scroller.waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(1800);
  const paged = await scroller.getAttribute("data-has-more-older");
  const height = await scroller.evaluate((node) => node.scrollHeight);
  console.log(`chat ${index}: has-more-older=${paged}, scrollHeight=${height}`);
  if (paged === "true") {
    found = true;
    break;
  }
}
if (!found) {
  console.log("no chat with paged history — nothing to measure");
  await browser.close();
  process.exit(0);
}

// A real wheel, through the input layer. Setting `scrollTop` directly was
// overridden: the app holds the view at the bottom for a moment after a chat
// opens, and releases that only on genuine pointer, touch or wheel input.
const box = await scroller.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.wheel(0, -200);
await page.waitForTimeout(500);

// Get near the top FIRST, so the anchor is captured immediately before the
// prepend rather than before a long scroll of my own. Measuring across my own
// scrolling is what produced an 11521px "drift" on the first attempt.
for (let step = 0; step < 40; step += 1) {
  const top = await scroller.evaluate((el) => el.scrollTop);
  if (top < 700) break;
  await page.mouse.wheel(0, -Math.min(900, Math.max(240, top - 400)));
  await page.waitForTimeout(110);
  if ((await scroller.getAttribute("data-loading-older")) === "true") {
    await page.waitForTimeout(1200);
  }
}
await page.waitForTimeout(900);

const anchor = await scroller.evaluate((el) => {
  const containerTop = el.getBoundingClientRect().top;
  const node = [...el.querySelectorAll("[data-message-id]")].find(
    (candidate) => candidate.getBoundingClientRect().bottom > containerTop + 1,
  );
  if (!node) return null;
  return {
    id: node.dataset.messageId,
    offset: Math.round(node.getBoundingClientRect().top - containerTop),
    scrollTop: Math.round(el.scrollTop),
    scrollHeight: el.scrollHeight,
    loading: el.getAttribute("data-loading-older"),
    hasMore: el.getAttribute("data-has-more-older"),
  };
});
console.log("anchor just before the prepend:", JSON.stringify(anchor));
if (!anchor || anchor.hasMore !== "true") {
  console.log("no more history to prepend from here");
  await browser.close();
  process.exit(0);
}

// One nudge to ask for older history.
await page.mouse.wheel(0, -260);
let started = false;
for (let step = 0; step < 40 && !started; step += 1) {
  await page.waitForTimeout(80);
  started = (await scroller.getAttribute("data-loading-older")) === "true";
}

const finished = started
  ? await scroller
      .evaluate(
        (el) =>
          new Promise((resolve) => {
            const deadline = Date.now() + 15000;
            const tick = () => {
              if (el.getAttribute("data-loading-older") === "false") return resolve(true);
              if (Date.now() > deadline) return resolve(false);
              setTimeout(tick, 40);
            };
            tick();
          }),
      )
      .catch(() => false)
  : false;

await page.waitForTimeout(600);

const after = await scroller.evaluate((el, previous) => {
  const containerTop = el.getBoundingClientRect().top;
  const target = [...el.querySelectorAll("[data-message-id]")].find(
    (node) => node.dataset.messageId === previous.id,
  );
  return {
    stillRendered: Boolean(target),
    offset: target ? Math.round(target.getBoundingClientRect().top - containerTop) : null,
    drift: target ? Math.round(target.getBoundingClientRect().top - containerTop - previous.offset) : null,
    grew: el.scrollHeight - previous.scrollHeight,
    scrollTop: Math.round(el.scrollTop),
  };
}, anchor);

console.log(`loader started: ${started} · finished: ${finished}`);
console.log("after prepend:", JSON.stringify(after));

await context.close();
await browser.close();
