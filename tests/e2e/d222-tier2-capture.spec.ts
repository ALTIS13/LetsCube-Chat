import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { expect, type Page, type TestInfo, test } from "@playwright/test";
import { openBotSettings, openBotTab } from "./helpers/botSettingsFixture";
import {
  CONTAINERS,
  installMeasure,
  interIsDrawing,
  type Probe,
  probe,
  TIER_2,
} from "./helpers/d222Measure";
import { openSupportTicket } from "./helpers/supportTicketFixture";

/**
 * A photograph of D-222's tier 2, not a contract.
 *
 * The entry is explicit about how this has to start: «Worth one screenshot each
 * at 768 and 1024 before anybody edits them — tier 2 is arithmetic, not
 * observed pixels». So this exists to produce the pixels and the measurements
 * for the eight lines it names, at the two viewports it names, in both themes,
 * and it asserts nothing about the design.
 *
 * Why 768 and 1024 specifically. Both surfaces sit behind a fixed side column
 * — `BotsPage` `md:grid-cols-[22rem_…]`, `SupportTab` the same — so the pane a
 * card is drawn in is the viewport minus 352px, and it is at its **narrowest**
 * the instant `md:` turns on. 768 is that instant; 1024 is where
 * `SupportTicketDetails`'s `lg:` splits the pane again.
 *
 * Inter is let through, as the tier-1 capture spec does and for the same
 * measured reason: the fixtures abort every off-machine request, the Windows
 * fallback is Segoe UI, and Segoe is narrow enough to hide the very crowding
 * this is a photograph of. `interIsDrawing` proves the face is on the page by
 * measuring an advance width, because `document.fonts.check` answers true for
 * a face that never loaded.
 *
 * Nothing on screen is anybody's data: invented bot, invented ticket, invented
 * people, and the only token-shaped string is a fictional prefix.
 *
 * `KUB_D222_TIER2_OUT` names the folder; it defaults to one under `output/`.
 */

const OUT = process.env.KUB_D222_TIER2_OUT ?? "output/d222-tier2";
/**
 * 768 and 1024 are the two the register asks for. 700 is the third because it
 * is the width that makes the mechanism visible: `sm:` answers the same thing
 * at 700 and at 768, and the pane behind it is 700px at one and 416px at the
 * other — one media state, two containers, two required answers.
 */
const VIEWPORTS = [700, 768, 1024] as const;
/** Tall enough that a card is not cut in half, short enough to stay a window. */
const HEIGHT = 1000;

type Reading = Record<string, Probe[]>;
const report: Record<string, Reading> = {};

function record(key: string, readings: Reading) {
  report[key] = readings;
}

test.afterAll(() => {
  if (Object.keys(report).length === 0) return;
  const file = `${OUT}/measurements.json`;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, "utf8");
});

async function measure(page: Page): Promise<Reading> {
  const readings: Reading = {};
  for (const [name, selector] of Object.entries({ ...CONTAINERS, ...TIER_2 })) {
    const found = await probe(page, selector);
    if (found.length > 0) readings[name] = found;
  }
  return readings;
}

async function shoot(page: Page, file: string, info: TestInfo) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  mkdirSync(dirname(file), { recursive: true });
  await page.screenshot({ path: file });
  info.annotations.push({ type: "capture", description: file });
}

async function atWidth(page: Page, width: number) {
  await page.setViewportSize({ width, height: HEIGHT });
  await page.waitForTimeout(250);
}

for (const theme of ["dark", "light"] as const) {
  for (const width of VIEWPORTS) {
    test(`the bot settings panel at ${width} (${theme})`, async ({ page }, info) => {
      test.skip(
        (page.viewportSize()?.width ?? 0) < 768,
        "both surfaces put a 22rem side column beside the pane only from md upward",
      );
      await installMeasure(page);
      await atWidth(page, width);
      await openBotSettings(page, { theme, webFont: true });
      expect(await interIsDrawing(page), "the shipped face is not on the page").toBe(true);

      const readings: Reading = {};
      const pane = page.getByTestId("bots-detail-pane");
      await expect(pane).toBeVisible();

      // «Основное»: the tab strip, and the state row at L223.
      await shoot(page, `${OUT}/png/bots-main-${width}-${theme}.png`, info);
      await page
        .locator("[role='tablist']")
        .screenshot({ path: `${OUT}/png/bots-tabs-${width}-${theme}.png` });
      Object.assign(readings, await measure(page));

      // «API»: the command grid at L243, the two button rows at L250/L266, the
      // privacy row at L278 and the token row at L287.
      await openBotTab(page, "API");
      await page.waitForTimeout(200);
      await shoot(page, `${OUT}/png/bots-api-top-${width}-${theme}.png`, info);
      Object.assign(readings, await measure(page));

      const scroller = pane.locator("div.overflow-y-auto").first();
      await scroller.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
      await page.waitForTimeout(250);
      await shoot(page, `${OUT}/png/bots-api-bottom-${width}-${theme}.png`, info);

      // The other two tabs, at the narrowest width only. Neither is on the
      // tier-2 list, and that is exactly why they are here: a fix on this panel
      // reaches them through the one `Section` every tab is built from, so the
      // frame that says «nothing else moved» is part of the evidence.
      if (width === 768) {
        for (const tab of ["Команда", "Диагностика"] as const) {
          await openBotTab(page, tab);
          await page.waitForTimeout(200);
          const slug = tab === "Команда" ? "team" : "diagnostics";
          await shoot(page, `${OUT}/png/bots-${slug}-${width}-${theme}.png`, info);
        }
      }

      record(`bots-${width}-${theme}`, readings);
    });

    test(`the support ticket pane at ${width} (${theme})`, async ({ page }, info) => {
      test.skip(
        (page.viewportSize()?.width ?? 0) < 768,
        "both surfaces put a 22rem side column beside the pane only from md upward",
      );
      await installMeasure(page);
      await atWidth(page, width);
      await openSupportTicket(page, { theme, webFont: true });
      expect(await interIsDrawing(page), "the shipped face is not on the page").toBe(true);

      await shoot(page, `${OUT}/png/support-ticket-${width}-${theme}.png`, info);
      record(`support-${width}-${theme}`, await measure(page));
    });
  }
}
