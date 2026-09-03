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

// Record every bubble's height from the moment it appears until it settles.
await page.addInitScript(() => {
  window.__heights = new Map();
  window.__grew = [];
  const watch = () => {
    for (const node of document.querySelectorAll('[data-message-bubble="true"]')) {
      const id = node.closest("[data-message-id]")?.dataset.messageId;
      if (!id) continue;
      const height = Math.round(node.getBoundingClientRect().height);
      const group = node.querySelector("[data-message-meta-placement]");
      const placement = group ? group.getAttribute("data-message-meta-placement") : "none";
      const reserve = node.querySelector("[data-message-footer-reserve]") ? "yes" : "no";
      const images = [...node.querySelectorAll("img")].filter((image) => !image.complete).length;
      const state = { height, placement, reserve, pendingImages: images };
      const seen = window.__heights.get(id);
      if (seen === undefined) {
        window.__heights.set(id, state);
      } else if (state.height !== seen.height) {
        window.__grew.push({
          id: id.slice(0, 8),
          from: seen.height,
          to: state.height,
          placement: `${seen.placement}->${state.placement}`,
          reserve: `${seen.reserve}->${state.reserve}`,
          pendingImages: seen.pendingImages,
        });
        window.__heights.set(id, state);
      }
    }
    requestAnimationFrame(watch);
  };
  requestAnimationFrame(watch);
});

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.locator('input[type="email"]').first().fill(env.KUB_QA_OWNER_EMAIL);
await page.locator('input[type="password"]').first().fill(env.KUB_QA_OWNER_PASSWORD);
await page.locator('button[type="submit"]').first().click();
await page.getByRole("button", { name: "Меню" }).first().waitFor({ state: "visible", timeout: 60000 });
await page.waitForTimeout(2000);

const chats = page.locator('[data-testid="chat-list-item"][data-has-messages="true"]');
await page.evaluate(() => {
  window.__heights.clear();
  window.__grew.length = 0;
});
await chats.nth(1).click();
await page.getByTestId("message-scroll-container").waitFor({ state: "visible", timeout: 20000 });
await page.waitForTimeout(3500);

const report = await page.evaluate(() => ({
  bubbles: window.__heights.size,
  changes: window.__grew.length,
  totalGrowth: window.__grew.reduce((sum, entry) => sum + (entry.to - entry.from), 0),
  sample: window.__grew.slice(0, 8),
}));

console.log(JSON.stringify(report, null, 1));
await context.close();
await browser.close();
