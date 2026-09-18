import { expect, type Page, test } from "@playwright/test";
import { openBotSettings, openBotTab } from "./helpers/botSettingsFixture";
import { installMeasure, probe, TIER_2 } from "./helpers/d222Measure";

/**
 * D-222 tier 2: the two lines in the bot settings panel whose layout is decided
 * by the box they are drawn in rather than by the window.
 *
 * **The instrument is a pair of viewports, and that is the whole point.** Tier 1
 * could take two container widths at one viewport because the chat-list column
 * is dragged by hand. Nothing here is dragged — the detail pane is the whole
 * window below `md` and the window minus a fixed 22rem list above it — so the
 * pair is built the other way round:
 *
 * - **Pair A, one media state and two containers.** `sm:` is true at a 700pt
 *   window and true at a 768pt window, and the section behind it is 652px at
 *   one and 368px at the other, because 768 is the instant the 22rem list
 *   appears beside it. The two must lay out differently. Put `sm:` back and the
 *   768 half goes red while the 700 half keeps passing for the wrong reason.
 * - **Pair B, one container and two media states.** A 700pt window and a 1052pt
 *   window give the *same* 652px section — 1052 minus the 352px list is 700 —
 *   while `md:` is false at one and true at the other. The two must lay out
 *   identically, which is what forbids swapping `sm:` for a different viewport
 *   number instead of fixing the mechanism.
 *
 * Nothing here asserts that `container-type` is declared: a declaration is not
 * a surface. What is asserted is the layout the reader gets.
 *
 * Deliberately font-independent, for the reason D-222 records: the fixture
 * aborts every off-machine request, so this runs on the Segoe UI fallback while
 * production runs on Inter, and Segoe is narrow enough to hide a wrap that
 * ships. Track counts, track widths and flex direction do not move with the
 * font. The pixels are `d222-tier2-capture.spec.ts`.
 */

const DESKTOP_ONLY = "the 22rem list sits beside the pane only from md upward";
const PHONE_ONLY = "the phone form is what the narrow projects are for";

/** Same `sm:` answer, different container. */
const PAIR_A = { wide: 700, narrow: 768 } as const;
/** Same container, different `md:` answer. 1052 − 352 = 700. */
const PAIR_B = { small: 700, large: 1052 } as const;

/** The section, which is the box the thresholds are measured against. */
async function sectionWidth(page: Page) {
  const found = await probe(page, 'section[aria-labelledby^="bot-section-"]');
  expect(found.length, "the API tab draws no sections").toBeGreaterThan(0);
  return found[0].box.width;
}

async function resize(page: Page, width: number) {
  await page.setViewportSize({ width, height: 1000 });
  await page.waitForTimeout(250);
}

async function commandGrid(page: Page) {
  const rows = await probe(page, TIER_2["BotSettingsPanel L243 command grid"]);
  expect(rows.length, "the fixture seeds three commands").toBe(3);
  return rows[0];
}

async function buttonRows(page: Page) {
  const rows = await probe(page, TIER_2["BotSettingsPanel L250/L266 button rows"]);
  // «Команды» and «Webhook»; the webhook row is drawn whether or not one is set.
  expect(rows.length, "the API tab draws both two-button rows").toBe(2);
  return rows;
}

async function openApi(page: Page, width: number) {
  await resize(page, width);
  await openBotSettings(page);
  await openBotTab(page, "API");
  await page.waitForTimeout(200);
}

