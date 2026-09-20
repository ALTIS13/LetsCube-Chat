import { expect, type Page, test } from "@playwright/test";
import { surfaceFormContentWidth } from "../../artifacts/kub/src/lib/surfaceMeasure";
import { openAdminFixture, openAdmin, person } from "./helpers/adminFixture";
import { openBotSettings } from "./helpers/botSettingsFixture";

/**
 * Item 39: the surfaces that are not the messenger, at the narrow end and the
 * wide end.
 *
 * The owner asked for the settings treatment «по возможности» on the bots
 * page, the administration and «Задачи», and gave the acceptance test himself:
 * «обязательно проверь что все функции корректно помещаются и отображаются
 * удобно для пользователя на маленьком и большом разрешении». This is that
 * test, written as three contracts against measured numbers rather than
 * against an impression that a screen «fits».
 *
 * **What the audit found, before anything was changed** — the fixtures below,
 * both themes, four viewports:
 *
 *   | surface | viewport | measured |
 *   | ------- | -------- | -------- |
 *   | «Мои боты» title | 390 | a 6px box; 63px of «Мои боты» scrolled out of it |
 *   | «Мои боты» page | 360 | 8px past the right edge of the window |
 *   | bot settings «Название» | 1440 | a 980px field holding 48px of content |
 *   | bot settings «Название» | 1920 | a 1460px field holding the same 48px |
 *   | administration tab strip | 390 | on «Поддержка» the marked tab sits 679px past the strip's right edge, `scrollLeft` 0 |
 *
 * **And what it found fine, which is recorded because leaving a surface alone
 * has to be a measurement too.** «Задачи» has no finding at any of the four
 * widths beyond an honest 22px ellipsis on its subtitle at 360, and the
 * administration's own content is already capped at `max-w-5xl` and centred —
 * 1024 at both 1440 and 1920 — so the wide end of those two is not this
 * change's to touch.
 */

const OUT = process.env.KUB_ITEM39_OUT ?? "output/item39";
const WIDE_ONLY = "the measure binds only where the pane is wider than it";
const NARROW_ONLY = "the strip only scrolls where it is narrower than its own contents";

function width(page: Page) {
  return page.viewportSize()?.width ?? 0;
}

/**
 * How much of an element's own text is scrolled out of the box it is drawn in.
 *
 * D-285's instrument, unchanged: it is the number that turned «криво» from an
 * impression into 58 pixels of a person's own name.
 */
async function hiddenText(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    return {
      text: (el.textContent ?? "").trim(),
      box: Math.round(el.getBoundingClientRect().width),
      hidden: el.scrollWidth - el.clientWidth,
    };
  }, selector);
}

