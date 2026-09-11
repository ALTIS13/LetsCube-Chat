import { expect, type Page, test } from "@playwright/test";
import { gotoOrSkip } from "./helpers/auth";

const confirmationVisualProjects = new Set([
  "chromium-desktop-1440",
  "chromium-desktop-1920",
  "chromium-mobile-412",
  "chromium-mobile-390",
  // The narrowest phone in the matrix since 2026-09-06. A countdown control
  // that has to stay reachable and unclipped is exactly the shape of thing the
  // 360-wide blind spot was hiding.
  "chromium-mobile-360",
]);

/** The explanation under the actions, word for word as the product shows it. */
const confirmationExplanation = [
  "Если к этому адресу электронной почты ещё не привязан аккаунт, мы отправим письмо для подтверждения регистрации.",
  "Если письмо не пришло, проверьте папку «Спам» и правильность указанного адреса. При ошибке вернитесь и зарегистрируйтесь с корректным email.",
  "Неподтверждённая учётная запись будет удалена автоматически.",
];

test.describe("Registration confirmation", () => {
  test("shows the approved confirmation copy with a disabled resend control", async ({
    page,
  }, testInfo) => {
    test.skip(
      !confirmationVisualProjects.has(testInfo.project.name),
      "confirmation coverage runs at required viewports",
    );
    const consoleErrors = collectConsoleErrors(page);
    await installCaptchaMock(page);
    await mockRegistrationInviteMode(page);
    await mockSignupSuccess(page);
    await openRegisterForm(page);
    // The fold contract below is measured against the captcha production
    // serves. Yandex's plate is 136px tall and Turnstile's 65, so a dev server
    // left on the default provider would pass it with 71px the product does not
    // have.
    await expect(
      page.getByTestId("auth-captcha").locator("[data-provider]"),
      "this test measures the production captcha: the dev server needs VITE_AUTH_CAPTCHA_PROVIDER=yandex",
    ).toHaveAttribute("data-provider", "yandex-smartcaptcha");

    await page.locator('input[autocomplete="name"]').fill("Новый пользователь");
    await page.locator('input[type="email"]').fill("new-user@example.test");
    await page.locator('input[type="password"]').fill("correct-horse-battery");
    await page.getByRole("button", { name: "Создать аккаунт" }).click();

    const heading = page.getByRole("heading", { name: "Проверьте почту", level: 1 });
    await expect(heading).toBeVisible();
    for (const paragraph of confirmationExplanation) {
      await expect(page.getByText(paragraph)).toBeVisible();
    }
    await expect(page.getByText("n***r@example.test")).toBeVisible();
    await expect(page.getByText(/Восстановить пароль|Восстановить доступ/)).toHaveCount(0);

    const resend = page.getByRole("button", { name: /Отправить письмо повторно/ });
    await expect(resend).toBeDisabled();
    await expect(page.getByTestId("auth-captcha")).toBeVisible();
    await expect(
      page.getByText("Подтверждение защиты станет доступно после окончания таймера."),
    ).toBeVisible();

    if (testInfo.project.name === "chromium-mobile-390") {
      const countdownMetrics = await resend.evaluate((element) => ({
        clientHeight: element.clientHeight,
        height: element.getBoundingClientRect().height,
        scrollHeight: element.scrollHeight,
      }));
      expect(countdownMetrics.height).toBeGreaterThanOrEqual(64);
      expect(countdownMetrics.scrollHeight).toBeLessThanOrEqual(countdownMetrics.clientHeight);
    }

    // D-063, closed by the owner's decision: every way off this screen — the
    // resend control, «Ко входу», «Указать другой email» — is on it, whole,
    // when it opens, at every width this spec claims. This was a per-project
    // budget while the explanation came first: with the captcha production
    // serves, the three buttons ended 175, 231 and 287px under the fold at
    // 360x800, and 390, 412 and 1440 clipped them as well; only 1920 fitted.
    // The actions now come straight after the masked address and the
    // explanation after them. Measured on entry, the last button ends at 799
    // of 800 at 360, 799 of 844 at 390, 799 of 915 at 412, 791 of 900 at 1440
    // and 793 of 1080 at 1920 — one pixel to spare at 360, so anything added
    // above the buttons there fails here instead of pushing «Указать другой
    // email» off the screen.
    //
    // "When it opens" is checked, not assumed: nothing has scrolled the shell,
    // and the measurement waits for the fonts, although with every web font
    // refused the three buttons measured at the same offsets.
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const authShell = page.locator(".kub-auth-shell");
    expect(
      await authShell.evaluate((element) => element.scrollTop),
      "the shell had already scrolled when the confirmation opened, so this is not the screen a reader is given",
    ).toBe(0);
    const offscreen: string[] = [];
    for (const [name, control] of [
      ["the resend control", resend],
      ["«Ко входу»", page.getByRole("button", { name: "Ко входу" })],
      ["«Указать другой email»", page.getByRole("button", { name: "Указать другой email" })],
    ] as const) {
      const box = await control.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, fold: window.innerHeight };
      });
      if (box.top < 0 || box.bottom > box.fold) {
        offscreen.push(
          `${name} at ${Math.round(box.top)}..${Math.round(box.bottom)}, ending ${Math.round(box.bottom - box.fold)}px past the ${box.fold}px fold`,
        );
      }
    }
    expect(offscreen, "every action on the confirmation screen is on it when it opens").toEqual([]);

    // The explanation now reads after the buttons, and it must not be taken
    // away from the screen it explains: the heading names it as its
    // description, so a screen reader that lands on the heading hears it there.
    await expect(heading).toHaveAccessibleDescription(confirmationExplanation.join(" "));

    await authShell.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });

    // The shell is the scroller, and the document never is. `.kub-auth-shell`
    // is `height: 100dvh; overflow-y: auto`, so a card taller than the viewport
    // scrolls inside it and the page behind it does not move. That is the
    // contract; "scrollTop ended up above zero" was only ever a proxy for it,
    // and the proxy is wrong wherever the card fits. Measured with the fonts
    // settled: 1440x900 scrolls 97px of a 997px card, 360x800 253px of 1053,
    // 390x844 161px and 412x915 90px of 1005 — but at 1920x1080 the card is
    // exactly 1080px tall in a 1080px port and there is nothing to scroll. This
    // spec claims 1920, so on that project the old assertion could only ever
    // fail.
    const shell = await authShell.evaluate((element) => ({
      scrollTop: element.scrollTop,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      documentHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
    }));
    expect(
      shell.documentHeight,
      `the document itself grew to ${shell.documentHeight}px in a ${shell.viewportHeight}px viewport, so the auth shell is no longer the scroller`,
    ).toBeLessThanOrEqual(shell.viewportHeight + 1);
    if (shell.scrollHeight > shell.clientHeight + 1) {
      expect(
        shell.scrollTop,
        "the card overflows its shell and the shell refused to scroll, so the footer is unreachable",
      ).toBeGreaterThan(0);
    }
    // And reachable, which is what the scroll was for. `toContainText` is
    // satisfied by a button parked below the fold; these are the ways out of a
    // confirmation screen and they have to be on it. The entry check above says
    // they are on it before anything scrolls; this says that scrolling the card
    // to its end, to read the explanation, does not take them off it.
    await expect(resend).toBeInViewport();
    await expect(page.getByRole("button", { name: "Ко входу" })).toBeInViewport();
    await expect(page.getByRole("button", { name: "Указать другой email" })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      await page.evaluate(() => window.innerWidth + 1),
    );

    await page.screenshot({
      path: testInfo.outputPath("registration-confirmation.png"),
      fullPage: false,
    });
    await page.getByText("Указать другой email", { exact: true }).click();
    await expect(page.getByRole("heading", { name: "Создать аккаунт" })).toBeVisible();
    expect(unexpectedConsoleErrors(consoleErrors)).toEqual([]);
  });

  test("clears editable credentials after storing the normalized submitted address", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium-desktop-1440",
      "credential retention regression runs once",
    );
    await installCaptchaMock(page);
    await mockRegistrationInviteMode(page);
    await mockSignupSuccess(page);
    await openRegisterForm(page);

    await page.locator('input[autocomplete="name"]').fill("Новый пользователь");
    await page.locator('input[type="email"]').fill("  New-User@Example.Test  ");
    await page.locator('input[type="password"]').fill("correct-horse-battery");
    await page.getByRole("button", { name: "Создать аккаунт" }).click();

    await expect(page.getByText("n***r@example.test")).toBeVisible();
    await page.getByRole("button", { name: "Указать другой email" }).click();
    await expect(page.locator('input[type="email"]')).toHaveValue("");
    await expect(page.locator('input[type="password"]')).toHaveValue("");
  });

  test("disables pending resend requests, sanitizes failures, and resets CAPTCHA for a new token", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop-1440", "resend interaction runs once");
    const resendPayloads: Array<{
      action?: string;
      captchaProvider?: string;
      captchaToken?: string;
      email?: string;
    }> = [];
    const firstResponse = createDeferred();
    await page.clock.install({ time: new Date("2026-08-30T12:00:00.000Z") });
    await installCaptchaMock(page);
    await mockRegistrationInviteMode(page);
    await page.route("**/functions/v1/auth-yandex-gateway", async (route) => {
      const payload = route.request().postDataJSON() as {
        action?: string;
        captchaProvider?: string;
        captchaToken?: string;
        email?: string;
      };
      expect(["turnstile", "yandex-smartcaptcha"]).toContain(payload.captchaProvider);
      if (payload.action === "signup") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
        return;
      }
      expect(payload.action).toBe("resend_signup");
      resendPayloads.push(payload);
      if (resendPayloads.length === 1) {
        await firstResponse.promise;
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: "raw gateway detail: sensitive@example.test" }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });
    await openRegisterForm(page);

    await page.locator('input[autocomplete="name"]').fill("Новый пользователь");
    await page.locator('input[type="email"]').fill("new-user@example.test");
    await page.locator('input[type="password"]').fill("correct-horse-battery");
    await page.getByRole("button", { name: "Создать аккаунт" }).click();

    const resend = page.getByRole("button", { name: /Отправить письмо повторно/ });
    await expect(resend).toBeDisabled();
    const countdownHeight = await resend.evaluate(
      (element) => element.getBoundingClientRect().height,
    );
    await page.clock.fastForward(60_000);
    await expect(resend).toBeEnabled();
    await expect
      .poll(() => page.evaluate(() => window.__playwrightCaptchaRenders))
      .toBeGreaterThanOrEqual(2);
    await resend.click();
    await expect.poll(() => resendPayloads.length).toBe(1);
    await expect(resend).toBeDisabled();
    expect(await resend.evaluate((element) => element.getBoundingClientRect().height)).toBe(
      countdownHeight,
    );

    firstResponse.resolve();
    await expect(page.getByText("Не удалось создать аккаунт. Попробуйте позже.")).toBeVisible();
    await expect(page.getByText("raw gateway detail: sensitive@example.test")).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => window.__playwrightCaptchaResets))
      .toBeGreaterThanOrEqual(1);
    await expect
      .poll(() => page.evaluate(() => window.__playwrightCaptchaTokens))
      .toBeGreaterThanOrEqual(3);
    await expect(resend).toBeEnabled();

    await resend.click();
    await expect(page.getByText("Письмо отправлено повторно.")).toBeVisible();
    expect(await resend.evaluate((element) => element.getBoundingClientRect().height)).toBe(
      countdownHeight,
    );
    expect(resendPayloads).toHaveLength(2);
    expect(resendPayloads[0]).toMatchObject({
      action: "resend_signup",
      captchaProvider: expect.any(String),
      email: "new-user@example.test",
      captchaToken: "playwright-captcha-token-2",
    });
    expect(resendPayloads[1]).toMatchObject({
      action: "resend_signup",
      captchaProvider: expect.any(String),
      email: "new-user@example.test",
      captchaToken: "playwright-captcha-token-3",
    });
    await expect(resend).toBeDisabled();
  });
});

