import { expect, test, type Page } from "@playwright/test";
import { findFirstAvailableQaRole, gotoOrSkip, loginAsRoleOrSkip } from "./helpers/auth";

const QA_ROLES = ["owner", "tech_admin", "location_admin", "location_staff", "client"] as const;
const SHA256 = "a".repeat(64);

test.describe("LETSCUBE native distribution status", () => {
  test("unpublished native package is shown as preparing without a download", async ({ page }, testInfo) => {
    const platform = testInfo.project.name.includes("mobile") ? "android" : "windows";
    await routeManifest(page, platform, {
      available: false,
      version: "0.0.0",
      build: 0,
      artifact: null,
    });
    await openSettingsOrSkip(page);

    await expect(page.getByTestId("release-catalog-state")).toHaveAttribute("data-state", "preparing");
    await expect(page.getByTestId("release-catalog-state")).toContainText("готовится");
    await expect(page.getByTestId("release-download-button")).toHaveCount(0);
  });

  test("published package exposes only the validated download URL and fits its card", async ({ page }, testInfo) => {
    const platform = testInfo.project.name.includes("mobile") ? "android" : "windows";
    const extension = platform === "android" ? "apk" : "exe";
    const artifactUrl =
      `https://api.letscube.ru/releases/files/${platform}/0.1.0/letscube-0.1.0.${extension}`;
    await routeManifest(page, platform, {
      available: true,
      version: "0.1.0",
      build: 1,
      artifact: { url: artifactUrl, size: 8_734_685, sha256: SHA256 },
    });
    await openSettingsOrSkip(page);

    const state = page.getByTestId("release-catalog-state");
    await expect(state).toHaveAttribute("data-state", /available|current|update_available/);
    await expect(page.getByTestId("release-download-button")).toHaveAttribute("href", artifactUrl);

    const cardBox = await page.getByTestId("release-distribution-card").boundingBox();
    const buttonBox = await page.getByTestId("release-download-button").boundingBox();
    expect(cardBox).not.toBeNull();
    expect(buttonBox).not.toBeNull();
    expect(buttonBox!.x + buttonBox!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
});

async function routeManifest(
  page: Page,
  platform: "android" | "windows",
  overrides: Record<string, unknown>,
) {
  await page.route(`https://api.letscube.ru/releases/v1/${platform}/stable.json`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        schemaVersion: 1,
        platform,
        channel: "stable",
        available: false,
        version: "0.0.0",
        build: 0,
        publishedAt: "2026-07-12T00:00:00.000Z",
        minimumSupportedVersion: null,
        mandatory: false,
        notes: "",
        artifact: null,
        ...overrides,
      }),
    });
  });
}

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
