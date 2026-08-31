import { expect, test, type Page, type Route } from "@playwright/test";

const API = "http://127.0.0.1:54322/bot/manage/v1";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_BOT_ID = "22222222-2222-4222-8222-222222222222";
const DEVELOPER_BOT_ID = "33333333-3333-4333-8333-333333333333";
const RAW_TOKEN = "lc_bot_0123456789.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
const NOW = "2026-08-31T12:00:00.000Z";

test.describe("authenticated bot management", () => {
  test.beforeEach(async ({ page }) => {
    await installSession(page);
    await installSupabaseFixture(page);
  });

  test("creates and rotates a token without retaining it", async ({ page }) => {
    await installManagementFixture(page);
    await page.goto("/bots");

    await expect(page.getByRole("heading", { name: "Мои боты" })).toBeVisible();
    await page.getByRole("button", { name: "Создать бота" }).click();
    await page.getByLabel("Название").fill("Release bot");
    await page.getByLabel("Имя пользователя").fill("release_bot");
    await page.getByLabel("Описание").fill("Проверка одноразового токена");
    await page.getByRole("button", { name: "Создать", exact: true }).click();

    const tokenDialog = page.getByRole("dialog", { name: "Токен бота" });
    await expect(tokenDialog).toContainText(RAW_TOKEN);
    await page.keyboard.press("Escape");
    await expect(tokenDialog).toBeVisible();
    expect(page.url()).not.toContain(RAW_TOKEN);
    expect(await browserStorageContains(page, RAW_TOKEN)).toBe(false);
    await tokenDialog.getByRole("button", { name: "Готово, закрыть" }).click();
    await expect(page.getByText(RAW_TOKEN)).toHaveCount(0);
    expect(await browserStorageContains(page, RAW_TOKEN)).toBe(false);

    const createdRow = page.getByRole("button", { name: /Release bot/ });
    if (await createdRow.isVisible().catch(() => false)) await createdRow.click();
    await page.getByRole("tab", { name: "API" }).click();
    await page.getByRole("button", { name: "Выпустить новый токен" }).click();
    await page.getByRole("button", { name: "Подтвердить выпуск" }).click();
    await expect(tokenDialog).toContainText(RAW_TOKEN);
    await tokenDialog.getByRole("button", { name: "Готово, закрыть" }).click();
    await expect(page.getByText(RAW_TOKEN)).toHaveCount(0);
  });

  test("enforces owner and developer controls through lifecycle states", async ({ page }) => {
    await installManagementFixture(page);
    await page.goto("/bots");

    await page.getByRole("button", { name: /Owner bot/ }).click();
    await expect(page.getByRole("button", { name: "Поставить на паузу" })).toBeVisible();
    await page.getByRole("button", { name: "Поставить на паузу" }).click();
    await page.getByRole("button", { name: "Подтвердить паузу" }).click();
    await expect(page.getByTestId("bots-detail-pane").getByText("На паузе").first()).toBeVisible();

    await page.getByRole("tab", { name: "Команда" }).click();
    await expect(page.getByRole("button", { name: "Добавить разработчика" })).toBeVisible();
    await page.getByRole("tab", { name: "Основное" }).click();
    await page.getByRole("button", { name: "Запросить удаление" }).click();
    await page.getByRole("button", { name: "Запланировать удаление" }).click();
    await expect(page.getByTestId("bots-detail-pane").getByText("Удаление запланировано").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Отменить удаление" })).toBeVisible();

    const back = page.getByRole("button", { name: "Назад к списку" });
    if (await back.isVisible().catch(() => false)) await back.click();
    await page.getByRole("button", { name: /Developer bot/ }).click();
    await expect(page.getByText("Доступ разработчика")).toBeVisible();
    await expect(page.getByRole("button", { name: "Запросить удаление" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Выпустить новый токен" })).toHaveCount(0);
  });

  test("uses desktop master-detail and mobile one-pane without overflow", async ({ page }, testInfo) => {
    await installManagementFixture(page);
    await page.goto("/bots");
    const shell = page.getByTestId("bots-page");
    await expect(shell).toBeVisible();
    await page.getByRole("button", { name: /Owner bot/ }).click();
    const initialWidth = testInfo.project.use.viewport?.width ?? 1440;
    if (initialWidth >= 768) {
      await expect(page.getByTestId("bots-list-pane")).toBeVisible();
    } else {
      await expect(page.getByTestId("bots-list-pane")).toBeHidden();
    }
    await expect(page.getByTestId("bots-detail-pane")).toBeVisible();
    await assertNoHorizontalOverflow(shell);
    if (initialWidth === 1440) await page.screenshot({ path: "output/task-5-bots-1440.png", fullPage: false });

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId("bots-list-pane")).toBeHidden();
    await expect(page.getByTestId("bots-detail-pane")).toBeVisible();
    await expect(page.getByRole("tab")).toHaveCount(4);
    await assertNoHorizontalOverflow(shell);
    await page.screenshot({ path: `output/task-5-bots-390-${testInfo.project.name}.png`, fullPage: false });
    await page.evaluate(() => localStorage.setItem("kub-theme", "light"));
    await page.reload();
    await expect(page.getByTestId("bots-detail-pane")).toBeVisible();
    await assertNoHorizontalOverflow(shell);
    await page.screenshot({ path: `output/task-5-bots-390-light-${testInfo.project.name}.png`, fullPage: false });
    await page.getByRole("button", { name: "Назад к списку" }).click();
    await expect(page.getByTestId("bots-list-pane")).toBeVisible();
    await expect(page.getByTestId("bots-detail-pane")).toBeHidden();
  });
});

async function installSession(page: Page) {
  await page.addInitScript(({ userId }) => {
    const user = {
      id: userId,
      aud: "authenticated",
      role: "authenticated",
      email: "bot-owner@example.invalid",
      user_metadata: { full_name: "Bot Owner" },
      app_metadata: {},
      created_at: "2026-08-29T00:00:00.000Z",
    };
    if (!localStorage.getItem("kub-theme")) localStorage.setItem("kub-theme", "dark");
    localStorage.setItem(
      "kub-auth",
      JSON.stringify({
        access_token: "playwright.user.jwt",
        refresh_token: "playwright-refresh",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        token_type: "bearer",
        user,
      }),
    );
  }, { userId: USER_ID });
}

async function installSupabaseFixture(page: Page) {
  await page.route("http://127.0.0.1:54321/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("/rest/v1/profiles")) {
      await json(route, {
        id: USER_ID,
        full_name: "Bot Owner",
        username: "bot_owner",
        avatar_url: null,
        bio: null,
        online_at: NOW,
        created_at: NOW,
        updated_at: NOW,
      });
      return;
    }
    await json(route, []);
  });
}

async function installManagementFixture(page: Page) {
  const bots = [
    summary(OWNER_BOT_ID, "owner_bot", "Owner bot", "owner"),
    summary(DEVELOPER_BOT_ID, "developer_bot", "Developer bot", "developer"),
  ];
  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/bot/manage/v1", "");
    expect(request.headers().authorization).toBe("Bearer playwright.user.jwt");
    if (request.method() === "GET" && path === "/bots") {
      await ok(route, {
        bots,
        eligibility: {
          email_verified: true,
          phone_verified: true,
          account_age_met: true,
          not_banned: true,
          under_limit: true,
          active_bot_count: 2,
          max_bots: 3,
          can_create: true,
        },
      });
      return;
    }
    if (request.method() === "POST" && path === "/bots") {
      const bot = summary("55555555-5555-4555-8555-555555555555", "release_bot", "Release bot", "owner");
      bots.unshift(bot);
      await ok(route, {
        bot: {
          id: bot.id,
          username: bot.username,
          display_name: bot.display_name,
          description: bot.description,
          state: bot.state,
          created_at: bot.created_at,
        },
        token: RAW_TOKEN,
      }, 201);
      return;
    }
    const detailMatch = path.match(/^\/bots\/([0-9a-f-]+)$/);
    if (request.method() === "GET" && detailMatch) {
      const bot = bots.find((item) => item.id === detailMatch[1])!;
      await ok(route, detail(bot));
      return;
    }
    if (request.method() === "POST" && path.endsWith("/token/rotate")) {
      await ok(route, { token: RAW_TOKEN, token_prefix: "lc_bot_0123456789", created_at: NOW });
      return;
    }
    if (request.method() === "POST" && path.endsWith("/pause")) {
      bots[0].state = "paused";
    }
    if (request.method() === "POST" && path.endsWith("/deletion/request")) {
      bots[0].state = "pending_delete";
      bots[0].delete_after = "2026-09-07T12:00:00.000Z";
      bots[0].token = null;
    }
    await ok(route, { success: true });
  });
}

