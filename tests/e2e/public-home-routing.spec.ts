import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page, type Route } from "@playwright/test";

const SUPABASE_ORIGIN = "http://127.0.0.1:54321";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-08-31T12:00:00.000Z";

// The routing state matrix is viewport-independent, so both matrices run once
// under the same project instead of repeating across every viewport.
const ROUTING_PROJECT = "chromium-desktop-1440";
const ROUTING_PROJECT_REASON = "The routing state matrix is viewport-independent and runs once.";

const PUBLIC_ROUTE_HEADINGS = [
  ["/download", "Приложения LETSCUBE"],
  ["/privacy", "Политика конфиденциальности LETSCUBE"],
  ["/support", "Поддержка LETSCUBE"],
  ["/bots/docs", "LETSCUBE Bot API"],
] as const;

// Paths that only look like the fixed public routes. They must stay protected.
const PUBLIC_ROUTE_NEAR_MATCHES = ["/download/preview", "/bots/docs/nested"] as const;

const RUNTIME_CONFIGURATION_HEADING = "Подключение к серверу не настроено";
const PUBLIC_HOME_HEADING = "Мессенджер для общения и совместной работы";

// The unconfigured matrix owns its own port so it can never collide with the
// configured server the rest of this suite runs against.
const UNCONFIGURED_PORT = 5188;
const UNCONFIGURED_ORIGIN = `http://127.0.0.1:${UNCONFIGURED_PORT}`;
const UNCONFIGURED_STARTUP_TIMEOUT_MS = 180_000;
// The readiness probe only proves the socket answers. The first navigation is
// what pays for Vite's dependency pre-bundling on a cold cache, which is well
// past the project-wide navigation timeout.
const UNCONFIGURED_NAVIGATION_TIMEOUT_MS = 60_000;
const STOP_GRACE_MS = 10_000;
const TRANSCRIPT_CHUNK_LIMIT = 200;
const ANSI_PATTERN = /\u001B\[[0-9;]*m/g;

// Every env file Vite loads for its default development mode.
const VITE_ENV_FILE_NAMES = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.development.local",
] as const;

// Every public Supabase name the client accepts, so none of them can leak in
// from the shell that starts the configured server.
const SUPABASE_PUBLIC_ENV_KEYS = new Set([
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
]);

type RuntimeKind = "browser" | "capacitor_android" | "capacitor_ios" | "tauri_windows" | "tauri_macos";
type ProfileMode = "ready" | "pending" | "missing";

test.describe("public home routing integration", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    assertRoutingProjectExists(testInfo.config);
    test.skip(testInfo.project.name !== ROUTING_PROJECT, ROUTING_PROJECT_REASON);
    await installReleaseCatalogFixture(page);
  });

  test("browser guest root renders the public home", async ({ page }) => {
    await installRuntime(page, "browser");
    await installSupabaseFixture(page);

    await page.goto("/");

    await expect(page.getByRole("heading", { name: PUBLIC_HOME_HEADING })).toBeVisible();
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
      await expect(page.getByRole("heading", { name: PUBLIC_HOME_HEADING })).toHaveCount(0);
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
    await expect(page.getByRole("heading", { name: PUBLIC_HOME_HEADING })).toHaveCount(0);

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
    await expect(page.getByRole("heading", { name: PUBLIC_HOME_HEADING })).toHaveCount(0);
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

    for (const [route, heading] of PUBLIC_ROUTE_HEADINGS) {
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await expect(page.getByTestId("auth-form-shell")).toHaveCount(0);
    }
  });

  test("public-route near matches stay protected for guests", async ({ page }) => {
    await installRuntime(page, "browser");
    await installSupabaseFixture(page);

    for (const route of PUBLIC_ROUTE_NEAR_MATCHES) {
      await page.goto(route);

      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByTestId("auth-form-shell")).toBeVisible();

      for (const [, heading] of PUBLIC_ROUTE_HEADINGS) {
        await expect(page.getByRole("heading", { level: 1, name: heading })).toHaveCount(0);
      }
    }
  });
});