declare global {
  interface Window {
    __playwrightCaptchaRenders?: number;
    __playwrightCaptchaResets?: number;
    __playwrightCaptchaTokens?: number;
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

/**
 * Opens the registration form and refuses, by name, when the dev server cannot
 * serve it.
 *
 * `VITE_AUTH_CAPTCHA_SITE_KEY` is the prerequisite, and without it this whole
 * spec was unrunnable in this environment at every viewport. `authCaptcha.ts`
 * resolves its configuration once, from `import.meta.env`, at module load: with
 * no site key there is no configuration, `HumanVerificationCaptcha` renders
 * "Проверка защиты формы не настроена" in place of the widget, and the form
 * refuses to submit with "Защита регистрации временно недоступна". The captcha
 * mock installed by the tests cannot rescue that — it stands in for a rendered
 * widget, and no widget is ever rendered.
 *
 * The value is read only as a non-empty string, so any placeholder works; it is
 * not a credential. The provider defaults to Turnstile, and `loadTurnstileScript`
 * returns immediately when `window.turnstile` already exists, so the mock keeps
 * the network out of it.
 *
 * Every failure this produced pointed somewhere else — the first assertion to
 * run was "n***r@example.test is visible", four steps past the cause, and the
 * register form was still on screen behind it. That is what the sibling specs
 * already refuse to do: `chat-entry-scroll.spec.ts` names
 * `VITE_PUBLIC_PREVIEW_FIXTURE`, and `privacy-support-public.spec.ts` names this
 * same variable for the support form. A missing prerequisite fails loudly and
 * says which one; it does not skip, and it does not fail somewhere else.
 */
async function openRegisterForm(page: Page): Promise<void> {
  await gotoOrSkip(page, "/register");
  await expect(
    page.getByTestId("auth-captcha"),
    "the dev server for this spec needs VITE_AUTH_CAPTCHA_SITE_KEY set (any non-empty value); without it the register form shows the unconfigured-captcha plate and refuses to submit",
  ).not.toContainText("не настроена");
}

async function installCaptchaMock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__playwrightCaptchaRenders = 0;
    window.__playwrightCaptchaResets = 0;
    window.__playwrightCaptchaTokens = 0;
    const callbacks = new Map<string, ((token: string) => void) | undefined>();
    const issueToken = (callback?: (token: string) => void) => {
      window.__playwrightCaptchaTokens = (window.__playwrightCaptchaTokens ?? 0) + 1;
      const token = `playwright-captcha-token-${window.__playwrightCaptchaTokens}`;
      window.setTimeout(() => callback?.(token), 0);
    };
    const render = (_container: HTMLElement, options: { callback?: (token: string) => void }) => {
      window.__playwrightCaptchaRenders = (window.__playwrightCaptchaRenders ?? 0) + 1;
      const widgetId = `playwright-captcha-${window.__playwrightCaptchaRenders}`;
      callbacks.set(widgetId, options.callback);
      issueToken(options.callback);
      return widgetId;
    };
    Object.defineProperty(window, "turnstile", {
      configurable: true,
      value: {
        render,
        reset: (widgetId?: string) => {
          window.__playwrightCaptchaResets = (window.__playwrightCaptchaResets ?? 0) + 1;
          issueToken(widgetId ? callbacks.get(widgetId) : undefined);
        },
        remove: (widgetId: string) => callbacks.delete(widgetId),
      },
    });
    Object.defineProperty(window, "smartCaptcha", {
      configurable: true,
      value: {
        render,
        reset: (widgetId?: string) => {
          window.__playwrightCaptchaResets = (window.__playwrightCaptchaResets ?? 0) + 1;
          issueToken(widgetId ? callbacks.get(widgetId) : undefined);
        },
        destroy: (widgetId: string) => callbacks.delete(widgetId),
      },
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
  await page.route("**/functions/v1/auth-yandex-gateway", async (route) => {
    const payload = route.request().postDataJSON() as {
      action?: string;
      captchaProvider?: string;
    };
    expect(payload.action).toBe("signup");
    expect(["turnstile", "yandex-smartcaptcha"]).toContain(payload.captchaProvider);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
}

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((completion) => {
    resolve = completion;
  });
  return { promise, resolve };
}

function unexpectedConsoleErrors(messages: string[]): string[] {
  return messages.filter(
    (message) =>
      !message.includes("Failed to load resource") &&
      !message.includes("Missing Supabase environment variables") &&
      !(
        message.includes("TypeError: Failed to fetch") && message.includes("@supabase_supabase-js")
      ),
  );
}