function summary(id: string, username: string, displayName: string, role: "owner" | "developer") {
  return {
    id,
    username,
    display_name: displayName,
    description: "A bot description that remains readable at narrow widths.",
    avatar_url: null,
    state: "active",
    delete_after: null as string | null,
    role,
    token: role === "owner" ? { prefix: "lc_bot_0123456789", created_at: NOW, last_used_at: null } : null,
    created_at: NOW,
    updated_at: NOW,
  };
}

function detail(bot: ReturnType<typeof summary>) {
  return {
    bot,
    commands: [{ command: "help", description: "Показать справку" }],
    developers: [],
    privacy: [{
      chat_id: "44444444-4444-4444-8444-444444444444",
      chat_name: "Команда продукта",
      privacy_mode: "restricted",
      full_visibility_requested_at: null,
      full_visibility_approved: false,
    }],
    webhook: { configured: false, url: null },
    diagnostics: {
      delivery_mode: "polling",
      pending_update_count: 0,
      failure_count: 0,
      last_error_code: null,
      refreshed_at: NOW,
    },
  };
}

async function browserStorageContains(page: Page, value: string) {
  return page.evaluate((needle) => {
    return [localStorage, sessionStorage].some((storage) =>
      Object.values(storage).some((entry) => entry.includes(needle)),
    );
  }, value);
}

async function assertNoHorizontalOverflow(locator: ReturnType<Page["getByTestId"]>) {
  const dimensions = await locator.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

async function ok(route: Route, result: unknown, status = 200) {
  await json(route, { ok: true, result }, status);
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}
