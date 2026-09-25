import path from "node:path";
import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { requireFixtureServer } from "./helpers/messageActionsFixture";
import { openSettingsScreen } from "./helpers/settingsColumnFixture";

for (const theme of ["dark", "light"] as const) {
  test(`own profile keeps mobile tabs usable without covering settings (${theme})`, async ({ page, request }) => {
    await requireFixtureServer(request);
    await page.setViewportSize({ width: 390, height: 844 });
    await openSettingsScreen(page, { theme });
    await page.getByRole("dialog").getByRole("button", { name: "Закрыть", exact: true }).last().click();

    const nav = page.getByRole("navigation", { name: "Навигация" });
    await nav.getByRole("button", { name: "Профиль" }).click();
    await expect(page.getByTestId("settings-field-name")).toBeVisible();
    await expect(nav).toBeVisible();
    await expect(nav.getByRole("button", { name: "Профиль" })).toHaveAttribute("aria-current", "page");
    expect(await nav.getByRole("button", { name: "Чаты" }).evaluate((button) => {
      const rect = button.getBoundingClientRect();
      return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.closest("button") === button;
    }), "the Chats tab is covered by the settings surface").toBe(true);
    const pixels = await sharp(await nav.screenshot()).stats();
    expect(Math.max(...pixels.channels.slice(0, 3).map((channel) => channel.stdev))).toBeGreaterThan(8);

    const scroll = page.getByTestId("settings-scroll");
    await scroll.evaluate((node) => { node.scrollTop = node.scrollHeight; });
    await expect.poll(async () => {
      const last = await scroll.locator("[data-settings-section]").last().boundingBox();
      const footer = await page.getByTestId("settings-actions").boundingBox();
      return Boolean(last && footer && last.y + last.height <= footer.y + 1);
    }).toBe(true);
    const actionsBox = await page.getByTestId("settings-actions").boundingBox();
    const navBox = await nav.boundingBox();
    expect(actionsBox && navBox && actionsBox.y + actionsBox.height <= navBox.y).toBe(true);
    expect(navBox && navBox.y + navBox.height <= 844).toBe(true);

    if (process.env.KUB_PROFILE_NAV_CAPTURE_DIR) {
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: path.join(process.env.KUB_PROFILE_NAV_CAPTURE_DIR, `profile-390-${theme}.png`) });
    }

    await nav.getByRole("button", { name: "Чаты" }).click();
    await expect(page.getByTestId("chat-list-item")).toBeVisible();
    await expect(nav.getByRole("button", { name: "Чаты" })).toHaveAttribute("aria-current", "page");
  });

  test(`desktop settings remain a modal (${theme})`, async ({ page, request }) => {
    await requireFixtureServer(request);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openSettingsScreen(page, { theme });
    await expect(page.getByTestId("settings-overlay")).toBeVisible();
    if (process.env.KUB_PROFILE_NAV_CAPTURE_DIR) {
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: path.join(process.env.KUB_PROFILE_NAV_CAPTURE_DIR, `settings-1440-${theme}.png`) });
    }
  });

  test(`mobile tab change asks before discarding a profile draft (${theme})`, async ({ page, request }) => {
    await requireFixtureServer(request);
    await page.setViewportSize({ width: 390, height: 844 });
    await openSettingsScreen(page, { theme });
    await page.getByRole("dialog").getByRole("button", { name: "Закрыть", exact: true }).last().click();

    const nav = page.getByRole("navigation", { name: "Навигация" });
    await nav.getByRole("button", { name: "Профиль" }).click();
    await page.getByTestId("settings-field-name").fill("Synthetic profile draft");
    await nav.getByRole("button", { name: "Чаты" }).click();
    const question = page.getByRole("dialog").filter({ hasText: "Отменить изменения?" });
    await expect(question).toBeVisible();
    await question.getByRole("button", { name: "Продолжить", exact: true }).click();
    await expect(page.getByTestId("settings-profile-tab")).toBeVisible();
    await expect(page.getByTestId("settings-field-name")).toHaveValue("Synthetic profile draft");

    await nav.getByRole("button", { name: "Чаты" }).click();
    await question.getByRole("button", { name: "Отменить", exact: true }).click();
    await expect(page.getByTestId("chat-list-item")).toBeVisible();
    await expect(page.getByTestId("settings-profile-tab")).toHaveCount(0);
  });
}
