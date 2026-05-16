import { expect, test } from "@playwright/test";
import { gotoOrSkip, loadQaCredentials, loginIfNeeded } from "./helpers/auth";

test.describe("KUB authenticated smoke", () => {
  test("opens shell, notifications and tasks without console errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => {
      consoleErrors.push(error.message);
    });

    const credentials = loadQaCredentials();
    test.skip(!credentials, "QA credentials are not configured in env or ~/.kub-messenger-qa.env");

    await gotoOrSkip(page, "/");
    await loginIfNeeded(page, credentials);

    await expect(page.locator("body")).toBeVisible();

    const notificationsButton = page.getByRole("button", { name: /Уведомления/i }).first();
    if (await notificationsButton.isVisible().catch(() => false)) {
      await notificationsButton.click();
      await expect(page.getByText("Уведомления").first()).toBeVisible();
      await page.keyboard.press("Escape");
    }

    await page.goto("/tasks", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toBeVisible();
    await expect(page.getByText("Произошла ошибка интерфейса")).toHaveCount(0);

    expect(consoleErrors, `Unexpected console errors:\n${consoleErrors.join("\n")}`).toEqual([]);
  });
});
