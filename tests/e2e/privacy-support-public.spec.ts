import { expect, test } from "@playwright/test";
import { gotoOrSkip } from "./helpers/auth";

test.describe("public privacy and support surfaces", () => {
  test("/privacy is public, complete, and viewport-safe", async ({ page }) => {
    await gotoOrSkip(page, "/privacy");

    await expect(page).toHaveTitle(/Политика конфиденциальности.*LETSCUBE/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Политика конфиденциальности LETSCUBE",
    );
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: "Оглавление политики" })).toBeVisible();
    await expect(page.getByTestId("privacy-print")).toBeVisible();
    await expect(page.getByText("ООО «КУБ»").first()).toBeVisible();
    await expect(page.getByText("privacy@app.letscube.ru").first()).toBeVisible();
    await expect(page.getByText("15. Контакты")).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);

    const scrollRoot = page.getByTestId("public-scroll-root");
    const viewportSafety = await scrollRoot.evaluate((node) => ({
      clientHeight: node.clientHeight,
      clientWidth: node.clientWidth,
      scrollHeight: node.scrollHeight,
      scrollWidth: node.scrollWidth,
    }));
    expect(viewportSafety.scrollHeight).toBeGreaterThan(viewportSafety.clientHeight);
    expect(viewportSafety.scrollWidth).toBeLessThanOrEqual(viewportSafety.clientWidth + 1);

    await page.getByRole("heading", { name: "15. Контакты" }).scrollIntoViewIfNeeded();
    await expect(page.getByRole("heading", { name: "15. Контакты" })).toBeInViewport();

    const documentSafety = await page.evaluate(() => ({
      bodyWidth: document.body.scrollWidth,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }));
    expect(documentSafety.bodyWidth).toBeLessThanOrEqual(documentSafety.viewportWidth + 1);
    expect(documentSafety.documentWidth).toBeLessThanOrEqual(documentSafety.viewportWidth + 1);
  });

  /**
   * Hiding the table of contents for print is not the same as removing its
   * column. `public-page-print-hide` sets `display:none`, which takes the
   * <aside> out of the flow but leaves the `240px minmax(0,1fr)` template
   * standing, so auto-placement dropped the whole policy into the 240px track.
   * Paper laid out wider than the `lg` breakpoint — Letter landscape is 1056
   * CSS px, A4 landscape 1122 — printed the document as a ribbon.
   *
   * The viewport is set here rather than left to the project so the assertion
   * bites in every matrix entry: below `lg` the template never applies and a
   * regression would pass unnoticed on the mobile projects.
   */
  test("/privacy prints as one column, not into the hidden sidebar's track", async ({ page }) => {
    await gotoOrSkip(page, "/privacy");
    await expect(page.getByRole("navigation", { name: "Оглавление политики" })).toBeVisible();

    await page.setViewportSize({ width: 1122, height: 794 });
    await page.emulateMedia({ media: "print" });
    try {
      const printed = await page.locator("article").first().evaluate((node) => {
        const grid = node.parentElement as HTMLElement;
        const toc = grid.firstElementChild as HTMLElement;
        return {
          tracks: getComputedStyle(grid).gridTemplateColumns.split(/\s+/).filter(Boolean).length,
          tocDisplay: getComputedStyle(toc).display,
          article: node.getBoundingClientRect().width,
          available: (node.closest("main") as HTMLElement).getBoundingClientRect().width,
        };
      });

      expect(printed.tocDisplay).toBe("none");
      expect(printed.tracks).toBe(1);
      expect(printed.article).toBeGreaterThan(printed.available * 0.9);
      await expect(page.getByTestId("privacy-print")).toBeHidden();
    } finally {
      await page.emulateMedia({ media: null });
    }
  });

  test("/support validates required fields without contacting the backend", async ({ page }) => {
    let gatewayRequests = 0;
    page.on("request", (request) => {
      if (request.url().includes("/functions/v1/support-gateway")) gatewayRequests += 1;
    });
    await installFakeSmartCaptcha(page);
    await gotoOrSkip(page, "/support");
    await page.waitForTimeout(2_100);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Поддержка LETSCUBE");
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await page.getByRole("button", { name: "Отправить и открыть чат" }).click();

    await expect(page.getByText("Укажите имя длиной от 2 до 80 символов.")).toBeVisible();
    await expect(page.getByText("Введите корректный адрес электронной почты.")).toBeVisible();
    await expect(
      page.getByText("Введите номер в международном формате, например +79991234567."),
    ).toBeVisible();
    await expect(page.getByText("Подтвердите, что запрос отправляет человек.")).toBeVisible();
    expect(gatewayRequests).toBe(0);
  });

  test("/support opens and restores a guest chat without leaking its secret", async ({ page }) => {
    const guestSecret = "guest-secret-value-that-stays-in-indexeddb";
    const ticketId = "f7a42e23-bd69-4ca3-a983-1fde8b7c44c1";
    const ticket = {
      id: ticketId,
      publicReference: "LC-2026-0042",
      category: "technical",
      subject: "Не открывается переписка",
      status: "new",
      createdAt: "2026-07-27T09:00:00.000Z",
      updatedAt: "2026-07-27T09:00:00.000Z",
      messages: Array.from({ length: 28 }, (_, index) => ({
          id: `4f15de54-cdb8-4976-9e53-${String(index).padStart(12, "0")}`,
          authorType: "guest",
          body: index === 27
            ? "После входа приложение не загружает историю сообщений."
            : `Предыдущее сообщение ${index + 1}`,
          createdAt: "2026-07-27T09:00:00.000Z",
        })),
    };
    let createRequests = 0;
    let restoreRequests = 0;
    let messageRequests = 0;

    await installFakeSmartCaptcha(page);
    await page.route("**/functions/v1/support-gateway/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const method = request.method();
      if (method === "POST" && url.pathname.endsWith("/support-gateway/tickets")) {
        createRequests += 1;
        const body = request.postDataJSON() as Record<string, unknown>;
        expect(body.fullName).toBe("Анна Иванова");
        expect(body.email).toBe("anna@example.test");
        expect(body.phone).toBe("+79991234567");
        expect(body.website).toBe("");
        expect(request.headers()["x-letscube-support-secret"]).toBeUndefined();
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ticket,
            session: {
              ticketId,
              secret: guestSecret,
              idleExpiresAt: "2026-08-26T00:00:00.000Z",
              absoluteExpiresAt: "2026-10-25T00:00:00.000Z",
              updatedAt: "2026-07-27T09:00:00.000Z",
            },
          }),
        });
        return;
      }

      expect(request.headers()["x-letscube-support-secret"]).toBe(guestSecret);
      if (method === "GET" && url.pathname.endsWith(`/tickets/${ticketId}`)) {
        restoreRequests += 1;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(ticket),
        });
        return;
      }
      if (method === "POST" && url.pathname.endsWith(`/tickets/${ticketId}/messages`)) {
        messageRequests += 1;
        const body = request.postDataJSON() as { body: string };
        ticket.messages.push({
          id: "f315f2ac-4af2-43aa-9b71-76a275bb608f",
          authorType: "guest",
          body: body.body,
          createdAt: "2026-07-27T09:05:00.000Z",
        });
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(ticket),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });

    await gotoOrSkip(page, "/support");
    await page.getByLabel("Ваше имя").fill("  Анна   Иванова ");
    await page.getByLabel("Эл. почта для ответа").fill(" ANNA@example.test ");
    await page.getByLabel("Номер телефона").fill("+7 (999) 123-45-67");
    await page.getByLabel("Категория").selectOption("technical");
    await page.getByLabel("Тема обращения").fill("Не открывается переписка");
    await page
      .getByLabel("Что произошло")
      .fill("После входа приложение не загружает историю сообщений.");
    await page.getByRole("checkbox").check();
    await page.evaluate(() => {
      const runtime = window as typeof window & {
        __supportCaptchaCallback?: (token: string) => void;
      };
      runtime.__supportCaptchaCallback?.("playwright-support-token");
    });
    await page.waitForTimeout(2_100);
    await page.getByRole("button", { name: "Отправить и открыть чат" }).click();

    await expect(page.getByTestId("guest-support-chat")).toBeVisible();
    expect(await page.getByTestId("public-scroll-root").evaluate((node) => node.scrollTop)).toBeLessThanOrEqual(1);
    await expect(page.getByText("Обращение LC-2026-0042")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Не открывается переписка" })).toBeVisible();
    const guestScroll = page.getByTestId("guest-support-scroll");
    const initialScroll = await guestScroll.evaluate((node) => ({
      top: node.scrollTop,
      max: Math.max(0, node.scrollHeight - node.clientHeight),
    }));
    expect(initialScroll.max - initialScroll.top).toBeLessThanOrEqual(4);
    expect(createRequests).toBe(1);
    expect(page.url()).not.toContain(guestSecret);
    expect(
      await page.evaluate((secret) =>
        Object.values(localStorage).some((value) => value.includes(secret)),
      guestSecret),
    ).toBe(false);

    await page.getByPlaceholder("Напишите сообщение оператору").fill("Дополнительная проверка.");
    await page.getByRole("button", { name: "Отправить сообщение" }).click();
    await expect(page.getByText("Дополнительная проверка.")).toBeVisible();
    expect(messageRequests).toBe(1);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("guest-support-chat")).toBeVisible();
    expect(restoreRequests).toBeGreaterThanOrEqual(1);

    const scrollRoot = page.getByTestId("public-scroll-root");
    const width = await scrollRoot.evaluate((node) => ({
      client: node.clientWidth,
      scroll: node.scrollWidth,
    }));
    expect(width.scroll).toBeLessThanOrEqual(width.client + 1);
  });
});

async function installFakeSmartCaptcha(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    const runtime = window as typeof window & {
      smartCaptcha?: {
        render: (
          container: HTMLElement,
          options: {
            callback: (token: string) => void;
            theme?: "light" | "dark";
          },
        ) => string;
        reset: () => void;
        destroy: () => void;
      };
      __supportCaptchaCallback?: (token: string) => void;
    };
    runtime.smartCaptcha = {
      render(container, options) {
        const widget = document.createElement("div");
        widget.textContent = "Проверка SmartCaptcha";
        widget.setAttribute("data-testid", "fake-support-captcha");
        widget.style.height = "102px";
        widget.style.display = "flex";
        widget.style.alignItems = "center";
        widget.style.padding = "16px";
        container.appendChild(widget);
        runtime.__supportCaptchaCallback = options.callback;
        return "support-captcha-widget";
      },
      reset() {},
      destroy() {},
    };
  });
}
