import { expect, test } from "@playwright/test";
import { gotoOrSkip } from "./helpers/auth";

test.describe("public LETSCUBE Bot API documentation", () => {
  test("/bots/docs is public, operationally complete, and viewport-safe", async ({ page }) => {
    const failedAssets: string[] = [];
    page.on("response", (response) => {
      if (new URL(response.url()).pathname.startsWith("/assets/") && !response.ok()) {
        failedAssets.push(`${response.status()} ${response.url()}`);
      }
    });
    await gotoOrSkip(page, "/bots/docs");

    await expect(page).toHaveURL(/\/bots\/docs\/?$/);
    await expect(page).toHaveTitle(/Bot API.*LETSCUBE/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("LETSCUBE Bot API");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.getByText("https://api.letscube.ru/bot/v1/", { exact: true })).toBeVisible();
    await expect(page.getByText("Authorization: Bot <token>", { exact: true })).toBeVisible();

    for (const heading of [
      "Быстрый старт",
      "Методы",
      "Команды и кнопки",
      "Обновления и webhooks",
      "Надежная интеграция",
    ]) {
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }

    const docs = page.getByRole("main");
    for (const requiredText of [
      "getMe",
      "sendMessage",
      "setMyCommands",
      "answerCallbackQuery",
      "getUpdates",
      "X-Letscube-Bot-Webhook-Secret",
      "update_id",
      "idempotency_key",
      "retry_after",
      "callback_query",
      "групповая приватность",
    ]) {
      await expect(docs.getByText(requiredText, { exact: false }).first()).toBeVisible();
    }

    for (const language of ["cURL", "JavaScript", "Python"]) {
      await expect(page.getByRole("heading", { name: language })).toBeVisible();
    }
    await expect(page.getByTestId("bot-docs-examples")).toContainText(
      "https://api.letscube.ru/bot/v1/getMe",
    );
    await expect(page.getByTestId("bot-docs-examples")).toContainText(
      "https://api.letscube.ru/bot/v1/sendMessage",
    );
    await expect(page.getByText(/Telegram.*протокольн.*совместимост/i)).toBeVisible();

    const documentOrigin = new URL(page.url()).origin;
    const bundleAssets = await page
      .locator('script[src^="/"], link[rel="stylesheet"][href^="/"]')
      .evaluateAll((nodes) =>
        nodes.map((node) =>
          node instanceof HTMLScriptElement ? node.src : (node as HTMLLinkElement).href,
        ),
      );
    expect(bundleAssets.length).toBeGreaterThan(0);
    expect(bundleAssets.every((asset) => new URL(asset).origin === documentOrigin)).toBe(true);
    expect(failedAssets).toEqual([]);

    const scrollRoot = page.getByTestId("public-scroll-root");
    const viewportSafety = await scrollRoot.evaluate((node) => ({
      clientHeight: node.clientHeight,
      clientWidth: node.clientWidth,
      scrollHeight: node.scrollHeight,
      scrollWidth: node.scrollWidth,
    }));
    expect(viewportSafety.scrollHeight).toBeGreaterThan(viewportSafety.clientHeight);
    expect(viewportSafety.scrollWidth).toBeLessThanOrEqual(viewportSafety.clientWidth + 1);

    const documentSafety = await page.evaluate(() => ({
      bodyWidth: document.body.scrollWidth,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }));
    expect(documentSafety.bodyWidth).toBeLessThanOrEqual(documentSafety.viewportWidth + 1);
    expect(documentSafety.documentWidth).toBeLessThanOrEqual(documentSafety.viewportWidth + 1);
  });
});