test.describe("a page keeps its own name", () => {
  /**
   * The narrow end, and the defect in one number.
   *
   * `KubHeader` gives the title `flex-1 min-w-0` and its trailing controls
   * `flex-shrink-0`, so the title is the only box in the row that can give —
   * and on this page it gave 91% of itself to a «Документация» link and a
   * «Создать бота» button that between them wanted more than a 390pt row has.
   *
   * Two assertions, and they answer different questions: the first that the
   * title is whole, the second that the row it sits in did not buy that by
   * drawing a control where nobody can press it. Either alone passes on a
   * layout the other convicts.
   */
  test("«Мои боты» draws its title whole and stays inside the window", async ({ page }, info) => {
    test.skip(width(page) >= 768, "the row is only contested where it is narrow");
    await openBotSettings(page, { webFont: true });

    const title = await hiddenText(page, "[data-testid='bots-page'] header h1");
    expect(title, "the page draws no title at all").not.toBeNull();
    expect(title?.text).toBe("Мои боты");
    expect(
      title?.hidden,
      `«${title?.text}» is cut off in a ${title?.box}px box; it was a 6px box at 390 before item 39`,
    ).toBeLessThanOrEqual(1);

    /**
     * And nothing in the row is drawn outside it.
     *
     * **This replaced an assertion on `documentElement.scrollWidth`, which was
     * measuring the wrong box and said so under mutation.** `bots-page` is
     * `overflow-hidden`, so a header that does not fit is clipped inside the
     * page and the document never reports a pixel of it: with both labels put
     * back, «Создать бота» is drawn past the right edge and cannot be pressed,
     * and the document-level check stayed green through all of it. The audit
     * had seen the truth — `clipped 8px` on `bots-page` itself at 360 — and
     * the first contract asked the wrong element about it.
     *
     * The instrument is `bot-settings-container-queries.spec.ts`'s own, which
     * found the same class of defect on the command row: measure the control
     * against the box that is supposed to contain it.
     */
    const escaped = await page.evaluate(() => {
      const header = document.querySelector("[data-testid='bots-page'] header");
      if (!header) return null;
      const box = header.getBoundingClientRect();
      return [...header.querySelectorAll("a, button")]
        .map((control) => {
          const r = control.getBoundingClientRect();
          return {
            name: (control.getAttribute("aria-label") ?? control.textContent ?? "").trim().slice(0, 30),
            past: Math.round(Math.max(r.right - box.right, box.left - r.left)),
          };
        })
        .filter((control) => control.past > 0.5);
    });
    expect(escaped, "the page draws no header").not.toBeNull();
    expect(escaped, "a control is drawn outside the header row").toEqual([]);

    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${OUT}/fit-bots-header-${info.project.name}.png` });
  });

  /**
   * The subtitle is the same box and the same mechanism, asserted separately
   * because the two lines truncate independently: at 390 the title kept 6px
   * and so did «1 из 3», and a contract on the title alone would have called
   * that fixed while the reader still could not see how many bots they have.
   */
  test("«Мои боты» draws what it says about itself, too", async ({ page }) => {
    test.skip(width(page) >= 768, "the row is only contested where it is narrow");
    await openBotSettings(page, { webFont: true });
    const subtitle = await hiddenText(page, "[data-testid='bots-page'] header h1 + *, [data-testid='bots-page'] header div > div:nth-child(2)");
    expect(subtitle, "the header draws no subtitle").not.toBeNull();
    expect(
      subtitle?.hidden,
      `«${subtitle?.text}» is cut off in a ${subtitle?.box}px box; 29 of its 35px were gone at 390`,
    ).toBeLessThanOrEqual(1);
  });
});

test.describe("the bot settings column stops at its measure", () => {
  /**
   * The wide end. A field 1460px across holding 48px of a word is the same
   * defect D-160 reported from the other side — a row so wide that what it
   * holds and what it is for stop being in the same glance.
   *
   * The assertion is on the **rendered** column rather than on the class that
   * caps it: D-285 records that a value clamped in two places let a mutation
   * of one of them pass, so what is read here is the box.
   */
  test("the column is 696 wide however wide the pane is", async ({ page }, info) => {
    test.skip(width(page) < 1096, WIDE_ONLY);
    await openBotSettings(page, { webFont: true });

    const measured = await page.evaluate(() => {
      const pane = document.querySelector("[data-testid='bots-detail-pane']");
      const column = document.querySelector("[data-testid='bot-settings-measure']");
      if (!pane || !column) return null;
      const style = getComputedStyle(column);
      return {
        pane: Math.round(pane.getBoundingClientRect().width),
        box: Math.round(column.getBoundingClientRect().width),
        content:
          Math.round(column.getBoundingClientRect().width)
          - Math.round(parseFloat(style.paddingLeft))
          - Math.round(parseFloat(style.paddingRight)),
        left: Math.round(column.getBoundingClientRect().left - pane.getBoundingClientRect().left),
        right: Math.round(pane.getBoundingClientRect().right - column.getBoundingClientRect().right),
      };
    });
    expect(measured, "the bot settings panel draws no measured column").not.toBeNull();
    if (!measured) return;

    /**
     * 696 written out, not `SURFACE_FORM_MEASURE`.
     *
     * The first version of this line read the constant it was testing, and the
     * mutation proved what that is worth: widening the measure to 900 widened
     * the cap with it, the column came out at 900, and the assertion agreed
     * with itself and passed. D-285 recorded the identical failure on the
     * settings gutter. **A contract that reads its own subject cannot fail.**
     *
     * The second line is a different question and keeps the constant on
     * purpose: whether the module's arithmetic and the rendered box still
     * describe the same layout. It catches a cap applied to the wrong element;
     * the literal above catches the number moving.
     */
    expect(measured.content, "the column is not Discord's 696").toBe(696);
    expect(
      measured.content,
      "the module and the rendered box disagree about this pane",
    ).toBe(surfaceFormContentWidth(measured.pane));

    // Centred, as Discord's is and as the settings' own is. Written as a
    // difference rather than as a pair of numbers so it holds at every pane.
    expect(Math.abs(measured.left - measured.right)).toBeLessThanOrEqual(1);

    // The field the audit measured: 980px at 1440 and 1460px at 1920, holding
    // 48px of «Смены». `type` is left off in the source, so it is asked for by
    // exclusion rather than by `input[type=text]`, which matched nothing.
    const field = await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>(
        "[data-testid='bots-detail-pane'] input:not([type='checkbox']):not([type='radio']):not([type='file'])",
      );
      return input ? Math.round(input.getBoundingClientRect().width) : null;
    });
    expect(field, "the «Основное» tab draws no text field").not.toBeNull();
    expect(
      field ?? 0,
      "the field is wider than the column that is supposed to hold it",
    ).toBeLessThanOrEqual(696);

    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${OUT}/fit-bots-measure-${info.project.name}.png` });
  });
});

