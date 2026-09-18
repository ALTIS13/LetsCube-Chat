import { expect, type Page, test } from "@playwright/test";
import {
  CHAT_LIST_DEFAULT_WIDTH,
  CHAT_LIST_MAX_WIDTH,
  CHAT_LIST_MIN_WIDTH,
} from "../../artifacts/kub/src/lib/desktopChatList";
import { requireFixtureServer } from "./helpers/messageActionsFixture";
import {
  gridTracks,
  openDisclosure,
  openSettingsScreen,
  setColumnWidth,
} from "./helpers/settingsColumnFixture";

/**
 * D-222: the three settings cards whose layout is decided by the box they are
 * drawn in rather than by the window.
 *
 * **Every test here is a pair of widths at one viewport**, and that is the whole
 * instrument. The settings screen renders in two containers — the chat-list
 * column above `md`, which the owner drags between 260 and 540 points, and a
 * viewport sheet below it — so the same window width has to produce two
 * different layouts. A `@media` query cannot: at 1440 it answers the same thing
 * whatever the handle was left at. Put `sm:` back on any of these lines and the
 * narrow half of its pair goes red, because the wide half was passing for the
 * wrong reason.
 *
 * Nothing here asserts that `container-type` is declared. A declaration is not
 * a surface; what is asserted is the layout the reader gets.
 *
 * Deliberately font-independent. The fixture blocks the font host, so this runs
 * on Segoe UI while production runs on Inter, and Segoe is narrow enough to hide
 * the clipping the defect is about — an assertion about text fitting would pass
 * here under a mutation that ships broken. Track counts and track widths do not
 * move with the font; the pixels are `settings-column-layout-capture.spec.ts`.
 */

const DESKTOP_ONLY = "the draggable column exists only on the desktop layout";
const SHEET_ONLY = "the settings sheet is the form below md";

/** The widest below-`md` viewport, where the sheet is at its roomiest. */
const WIDEST_SHEET = 767;

async function trackCount(page: Page, testId: string) {
  return (await gridTracks(page, testId)).length;
}

test.describe("the achievements grid", () => {
  test("splits in two by the width of the list, not the width of the window", async ({
    page,
    request,
  }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 768, DESKTOP_ONLY);
    await requireFixtureServer(request);
    await openSettingsScreen(page, { columnWidth: CHAT_LIST_DEFAULT_WIDTH });
    await openDisclosure(page, "decoration");

    const columns = () =>
      page.evaluate(() => {
        const list = document.querySelector("[data-testid='settings-section-decoration'] ul");
        if (!list) throw new Error("the achievements list is not on screen");
        return getComputedStyle(list).gridTemplateColumns.split(" ").length;
      });

    // The owner's own screenshot was taken here, at the width nobody drags.
    await setColumnWidth(page, CHAT_LIST_DEFAULT_WIDTH);
    expect(await columns(), "at the default column one card fills the row").toBe(1);

    await setColumnWidth(page, CHAT_LIST_MIN_WIDTH);
    expect(await columns(), "at the narrowest column one card fills the row").toBe(1);

    await setColumnWidth(page, CHAT_LIST_MAX_WIDTH);
    expect(await columns(), "dragged wide, the list takes its two-column form").toBe(2);
  });

  test("no title is cut off at any width the handle allows", async ({ page, request }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 768, DESKTOP_ONLY);
    await requireFixtureServer(request);
    await openSettingsScreen(page, { columnWidth: CHAT_LIST_DEFAULT_WIDTH });
    await openDisclosure(page, "decoration");

    // The titles carry `truncate`, so a cell too narrow for one does not wrap
    // it — it clips, and the word is simply gone. That is what «Тестиро…» and
    // «Альфа-т…» were.
    const clipped = () =>
      page.evaluate(() =>
        [
          ...document.querySelectorAll(
            "[data-testid='settings-section-decoration'] li > div > div.truncate",
          ),
        ]
          .filter((node) => node.scrollWidth > node.clientWidth + 0.5)
          .map((node) => node.textContent ?? ""),
      );

    for (const width of [CHAT_LIST_MIN_WIDTH, CHAT_LIST_DEFAULT_WIDTH, CHAT_LIST_MAX_WIDTH]) {
      await setColumnWidth(page, width);
      expect(await clipped(), `a title is clipped at a ${width}pt column`).toEqual([]);
    }
  });
});

