import { expect, test, type Page } from "@playwright/test";
import {
  chat,
  membership,
  message,
  openFixture,
  person,
  requireFixtureServer,
  type Row,
} from "./helpers/messageActionsFixture";

/**
 * The sound settings, measured on the rendered page.
 *
 * `tests/unit/audio-settings-surface.test.mts` holds the words and reads the
 * class lists; a class list is not a pixel, so what those classes actually
 * paint, how tall the controls come out and whether anything is clipped are
 * measured here instead — at the two release widths, because the settings
 * screen is a ~350px column on a computer and a full-width dialog on a phone,
 * and every defect this section had showed at one of the two.
 *
 * Nothing here touches a backend: the fixture answers every request, and the
 * three writes the spec makes go to `localStorage`.
 */

const AT = "2026-09-14T09:00:00.000Z";
const ME = person("11111111-1111-4111-8111-000000000001", "Максим Орлов", "maksim");
const ANNA = person("11111111-1111-4111-8111-000000000002", "Анна Смирнова", "anna");
const TEAM = "22222222-2222-4222-8222-000000000001";

function seed(): { chats: Row[]; memberships: Row[]; messages: Row[] } {
  return {
    chats: [chat(TEAM, "group", "Команда проекта", AT)],
    memberships: [membership(TEAM, ME, "owner", AT), membership(TEAM, ANNA, "member", AT)],
    messages: [
      message(
        "55555555-5555-4555-8555-000000000001",
        TEAM,
        ANNA,
        "Смета на витрину готова, посмотри",
        "2026-09-14T10:00:00.000Z",
      ),
    ],
  };
}

async function openSound(page: Page) {
  await openFixture(page, { me: ME, people: [ANNA], ...seed() });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("chat-list-item")).toHaveCount(1);

  const phone = (page.viewportSize()?.width ?? 0) < 768;
  if (phone) {
    await page.getByRole("button", { name: "Меню" }).first().click();
    await page.getByRole("button", { name: "Настройки" }).first().click();
  } else {
    await page.getByTestId("side-menu-button").click();
    await page.getByTestId("side-menu-layer").getByRole("button", { name: "Настройки", exact: true }).click();
  }
  await expect(page.getByRole("heading", { name: "Профиль", exact: true })).toBeVisible();

  await page.getByTestId("settings-open-audio").click();
  const panel = page.getByTestId("settings-section-audio");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("audio-settings")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return panel;
}

