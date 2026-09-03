import { expect, test } from "@playwright/test";
import { findFirstAvailableQaRole, gotoOrSkip, loginAsRoleOrSkip } from "./helpers/auth";

/**
 * "Помощь" used to open github.com. It now opens the product's own support desk
 * in a window the person can move, carrying their own tickets and history.
 *
 * The contracts worth holding are: the entry point reaches the window without
 * leaving the application, a request actually reaches the operators' queue, the
 * conversation is readable afterwards, and the window can be dragged without
 * ever ending up somewhere it cannot be dragged back from.
 */
async function openSupport(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Меню" }).first().click();
  await page.getByText("Помощь", { exact: true }).first().click();
  const support = page.getByTestId("support-window");
  await expect(support).toBeVisible();
  return support;
}

test.describe("support window", () => {
  test("help opens the support window without leaving the application", async ({ page }) => {
    const role = findFirstAvailableQaRole(["client", "owner", "tech_admin"], { includeDefault: true });
    test.skip(!role, "QA credentials or auth state are not configured");

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);

    const opened: string[] = [];
    page.context().on("page", (child) => opened.push(child.url()));
    const before = page.url();

    const support = await openSupport(page);
    await expect(support.getByText("Поддержка").first()).toBeVisible();
    expect(page.url(), "the messenger stays on screen behind the window").toBe(before);
    expect(opened, "support must not open a new tab").toEqual([]);

    await support.getByRole("button", { name: "Закрыть поддержку" }).click();
    await expect(page.getByTestId("support-window")).toHaveCount(0);
  });

  test("the window can be dragged and stays reachable at the edge", async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 640, "the window docks on a phone");
    const role = findFirstAvailableQaRole(["client", "owner", "tech_admin"], { includeDefault: true });
    test.skip(!role, "QA credentials or auth state are not configured");

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);
    const support = await openSupport(page);
    const handle = page.getByTestId("support-window-handle");

    const start = await support.boundingBox();
    expect(start).not.toBeNull();
    const grip = await handle.boundingBox();
    expect(grip).not.toBeNull();

    await page.mouse.move(grip!.x + 40, grip!.y + 10);
    await page.mouse.down();
    await page.mouse.move(grip!.x - 300, grip!.y + 120, { steps: 8 });
    await page.mouse.up();

    const moved = await support.boundingBox();
    expect(moved!.x, "the window followed the pointer").toBeLessThan(start!.x - 100);

    // Now shove it far past the right edge and prove a strip is still on screen.
    const gripAfter = await handle.boundingBox();
    await page.mouse.move(gripAfter!.x + 40, gripAfter!.y + 10);
    await page.mouse.down();
    await page.mouse.move(5000, gripAfter!.y + 10, { steps: 8 });
    await page.mouse.up();

    const viewport = page.viewportSize()!;
    const shoved = await support.boundingBox();
    expect(shoved!.x, "it may hang off the edge").toBeGreaterThan(start!.x);
    expect(
      viewport.width - shoved!.x,
      "but enough of the handle must remain to drag it back",
    ).toBeGreaterThanOrEqual(100);
  });

  test("a request reaches support and the reply thread is readable", async ({ page }) => {
    const role = findFirstAvailableQaRole(["client", "owner", "tech_admin"], { includeDefault: true });
    test.skip(!role, "QA credentials or auth state are not configured");
    test.skip(
      process.env.KUB_QA_ALLOW_MUTATIONS !== "1",
      "this creates a real support ticket; set KUB_QA_ALLOW_MUTATIONS=1 to run it",
    );

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);
    const support = await openSupport(page);

    const stamp = Date.now();
    const subject = `QA автопроверка ${stamp}`;
    const body = `Автоматическая проверка окна поддержки, прогон ${stamp}.`;

    // Opening support lands in the conversation when one is already going, so
    // a new request starts from the compose button.
    await support.getByRole("button", { name: "Новое обращение" }).click();
    await support.getByPlaceholder("Коротко о проблеме").fill(subject);
    await support.getByPlaceholder(/Опишите, что случилось/).fill(body);
    await support.getByRole("button", { name: "Отправить" }).click();

    // Five open tickets is the cap, and a test account reruns. Hitting it is a
    // contract of its own — the person is told why, rather than the request
    // vanishing — and the reply flow below is still worth exercising on the
    // conversation that is already open.
    const thread = support.getByTestId("support-thread");
    const capped = support.getByText(/уже пять открытых обращений/);
    await expect(thread.getByText(body).or(capped)).toBeVisible({ timeout: 15_000 });
    if (await capped.isVisible()) {
      await support.getByRole("button", { name: "Отмена" }).click();
    }
    await expect(support.getByText(/LC-\d{4}-[A-F0-9]{12}/)).toBeVisible();

    // A follow-up message lands in the same conversation.
    const followUp = `Дополнение ${stamp}`;
    await support.getByLabel("Сообщение поддержке").fill(followUp);
    await support.getByRole("button", { name: "Отправить" }).click();
    // Scoped to the thread on purpose: the composer keeps the text when a send
    // fails, and an unscoped match would read that back as a delivered message.
    await expect(thread.getByText(followUp)).toBeVisible({ timeout: 15_000 });

    // And it survives a reload, because it is stored rather than local state.
    await page.reload();
    const reopened = await openSupport(page);
    await expect(reopened.getByTestId("support-thread").getByText(followUp)).toBeVisible({
      timeout: 15_000,
    });
  });
});
