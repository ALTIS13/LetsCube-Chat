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

  test("composer shows video quality only for a staged video", async ({ page }) => {
    await openFirstChatOrSkip(page);

    await page.getByRole("button", { name: "Прикрепить" }).click();
    const selector = page.getByTestId("media-quality-selector");
    const track = page.getByTestId("media-quality-track");

    await expect(selector).toHaveCount(0);
    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Фото или видео" }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: "quality-check.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.from("not-a-real-video"),
    });
    await expect(selector).toBeVisible();
    await expect(track).toHaveAttribute("role", "radiogroup");
    await expect(track.getByRole("radio")).toHaveCount(3);

    await page.getByTestId("media-quality-option-original").click();
    await expect(page.getByTestId("media-quality-option-original")).toHaveAttribute("aria-checked", "true");
    await expect(selector).toContainText("Без снижения качества");
  });

  test("settings expose direct sections with notifications first", async ({ page }) => {
    const role = findFirstAvailableQaRole(
      ["owner", "tech_admin", "location_admin", "location_staff", "client"],
      { includeDefault: true },
    );
    test.skip(!role, "QA credentials or auth state are not configured");

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);
    await page.getByRole("button", { name: "Меню" }).click();
    await page.getByRole("button", { name: "Настройки" }).click();

    await expect(page.getByRole("heading", { name: "Настройки" })).toBeVisible();
    const tabs = page.getByRole("tablist", { name: "Разделы настроек" });
    await expect(tabs).toBeVisible();
    await expect(tabs.getByRole("tab")).toHaveCount(4);
    expect(await tabs.getByRole("tab").locator("span").evaluateAll((labels) =>
      labels.every((label) => label.scrollWidth <= label.clientWidth + 1),
    )).toBe(true);
    await expect(page.getByText("Push-уведомления")).toBeVisible();

    await tabs.getByRole("tab", { name: "Звук" }).click();
    await expect(page.getByText("Звук и голосовые")).toBeVisible();
    await tabs.getByRole("tab", { name: "Профиль" }).click();
    await expect(page.getByText("Личная информация")).toBeVisible();
    await tabs.getByRole("tab", { name: "Главное" }).click();
    await expect(page.getByText("Push-уведомления")).toBeVisible();
  });

  test("audio settings expose devices, live levels, and processing controls", async ({ page }) => {
    const role = findFirstAvailableQaRole(
      ["owner", "tech_admin", "location_admin", "location_staff", "client"],
      { includeDefault: true },
    );
    test.skip(!role, "QA credentials or auth state are not configured");

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);
    await page.getByRole("button", { name: "Меню" }).click();
    await page.getByRole("button", { name: "Настройки" }).click();
    await page.getByRole("tab", { name: "Звук" }).click();

    await expect(page.getByText("Звук и голосовые")).toBeVisible();
    await expect(page.getByText("Устройства", { exact: true })).toBeVisible();
    await expect(page.locator('input[type="range"]')).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Проверка микрофона" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Чистый голос" })).toBeVisible();
    await expect(page.getByText("Слышать свой микрофон")).toBeVisible();
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
