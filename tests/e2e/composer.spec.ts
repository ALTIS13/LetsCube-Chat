import { expect, test } from "@playwright/test";
import { findFirstAvailableQaRole, gotoOrSkip, loginAsRoleOrSkip } from "./helpers/auth";

test.describe("KUB message composer", () => {
  test("clears text immediately after optimistic send while REST ack is pending", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop-1440", "single viewport mutation regression");

    const role = findFirstAvailableQaRole(
      ["owner", "tech_admin", "location_admin", "location_staff", "client"],
      { includeDefault: true },
    );
    test.skip(!role, "QA credentials or auth state are not configured");

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);

    const composer = page.locator("textarea").first();
    const chatRows = page.locator('[data-testid="chat-list-item"]');
    const chatCount = Math.min(await chatRows.count(), 10);
    for (let index = 0; index < chatCount; index += 1) {
      if (await composer.isVisible().catch(() => false)) break;
      await chatRows.nth(index).click();
      await page.waitForTimeout(500);
    }
    test.skip(
      !(await composer.isVisible().catch(() => false)),
      "No writable chat composer is available for composer QA",
    );

    let delayedPostCount = 0;
    let continuedPostCount = 0;
    await page.route("**/rest/v1/messages**", async (route) => {
      if (route.request().method() === "POST") {
        delayedPostCount += 1;
        await page.waitForTimeout(2_500);
        continuedPostCount += 1;
      }
      await route.continue();
    });

    const marker = `COMPOSER_CLEAR_${Date.now()}`;
    await composer.fill(marker);
    await composer.press("Enter");

    await expect(composer, "composer should clear before the delayed REST ack resolves").toHaveValue("", {
      timeout: 700,
    });
    await expect(page.getByText(marker).first(), "optimistic message should render while ack is pending").toBeVisible({
      timeout: 1_500,
    });
    await expect.poll(() => delayedPostCount, { timeout: 1_500 }).toBeGreaterThan(0);
    await expect.poll(() => continuedPostCount, { timeout: 4_000 }).toBeGreaterThan(0);
  });
});
