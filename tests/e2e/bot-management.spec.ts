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
    const consoleMessages: string[] = [];
    page.on("console", (message) => consoleMessages.push(message.text()));
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
    expect(await browserTokenResidue(page, RAW_TOKEN, consoleMessages)).toEqual({
      queryClient: false,
      cacheStorage: false,
      indexedDb: false,
      historyOrUrl: false,
      console: false,
      dom: false,
      localStorage: false,
      sessionStorage: false,
    });

    const createdRow = page.getByRole("button", { name: /Release bot/ });
    if (await createdRow.isVisible().catch(() => false)) await createdRow.click();
    await page.getByRole("tab", { name: "API" }).click();
    await page.getByRole("button", { name: "Выпустить новый токен" }).click();
    await page.getByRole("button", { name: "Подтвердить выпуск" }).click();
    await expect(tokenDialog).toContainText(RAW_TOKEN);
    await tokenDialog.getByRole("button", { name: "Готово, закрыть" }).click();
    await expect(page.getByText(RAW_TOKEN)).toHaveCount(0);
    expect(await browserTokenResidue(page, RAW_TOKEN, consoleMessages)).toEqual({
      queryClient: false,
      cacheStorage: false,
      indexedDb: false,
      historyOrUrl: false,
      console: false,
      dom: false,
      localStorage: false,
      sessionStorage: false,
    });
  });

  test("uses field-specific create errors with stable accessible descriptions", async ({ page }) => {
    await installManagementFixture(page);
    await page.goto("/bots");

    await page.getByRole("button", { name: "Создать бота" }).click();
    await page.getByLabel("Название").fill("x");
    await page.getByLabel("Имя пользователя").fill("valid_bot");
    await page.getByRole("button", { name: "Создать", exact: true }).click();

    const displayName = page.getByLabel("Название");
    const username = page.getByLabel("Имя пользователя");
    await expect(displayName).toHaveAttribute("aria-invalid", "true");
    await expect(displayName).toHaveAttribute("aria-describedby", "bot-create-display-name-error");
    await expect(page.locator("#bot-create-display-name-error")).toBeVisible();
    await expect(username).toHaveAttribute("aria-invalid", "false");
    await expect(username).not.toHaveAttribute("aria-describedby", "bot-create-display-name-error");
  });

  test("keeps light-theme primary actions at AA contrast inside bot dialogs", async ({ page }) => {
    await installManagementFixture(page);
    await page.goto("/bots");
    await page.evaluate(() => localStorage.setItem("kub-theme", "light"));
    await page.reload();

    await expect.poll(() => buttonContrast(page.getByRole("button", { name: "Создать бота" }))).toBeGreaterThanOrEqual(4.5);
    await page.getByRole("button", { name: "Создать бота" }).click();
    await expect.poll(() => buttonContrast(page.getByRole("button", { name: "Создать", exact: true }))).toBeGreaterThanOrEqual(4.5);
    await page.getByRole("button", { name: "Отмена" }).click();

    await page.getByRole("button", { name: /Owner bot/ }).click();
    await page.getByRole("tab", { name: "API" }).click();
    await page.getByRole("button", { name: "Выпустить новый токен" }).click();
    await expect.poll(() => buttonContrast(page.getByRole("button", { name: "Подтвердить выпуск" }))).toBeGreaterThanOrEqual(4.5);
    await page.getByRole("button", { name: "Подтвердить выпуск" }).click();
    await expect.poll(() => buttonContrast(page.getByRole("button", { name: "Готово, закрыть" }))).toBeGreaterThanOrEqual(4.5);
  });

  test("treats an interrupted create as uncertain and refreshes without offering a repeat", async ({ page }) => {
    let listReads = 0;
    await installManagementFixture(page);
    await page.route(`${API}/bots`, async (route) => {
      if (route.request().method() === "POST") {
        await route.abort("failed");
        return;
      }
      listReads += 1;
      await route.fallback();
    });
    await page.goto("/bots");

    await page.getByRole("button", { name: "Создать бота" }).click();
    await page.getByLabel("Название").fill("Uncertain bot");
    await page.getByLabel("Имя пользователя").fill("uncertain_bot");
    await page.getByRole("button", { name: "Создать", exact: true }).click();

    await expect(page.getByRole("alert")).toContainText("Запрос мог выполниться");
    await expect(page.getByRole("alert")).toContainText("Не повторяйте создание");
    await expect(page.getByRole("button", { name: "Создать", exact: true })).toBeDisabled();
    await expect.poll(() => listReads).toBeGreaterThan(1);
  });

  test("treats an interrupted rotation as uncertain and guides explicit recovery", async ({ page }) => {
    let detailReads = 0;
    await installManagementFixture(page);
    await page.route(`${API}/bots/${OWNER_BOT_ID}`, async (route) => {
      detailReads += 1;
      await route.fallback();
    });
    await page.route(`${API}/bots/${OWNER_BOT_ID}/token/rotate`, (route) => route.abort("failed"));
    await page.goto(`/bots?bot=${OWNER_BOT_ID}`);

    await page.getByRole("tab", { name: "API" }).click();
    await page.getByRole("button", { name: "Выпустить новый токен" }).click();
    await page.getByRole("button", { name: "Подтвердить выпуск" }).click();

    const alert = page.getByRole("alert");
    await expect(alert).toContainText("Запрос мог выполниться");
    await expect(alert).toContainText("повторно выпустите новый токен");
    await expect(page.getByRole("dialog", { name: "Выпустить новый токен?" })).toHaveCount(0);
    await expect.poll(() => detailReads).toBeGreaterThan(1);
  });

  test("enforces owner and developer controls through lifecycle states", async ({ page }) => {
    await installManagementFixture(page);
    await page.goto("/bots");

    await page.getByRole("button", { name: /Owner bot/ }).click();
    await expect(page.getByRole("button", { name: "Поставить на паузу" })).toBeVisible();
    await page.getByRole("button", { name: "Поставить на паузу" }).click();
    await page.getByRole("button", { name: "Подтвердить паузу" }).click();
    await expect(page.getByTestId("bots-detail-pane").getByText("На паузе").first()).toBeVisible();

    await page.getByRole("tab", { name: "Диагностика" }).click();
    await expect(page.getByText("Не настроен", { exact: true })).toBeVisible();

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
      delivery_mode: null,
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

async function browserTokenResidue(page: Page, value: string, consoleMessages: string[]) {
  const browserResidue = await page.evaluate(async (needle) => {
    const contains = (candidate: unknown) => {
      try {
        return JSON.stringify(candidate).includes(needle);
      } catch {
        return String(candidate).includes(needle);
      }
    };
    const appModule = await import("/src/App.tsx");
    const queryClient = appModule.queryClient;
    const queryData = queryClient
      ? {
          queries: queryClient.getQueryCache().getAll().map((query: { state: unknown }) => query.state),
          mutations: queryClient.getMutationCache().getAll().map((mutation: { state: unknown }) => mutation.state),
        }
      : { missingQueryClientExport: needle };

    let cacheStorage = false;
    for (const cacheName of await caches.keys()) {
      const cache = await caches.open(cacheName);
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        if (request.url.includes(needle) || (response && (await response.clone().text()).includes(needle))) {
          cacheStorage = true;
        }
      }
    }

    let indexedDb = false;
    for (const info of await indexedDB.databases()) {
      if (!info.name) continue;
      const database = await new Promise<IDBDatabase | null>((resolve) => {
        const open = indexedDB.open(info.name!);
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => resolve(null);
      });
      if (!database || database.objectStoreNames.length === 0) {
        database?.close();
        continue;
      }
      const transaction = database.transaction(Array.from(database.objectStoreNames), "readonly");
      for (const storeName of Array.from(database.objectStoreNames)) {
        const values = await new Promise<unknown[]>((resolve) => {
          const request = transaction.objectStore(storeName).getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve([]);
        });
        if (contains(values)) indexedDb = true;
      }
      database.close();
    }

    return {
      queryClient: contains(queryData),
      cacheStorage,
      indexedDb,
      historyOrUrl: location.href.includes(needle) || contains(history.state),
      dom: document.documentElement.innerHTML.includes(needle),
      localStorage: Object.values(localStorage).some((entry) => entry.includes(needle)),
      sessionStorage: Object.values(sessionStorage).some((entry) => entry.includes(needle)),
    };
  }, value);

  return {
    ...browserResidue,
    console: consoleMessages.some((message) => message.includes(value)),
  };
}

async function buttonContrast(locator: ReturnType<Page["getByRole"]>) {
  return locator.evaluate((element) => {
    const parse = (value: string) => value.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [];
    const luminance = (channels: number[]) => {
      const linear = channels.map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
    };
    const style = getComputedStyle(element);
    const [bright, dark] = [luminance(parse(style.color)), luminance(parse(style.backgroundColor))]
      .sort((left, right) => right - left);
    return (bright + 0.05) / (dark + 0.05);
  });
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
