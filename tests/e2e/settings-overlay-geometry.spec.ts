import { expect, type Page, type TestInfo, test } from "@playwright/test";
import {
  SETTINGS_CONTENT_MEASURE,
  settingsOverlayHeight,
  settingsOverlayWidth,
} from "../../artifacts/kub/src/lib/settingsSurface";
import { CHAT_LIST_MAX_WIDTH, CHAT_LIST_MIN_WIDTH } from "../../artifacts/kub/src/lib/desktopChatList";
import { requireFixtureServer } from "./helpers/messageActionsFixture";
import { openSettingsScreen, setColumnWidth } from "./helpers/settingsColumnFixture";

/**
 * D-285: the settings stopped being as wide as the chat list.
 *
 * **The defect, measured on this fixture at 1440 before the change.** The
 * screen was the list column's body (D-160), the list is dragged by hand, and
 * `CHAT_LIST_MIN_WIDTH` floors it at 260 — so the settings inherited a decision
 * about how much room conversations get:
 *
 *   | column | surface | «Имя» input | of «Максим Орлов» hidden |
 *   | ------ | ------- | ----------- | ------------------------ |
 *   |    260 |     260 |        66px |                 **58px** |
 *   |    300 |     300 |       106px |                     18px |
 *   |    360 |     360 |       166px |                        0 |
 *   |    540 |     540 |       346px |                        0 |
 *
 * At the floor a person cannot read their own name back, which is the owner's
 * «криво» and is not cosmetic.
 *
 * **Every test here fails against the shipped layout**, which is the point of
 * writing them this way round: the first two because the surface *was* the
 * column and moved with it, the third because there was no dim to click.
 *
 * The one contract this must not buy its width with is D-160's own — a label
 * and its value within a readable distance — so that is asserted here too, at
 * the widest the panel ever gets. `settings-column.spec.ts` owns the same rule
 * and holds the number.
 */

const OUT = process.env.KUB_D285_OUT ?? "output/d285";
const DESKTOP_ONLY = "the overlay is the form from md; below it the sheet is unchanged";

