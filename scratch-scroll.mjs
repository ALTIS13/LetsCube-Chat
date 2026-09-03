import { chromium } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.argv[2] ?? "https://app.letscube.ru";
const THROTTLE = Number(process.argv[3] ?? 1);

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
if (THROTTLE > 1) {
  const client = await context.newCDPSession(page);
  await client.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
}

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.locator('input[type="email"]').first().fill(env.KUB_QA_OWNER_EMAIL);
await page.locator('input[type="password"]').first().fill(env.KUB_QA_OWNER_PASSWORD);
await page.locator('button[type="submit"]').first().click();
await page.getByRole("button", { name: "Меню" }).first().waitFor({ state: "visible", timeout: 60000 });
await page.waitForTimeout(2500);

await page.locator('[data-testid="chat-list-item"][data-has-messages="true"]').first().click();
const scroller = page.getByTestId("message-scroll-container");
await scroller.waitFor({ state: "visible", timeout: 20000 });
await page.waitForTimeout(2500);

// Watch for the two things that actually look broken while paging back:
// content jumping under the reader, and blank frames where messages should be.
const report = await page.evaluate(async () => {
  const el = document.querySelector('[data-testid="message-scroll-container"]');
  if (!el) return "no scroller";

  const anchorOf = () => {
    // The message nearest the middle of the viewport, and how far down it sits.
    const bubbles = [...el.querySelectorAll('[data-message-bubble="true"]')];
    const middle = el.getBoundingClientRect().top + el.clientHeight / 2;
    let best = null;
    let bestDistance = Infinity;
    for (const bubble of bubbles) {
      const box = bubble.getBoundingClientRect();
      const distance = Math.abs(box.top + box.height / 2 - middle);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = bubble;
      }
    }
    return best ? { node: best, top: best.getBoundingClientRect().top } : null;
  };

  const jumps = [];
  const emptyFrames = [];

  for (let step = 0; step < 18; step += 1) {
    const before = anchorOf();
    const beforeCount = el.querySelectorAll('[data-message-bubble="true"]').length;
    const beforeScroll = el.scrollTop;
    el.scrollBy({ top: -420 });
    await new Promise((resolve) => setTimeout(resolve, 220));
    // How far the view actually moved, which is not always what was asked for:
    // at the top of the list the scroll does nothing, and older history
    // arriving above changes scrollTop by itself.
    const actual = beforeScroll - el.scrollTop;

    const count = el.querySelectorAll('[data-message-bubble="true"]').length;
    if (count === 0 && beforeCount > 0) emptyFrames.push(step);

    // If the anchor is still mounted, how far did it move on screen? Older
    // history arriving above it must not push it around.
    if (before && before.node.isConnected) {
      const now = before.node.getBoundingClientRect().top;
      // Scrolling up by N moves content down by N, so an anchor that stayed put
      // relative to the content reads exactly +N. Anything else is the page
      // moving under the reader.
      const drift = Math.round(now - before.top - actual);
      if (Math.abs(drift) > 24) jumps.push({ step, drift, actual: Math.round(actual) });
    }
  }

  return {
    jumps,
    emptyFrames,
    finalCount: el.querySelectorAll('[data-message-bubble="true"]').length,
    atTop: el.scrollTop < 4,
    scrollHeight: el.scrollHeight,
  };
});

console.log(JSON.stringify(report, null, 1));
await context.close();
await browser.close();
