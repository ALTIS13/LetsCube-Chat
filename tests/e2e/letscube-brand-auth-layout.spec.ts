import { expect, test, type Page } from "@playwright/test";
import { gotoOrSkip } from "./helpers/auth";

test.describe("Letscube auth brand layout", () => {
  for (const path of ["/login", "/register"] as const) {
    test(`${path} has one brand lockup and no legacy KUB label`, async ({ page }) => {
      const consoleErrors = collectConsoleErrors(page);
      await gotoOrSkip(page, path);

      await expect(page.getByTestId("auth-brand-lockup")).toBeVisible();
      await expect(page.locator('img[src*="letscube-logo"]')).toHaveCount(1);
      await expect(page.getByText("КУБ", { exact: true })).toHaveCount(0);
      await expect(page.getByText("KUB", { exact: true })).toHaveCount(0);

      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        await page.evaluate(() => window.innerWidth + 1),
      );
      expect(unexpectedConsoleErrors(consoleErrors)).toEqual([]);
    });

    test(`${path} keeps the auth form centered independently from the mascot`, async ({ page }, testInfo) => {
      const consoleErrors = collectConsoleErrors(page);
      await gotoOrSkip(page, path);

      const formShell = page.getByTestId("auth-form-shell");
      await expect(formShell).toBeVisible();
      const box = await formShell.boundingBox();
      expect(box, "auth form shell should have a bounding box").not.toBeNull();

      const viewport = testInfo.project.use.viewport;
      const width = viewport && typeof viewport === "object" && "width" in viewport ? viewport.width : 0;
      const formCenter = box!.x + box!.width / 2;
      const viewportCenter = width / 2;
      const tolerance = width >= 1024 ? 80 : 28;
      expect(Math.abs(formCenter - viewportCenter)).toBeLessThanOrEqual(tolerance);

      const mascot = page.locator('img[src*="letscube-mascot-primary"]').first();
      await expect(mascot).toBeVisible();
      const pointerEvents = await mascot.evaluate((node) => getComputedStyle(node).pointerEvents);
      expect(pointerEvents).toBe("none");

      const mascotOpacity = Number(await mascot.evaluate((node) => getComputedStyle(node).opacity));
      if (width < 1024) {
        expect(mascotOpacity).toBeLessThanOrEqual(0.2);
      } else {
        const mascotBox = await mascot.boundingBox();
        expect(mascotBox, "desktop mascot should have a bounding box").not.toBeNull();
        expect(mascotBox!.x).toBeGreaterThanOrEqual(box!.x + box!.width - 16);
      }

      expect(unexpectedConsoleErrors(consoleErrors)).toEqual([]);
    });
  }
});

test.describe("Letscube closed public registration", () => {
  test("/register explains administrator-issued access and has no signup form", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await gotoOrSkip(page, "/register");

    await expect(page.getByText("Регистрация закрыта")).toBeVisible();
    await expect(page.getByText("Аккаунты LETSCUBE выдаёт администратор клуба")).toBeVisible();
    await expect(page.getByRole("button", { name: "Войти в аккаунт" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Восстановить доступ" })).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Создать аккаунт|Зарегистрироваться/ })).toHaveCount(0);
    expect(unexpectedConsoleErrors(consoleErrors)).toEqual([]);
  });

  test("/login does not advertise public signup", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await gotoOrSkip(page, "/login");

    await expect(page.getByText("Нет доступа к аккаунту? Обратитесь к администратору клуба.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Зарегистрироваться" })).toHaveCount(0);
    expect(unexpectedConsoleErrors(consoleErrors)).toEqual([]);
  });

  test("/login?reset=1 opens recovery mode directly", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await gotoOrSkip(page, "/login?reset=1");

    await expect(page.getByRole("button", { name: "Отправить ссылку" })).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    expect(unexpectedConsoleErrors(consoleErrors)).toEqual([]);
  });
});

function collectConsoleErrors(page: Page): string[] {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });
  return consoleErrors;
}

function unexpectedConsoleErrors(messages: string[]): string[] {
  return messages.filter(
    (message) =>
      !message.includes("Failed to load resource") &&
      !message.includes("Missing Supabase environment variables") &&
      !(message.includes("TypeError: Failed to fetch") && message.includes("@supabase_supabase-js") && message.includes("_refreshAccessToken")),
  );
}
