import { expect, test, type Page } from "@playwright/test";

import { loadQaCredentials, loginIfNeeded, type QaRole } from "./helpers/auth";
import { IPHONE_14_PRO, emulateInstalledIosApp, expectClearOfHardware } from "./helpers/ios-standalone";

/**
 * The installed iPhone app's signed-in screens, geometry only.
 *
 * `ios-standalone-safe-area.spec.ts` reaches the conversation, the public pages
 * and the auth forms through fixtures. It cannot reach the tab bar, the
 * full-screen sheets, the docked support window or the staff pages, which are
 * pinned to the same edges and only exist signed in, against the real backend
 * — where the screen shows real people's data. So this file is opt-in and holds
 * itself to that:
 *
 *  - it runs only when `KUB_IOS_STAND_SIGNED_IN_URL` names a dev server wired to
 *    the real backend, and refuses to start unless `KUB_QA_ALLOW_MUTATIONS` is
 *    `0` in this process;
 *  - it creates and changes nothing: no chat is opened, because opening one
 *    marks it read, no form is submitted, and menus and sheets are only opened;
 *  - it records nothing a person wrote. A violation is reported by tag, role
 *    and test id, never by text, and screenshots, traces and video are off for
 *    the whole file — which is why this is a file of its own: Playwright only
 *    lets those be switched off per worker, not per describe.
 */

test.use({ screenshot: "off", trace: "off", video: "off" });

const STAND_PROJECT = "webkit-ios-standalone";
const SIGNED_IN_URL = process.env.KUB_IOS_STAND_SIGNED_IN_URL;
const SIGNED_IN_ROLE = (process.env.KUB_IOS_STAND_SIGNED_IN_ROLE ?? "owner") as QaRole;

async function signIn(page: Page) {
  if (!SIGNED_IN_URL) throw new Error("KUB_IOS_STAND_SIGNED_IN_URL is not set");
  const credentials = loadQaCredentials(SIGNED_IN_ROLE);
  if (!credentials) {
    throw new Error(
      `KUB_IOS_STAND_SIGNED_IN_URL is set but there are no QA credentials for '${SIGNED_IN_ROLE}', so the signed-in screens cannot be checked`,
    );
  }
  await page.goto(SIGNED_IN_URL, { waitUntil: "domcontentloaded" });
  await loginIfNeeded(page, credentials, { authStateName: SIGNED_IN_ROLE });
  await page.waitForTimeout(1_500);
}

/** Every scroll container on the screen, to its end, so missing end padding shows. */
async function scrollEveryListToEnd(page: Page) {
  await page.evaluate(() => {
    for (const element of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const style = getComputedStyle(element);
      if (/auto|scroll/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1) {
        element.scrollTop = element.scrollHeight;
      }
    }
  });
  await page.waitForTimeout(700);
}

const quietly = { revealText: false };

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== STAND_PROJECT, `the installed-app layout is checked on ${STAND_PROJECT}`);
  test.skip(!SIGNED_IN_URL, "set KUB_IOS_STAND_SIGNED_IN_URL to a dev server on the real backend to check the signed-in screens");
  if (process.env.KUB_QA_ALLOW_MUTATIONS !== "0") {
    throw new Error("the signed-in screens are checked only with KUB_QA_ALLOW_MUTATIONS=0 in this process");
  }
});

