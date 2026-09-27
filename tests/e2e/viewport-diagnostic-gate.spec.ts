import { expect, test } from "@playwright/test";

/**
 * D-111, temporary. `public/__qa/viewport-diagnostic.js` exists only to be
 * opened on a rented iPhone and added to the Home Screen, so the installed
 * LETSCUBE container can report its own geometry: MobileNext cannot run
 * JavaScript in an iOS web view, but it can read text on the screen.
 *
 * What this pins is that nobody else gets it. Without the exact flag the page
 * keeps its own manifest, loads no extra script and records nothing; a flag
 * that merely looks similar changes nothing either. Delete this spec together
 * with the diagnostic.
 */

test.use({ screenshot: "off", trace: "off", video: "off", serviceWorkers: "block" });

const IPHONE_ONLY = "the manifest is injected only for iPhone and iPad user agents";

for (const search of ["", "?kub-viewport-diagnostic=0", "?kub-viewport-diagnostic=true", "?kub-viewport-diagnostic1=1"]) {
  test(`"${search || "no query"}" keeps the real manifest and loads no diagnostic`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "webkit-mobile-390", IPHONE_ONLY);
    await page.goto(`/${search}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.json");
    await expect(page.locator('script[src="/__qa/viewport-diagnostic.js"]')).toHaveCount(0);
    await page.waitForTimeout(1500);
    await expect(page.locator("#kub-viewport-diagnostic")).toHaveCount(0);
    expect(await page.evaluate(() => "__kubViewportBoot" in window)).toBe(false);
  });
}

test("the exact flag installs the diagnostic manifest and shows geometry", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "webkit-mobile-390", IPHONE_ONLY);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/?kub-viewport-diagnostic=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/__qa/viewport-diagnostic.json");
  const panel = page.locator("#kub-viewport-diagnostic");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("inner 390x844");
  await expect(panel).toContainText("fixed0 0-844");
  await expect(panel).toContainText("boot inner 844");

  await panel.getByRole("button", { name: "Свернуть" }).click();
  await expect(panel.getByRole("button", { name: "Развернуть" })).toBeVisible();
  expect(errors).toEqual([]);

  const diagnostic = await (await request.get("/__qa/viewport-diagnostic.json")).json();
  const real = await (await request.get("/manifest.json")).json();
  expect(diagnostic.start_url).toBe("/?kub-viewport-diagnostic=1");
  expect(diagnostic.id).toBe("/?kub-viewport-diagnostic=1");
  expect(real.start_url).toBe("/");
  expect(real.id).toBe("/");
  // The same container, so the measurement is of the real one.
  for (const key of ["display", "display_override", "scope", "orientation", "background_color", "theme_color"]) {
    expect(diagnostic[key], key).toEqual(real[key]);
  }
});
