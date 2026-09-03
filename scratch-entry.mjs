import { chromium } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Watches a chat with real history being opened, by polling from outside.
 *
 * Two things are reported: it lurches on entry, and later it scrolls from top
 * to bottom on its own. Both are movement the reader did not ask for, so this
 * samples the scroll position densely from the moment the chat is clicked and
 * prints everything that moved.
 */

const BASE = process.argv[2] ?? "https://app.letscube.ru";
const SAMPLES = Number(process.argv[3] ?? 200);

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
// The seeded conversation, by its own marker rather than by position.
const seeded = chats.filter({ hasText: "QA-HISTORY" }).first();
const target = (await seeded.count()) > 0 ? seeded : chats.first();
console.log((await seeded.count()) > 0 ? "opening the seeded chat" : "seeded chat not in the list; opening the first");
const startedAt = Date.now();
await target.click();

const samples = [];
for (let index = 0; index < SAMPLES; index += 1) {
  const state = await page
    .evaluate(() => {
      const el = document.querySelector('[data-testid="message-scroll-container"]');
      if (!el) return null;
      return {
        top: Math.round(el.scrollTop),
        height: el.scrollHeight,
        client: el.clientHeight,
        bottomGap: Math.round(el.scrollHeight - el.clientHeight - el.scrollTop),
        messages: el.querySelectorAll('[data-message-bubble="true"]').length,
        loadingOlder: el.getAttribute("data-loading-older"),
      };
    })
    .catch(() => null);
  if (state) samples.push({ t: Date.now() - startedAt, ...state });
  await page.waitForTimeout(60);
}

console.log(`samples: ${samples.length} over ${samples.at(-1)?.t ?? 0}ms`);
let previous = null;
let moves = 0;
for (const sample of samples) {
  if (previous && Math.abs(sample.top - previous.top) > 8) {
    moves += 1;
    if (moves <= 16) {
      console.log(
        `  +${String(sample.t).padStart(6)}ms  top ${String(previous.top).padStart(6)} -> ${String(sample.top).padStart(6)} (${sample.top - previous.top >= 0 ? "+" : ""}${sample.top - previous.top}) · height ${previous.height}->${sample.height} · messages ${previous.messages}->${sample.messages} · loadingOlder=${sample.loadingOlder}`,
      );
    }
  }
  previous = sample;
}
console.log(`total moves over 8px: ${moves}`);
const last = samples.at(-1);
if (last) console.log(`settled at top=${last.top}, gap from bottom=${last.bottomGap}, messages=${last.messages}`);

await context.close();
await browser.close();
