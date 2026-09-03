import { expect, test } from "@playwright/test";
import { findFirstAvailableQaRole, gotoOrSkip, loginAsRoleOrSkip } from "./helpers/auth";

/**
 * The profile settings had been squeezed into a dialog half the width of the
 * screen: every field in one narrow column, a 230px banner holding an avatar
 * and a name, and the phone section pushed below the fold so it could only be
 * reached by scrolling inside the dialog.
 *
 * What is asserted here is the use of the space, not a pixel layout: on a
 * desktop viewport the short fields share a row and the phone section is
 * reachable without scrolling; on a phone they stack, because there is no room
 * to do anything else.
 */
async function openProfileSettings(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Меню" }).first().click();
  await page.getByText("Настройки", { exact: true }).first().click();
  await expect(page.locator('[role="dialog"]')).toBeVisible();
  await page.getByText("Профиль", { exact: true }).first().click();
  await expect(page.getByText("Личная информация")).toBeVisible();
}

test.describe("LETSCUBE profile settings layout", () => {
  test("on a desktop the short fields share a row and the phone is not below the fold", async ({ page }) => {
    test.skip(
      (page.viewportSize()?.width ?? 0) < 900,
      "this contract is about desktop width",
    );
    const role = findFirstAvailableQaRole(["owner", "tech_admin"], { includeDefault: true });
    test.skip(!role, "QA credentials or auth state are not configured");

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);
    await openProfileSettings(page);

    const name = page.getByText(/^Имя\s*\*?$/).first();
    const username = page.getByText("Имя пользователя", { exact: true }).first();
    const nameBox = await name.boundingBox();
    const usernameBox = await username.boundingBox();
    expect(nameBox, "the name field was not found").not.toBeNull();
    expect(usernameBox, "the username field was not found").not.toBeNull();

    // Same row: their vertical centres line up, and one sits to the right of
    // the other rather than beneath it.
    expect(
      Math.abs(nameBox!.y - usernameBox!.y),
      "the two short fields are stacked instead of sharing the row",
    ).toBeLessThan(12);
    expect(usernameBox!.x).toBeGreaterThan(nameBox!.x + nameBox!.width - 8);

    // Two columns are only an improvement if each one is wide enough to use.
    // Tailwind's `sm:` breakpoint measures the VIEWPORT, not the dialog, so a
    // narrower dialog on a wide screen keeps the two columns and simply makes
    // them cramped — which is the failure this catches. Measured, the fields
    // are 403px each in the dialog as it stands.
    const fieldWidth = await page.evaluate(() => {
      const label = [...document.querySelectorAll("*")].find(
        (node) => node.textContent?.trim() === "Личная информация",
      );
      const grid = label?.nextElementSibling;
      const first = grid?.firstElementChild;
      return first ? Math.round(first.getBoundingClientRect().width) : 0;
    });
    expect(
      fieldWidth,
      "the columns are too narrow to be an improvement over stacking",
    ).toBeGreaterThanOrEqual(300);

    // And the phone section is on screen without scrolling the dialog.
    const phone = page.getByText("Телефон", { exact: true }).first();
    await expect(phone).toBeInViewport();
  });

  test("on a phone the fields stack", async ({ page }) => {
    test.skip(
      (page.viewportSize()?.width ?? 0) >= 900,
      "this contract is about narrow width",
    );
    const role = findFirstAvailableQaRole(["owner", "tech_admin"], { includeDefault: true });
    test.skip(!role, "QA credentials or auth state are not configured");

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);
    await openProfileSettings(page);

    const nameBox = await page.getByText(/^Имя\s*\*?$/).first().boundingBox();
    const usernameBox = await page.getByText("Имя пользователя", { exact: true }).first().boundingBox();
    expect(nameBox).not.toBeNull();
    expect(usernameBox).not.toBeNull();
    expect(
      usernameBox!.y,
      "two columns on a phone would leave each field too narrow to read",
    ).toBeGreaterThan(nameBox!.y + 20);
  });
});
