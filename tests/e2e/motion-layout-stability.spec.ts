import { expect, test } from "@playwright/test";
import { findFirstAvailableQaRole, gotoOrSkip, loginAsRoleOrSkip } from "./helpers/auth";

/**
 * Nothing may change size because it is busy.
 *
 * A button that swaps "Сохранить" for a spinner, or gains an icon it did not
 * have, changes width — and every control beside it moves at the exact moment
 * someone is reaching for one of them. The same applies to a modal: animating
 * its height or padding makes the dialog resize while it is being read.
 *
 * These are measured rather than described. A comment saying "geometry is
 * stable" is worth nothing next to two bounding boxes that match.
 */
test.describe("LETSCUBE motion layout stability", () => {
  test("a button keeps its box while it is working", async ({ page }) => {
    const role = findFirstAvailableQaRole(["owner", "tech_admin"], { includeDefault: false });
    test.skip(!role, "owner/tech_admin QA auth state or credentials are not configured");

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);
    await page.goto("/admin/invites", { waitUntil: "domcontentloaded" });

    await page.getByRole("button", { name: "Создать инвайт", exact: true }).click();
    const submit = page.getByRole("button", { name: "Создать инвайт", exact: true }).last();
    await expect(submit).toBeVisible();

    const before = await submit.boundingBox();
    expect(before).not.toBeNull();

    // Hold the create request open so the loading state can actually be
    // measured rather than guessed at between frames.
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    await page.route(/\/rest\/v1\/rpc\/.*invite/i, async (route) => {
      await held;
      await route.continue();
    });

    await submit.click();
    await page.waitForTimeout(400);
    const during = await submit.boundingBox();
    expect(during).not.toBeNull();

    expect(Math.round(during!.width), "the button widened while working").toBe(
      Math.round(before!.width),
    );
    expect(Math.round(during!.height), "the button grew taller while working").toBe(
      Math.round(before!.height),
    );
    expect(Math.round(during!.x), "the button moved while working").toBe(Math.round(before!.x));

    release();
  });

  test("a modal's entry animation moves nothing that has a size", async ({ page }) => {
    const role = findFirstAvailableQaRole(["owner", "tech_admin"], { includeDefault: false });
    test.skip(!role, "owner/tech_admin QA auth state or credentials are not configured");

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);
    await page.goto("/admin/users", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("admin-user-row").first()).toBeVisible();

    // One opening, from cold. This used to need two: the dialog fetched its own
    // routing data on mount and grew about 56px when the answer arrived, so the
    // first opening could never be measured. It takes that data from the screen
    // behind it now, so the very first open is already its final size — and
    // measuring the first one is what makes this catch a regression.
    await page.getByTestId("admin-user-row").first().getByRole("button").last().click();
    const item = page.getByRole("menuitem").first();
    if ((await item.count()) > 0) await item.click();
    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog).toBeVisible();

    // The LAYOUT box, not the visual one: `boundingBox` reports the transformed
    // rectangle, so the entry's `scale(.99)` legitimately appears there. A
    // transform reflows nothing; an animated height would.
    const boxes: Array<{ width: number; height: number }> = [];
    for (let sample = 0; sample < 6; sample += 1) {
      boxes.push(
        await dialog.evaluate((node) => ({
          width: (node as HTMLElement).offsetWidth,
          height: (node as HTMLElement).offsetHeight,
        })),
      );
      await page.waitForTimeout(70);
    }
    for (const box of boxes) {
      expect(box.width, `the panel's width changed during entry: ${JSON.stringify(boxes)}`).toBe(boxes[0].width);
      expect(box.height, `the panel's height changed during entry: ${JSON.stringify(boxes)}`).toBe(boxes[0].height);
    }
  });

  test("a section that is still loading does not claim there is nothing", async ({ page }) => {
    const role = findFirstAvailableQaRole(["owner", "tech_admin"], { includeDefault: false });
    test.skip(!role, "owner/tech_admin QA auth state or credentials are not configured");

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);

    // Hold the routing data so the loading state is real rather than a frame
    // nobody can catch.
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    await page.route(/\/rest\/v1\/(location_members|locations)\?/, async (route) => {
      await held;
      await route.continue();
    });

    await page.goto("/admin/users", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("admin-user-row").first()).toBeVisible();
    await page.getByTestId("admin-user-row").first().getByRole("button").last().click();
    const item = page.getByRole("menuitem").first();
    if ((await item.count()) > 0) await item.click();
    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog).toBeVisible();

    // "Локации не назначены" is a claim, and while the data is in flight the
    // component has no basis for it. It is also a 20px line that became 114px
    // of cards a moment later, so the dialog grew while it was being read.
    await expect(dialog.getByText("Локации не назначены")).toHaveCount(0);
    await expect(dialog.getByRole("status", { name: /Загрузка локаций/ })).toBeVisible();

    release();
  });

  test("a confirmation appearing does not move the page under it", async ({ page }) => {
    const role = findFirstAvailableQaRole(["owner", "tech_admin"], { includeDefault: false });
    test.skip(!role, "owner/tech_admin QA auth state or credentials are not configured");

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);
    await page.goto("/admin/invites", { waitUntil: "domcontentloaded" });

    const anchor = page.getByText("Активные и прошлые инвайты").first();
    const before = await anchor.boundingBox();
    expect(before).not.toBeNull();

    await page.getByRole("button", { name: "Скопировать" }).first().click();
    await expect(page.getByTestId("kub-feedback-viewport")).toBeVisible();

    const after = await anchor.boundingBox();
    expect(after).not.toBeNull();
    expect(
      Math.round(after!.y),
      "the confirmation pushed the page down instead of floating over it",
    ).toBe(Math.round(before!.y));
  });
});
