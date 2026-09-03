import { expect, test } from "@playwright/test";
import { gotoOrSkip } from "./helpers/auth";

/**
 * The registration screen while invite-only is on, at the sizes the Windows
 * client actually uses: 1360x860 by default.
 *
 * Invite-only adds a notice, a code field and a hint, and that pushed the
 * primary action out of the window — measured, the submit button's bottom sat
 * at 898px in an 860px window. The window is not allowed to grow to fix that,
 * so what is asserted is that the form fits the window it has.
 */
test.describe("LETSCUBE invite-only registration layout", () => {
  test("the primary action fits the default Windows window", async ({ page }) => {
    test.skip(
      (page.viewportSize()?.width ?? 0) < 1200,
      "this contract is about the desktop client's default window",
    );
    await gotoOrSkip(page, "/register");
    await page.waitForTimeout(2500);

    const banner = page.getByTestId("registration-invite-only-banner");
    test.skip((await banner.count()) === 0, "registration is not invite-only right now");

    // The notice must not truncate. Two labels side by side did, which is worse
    // than the banner they replaced.
    const truncated = await banner.evaluate((node) => {
      for (const span of node.querySelectorAll("span")) {
        if (span.scrollWidth > span.clientWidth + 1) return span.textContent ?? "(unnamed)";
      }
      return null;
    });
    expect(truncated, `the notice truncates: "${truncated}"`).toBeNull();

    const submit = page.getByRole("button", { name: "Создать аккаунт" });
    await expect(submit).toBeVisible();
    const box = await submit.boundingBox();
    expect(box).not.toBeNull();
    expect(
      box!.y + box!.height,
      "the button people came here to press is below the fold",
    ).toBeLessThanOrEqual(page.viewportSize()!.height);
  });

  test("the captcha is not clipped by the plate around it", async ({ page }) => {
    await gotoOrSkip(page, "/register");
    await page.waitForTimeout(4000);

    const plate = page.locator("[data-provider]").first();
    test.skip((await plate.count()) === 0, "no captcha is configured for this build");
    const frame = plate.locator("iframe").first();
    test.skip((await frame.count()) === 0, "the captcha widget did not load");

    const fits = await plate.evaluate((node) => {
      // The visible widget, not the first iframe: the provider also mounts a
      // zero-size backend frame, and measuring that reports a 0px widget inside
      // a 136px plate — a failure about nothing.
      const iframe = [...node.querySelectorAll("iframe")].find(
        (frame) => frame.getBoundingClientRect().height > 1,
      );
      if (!iframe) return null;
      const outer = node.getBoundingClientRect();
      const inner = iframe.getBoundingClientRect();
      return {
        clipped: inner.bottom > outer.bottom + 1 || inner.top < outer.top - 1,
        outerHeight: Math.round(outer.height),
        innerHeight: Math.round(inner.height),
      };
    });
    expect(fits).not.toBeNull();
    expect(
      fits!.clipped,
      `the widget is ${fits!.innerHeight}px inside a ${fits!.outerHeight}px plate`,
    ).toBe(false);
  });
});
