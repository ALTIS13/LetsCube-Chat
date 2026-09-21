import path from "node:path";
import { expect, test } from "@playwright/test";

test.use({ screenshot: "off", trace: "off", video: "off", serviceWorkers: "block" });

// No accounts: allow only the fixture server, never a real auth/backend call.
test.beforeEach(async ({ page, baseURL }) => {
  expect(["localhost", "127.0.0.1"]).toContain(new URL(baseURL!).hostname);
  await page.route("**/*", (route) => {
    return new URL(route.request().url()).origin === new URL(baseURL!).origin
      ? route.continue()
      : route.fulfill({ status: 503, body: "" });
  });
});

const entry = /\/(?:src\/main\.tsx|assets\/index-[^/]+\.js)(?:\?|$)/;

for (const theme of ["dark", "light"] as const) {
  for (const width of [1440, 390]) {
    test(`failed entry offers a same-session retry (${theme}, ${width})`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.addInitScript((theme) => {
        localStorage.setItem("kub-theme", theme);
      }, theme);
      const route = "/login?returnTo=%2Fchat%2Ffixture#retained";
      await page.goto(route);
      await expect(page.getByTestId("auth-form-shell")).toBeVisible();
      await page.evaluate(() => {
        localStorage.setItem("fixture-session-sentinel", "keep-local");
        sessionStorage.setItem("fixture-draft-sentinel", "keep-session");
      });

      await page.route(entry, (route) => route.abort());
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.locator("#root")).toBeEmpty();
      const retry = page.getByRole("button", { name: "Повторить загрузку", exact: true });
      await expect(retry).toBeVisible({ timeout: 3_000 });
      await expect(retry).toBeInViewport();
      await retry.click({ trial: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      if (process.env.KUB_BOOT_CAPTURE_DIR) {
        await page.screenshot({
          path: path.join(
            process.env.KUB_BOOT_CAPTURE_DIR,
            `${info.project.name}-${theme}-${width}.png`,
          ),
        });
      }

      await page.unroute(entry);
      await retry.click();
      await expect(page.getByTestId("auth-form-shell")).toBeVisible();
      await expect(page).toHaveURL(new RegExp("/login\\?returnTo=%2Fchat%2Ffixture#retained$"));
      await expect(retry).toHaveCount(0);
      expect(
        await page.evaluate(() => [
          localStorage.getItem("fixture-session-sentinel"),
          sessionStorage.getItem("fixture-draft-sentinel"),
        ]),
      ).toEqual(["keep-local", "keep-session"]);
    });
  }
}

test("a stalled entry offers recovery, then yields to a late successful render", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(entry, async (route) => {
    await gate;
    await route.continue();
  });
  try {
    await page.goto("/login", { waitUntil: "commit" });
    await expect(
      page.getByRole("heading", { name: "Загружаем LETSCUBE", exact: true }),
    ).toBeVisible();
    await expect(page.locator("#root")).toBeEmpty();
    await expect(page.locator("#root")).not.toHaveAttribute("data-kub-app-ready", "true");
    await expect(page.getByRole("button", { name: "Повторить загрузку", exact: true })).toBeVisible(
      { timeout: 15_000 },
    );
    release();
    await expect(page.getByTestId("auth-form-shell")).toBeVisible();
    await expect(page.locator("#root")).toHaveAttribute("data-kub-app-ready", "true");
    await expect(page.locator("#kub-boot-recovery")).toHaveCount(0);
    await expect(page.locator("#kub-boot-style")).toHaveCount(0);
    await page.evaluate(() =>
      window.dispatchEvent(new ErrorEvent("error", { message: "synthetic late event" })),
    );
    await expect(page.locator("html")).toHaveAttribute("data-kub-boot-state", "ready");
    await expect(page.locator("#kub-boot-recovery")).toHaveCount(0);
  } finally {
    release();
  }
});

test("a module runtime failure is recoverable without exposing its error", async ({ page }) => {
  await page.route(entry, (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: 'throw new Error("synthetic-private-detail");',
    }),
  );
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Повторить загрузку", exact: true })).toBeVisible({
    timeout: 3_000,
  });
  await expect(page.locator("#kub-boot-recovery")).not.toContainText("synthetic-private-detail");
  await expect(page.locator("#root")).not.toHaveAttribute("data-kub-app-ready", "true");
});

test("offline recovery remains legible and reachable without the app stylesheet", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 320 });
  await page.addInitScript(() => {
    localStorage.setItem("kub-theme", "light");
    Object.defineProperty(navigator, "onLine", { get: () => false });
  });
  await page.route(/\.css(?:\?|$)/, (route) => route.abort());
  await page.route(entry, (route) => route.abort());
  await page.goto("/login");
  const surface = page.locator("#kub-boot-recovery");
  await expect(surface).toContainText("Нет подключения к сети");
  const retry = page.getByRole("button", { name: "Повторить загрузку", exact: true });
  await retry.click({ trial: true });
  await retry.focus();
  await expect(retry).toBeFocused();
  const geometry = await surface.evaluate((node) => ({
    width: node.scrollWidth,
    clientWidth: node.clientWidth,
    background: getComputedStyle(node).backgroundColor,
  }));
  expect(geometry.width).toBe(geometry.clientWidth);
  expect(geometry.background).toBe("rgb(233, 239, 246)");
});