async function shoot(page: Page, file: string, info: TestInfo) {
  await page.evaluate(() => document.fonts.ready);
  // The rail scrolls smoothly, and a frame taken while it is still moving
  // shows the mark on the section the reading line happens to be over rather
  // than on the one that was clicked. That is a true intermediate state and a
  // misleading photograph, so the shutter waits for the scroller to stop.
  await page.waitForFunction(() => {
    const el = document.querySelector("[data-testid='settings-scroll']");
    if (!el) return true;
    const w = window as unknown as { __kubLastTop?: number; __kubStill?: number };
    const now = el.scrollTop;
    if (w.__kubLastTop === now) w.__kubStill = (w.__kubStill ?? 0) + 1;
    else w.__kubStill = 0;
    w.__kubLastTop = now;
    return (w.__kubStill ?? 0) >= 3;
  }, undefined, { polling: 100 });
  await page.evaluate(() => {
    const w = window as unknown as { __kubLastTop?: number; __kubStill?: number };
    w.__kubLastTop = undefined;
    w.__kubStill = 0;
  });
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/${file}-${info.project.name}.png` });
}

/**
 * The box of the settings panel itself, in CSS pixels, **after its entrance**.
 *
 * `kub-modal-panel-in` opens from `scale(0.99)`, so a box read on the first
 * frame is 1234 where the layout says 1240 — a six-pixel lie that reads as a
 * wrong constant. Interface-material rule 14 is the same point from the other
 * side: a surface that animates in must not be measured while it is doing it.
 */
async function panelBox(page: Page) {
  const panel = page.getByTestId("settings-overlay");
  await expect(panel).toBeVisible();
  await page.waitForFunction(() => {
    const node = document.querySelector("[data-testid='settings-overlay']");
    if (!node) return false;
    // Scoped to the panel, never `document.getAnimations()`: a spinner
    // elsewhere on the page runs for ever and would never let this return.
    return node.getAnimations().every((animation) => animation.playState === "finished");
  });
  const box = await panel.boundingBox();
  expect(box, "the settings overlay has no box").not.toBeNull();
  return box!;
}

test.describe("D-285: settings is a surface over the application, not a state of the list", () => {
  test("its width is the window's business and never the chat list's", async ({ page, request }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 768, DESKTOP_ONLY);
    await requireFixtureServer(request);
    await openSettingsScreen(page, { columnWidth: CHAT_LIST_MIN_WIDTH, webFont: true });

    // 1. At the floor the person dragged the list to, the panel is the window's
    // width, not the list's. Against the shipped layout this reads 260.
    const atFloor = await panelBox(page);
    const viewport = page.viewportSize()!;
    expect(Math.round(atFloor.width)).toBe(settingsOverlayWidth(viewport.width));
    expect(Math.round(atFloor.height)).toBe(settingsOverlayHeight(viewport.height));

    // 2. And dragging the list the whole way to its maximum moves nothing. This
    // is the mutation that catches a panel re-bound to `--kub-chat-list-width`
    // by any road: 260 and 540 have to produce the same number.
    await setColumnWidth(page, CHAT_LIST_MAX_WIDTH);
    await page.waitForTimeout(200);
    const atCeiling = await panelBox(page);
    expect(
      Math.round(atCeiling.width),
      "the settings panel followed the chat list again",
    ).toBe(Math.round(atFloor.width));

    // 3. The list is still on screen behind it at the width it was dragged to —
    // opening the settings does not cost the person their conversations.
    const region = await page.locator("[data-kub-left-region]").boundingBox();
    expect(region, "the left region is gone while the settings are open").not.toBeNull();

    // 4. The dim the owner asked to click is real: the panel keeps a band on
    // every side rather than filling the window.
    //
    // Literals, not `SETTINGS_OVERLAY_GUTTER_*`. Written against the constants
    // these two lines survive setting the gutter to 0 — «at least -1 pixels» —
    // which is how the mutation pass found them. 24 points is what a pointer
    // needs; the unit test holds the same floor across every viewport, which
    // is where a gutter of 0 actually bites (at 1440 the 1100 cap hides it).
    expect(Math.round(atFloor.x), "no dim to the left of the panel").toBeGreaterThanOrEqual(24);
    expect(Math.round(atFloor.y), "no dim above the panel").toBeGreaterThanOrEqual(24);
  });

  test("what was typed can be read back, at every width the list allows", async ({ page, request }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 768, DESKTOP_ONLY);
    await requireFixtureServer(request);
    await openSettingsScreen(page, { columnWidth: CHAT_LIST_MIN_WIDTH, webFont: true });

    for (const width of [CHAT_LIST_MIN_WIDTH, 300, 360, CHAT_LIST_MAX_WIDTH]) {
      await setColumnWidth(page, width);
      await page.waitForTimeout(150);
      const clipped = await page.evaluate(() => {
        const inputs = Array.from(
          document.querySelectorAll<HTMLInputElement>("[data-testid='settings-scroll'] input"),
        ).filter((input) => input.type === "text" || input.type === "");
        return inputs
          .map((input) => ({
            value: input.value || input.placeholder,
            hidden: input.scrollWidth - input.clientWidth,
            width: Math.round(input.getBoundingClientRect().width),
          }))
          .filter((entry) => entry.hidden > 1);
      });
      expect(
        clipped,
        `at a ${width}px chat list these fields still cut what is in them`,
      ).toEqual([]);
    }
  });

  test("a click on the dim beside the panel closes it, and so does the ✕", async ({ page, request }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 768, DESKTOP_ONLY);
    await requireFixtureServer(request);
    await openSettingsScreen(page, { columnWidth: CHAT_LIST_MIN_WIDTH, webFont: true });

    // «либо по затемнению в любом месте сбоку от окна настроек» — beside it, so
    // the click lands in the gutter to the left of the panel rather than in a
    // corner, which is the place a person actually reaches for.
    const box = await panelBox(page);
    await page.mouse.click(Math.round(box.x / 2), Math.round(box.y + box.height / 2));
    await expect(page.getByTestId("settings-overlay")).toHaveCount(0);

    await openSettingsScreen(page, { columnWidth: CHAT_LIST_MIN_WIDTH, webFont: true });
    await page.getByTestId("settings-close").click();
    await expect(page.getByTestId("settings-overlay")).toHaveCount(0);
  });

  test("the width it takes is not spent stranding a value from its label", async ({ page, request }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 768, DESKTOP_ONLY);
    await requireFixtureServer(request);
    await openSettingsScreen(page, { columnWidth: 360, webFont: true });

    // D-160's rule, at the width this change introduces. The measure is what
    // holds it: remove the cap and a 1008px content pane strands «Виден» 777px
    // from «Статус «в сети»», which is worse than the 570 D-160 recorded.
    const measured = await page.evaluate(() => {
      const box = document.querySelector<HTMLElement>("[data-testid='settings-measure']");
      return box ? Math.round(box.getBoundingClientRect().width) : null;
    });
    expect(measured).toBeLessThanOrEqual(SETTINGS_CONTENT_MEASURE);

    const gaps = await page.evaluate(() => {
      const root = document.querySelector("[data-testid='settings-scroll']");
      if (!root) return [];
      const out: { label: string; gap: number }[] = [];
      for (const row of Array.from(root.querySelectorAll("*"))) {
        if (typeof row.className !== "string" || !row.className.includes("min-h-11")) continue;
        const line = Array.from(row.querySelectorAll("span")).find(
          (el) =>
            typeof el.className === "string"
            && el.className.includes("justify-between")
            && el.className.includes("flex-wrap"),
        );
        if (!line || line.children.length < 2) continue;
        const a = line.children[0].getBoundingClientRect();
        const b = line.children[1].getBoundingClientRect();
        if (a.width === 0 || b.width === 0) continue;
        const sameLine = Math.abs(a.top + a.height / 2 - (b.top + b.height / 2)) < 12;
        out.push({
          label: (line.children[0].textContent ?? "").trim(),
          gap: sameLine ? Math.round(b.left - a.right) : 0,
        });
      }
      return out;
    });
    expect(gaps.length, "no label/value rows were measured").toBeGreaterThan(0);
    for (const row of gaps) {
      expect(row.gap, `«${row.label}» is ${row.gap}px from its value`).toBeLessThan(360);
    }
  });

  test("the rail reaches every section the screen has", async ({ page, request }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 768, DESKTOP_ONLY);
    await requireFixtureServer(request);
    await openSettingsScreen(page, { columnWidth: 360, webFont: true });

    const rail = page.getByTestId("settings-rail");
    await expect(rail).toBeVisible();
    await expect(rail.locator("button")).toHaveCount(4);

    // The bottom section is below the fold on arrival; one click is the whole
    // point of the rail, and the scroller has to actually move.
    const before = await page.evaluate(
      () => document.querySelector("[data-testid='settings-scroll']")!.scrollTop,
    );
    await page.getByTestId("settings-rail-application").click();
    await page.waitForTimeout(600);
    const after = await page.evaluate(
      () => document.querySelector("[data-testid='settings-scroll']")!.scrollTop,
    );
    expect(after, "the rail did not move the scroller").toBeGreaterThan(before);
    await expect(page.getByTestId("settings-rail-application")).toHaveAttribute("data-current", "true");
  });
});

test.describe("D-285 frames", () => {
  for (const theme of ["dark", "light"] as const) {
    test(`the overlay, ${theme}`, async ({ page, request }, info) => {
      test.skip((page.viewportSize()?.width ?? 0) < 768, DESKTOP_ONLY);
      await requireFixtureServer(request);
      await openSettingsScreen(page, { theme, columnWidth: CHAT_LIST_MIN_WIDTH, webFont: true });
      await shoot(page, `overlay-${theme}`, info);
      await page.getByTestId("settings-rail-application").click();
      await shoot(page, `overlay-app-${theme}`, info);
    });

    test(`the narrow window, ${theme}`, async ({ page, request }, info) => {
      test.skip((page.viewportSize()?.width ?? 0) !== 1440, "one viewport drives this; 1440 is it");
      await requireFixtureServer(request);
      await openSettingsScreen(page, { theme, columnWidth: CHAT_LIST_MIN_WIDTH, webFont: true });
      // The two widths either side of `SETTINGS_RAIL_MIN_PANEL`, where the rail
      // stops being worth what it costs the content and folds into it.
      for (const width of [1024, 900, 820, 768]) {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForTimeout(250);
        await shoot(page, `narrow-${width}-${theme}`, info);
      }
    });

    test(`the phone sheet, ${theme}`, async ({ page, request }, info) => {
      test.skip((page.viewportSize()?.width ?? 0) >= 768, "the sheet is the form below md");
      await requireFixtureServer(request);
      await openSettingsScreen(page, { theme, webFont: true });
      await shoot(page, `sheet-${theme}`, info);
    });
  }
});
