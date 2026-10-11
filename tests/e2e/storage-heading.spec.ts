import { expect, test } from "@playwright/test";
import { tmpdir } from "node:os";
import path from "node:path";
import { openStorageHeading, headingGeometry } from "./helpers/storageHeadingFixture";
import { setSettingsMeasure } from "./helpers/settingsColumnFixture";

test.use({ trace: "off", video: "off", screenshot: "off", serviceWorkers: "block" });

for (const theme of ["dark", "light"] as const) {
  test(`storage heading narrow keeps explanation beside visible text ${theme}`, async ({ page }, info) => {
    const health = await openStorageHeading(page, theme);
    await setSettingsMeasure(page, 260);
    const geometry = await headingGeometry(page);
    expect(geometry.text).toBe("Хранилище приложения");
    expect(geometry.font).toContain("Inter");
    expect(geometry.hintVisible, "HINT_VISIBLE_NOT_HIDDEN").toBe(true);
    expect(geometry.textVisible, "COMPLETE_TEXT_NOT_CLIPPED").toBe(true);
    expect(geometry.headingFits, "HEADING_WITHIN_CONTENT").toBe(true);
    expect(geometry.hintSharesTextLine, `NO_ORPHAN_HINT ${JSON.stringify(geometry)}`).toBe(true);
    expect(health.marker).toEqual({ schema: "storage-heading-consumer/v1", oldConsumerCount: 0, newConsumerCount: 1 });
    await page.getByRole("button", { name: "Хранилище приложения — что это", exact: true }).locator("..").screenshot({
      path: path.join(tmpdir(), `letscube-storage-heading-narrow-${info.project.name}-${theme}.png`),
    });
    expect(health.errors).toEqual([]);
    expect(health.unexpected).toEqual([]);
  });

  test(`storage heading normal control and explanation ${theme}`, async ({ page }, info) => {
    const health = await openStorageHeading(page, theme);
    await setSettingsMeasure(page, 540);
    expect(await page.title()).toBe("Fictional storage heading");
    expect(page.url()).toBe("https://storage-heading.invalid/");
    const geometry = await headingGeometry(page);
    expect(geometry.text).toBe("Хранилище приложения");
    expect(geometry.hintVisible).toBe(true);
    expect(geometry.textVisible).toBe(true);
    expect(geometry.headingFits).toBe(true);
    expect(geometry.hintSharesTextLine).toBe(true);
    await page.getByTestId("desktop-storage-card").screenshot({
      path: path.join(tmpdir(), `letscube-storage-heading-${info.project.name}-${theme}.png`),
    });
    await page.getByRole("button", { name: "Хранилище приложения — что это", exact: true }).click();
    await expect(page.getByRole("tooltip").first()).toContainText("Новая папка начнёт использоваться после перезапуска.");
    expect(health.errors).toEqual([]);
    expect(health.unexpected).toEqual([]);
  });

  test(`storage heading assertions reject wrap hide and clip ${theme}`, async ({ page }) => {
    for (const mutation of ["wrap", "hide", "clip"] as const) {
      const health = await openStorageHeading(page, theme, mutation);
      await setSettingsMeasure(page, 260);
      const geometry = await headingGeometry(page);
      expect(geometry.text).toBe("Хранилище приложения");
      if (mutation === "wrap") {
        expect(geometry.hintSharesTextLine, "WRAP_MUTANT_CAUGHT").toBe(false);
        expect(health.marker).toEqual({ schema: "storage-heading-consumer/v1", oldConsumerCount: 1, newConsumerCount: 0 });
        await page.getByRole("button", { name: "Хранилище приложения — что это", exact: true }).locator("..").screenshot({
          path: path.join(tmpdir(), `letscube-storage-heading-before-${test.info().project.name}-${theme}.png`),
        });
      }
      if (mutation === "hide") expect(geometry.hintVisible, "HIDE_MUTANT_CAUGHT").toBe(false);
      if (mutation === "clip") expect(geometry.textVisible, "CLIP_MUTANT_CAUGHT").toBe(false);
      expect(health.errors).toEqual([]);
      expect(health.unexpected).toEqual([]);
    }
  });
}
