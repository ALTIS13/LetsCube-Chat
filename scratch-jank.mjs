import { chromium } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.argv[2] ?? "https://app.letscube.ru";
const CPU_THROTTLE = Number(process.argv[3] ?? 1);

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

if (CPU_THROTTLE > 1) {
  const client = await context.newCDPSession(page);
  await client.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE });
  console.log(`CPU throttled ${CPU_THROTTLE}x — standing in for a slower machine`);
}

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.locator('input[type="email"]').first().fill(env.KUB_QA_OWNER_EMAIL);
await page.locator('input[type="password"]').first().fill(env.KUB_QA_OWNER_PASSWORD);
await page.locator('button[type="submit"]').first().click();
await page.getByRole("button", { name: "Меню" }).first().waitFor({ state: "visible", timeout: 60000 });
await page.waitForTimeout(2500);

await page.locator('[data-testid="chat-list-item"]').first().click();
await page.getByTestId("message-scroll-container").waitFor({ state: "visible", timeout: 20000 });
await page.waitForTimeout(2000);

async function watch(label, action) {
  await page.evaluate(() => {
    window.__jank = { tasks: [], frames: [] };
    window.__jankObserver?.disconnect();
    window.__jankObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__jank.tasks.push(Math.round(entry.duration));
    });
    window.__jankObserver.observe({ type: "longtask", buffered: false });

    let last = performance.now();
    window.__jankRaf = true;
    const tick = () => {
      if (!window.__jankRaf) return;
      const now = performance.now();
      window.__jank.frames.push(Math.round(now - last));
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  await action();

  const result = await page.evaluate(() => {
    window.__jankRaf = false;
    window.__jankObserver?.disconnect();
    const frames = window.__jank.frames.filter((value) => value > 0);
    frames.sort((a, b) => a - b);
    return {
      tasks: window.__jank.tasks.slice(),
      frameCount: frames.length,
      medianFrame: frames.length ? frames[Math.floor(frames.length / 2)] : 0,
      worstFrame: frames.length ? frames[frames.length - 1] : 0,
      droppedFrames: frames.filter((value) => value > 32).length,
    };
  });

  const blocking = result.tasks.reduce((sum, task) => sum + Math.max(0, task - 50), 0);
  console.log(
    `${label}: median frame ${result.medianFrame}ms · worst ${result.worstFrame}ms · dropped ${result.droppedFrames}/${result.frameCount} · long tasks ${result.tasks.length} · blocking ${blocking}ms`,
  );
}

const scroller = page.getByTestId("message-scroll-container");

await watch("scrolling up through history", async () => {
  for (let step = 0; step < 14; step += 1) {
    await scroller.evaluate((node) => node.scrollBy({ top: -260 }));
    await page.waitForTimeout(90);
  }
});

await watch("typing in the composer", async () => {
  const composer = page.locator('[contenteditable="true"], textarea').last();
  await composer.click();
  await composer.type("Проверка плавности ввода в поле сообщения", { delay: 45 });
  await composer.fill("");
});

await watch("switching between chats", async () => {
  const chats = page.locator('[data-testid="chat-list-item"]');
  for (let step = 0; step < 4; step += 1) {
    await chats.nth(step % 2).click();
    await page.waitForTimeout(500);
  }
});

await watch("opening the message menu", async () => {
  await page.locator('[data-testid="chat-list-item"]').first().click();
  await page.waitForTimeout(1200);
  const bubble = page.locator('[data-message-bubble="true"]').last();
  if ((await bubble.count()) === 0) return;
  for (let step = 0; step < 3; step += 1) {
    await bubble.click({ button: "right" });
    await page.waitForTimeout(400);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
});

await context.close();
await browser.close();
