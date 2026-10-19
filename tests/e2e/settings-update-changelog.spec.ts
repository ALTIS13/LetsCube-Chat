import { expect, test } from "@playwright/test";
import { requireFixtureServer } from "./helpers/messageActionsFixture";
import { openSettingsScreen } from "./helpers/settingsColumnFixture";

for (const width of [390, 1440]) for (const theme of ["dark", "light"] as const) {
  test(`signed-in changelog and web update controls fit ${width} ${theme}`, async ({ page, request }, info) => {
    await requireFixtureServer(request);
    await page.setViewportSize({ width, height: 960 });
    await openSettingsScreen(page, { theme });
    const changelog = page.getByTestId("settings-open-changelog");
    await changelog.scrollIntoViewIfNeeded();
    await changelog.click();
    const entry = page.getByTestId("settings-changelog-entry");
    await expect(entry).toBeVisible();
    await expect(entry).toContainText("0.2.14");
    await entry.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`settings-changelog-${width}-${theme}.png`), animations: "disabled" });
    await changelog.click();
    const updates = page.getByTestId("settings-open-application");
    await updates.scrollIntoViewIfNeeded();
    await updates.click();
    const control = page.getByTestId("pwa-update-status");
    await expect(control).toBeVisible();
    const action = page.getByTestId("pwa-update-action");
    await action.scrollIntoViewIfNeeded();
    await expect(action).toBeEnabled();
    const visibleAction = await action.evaluate(button => {
      const box = button.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return box.y >= 0 && box.bottom <= innerHeight && !!hit && button.contains(hit);
    });
    expect(visibleAction).toBe(true);
    await page.screenshot({ path: info.outputPath(`settings-update-${width}-${theme}.png`), animations: "disabled" });
  });
}