test.describe("the administration says which section you are in", () => {
  /**
   * The strip scrolls; nothing ever scrolled it.
   *
   * Measured at 390 before the change: on `/admin/support` the marked tab sat
   * **679px past the right edge** of a 390px strip with `scrollLeft` at 0, and
   * on `/admin/roles` 206px past it. So on a phone the only navigation the
   * administration has showed four sections the reader was not in and not the
   * one they were.
   *
   * Two paths are walked, not one: a tab far enough out that the browser has
   * to scroll a long way, and one just over the edge. A fix that only handles
   * the first — `scrollIntoView` with the wrong `inline` — passes one and
   * fails the other.
   */
  for (const [path, label] of [
    ["/admin/support", "Поддержка"],
    ["/admin/roles", "Роли и права"],
  ] as const) {
    test(`«${label}» is in view on the strip`, async ({ page }, info) => {
      test.skip(width(page) >= 768, NARROW_ONLY);
      await openAdminFixture(page, {
        me: person("11111111-1111-4111-8111-000000000039", "Максим Орлов", "maksim"),
        globalRoleKeys: ["owner"],
        globalPermissionKeys: ["system.manage", "support.view"],
      });
      await openAdmin(page, path);

      const marked = await page.evaluate(() => {
        const strip = document.querySelector("[data-testid='admin-tabs']");
        if (!strip) return "no strip";
        const current = strip.querySelector("[aria-current='page']");
        if (!current) return "no marked tab";
        const s = strip.getBoundingClientRect();
        const c = current.getBoundingClientRect();
        return {
          label: (current.textContent ?? "").trim(),
          offLeft: Math.round(s.left - c.left),
          offRight: Math.round(c.right - s.right),
        };
      });
      expect(typeof marked, `the strip could not be read: ${marked}`).not.toBe("string");
      if (typeof marked === "string") return;

      expect(marked.label, "a different tab is marked").toContain(label);
      expect(marked.offRight, "the marked tab is past the right edge of the strip").toBeLessThanOrEqual(0);
      expect(marked.offLeft, "the marked tab is past the left edge of the strip").toBeLessThanOrEqual(0);

      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `${OUT}/fit-admin-${label}-${info.project.name}.png` });
    });
  }
});
