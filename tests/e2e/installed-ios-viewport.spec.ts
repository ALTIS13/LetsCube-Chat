import { expect, type Page, test } from "@playwright/test";

import { emulateInstalledIosApp, type Insets } from "./helpers/ios-standalone";
import {
  chat,
  membership,
  message,
  openChat,
  openFixture,
  person,
  type Row,
  requireFixtureServer,
} from "./helpers/messageActionsFixture";

/**
 * D-111: the installed iPhone app's shell and keyboard.
 *
 * On a tester's iPhone 15 Pro Max the installed app left a band of about 60pt
 * under the composer from its first frame, which stayed after the app was opened
 * again, and with the keyboard up the chat header went off the top of the
 * screen. Neither engine here is iOS. Chromium plays the installed app's flag and
 * its insets, and a stand-in for `visualViewport` plays the keyboard as iOS does:
 * what is visible shrinks and the page may pan. What these checks hold is the
 * product's half — fitting the shell before and during keyboard use, keeping
 * the header and composer visible, and restoring the home-indicator inset.
 */

const INSETS: Insets = { top: 59, right: 0, bottom: 34, left: 0 };
const SCREEN = 932;
const KEYBOARD = 336;
const ME = person("11111111-1111-4111-8111-1111111111f1", "Максим");
const ANYA = person("11111111-1111-4111-8111-1111111111f2", "Аня");
const CHAT_ID = "22222222-2222-4222-8222-2222222222f1";
const LATEST = "Последнее сообщение";

function history(): Row[] {
  return Array.from({ length: 30 }, (_, index) =>
    message(
      `55555555-5555-4555-8555-7${String(index).padStart(11, "0")}`,
      CHAT_ID,
      index % 2 ? ME : ANYA,
      index === 29 ? LATEST : `Сообщение ${index + 1}`,
      new Date(Date.now() - (30 - index) * 60_000).toISOString(),
    ),
  );
}

/** A `visualViewport` the test moves, as iOS moves the real one for its keyboard. */
async function installKeyboardStandIn(page: Page, initialVisibleHeight?: number) {
  await page.addInitScript((visibleHeight) => {
    const events = new EventTarget();
    // Init scripts run before the mobile viewport meta tag is parsed. Read the
    // settled layout height lazily unless a shorter iOS viewport was requested.
    const nativeInnerHeight = Object.getOwnPropertyDescriptor(window, "innerHeight");
    const state: { height: number | null; offsetTop: number; layoutHeight: number | null } = {
      height: visibleHeight ?? null,
      offsetTop: 0,
      layoutHeight: null,
    };
    const viewport = {
      get width() {
        return window.innerWidth;
      },
      get height() {
        return state.height ?? window.innerHeight;
      },
      get offsetTop() {
        return state.offsetTop;
      },
      get offsetLeft() {
        return 0;
      },
      get pageTop() {
        return state.offsetTop + window.scrollY;
      },
      get pageLeft() {
        return window.scrollX;
      },
      scale: 1,
      onresize: null,
      onscroll: null,
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      dispatchEvent: events.dispatchEvent.bind(events),
    };
    Object.defineProperty(window, "visualViewport", { configurable: true, get: () => viewport });
    (
      window as unknown as {
        __keyboard: (height: number, offsetTop?: number, shrinkLayout?: boolean) => void;
      }
    ).__keyboard = (height: number, offsetTop = 0, shrinkLayout = false) => {
      state.layoutHeight ??= window.innerHeight;
      state.height = height ? state.layoutHeight - height : (visibleHeight ?? null);
      if (shrinkLayout) {
        Object.defineProperty(window, "innerHeight", {
          configurable: true,
          get: () => state.height ?? state.layoutHeight,
        });
      } else if (nativeInnerHeight) {
        Object.defineProperty(window, "innerHeight", nativeInnerHeight);
      } else {
        delete (window as unknown as { innerHeight?: number }).innerHeight;
      }
      state.offsetTop = offsetTop;
      // iOS 26 can pan the rendered document without changing scrollTop.
      // Reproduce that compositor result instead of merely reporting an offset.
      document.body.style.position = offsetTop ? "relative" : "";
      document.body.style.top = offsetTop ? `${-offsetTop}px` : "";
      events.dispatchEvent(new Event("resize"));
      events.dispatchEvent(new Event("scroll"));
    };
  }, initialVisibleHeight);
}

