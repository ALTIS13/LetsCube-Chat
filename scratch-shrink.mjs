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
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "dark", locale: "ru-RU" });

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.locator('input[type="email"]').first().fill(env.KUB_QA_OWNER_EMAIL);
await page.locator('input[type="password"]').first().fill(env.KUB_QA_OWNER_PASSWORD);
await page.locator('button[type="submit"]').first().click();
await page.getByRole("button", { name: "Меню" }).first().waitFor({ state: "visible", timeout: 60000 });
await page.waitForTimeout(2500);

const chats = page.locator('[data-testid="chat-list-item"][data-has-messages="true"]');
const seeded = chats.filter({ hasText: "QA-HISTORY" }).first();
await ((await seeded.count()) > 0 ? seeded : chats.first()).click();

// Sample one bubble's geometry and its container's width as the view settles.
const trail = [];
for (let index = 0; index < 40; index += 1) {
  const state = await page
    .evaluate(() => {
      const bubble = document.querySelector('[data-message-bubble="true"]');
      if (!bubble) return null;
      const stack = bubble.parentElement;
      const row = stack?.parentElement;
      const text = bubble.querySelector('[data-message-text-content="true"]');
      return {
        bubbleH: Math.round(bubble.getBoundingClientRect().height),
        bubbleW: Math.round(bubble.getBoundingClientRect().width),
        stackW: stack ? Math.round(stack.getBoundingClientRect().width) : null,
        rowW: row ? Math.round(row.getBoundingClientRect().width) : null,
        lines: text ? text.getClientRects().length : null,
        stackMax: stack ? window.getComputedStyle(stack).maxWidth : null,
      };
    })
    .catch(() => null);
  if (state) trail.push({ i: index, ...state });
  await page.waitForTimeout(60);
}

let previous = null;
for (const entry of trail) {
  const changed =
    !previous ||
    entry.bubbleH !== previous.bubbleH ||
    entry.bubbleW !== previous.bubbleW ||
    entry.rowW !== previous.rowW;
  if (changed) {
    console.log(
      `  sample ${String(entry.i).padStart(2)}: bubble ${entry.bubbleW}x${entry.bubbleH} · stack ${entry.stackW} · row ${entry.rowW} · lines ${entry.lines} · stackMax ${entry.stackMax}`,
    );
  }
  previous = entry;
}

await browser.close();
