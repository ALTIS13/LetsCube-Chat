import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { chromium, webkit, devices, expect } from "@playwright/test";
import { chat, membership, message, openFixture, person } from "../tests/e2e/helpers/messageActionsFixture.ts";

// A real production-mode web build with exclusively fictional configuration.
// Routes serve its immutable local bytes; there is no listening dev server.
assert.equal(process.env.KUB_QA_ALLOW_MUTATIONS, "0");
const bundle = resolve(process.argv[2] ?? "");
const output = resolve(process.argv[3] ?? "");
const captionOnly = process.argv[4] === "caption";
const extended = process.argv.includes("extended");
assert.ok(process.argv[2] && process.argv[3] && bundle !== output);
const html = await readFile(resolve(bundle, "index.html"), "utf8");
const assets = await readdir(resolve(bundle, "assets"));
const code = (await Promise.all(assets.filter((name) => name.endsWith(".js")).map((name) => readFile(resolve(bundle, "assets", name), "utf8")))).join("\n");
assert.ok(code.includes("http://127.0.0.1:54321") && code.includes("playwright-public-fixture"), "requires a fictional build, never production configuration");
assert.ok(!code.includes("https://core.letscube.ru"), "production backend must not be baked into this harness");
await mkdir(output);
const origin = "http://127.0.0.1:54319";
const at = "2026-10-10T09:00:00.000Z";
const me = person("75111111-1111-4111-8111-000000000001", "QA Example", "qaexample");
const peer = person("75111111-1111-4111-8111-000000000002", "QA Peer", "qapeer");
const id = "75222222-2222-4222-8222-000000000001";
const mime: Record<string, string> = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json" };
const results = [];
for (const engine of ["chromium", "webkit"] as const) {
  const browser = await (engine === "chromium" ? chromium : webkit).launch();
  try {
    const scenarios = extended ? ["phone-landscape", "tablet-wide", "standalone-phone"] : ["desktop", "phone"];
    for (const scenario of scenarios) for (const theme of ["light", "dark"] as const) {
      const mobile = scenario !== "desktop";
      const phone = scenario !== "desktop" && scenario !== "tablet-wide";
      const viewport = scenario === "phone-landscape" ? { width: 932, height: 430 }
        : scenario === "tablet-wide" ? { width: 1024, height: 1180 }
          : phone ? { width: 390, height: 844 } : { width: 1440, height: 900 };
      const context = await browser.newContext({
        ...(mobile ? devices[engine === "chromium" ? "Pixel 7" : "iPhone 14 Pro"] : devices["Desktop Chrome"]),
        viewport,
        screen: viewport,
        colorScheme: theme,
        serviceWorkers: "block",
      });
      try {
        const page = await context.newPage();
        if (scenario === "standalone-phone") {
          await page.addInitScript(() => {
            Object.defineProperty(navigator, "standalone", { configurable: true, get: () => true });
            const matchMedia = window.matchMedia.bind(window);
            window.matchMedia = (query) => {
              const result = matchMedia(query);
              if (query === "(display-mode: standalone)") Object.defineProperty(result, "matches", { value: true });
              return result;
            };
          });
        }
        await page.route(`${origin}/**`, async (route) => {
          const pathname = decodeURIComponent(new URL(route.request().url()).pathname);
          const file = resolve(bundle, `.${pathname}`);
          assert.ok(file === bundle || file.startsWith(bundle + sep));
          if (pathname === "/") return route.fulfill({ contentType: "text/html", body: html });
          try { await route.fulfill({ contentType: mime[extname(file)] ?? "application/octet-stream", body: await readFile(file) }); }
          catch { await route.fulfill({ status: 404, body: "Missing fixture asset" }); }
        });
        const fixture = await openFixture(page, { me, people: [peer], theme,
          chats: [chat(id, "private", null, at)], memberships: [membership(id, me, "owner", at), membership(id, peer, "member", at)],
          messages: [message("75333333-3333-4333-8333-000000000001", id, peer, "Fictional keyboard fixture", at)],
        });
        await page.goto(origin, { waitUntil: "domcontentloaded" });
        await page.getByTestId("chat-list-item").filter({ hasText: peer.full_name }).click();
        if (captionOnly) {
          await page.getByRole("button", { name: "Прикрепить", exact: true }).click();
          const picker = page.waitForEvent("filechooser");
          await page.locator('[data-attach-entry="library"]').click();
          await (await picker).setFiles({ name: "fictional.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1kAAAAASUVORK5CYII=", "base64") });
        }
        const field = captionOnly ? page.getByTestId("attach-caption") : page.getByPlaceholder("Сообщение…").first();
        await expect(field).toBeVisible();
        await expect(field).toHaveAttribute("enterkeyhint", phone ? "enter" : "send");
        await field.fill("Line one");
        await field.press(phone ? "Enter" : "Shift+Enter");
        await field.pressSequentially("Line two");
        await expect(field).toHaveValue("Line one\nLine two");
        assert.equal(fixture.restCalls("messages", "POST").length, 0);
        const geometry = await field.evaluate((el: HTMLTextAreaElement) => ({ height: el.clientHeight, scroll: el.scrollHeight, width: el.clientWidth }));
        assert.ok(geometry.height >= 44 && geometry.scroll <= geometry.height + 2, "both lines must fit visibly, not only exist in the value");
        // Pixels are strictly fictional: no real login, account or backend.
        await page.screenshot({ path: resolve(output, `${engine}-${extended ? scenario : viewport.width}-${theme}.png`) });
        if (captionOnly) {
          await expect(page.getByTestId("attach-send")).toBeEnabled();
        } else {
          await page.getByRole("button", { name: "Отправить", exact: true }).click();
          await expect.poll(() => fixture.restCalls("messages", "POST").length).toBe(1);
          assert.equal((fixture.restCalls("messages", "POST")[0]?.body as { content?: string }).content, "Line one\nLine two");
        }
        if (!phone && !captionOnly) {
          await field.fill("Desktop Enter sends");
          await field.press("Enter");
          await expect.poll(() => fixture.restCalls("messages", "POST").length).toBe(2);
        }
        results.push({ engine, scenario, width: viewport.width, theme, surface: captionOnly ? "caption" : "message", hint: phone ? "enter" : "send", multilineFits: true, arrowSendsWholeText: captionOnly ? null : true, geometry });
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
}
await writeFile(resolve(output, "result.json"), JSON.stringify({ fictionalOnly: true, listeningServer: false, results }, null, 2), { flag: "wx" });
console.log(JSON.stringify({ cases: results.length, passed: true, realDeviceIme: false, fictionalOnly: true }));
