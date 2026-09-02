import { expect, test } from "@playwright/test";
import { findFirstAvailableQaRole, gotoOrSkip, loginAsRoleOrSkip } from "./helpers/auth";

/**
 * Copying said nothing at all in five places, which leaves a person pressing
 * the button again to find out whether the first press worked.
 *
 * What is pinned here is the shape of the confirmation rather than its wording:
 * it appears, it goes away on its own, a second press replaces the first
 * instead of stacking, and it never sits on top of the interface it is
 * confirming.
 */
test.describe("LETSCUBE action feedback", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("copying an invite link confirms itself and then gets out of the way", async ({ page }) => {
    const role = findFirstAvailableQaRole(["owner", "tech_admin"], { includeDefault: false });
    test.skip(!role, "owner/tech_admin QA auth state or credentials are not configured");

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);
    await page.goto("/admin/invites", { waitUntil: "domcontentloaded" });

    const copy = page.getByRole("button", { name: "Скопировать" }).first();
    await expect(copy).toBeVisible();
    await copy.click();

    const viewport = page.getByTestId("kub-feedback-viewport");
    await expect(viewport).toBeVisible();
    await expect(viewport.getByText("Ссылка приглашения скопирована")).toBeVisible();

    // A second press is one result, not two: the keyed entry replaces itself.
    await copy.click();
    await expect(viewport.getByText("Ссылка приглашения скопирована")).toHaveCount(1);

    // And it leaves on its own. The success duration is 2.4s, so this is
    // generous without being so long that a stuck card would pass.
    await expect(viewport).toHaveCount(0, { timeout: 6000 });
  });

  test("the viewport never blocks what is underneath it", async ({ page }) => {
    const role = findFirstAvailableQaRole(["owner", "tech_admin"], { includeDefault: false });
    test.skip(!role, "owner/tech_admin QA auth state or credentials are not configured");

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);
    await page.goto("/admin/invites", { waitUntil: "domcontentloaded" });

    await page.getByRole("button", { name: "Скопировать" }).first().click();
    const viewport = page.getByTestId("kub-feedback-viewport");
    await expect(viewport).toBeVisible();

    // The container spans the width of the screen, so if it took pointer events
    // it would swallow clicks across a whole band of the interface.
    const passesThrough = await viewport.evaluate(
      (node) => window.getComputedStyle(node).pointerEvents === "none",
    );
    expect(passesThrough, "the container must not intercept clicks").toBe(true);

    // And it must not sit on top of the navigation. The staff area stacks a
    // header on a tab strip, and the first placement covered the last tab —
    // a confirmation that hides a control is a worse trade than no
    // confirmation at all.
    const tabs = page.getByRole("link", { name: /Сводка/i }).first();
    const tabBox = await tabs.boundingBox();
    const cardBox = await viewport.locator("[role=status], [role=alert]").first().boundingBox();
    expect(tabBox, "the navigation was not found").not.toBeNull();
    expect(cardBox, "the confirmation was not found").not.toBeNull();
    expect(
      cardBox!.y,
      "the confirmation overlaps the navigation strip",
    ).toBeGreaterThanOrEqual(tabBox!.y + tabBox!.height);

    // The card itself still has to be dismissible.
    const close = viewport.getByRole("button", { name: "Закрыть уведомление" }).first();
    await expect(close).toBeVisible();
    await close.click();
    await expect(viewport).toHaveCount(0);
  });

  test("a failed copy is reported rather than passing for success", async ({ page }) => {
    const role = findFirstAvailableQaRole(["owner", "tech_admin"], { includeDefault: false });
    test.skip(!role, "owner/tech_admin QA auth state or credentials are not configured");

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);
    await page.goto("/admin/invites", { waitUntil: "domcontentloaded" });

    // Refuse the clipboard the way a browser does when permission is withheld.
    await page.evaluate(() => {
      Object.defineProperty(navigator.clipboard, "writeText", {
        configurable: true,
        value: () => Promise.reject(new Error("denied")),
      });
    });

    await page.getByRole("button", { name: "Скопировать" }).first().click();
    const viewport = page.getByTestId("kub-feedback-viewport");
    await expect(viewport.getByText("Не удалось скопировать ссылку")).toBeVisible();

    // An error is announced assertively and stays longer than a success, because
    // it is the case a person actually has to read.
    await expect(viewport.getByRole("alert").first()).toBeVisible();
  });
});
