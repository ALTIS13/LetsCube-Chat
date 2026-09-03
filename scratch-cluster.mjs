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
const context = await browser.newContext({ viewport: { width: 1024, height: 800 }, colorScheme: "dark", locale: "ru-RU", deviceScaleFactor: 2 });
const page = await context.newPage();

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.locator('input[type="email"]').first().waitFor({ state: "visible", timeout: 60000 });
await page.locator('input[type="email"]').first().fill(env.KUB_QA_OWNER_EMAIL);
await page.locator('input[type="password"]').first().fill(env.KUB_QA_OWNER_PASSWORD);
await page.locator('button[type="submit"]').first().click();
await page.getByRole("button", { name: "Меню" }).first().waitFor({ state: "visible", timeout: 40000 });
await page.locator('[data-testid="chat-list-item"]').filter({ hasText: "Избранное" }).first().click();
await page.getByTestId("message-scroll-container").waitFor({ state: "visible", timeout: 20000 });
await page.waitForTimeout(2000);

const bubbles = page.locator('[data-message-bubble="true"]');
const count = await bubbles.count();

for (const index of [count - 1, count - 3, count - 6]) {
  if (index < 0) continue;
  const bubble = bubbles.nth(index);
  await bubble.scrollIntoViewIfNeeded();
  await bubble.hover();
  await page.waitForTimeout(400);

  const report = await bubble.evaluate((node) => {
    const cluster =
      node.querySelector('[aria-label="Реакция"]')?.parentElement ??
      node.querySelector('[aria-label="Ответить"]')?.parentElement;
    if (!cluster) return "no cluster";
    const bubbleBox = node.getBoundingClientRect();
    const clusterBox = cluster.getBoundingClientRect();

    // Walk up looking for anything that would clip it.
    const clippers = [];
    let parent = node.parentElement;
    while (parent && parent !== document.body) {
      const style = window.getComputedStyle(parent);
      if (style.overflow !== "visible" || style.overflowX !== "visible" || style.overflowY !== "visible") {
        const box = parent.getBoundingClientRect();
        clippers.push({
          tag: `${parent.tagName}.${(parent.className || "").toString().slice(0, 34)}`,
          overflow: `${style.overflowX}/${style.overflowY}`,
          left: Math.round(box.left),
          right: Math.round(box.right),
          clipsCluster: clusterBox.left < box.left - 0.5 || clusterBox.right > box.right + 0.5,
        });
      }
      parent = parent.parentElement;
    }

    return {
      bubbleHeight: Math.round(bubbleBox.height),
      bubbleCentreY: Math.round(bubbleBox.top + bubbleBox.height / 2),
      clusterCentreY: Math.round(clusterBox.top + clusterBox.height / 2),
      offsetFromCentre: Math.round(clusterBox.top + clusterBox.height / 2 - (bubbleBox.top + bubbleBox.height / 2)),
      clusterLeft: Math.round(clusterBox.left),
      clippers: clippers.slice(0, 4),
    };
  });
  console.log(`bubble ${index}: ${JSON.stringify(report)}`);
}

await context.close();
await browser.close();
