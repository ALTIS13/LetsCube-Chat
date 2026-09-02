import { expect, test } from "@playwright/test";

/**
 * D-010: keyboard focus must be visible on the primary action.
 *
 * This is asserted through the browser rather than by reading the source,
 * because the source read correctly the whole time the defect existed. The
 * button asked for `focus-visible:ring-2`, Tailwind implements a ring as a
 * box-shadow, and the variant's `kub-glow-*` class set box-shadow at the same
 * specificity — so the ring was composed and then overwritten, and a focused
 * button's computed style was byte-identical to an unfocused one.
 *
 * The check is therefore "the computed style changes when the keyboard reaches
 * it", not "the class list contains something focus-shaped".
 */

const FOCUS_PROPERTIES = ["outlineStyle", "outlineWidth", "outlineColor", "boxShadow"] as const;

async function styleOf(page: import("@playwright/test").Page, selector: string) {
  return await page.evaluate((sel) => {
    const node = document.querySelector(sel);
    if (!node) return null;
    const style = getComputedStyle(node);
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      outlineColor: style.outlineColor,
      boxShadow: style.boxShadow,
      focused: document.activeElement === node,
    };
  }, selector);
}

test.describe("interface focus visibility", () => {
  for (const theme of ["dark", "light"] as const) {
    test(`the login primary action shows keyboard focus in the ${theme} theme`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto("/login", { waitUntil: "domcontentloaded" });

      const submit = 'button[type="submit"]';
      await page.locator(submit).first().waitFor({ state: "visible" });
      const before = await styleOf(page, submit);
      expect(before, "the login form has no submit button").not.toBeNull();
      expect(before?.focused, "the button must not start focused").toBe(false);

      // Reach it the way a person does. Scripted focus would not settle this:
      // browsers deliberately do not match :focus-visible for it.
      let after = before;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await page.keyboard.press("Tab");
        after = await styleOf(page, submit);
        if (after?.focused) break;
      }

      expect(after?.focused, "tabbing never reached the primary action").toBe(true);

      const changed = FOCUS_PROPERTIES.some((property) => before?.[property] !== after?.[property]);
      expect(
        changed,
        `focusing the primary action changed nothing visible.\nbefore: ${JSON.stringify(before)}\nafter:  ${JSON.stringify(after)}`,
      ).toBe(true);

      // And specifically an outline, because a box-shadow indicator is what the
      // variant glow overwrote. Losing the outline again would restore D-010.
      expect(after?.outlineStyle, "the focus indicator must be an outline").not.toBe("none");
      expect(Number.parseFloat(after?.outlineWidth ?? "0")).toBeGreaterThan(0);
    });
  }
});

/**
 * D-013: a field that looks tappable must be tappable across its whole height.
 *
 * `KubInput` paints a 44px field and the input sat inside it at its intrinsic
 * 20px, vertically centred. The control looked like a 44px target and answered
 * only in the middle 20px: a tap 4px below the visible top edge landed on
 * nothing and left focus on `body`. Measuring the input's box alone would have
 * called this fixed as soon as a min-height was added, so the test taps.
 */
test.describe("interface touch targets", () => {
  test("tapping the top edge of a text field focuses it", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/login", { waitUntil: "domcontentloaded" });

    const field = page.locator('input[type="email"]').first();
    await field.waitFor({ state: "visible" });

    const geometry = await page.evaluate(() => {
      const input = document.querySelector('input[type="email"]') as HTMLElement;
      const wrapper = input.parentElement as HTMLElement;
      const box = wrapper.getBoundingClientRect();
      return { x: box.x + box.width / 2, top: box.y, bottom: box.y + box.height, height: box.height };
    });

    expect(geometry.height, "the visual field should be a 44px target").toBeGreaterThanOrEqual(44);

    for (const [label, y] of [
      ["the top edge", geometry.top + 4],
      ["the bottom edge", geometry.bottom - 4],
    ] as const) {
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.mouse.click(geometry.x, y);
      const focused = await page.evaluate(() => document.activeElement?.getAttribute("type") ?? document.activeElement?.tagName);
      expect(focused, `tapping ${label} of the field did not reach the input`).toBe("email");
    }
  });
});

/**
 * D-015: the shared button scale is below the touch target, and the fix must
 * not cost the design its scale.
 *
 * Three of the four sizes are under 44px and `size="sm"` alone is used 118
 * times, so raising the scale outright would have changed the height of most
 * buttons in the product. The rule is scoped to `(pointer: coarse)` instead:
 * a finger gets a real target, a cursor sees exactly what it saw before.
 *
 * Both halves are asserted. Testing only the touch half would pass just as well
 * if the scale had been raised for everyone, which is the change that was
 * deliberately not made.
 */
test.describe("interface button targets on touch", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test("a small button reaches the touch target on a coarse pointer", async ({ page }) => {
    await page.goto("/privacy", { waitUntil: "domcontentloaded" });
    const print = page.getByTestId("privacy-print");
    await print.waitFor({ state: "visible" });

    const height = await print.evaluate((node) => node.getBoundingClientRect().height);
    expect(height, "a small button must be a real target under a finger").toBeGreaterThanOrEqual(44);
  });
});

test.describe("interface button targets on a pointer", () => {
  test.use({ hasTouch: false, isMobile: false, viewport: { width: 1440, height: 900 } });

  test("the same button keeps its designed height on a fine pointer", async ({ page }) => {
    await page.goto("/privacy", { waitUntil: "domcontentloaded" });
    const print = page.getByTestId("privacy-print");
    await print.waitFor({ state: "visible" });

    const height = await print.evaluate((node) => node.getBoundingClientRect().height);
    expect(
      height,
      "the size scale must be untouched with a cursor; raising it for everyone is the change that was not made",
    ).toBeLessThan(44);
  });
});
