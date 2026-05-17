import { expect, test } from "@playwright/test";
import { gotoOrSkip, loadQaCredentials, loginIfNeeded } from "./helpers/auth";

test.describe("KUB global search", () => {
  test("uses the sidebar search on desktop and the sheet on mobile", async ({ page }, testInfo) => {
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

    const isMobile = testInfo.project.name.includes("mobile");

    if (isMobile) {
      await page.getByRole("button", { name: /^Поиск$/i }).click();
      const palette = page.getByTestId("global-search-palette");
      await expect(palette).toBeVisible();
      const input = page.getByTestId("global-search-input");
      await expect(input).toBeFocused();
      await input.fill("@te");
      await expect(input).toHaveValue("@te");
      await page.keyboard.press("Escape");
      await expect(palette).toHaveCount(0);
    } else {
      await page.keyboard.press("Control+K");
      const input = page.getByTestId("sidebar-search-input");
      await expect(input).toBeFocused();
      await input.fill("@te");
      await expect(page.getByTestId("sidebar-global-search-results")).toBeVisible();
      await expect(page.getByTestId("sidebar-global-search-results").getByText(/Люди|Чаты|Сообщения|Задачи|Локации/i).first()).toBeVisible();
      const userResult = page.getByTestId("sidebar-search-result-user").first();
      await userResult.waitFor({ state: "visible", timeout: 5_000 }).catch(() => null);
      if (await userResult.isVisible().catch(() => false)) {
        await userResult.click();
        const copyUsername = page.getByTestId("search-profile-copy-username");
        await expect(copyUsername).toBeVisible();
        await expect(copyUsername).toHaveAttribute("aria-label", "Скопировать никнейм");
        await expect(copyUsername).toHaveAttribute("title", "Скопировать никнейм");
        await expect(page.getByRole("button", { name: /^Скопировать$/ })).toHaveCount(0);
        await page.getByTestId("global-search-profile-back").click();
      }
      await input.click();
      await page.keyboard.press("Escape");
      await expect(input).toHaveValue("");
    }

    await expect(page.getByText("Произошла ошибка интерфейса")).toHaveCount(0);
    expect(consoleErrors, `Unexpected console errors:\n${consoleErrors.join("\n")}`).toEqual([]);
  });
});