test.describe("the release card", () => {
  test("gives the download a column of its own by the card's width, not the window's", async ({
    page,
    request,
  }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 768, DESKTOP_ONLY);
    await requireFixtureServer(request);
    await openSettingsScreen(page, { columnWidth: CHAT_LIST_DEFAULT_WIDTH });
    await openDisclosure(page, "application");
    const download = page.getByTestId("release-download-button");
    await expect(download).toBeVisible();

    const shape = async () => {
      const card = await page.getByTestId("release-distribution-card").boundingBox();
      const button = await download.boundingBox();
      if (!card || !button) throw new Error("the card or its download button has no box");
      return {
        tracks: await trackCount(page, "release-distribution-card"),
        share: button.width / card.width,
      };
    };

    await setColumnWidth(page, CHAT_LIST_DEFAULT_WIDTH);
    const narrow = await shape();
    expect(narrow.tracks, "at the default column the header stacks").toBe(2);
    expect(narrow.share, "and the download runs the width of the content").toBeGreaterThan(0.6);

    await setColumnWidth(page, CHAT_LIST_MIN_WIDTH);
    expect(await trackCount(page, "release-distribution-card"), "and at the narrowest too").toBe(2);

    await setColumnWidth(page, CHAT_LIST_MAX_WIDTH);
    const wide = await shape();
    expect(wide.tracks, "dragged wide, the download takes the third column").toBe(3);
    expect(wide.share, "and shrinks to its own label").toBeLessThan(0.35);
  });

  /**
   * The same rule on the second of the card's three action buttons.
   *
   * D-222 names three — «Установить», «Скачать», «Повторить» — and each carries
   * the utilities separately, so one of them could be put back to `sm:` alone.
   * «Повторить» is the one a desktop browser can be shown: «Установить» needs
   * `supportsPwaInstall()`, which this product answers only for iOS, where the
   * screen is never the column. That one is left uncovered on purpose.
   */
  test("applies the same rule to «Повторить»", async ({ page, request }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 768, DESKTOP_ONLY);
    await requireFixtureServer(request);
    await openSettingsScreen(page, {
      columnWidth: CHAT_LIST_DEFAULT_WIDTH,
      releaseUnavailable: true,
    });
    await openDisclosure(page, "application");
    const retry = page.getByRole("button", { name: "Повторить", exact: true });
    await expect(retry).toBeVisible();

    const share = async () => {
      const card = await page.getByTestId("release-distribution-card").boundingBox();
      const button = await retry.boundingBox();
      if (!card || !button) throw new Error("the card or «Повторить» has no box");
      return button.width / card.width;
    };

    await setColumnWidth(page, CHAT_LIST_DEFAULT_WIDTH);
    expect(await share(), "at the default column it runs the width of the content").toBeGreaterThan(
      0.6,
    );

    await setColumnWidth(page, CHAT_LIST_MAX_WIDTH);
    expect(await share(), "dragged wide, it shrinks to its own label").toBeLessThan(0.35);
  });

  test("keeps its three-column form in the settings sheet below md", async ({ page, request }) => {
    const viewport = page.viewportSize()?.width ?? 0;
    test.skip(viewport >= 768, SHEET_ONLY);
    await requireFixtureServer(request);
    await openSettingsScreen(page);
    await openDisclosure(page, "application");

    // The other half of the pair, and the reason a different `sm:` number could
    // not have fixed this: below `md` the sheet is the viewport, and the same
    // component is correct in three columns at widths where the column is not.
    await page.setViewportSize({ width: WIDEST_SHEET, height: 900 });
    await page.waitForTimeout(300);
    expect(await trackCount(page, "release-distribution-card")).toBe(3);

    await page.setViewportSize({ width: viewport, height: 900 });
    await page.waitForTimeout(300);
    expect(await trackCount(page, "release-distribution-card"), "and stacks on a phone").toBe(2);
  });
  /**
   * The shape of the two info chips, which is the defect the owner actually
   * photographed rather than the grid behind it.
   *
   * A pill is only a pill while it is one line high: above that the radius
   * clamps to half the height and the box is an ellipse with the words crammed
   * into it. «Версия установки: Windows EXE» needs 248px and the chips get
   * `card - 62` in the two-column form, so below a 310px card it wraps whatever
   * the grid does — the header fix alone took the owner's four lines down to
   * two and left the ellipse.
   *
   * Asserted as **is it a stadium**, not as which class is present: a stadium's
   * radius exceeds its own height, and `--radius` is 10px. Font-independent,
   * like everything else here — the chip wraps under Segoe as it does under
   * Inter, only at a slightly different width, and neither is near 540.
   */
  test("the info chips stop being pills where they stop being one line", async ({
    page,
    request,
  }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 768, DESKTOP_ONLY);
    await requireFixtureServer(request);
    await openSettingsScreen(page, { columnWidth: CHAT_LIST_DEFAULT_WIDTH });
    await openDisclosure(page, "application");
    const chip = page.getByTestId("pwa-install-variant");
    await expect(chip).toBeVisible();

    const stadium = async () =>
      await chip.evaluate((el) => {
        const radius = Number.parseFloat(getComputedStyle(el).borderTopLeftRadius);
        return { stadium: radius >= el.getBoundingClientRect().height, radius };
      });

    await setColumnWidth(page, CHAT_LIST_DEFAULT_WIDTH);
    const narrow = await stadium();
    expect(
      narrow.stadium,
      `the chip is still an ellipse at the default column (${narrow.radius}px)`,
    ).toBe(false);

    await setColumnWidth(page, CHAT_LIST_MIN_WIDTH);
    expect((await stadium()).stadium, "and at the narrowest, where it wraps hardest").toBe(false);

    // The other half of the pair, and the half a `sm:` mutation would keep
    // green on its own: dragged wide the chip fits on one line and is a pill
    // again, exactly as it has always been.
    await setColumnWidth(page, CHAT_LIST_MAX_WIDTH);
    const wide = await stadium();
    expect(wide.stadium, "dragged wide, the chip is a pill again").toBe(true);
  });
});