test.describe("the sound settings speak the settings screen's own vocabulary", () => {
  test.beforeEach(async ({ request }) => {
    await requireFixtureServer(request);
  });

  /**
   * The defect the owner reported first: the section painted the application's
   * own page ground inside a panel, so it came out near-black against a
   * slate-blue screen and read as a hole rather than as part of it.
   *
   * Stated from the pixels rather than from the token: **no box inside the
   * panel paints a background colour at all.** What separates a group from the
   * panel is a step of material — a background *image* laid over whatever is
   * under it — which is rule 11 of the material contract and what every other
   * group on this screen is separated by. The exceptions are the controls
   * themselves and the one well a segmented track is cut into.
   */
  test("no box inside the panel paints a ground of its own", async ({ page }) => {
    await openSound(page);
    const painted = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>('[data-testid="settings-section-audio"]')!;
      // A control is allowed a fill; so is the picker's track, which is a well
      // rather than a box holding rows.
      const ALLOWED = 'button, select, input, [role="switch"], [role="meter"], [data-testid="audio-mode-picker"]';
      const out: string[] = [];
      for (const el of panel.querySelectorAll<HTMLElement>("*")) {
        if (el.closest(ALLOWED)) continue;
        const bg = getComputedStyle(el).backgroundColor;
        if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
          out.push(`${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 60)} => ${bg}`);
        }
      }
      return out;
    });
    expect(painted).toEqual([]);

    // And the material really is doing the separating, so the assertion above
    // cannot be satisfied by a section that stopped drawing groups at all.
    const veiled = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>('[data-testid="settings-section-audio"]')!;
      return [...panel.querySelectorAll<HTMLElement>("[data-audio-group] > div")].filter(
        (el) => getComputedStyle(el).backgroundImage !== "none",
      ).length;
    });
    expect(veiled).toBe(3);
  });

  /**
   * One level, not three. The section used to be an outer box holding an inner
   * box holding the rows, where everything else on the screen is a caption and
   * a list.
   */
  test("nothing inside the panel is nested inside anything else", async ({ page }) => {
    const panel = await openSound(page);
    const groups = panel.locator("[data-audio-group]");
    await expect(groups).toHaveCount(3);
    const nested = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>('[data-testid="settings-section-audio"]')!;
      return [...panel.querySelectorAll<HTMLElement>("[data-audio-group]")].filter(
        (el) => el.parentElement?.closest("[data-audio-group]"),
      ).length;
    });
    expect(nested).toBe(0);
  });

  /** The product says on and off with a switch. Two checkboxes said it here. */
  test("every on/off control is a switch", async ({ page }) => {
    const panel = await openSound(page);
    await expect(panel.locator('input[type="checkbox"]')).toHaveCount(0);
    // Noise suppression, echo cancellation, auto gain, self-monitoring.
    await expect(panel.getByRole("switch")).toHaveCount(4);
    await expect(panel.getByTestId("audio-self-monitor")).toBeDisabled();
    for (const id of ["audio-noise-suppression", "audio-echo-cancellation", "audio-auto-gain"]) {
      await expect(panel.getByTestId(id)).toHaveAttribute("aria-checked", "true");
    }
  });

  /**
   * The picker, and the one segment that is a state rather than a choice.
   *
   * It was three stacked full-width pills with a disabled third painted exactly
   * like the two that work; it is now the track the theme radiogroup two rows
   * above and «Лимит кэша» are both drawn as.
   */
  test("the picker is one track of three segments, and «Вручную» cannot be pressed", async ({ page }) => {
    const panel = await openSound(page);
    const picker = panel.getByTestId("audio-mode-picker");
    await expect(picker).toHaveAttribute("role", "radiogroup");
    await expect(picker.getByRole("radio")).toHaveCount(3);
    await expect(picker.locator('[aria-checked="true"]')).toHaveCount(1);
    await expect(picker.locator('[data-audio-mode="clean"]')).toHaveAttribute("aria-checked", "true");
    await expect(picker.locator('[data-audio-mode="custom"]')).toBeDisabled();

    // The three segments are one row of equal parts: a wrapped track is a
    // different object, and a `flex-wrap` is how one becomes one by accident.
    const geometry = await page.evaluate(() => {
      const segs = [...document.querySelectorAll<HTMLElement>("[data-audio-mode]")].map((el) => el.getBoundingClientRect());
      return {
        tops: [...new Set(segs.map((r) => Math.round(r.top)))].length,
        widths: [...new Set(segs.map((r) => Math.round(r.width)))].length,
      };
    });
    expect(geometry).toEqual({ tops: 1, widths: 1 });
  });

  /**
   * The current mode was printed twice — once as the right-hand value of «Как
   * звучит голос» and once, immediately under it, as the filled pill. The row
   * this panel opens from already prints it, so the readout inside the panel
   * was the third copy.
   */
  test("the current mode is named once inside the panel", async ({ page }) => {
    const panel = await openSound(page);
    const outsideThePicker = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('[data-testid="settings-section-audio"]')!;
      const picker = root.querySelector<HTMLElement>('[data-testid="audio-mode-picker"]')!;
      const active = picker.querySelector<HTMLElement>('[aria-checked="true"]')!.textContent!.trim();
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const hits: string[] = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent?.includes(active)) continue;
        if (picker.contains(node)) continue;
        hits.push(node.textContent.trim().slice(0, 60));
      }
      return hits;
    });
    expect(outsideThePicker).toEqual([]);
  });

  /**
   * The reset was a 162x16 text link at the bottom left. Every other action on
   * this screen is a row, and a row is 44px tall whatever the pointer.
   */
  test("the reset is a row, not a link", async ({ page }) => {
    const panel = await openSound(page);
    const reset = panel.getByTestId("audio-reset");
    await expect(reset).toBeVisible();
    const box = await reset.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    // As wide as the group it sits in: a row, not a word with a hit area.
    const rowIsFullWidth = await page.evaluate(() => {
      const reset = document.querySelector<HTMLElement>('[data-testid="audio-reset"]')!;
      const group = reset.parentElement!;
      return Math.round(reset.getBoundingClientRect().width) === Math.round(group.getBoundingClientRect().width);
    });
    expect(rowIsFullWidth).toBe(true);
  });

  /**
   * Nothing is clipped, and nothing has to be scrolled sideways.
   *
   * This is the check that caught the picker at 1440, where the settings column
   * gives a segment 87px, «Без обработки» needs 98.9 and a fixed height cut the
   * wrapped second line off the bottom of the pill.
   *
   * Measured with a `Range` over each control's contents rather than with
   * `scrollWidth`/`scrollHeight`, and that is not a style preference: put the
   * fixed height back and the segment reports `scrollHeight` **36 against a
   * clientHeight of 36** while its words end 6px below its content box. A
   * button overflows visibly, and a box with `overflow: visible` does not grow
   * its scrolling area for content that spills out of it — so the scroll-size
   * form of this check was green over exactly the defect it was written for.
   * The range rect is where the words actually are.
   *
   * The device select is measured against its own value for a related reason:
   * it clips its text internally without ever reporting an overflow.
   */
  test("no control is clipped at this width", async ({ page }) => {
    const panel = await openSound(page);
    const report = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('[data-testid="settings-section-audio"]')!;
      const clipped: string[] = [];
      for (const el of root.querySelectorAll<HTMLElement>("button, [data-audio-mode]")) {
        const box = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        const range = document.createRange();
        range.selectNodeContents(el);
        const text = range.getBoundingClientRect();
        if (text.width === 0 && text.height === 0) continue;
        const out = {
          top: Math.round(box.top + parseFloat(style.paddingTop) - text.top),
          bottom: Math.round(text.bottom - (box.bottom - parseFloat(style.paddingBottom))),
          left: Math.round(box.left + parseFloat(style.paddingLeft) - text.left),
          right: Math.round(text.right - (box.right - parseFloat(style.paddingRight))),
        };
        const worst = Math.max(out.top, out.bottom, out.left, out.right);
        if (worst > 1) {
          clipped.push(
            `${el.dataset.audioMode ?? el.dataset.testid ?? el.textContent?.trim().slice(0, 24)}: ` +
              `${worst}px outside its box (${JSON.stringify(out)})`,
          );
        }
      }
      const tight: string[] = [];
      for (const select of root.querySelectorAll<HTMLSelectElement>("select")) {
        const span = document.createElement("span");
        span.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap";
        span.style.font = getComputedStyle(select).font;
        span.textContent = select.options[select.selectedIndex]?.text ?? "";
        document.body.appendChild(span);
        const needed = span.getBoundingClientRect().width;
        span.remove();
        // 16 of horizontal padding and about 20 for the browser's own arrow.
        if (select.clientWidth < needed + 36) {
          tight.push(`${span.textContent}: needs ${Math.round(needed + 36)}, has ${select.clientWidth}`);
        }
      }
      return {
        clipped,
        tight,
        sideways: root.scrollWidth - root.clientWidth,
      };
    });
    expect(report).toEqual({ clipped: [], tight: [], sideways: 0 });
  });

  /**
   * The surface was rebuilt and the settings were not: the picker still writes
   * the three constraints, and a switch still puts the mode into «Вручную».
   * Both go through `useAudioSettings`, so this is the wiring rather than the
   * words.
   */
  test("the picker and the switches still move each other", async ({ page }) => {
    const panel = await openSound(page);
    const picker = panel.getByTestId("audio-mode-picker");

    await picker.locator('[data-audio-mode="raw"]').click();
    await expect(picker.locator('[data-audio-mode="raw"]')).toHaveAttribute("aria-checked", "true");
    for (const id of ["audio-noise-suppression", "audio-echo-cancellation", "audio-auto-gain"]) {
      await expect(panel.getByTestId(id)).toHaveAttribute("aria-checked", "false");
    }

    await panel.getByTestId("audio-echo-cancellation").click();
    await expect(picker.locator('[data-audio-mode="custom"]')).toHaveAttribute("aria-checked", "true");
    await expect(picker.locator('[aria-checked="true"]')).toHaveCount(1);
    // And the state that cannot be pressed is still the one that cannot be
    // pressed, now that it is the state.
    await expect(picker.locator('[data-audio-mode="custom"]')).toBeDisabled();

    await panel.getByTestId("audio-reset").click();
    await expect(picker.locator('[data-audio-mode="clean"]')).toHaveAttribute("aria-checked", "true");
    await expect(panel.getByTestId("audio-echo-cancellation")).toHaveAttribute("aria-checked", "true");
  });
});
