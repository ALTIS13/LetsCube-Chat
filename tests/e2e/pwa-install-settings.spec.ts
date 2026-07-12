import { expect, test, type Page } from "@playwright/test";
import { findFirstAvailableQaRole, gotoOrSkip, loginAsRoleOrSkip } from "./helpers/auth";

const QA_ROLES = ["owner", "tech_admin", "location_admin", "location_staff", "client"] as const;

test.describe("LETSCUBE PWA install settings", () => {
  test("Android and Windows browsers do not offer PWA installation", async ({ page }, testInfo) => {
    await openSettingsOrSkip(page);

    await expect(page.getByTestId("pwa-install-title")).toContainText("LETSCUBE");
    const expectedVariant = testInfo.project.name.includes("mobile") ? "Android APK" : "Windows EXE";
    await expect(page.getByTestId("pwa-install-variant")).toContainText(expectedVariant);
    await expect(page.getByTestId("pwa-install-button")).toHaveCount(0);
    await expect(page.getByTestId("pwa-install-guidance")).toHaveCount(0);
  });

  test("iPhone browser shows iOS home-screen install guidance from the install button", async ({ page }) => {
    await emulateIphoneSafari(page);
    await openSettingsOrSkip(page);

    await expect(page.getByTestId("pwa-install-title")).toContainText("iPhone");
    await expect(page.getByTestId("pwa-install-variant")).toContainText("iPhone / iOS PWA");
    await expect(page.getByTestId("pwa-install-mode")).toContainText("Safari");

    await page.getByTestId("pwa-install-button").click();
    await expect(page.getByTestId("pwa-install-guidance")).toContainText("Установка на iPhone");
    await expect(page.getByTestId("pwa-install-guidance")).toContainText("Поделиться");
    await expect(page.getByTestId("pwa-install-guidance")).toContainText("На экран Домой");
  });
});

async function openSettingsOrSkip(page: Page) {
  const role = findFirstAvailableQaRole([...QA_ROLES], { includeDefault: true });
  test.skip(!role, "QA credentials or auth state are not configured");

  await gotoOrSkip(page, "/");
  await loginAsRoleOrSkip(page, role);

  await page.getByRole("button", { name: "Меню" }).click();
  await page.getByRole("button", { name: "Настройки" }).click();
  await page.getByText("Приложение", { exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByText("Приложение", { exact: true })).toBeVisible();
}

async function emulateIphoneSafari(page: Page) {
  await page.addInitScript(() => {
    const userAgent =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 " +
      "(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      get: () => userAgent,
    });
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      get: () => "iPhone",
    });
    Object.defineProperty(navigator, "maxTouchPoints", {
      configurable: true,
      get: () => 5,
    });
  });
}