test.describe("the storage card", () => {
  test("keeps a column for the folder path at every width the handle allows", async ({
    page,
    request,
  }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 768, DESKTOP_ONLY);
    await requireFixtureServer(request);
    await openSettingsScreen(page, { columnWidth: CHAT_LIST_DEFAULT_WIDTH, desktopShell: true });
    await openDisclosure(page, "application");
    await expect(page.getByTestId("desktop-storage-card")).toBeVisible();

    // This grid had no gate at all, so the actions held a third column at every
    // width and took it at their own max-content — 327px of buttons against a
    // 224px card, which left the path a track **0px wide**.
    for (const width of [CHAT_LIST_MIN_WIDTH, CHAT_LIST_DEFAULT_WIDTH, CHAT_LIST_MAX_WIDTH]) {
      await setColumnWidth(page, width);
      const tracks = await gridTracks(page, "desktop-storage-card");
      expect(tracks.length, `the actions must not hold a column at a ${width}pt column`).toBe(2);
      expect(tracks[1], `the path is squeezed out at a ${width}pt column`).toBeGreaterThan(120);
    }
  });

  test("takes its row form only where there is room for it, which is the sheet", async ({
    page,
    request,
  }) => {
    const viewport = page.viewportSize()?.width ?? 0;
    test.skip(viewport >= 768, SHEET_ONLY);
    await requireFixtureServer(request);
    await openSettingsScreen(page, { desktopShell: true });
    await openDisclosure(page, "application");
    await expect(page.getByTestId("desktop-storage-card")).toBeVisible();

    await page.setViewportSize({ width: WIDEST_SHEET, height: 900 });
    await page.waitForTimeout(300);
    const wide = await gridTracks(page, "desktop-storage-card");
    expect(wide.length, "the widest sheet is the one place both buttons fit beside the path").toBe(
      3,
    );
    expect(wide[1], "and the path still gets a real column there").toBeGreaterThan(200);

    await page.setViewportSize({ width: viewport, height: 900 });
    await page.waitForTimeout(300);
    expect((await gridTracks(page, "desktop-storage-card")).length, "on a phone it stacks").toBe(2);
  });
});
