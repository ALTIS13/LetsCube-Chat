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
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark", locale: "ru-RU" });
const page = await context.newPage();

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.locator('input[type="email"]').first().fill(env.KUB_QA_OWNER_EMAIL);
await page.locator('input[type="password"]').first().fill(env.KUB_QA_OWNER_PASSWORD);
await page.locator('button[type="submit"]').first().click();
await page.getByRole("button", { name: "Меню" }).first().waitFor({ state: "visible", timeout: 40000 });
await page.waitForTimeout(2500);

// Instrument long tasks and layout shifts while a chat is opened.
await page.evaluate(() => {
  window.__perf = { longTasks: [], shifts: 0, renders: 0 };
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      window.__perf.longTasks.push(Math.round(entry.duration));
    }
  }).observe({ type: "longtask", buffered: true });
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) window.__perf.shifts += entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  } catch {}
});

const chats = page.locator('[data-testid="chat-list-item"]');
const results = [];

for (let round = 0; round < 6; round += 1) {
  const target = chats.nth(round % 2);
  await page.evaluate(() => {
    window.__perf.longTasks = [];
    window.__perf.shifts = 0;
    window.__perf.mark = performance.now();
  });
  const started = Date.now();
  await target.click();
  // Time to the first rendered message, which is what a person perceives as
  // "the chat opened" — not the container, which appears empty.
  await page.waitForFunction(
    () => document.querySelectorAll('[data-message-bubble="true"]').length > 0,
    { timeout: 20000 },
  );
  const toFirstMessage = Date.now() - started;
  await page.waitForTimeout(1200);
  const perf = await page.evaluate(() => ({
    longTasks: window.__perf.longTasks.slice(),
    shifts: Math.round(window.__perf.shifts * 1000) / 1000,
  }));
  results.push({ ms: toFirstMessage, ...perf });
}

for (const [index, entry] of results.entries()) {
  const blocked = entry.longTasks.reduce((sum, task) => sum + Math.max(0, task - 50), 0);
  console.log(
    `open ${index + 1}: ${entry.ms}ms · long tasks ${entry.longTasks.length} (${entry.longTasks.join(",") || "none"}) · blocking ${blocked}ms · layout shift ${entry.shifts}`,
  );
}

await context.close();
await browser.close();
