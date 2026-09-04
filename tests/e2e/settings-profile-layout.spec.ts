import { expect, test } from "@playwright/test";
import { findFirstAvailableQaRole, gotoOrSkip, loginAsRoleOrSkip } from "./helpers/auth";

/**
 * The profile settings had been squeezed into a dialog half the width of the
 * screen: every field in one narrow column, a 230px banner holding an avatar
 * and a name, and the phone section pushed below the fold so it could only be
 * reached by scrolling inside the dialog. Widening the dialog and pairing the
 * two short fields fixed that; the settings rework then replaced the field
 * cards with rows, so the pair no longer shares a row — each field is one line
 * across the full width of the dialog, which is wider than either column was.
 *
 * What is asserted here is still the use of the space, not a pixel layout: a
 * field's input is wide enough to read what is typed into it at both widths,
 * and the phone section is reachable without scrolling the dialog.
 */
async function openProfileSettings(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Меню" }).first().click();
  await page.getByText("Настройки", { exact: true }).first().click();
  await expect(page.locator('[role="dialog"]')).toBeVisible();
  // One scroll, so the profile rows are there on arrival — there is no tab to
  // select first.
  await expect(page.getByRole("heading", { name: "Профиль", exact: true })).toBeVisible();
}

test.describe("LETSCUBE profile settings layout", () => {
  test("on a desktop a field's input keeps the dialog's width and the phone is not below the fold", async ({ page }) => {
    test.skip(
      (page.viewportSize()?.width ?? 0) < 900,
      "this contract is about desktop width",
    );
    const role = findFirstAvailableQaRole(["owner", "tech_admin"], { includeDefault: true });
    test.skip(!role, "QA credentials or auth state are not configured");

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);
    await openProfileSettings(page);

    const nameBox = await page.getByTestId("settings-field-name").boundingBox();
    const usernameBox = await page.getByTestId("settings-field-username").boundingBox();
    expect(nameBox, "the name field was not found").not.toBeNull();
    expect(usernameBox, "the username field was not found").not.toBeNull();

    // One field per row: the caption column is fixed, so all three inputs start
    // at the same x and each one gets the rest of the dialog.
    expect(
      usernameBox!.y,
      "the fields are sharing a row instead of taking one each",
    ).toBeGreaterThan(nameBox!.y + 20);
    expect(usernameBox!.x).toBe(nameBox!.x);

    // The old two-column grid measured 403px per field. A row is worth having
    // only if it beats that, which is the point of dropping the second column.
    expect(
      Math.round(nameBox!.width),
      "the input is narrower than the two-column grid it replaced",
    ).toBeGreaterThanOrEqual(403);

    // And the phone row is on screen without scrolling the dialog.
    await expect(page.getByTestId("settings-open-phone")).toBeInViewport();
  });

  test("on a phone the fields stack and stay wide enough to read", async ({ page }) => {
    test.skip(
      (page.viewportSize()?.width ?? 0) >= 900,
      "this contract is about narrow width",
    );
    const role = findFirstAvailableQaRole(["owner", "tech_admin"], { includeDefault: true });
    test.skip(!role, "QA credentials or auth state are not configured");

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);
    await openProfileSettings(page);

    const nameBox = await page.getByTestId("settings-field-name").boundingBox();
    const usernameBox = await page.getByTestId("settings-field-username").boundingBox();
    expect(nameBox).not.toBeNull();
    expect(usernameBox).not.toBeNull();
    expect(
      usernameBox!.y,
      "two fields on one line would leave each too narrow to read",
    ).toBeGreaterThan(nameBox!.y + 20);

    // The caption column costs 5.5rem on a 375px sheet. What is left has to be
    // enough to see a name in, or the row has bought density with legibility.
    expect(
      Math.round(nameBox!.width),
      "the caption column has eaten the input",
    ).toBeGreaterThanOrEqual(150);
  });
});