test.describe("portrait", () => {
  const { viewport, insets } = IPHONE_14_PRO.portrait;
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(viewport);
    await emulateInstalledIosApp(page, insets);
  });

  test("the chat list and the tab bar, at rest and at the end", async ({ page }) => {
    await signIn(page);
    await expect(page.getByRole("navigation", { name: "Навигация" })).toBeVisible();
    await expectClearOfHardware(page, insets, "signed-in portrait, chat list", quietly);
    await scrollEveryListToEnd(page);
    await expectClearOfHardware(page, insets, "signed-in portrait, chat list end", quietly);
  });

  for (const [tab, what] of [
    ["Профиль", "the profile and settings sheet"],
    ["Папки", "the folders sheet"],
  ] as const) {
    test(what, async ({ page }) => {
      await signIn(page);
      await page.getByRole("button", { name: tab, exact: true }).click();
      await expect(page.getByRole("dialog").first()).toBeVisible();
      await page.waitForTimeout(800);
      await expectClearOfHardware(page, insets, `signed-in portrait, ${what}`, quietly);
      await scrollEveryListToEnd(page);
      await expectClearOfHardware(page, insets, `signed-in portrait, ${what} end`, quietly);
    });
  }

  // «the search palette» stood here until 2026-09-12. It opened
  // `GlobalSearchPalette` from a button named «Поиск» and photographed the
  // sheet; the palette was deleted and that button now exists only while the
  // list has scrolled and the search row has tucked away, so the test had no
  // subject and no stable way in. Search on a phone is the chat list column
  // itself, whose geometry «the chat list and the tab bar» above already
  // covers. Nothing replaces it here: summoning the results column needs a
  // typed query, and this file photographs real accounts and so reveals no
  // text on purpose.

  test("the sidebar menu and the docked support window", async ({ page }) => {
    await signIn(page);
    await page.getByRole("button", { name: "Меню", exact: true }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await expectClearOfHardware(page, insets, "signed-in portrait, sidebar menu", quietly);
    await page.getByRole("button", { name: "Помощь", exact: true }).click();
    await expect(page.getByTestId("support-window")).toHaveAttribute("data-docked", "true");
    await page.waitForTimeout(1_000);
    await expectClearOfHardware(page, insets, "signed-in portrait, docked support window", quietly);
  });

  test("the notification panel", async ({ page }) => {
    await signIn(page);
    await page.getByTestId("notification-bell-button").click();
    await expect(page.getByTestId("notification-panel")).toBeVisible();
    await page.waitForTimeout(1_000);
    await expectClearOfHardware(page, insets, "signed-in portrait, notification panel", quietly);
  });

  for (const [route, marker, what] of [
    ["/bots", "bots-page", "the bots page"],
    ["/admin", "admin-shell", "the staff area"],
  ] as const) {
    test(what, async ({ page }) => {
      await signIn(page);
      await page.goto(new URL(route, SIGNED_IN_URL).toString(), { waitUntil: "domcontentloaded" });
      const reached = await page
        .getByTestId(marker)
        .waitFor({ state: "visible", timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      test.skip(!reached, `${what} is not open to the '${SIGNED_IN_ROLE}' QA account`);
      await page.waitForTimeout(1_000);
      await expectClearOfHardware(page, insets, `signed-in portrait, ${what}`, quietly);
      await scrollEveryListToEnd(page);
      await expectClearOfHardware(page, insets, `signed-in portrait, ${what} end`, quietly);
    });
  }

  test("the tasks page", async ({ page }) => {
    await signIn(page);
    await page.goto(new URL("/tasks", SIGNED_IN_URL).toString(), { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Задачи", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1_000);
    await expectClearOfHardware(page, insets, "signed-in portrait, tasks page", quietly);
    await scrollEveryListToEnd(page);
    await expectClearOfHardware(page, insets, "signed-in portrait, tasks page end", quietly);
  });
});

test.describe("landscape", () => {
  const { viewport, insets } = IPHONE_14_PRO.landscape;
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(viewport);
    await emulateInstalledIosApp(page, insets);
  });

  test("the two panes, at rest and at the end", async ({ page }) => {
    await signIn(page);
    // The application's top bar was removed on 2026-09-12. Held sideways the
    // list's own header is the top of the window, and it is what now pads the
    // inset the bar used to carry from `md`.
    await expect(page.getByTestId("sidebar-control-row")).toBeVisible();
    await expectClearOfHardware(page, insets, "signed-in landscape, two panes", quietly);
    await scrollEveryListToEnd(page);
    await expectClearOfHardware(page, insets, "signed-in landscape, two panes end", quietly);
  });

  test("the notification panel and the floating support window", async ({ page }) => {
    await signIn(page);
    await page.getByTestId("notification-bell-button").click();
    await expect(page.getByTestId("notification-panel")).toBeVisible();
    await page.waitForTimeout(1_000);
    await expectClearOfHardware(page, insets, "signed-in landscape, notification panel", quietly);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Меню", exact: true }).click();
    await page.getByRole("button", { name: "Помощь", exact: true }).click();
    await expect(page.getByTestId("support-window")).toHaveAttribute("data-docked", "false");
    await page.waitForTimeout(1_000);
    await expectClearOfHardware(page, insets, "signed-in landscape, floating support window", quietly);
  });
});
