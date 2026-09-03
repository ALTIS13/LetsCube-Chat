import { expect, test } from "@playwright/test";
import { findFirstAvailableQaRole, gotoOrSkip, loginAsRoleOrSkip } from "./helpers/auth";

/**
 * The cluster of actions that appears beside a message on hover.
 *
 * Two things went wrong with it, both reported and both measured. It was
 * anchored to the bubble's top, so where it sat relative to the message
 * changed with the message — 4px below centre on one line, 8px above on two.
 * And the message row hides its overflow, so a bubble at full width left the
 * cluster nothing: on a 1024px window it started at x=347 against a clip edge
 * of x=396, with 49px of it simply gone.
 */
test.describe("LETSCUBE message hover actions", () => {
  test("the cluster is centred on its message and never clipped", async ({ page }) => {
    test.skip(
      (page.viewportSize()?.width ?? 0) < 640,
      "the hover cluster is not rendered on a touch layout",
    );
    const role = findFirstAvailableQaRole(["owner", "tech_admin"], { includeDefault: true });
    test.skip(!role, "QA credentials or auth state are not configured");

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);

    const chats = page.locator('[data-testid="chat-list-item"][data-has-messages="true"]');
    await chats.first().waitFor({ state: "visible", timeout: 20_000 }).catch(() => {});
    test.skip((await chats.count()) === 0, "QA account has no chat with messages");
    await chats.first().click();

    const bubbles = page.locator('[data-message-bubble="true"]');
    await bubbles.first().waitFor({ state: "visible", timeout: 20_000 });
    const count = await bubbles.count();
    expect(count).toBeGreaterThan(0);

    let checked = 0;
    for (const index of [count - 1, Math.max(0, count - 4), Math.max(0, count - 8)]) {
      const bubble = bubbles.nth(index);
      await bubble.scrollIntoViewIfNeeded();
      await bubble.hover();
      await page.waitForTimeout(320);

      const report = await bubble.evaluate((node) => {
        const cluster =
          node.querySelector('[aria-label="Реакция"]')?.parentElement ??
          node.querySelector('[aria-label="Ответить"]')?.parentElement;
        if (!cluster) return null;
        const bubbleBox = node.getBoundingClientRect();
        const clusterBox = cluster.getBoundingClientRect();

        let clipped = false;
        let parent = node.parentElement;
        while (parent && parent !== document.body) {
          const style = window.getComputedStyle(parent);
          if (style.overflowX !== "visible" || style.overflowY !== "visible") {
            const box = parent.getBoundingClientRect();
            if (clusterBox.left < box.left - 0.5 || clusterBox.right > box.right + 0.5) clipped = true;
          }
          parent = parent.parentElement;
        }

        return {
          offset: Math.round(
            clusterBox.top + clusterBox.height / 2 - (bubbleBox.top + bubbleBox.height / 2),
          ),
          clipped,
        };
      });

      if (!report) continue;
      checked += 1;
      expect(
        Math.abs(report.offset),
        `the cluster sits ${report.offset}px off the message's centre, so its position shifts with the message`,
      ).toBeLessThanOrEqual(2);
      expect(report.clipped, "an ancestor is cutting the cluster off").toBe(false);
    }

    expect(checked, "no hovered cluster was measured").toBeGreaterThan(0);
  });
});