test.describe("the command row", () => {
  test("takes its three columns by the width of the section, not the window", async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 768, DESKTOP_ONLY);
    await installMeasure(page);
    await openApi(page, PAIR_A.wide);

    expect(await sectionWidth(page), "a 700pt window leaves the pane the whole width").toBe(652);
    expect(
      (await commandGrid(page)).tracks?.length,
      "a 652px section has room for command, description and delete",
    ).toBe(3);

    await resize(page, PAIR_A.narrow);
    expect(await sectionWidth(page), "at 768 the 22rem list takes 352 of the window").toBe(368);
    expect(
      (await commandGrid(page)).tracks?.length,
      "a 368px section does not, and `sm:` cannot tell it from the 652px one",
    ).toBe(1);
  });

  /**
   * The defect in its own terms, and the one assertion that is not about form.
   *
   * The three tracks resolve to 160 + 217 + 44 with two 8px gaps whatever the
   * section is, because the description field will not shrink past 217 — so in
   * a 334px content box the grid ran 103px past the pane and «удалить команду»
   * was drawn off the right edge of the window, with nothing to scroll it into
   * view.
   */
  test("never draws the delete button outside the pane", async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 768, DESKTOP_ONLY);
    await installMeasure(page);
    await openApi(page, PAIR_A.narrow);

    const escaped = await page.evaluate(() => {
      const pane = document.querySelector("[data-testid='bots-detail-pane']");
      if (!pane) throw new Error("the detail pane is not on screen");
      const right = pane.getBoundingClientRect().right;
      return [...document.querySelectorAll("[aria-label^='Удалить команду']")]
        .map((button) => Math.round((button.getBoundingClientRect().right - right) * 100) / 100)
        .filter((overshoot) => overshoot > 0.5);
    });
    expect(escaped, "a delete button is drawn past the right edge of the pane").toEqual([]);
  });

  test("lays out the same in two windows that give it the same section", async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 768, DESKTOP_ONLY);
    await installMeasure(page);
    await openApi(page, PAIR_B.small);
    const small = { section: await sectionWidth(page), grid: await commandGrid(page) };

    await resize(page, PAIR_B.large);
    const large = { section: await sectionWidth(page), grid: await commandGrid(page) };

    expect(large.section, "1052 minus the 352pt list is the 700pt window's own pane").toBe(
      small.section,
    );
    expect(large.grid.tracks, "the same section must produce the same tracks").toEqual(
      small.grid.tracks,
    );
  });
});

test.describe("the two-button rows", () => {
  test("take their row form by the width of the section, not the window", async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 768, DESKTOP_ONLY);
    await installMeasure(page);
    await openApi(page, PAIR_A.wide);

    // The widest pair needs 344.64px under Inter — 161.45 + 175.19 with the 8px
    // gap — and the content box is the section less 34. Asserted as the form
    // rather than as the fit, because the fixture has no Inter.
    for (const row of await buttonRows(page)) {
      expect(row.box.height, "a 652px section keeps both buttons on one row").toBeLessThan(60);
      expect(row.children.every((child) => child.width < row.box.width - 20)).toBe(true);
    }

    await resize(page, PAIR_A.narrow);
    for (const row of await buttonRows(page)) {
      // Stacked: each button runs the width of the row rather than being
      // squeezed beside its neighbour until its label breaks in two.
      expect(row.box.height, "a 368px section stacks them").toBeGreaterThan(60);
      for (const child of row.children) {
        expect(child.width, "a stacked button runs the width of the row").toBeCloseTo(
          row.box.width,
          1,
        );
      }
    }
  });

  test("lay out the same in two windows that give them the same section", async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 768, DESKTOP_ONLY);
    await installMeasure(page);
    await openApi(page, PAIR_B.small);
    const small = (await buttonRows(page)).map((row) => row.children.map((child) => child.width));

    await resize(page, PAIR_B.large);
    const large = (await buttonRows(page)).map((row) => row.children.map((child) => child.width));

    expect(large, "the same section must produce the same buttons").toEqual(small);
  });
});

/**
 * The half that says the phone did not move.
 *
 * The thresholds are container widths, so they also decide the form below `md`,
 * where the pane is the whole window — and a number chosen for a 768pt desktop
 * could quietly have turned a phone's stacked controls into a squeezed row.
 * Every project in the narrow half of the matrix is 412 points or less, which
 * is a 380px section: under both thresholds, stacked, as it was.
 */
test("the phone keeps the stacked form it already had", async ({ page }) => {
  const width = page.viewportSize()?.width ?? 0;
  test.skip(width >= 768, PHONE_ONLY);
  await installMeasure(page);
  await openBotSettings(page);
  await openBotTab(page, "API");
  await page.waitForTimeout(200);

  expect(await sectionWidth(page), "the widest narrow project is 412 points").toBeLessThan(384);
  expect((await commandGrid(page)).tracks?.length, "the command row stays stacked").toBe(1);
  for (const row of await buttonRows(page)) {
    for (const child of row.children) {
      expect(child.width, "the buttons stay full width").toBeCloseTo(row.box.width, 1);
    }
  }
});
