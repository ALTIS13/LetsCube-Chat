import { chromium } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.argv[2] ?? "http://127.0.0.1:5191";

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
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: "dark",
  locale: "ru-RU",
  deviceScaleFactor: 2,
});
const page = await context.newPage();

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.locator('input[type="email"]').first().fill(env.KUB_QA_OWNER_EMAIL);
await page.locator('input[type="password"]').first().fill(env.KUB_QA_OWNER_PASSWORD);
await page.locator('button[type="submit"]').first().click();
await page.getByRole("button", { name: "Меню" }).first().waitFor({ state: "visible", timeout: 40000 });
await page.locator('[data-testid="chat-list-item"]').filter({ hasText: "Избранное" }).first().click();
await page.getByTestId("message-scroll-container").waitFor({ state: "visible", timeout: 20000 });
await page.waitForTimeout(2000);

// Hover the last message so the action cluster appears, and measure the gap.
const bubbles = page.locator('[data-message-bubble="true"]');
const last = bubbles.last();
await last.hover();
await page.waitForTimeout(500);

const geometry = await page.evaluate(() => {
  const bubbles = [...document.querySelectorAll('[data-message-bubble="true"]')];
  const bubble = bubbles.at(-1);
  if (!bubble) return "no bubble";
  const cluster = bubble.querySelector('[aria-label="Реакция"]')?.parentElement
    ?? bubble.querySelector('[aria-label="Ответить"]')?.parentElement;
  if (!cluster) return "no cluster";
  const bubbleBox = bubble.getBoundingClientRect();
  const clusterBox = cluster.getBoundingClientRect();
  return {
    bubbleRight: Math.round(bubbleBox.right),
    bubbleLeft: Math.round(bubbleBox.left),
    clusterLeft: Math.round(clusterBox.left),
    clusterRight: Math.round(clusterBox.right),
    gapFromBubble: Math.round(bubbleBox.left - clusterBox.right),
    clusterWidth: Math.round(clusterBox.width),
  };
});
console.log("cluster geometry:", JSON.stringify(geometry));

await page.screenshot({ path: "output/chat-actions.png", clip: { x: 700, y: 560, width: 740, height: 300 } });

// And the context menu.
await last.click({ button: "right" });
await page.waitForTimeout(600);
await page.screenshot({ path: "output/chat-context-menu.png" });

await context.close();
await browser.close();
console.log("captured");
