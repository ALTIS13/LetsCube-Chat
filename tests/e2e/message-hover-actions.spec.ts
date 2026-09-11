import { expect, test } from "@playwright/test";
import { findFirstAvailableQaRole, gotoOrSkip, loginAsRoleOrSkip } from "./helpers/auth";

/**
 * What appears beside a message on hover.
 *
 * It used to be a cluster of three actions, and two things went wrong with it,
 * both reported and both measured. It was anchored to the bubble's top, so
 * where it sat relative to the message changed with the message — 4px below
 * centre on one line, 8px above on two. And the message row hides its
 * overflow, so a bubble at full width left the cluster nothing: on a 1024px
 * window it started at x=347 against a clip edge of x=396, with 49px of it
 * simply gone.
 *
 * 2026-09-11, the owner's Telegram message actions (D-071): the cluster was
 * replaced by one round ❤️ at the bubble's bottom corner, beside its time, and
 * the reserve kept for it is only the button's width. The same two failures are
 * what can go wrong with it, so they are what is pinned: it keeps to the
 * bubble's bottom edge whatever the message's height, it stands beside the
 * bubble rather than over its text or time, and no ancestor cuts it off.
 * Measured on the DEV preview fixture at 1440, 1024 and 800 wide: 28px round,
 * 1px above the bubble's bottom edge, 5px clear of its side, never clipped.
 */
test.describe("LETSCUBE message hover actions", () => {
  test("the hover ❤️ keeps to its message's bottom edge, stands beside it, and is never clipped", async ({ page }) => {
    test.skip(
      (page.viewportSize()?.width ?? 0) < 640,
      "the hover ❤️ is not rendered on a touch layout",
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
        const button = node.querySelector("[data-message-react-button]");
        // A message that cannot take a reaction yet — one still sending — has
        // no button to measure.
        if (!button || window.getComputedStyle(button).display === "none") return null;
        const bubbleBox = node.getBoundingClientRect();
        const buttonBox = button.getBoundingClientRect();

        let clipped = false;
        let parent = button.parentElement;
        while (parent && parent !== document.body) {
          const style = window.getComputedStyle(parent);
          if (style.overflowX !== "visible" || style.overflowY !== "visible") {
            const box = parent.getBoundingClientRect();
            if (
              buttonBox.left < box.left - 0.5 ||
              buttonBox.right > box.right + 0.5 ||
              buttonBox.top < box.top - 0.5 ||
              buttonBox.bottom > box.bottom + 0.5
            ) {
              clipped = true;
            }
          }
          parent = parent.parentElement;
        }

        return {
          bottomGap: Math.round(bubbleBox.bottom - buttonBox.bottom),
          overlap: Math.max(0, Math.min(bubbleBox.right, buttonBox.right) - Math.max(bubbleBox.left, buttonBox.left)),
          clipped,
        };
      });

      if (!report) continue;
      checked += 1;
      expect(
        Math.abs(report.bottomGap),
        `the ❤️ sits ${report.bottomGap}px off the message's bottom edge, so its place moves with the message`,
      ).toBeLessThanOrEqual(2);
      expect(report.overlap, "the ❤️ covers the bubble it belongs to").toBeLessThanOrEqual(0.5);
      expect(report.clipped, "an ancestor is cutting the ❤️ off").toBe(false);
    }

    expect(checked, "no hovered ❤️ was measured").toBeGreaterThan(0);
  });
});
