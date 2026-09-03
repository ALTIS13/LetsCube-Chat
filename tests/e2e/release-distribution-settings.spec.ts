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
    await expect(state).toContainText(/12.*2026/);
    await expect(page.getByTestId("release-download-button")).toHaveAttribute("href", artifactUrl);

    const cardBox = await page.getByTestId("release-distribution-card").boundingBox();
    const buttonBox = await page.getByTestId("release-download-button").boundingBox();
    expect(cardBox).not.toBeNull();
    expect(buttonBox).not.toBeNull();
    expect(buttonBox!.x + buttonBox!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });

  test("visible-app resume bypasses a fresh cache and refreshes release status", async ({ page }, testInfo) => {
    const platform = testInfo.project.name.includes("mobile") ? "android" : "windows";
    const extension = platform === "android" ? "apk" : "exe";
    const artifactUrl =
      `https://api.letscube.ru/releases/files/${platform}/0.2.0/letscube-0.2.0.${extension}`;
    let requestCount = 0;
    await clearReleaseCache(page);
  await page.route(`https://api.letscube.ru/releases/v1/${platform}/stable.json`, async (route) => {
      requestCount += 1;
      const available = requestCount > 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({
          schemaVersion: 1,
          platform,
          channel: "stable",
          available,
          version: available ? "0.2.0" : "0.0.0",
          build: available ? 2 : 0,
          publishedAt: "2026-07-12T00:00:00.000Z",
          minimumSupportedVersion: null,
          mandatory: false,
          notes: "",
          artifact: available
            ? { url: artifactUrl, size: 8_734_685, sha256: SHA256 }
            : null,
        }),
      });
    });

    await openSettingsOrSkip(page);
    await expect(page.getByTestId("release-catalog-state")).toHaveAttribute("data-state", "preparing");
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(page.getByTestId("release-catalog-state")).toHaveAttribute("data-state", "available");
    expect(requestCount).toBeGreaterThanOrEqual(2);
  });
});

/**
 * The catalog client caches a manifest in localStorage with a TTL, and the
 * saved auth state carries that storage between runs. A cache entry written by
 * an earlier session answers before a stub is ever reached, so the test would
 * silently assert against whatever production last published.
 */
async function clearReleaseCache(page: Page) {
  await page.addInitScript(() => {
    try {
      for (const key of Object.keys(globalThis.localStorage ?? {})) {
        if (key.startsWith("letscube:release-catalog:")) localStorage.removeItem(key);
      }
    } catch {
      /* a browser that blocks site data has no cache to clear */
    }
  });
}

async function routeManifest(
  page: Page,
  platform: "android" | "windows",
  overrides: Record<string, unknown>,
) {
  await clearReleaseCache(page);
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
  await page.getByRole("tab", { name: "Приложение" }).click();
  await expect(page.getByRole("tabpanel", { name: "Приложение" })).toBeVisible();
}