async function openConversation(page: Page) {
  const now = new Date().toISOString();
  await openFixture(page, {
    me: ME,
    chats: [chat(CHAT_ID, "private", null, now)],
    memberships: [membership(CHAT_ID, ME, "owner", now), membership(CHAT_ID, ANYA, "member", now)],
    messages: history(),
  });
  await openChat(page, ANYA.full_name, LATEST);
  await page.waitForTimeout(800);
}

async function openChatList(page: Page) {
  const now = new Date().toISOString();
  await openFixture(page, {
    me: ME,
    chats: [chat(CHAT_ID, "private", null, now)],
    memberships: [membership(CHAT_ID, ME, "owner", now), membership(CHAT_ID, ANYA, "member", now)],
    messages: history(),
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("navigation", { name: "Навигация" })).toBeVisible();
}

function keyboard(page: Page, height: number, offsetTop = 0, shrinkLayout = false) {
  return page.evaluate(
    ([value, top, shrink]) =>
      (
        window as unknown as {
          __keyboard: (h: number, offsetTop?: number, shrinkLayout?: boolean) => void;
        }
      ).__keyboard(value, top, shrink),
    [height, offsetTop, shrinkLayout] as const,
  );
}

function geometry(page: Page) {
  return page.evaluate(() => {
    const shell =
      document.querySelector<HTMLElement>('[data-testid="desktop-app-shell"]')?.parentElement ??
      null;
    const dock = document.querySelector<HTMLElement>('[data-testid="chat-composer-dock"]');
    const header = document.querySelector<HTMLElement>('[data-testid="chat-control-row"]');
    const nav = document.querySelector<HTMLElement>('nav[aria-label="Навигация"]');
    return {
      token: getComputedStyle(document.documentElement).getPropertyValue("--kub-app-height").trim(),
      fitted: document.documentElement.style.getPropertyValue("--kub-app-height"),
      shellHeight: shell ? Math.round(shell.getBoundingClientRect().height) : null,
      shellTop: shell ? Math.round(shell.getBoundingClientRect().top) : null,
      dockBottom: dock ? Math.round(dock.getBoundingClientRect().bottom) : null,
      dockPadding: dock ? getComputedStyle(dock).paddingBottom : null,
      headerTop: header ? Math.round(header.getBoundingClientRect().top) : null,
      navTop: nav ? Math.round(nav.getBoundingClientRect().top) : null,
      navBottom: nav ? Math.round(nav.getBoundingClientRect().bottom) : null,
      visualHeight: window.visualViewport?.height ?? null,
      visualTop: window.visualViewport?.offsetTop ?? null,
    };
  });
}

test.describe("the installed iPhone app's shell and keyboard", () => {
  test.use({
    viewport: { width: 430, height: SCREEN },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  test.beforeEach(async ({ request }) => {
    await requireFixtureServer(request);
  });

  test("standalone display mode marks the iPhone shell even when navigator.standalone is absent", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "userAgent", {
        configurable: true,
        get: () =>
          "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
      });
      Object.defineProperty(navigator, "standalone", { configurable: true, get: () => undefined });
      const nativeMatchMedia = window.matchMedia.bind(window);
      window.matchMedia = (query: string) =>
        query === "(display-mode: standalone)"
          ? ({ matches: true, media: query } as MediaQueryList)
          : nativeMatchMedia(query);
    });
    await installKeyboardStandIn(page, SCREEN - 60);
    await page.goto("/");

    await expect(page.locator("html[data-ios-standalone]")).toHaveCount(1);
    expect(
      await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--kub-app-height").trim(),
      ),
    ).toBe(`${SCREEN - 60}px`);
  });

  test("a public page without a chat fits the installed app's shorter visible viewport", async ({
    page,
  }) => {
    await emulateInstalledIosApp(page, INSETS);
    await installKeyboardStandIn(page, SCREEN - 60);
    await page.goto("/privacy", { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("public-scroll-root")).toBeVisible();
    await expect
      .poll(async () =>
        page
          .getByTestId("public-scroll-root")
          .evaluate((element) => Math.round(element.getBoundingClientRect().height)),
      )
      .toBe(SCREEN - 60);
  });

  test("the shell is as tall as the screen, and with the keys up it fits what is visible", async ({
    page,
  }) => {
    await emulateInstalledIosApp(page, INSETS);
    await installKeyboardStandIn(page);
    await openConversation(page);

    const rest = await geometry(page);
    expect(rest.token, "the installed app's shell height").toBe(`${SCREEN}px`);
    expect(rest.shellHeight, "the shell is as tall as the screen").toBe(SCREEN);
    expect(rest.dockBottom, "the composer's dock reaches the bottom edge").toBe(SCREEN);
    expect(rest.dockPadding, "at rest the composer pads for the home indicator").toBe(
      `${INSETS.bottom}px`,
    );

    await page.locator('[data-testid="chat-composer-dock"] textarea').focus();
    await keyboard(page, KEYBOARD);
    await expect
      .poll(async () => (await geometry(page)).fitted, {
        message: "the shell was not fitted to the keys",
      })
      .toBe(`${SCREEN - KEYBOARD}px`);
    const up = await geometry(page);
    expect(up.shellHeight, "the shell fits what the keys leave visible").toBe(SCREEN - KEYBOARD);
    expect(up.dockBottom, "the composer sits on the keys").toBe(SCREEN - KEYBOARD);
    expect(up.headerTop, "the chat header stays on screen").toBeGreaterThanOrEqual(0);
    // The dock's padding eases over 150ms, so it is read once it has come to rest.
    await expect
      .poll(async () => (await geometry(page)).dockPadding, {
        message: "something still pads for the home indicator under the keys",
      })
      .toBe("0px");

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await keyboard(page, 0);
    await expect
      .poll(async () => (await geometry(page)).fitted, {
        message: "the shell's height was not given back",
      })
      .toBe(`${SCREEN}px`);
    expect((await geometry(page)).shellHeight, "the shell is as tall as the screen again").toBe(
      SCREEN,
    );
    await expect
      .poll(async () => (await geometry(page)).dockPadding, {
        message: "the home indicator's padding did not come back",
      })
      .toBe(`${INSETS.bottom}px`);
  });

  test("a shorter installed-app visual viewport does not clip the composer at rest", async ({
    page,
  }) => {
    await emulateInstalledIosApp(page, INSETS);
    await installKeyboardStandIn(page, SCREEN - 60);
    await openConversation(page);

    await expect.poll(async () => (await geometry(page)).shellHeight).toBe(SCREEN - 60);
    const rest = await geometry(page);
    expect(rest.dockBottom, "the whole composer stays inside the visible app area").toBe(
      SCREEN - 60,
    );
    expect(rest.dockPadding, "the home indicator still has its own padding").toBe(
      `${INSETS.bottom}px`,
    );
  });

  test("the chat list keeps every bottom navigation tab inside a shorter installed-app viewport", async ({
    page,
  }) => {
    await emulateInstalledIosApp(page, INSETS);
    await installKeyboardStandIn(page, SCREEN - 60);
    await openChatList(page);

    const rest = await geometry(page);
    expect(rest.visualHeight).toBe(SCREEN - 60);
    expect(rest.shellHeight, "the list shell fits the paintable area").toBe(SCREEN - 60);
    expect(rest.navTop, "the navigation capsule remains on screen").toBeGreaterThanOrEqual(0);
    expect(rest.navBottom, "no tab is cut by the system's lower band").toBeLessThanOrEqual(
      SCREEN - 60,
    );

    const row = page.getByTestId("chat-list-item").filter({ hasText: ANYA.full_name });
    await expect(row).toBeVisible();
    await row.click();
    await expect(
      page.locator('[data-message-bubble="true"]').filter({ hasText: LATEST }),
    ).toBeVisible();
    await page.locator('[data-testid="chat-composer-dock"] textarea').focus();
    await keyboard(page, KEYBOARD, 72);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await keyboard(page, 0);
    await page.getByRole("button", { name: "Назад" }).click();
    await expect(page.getByRole("navigation", { name: "Навигация" })).toBeVisible();
    await expect.poll(async () => (await geometry(page)).shellHeight).toBe(SCREEN - 60);
    expect((await geometry(page)).navBottom).toBeLessThanOrEqual(SCREEN - 60);
  });

  test("search keyboard pan keeps the shared chat-list shell visible and restores it on dismissal", async ({
    page,
  }) => {
    await emulateInstalledIosApp(page, INSETS);
    await installKeyboardStandIn(page, SCREEN - 60);
    await openChatList(page);

    await page.getByTestId("sidebar-search-input").focus();
    await keyboard(page, KEYBOARD, 72, true);
    await expect.poll(async () => (await geometry(page)).shellTop).toBe(0);
    await expect.poll(async () => (await geometry(page)).shellHeight).toBe(SCREEN - KEYBOARD);
    expect((await geometry(page)).navBottom).toBeLessThanOrEqual(SCREEN - KEYBOARD);

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await keyboard(page, 0);
    await expect.poll(async () => (await geometry(page)).shellHeight).toBe(SCREEN - 60);
  });

  test("the keyboard's visual-viewport pan keeps the header and composer inside the visible area", async ({
    page,
  }) => {
    await emulateInstalledIosApp(page, INSETS);
    await installKeyboardStandIn(page);
    await openConversation(page);

    await page.locator('[data-testid="chat-composer-dock"] textarea').focus();
    await keyboard(page, KEYBOARD, 72);

    await expect.poll(async () => (await geometry(page)).shellTop).toBe(0);
    const up = await geometry(page);
    expect(up.headerTop, "the header cannot sit above the panned viewport").toBeGreaterThanOrEqual(
      0,
    );
    expect(up.dockBottom, "the composer meets the keyboard after the pan").toBe(SCREEN - KEYBOARD);

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await keyboard(page, 0);
    await expect.poll(async () => (await geometry(page)).shellTop).toBe(0);
  });

  test("a resized layout viewport still reveals the keyboard over a shorter installed-app screen", async ({
    page,
  }) => {
    await emulateInstalledIosApp(page, INSETS);
    await installKeyboardStandIn(page, SCREEN - 60);
    await openConversation(page);

    await page.locator('[data-testid="chat-composer-dock"] textarea').focus();
    await keyboard(page, KEYBOARD, 72, true);

    await expect.poll(async () => (await geometry(page)).shellTop).toBe(0);
    await expect.poll(async () => (await geometry(page)).dockPadding).toBe("0px");
    expect((await geometry(page)).dockBottom).toBe(SCREEN - KEYBOARD);

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await keyboard(page, 0);
    await expect.poll(async () => (await geometry(page)).dockBottom).toBe(SCREEN - 60);
  });

  test("a phone browser that is not the installed app still lifts the composer by the keys' height", async ({
    page,
  }) => {
    await installKeyboardStandIn(page);
    await openConversation(page);

    await page.locator('[data-testid="chat-composer-dock"] textarea').focus();
    await keyboard(page, KEYBOARD);
    await expect
      .poll(async () => (await geometry(page)).dockPadding, {
        message: "the composer was not lifted",
      })
      .toBe(`${KEYBOARD}px`);
    const up = await geometry(page);
    expect(up.fitted, "the shell is fitted only in the installed app").toBe("");
    expect(up.token).toBe("100dvh");
  });
});