// The gate under test lives in `RootRoutes`: fixed public routes resolve before
// the runtime configuration screen, and every other path stops at that screen
// while public Supabase configuration is absent. A build that carries fixture
// configuration cannot observe either half, so this matrix owns a second Vite
// server started with those variables removed.
test.describe("public routing without Supabase configuration", () => {
  let unconfiguredServer: UnconfiguredDevServer | null = null;

  test.beforeAll(async ({}, testInfo) => {
    assertRoutingProjectExists(testInfo.config);
    if (testInfo.project.name !== ROUTING_PROJECT) return;

    test.setTimeout(UNCONFIGURED_STARTUP_TIMEOUT_MS + 60_000);
    await assertUnconfiguredPortIsFree();
    // Bound before the wait so an aborted hook still has a handle to stop.
    unconfiguredServer = spawnUnconfiguredDevServer(repositoryRoot(testInfo.config.configFile));
    await unconfiguredServer.ready;
  });

  test.afterAll(async () => {
    const server = unconfiguredServer;
    unconfiguredServer = null;
    await server?.stop();
  });

  test.beforeEach(async ({ page }, testInfo) => {
    assertRoutingProjectExists(testInfo.config);
    test.skip(testInfo.project.name !== ROUTING_PROJECT, ROUTING_PROJECT_REASON);

    test.setTimeout(90_000);
    page.setDefaultNavigationTimeout(UNCONFIGURED_NAVIGATION_TIMEOUT_MS);
    await installReleaseCatalogFixture(page);
    await installRuntime(page, "browser");
  });

  test("root renders the runtime configuration screen", async ({ page }) => {
    await page.goto(`${UNCONFIGURED_ORIGIN}/`);

    await expect(page.getByRole("heading", { level: 1, name: RUNTIME_CONFIGURATION_HEADING })).toBeVisible();
    await expect(page.getByRole("heading", { name: PUBLIC_HOME_HEADING })).toHaveCount(0);
    await expect(page.getByTestId("auth-form-shell")).toHaveCount(0);
  });

  test("fixed public routes stay reachable before the configuration gate", async ({ page }) => {
    // Public pages render the same either way, so this case proves its own
    // premise instead of relying on the case above as an out-of-band canary.
    await page.goto(`${UNCONFIGURED_ORIGIN}/`);
    await expect(page.getByRole("heading", { level: 1, name: RUNTIME_CONFIGURATION_HEADING })).toBeVisible();

    for (const [route, heading] of PUBLIC_ROUTE_HEADINGS) {
      await page.goto(`${UNCONFIGURED_ORIGIN}${route}`);

      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await expect(page.getByRole("heading", { level: 1, name: RUNTIME_CONFIGURATION_HEADING })).toHaveCount(0);
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

type UnconfiguredDevServer = {
  ready: Promise<void>;
  stop: () => Promise<void>;
};

function repositoryRoot(configFile: string | undefined): string {
  return configFile ? path.dirname(configFile) : process.cwd();
}

// A renamed or resharded project would make every routing case skip and still
// report exit 0, which would silently drop this file's whole contract.
function assertRoutingProjectExists(config: { projects: readonly { name: string }[] }) {
  const names = config.projects.map((project) => project.name);
  if (names.includes(ROUTING_PROJECT)) return;
  throw new Error(
    `Playwright project "${ROUTING_PROJECT}" is not configured (found: ${names.join(", ")}). ` +
      "The routing matrices would skip silently instead of running.",
  );
}

// Copies the current environment without any public Supabase name. Windows
// environment names are case-insensitive, so the comparison is uppercased to
// keep a differently cased variable from surviving the copy.
function unconfiguredEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (SUPABASE_PUBLIC_ENV_KEYS.has(key.toUpperCase())) continue;
    env[key] = value;
  }
  env.PORT = String(UNCONFIGURED_PORT);
  env.BASE_PATH = "/";
  return env;
}

async function servesUnconfiguredOrigin(): Promise<boolean> {
  try {
    const response = await fetch(`${UNCONFIGURED_ORIGIN}/`, { signal: AbortSignal.timeout(2_000) });
    return response.ok;
  } catch {
    return false;
  }
}

// `strictPort` already prevents Vite from silently drifting to another port, but
// a server left behind by an aborted run would answer with the wrong
// configuration, so the port is refused rather than reused.
async function assertUnconfiguredPortIsFree(): Promise<void> {
  if (!(await servesUnconfiguredOrigin())) return;
  throw new Error(
    `Port ${UNCONFIGURED_PORT} is already serving. This matrix owns that port; stop the other server first ` +
      `(Windows: netstat -ano | findstr :${UNCONFIGURED_PORT}, then taskkill /PID <pid> /T /F).`,
  );
}

// Spawns the server and returns its handle synchronously, so a caller aborted
// while awaiting `ready` still holds something it can stop.
function spawnUnconfiguredDevServer(cwd: string): UnconfiguredDevServer {
  const workspace = path.join(cwd, "artifacts", "kub");

  // Vite reads env files from its own root, which would put back the
  // configuration this matrix removes from the process environment.
  const strayEnvFile = VITE_ENV_FILE_NAMES.find((name) => existsSync(path.join(workspace, name)));
  if (strayEnvFile) {
    throw new Error(
      `${path.join(workspace, strayEnvFile)} would re-supply Supabase configuration to the unconfigured ` +
        "matrix. Remove it before running this suite.",
    );
  }

  // The `dev` script of `@workspace/kub` is `vite --config vite.config.ts --host
  // 0.0.0.0`, so this runs the same binary against the same config. Going
  // through `pnpm.cmd` would need a Windows shell, which Node deprecates when
  // arguments are passed and which adds a process layer between this test and
  // Vite. The one deliberate difference is the bind address: an unconfigured
  // build should not be reachable off this machine.
  const viteBin = path.join(workspace, "node_modules", "vite", "bin", "vite.js");
  if (!existsSync(viteBin)) {
    throw new Error(`Vite is not installed for @workspace/kub at ${viteBin}. Run the workspace install first.`);
  }

  const child = spawn(
    process.execPath,
    [viteBin, "--config", "vite.config.ts", "--host", "127.0.0.1"],
    {
      cwd: workspace,
      env: unconfiguredEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );

  const state = {
    settled: false,
    code: null as number | null,
    failure: null as Error | null,
    announcedPort: false,
  };

  // Only read when the server fails to start, so the buffer keeps the most
  // recent output instead of growing for as long as the server lives.
  const transcript: string[] = [];
  const record = (chunk: unknown) => {
    const plain = String(chunk).replace(ANSI_PATTERN, "");
    // Vite prints the bound origin only from the process that actually owns the
    // port, so this separates our child from a server leaked by an earlier run
    // that happens to be finishing its own boot.
    if (plain.includes(`:${UNCONFIGURED_PORT}`)) state.announcedPort = true;
    transcript.push(plain);
    if (transcript.length > TRANSCRIPT_CHUNK_LIMIT) transcript.shift();
  };
  child.stdout?.on("data", record);
  child.stderr?.on("data", record);

  // Without this listener a spawn failure would be an unhandled `error` event,
  // which takes the whole Playwright worker down.
  child.once("error", (failure) => {
    state.settled = true;
    state.failure = failure;
  });
  child.once("exit", (code) => {
    state.settled = true;
    state.code = code;
  });

  const killOnProcessExit = () => {
    if (child.exitCode === null && child.signalCode === null) killDevServerTree(child);
  };
  process.once("exit", killOnProcessExit);

  const stop = async () => {
    process.off("exit", killOnProcessExit);
    await stopDevServer(child);
  };

  const ready = (async () => {
    const deadline = Date.now() + UNCONFIGURED_STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (state.settled) {
        const cause = state.failure
          ? `failed to spawn: ${state.failure.message}`
          : `exited with code ${state.code}`;
        throw new Error(`The unconfigured Vite server ${cause}.\n${transcript.join("")}`);
      }
      if (state.announcedPort && (await servesUnconfiguredOrigin())) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    await stop();
    throw new Error(
      `The unconfigured Vite server did not answer on ${UNCONFIGURED_ORIGIN} within ` +
        `${UNCONFIGURED_STARTUP_TIMEOUT_MS} ms.\n${transcript.join("")}`,
    );
  })();

  return { ready, stop };
}

// Windows has no process groups to signal, so the tree is killed by PID.
function killDevServerTree(child: ChildProcess): { ok: boolean; detail: string } {
  if (process.platform !== "win32" || child.pid === undefined) {
    return { ok: child.kill("SIGTERM"), detail: "SIGTERM was refused" };
  }
  const killed = spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { encoding: "utf8" });
  return {
    ok: killed.status === 0,
    detail: `taskkill exited ${killed.status}: ${(killed.stderr ?? "").trim() || "no stderr"}`,
  };
}

async function stopDevServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;

  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  const problems: string[] = [];

  const killed = killDevServerTree(child);
  if (!killed.ok) problems.push(killed.detail);

  if (!(await settlesWithin(exited, STOP_GRACE_MS))) {
    problems.push(`the tree was still alive after ${STOP_GRACE_MS} ms`);
    child.kill("SIGKILL");
    if (!(await settlesWithin(exited, STOP_GRACE_MS))) problems.push("SIGKILL did not reap it either");
  }

  // A surviving server would only surface on the next run, as the busy-port
  // guard, so it is reported here where the cause is still visible.
  if (problems.length > 0) {
    throw new Error(
      `The unconfigured Vite server (PID ${child.pid}) on port ${UNCONFIGURED_PORT} may still be running: ` +
        `${problems.join("; ")}.`,
    );
  }
}

async function settlesWithin(settled: Promise<void>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      settled.then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
