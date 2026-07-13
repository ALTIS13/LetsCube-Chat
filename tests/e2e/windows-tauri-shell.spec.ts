import { chromium, expect, test } from "@playwright/test";
import { loadQaCredentials } from "./helpers/auth";

const PRODUCTION_ORIGIN = "https://app.letscube.ru";

test.describe("LETSCUBE Windows Tauri shell", () => {
  test("loads the production app with desktop capabilities and authenticated core UI", async ({}, testInfo) => {
    test.skip(process.platform !== "win32", "Tauri WebView2 QA is Windows-only");
    test.skip(
      testInfo.project.name !== "chromium-desktop-1440",
      "the native shell owns its viewport and runs once",
    );

    const cdpUrlValue = process.env.LETSCUBE_TAURI_CDP_URL;
    test.skip(!cdpUrlValue, "LETSCUBE_TAURI_CDP_URL is not configured");
    const cdpUrl = validateCdpUrl(cdpUrlValue ?? "");
    const credentials = loadQaCredentials("owner") ?? loadQaCredentials("default");
    test.skip(!credentials, "Owner/default QA credentials are not configured");

    const browser = await chromium.connectOverCDP(cdpUrl);
    try {
      const page = browser
        .contexts()
        .flatMap((context) => context.pages())
        .find((candidate) => new URL(candidate.url()).origin === PRODUCTION_ORIGIN);
      expect(page, "the production WebView target should be available").toBeDefined();
      if (!page) return;

      const consoleErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => consoleErrors.push(error.message));

      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page).toHaveTitle("LETSCUBE");
      await expect(page.locator('input[type="password"]')).toHaveCount(1);
      await expect
        .poll(() =>
          page.evaluate(() => ({
            platform: window.letscubeDesktop?.platform,
            version: window.letscubeDesktop?.version,
            build: window.letscubeDesktop?.build,
          })),
        )
        .toEqual({ platform: "windows", version: "0.2.0", build: 4 });
      await expect
        .poll(() =>
          page.evaluate(() => ({
            mediaDevices: typeof navigator.mediaDevices?.getUserMedia === "function",
            mediaRecorder: typeof window.MediaRecorder === "function",
            geolocation: "geolocation" in navigator,
            clipboard: typeof navigator.clipboard?.writeText === "function",
            fullscreen: typeof document.documentElement.requestFullscreen === "function",
          })),
        )
        .toEqual({
          mediaDevices: true,
          mediaRecorder: true,
          geolocation: true,
          clipboard: true,
          fullscreen: true,
        });

      await page.locator('input[type="email"]').fill(credentials.email);
      await page.locator('input[type="password"]').fill(credentials.password);
      await page.locator('button[type="submit"]').click();
      await expect(page.locator('input[type="password"]')).toHaveCount(0, { timeout: 20_000 });
      await expect(page.getByTestId("sidebar-brand-strip")).toBeVisible();
      await expect(page.getByTestId("sidebar-search-input")).toBeVisible();
      await expect(page.getByText("Установить LETSCUBE", { exact: true })).toHaveCount(0);

      const composer = page.locator("textarea").first();
      const chatRows = page.getByTestId("chat-list-item");
      await expect(chatRows.first(), "the chat list should hydrate after login").toBeVisible({
        timeout: 20_000,
      });
      const chatCount = Math.min(await chatRows.count(), 10);
      for (let index = 0; index < chatCount; index += 1) {
        if (await composer.isVisible().catch(() => false)) break;
        await chatRows.nth(index).click({ force: true });
        await page.waitForTimeout(400);
      }
      await expect(composer, "an available chat should expose the composer").toBeVisible();

      await page.getByRole("button", { name: "Прикрепить" }).click();
      await expect(page.getByRole("button", { name: "Фото или видео" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Сделать фото" })).toBeVisible();
      await expect(
        page
          .locator("button")
          .filter({ hasText: /^Голосовое$/ })
          .first(),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Записать видео" })).toBeVisible();
      await expect(page.getByTestId("media-quality-selector")).toBeVisible();
      await page.locator("div.fixed.inset-0.z-10").click({ position: { x: 1_200, y: 40 } });

      await page.getByTestId("notification-bell-button").click();
      await expect(page.getByTestId("notification-panel")).toBeVisible();
      await page.keyboard.press("Escape");

      await page.getByRole("button", { name: "Меню" }).click();
      await page.getByRole("button", { name: "Настройки" }).click();
      await expect(page.getByText("Системные уведомления, пока приложение запущено")).toBeVisible();
      await expect(page.getByText("Произошла ошибка интерфейса")).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath("tauri-authenticated-shell.png") });

      expect(consoleErrors, `Unexpected console errors:\n${consoleErrors.join("\n")}`).toEqual([]);
    } finally {
      await browser.close();
    }
  });
});

function validateCdpUrl(value: string) {
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
