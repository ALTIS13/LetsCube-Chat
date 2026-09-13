// Slice 1's measurement: two browsers in a scratch room, one of them on a
// network that carries no UDP.
//
// The second browser runs with `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`,
// which is Chrome's own enterprise switch for exactly the environment this
// product's tunnelled users are in: it refuses non-proxied UDP and leaves ICE to
// find a TCP path or fail. That is the question slice 1 exists to answer, and it
// is answered by reading which candidate pair actually carried the bytes rather
// than by whether the call "worked".
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const LIVEKIT_URL = process.env.LIVEKIT_URL || "ws://157.22.206.43:7880";
const tokenA = readFileSync(path.join(HERE, "token-a.txt"), "utf8").trim();
const tokenB = readFileSync(path.join(HERE, "token-b.txt"), "utf8").trim();

// Served from localhost, which is a secure context, so getUserMedia works and a
// plain ws:// signalling connection is not mixed content.
const page = readFileSync(path.join(HERE, "scratch.html"), "utf8");
const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(page);
});
await new Promise((resolve) => server.listen(8099, "127.0.0.1", resolve));

const FAKE_MEDIA = [
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
  "--autoplay-policy=no-user-gesture-required",
];

async function join(label, token, extraArgs) {
  const browser = await chromium.launch({ args: [...FAKE_MEDIA, ...extraArgs] });
  const context = await browser.newContext({ permissions: ["microphone"] });
  const tab = await context.newPage();
  tab.on("console", (message) => {
    if (message.type() === "error") console.log(`[${label}] console error: ${message.text()}`);
  });
  const url = `http://127.0.0.1:8099/?url=${encodeURIComponent(LIVEKIT_URL)}&token=${encodeURIComponent(token)}`;
  await tab.goto(url, { waitUntil: "domcontentloaded" });
  return { browser, tab, label };
}

const clients = [
  await join("plain", tokenA, []),
  await join("no-udp", tokenB, ["--force-webrtc-ip-handling-policy=disable_non_proxied_udp"]),
];

for (const client of clients) {
  const ok = await client.tab
    .waitForFunction(() => window.__state && (window.__state.connected || window.__state.error), null, { timeout: 45_000 })
    .then(() => true)
    .catch(() => false);
  const state = await client.tab.evaluate(() => window.__state);
  console.log(`${client.label}: connected=${state.connected} error=${state.error ?? "none"} (waited=${ok})`);
}

// Give the media a few seconds to actually flow before asking what carried it.
await clients[0].tab.waitForTimeout(8000);

for (const client of clients) {
  const transport = await client.tab.evaluate(() => window.__transport());
  console.log(`${client.label}: ${JSON.stringify(transport)}`);
}

for (const client of clients) await client.browser.close();
server.close();
