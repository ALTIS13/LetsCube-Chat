import { expect, test, type Page } from "@playwright/test";
import { gotoOrSkip } from "./helpers/auth";

test.describe("Letscube auth brand layout", () => {
  test("light auth theme uses the dark official wordmark", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop-1440", "theme asset check runs once");
    await page.addInitScript(() => localStorage.setItem("kub-theme", "light"));
    await installCaptchaMock(page);
    await gotoOrSkip(page, "/login");

    const logo = page.getByTestId("auth-brand-lockup").locator("img");
    await expect(logo).toHaveAttribute("src", /letscube-wordmark-vertical-dark\.svg$/);
  });

  for (const path of ["/login", "/register"] as const) {
    test(`${path} has one brand lockup and no legacy KUB label`, async ({ page }) => {
      const consoleErrors = collectConsoleErrors(page);
      await installCaptchaMock(page);
      await gotoOrSkip(page, path);

      await expect(page.getByTestId("auth-brand-lockup")).toBeVisible();
      await expect(page.locator('img[src*="letscube-wordmark"]')).toHaveCount(1);
      await expect(page.getByText("КУБ", { exact: true })).toHaveCount(0);
      await expect(page.getByText("KUB", { exact: true })).toHaveCount(0);

      const visibleText = await page.locator("body").innerText();
      expect(visibleText).not.toMatch(/кибер[- ]?арен|игров(?:ой|ого)\s+клуб/i);

      const description = await page.locator('meta[name="description"]').getAttribute("content");
      expect(description).toBe(
        "LETSCUBE - защищённый мессенджер для общения, задач и совместной работы.",
      );

      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        await page.evaluate(() => window.innerWidth + 1),
      );
      expect(unexpectedConsoleErrors(consoleErrors)).toEqual([]);
    });

    test(`${path} keeps the auth form centered independently from the mascot`, async ({ page }, testInfo) => {
      const consoleErrors = collectConsoleErrors(page);
      await installCaptchaMock(page);
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
  test("/register keeps the submit controls reachable in a short desktop window", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1360, height: 860 });
    await installCaptchaMock(page);
    await mockRegistrationInviteMode(page, true);
    await gotoOrSkip(page, "/register");

    const authShell = page.locator(".kub-auth-shell");
    const initialScrollState = await authShell.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }));
    expect(initialScrollState.scrollHeight).toBeGreaterThan(initialScrollState.clientHeight);
    await authShell.hover();
    await page.mouse.wheel(0, 1_200);
    await expect.poll(() => authShell.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

    const submit = page.getByRole("button", { name: "Создать аккаунт" });
    await expect(submit).toBeVisible();
    const submitBox = await submit.boundingBox();
    expect(submitBox).not.toBeNull();
    expect(submitBox!.y + submitBox!.height).toBeLessThanOrEqual(860);

    const recovery = page.getByRole("link", { name: "Восстановить доступ" });
    await expect(recovery).toBeVisible();
    const recoveryBox = await recovery.boundingBox();
    expect(recoveryBox).not.toBeNull();
    expect(recoveryBox!.y + recoveryBox!.height).toBeLessThanOrEqual(860);
  });

  test("/register provides signup form with recovery guidance", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await installCaptchaMock(page);
    await gotoOrSkip(page, "/register");

    await expect(page.getByRole("heading", { name: "Создать аккаунт" })).toBeVisible();
    await expect(page.locator('input[autocomplete="name"]')).toBeVisible();
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.getByRole("button", { name: "Создать аккаунт" })).toBeVisible();
    await expect(page.getByText("Уже есть аккаунт?")).toBeVisible();
    await expect(page.getByRole("link", { name: "Восстановить доступ" })).toBeVisible();
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(/invite-link|invite-code|Invite-only|Email|e-mail/i);
    expect(unexpectedConsoleErrors(consoleErrors)).toEqual([]);
  });

  test("/register never opens an authenticated app session after signup", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await installCaptchaMock(page);
    await mockRegistrationInviteMode(page, false);
    await mockAuthGatewaySuccess(page);
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
            user_metadata: { full_name: "Новый пользователь" },
            identities: [],
          },
        }),
      });
    });
    await page.route("**/auth/v1/logout**", async (route) => {
      await route.fulfill({ status: 204, body: "" });
    });

    await gotoOrSkip(page, "/register");
    await page.locator('input[autocomplete="name"]').fill("Новый пользователь");
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
    await installCaptchaMock(page);
    await mockRegistrationInviteMode(page, false);
    await mockAuthGatewaySuccess(page);
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
    await installCaptchaMock(page);
    await gotoOrSkip(page, "/login?reset=1");

    await expect(page.getByRole("button", { name: "Отправить ссылку" })).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    expect(unexpectedConsoleErrors(consoleErrors)).toEqual([]);
  });

  test("/login maps auth token rate limit to friendly copy", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await installCaptchaMock(page);
    let tokenRequests = 0;
    await page.route("**/auth/v1/token**", async (route) => {
      tokenRequests += 1;
      await route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({
          code: "over_request_rate_limit",
          message: "Request rejected",
        }),
      });
    });

    await gotoOrSkip(page, "/login");
    await page.locator('input[type="email"]').fill("player@example.test");
    await page.locator('input[type="password"]').fill("wrong-password");
    await page.getByRole("button", { name: "Войти" }).click();

    await expect(page.getByText("Слишком много попыток. Подождите и повторите позже.")).toBeVisible();
    expect(tokenRequests).toBe(1);
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

async function installCaptchaMock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const complete = (callback?: (token: string) => void) => {
      window.setTimeout(() => callback?.("playwright-captcha-token"), 0);
    };
    Object.defineProperty(window, "smartCaptcha", {
      configurable: true,
      value: {
        render: (_container: HTMLElement, options: { callback?: (token: string) => void }) => {
          complete(options.callback);
          return "playwright-yandex-captcha";
        },
        reset: () => undefined,
        destroy: () => undefined,
      },
    });
    Object.defineProperty(window, "turnstile", {
      configurable: true,
      value: {
        render: (_container: HTMLElement, options: { callback?: (token: string) => void }) => {
          complete(options.callback);
          return "playwright-turnstile-captcha";
        },
        reset: () => undefined,
        remove: () => undefined,
      },
    });
  });
}

async function mockAuthGatewaySuccess(page: Page): Promise<void> {
  await page.route("**/functions/v1/auth-yandex-gateway", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
}

async function mockRegistrationInviteMode(
  page: Page,
  inviteOnlyEnabled: boolean,
): Promise<void> {
  await page.route("**/rest/v1/rpc/registration_invite_mode", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ invite_only_enabled: inviteOnlyEnabled }]),
    });
  });
}

function unexpectedConsoleErrors(messages: string[]): string[] {
  return messages.filter(
    (message) =>
      !message.includes("Failed to load resource") &&
      !message.includes("Missing Supabase environment variables") &&
      !(message.includes("TypeError: Failed to fetch") && message.includes("@supabase_supabase-js") && message.includes("_refreshAccessToken")),
  );
}
