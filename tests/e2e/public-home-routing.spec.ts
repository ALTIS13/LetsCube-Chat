import { expect, test, type Page, type Route } from "@playwright/test";

const SUPABASE_ORIGIN = "http://127.0.0.1:54321";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-08-31T12:00:00.000Z";

type RuntimeKind = "browser" | "capacitor_android" | "capacitor_ios" | "tauri_windows" | "tauri_macos";
type ProfileMode = "ready" | "pending" | "missing";

test.describe("public home routing integration", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium-desktop-1440",
      "The routing state matrix is viewport-independent and runs once.",
    );
    await installReleaseCatalogFixture(page);
  });

  test("browser guest root renders the public home", async ({ page }) => {
    await installRuntime(page, "browser");
    await installSupabaseFixture(page);

    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Мессенджер для общения и совместной работы" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Открыть веб-версию" }).first()).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  for (const runtime of ["capacitor_android", "capacitor_ios"] as const) {
    test(`${runtime} guest root redirects to login`, async ({ page }) => {
      await installRuntime(page, runtime);
      await installSupabaseFixture(page);

      await page.goto("/");

      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByTestId("auth-form-shell")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Мессенджер для общения и совместной работы" })).toHaveCount(0);
    });
  }

  for (const runtime of ["tauri_windows", "tauri_macos"] as const) {
    test(`${runtime} guest root redirects to login`, async ({ page }) => {
      await installRuntime(page, runtime);
      await installSupabaseFixture(page);

      await page.goto("/");

      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByTestId("auth-form-shell")).toBeVisible();

      if (runtime === "tauri_macos") {
        const capabilityBoundary = await page.evaluate(async () => {
          const desktop = await import("/src/lib/platform/desktop.ts");
          const updates = await import("/src/lib/platform/desktopUpdates.ts");
          const notifications = await import("/src/lib/platform/desktopNotifications.ts");
          return {
            shell: desktop.isDesktopShell(),
            windowsApp: desktop.isDesktopApp(),
            bridge: desktop.getDesktopBridge(),
            runtimeInfo: await desktop.getDesktopRuntimeInfo(),
            update: await updates.readDesktopUpdateSnapshot(),
            notification: await notifications.showDesktopMessageNotification({
              title: "Fixture",
              body: "Fixture",
              tag: "fixture",
            }),
          };
        });

        expect(capabilityBoundary).toEqual({
          shell: true,
          windowsApp: false,
          bridge: null,
          runtimeInfo: null,
          update: null,
          notification: false,
        });
      }
    });
  }

  test("authenticated root renders the messenger", async ({ page }) => {
    await installRuntime(page, "browser");
    await installSession(page);
    await installSupabaseFixture(page);

    await page.goto("/");

    await expect(page.getByTestId("desktop-app-shell")).toBeVisible();
    await expect(page.getByTestId("welcome-screen")).toBeVisible();
    await expect(page.getByTestId("auth-form-shell")).toHaveCount(0);
  });

  test("password recovery callback renders before root and auth redirects", async ({ page }) => {
    await installRuntime(page, "browser");
    await installSupabaseFixture(page);

    await page.goto("/auth/callback?type=recovery");

    await expect(page.getByText("Ссылка недействительна или устарела. Запросите восстановление пароля повторно.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Перейти ко входу" })).toBeVisible();
    await expect(page).toHaveURL(/\/auth\/callback$/);
    await expect(page.getByTestId("auth-form-shell")).toHaveCount(0);
  });

  test("protected guest deep link redirects to login", async ({ page }) => {
    await installRuntime(page, "browser");
    await installSupabaseFixture(page);

    await page.goto("/tasks?from=fixture");

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByTestId("auth-form-shell")).toBeVisible();
  });

  test("authenticated root remains on the loading screen until its profile resolves", async ({ page }) => {
    const profileGate = createGate();
    await installRuntime(page, "browser");
    await installSession(page);
    await installSupabaseFixture(page, { profileMode: "pending", profileGate });

    await page.goto("/");

    await expect(page.getByText("Загрузка", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Мессенджер для общения и совместной работы" })).toHaveCount(0);

    profileGate.open();
    await expect(page.getByTestId("desktop-app-shell")).toBeVisible();
  });

  test("missing profile renders the retryable loading error instead of public home", async ({ page }) => {
    await installRuntime(page, "browser");
    await installSession(page);
    await installSupabaseFixture(page, { profileMode: "missing" });

    await page.goto("/");

    await expect(page.getByText("Не удалось загрузить профиль", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Повторить" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Мессенджер для общения и совместной работы" })).toHaveCount(0);
  });

  test("banned authenticated root renders the ban screen", async ({ page }) => {
    await installRuntime(page, "browser");
    await installSession(page);
    await installSupabaseFixture(page, { banned: true });

    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Доступ ограничен" })).toBeVisible();
    await expect(page.getByText("Проверка маршрутного приоритета")).toBeVisible();
    await expect(page.getByTestId("auth-form-shell")).toHaveCount(0);
  });

  test("fixed public routes mount without authentication", async ({ page }) => {
    await installRuntime(page, "browser");
    await installSupabaseFixture(page);

    const routes = [
      ["/download", "Приложения LETSCUBE"],
      ["/privacy", "Политика конфиденциальности LETSCUBE"],
      ["/support", "Поддержка LETSCUBE"],
      ["/bots/docs", "LETSCUBE Bot API"],
    ] as const;

    for (const [route, heading] of routes) {
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await expect(page.getByTestId("auth-form-shell")).toHaveCount(0);
    }
  });
});

