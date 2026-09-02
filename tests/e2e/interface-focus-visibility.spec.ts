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
