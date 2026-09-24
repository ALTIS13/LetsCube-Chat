import { expect, type Page, test } from "@playwright/test";
import {
  chat,
  membership,
  openFixture,
  person,
  requireFixtureServer,
} from "./helpers/messageActionsFixture";

const me = person("11111111-1111-4111-8111-000000000001", "Тестовый пользователь");
const chatId = "22222222-2222-4222-8222-000000000001";

async function openPushFixture(
  page: Page,
  permission: "default" | "denied",
  options: { installed?: boolean; stalledWorker?: boolean } = {},
) {
  await requireFixtureServer(page.request);
  await page.addInitScript(
    ({ state, installed, stalledWorker }) => {
      Object.defineProperty(navigator, "userAgent", {
        configurable: true,
        value:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
      });
      Object.defineProperty(navigator, "standalone", { configurable: true, value: installed });
      Object.defineProperty(window, "PushManager", {
        configurable: true,
        value: function PushManager() {},
      });
      const notification = window.Notification ?? function Notification() {};
      Object.defineProperty(notification, "permission", { configurable: true, value: state });
      const permissionCalls: string[] = [];
      (window as unknown as { __permissionCalls: typeof permissionCalls }).__permissionCalls =
        permissionCalls;
      Object.defineProperty(notification, "requestPermission", {
        configurable: true,
        value: () => {
          permissionCalls.push("request");
          return Promise.resolve(state);
        },
      });
      Object.defineProperty(window, "Notification", { configurable: true, value: notification });
      const calls: boolean[] = [];
      (window as unknown as { __subscribeCalls: typeof calls }).__subscribeCalls = calls;
      let subscription: {
        endpoint: string;
        toJSON: () => { endpoint: string; keys: { p256dh: string; auth: string } };
      } | null = null;
      const registration = {
        pushManager: {
          getSubscription: async () => subscription,
          subscribe: () => {
            calls.push(navigator.userActivation?.isActive ?? true);
            subscription = {
              endpoint: "https://push.letscube.ru/fixture",
              toJSON: () => ({
                endpoint: "https://push.letscube.ru/fixture",
                keys: { p256dh: "fixture", auth: "fixture" },
              }),
            };
            return Promise.resolve(subscription);
          },
        },
      };
      let workerReady = !stalledWorker;
      const pendingReady = new Promise<never>(() => {});
      let registrationCalls = 0;
      (window as unknown as { __registrationCalls: () => number }).__registrationCalls = () =>
        registrationCalls;
      if (stalledWorker) {
        navigator.serviceWorker.register = async () => {
          registrationCalls += 1;
          if (registrationCalls === 1) throw new Error("fixture worker registration failed");
          workerReady = true;
          return registration as never;
        };
      }
      Object.defineProperty(navigator.serviceWorker, "ready", {
        configurable: true,
        get: () => (workerReady ? Promise.resolve(registration) : pendingReady),
      });
      navigator.serviceWorker.getRegistration = async () =>
        workerReady ? (registration as never) : null;
    },
    {
      state: permission,
      installed: options.installed ?? true,
      stalledWorker: options.stalledWorker ?? false,
    },
  );
  await openFixture(page, {
    me,
    chats: [chat(chatId, "group", "Команда проекта", "2026-09-24T12:00:00Z")],
    memberships: [membership(chatId, me, "owner", null)],
    messages: [],
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
}

test("installed iPhone PWA offers push once, then respects Later", async ({ page }, info) => {
  await openPushFixture(page, "default");
  const nudge = page.getByTestId("pwa-push-nudge");
  await expect(nudge).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { __permissionCalls: string[] }).__permissionCalls,
    ),
  ).toEqual([]);
  await expect(nudge.getByRole("button", { name: "Включить" })).toBeVisible();
  await page.screenshot({ path: info.outputPath("push-nudge.png") });
  await page.evaluate(() => {
    localStorage.setItem("kub-theme", "light");
    window.dispatchEvent(new StorageEvent("storage", { key: "kub-theme", newValue: "light" }));
  });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.screenshot({ path: info.outputPath("push-nudge-light.png") });
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(nudge).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(nudge).toBeVisible();
  await nudge.getByRole("button", { name: "Позже" }).click();
  await expect(nudge).toHaveCount(0);
  await page.reload();
  await expect(nudge).toHaveCount(0);
});

test("denied iPhone permission shows Settings guidance, not a broken enable button", async ({
  page,
}) => {
  await openPushFixture(page, "denied");
  const nudge = page.getByTestId("pwa-push-nudge");
  await expect(nudge).toBeVisible();
  await expect(nudge).toContainText("Настройки");
  await expect(nudge.getByRole("button", { name: "Включить" })).toHaveCount(0);
});

test("explicit Enable starts the push subscription inside the tap", async ({ page }) => {
  await openPushFixture(page, "default");
  const nudge = page.getByTestId("pwa-push-nudge");
  await expect(nudge).toBeVisible();
  await nudge.getByRole("button", { name: "Включить" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __subscribeCalls: boolean[] }).__subscribeCalls.length,
      ),
    )
    .toBe(1);
  expect(
    await page.evaluate(
      () => (window as unknown as { __subscribeCalls: boolean[] }).__subscribeCalls,
    ),
  ).toEqual([true]);
  expect(
    await page.evaluate(
      () => (window as unknown as { __permissionCalls: string[] }).__permissionCalls,
    ),
  ).toEqual([]);
  await expect(nudge).toHaveCount(0);
  const snoozedUntil = await page.evaluate(
    (id) => Number(localStorage.getItem(`letscube:pwa-push-nudge:${id}`)),
    me.id,
  );
  expect(snoozedUntil).toBeGreaterThan(Date.now());
});

test("iPhone browser tab does not show installed-app permission instructions", async ({ page }) => {
  await openPushFixture(page, "denied", { installed: false });
  await page.getByRole("button", { name: "Меню" }).first().click();
  await page.getByRole("button", { name: "Настройки" }).first().click();
  const section = page.getByRole("dialog");
  await expect(section).toContainText("Заблокировано в настройках браузера");
  await expect(section).not.toContainText("Настройки» iPhone");
});

test("failed worker setup offers retry and then enables push in a fresh tap", async ({ page }) => {
  await openPushFixture(page, "default", { stalledWorker: true });
  await page.getByRole("button", { name: "Меню" }).first().click();
  await page.getByRole("button", { name: "Настройки" }).first().click();
  const section = page.getByRole("dialog");
  const retry = section.getByRole("button", { name: "Повторить подготовку" });
  await expect(retry).toBeEnabled({ timeout: 12_000 });
  await expect(section).toContainText("Не удалось подготовить уведомления");
  await retry.click();
  await expect(section.getByRole("button", { name: "Включить" })).toBeEnabled();
  await section.getByRole("button", { name: "Включить" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __subscribeCalls: boolean[] }).__subscribeCalls.length,
      ),
    )
    .toBe(1);
  expect(
    await page.evaluate(() =>
      (window as unknown as { __registrationCalls: () => number }).__registrationCalls(),
    ),
  ).toBeGreaterThanOrEqual(2);
});
