import { expect, test, type Page } from "@playwright/test";
import { gotoOrSkip } from "./helpers/auth";

const confirmationProjects = new Set([
  "chromium-desktop-1440",
  "chromium-mobile-390",
  "chromium-mobile-412",
]);

test.describe("Registration confirmation", () => {
  test("shows the approved confirmation copy with a disabled resend control", async ({ page }, testInfo) => {
    test.skip(!confirmationProjects.has(testInfo.project.name), "confirmation coverage runs at required viewports");
    const consoleErrors = collectConsoleErrors(page);
    await installCaptchaMock(page);
    await mockRegistrationInviteMode(page);
    await mockSignupSuccess(page);
    await gotoOrSkip(page, "/register");

    await page.locator('input[autocomplete="name"]').fill("Новый пользователь");
    await page.locator('input[type="email"]').fill("new-user@example.test");
    await page.locator('input[type="password"]').fill("correct-horse-battery");
    await page.getByRole("button", { name: "Создать аккаунт" }).click();

    await expect(page.getByRole("heading", { name: "Проверьте почту" })).toBeVisible();
    await expect(
      page.getByText(
        "Если к этому адресу электронной почты ещё не привязан аккаунт, мы отправим письмо для подтверждения регистрации.",
      ),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Если письмо не пришло, проверьте папку «Спам» и правильность указанного адреса. При ошибке вернитесь и зарегистрируйтесь с корректным email.",
      ),
    ).toBeVisible();
    await expect(page.getByText("Неподтверждённая учётная запись будет удалена автоматически.")).toBeVisible();
    await expect(page.getByText("n***r@example.test")).toBeVisible();
    await expect(page.getByText(/Восстановить пароль|Восстановить доступ/)).toHaveCount(0);

    const resend = page.getByRole("button", { name: /Отправить письмо повторно/ });
    await expect(resend).toBeDisabled();
    await expect(page.getByTestId("auth-captcha")).toBeVisible();
    await expect(page.getByText("Подтверждение защиты станет доступно после окончания таймера.")).toBeVisible();

    await expect(resend).toBeInViewport();
    const authShell = page.locator(".kub-auth-shell");
    await authShell.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect.poll(() => authShell.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect(authShell).toContainText("Ко входу");
    await expect(authShell).toContainText("Указать другой email");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      await page.evaluate(() => window.innerWidth + 1),
    );

    await page.screenshot({ path: testInfo.outputPath("registration-confirmation.png"), fullPage: false });
    await page.getByText("Указать другой email", { exact: true }).click();
    await expect(page.getByRole("heading", { name: "Создать аккаунт" })).toBeVisible();
    expect(unexpectedConsoleErrors(consoleErrors)).toEqual([]);
  });

  test("requires a fresh CAPTCHA token for a resend", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop-1440", "resend interaction runs once");
    const resendPayloads: Array<{ action?: string; captchaToken?: string }> = [];
    await page.clock.install({ time: new Date("2026-08-30T12:00:00.000Z") });
    await installCaptchaMock(page);
    await mockRegistrationInviteMode(page);
    await mockSignupSuccess(page);
    await mockResendSuccess(page, resendPayloads);
    await gotoOrSkip(page, "/register");

    await page.locator('input[autocomplete="name"]').fill("Новый пользователь");
    await page.locator('input[type="email"]').fill("new-user@example.test");
    await page.locator('input[type="password"]').fill("correct-horse-battery");
    await page.getByRole("button", { name: "Создать аккаунт" }).click();

    const resend = page.getByRole("button", { name: /Отправить письмо повторно/ });
    await expect(resend).toBeDisabled();
    await page.clock.fastForward(60_000);
    await expect(resend).toBeEnabled();
    await expect.poll(() => page.evaluate(() => window.__playwrightCaptchaRenders)).toBeGreaterThanOrEqual(2);
    await resend.click();
    await expect(page.getByText("Письмо отправлено повторно.")).toBeVisible();
    expect(resendPayloads).toHaveLength(1);
    expect(resendPayloads[0]).toMatchObject({
      action: "resend_signup",
      email: "new-user@example.test",
      captchaToken: "playwright-captcha-token-2",
    });
    await expect(resend).toBeDisabled();
  });
});

declare global {
  interface Window {
    __playwrightCaptchaRenders?: number;
  }
}

function collectConsoleErrors(page: Page): string[] {
  const messages: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") messages.push(message.text());
  });
  page.on("pageerror", (error) => {
    messages.push(error.message);
  });
  return messages;
}

async function installCaptchaMock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__playwrightCaptchaRenders = 0;
    const render = (_container: HTMLElement, options: { callback?: (token: string) => void }) => {
      window.__playwrightCaptchaRenders = (window.__playwrightCaptchaRenders ?? 0) + 1;
      const token = `playwright-captcha-token-${window.__playwrightCaptchaRenders}`;
      window.setTimeout(() => options.callback?.(token), 0);
      return `playwright-captcha-${window.__playwrightCaptchaRenders}`;
    };
    Object.defineProperty(window, "turnstile", {
      configurable: true,
      value: { render, reset: () => undefined, remove: () => undefined },
    });
  });
}

async function mockRegistrationInviteMode(page: Page): Promise<void> {
  await page.route("**/rest/v1/rpc/registration_invite_mode", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ invite_only_enabled: false }]),
    });
  });
}

async function mockSignupSuccess(page: Page): Promise<void> {
  await page.route("**/auth/v1/signup**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: null }) });
  });
}

async function mockResendSuccess(
  page: Page,
  payloads: Array<{ action?: string; captchaToken?: string }>,
): Promise<void> {
  await page.route("**/functions/v1/auth-yandex-gateway", async (route) => {
    payloads.push(route.request().postDataJSON() as { action?: string; captchaToken?: string });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
}

function unexpectedConsoleErrors(messages: string[]): string[] {
  return messages.filter(
    (message) =>
      !message.includes("Failed to load resource") &&
      !message.includes("Missing Supabase environment variables") &&
      !(message.includes("TypeError: Failed to fetch") && message.includes("@supabase_supabase-js")),
  );
}
