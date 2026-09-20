import { expect, type Page, type TestInfo, test } from "@playwright/test";
import { requireFixtureServer } from "./helpers/messageActionsFixture";
import {
  openDisclosure,
  openSettingsScreen,
  setSettingsMeasure,
} from "./helpers/settingsColumnFixture";

/**
 * A photograph of D-222's three tier-1 cards, not a contract.
 *
 * The owner judges a visual change on rendered pixels, so this exists to
 * produce them at the three widths that decide this defect: the chat-list
 * column at the 260 minimum and the 540 maximum the handle allows — with the
 * 360 default between them, which is the width the owner's own screenshot was
 * taken at — and the settings sheet below `md`, which is the case that forbids
 * a threshold tweak. Both themes. The contract for the same surfaces is
 * `settings-container-queries.spec.ts`; this file asserts nothing about the
 * design beyond the card being on screen.
 *
 * Inter is let through here and nowhere else. The fixture aborts every
 * off-machine request, which also blocks the font host — and the Windows
 * fallback, Segoe UI, is narrow enough to hide the clipping the owner
 * photographed. A screenshot taken without the shipped font is a picture of a
 * different product.
 *
 * The viewport is made tall before the shutter. These cards are taller than a
 * 900px window at the narrow end, and an element screenshot of a box that does
 * not fit comes back with the overflow painted black — which reads as a defect
 * that is not there.
 *
 * `KUB_D222_OUT` names the folder; it defaults to one under `output/`.
 */

const OUT = process.env.KUB_D222_OUT ?? "output/d222/png";

/** The two ends of what the handle allows, plus the width nobody drags. */
const COLUMNS = [260, 360, 540] as const;
const TALL = 1600;

async function tall(page: Page) {
  const width = page.viewportSize()?.width ?? 1440;
  await page.setViewportSize({ width, height: TALL });
  await page.waitForTimeout(200);
}

async function shoot(page: Page, selector: string, file: string, info: TestInfo) {
  const card = page.locator(selector).first();
  await expect(card).toBeVisible();
  await card.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  await card.screenshot({ path: file });
  info.annotations.push({ type: "capture", description: file });
}

const ACHIEVEMENTS = "[data-testid='settings-section-decoration'] ul";
const RELEASE = "[data-testid='release-distribution-card']";
const STORAGE = "[data-testid='desktop-storage-card']";

for (const theme of ["dark", "light"] as const) {
  test(`the achievements grid down the column the owner drags (${theme})`, async ({
    page,
    request,
  }, info) => {
    test.skip(
      (page.viewportSize()?.width ?? 0) < 768,
      "the draggable column exists only on the desktop layout",
    );
    await requireFixtureServer(request);
    await openSettingsScreen(page, { theme, columnWidth: 360, webFont: true });
    await tall(page);
    await openDisclosure(page, "decoration");

    for (const width of COLUMNS) {
      await setSettingsMeasure(page, width);
      await shoot(page, ACHIEVEMENTS, `${OUT}/achievements-column${width}-${theme}.png`, info);
    }
  });

  /**
   * A browser on Windows, which is the case the owner photographed: «Версия
   * установки: Windows EXE», «Режим: Браузер», and a «Скачать» that the header
   * grid gives a column of its own.
   */
  test(`the release card down the column the owner drags (${theme})`, async ({
    page,
    request,
  }, info) => {
    test.skip(
      (page.viewportSize()?.width ?? 0) < 768,
      "the draggable column exists only on the desktop layout",
    );
    await requireFixtureServer(request);
    await openSettingsScreen(page, { theme, columnWidth: 360, webFont: true });
    await tall(page);
    await openDisclosure(page, "application");
    await expect(page.getByTestId("release-download-button")).toBeVisible();

    for (const width of COLUMNS) {
      await setSettingsMeasure(page, width);
      await shoot(page, RELEASE, `${OUT}/release-column${width}-${theme}.png`, info);
    }
  });

  /** Windows only, and with the profile moved, so both action buttons render. */
  test(`the storage card down the column the owner drags (${theme})`, async ({
    page,
    request,
  }, info) => {
    test.skip(
      (page.viewportSize()?.width ?? 0) < 768,
      "the draggable column exists only on the desktop layout",
    );
    await requireFixtureServer(request);
    await openSettingsScreen(page, { theme, columnWidth: 360, desktopShell: true, webFont: true });
    await tall(page);
    await openDisclosure(page, "application");

    for (const width of COLUMNS) {
      await setSettingsMeasure(page, width);
      await shoot(page, STORAGE, `${OUT}/storage-column${width}-${theme}.png`, info);
    }
  });

  /**
   * The sheet, which is the case a threshold tweak cannot serve: one component,
   * one breakpoint state, two required answers.
   *
   * Two tests and not one, because `openSettingsScreen` installs init scripts
   * that survive its own reload — calling it twice in a page leaves the Windows
   * bridge from the first call installed, and the release card then photographs
   * «Режим: Приложение» instead of the «Режим: Браузер» the owner reported.
   */
  test(`the storage card in the settings sheet below md (${theme})`, async ({
    page,
    request,
  }, info) => {
    const viewport = page.viewportSize()?.width ?? 0;
    test.skip(viewport >= 768, "the sheet is the form below md");
    await requireFixtureServer(request);
    await openSettingsScreen(page, { theme, desktopShell: true, webFont: true });
    await tall(page);
    await openDisclosure(page, "application");
    for (const width of [viewport, 700] as const) {
      await page.setViewportSize({ width, height: TALL });
      await page.waitForTimeout(300);
      await shoot(page, STORAGE, `${OUT}/storage-sheet${width}-${theme}.png`, info);
    }
  });

  test(`the release card and the achievements grid in the sheet below md (${theme})`, async ({
    page,
    request,
  }, info) => {
    const viewport = page.viewportSize()?.width ?? 0;
    test.skip(viewport >= 768, "the sheet is the form below md");
    await requireFixtureServer(request);
    await openSettingsScreen(page, { theme, webFont: true });
    await tall(page);

    await openDisclosure(page, "application");
    for (const width of [viewport, 700] as const) {
      await page.setViewportSize({ width, height: TALL });
      await page.waitForTimeout(300);
      await shoot(page, RELEASE, `${OUT}/release-sheet${width}-${theme}.png`, info);
    }

    await page.setViewportSize({ width: viewport, height: TALL });
    await page.waitForTimeout(200);
    await openDisclosure(page, "decoration");
    for (const width of [viewport, 700] as const) {
      await page.setViewportSize({ width, height: TALL });
      await page.waitForTimeout(300);
      await shoot(page, ACHIEVEMENTS, `${OUT}/achievements-sheet${width}-${theme}.png`, info);
    }
  });
}
