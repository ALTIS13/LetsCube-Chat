import { expect, test } from "@playwright/test";
import { findFirstAvailableQaRole, gotoOrSkip, loginAsRoleOrSkip, QA_ROLES } from "./helpers/auth";

test.describe("KUB global search", () => {
  test("uses the sidebar search on desktop and the sheet on mobile", async ({ page }, testInfo) => {
    const consoleErrors: string[] = [];
    let expectedMissingRpcResponses = 0;
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("response", (response) => {
      if (
        response.status() === 404 &&
        /\/rpc\/(global_search_v2|search_chat_messages)(?:\?|$)/.test(response.url())
      ) {
        expectedMissingRpcResponses += 1;
      }
    });
    page.on("pageerror", (error) => {
      consoleErrors.push(error.message);
    });

    const qaRole = findFirstAvailableQaRole(QA_ROLES, { includeDefault: true });
    test.skip(!qaRole, "QA credentials or auth states are not configured in env or output/playwright-auth");

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, qaRole);
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
      await input.fill('from:@te has:image after:2026-05-01');
      await expect(page.getByTestId("search-filter-chip-from")).toBeVisible();
      await expect(page.getByTestId("search-filter-chip-has")).toBeVisible();
      await expect(page.getByTestId("search-filter-chip-after")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(palette).toHaveCount(0);
    } else {
      await page.keyboard.press("Control+K");
      const input = page.getByTestId("sidebar-search-input");
      await expect(input).toBeFocused();
      await input.fill("@te");
      await expect(page.getByTestId("sidebar-global-search-results")).toBeVisible();
      await expect(page.getByTestId("sidebar-global-search-results").getByText(/Люди|Чаты|Сообщения|Задачи|Локации/i).first()).toBeVisible();
      await input.fill('type:task after:2026-05-01 TestLocationCodex');
      await expect(page.getByTestId("search-filter-chip-type")).toBeVisible();
      await expect(page.getByTestId("search-filter-chip-after")).toBeVisible();
      await page.getByTestId("search-filter-chip-after").click();
      await expect(input).not.toHaveValue(/after:2026-05-01/);
      await input.fill("@te");
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
    let remainingExpected404 = expectedMissingRpcResponses;
    const unexpectedConsoleErrors = consoleErrors.filter((message) => {
      if (message.includes("Failed to load resource") && remainingExpected404 > 0) {
        remainingExpected404 -= 1;
        return false;
      }
      return true;
    });
    expect(unexpectedConsoleErrors, `Unexpected console errors:\n${unexpectedConsoleErrors.join("\n")}`).toEqual([]);
  });
});
