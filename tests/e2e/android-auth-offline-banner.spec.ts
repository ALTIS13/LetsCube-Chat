import { expect, test, type Page } from "@playwright/test";

async function openOfflineAndroidAuth(page: Page, theme: "light" | "dark", route: "/login" | "/register" = "/login") {
  await page.addInitScript((selectedTheme) => {
    (window as unknown as Record<string, unknown>).androidBridge = { postMessage: () => undefined };
    localStorage.setItem("kub-theme", selectedTheme);
  }, theme);
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("auth-form-shell")).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.getByTestId("connection-status-banner")).toBeVisible();
  await expect(page.locator("html")).toHaveClass(/kub-android-connection-visible/);
}

async function overlap(page: Page, label: string) {
  return page.evaluate((text) => {
    const banner = document.querySelector('[data-testid="connection-status-banner"]')!.getBoundingClientRect();
    const footer = Array.from(document.querySelectorAll("a")).find((link) =>
      link.textContent?.includes(text),
    )!.getBoundingClientRect();
    const width = Math.max(0, Math.min(banner.right, footer.right) - Math.max(banner.left, footer.left));
    const height = Math.max(0, Math.min(banner.bottom, footer.bottom) - Math.max(banner.top, footer.top));
    return width * height;
  }, label);
}

for (const { width, height, theme, safeBottom } of [
  { width: 360, height: 690, theme: "light", safeBottom: 0 },
  { width: 360, height: 690, theme: "dark", safeBottom: 24 },
  { width: 390, height: 690, theme: "light", safeBottom: 0 },
  { width: 390, height: 690, theme: "dark", safeBottom: 24 },
  { width: 1440, height: 900, theme: "light", safeBottom: 0 },
  { width: 1440, height: 900, theme: "dark", safeBottom: 0 },
] as const) {
  test(`native Android ${width}px ${theme} offline footer stays clear (safe bottom ${safeBottom})`, async ({ page }, info) => {
    await page.setViewportSize({ width, height });
    await openOfflineAndroidAuth(page, theme);
    await page.evaluate((inset) => document.documentElement.style.setProperty("--kub-safe-bottom", `${inset}px`), safeBottom);
    const bannerBox = await page.getByTestId("connection-status-banner").boundingBox();
    const logoBox = await page.getByTestId("auth-brand-lockup").boundingBox();
    expect(bannerBox).not.toBeNull();
    expect(logoBox).not.toBeNull();
    expect(bannerBox!.y + bannerBox!.height, "the offline banner covers the brand").toBeLessThanOrEqual(logoBox!.y - 8);
    expect(await overlap(page, "Зарегистрироваться"), "the offline banner covers registration").toBe(0);
    expect(await overlap(page, "Политикой конфиденциальности"), "the offline banner covers privacy").toBe(0);
    if (width >= 390) await page.screenshot({ path: info.outputPath(`android-auth-offline-${width}-${theme}.png`) });
  });
}

test("native Android registration footer remains reachable below the banner", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 690 });
  await openOfflineAndroidAuth(page, "light", "/register");
  const bannerBox = await page.getByTestId("connection-status-banner").boundingBox();
  const logoBox = await page.getByTestId("auth-brand-lockup").boundingBox();
  expect(bannerBox).not.toBeNull();
  expect(logoBox).not.toBeNull();
  expect(bannerBox!.y + bannerBox!.height, "the offline banner covers registration branding").toBeLessThanOrEqual(logoBox!.y - 8);
  await page.locator(".kub-auth-shell").evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const recovery = page.getByRole("link", { name: "Восстановить доступ" });
  await expect(recovery).toBeInViewport();
  expect(await overlap(page, "Восстановить доступ"), "the offline banner covers recovery").toBe(0);
});

test("Android reserve clears on reconnect, browser never receives it", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 690 });
  await openOfflineAndroidAuth(page, "dark");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByTestId("connection-status-banner")).toBeHidden();
  await expect(page.locator("html")).not.toHaveClass(/kub-android-connection-visible/);

  await page.addInitScript(() => { delete (window as unknown as Record<string, unknown>).androidBridge; });
  await page.reload();
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  const browserBanner = page.getByTestId("connection-status-banner");
  await expect(browserBanner).toBeVisible();
  await expect(page.locator("html")).not.toHaveClass(/kub-android-connection-visible/);
  const browserBox = await browserBanner.boundingBox();
  expect(browserBox).not.toBeNull();
  expect(browserBox!.y + browserBox!.height).toBeCloseTo(690 - 16, 0);
});
