import { expect, type Page, test } from "@playwright/test";
import { gotoOrSkip } from "./helpers/auth";

test.describe("Yandex SmartCaptcha auth gateway", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      process.env.KUB_EXPECT_YANDEX_CAPTCHA !== "1",
      "Yandex SmartCaptcha assertions require a dev build with VITE_AUTH_CAPTCHA_PROVIDER=yandex-smartcaptcha",
    );

    await page.addInitScript(() => {
      (
        window as typeof window & {
          smartCaptcha?: FakeSmartCaptcha;
          __lastSmartCaptchaOptions?: FakeSmartCaptchaOptions;
        }
      ).smartCaptcha = {
        render(container: HTMLElement, options: FakeSmartCaptchaOptions) {
          container.classList.add("smart-captcha");
          container.setAttribute("data-sitekey", options.sitekey);
          container.style.height = "102px";
          const fakeWidget = document.createElement("div");
          fakeWidget.setAttribute("data-testid", "fake-yandex-widget");
          fakeWidget.style.height = "102px";
          fakeWidget.style.width = "100%";
          container.appendChild(fakeWidget);
          window.__lastSmartCaptchaOptions = options;
          return "playwright-yandex-widget";
        },
        reset() {},
        destroy() {},
      };
    });
  });

  test("/register renders Yandex SmartCaptcha and blocks submit without token", async ({
    page,
  }) => {
    const requests = collectAuthRequests(page);
    await mockRegistrationInviteMode(page, false);
    await gotoOrSkip(page, "/register");

    await expect(page.getByTestId("auth-captcha")).toBeVisible();
    await expect(page.getByTestId("auth-captcha").locator(".smart-captcha")).toHaveAttribute(
      "data-sitekey",
      /.+/,
    );

    await fillRegistration(page);
    await page.getByRole("button", { name: "Создать аккаунт" }).click();

    await expect(page.getByText("Подтвердите защиту от автоматической регистрации.")).toBeVisible();
    expect(requests.directSignup).toBe(0);
    expect(requests.gateway).toBe(0);
  });

  test("/register submits through auth-yandex-gateway when token exists", async ({ page }) => {
    const requests = collectAuthRequests(page);
    await mockRegistrationInviteMode(page, false);
    await page.route("**/functions/v1/auth-yandex-gateway", async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      expect(body.action).toBe("signup");
      expect(body.captchaToken).toBe("playwright-smart-token");
      expect(body.captchaProvider).toBe("yandex-smartcaptcha");
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

  test("/register keeps invite code from URL and sends it only with signup payload", async ({
    page,
  }) => {
    const requests = collectAuthRequests(page);
    await mockRegistrationInviteMode(page, false);
    await page.route("**/functions/v1/auth-yandex-gateway", async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      expect(body.action).toBe("signup");
      expect(body.inviteCode).toBe("STAFF-2026");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });

    await gotoOrSkip(page, "/register?invite=staff-2026");
    await expect(page.getByPlaceholder("Например STAFF-2026")).toHaveCount(0);
    await fillRegistration(page);
    await page.evaluate(() => window.__lastSmartCaptchaOptions?.callback("playwright-smart-token"));
    await page.getByRole("button", { name: "Создать аккаунт" }).click();

    await expect(page.getByText("Проверьте почту")).toBeVisible();
    expect(requests.gateway).toBe(1);
    expect(requests.directSignup).toBe(0);
  });

  test("/register maps unavailable invite to friendly copy", async ({ page }) => {
    const requests = collectAuthRequests(page);
    await page.route("**/functions/v1/auth-yandex-gateway", async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      expect(body.action).toBe("signup");
      expect(body.inviteCode).toBe("USED-CODE");
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "invite_used" }),
      });
    });

    await gotoOrSkip(page, "/register?invite=used-code");
    await fillRegistration(page);
    await page.evaluate(() => window.__lastSmartCaptchaOptions?.callback("playwright-smart-token"));
    await page.getByRole("button", { name: "Создать аккаунт" }).click();

    await expect(page.getByText("Лимит использований приглашения исчерпан.")).toBeVisible();
    expect(requests.gateway).toBe(1);
    expect(requests.directSignup).toBe(0);
  });

  test("/register shows invite-only banner and blocks signup without an invite", async ({
    page,
  }) => {
    const requests = collectAuthRequests(page);
    await mockRegistrationInviteMode(page, true);

    await gotoOrSkip(page, "/register");
    await expect(
      page.getByText("Регистрация сейчас доступна только по приглашению."),
    ).toBeVisible();
    await expect(page.getByPlaceholder("Например STAFF-2026")).toBeVisible();

    await fillRegistration(page);
    await page.evaluate(() => window.__lastSmartCaptchaOptions?.callback("playwright-smart-token"));
    await page.getByRole("button", { name: "Создать аккаунт" }).click();

    await expect(page.getByText("Введите код приглашения, чтобы создать аккаунт.")).toBeVisible();
    expect(requests.gateway).toBe(0);
    expect(requests.directSignup).toBe(0);
  });

  test("/register maps gateway rate limit to friendly copy and never calls direct signup", async ({
    page,
  }) => {
    const requests = collectAuthRequests(page);
    await mockRegistrationInviteMode(page, false);
    await page.route("**/functions/v1/auth-yandex-gateway", async (route) => {
      await route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "rate_limited" }),
      });
    });

    await gotoOrSkip(page, "/register");
    await fillRegistration(page);
    await page.evaluate(() => window.__lastSmartCaptchaOptions?.callback("playwright-smart-token"));
    await page.getByRole("button", { name: "Создать аккаунт" }).click();

    await expect(
      page.getByText("Слишком много попыток. Подождите и повторите позже."),
    ).toBeVisible();
    expect(requests.gateway).toBe(1);
    expect(requests.directSignup).toBe(0);
  });

  test("/login recovery submits through auth-yandex-gateway and maps gateway rate limit", async ({
    page,
  }) => {
    const requests = collectAuthRequests(page);
    await page.route("**/functions/v1/auth-yandex-gateway", async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      expect(body.action).toBe("recovery");
      expect(body.captchaToken).toBe("playwright-smart-token");
      expect(body.captchaProvider).toBe("yandex-smartcaptcha");
      await route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "too_many_requests" }),
      });
    });

    await gotoOrSkip(page, "/login?reset=1");
    await page.locator('input[type="email"]').fill("player@example.test");
    await page.evaluate(() => window.__lastSmartCaptchaOptions?.callback("playwright-smart-token"));
    await page.getByRole("button", { name: "Отправить ссылку" }).click();

    await expect(
      page.getByText("Слишком много попыток. Подождите и повторите позже."),
    ).toBeVisible();
    expect(requests.gateway).toBe(1);
    expect(requests.directRecover).toBe(0);
  });

  test("/register keeps Yandex SmartCaptcha inside the auth card and passes resolved theme", async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.setItem("kub-theme", "dark"));
    await gotoOrSkip(page, "/register");

    const layout = await page
      .getByTestId("auth-captcha")
      .locator(".smart-captcha")
      .evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const fakeWidget = node.querySelector<HTMLElement>('[data-testid="fake-yandex-widget"]');
        const fakeRect = fakeWidget?.getBoundingClientRect();
        const styles = getComputedStyle(node);
        return {
          bottomGap: fakeRect ? rect.bottom - fakeRect.bottom : null,
          colorScheme: styles.colorScheme,
          height: rect.height,
          optionsTheme: window.__lastSmartCaptchaOptions?.theme,
          overflow: styles.overflow,
          paddingBottom: styles.paddingBottom,
          paddingTop: styles.paddingTop,
          themeAttribute: node.getAttribute("data-theme"),
        };
      });

    expect(layout.height).toBeGreaterThanOrEqual(102);
    expect(layout.bottomGap).not.toBeNull();
    expect(layout.bottomGap as number).toBeGreaterThanOrEqual(0);
    expect(layout.paddingTop).toBe("0px");
    expect(layout.paddingBottom).toBe("0px");
    expect(layout.overflow).toBe("hidden");
    expect(layout.themeAttribute).toBe("dark");
    expect(layout.colorScheme).toContain("dark");
    expect(layout.optionsTheme).toBe("dark");
  });

  test("/register enables the supported SmartCaptcha WebView mode inside Windows", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.letscubeDesktop = {
        platform: "windows",
        version: "0.2.8",
        build: 12,
      } as Window["letscubeDesktop"];
    });
    await gotoOrSkip(page, "/register");

    await expect(page.getByTestId("auth-captcha")).toBeVisible();
    expect(await page.evaluate(() => window.__lastSmartCaptchaOptions?.webview)).toBe(true);
  });
});

function collectAuthRequests(page: Page) {
  const requests = { directSignup: 0, directRecover: 0, gateway: 0 };
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("/auth/v1/signup")) requests.directSignup += 1;
    if (url.includes("/auth/v1/recover")) requests.directRecover += 1;
    if (url.includes("/functions/v1/auth-yandex-gateway")) requests.gateway += 1;
  });
  return requests;
}

async function fillRegistration(page: Page) {
  await page.locator('input[autocomplete="name"]').fill("Новый Игрок");
  await page.locator('input[type="email"]').fill("new-user@example.test");
  await page.locator('input[type="password"]').fill("correct-horse-battery");
}

async function mockRegistrationInviteMode(page: Page, inviteOnlyEnabled: boolean) {
  await page.route("**/rest/v1/rpc/registration_invite_mode", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ invite_only_enabled: inviteOnlyEnabled }]),
    });
  });
}

interface FakeSmartCaptchaOptions {
  sitekey: string;
  callback: (token: string) => void;
  "expired-callback"?: () => void;
  "error-callback"?: () => void;
  theme?: "light" | "dark";
  webview?: boolean;
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
