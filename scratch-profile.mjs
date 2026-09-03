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
const client = await context.newCDPSession(page);
await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.locator('input[type="email"]').first().fill(env.KUB_QA_OWNER_EMAIL);
await page.locator('input[type="password"]').first().fill(env.KUB_QA_OWNER_PASSWORD);
await page.locator('button[type="submit"]').first().click();
await page.getByRole("button", { name: "Меню" }).first().waitFor({ state: "visible", timeout: 60000 });
await page.waitForTimeout(3000);

const chats = page.locator('[data-testid="chat-list-item"]');
await chats.first().click();
await page.waitForTimeout(2500);

await client.send("Profiler.enable");
await client.send("Profiler.setSamplingInterval", { interval: 200 });
await client.send("Profiler.start");

for (let step = 0; step < 4; step += 1) {
  await chats.nth(step % 2).click();
  await page.waitForTimeout(900);
}

const { profile } = await client.send("Profiler.stop");

// Self time per function.
const byId = new Map(profile.nodes.map((node) => [node.id, node]));
const self = new Map();
const total = profile.samples?.length ?? 0;
for (const id of profile.samples ?? []) {
  const node = byId.get(id);
  if (!node) continue;
  const frame = node.callFrame;
  const name = `${frame.functionName || "(anonymous)"} @ ${(frame.url || "").split("/").pop()}:${frame.lineNumber}`;
  self.set(name, (self.get(name) ?? 0) + 1);
}

const duration = (profile.endTime - profile.startTime) / 1000;
console.log(`profiled ${Math.round(duration)}ms, ${total} samples\n`);
[...self.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 18)
  .forEach(([name, count]) => {
    const share = ((count / total) * 100).toFixed(1);
    console.log(`  ${share.padStart(5)}%  ${Math.round((count / total) * duration).toString().padStart(5)}ms  ${name}`);
  });

await context.close();
await browser.close();
