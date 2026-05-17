import { expect, test } from "@playwright/test";
import { gotoOrSkip, loadQaCredentials, loginIfNeeded } from "./helpers/auth";

test.describe("KUB global search", () => {
  test("opens with Ctrl+K and accepts username queries", async ({ page }) => {
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
    await page.waitForTimeout(750);

    await page.keyboard.press("Control+K");
    const palette = page.getByTestId("global-search-palette");
    await expect(palette).toBeVisible();

    const input = page.getByTestId("global-search-input");
    await expect(input).toBeFocused();
    await input.fill("@te");
    await expect(input).toHaveValue("@te");
    await expect(page.getByText("Произошла ошибка интерфейса")).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(palette).toHaveCount(0);
    expect(consoleErrors, `Unexpected console errors:\n${consoleErrors.join("\n")}`).toEqual([]);
  });
});
