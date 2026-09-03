import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdtempSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";

const root = process.cwd();
const executablePath = path.join(root, "windows-tauri", "src-tauri", "target", "debug", "letscube-windows-tauri.exe");

const port = await new Promise((resolve, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    server.close(() => resolve(address.port));
  });
});

const profile = mkdtempSync(path.join(os.tmpdir(), "letscube-shots-"));
mkdirSync("output/windows", { recursive: true });

const client = spawn(executablePath, [], {
  cwd: root,
  env: { ...process.env, LETSCUBE_WEBVIEW2_DATA_DIR: profile, LETSCUBE_WEBVIEW2_DEBUG_PORT: String(port) },
  stdio: "ignore",
});

let browser = null;
for (let attempt = 0; attempt < 40 && !browser; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 250));
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => null);
}
if (!browser) {
  console.error("could not attach");
  spawnSync("taskkill.exe", ["/PID", String(client.pid), "/T", "/F"], { stdio: "ignore" });
  process.exit(1);
}

const context = browser.contexts()[0];

// What is on screen while the app loads, at close intervals.
for (const at of [0, 300, 700, 1100, 1500, 2200, 3200, 5000]) {
  await new Promise((resolve) => setTimeout(resolve, at === 0 ? 0 : 300));
  const page = context.pages()[0];
  if (!page) {
    console.log(`+${at}ms: no page`);
    continue;
  }
  const info = await page
    .evaluate(() => ({
      url: location.href.slice(0, 52),
      state: document.readyState,
      text: (document.body?.innerText ?? "").replace(/\s+/g, " ").slice(0, 64),
      painted: document.body ? document.body.getBoundingClientRect().height > 0 : false,
    }))
    .catch(() => null);
  if (!info) {
    console.log(`+${at}ms: page unavailable`);
    continue;
  }
  await page.screenshot({ path: `output/windows/startup-${String(at).padStart(4, "0")}.png` }).catch(() => {});
  console.log(`+${at}ms: ${info.state.padEnd(11)} ${info.url}  "${info.text}"`);
}

await browser.close().catch(() => {});
spawnSync("taskkill.exe", ["/PID", String(client.pid), "/T", "/F"], { stdio: "ignore" });
console.log("done");
