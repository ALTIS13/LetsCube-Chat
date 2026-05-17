import { expect, test } from "@playwright/test";
import { findFirstAvailableQaRole, gotoOrSkip, loginAsRoleOrSkip } from "./helpers/auth";

test.describe("KUB authenticated smoke", () => {
  test("opens shell, notifications and tasks without console errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => {
      consoleErrors.push(error.message);
    });

    const role = findFirstAvailableQaRole(
      ["owner", "tech_admin", "location_admin", "location_staff"],
      {
        includeDefault: true,
      },
    );
    test.skip(!role, "QA credentials or auth state for a task-capable role are not configured");

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);

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