async function installRuntime(page: Page, runtime: RuntimeKind) {
  await page.addInitScript((kind) => {
    localStorage.setItem("kub-theme", "dark");
    if (kind === "capacitor_android") {
      Object.defineProperty(window, "androidBridge", {
        configurable: true,
        value: { postMessage() {} },
      });
    }
    if (kind === "capacitor_ios") {
      Object.defineProperty(window, "webkit", {
        configurable: true,
        value: { messageHandlers: { bridge: { postMessage() {} } } },
      });
    }
    if (kind === "tauri_windows" || kind === "tauri_macos") {
      Object.defineProperty(window, "letscubeDesktop", {
        configurable: true,
        value: {
          platform: kind === "tauri_windows" ? "windows" : "macos",
          version: "0.0.0",
          build: 0,
        },
      });
    }
  }, runtime);
}

async function installSession(page: Page) {
  await page.addInitScript(({ userId, now }) => {
    const user = {
      id: userId,
      aud: "authenticated",
      role: "authenticated",
      email: "route-fixture@example.invalid",
      email_confirmed_at: now,
      user_metadata: { full_name: "Route Fixture" },
      app_metadata: {},
      created_at: now,
    };
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
  }, { userId: USER_ID, now: NOW });
}

async function installReleaseCatalogFixture(page: Page) {
  await page.route("https://api.letscube.ru/releases/v1/**", async (route) => {
    const platform = new URL(route.request().url()).pathname.split("/")[3] ?? "windows";
    await json(route, {
      schemaVersion: 1,
      platform,
      channel: "stable",
      available: false,
      version: "0.0.0",
      build: 0,
      publishedAt: NOW,
      minimumSupportedVersion: null,
      mandatory: false,
      notes: "",
      highlights: [],
      artifact: null,
    });
  });
}

async function installSupabaseFixture(
  page: Page,
  options: {
    profileMode?: ProfileMode;
    profileGate?: ReturnType<typeof createGate>;
    banned?: boolean;
  } = {},
) {
  const profileMode = options.profileMode ?? "ready";
  await page.route(`${SUPABASE_ORIGIN}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname.includes("/rest/v1/profiles")) {
      if (profileMode === "pending") await options.profileGate?.wait;
      if (profileMode === "missing") {
        await json(route, null);
        return;
      }
      await json(route, profile());
      return;
    }

    if (url.pathname.includes("/rest/v1/bans")) {
      await json(route, options.banned ? [activeBan()] : []);
      return;
    }

    if (url.pathname.endsWith("/auth/v1/user")) {
      await json(route, authUser());
      return;
    }

    if (url.pathname.startsWith("/rest/v1/")) {
      await json(route, []);
      return;
    }

    await json(route, {});
  });
}

function authUser() {
  return {
    id: USER_ID,
    aud: "authenticated",
    role: "authenticated",
    email: "route-fixture@example.invalid",
    email_confirmed_at: NOW,
    user_metadata: { full_name: "Route Fixture" },
    app_metadata: {},
    created_at: NOW,
  };
}

function profile() {
  return {
    id: USER_ID,
    full_name: "Route Fixture",
    username: "route_fixture",
    avatar_url: null,
    bio: null,
    online_at: NOW,
    created_at: NOW,
    updated_at: NOW,
  };
}

function activeBan() {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    user_id: USER_ID,
    issued_by: null,
    reason: "Проверка маршрутного приоритета",
    created_at: NOW,
    expires_at: null,
    issuer: null,
  };
}

function createGate() {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}
