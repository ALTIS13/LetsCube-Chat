import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";

/**
 * Measures the real Windows client's startup, over the WebView2 debug port.
 *
 * The report is that it launches jerkily and that actions during and after
 * startup are jerky too. This attaches to the actual WebView2 — not a Chromium
 * stand-in — and records how long the main thread is blocked and how many
 * frames are dropped, so the complaint becomes a number.
 */

const root = process.cwd();
const executablePath = path.join(
  root,
  "windows-tauri",
  "src-tauri",
  "target",
  "debug",
  "letscube-windows-tauri.exe",
);

if (!existsSync(executablePath)) {
  console.error("build the client first: cargo build --manifest-path windows-tauri/src-tauri/Cargo.toml");
  process.exit(1);
}

const port = await new Promise((resolve, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    server.close(() => resolve(address.port));
  });
});

// A fixed profile so a second run measures a warm cache, which is what a real
// user has. Pass `--fresh` for the first-run cost.
const profile = process.argv.includes("--fresh")
  ? mkdtempSync(path.join(os.tmpdir(), "letscube-startup-"))
  : path.join(os.tmpdir(), "letscube-startup-warm");
if (!existsSync(profile)) mkdirSync(profile, { recursive: true });
console.log(`launching the client with the WebView2 debug port on ${port}`);

const client = spawn(executablePath, [], {
  cwd: root,
  env: {
    ...process.env,
    LETSCUBE_WEBVIEW2_DATA_DIR: profile,
    LETSCUBE_WEBVIEW2_DEBUG_PORT: String(port),
  },
  stdio: "ignore",
});

const launchedAt = Date.now();
let browser = null;
for (let attempt = 0; attempt < 60 && !browser; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 500));
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => null);
}
if (!browser) {
  console.error("could not attach to the WebView2 debug port");
  client.kill();
  process.exit(1);
}
console.log(`attached after ${Date.now() - launchedAt}ms`);

const context = browser.contexts()[0];
const page = context?.pages()[0] ?? (await context?.newPage());
if (!page) {
  console.error("no page in the WebView2 context");
  await browser.close();
  client.kill();
  process.exit(1);
}

// Install on EVERY document. The startup scene navigates to the production app,
// which discards anything injected into the first one — and "after startup" is
// precisely the phase being reported.
const probe = () => {
  window.__win = { tasks: [], frames: [], startedAt: performance.now() };
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__win.tasks.push(Math.round(entry.duration));
    }).observe({ type: "longtask", buffered: true });
  } catch {}
  window.__win.stalls = [];
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    const gap = Math.round(now - last);
    window.__win.frames.push(gap);
    // Where the long frames actually are, relative to this document's start.
    if (gap > 100) {
      window.__win.stalls.push({ at: Math.round(now - window.__win.startedAt), gap, state: document.readyState });
    }
    last = now;
    if (now - window.__win.startedAt < 40000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

await context.addInitScript(probe);
// And on the document that is already open, which is the startup scene.
await page.evaluate(probe).catch(() => {});

const snapshot = async (label) => {
  for (const candidate of context.pages()) {
    const data = await candidate
      .evaluate(() => {
        if (!window.__win) return { missing: true, url: location.href.slice(0, 58) };
        const frames = window.__win.frames.filter((value) => value > 0).slice().sort((a, b) => a - b);
        return {
          url: location.href.slice(0, 58),
          tasks: window.__win.tasks.slice(),
          frameCount: frames.length,
          median: frames.length ? frames[Math.floor(frames.length / 2)] : 0,
          worst: frames.length ? frames[frames.length - 1] : 0,
          dropped: frames.filter((value) => value > 32).length,
          stalls: (window.__win.stalls ?? []).slice(0, 6),
          navigationStart: Math.round(window.__win.startedAt),
        };
      })
      .catch(() => null);
    if (!data) continue;
    if (data.missing) {
      console.log(`${label}: ${data.url} — no probe on this document`);
      continue;
    }
    const blocking = data.tasks.reduce((sum, task) => sum + Math.max(0, task - 50), 0);
    console.log(
      `${label}: ${data.url}
    median frame ${data.median}ms · worst ${data.worst}ms · dropped ${data.dropped}/${data.frameCount} · long tasks ${data.tasks.length} · blocking ${blocking}ms`,
    );
    for (const stall of data.stalls) {
      console.log(`      stall of ${stall.gap}ms at +${stall.at}ms (document ${stall.state})`);
    }
  }
};

await new Promise((resolve) => setTimeout(resolve, 2500));
await snapshot("+2.5s");
await new Promise((resolve) => setTimeout(resolve, 6000));
await snapshot("+8.5s");
await new Promise((resolve) => setTimeout(resolve, 8000));
await snapshot("+16.5s");

await browser.close().catch(() => {});
spawnSync("taskkill.exe", ["/PID", String(client.pid), "/T", "/F"], { stdio: "ignore" });
console.log("client stopped");
