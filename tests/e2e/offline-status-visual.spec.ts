import { expect, test } from "@playwright/test";
import { requireFixtureServer } from "./helpers/messageActionsFixture";
import path from "node:path";

test.use({ screenshot: "off", trace: "off", video: "off" });
test.beforeEach(async ({ request }) => requireFixtureServer(request));
for (const theme of ["dark", "light"]) test(`guest-only offline status fits in ${theme}`, async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.route("**/__offline-status-preview*", route => route.fulfill({ contentType: "text/html", body:
    '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><script type="module">import RefreshRuntime from "/@react-refresh";RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script></head><body><div id="preview"></div><script type="module" src="/@fs/' + path.resolve("tests/fixtures/offline-status-preview.tsx").replaceAll("\\", "/") + '"></script></body></html>' }));
  await page.goto(`/__offline-status-preview?theme=${theme}`);
  const status = page.getByTestId("offline-history-status"); await expect(status).toBeVisible();
  const box = await status.boundingBox(); const viewport = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
  expect(box!.y).toBe(72); expect(box!.height).toBeLessThanOrEqual(40);
  expect(await status.evaluate(node => getComputedStyle(node).pointerEvents)).toBe("none");
  expect(await page.locator("body").evaluate(node => node.scrollWidth > window.innerWidth)).toBe(false);
  expect(errors).toEqual([]);
  if (process.env.KUB_OFFLINE_GUEST_PIXELS) await page.screenshot({ path: path.join(process.env.KUB_OFFLINE_GUEST_PIXELS,
    `offline-status-${viewport.width}-${theme}.png`) });
});
