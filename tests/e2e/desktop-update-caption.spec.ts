import { expect, test, type Page } from "@playwright/test";
import {
  chat,
  membership,
  message,
  openFixture,
  person,
  requireFixtureServer,
} from "./helpers/messageActionsFixture";

/**
 * Tracker item 42. The owner, 2026-09-20: «уведомление об обновлении красиво
 * убрать вправо-вверх рядом с кнопками действия с окном (пример с пк версии)»,
 * with a screenshot of Discord's desktop client, whose update arrow sits
 * beside minimise, maximise and close. The offer used to float as a card
 * under the caption strip. It is now in the strip, left of the window's own
 * buttons, and every state it had is still said there.
 *
 * The Windows shell's bridge is replaced by a fake with the fields the
 * interface calls; the conversation is fictional and served by the fixture.
 */

test.use({ screenshot: "off", trace: "off", video: "off" });

const AT = "2026-09-27T09:00:00.000Z";
const ME = person("71111111-1111-4111-8111-000000000001", "Максим Орлов", "maksim");
const ANNA = person("71111111-1111-4111-8111-000000000002", "Анна Смирнова", "anna");
const CHAT_ID = "72222222-2222-4222-8222-000000000001";

type Phase = "current" | "available" | "downloading" | "installing" | "failed" | "critical_update_required";

async function boot(page: Page, phase: Phase, options: { previousVersion?: string; downloaded?: number } = {}) {
  await page.addInitScript(({ phase, previousVersion, downloaded }) => {
    const version = "0.2.10";
    const calls: string[] = [];
    const state = {
      channel: "stable",
      phase,
      installedVersion: version,
      availableVersion: phase === "current" ? null : "0.2.11",
      downloadedBytes: downloaded ?? 0,
      totalBytes: phase === "downloading" ? 100 : null,
      mandatory: phase === "critical_update_required",
      errorCode: phase === "failed" ? "network" : null,
    };
    const quiet = async () => undefined;
    Reflect.set(window, "__captionUpdateCalls", calls);
    Object.defineProperty(window, "letscubeDesktop", {
      configurable: false,
      enumerable: false,
      writable: false,
      value: Object.freeze({
        platform: "windows",
        version,
        build: 14,
        getRuntimeInfo: async () => ({ platform: "windows", version, build: 14 }),
        getUpdateState: async () => ({ ...state }),
        getUpdateChannel: async () => "stable",
        setUpdateChannel: async () => ({ ...state }),
        checkUpdate: async () => {
          calls.push("check");
          return { ...state };
        },
        installUpdate: async () => {
          calls.push("install");
          return { ...state };
        },
        getStorageState: async () => null,
        setStorageLocation: quiet,
        setCacheLimit: quiet,
        clearCache: quiet,
        showMain: quiet,
        isMainForeground: async () => true,
        notify: async () => false,
        removeNotification: async () => false,
        takePendingNotificationRoute: async () => null,
        startDragging: quiet,
        minimize: quiet,
        toggleMaximize: quiet,
        isMaximized: async () => false,
        closeToTray: quiet,
      }),
    });
    localStorage.setItem("letscube:desktop:last-installed-version", previousVersion ?? version);
  }, { phase, previousVersion: options.previousVersion ?? null, downloaded: options.downloaded ?? null });
  await openFixture(page, {
    me: ME,
    people: [ANNA],
    chats: [chat(CHAT_ID, "private", null, AT)],
    memberships: [membership(CHAT_ID, ME, "owner", AT), membership(CHAT_ID, ANNA, "member", AT)],
    messages: [message("73333333-3333-4333-8333-000000000001", CHAT_ID, ANNA, "Привет", AT)],
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("desktop-window-chrome")).toBeVisible();
}

/** Where the offer is, against the strip and against the window's first button. */
async function placement(page: Page) {
  return page.evaluate(() => {
    const chrome = document.querySelector('[data-testid="desktop-window-chrome"]')!.getBoundingClientRect();
    const offer = document.querySelector('[data-testid="desktop-update-pill"]')!.getBoundingClientRect();
    const minimise = document.querySelector('[data-testid="desktop-window-chrome"] button[aria-label="Свернуть"]')!.getBoundingClientRect();
    return {
      inStrip: offer.top >= chrome.top - 0.5 && offer.bottom <= chrome.bottom + 0.5,
      leftOfButtons: offer.right <= minimise.left + 0.5,
    };
  });
}

const calls = (page: Page) => page.evaluate(() => [...(Reflect.get(window, "__captionUpdateCalls") as string[])]);

test.beforeEach(async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop-1440", "the Windows caption is a desktop surface");
  await requireFixtureServer(request);
});

test("an available update sits in the caption, left of the window's buttons, and installs on press", async ({ page }) => {
  await boot(page, "available");
  const offer = page.getByTestId("desktop-window-chrome").getByTestId("desktop-update-pill");
  await expect(offer).toHaveAttribute("data-phase", "available");
  await expect(offer).toHaveAccessibleName(/Установить обновление/);
  expect(await placement(page)).toEqual({ inStrip: true, leftOfButtons: true });

  await offer.click();
  await expect.poll(() => calls(page)).toContain("install");
});

test("a download in progress says how far it is, in the caption", async ({ page }) => {
  await boot(page, "downloading", { downloaded: 25 });
  const progress = page.getByTestId("desktop-window-chrome").getByRole("progressbar", { name: "Загрузка обновления" });
  await expect(progress).toHaveAttribute("aria-valuenow", "25");
  expect(await placement(page)).toEqual({ inStrip: true, leftOfButtons: true });
});

test("a failed update asks again on press", async ({ page }) => {
  await boot(page, "failed");
  const offer = page.getByTestId("desktop-window-chrome").getByTestId("desktop-update-pill");
  await expect(offer).toHaveAttribute("data-phase", "failed");
  await offer.click();
  await expect.poll(() => calls(page)).toContain("check");
});

test("after an update the caption says so, briefly", async ({ page }) => {
  await boot(page, "current", { previousVersion: "0.2.9" });
  const note = page.getByTestId("desktop-window-chrome").getByTestId("desktop-update-pill");
  await expect(note).toHaveAttribute("data-update-success", "true");
  await expect(note).toContainText("Обновление установлено");
  expect(await placement(page)).toEqual({ inStrip: true, leftOfButtons: true });
  await expect(note).toHaveCount(0, { timeout: 7_000 });
});

test("a required update still blocks the window, and the caption offers nothing of its own", async ({ page }) => {
  await boot(page, "critical_update_required");
  await expect(page.getByTestId("desktop-critical-update-gate")).toBeVisible();
  await expect(page.getByTestId("desktop-window-chrome").getByTestId("desktop-update-pill")).toHaveCount(0);
});

test("nothing floats under the caption any more", async ({ page }) => {
  await boot(page, "available");
  await expect(page.getByTestId("desktop-update-pill")).toHaveCount(1);
  await expect(page.locator(".desktop-update-pill")).toHaveCount(0);
});
