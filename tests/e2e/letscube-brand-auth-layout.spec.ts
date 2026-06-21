import { expect, test, type Page } from "@playwright/test";
import { gotoOrSkip } from "./helpers/auth";

test.describe("Letscube auth brand layout", () => {
  for (const path of ["/login", "/register"] as const) {
    test(`${path} has one brand lockup and no legacy KUB label`, async ({ page }) => {
      const consoleErrors = collectConsoleErrors(page);
      await gotoOrSkip(page, path);

      await expect(page.getByTestId("auth-brand-lockup")).toBeVisible();
      await expect(page.locator('img[src*="letscube-logo"]')).toHaveCount(1);
      await expect(page.getByText("КУБ", { exact: true })).toHaveCount(0);
      await expect(page.getByText("KUB", { exact: true })).toHaveCount(0);

      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        await page.evaluate(() => window.innerWidth + 1),
      );
      expect(unexpectedConsoleErrors(consoleErrors)).toEqual([]);
    });

    test(`${path} keeps the auth form centered independently from the mascot`, async ({ page }, testInfo) => {
      const consoleErrors = collectConsoleErrors(page);
      await gotoOrSkip(page, path);

      const formShell = page.getByTestId("auth-form-shell");
      await expect(formShell).toBeVisible();
      const box = await formShell.boundingBox();
      expect(box, "auth form shell should have a bounding box").not.toBeNull();

      const viewport = testInfo.project.use.viewport;
      const width = viewport && typeof viewport === "object" && "width" in viewport ? viewport.width : 0;
      const formCenter = box!.x + box!.width / 2;
      const viewportCenter = width / 2;
      const tolerance = width >= 1024 ? 80 : 28;
      expect(Math.abs(formCenter - viewportCenter)).toBeLessThanOrEqual(tolerance);

      const mascot = page.locator('img[src*="letscube-mascot-primary"]').first();
      await expect(mascot).toBeVisible();
      const pointerEvents = await mascot.evaluate((node) => getComputedStyle(node).pointerEvents);
      expect(pointerEvents).toBe("none");

      const mascotOpacity = Number(await mascot.evaluate((node) => getComputedStyle(node).opacity));
      if (width < 1024) {
        expect(mascotOpacity).toBeLessThanOrEqual(0.2);
      } else {
        const mascotBox = await mascot.boundingBox();
        expect(mascotBox, "desktop mascot should have a bounding box").not.toBeNull();
        expect(mascotBox!.x).toBeGreaterThanOrEqual(box!.x + box!.width - 16);
      }

      expect(unexpectedConsoleErrors(consoleErrors)).toEqual([]);
    });
  }
});

test.describe("Letscube safe public registration", () => {
  test("/register provides signup form with recovery guidance", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await gotoOrSkip(page, "/register");

    await expect(page.getByRole("heading", { name: "Создать аккаунт" })).toBeVisible();
    await expect(page.locator('input[autocomplete="name"]')).toBeVisible();
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.getByRole("button", { name: "Создать аккаунт" })).toBeVisible();
    await expect(page.getByText("Уже есть аккаунт?")).toBeVisible();
    await expect(page.getByRole("link", { name: "Восстановить доступ" })).toBeVisible();
    expect(unexpectedConsoleErrors(consoleErrors)).toEqual([]);
  });

  test("/register never opens an authenticated app session after signup", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await page.route("**/auth/v1/signup**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          access_token: PLAYWRIGHT_FAKE_JWT,
          token_type: "bearer",
          expires_in: 3600,
          refresh_token: "playwright-redacted-refresh-token",
          user: {
            id: "00000000-0000-4000-8000-000000000001",
            aud: "authenticated",
            role: "authenticated",
            email: "new-user@example.test",
            email_confirmed_at: null,
            phone: "",
            created_at: "2026-06-21T00:00:00.000Z",
            updated_at: "2026-06-21T00:00:00.000Z",
            app_metadata: { provider: "email", providers: ["email"] },
            user_metadata: { full_name: "Новый Игрок" },
            identities: [],
          },
        }),
      });
    });
    await page.route("**/auth/v1/logout**", async (route) => {
      await route.fulfill({ status: 204, body: "" });
    });

    await gotoOrSkip(page, "/register");
    await page.locator('input[autocomplete="name"]').fill("Новый Игрок");
    await page.locator('input[type="email"]').fill("new-user@example.test");
    await page.locator('input[type="password"]').fill("correct-horse-battery");
    await page.getByRole("button", { name: "Создать аккаунт" }).click();

    await expect(page.getByText("Проверьте почту")).toBeVisible();
    await expect(page).toHaveURL(/\/register/);
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    const storedAuthToken = await page.evaluate(() =>
      Object.entries(window.localStorage).find(([key]) => key.includes("auth-token"))?.[1] ?? "",
    );
    expect(storedAuthToken).not.toContain(PLAYWRIGHT_FAKE_JWT);
    expect(unexpectedConsoleErrors(consoleErrors)).toEqual([]);
  });

  test("/register keeps existing-email signup errors generic", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await page.route("**/auth/v1/signup**", async (route) => {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          code: "user_already_exists",
          msg: "User already registered",
          message: "User already registered",
        }),
      });
    });

    await gotoOrSkip(page, "/register");
    await page.locator('input[autocomplete="name"]').fill("Существующий Игрок");
    await page.locator('input[type="email"]').fill("existing-user@example.test");
    await page.locator('input[type="password"]').fill("correct-horse-battery");
    await page.getByRole("button", { name: "Создать аккаунт" }).click();

    await expect(page.getByText("Проверьте почту")).toBeVisible();
    await expect(page.getByText(/Пользователь.*уже зарегистрирован/i)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Восстановить доступ" })).toBeVisible();
    expect(unexpectedConsoleErrors(consoleErrors)).toEqual([]);
  });

  test("/login?reset=1 opens recovery mode directly", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await gotoOrSkip(page, "/login?reset=1");

    await expect(page.getByRole("button", { name: "Отправить ссылку" })).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    expect(unexpectedConsoleErrors(consoleErrors)).toEqual([]);
  });
});

function collectConsoleErrors(page: Page): string[] {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });
  return consoleErrors;
}

const PLAYWRIGHT_FAKE_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
  "eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDEiLCJleHAiOjQxMDI0NDQ4MDB9." +
  "playwright-redacted-signature";

function unexpectedConsoleErrors(messages: string[]): string[] {
  return messages.filter(
    (message) =>
      !message.includes("Failed to load resource") &&
      !message.includes("Missing Supabase environment variables") &&
      !(message.includes("TypeError: Failed to fetch") && message.includes("@supabase_supabase-js") && message.includes("_refreshAccessToken")),
  );
}
