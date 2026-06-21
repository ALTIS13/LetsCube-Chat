import { expect, test, type Page } from "@playwright/test";
import { gotoOrSkip } from "./helpers/auth";

test.describe("Yandex SmartCaptcha auth gateway", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      process.env.KUB_EXPECT_YANDEX_CAPTCHA !== "1",
      "Yandex SmartCaptcha assertions require a dev build with VITE_AUTH_CAPTCHA_PROVIDER=yandex-smartcaptcha",
    );

    await page.addInitScript(() => {
      (window as typeof window & { smartCaptcha?: FakeSmartCaptcha; __lastSmartCaptchaOptions?: FakeSmartCaptchaOptions }).smartCaptcha = {
        render(container: HTMLElement, options: FakeSmartCaptchaOptions) {
          container.classList.add("smart-captcha");
          container.setAttribute("data-sitekey", options.sitekey);
          window.__lastSmartCaptchaOptions = options;
          return "playwright-yandex-widget";
        },
        reset() {},
        destroy() {},
      };
    });
  });

  test("/register renders Yandex SmartCaptcha and blocks submit without token", async ({ page }) => {
    const requests = collectAuthRequests(page);
    await gotoOrSkip(page, "/register");

    await expect(page.getByTestId("auth-captcha")).toBeVisible();
    await expect(page.getByTestId("auth-captcha").locator(".smart-captcha")).toHaveAttribute(
      "data-sitekey",
      "playwright-yandex-site-key",
    );

    await fillRegistration(page);
    await page.getByRole("button", { name: "Создать аккаунт" }).click();

    await expect(page.getByText("Подтвердите защиту от автоматической регистрации.")).toBeVisible();
    expect(requests.directSignup).toBe(0);
    expect(requests.gateway).toBe(0);
  });

  test("/register submits through auth-yandex-gateway when token exists", async ({ page }) => {
    const requests = collectAuthRequests(page);
    await page.route("**/functions/v1/auth-yandex-gateway", async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      expect(body.action).toBe("signup");
      expect(body.captchaToken).toBe("playwright-smart-token");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });

    await gotoOrSkip(page, "/register");
    await fillRegistration(page);
    await page.evaluate(() => window.__lastSmartCaptchaOptions?.callback("playwright-smart-token"));
    await page.getByRole("button", { name: "Создать аккаунт" }).click();

    await expect(page.getByText("Проверьте почту")).toBeVisible();
    expect(requests.gateway).toBe(1);
    expect(requests.directSignup).toBe(0);
  });
});

function collectAuthRequests(page: Page) {
  const requests = { directSignup: 0, gateway: 0 };
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("/auth/v1/signup")) requests.directSignup += 1;
    if (url.includes("/functions/v1/auth-yandex-gateway")) requests.gateway += 1;
  });
  return requests;
}

async function fillRegistration(page: Page) {
  await page.locator('input[autocomplete="name"]').fill("Новый Игрок");
  await page.locator('input[type="email"]').fill("new-user@example.test");
  await page.locator('input[type="password"]').fill("correct-horse-battery");
}

interface FakeSmartCaptchaOptions {
  sitekey: string;
  callback: (token: string) => void;
  "expired-callback"?: () => void;
  "error-callback"?: () => void;
}

interface FakeSmartCaptcha {
  render: (container: HTMLElement, options: FakeSmartCaptchaOptions) => string;
  reset: (widgetId?: string) => void;
  destroy: (widgetId?: string) => void;
}

declare global {
  interface Window {
    __lastSmartCaptchaOptions?: FakeSmartCaptchaOptions;
  }
}
