import { expect, test } from "@playwright/test";
import { findFirstAvailableQaRole, gotoOrSkip, loginAsRoleOrSkip } from "./helpers/auth";

/**
 * Every notification used to be drawn in the same cyan, so a message from a
 * colleague, a ban and an urgent task from an administrator read as one
 * undifferentiated stream — "каша", in the owner's words.
 *
 * What is asserted here is that the distinction reaches the pixels and that it
 * is the right distinction: a category's tab contains only that category's
 * tone, and every category is reachable rather than clipped off the edge of the
 * panel. The exact rules — which priority is urgent, what an unknown payload
 * does — are unit-tested, where they can be exercised without seeding
 * production notifications.
 */
async function openNotifications(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: /Уведомления/ }).first().click();
  await expect(page.getByTestId("notification-tabs")).toBeVisible();
  // The list loads after the panel opens; wait for content or the empty state.
  await expect(
    page.locator('[data-notification-tone]').first().or(page.getByText("Уведомлений пока нет")),
  ).toBeVisible({ timeout: 15_000 });
}

/**
 * `system` is the catch-all: a viewer without the support queue has no support
 * tab, so support notifications are filed there. Their tone stays support on
 * purpose — a reply from an operator and a ban are not the same thing, and
 * giving them one colour is the defect this work exists to remove.
 */
const TAB_TONES: Record<string, string[]> = {
  tasks: ["task"],
  messages: ["message"],
  support: ["support"],
  system: ["invite", "system", "support"],
};

test.describe("notification visual language", () => {
  test("each category's tab holds only that category's tone", async ({ page }) => {
    const role = findFirstAvailableQaRole(["client", "owner", "tech_admin"], { includeDefault: true });
    test.skip(!role, "QA credentials or auth state are not configured");

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);
    await openNotifications(page);

    let checked = 0;
    for (const [tab, allowed] of Object.entries(TAB_TONES)) {
      const control = page.getByTestId(`notification-tab-${tab}`);
      if ((await control.count()) === 0) continue;
      await control.click();
      await page.waitForTimeout(400);

      const tones = await page
        .locator("[data-notification-tone]")
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-notification-tone")));
      for (const tone of tones) {
        expect(allowed, `a ${tone} item is showing under the ${tab} tab`).toContain(tone);
      }
      checked += tones.length;
    }

    expect(checked, "no notifications were available to check a tone against").toBeGreaterThan(0);
  });

  test("every category is reachable rather than clipped off the panel", async ({ page }) => {
    const role = findFirstAvailableQaRole(["client", "owner", "tech_admin"], { includeDefault: true });
    test.skip(!role, "QA credentials or auth state are not configured");

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);
    await openNotifications(page);

    const strip = page.getByTestId("notification-tabs");
    const stripBox = await strip.boundingBox();
    expect(stripBox).not.toBeNull();

    const tabs = strip.locator("button");
    const count = await tabs.count();
    expect(count, "the panel should offer categories at all").toBeGreaterThan(1);

    for (let index = 0; index < count; index += 1) {
      const box = await tabs.nth(index).boundingBox();
      expect(box, `tab ${index} has no box`).not.toBeNull();
      // The five labels did not fit one line and the last was cut mid-word,
      // which reads as broken rather than as more to the right.
      expect(
        box!.x + box!.width,
        `tab ${index} is cut off by the panel edge`,
      ).toBeLessThanOrEqual(stripBox!.x + stripBox!.width + 1);
    }
  });

  test("an unread item is tinted with its own tone, not one shared colour", async ({ page }) => {
    const role = findFirstAvailableQaRole(["client", "owner", "tech_admin"], { includeDefault: true });
    test.skip(!role, "QA credentials or auth state are not configured");

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);
    await openNotifications(page);

    const byTone = await page.locator("[data-notification-tone]").evaluateAll((nodes) => {
      const seen: Record<string, string> = {};
      for (const node of nodes) {
        const tone = node.getAttribute("data-notification-tone");
        if (!tone || seen[tone]) continue;
        seen[tone] = getComputedStyle(node).borderTopColor;
      }
      return seen;
    });

    const tones = Object.keys(byTone);
    test.skip(tones.length < 2, "only one category is present, so nothing to tell apart");
    const colors = new Set(Object.values(byTone));
    expect(
      colors.size,
      `tones ${tones.join(", ")} resolved to ${colors.size} distinct border colours`,
    ).toBeGreaterThan(1);
  });
});
