import { expect, test, type Page } from "@playwright/test";

import {
  findFirstAvailableQaRole,
  gotoOrSkip,
  loginAsRoleOrSkip,
} from "./helpers/auth";

test.describe("LETSCUBE unified interface chrome", () => {
  test("desktop shell has one brand bar and aligned control rows", async ({ page }, testInfo) => {
    const viewport = testInfo.project.use.viewport;
    test.skip(Boolean(viewport && "width" in viewport && viewport.width < 768), "Desktop-only shell contract");
    await openFirstChatOrSkip(page);

    const topBar = page.getByTestId("app-top-bar");
    const sidebarControls = page.getByTestId("sidebar-control-row");
    const chatControls = page.getByTestId("chat-control-row");

    await expect(topBar).toBeVisible();
    await expect(page.getByTestId("authenticated-shell-brand")).toHaveCount(1);
    await expect(page.getByTestId("sidebar-brand-strip")).toHaveCount(0);
    await expect(sidebarControls).toBeVisible();
    await expect(chatControls).toBeVisible();

    const sidebarBox = await sidebarControls.boundingBox();
    const chatBox = await chatControls.boundingBox();
    expect(sidebarBox).not.toBeNull();
    expect(chatBox).not.toBeNull();
    expect(Math.abs(
      sidebarBox!.y + sidebarBox!.height - chatBox!.y - chatBox!.height,
    )).toBeLessThanOrEqual(1);
  });

  test("welcome screen uses concise factual copy", async ({ page }) => {
    const role = findFirstAvailableQaRole(
      ["owner", "tech_admin", "location_admin", "location_staff", "client"],
      { includeDefault: true },
    );
    test.skip(!role, "QA credentials or auth state are not configured");

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);

    const welcome = page.getByTestId("welcome-screen");
    test.skip(!(await welcome.isVisible().catch(() => false)), "QA account opens with an active chat");

    await expect(welcome).toContainText("Выберите диалог, чтобы открыть переписку.");
    await expect(page.getByTestId("welcome-capability-pills")).toHaveCount(0);
    await expect(page.getByText("Шифрование", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Облачная синхронизация", { exact: true })).toHaveCount(0);
  });

  test("composer uses a compact accessible media quality track", async ({ page }) => {
    await openFirstChatOrSkip(page);

    await page.getByRole("button", { name: "Прикрепить" }).click();
    const selector = page.getByTestId("media-quality-selector");
    const track = page.getByTestId("media-quality-track");

    await expect(selector).toBeVisible();
    await expect(track).toHaveAttribute("role", "radiogroup");
    await expect(track.getByRole("radio")).toHaveCount(3);

    await page.getByTestId("media-quality-option-high").click();
    await expect(page.getByTestId("media-quality-option-high")).toHaveAttribute("aria-checked", "true");
    await expect(selector).toContainText("Лучше качество, больше размер");
  });

  test("administration dashboard exposes operational sections", async ({ page }) => {
    const role = findFirstAvailableQaRole(["owner", "tech_admin"], { includeDefault: true });
    test.skip(!role, "Admin QA credentials or auth state are not configured");

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);
    await page.goto("/admin", { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("admin-dashboard-metrics")).toBeVisible();
    await expect(page.getByTestId("admin-registration-trend")).toBeVisible();
    await expect(page.getByTestId("admin-recent-users")).toBeVisible();
    await expect(page.getByTestId("admin-recent-events")).toBeVisible();
  });
});

async function openFirstChatOrSkip(page: Page) {
  const role = findFirstAvailableQaRole(
    ["owner", "tech_admin", "location_admin", "location_staff", "client"],
    { includeDefault: true },
  );
  test.skip(!role, "QA credentials or auth state are not configured");

  await gotoOrSkip(page, "/");
  await loginAsRoleOrSkip(page, role);

  const firstChat = page.getByTestId("chat-list-item").first();
  test.skip((await firstChat.count()) === 0, "QA account has no visible chats");
  await firstChat.click();
}
