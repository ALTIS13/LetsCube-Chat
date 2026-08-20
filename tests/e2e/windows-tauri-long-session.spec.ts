import { chromium, expect, test } from "@playwright/test";
import { loadQaCredentials } from "./helpers/auth";

const PRODUCTION_ORIGIN = "https://app.letscube.ru";
const SOAK_SECONDS = readSoakSeconds(process.env.LETSCUBE_TAURI_SOAK_SECONDS);

test.describe("LETSCUBE Windows Tauri long session", () => {
  test("keeps one authenticated WebView stable through offline and reconnect", async ({}, testInfo) => {
    test.skip(process.platform !== "win32", "Tauri WebView2 QA is Windows-only");
    test.skip(
      testInfo.project.name !== "chromium-desktop-1440",
      "the native shell owns its viewport and runs once",
    );
    const cdpUrl = process.env.LETSCUBE_TAURI_CDP_URL;
    test.skip(!cdpUrl, "LETSCUBE_TAURI_CDP_URL is not configured");
    const credentials = loadQaCredentials("owner") ?? loadQaCredentials("default");
    test.skip(!credentials, "Owner/default QA credentials are not configured");
    test.setTimeout((SOAK_SECONDS + 150) * 1_000);

    const browser = await connectToTauri(validateCdpUrl(cdpUrl ?? ""));
    let markerCreated = false;
    try {
      const contexts = browser.contexts();
      expect(contexts).toHaveLength(1);
      const context = contexts[0];
      const pages = context.pages();
      expect(pages).toHaveLength(1);
      const page = pages[0];

      await page.waitForURL("http://tauri.localhost/startup.html");
      await page.evaluate(async () => {
        await window.__TAURI_INTERNALS__?.invoke("begin_startup_qa");
      });
      await page.waitForURL((url) => url.origin === PRODUCTION_ORIGIN, {
        timeout: 30_000,
        waitUntil: "domcontentloaded",
      });

      const emailInput = page.locator('input[type="email"]');
      if (await emailInput.isVisible().catch(() => false)) {
        await emailInput.fill(credentials!.email);
        await page.locator('input[type="password"]').fill(credentials!.password);
        await page.locator('button[type="submit"]').click();
      }
      const productionShellChrome = page.locator(
        '[data-testid="app-top-bar"], [data-testid="sidebar-brand-strip"]',
      );
      await expect(productionShellChrome).toBeVisible({ timeout: 30_000 });

      const marker = `TAURI_SOAK_${Date.now()}`;
      await page.evaluate((value) => {
        localStorage.setItem("__letscubeTauriSoakMarker", value);
      }, marker);
      markerCreated = true;

      const consoleErrors: string[] = [];
      const failedRequests: string[] = [];
      let offlinePhase = false;
      let mainFrameNavigations = 0;
      page.on("console", (message) => {
        if (message.type() === "error" && !offlinePhase) consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => consoleErrors.push(error.message));
      page.on("requestfailed", (request) => {
        if (offlinePhase) return;
        failedRequests.push(
          `${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`.trim(),
        );
      });
      page.on("framenavigated", (frame) => {
        if (frame === page.mainFrame()) mainFrameNavigations += 1;
      });

      const startedAt = Date.now();
      const offlineAt = startedAt + Math.max(10_000, Math.floor((SOAK_SECONDS * 1_000) / 3));
      let offlineChecked = false;
      while (Date.now() - startedAt < SOAK_SECONDS * 1_000) {
        if (!offlineChecked && Date.now() >= offlineAt) {
          offlinePhase = true;
          await context.setOffline(true);
          await expect(page.getByText("Нет подключения", { exact: true })).toBeVisible({
            timeout: 5_000,
          });
          await page.waitForTimeout(5_000);
          await context.setOffline(false);
          await expect(page.getByText("Подключение восстановлено", { exact: true })).toBeVisible({
            timeout: 5_000,
          });
          offlinePhase = false;
          offlineChecked = true;
        }

        expect(new URL(page.url()).origin).toBe(PRODUCTION_ORIGIN);
        expect(context.pages()).toHaveLength(1);
        await expect(page.getByText("Произошла ошибка интерфейса")).toHaveCount(0);
        await expect(productionShellChrome).toBeVisible();
        expect(await page.evaluate(() => localStorage.getItem("__letscubeTauriSoakMarker"))).toBe(
          marker,
        );
        await page.waitForTimeout(5_000);
      }

      expect(offlineChecked, "the native soak must exercise one offline/reconnect cycle").toBe(
        true,
      );
      expect(mainFrameNavigations, "the production WebView must not reload during soak").toBe(0);
      expect(failedRequests, `Unexpected failed requests:\n${failedRequests.join("\n")}`).toEqual(
        [],
      );
      expect(consoleErrors, `Unexpected console/page errors:\n${consoleErrors.join("\n")}`).toEqual(
        [],
      );
    } finally {
      const page = browser.contexts()[0]?.pages()[0];
      if (markerCreated && page) {
        await page
          .evaluate(() => localStorage.removeItem("__letscubeTauriSoakMarker"))
          .catch(() => undefined);
      }
      await browser.close();
    }
  });
});

function readSoakSeconds(value: string | undefined): number {
  if (!value) return 15 * 60;
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < 60 || seconds > 4 * 60 * 60) {
    throw new Error("LETSCUBE_TAURI_SOAK_SECONDS must be an integer from 60 to 14400.");
  }
  return seconds;
}

function validateCdpUrl(value: string): string {
  const url = new URL(value);
  const port = Number(url.port);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65_535
  ) {
    throw new Error("LETSCUBE_TAURI_CDP_URL must be an uncredentialed loopback HTTP origin.");
  }
  return url.origin;
}

async function connectToTauri(cdpUrl: string) {
  const deadline = Date.now() + 30_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await chromium.connectOverCDP(cdpUrl);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error(`Timed out connecting to the loopback Tauri CDP endpoint: ${String(lastError)}`);
}
