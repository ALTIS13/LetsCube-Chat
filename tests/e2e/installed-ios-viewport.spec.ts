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
 * product's half — fitting the paintable screen at rest even when 100vh is
 * taller, not mistaking a short visual viewport alone for a keyboard, fitting
 * the keyboard when present, and preserving the home-indicator inset.
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
async function installKeyboardStandIn(page: Page, initialVisibleHeight?: number, initialLayoutHeight?: number) {
  await page.addInitScript(({ visibleHeight, layoutHeight }) => {
    const events = new EventTarget();
    // Init scripts run before the mobile viewport meta tag is parsed. Read the
    // settled layout height lazily unless a shorter iOS viewport was requested.
    const nativeInnerHeight = Object.getOwnPropertyDescriptor(window, "innerHeight");
    if (layoutHeight != null) {
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        get: () => layoutHeight,
      });
    }
    const state: { height: number | null; width: number | null; offsetTop: number; layoutHeight: number | null } = {
      height: visibleHeight ?? null,
      width: null,
      offsetTop: 0,
      layoutHeight: null,
    };
    const viewport = {
      get width() {
        return state.width ?? window.innerWidth;
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
        __rotateKeyboard: (width: number, visibleHeight: number, offsetTop: number) => void;
      }
    ).__keyboard = (height: number, offsetTop = 0, shrinkLayout = false) => {
      state.layoutHeight ??= window.innerHeight;
      state.height = height ? state.layoutHeight - height : (visibleHeight ?? null);
      if (shrinkLayout) {
        Object.defineProperty(window, "innerHeight", {
          configurable: true,
          get: () => state.height ?? state.layoutHeight,
        });
      } else if (layoutHeight != null) {
        Object.defineProperty(window, "innerHeight", {
          configurable: true,
          get: () => layoutHeight,
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
    (
      window as unknown as {
        __rotateKeyboard: (width: number, visibleHeight: number, offsetTop: number) => void;
      }
    ).__rotateKeyboard = (width: number, visibleHeight: number, offsetTop: number) => {
      state.width = width;
      state.height = visibleHeight;
      state.offsetTop = offsetTop;
      Object.defineProperty(window, "innerHeight", { configurable: true, get: () => visibleHeight });
      document.body.style.position = offsetTop ? "relative" : "";
      document.body.style.top = offsetTop ? `${-offsetTop}px` : "";
      events.dispatchEvent(new Event("resize"));
      events.dispatchEvent(new Event("scroll"));
    };
  }, { visibleHeight: initialVisibleHeight, layoutHeight: initialLayoutHeight });
}

async function openConversation(page: Page, theme: "light" | "dark" = "dark") {
  const now = new Date().toISOString();
  await openFixture(page, {
    me: ME,
    theme,
    chats: [chat(CHAT_ID, "private", null, now)],
    memberships: [membership(CHAT_ID, ME, "owner", now), membership(CHAT_ID, ANYA, "member", now)],
    messages: history(),
  });
  await openChat(page, ANYA.full_name, LATEST);
  await page.waitForTimeout(800);
}

async function openChatList(page: Page, theme: "light" | "dark" = "dark") {
  const now = new Date().toISOString();
  await openFixture(page, {
    me: ME,
    theme,
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

test.use({
  viewport: { width: 430, height: SCREEN },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  screenshot: "off",
  trace: "off",
  video: "off",
});

test.describe("the installed iPhone app's shell and keyboard", () => {
  test.beforeEach(async ({ request }) => {
    await requireFixtureServer(request);
  });

  test("the installed iPhone shell is fitted before the React entry executes", async ({ page }) => {
    const paintableHeight = SCREEN - 59;
    await emulateInstalledIosApp(page, INSETS);
    await installKeyboardStandIn(page, paintableHeight, paintableHeight);
    let blockedEntry = 0;
    await page.route(/\/src\/main\.tsx(?:\?.*)?$/, (route) => {
      blockedEntry += 1;
      return route.abort("blockedbyclient");
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    expect(blockedEntry, "the React entry must be blocked to test pre-hydration").toBeGreaterThan(0);
    await expect(page.locator("html[data-ios-standalone]")).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--kub-app-height"))).toBe(
      `${paintableHeight}px`,
    );
    await expect(page.locator("#root")).toBeEmpty();
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
    ).toBe(`${SCREEN}px`);
  });

  test("a public page without a chat fills the installed app even when visualViewport is short", async ({
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
      .toBe(SCREEN);
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

  test("a shorter visual viewport does not leave a band under the standalone composer", async ({
    page,
  }) => {
    await emulateInstalledIosApp(page, INSETS);
    await installKeyboardStandIn(page, SCREEN - 60);
    await openConversation(page);

    await expect.poll(async () => (await geometry(page)).shellHeight).toBe(SCREEN);
    const rest = await geometry(page);
    expect(rest.dockBottom, "the composer's dock reaches the standalone screen edge").toBe(SCREEN);
    expect(rest.dockPadding, "the home indicator still has its own padding").toBe(
      `${INSETS.bottom}px`,
    );
  });

  for (const theme of ["light", "dark"] as const) {
    test(`a short iOS paintable viewport keeps the ${theme} list and composer above the clipped edge`, async ({ page }, testInfo) => {
      const paintableHeight = SCREEN - 59;
      await page.setViewportSize({ width: 390, height: SCREEN });
      await emulateInstalledIosApp(page, INSETS);
      // iOS 26 can expose 100vh as the full 932 pt screen while both innerHeight
      // and visualViewport stop at 873 pt. The lower 59 pt are not paintable DOM.
      await installKeyboardStandIn(page, paintableHeight, paintableHeight);
      await openChatList(page, theme);
      await expect(page.locator(`html.${theme}`)).toHaveCount(1);
      const conversation = page.getByTestId("chat-list-item").filter({ hasText: ANYA.full_name });
      await expect(conversation).toBeVisible();

      // Model the system-owned lower strip as an overlay: unlike ordinary DOM,
      // it blocks hit testing and cannot be painted by the application.
      await page.evaluate((height) => {
        const strip = document.createElement("div");
        strip.dataset.testid = "ios-system-strip-fixture";
        strip.style.cssText = `position:fixed;inset:auto 0 0;height:${height}px;background:#e8eff7;z-index:2147483647`;
        document.body.appendChild(strip);
      }, SCREEN - paintableHeight);

      const list = await geometry(page);
      const cssVh = await page.evaluate(() => {
        const probe = document.createElement("div");
        probe.style.height = "100vh";
        document.body.appendChild(probe);
        const height = Math.round(probe.getBoundingClientRect().height);
        probe.remove();
        return height;
      });
      expect(cssVh, "the fixture must really have a taller CSS 100vh").toBe(SCREEN);
      expect(list.visualHeight).toBe(paintableHeight);
      expect(list.shellHeight, "the shell must fit the paintable canvas").toBe(paintableHeight);
      expect(list.navBottom, "all navigation stays above the clipped edge").toBeLessThanOrEqual(paintableHeight);
      expect(await page.getByRole("navigation", { name: "Навигация" }).locator("button").first().evaluate((button) => {
        const rect = button.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return hit === button || button.contains(hit);
      }), "a navigation tab remains tappable").toBe(true);
      if (process.env.KUB_CAPTURE_IOS_VIEWPORT === "1") {
        await page.screenshot({ path: testInfo.outputPath(`${theme}-list.png`) });
      }

      await conversation.click();
      await expect(page.locator('[data-message-bubble="true"]').filter({ hasText: LATEST })).toBeVisible();
      expect((await geometry(page)).dockBottom, "the composer stays inside the paintable canvas").toBe(paintableHeight);
      const attach = await page.getByRole("button", { name: "Прикрепить" }).boundingBox();
      expect(attach?.y).toBeGreaterThanOrEqual(0);
      expect(attach!.y + attach!.height, "the attachment control clears the strip").toBeLessThanOrEqual(paintableHeight);
      if (process.env.KUB_CAPTURE_IOS_VIEWPORT === "1") {
        await page.screenshot({ path: testInfo.outputPath(`${theme}-chat.png`) });
      }

      await page.locator('[data-testid="chat-composer-dock"] textarea').focus();
      await keyboard(page, KEYBOARD);
      await expect.poll(async () => (await geometry(page)).dockBottom).toBe(paintableHeight - KEYBOARD);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await keyboard(page, 0);
      await expect.poll(async () => (await geometry(page)).dockBottom).toBe(paintableHeight);
    });
  }

  test("an attachment's send controls stay tappable above the clipped edge and keyboard", async ({ page }, testInfo) => {
    const paintableHeight = SCREEN - 59;
    await emulateInstalledIosApp(page, INSETS);
    await installKeyboardStandIn(page, paintableHeight, paintableHeight);
    await openConversation(page);

    await page.evaluate((height) => {
      const strip = document.createElement("div");
      strip.dataset.testid = "ios-system-strip-fixture";
      strip.style.cssText = `position:fixed;inset:auto 0 0;height:${height}px;background:#e8eff7;z-index:2147483647`;
      document.body.appendChild(strip);
    }, SCREEN - paintableHeight);

    await page.getByRole("button", { name: "Прикрепить" }).click();
    const sheet = page.getByTestId("attach-sheet");
    await expect(sheet).toBeVisible();
    const chooser = page.waitForEvent("filechooser");
    await sheet.locator('[data-attach-entry="library"]').click();
    await (await chooser).setFiles({
      name: "fixture-pixel.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9F9E0SQAAAABJRU5ErkJggg==",
        "base64",
      ),
    });

    const send = sheet.getByTestId("attach-send");
    const hd = sheet.getByTestId("attach-hd");
    await expect(send).toBeVisible();
    await expect(hd).toBeVisible();

    const readAction = (action: typeof send) => action.evaluate((button) => {
      const rect = button.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return { bottom: rect.bottom, tappable: hit === button || button.contains(hit) };
    });
    await page.waitForTimeout(400);
    const atRest = { send: await readAction(send), hd: await readAction(hd) };
    const restingSheetBottom = await sheet.evaluate((node) => node.getBoundingClientRect().bottom);
    if (process.env.KUB_CAPTURE_IOS_VIEWPORT === "1") {
      await page.screenshot({ path: testInfo.outputPath("attach-rest.png") });
    }

    await sheet.getByTestId("attach-caption").focus();
    await keyboard(page, KEYBOARD, 0, true);
    await page.evaluate((top) => {
      const keyboardBlocker = document.createElement("div");
      keyboardBlocker.dataset.testid = "ios-keyboard-fixture";
      keyboardBlocker.style.cssText = `position:fixed;inset:${top}px 0 0;background:#d8dce2;z-index:2147483647`;
      document.body.appendChild(keyboardBlocker);
    }, paintableHeight - KEYBOARD);
    await expect.poll(async () => (await geometry(page)).shellHeight).toBe(paintableHeight - KEYBOARD);
    await page.waitForTimeout(400);
    const withKeyboard = { send: await readAction(send), hd: await readAction(hd) };
    const keyboardSheetBottom = await sheet.evaluate((node) => node.getBoundingClientRect().bottom);
    if (process.env.KUB_CAPTURE_IOS_VIEWPORT === "1") {
      await page.screenshot({ path: testInfo.outputPath("attach-keyboard.png") });
    }

    for (const [state, edge, label] of [
      [atRest, paintableHeight, "at rest"],
      [withKeyboard, paintableHeight - KEYBOARD, "with keyboard"],
    ] as const) {
      for (const [name, action] of Object.entries(state)) {
        expect.soft(action.bottom, `${name} stays fully above the blocked edge ${label}`).toBeLessThanOrEqual(edge);
        expect.soft(action.tappable, `${name} receives a touch ${label}`).toBe(true);
      }
    }
    expect(restingSheetBottom, "the sheet clears the home indicator at rest").toBeLessThanOrEqual(paintableHeight - 34);
    expect(keyboardSheetBottom, "the home-indicator gap must not remain above the keyboard").toBeGreaterThanOrEqual(paintableHeight - KEYBOARD - 12);
  });

  test("an attachment does not double-compensate when fixed already anchors to the paintable edge", async ({ page }) => {
    const paintableHeight = SCREEN - 59;
    await emulateInstalledIosApp(page, INSETS);
    await installKeyboardStandIn(page, paintableHeight, paintableHeight);
    await openConversation(page);
    // A transformed root gives fixed descendants the shorter containing block,
    // while CSS 100vh still reflects the full 932px layout viewport.
    await page.addStyleTag({ content: `html { height: ${paintableHeight}px !important; transform: translateZ(0) !important; }` });
    const anchor = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.cssText = "position:fixed;bottom:0;left:0;width:0;height:0";
      document.body.appendChild(probe);
      const bottom = probe.getBoundingClientRect().bottom;
      probe.remove();
      window.dispatchEvent(new Event("resize"));
      return bottom;
    });
    expect(anchor, "the fixture's fixed anchor really is the short viewport").toBeCloseTo(paintableHeight, 0);
    await page.getByRole("button", { name: "Прикрепить" }).click();
    const sheet = page.getByTestId("attach-sheet");
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(400);
    const bottom = await sheet.evaluate((node) => node.getBoundingClientRect().bottom);
    expect(bottom, "the resting sheet retains only the home-indicator inset").toBeGreaterThanOrEqual(paintableHeight - 50);
    expect(bottom).toBeLessThanOrEqual(paintableHeight - 34);

    await keyboard(page, KEYBOARD, 0, false);
    await expect.poll(async () => (await geometry(page)).shellHeight).toBe(paintableHeight - KEYBOARD);
    await expect.poll(async () => sheet.evaluate((node) => node.getBoundingClientRect().bottom)).toBeGreaterThanOrEqual(paintableHeight - KEYBOARD - 12);
    const keyboardBottom = await sheet.evaluate((node) => node.getBoundingClientRect().bottom);
    expect(keyboardBottom, "the sheet follows the shorter keyboard canvas, not CSS 100vh").toBeGreaterThanOrEqual(paintableHeight - KEYBOARD - 12);
    expect(keyboardBottom).toBeLessThanOrEqual(paintableHeight - KEYBOARD);
  });

  test("an attachment in a browser tab does not inherit the installed-app fixed offset", async ({ page }) => {
    await openConversation(page);
    await expect(page.locator("html[data-ios-standalone]")).toHaveCount(0);
    // Browser toolbars can shorten 100dvh without moving fixed's bottom anchor.
    await page.evaluate(() => document.documentElement.style.setProperty("--kub-paintable-height", "873px"));
    await page.getByRole("button", { name: "Прикрепить" }).click();
    const sheet = page.getByTestId("attach-sheet");
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(400);
    const { bottom, inset } = await sheet.evaluate((node) => ({
      bottom: node.getBoundingClientRect().bottom,
      inset: Number.parseFloat(getComputedStyle(node).bottom),
    }));
    expect(inset, "browser tabs use the original fixed-sheet inset").toBeCloseTo(8, 0);
    expect(bottom).toBeCloseTo(SCREEN - 8, 0);
  });

  test("the standalone chat keeps readable hierarchy and generous primary touch targets", async ({
    page,
  }) => {
    await emulateInstalledIosApp(page, INSETS);
    await installKeyboardStandIn(page, SCREEN - 60);
    await openConversation(page);

    const heading = page
      .getByTestId("chat-header-info-button")
      .getByText(ANYA.full_name, { exact: true });
    expect(await heading.evaluate((element) => getComputedStyle(element).fontSize)).toBe("17px");
    for (const name of ["Назад", "Ещё", "Прикрепить", "Эмодзи", "Голосовое"]) {
      const box = await page.getByRole("button", { name, exact: true }).boundingBox();
      expect(box?.width, `${name} touch width`).toBeGreaterThanOrEqual(48);
      expect(box?.height, `${name} touch height`).toBeGreaterThanOrEqual(48);
    }
    const messageBody = page
      .locator('[data-message-bubble="true"] .kub-message-text')
      .filter({ hasText: LATEST });
    expect(
      await messageBody.first().evaluate((element) => getComputedStyle(element).fontSize),
    ).toBe("16px");
  });

  test("the standalone chat list uses phone-readable title and preview sizes", async ({ page }) => {
    await emulateInstalledIosApp(page, INSETS);
    await installKeyboardStandIn(page, SCREEN - 60);
    await openChatList(page);

    const row = page.getByTestId("chat-list-item").filter({ hasText: ANYA.full_name });
    const title = row.getByText(ANYA.full_name, { exact: true });
    const preview = row.getByText(LATEST, { exact: true });
    expect(await title.evaluate((element) => getComputedStyle(element).fontSize)).toBe("16px");
    expect(await preview.evaluate((element) => getComputedStyle(element).fontSize)).toBe("14px");
    const bounds = await row.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(430);
  });

  test("the standalone chat list keeps its type scale in narrow landscape", async ({ page }) => {
    await page.setViewportSize({ width: 667, height: 375 });
    await emulateInstalledIosApp(page, { top: 0, right: 59, bottom: 21, left: 59 });
    await installKeyboardStandIn(page);
    await openChatList(page);

    const row = page.getByTestId("chat-list-item").filter({ hasText: ANYA.full_name });
    const title = row.getByText(ANYA.full_name, { exact: true });
    const preview = row.getByText(LATEST, { exact: true });
    expect(await title.evaluate((element) => getComputedStyle(element).fontSize)).toBe("16px");
    expect(await preview.evaluate((element) => getComputedStyle(element).fontSize)).toBe("14px");
    expect(await preview.evaluate((element) => getComputedStyle(element).lineHeight)).toBe("20px");
  });

  test("larger standalone controls keep the composer usable on a narrow phone", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 693 });
    await emulateInstalledIosApp(page, INSETS);
    await installKeyboardStandIn(page);
    await openConversation(page);

    const attach = await page.getByRole("button", { name: "Прикрепить" }).boundingBox();
    const recorder = await page.getByRole("button", { name: "Голосовое" }).boundingBox();
    const field = await page.locator('[data-testid="chat-composer-dock"] textarea').boundingBox();
    expect(attach).not.toBeNull();
    expect(recorder).not.toBeNull();
    expect(field).not.toBeNull();
    expect(field!.width, "the field still accepts a legible short message").toBeGreaterThanOrEqual(
      100,
    );
    expect(attach!.x).toBeGreaterThanOrEqual(0);
    expect(recorder!.x + recorder!.width).toBeLessThanOrEqual(320);
    expect(field!.x + field!.width).toBeLessThan(recorder!.x);
  });

  test("the chat list fills the installed-app screen despite a shorter visual viewport", async ({
    page,
  }) => {
    await emulateInstalledIosApp(page, INSETS);
    await installKeyboardStandIn(page, SCREEN - 60);
    await openChatList(page);

    const rest = await geometry(page);
    expect(rest.visualHeight).toBe(SCREEN - 60);
    expect(rest.shellHeight, "the list shell fills the standalone screen").toBe(SCREEN);
    expect(rest.navTop, "the navigation capsule remains on screen").toBeGreaterThanOrEqual(0);
    expect(rest.navBottom, "no tab is cut by the home indicator").toBeLessThanOrEqual(SCREEN);

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
    await expect.poll(async () => (await geometry(page)).shellHeight).toBe(SCREEN);
    expect((await geometry(page)).navBottom).toBeLessThanOrEqual(SCREEN);
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
    await expect.poll(async () => (await geometry(page)).shellHeight).toBe(SCREEN);
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

  test("rotation with an open keyboard keeps the panned chat header visible", async ({ page }) => {
    await emulateInstalledIosApp(page, INSETS);
    await installKeyboardStandIn(page);
    await openConversation(page);

    await page.locator('[data-testid="chat-composer-dock"] textarea').focus();
    await keyboard(page, KEYBOARD, 72, true);
    await expect.poll(async () => (await geometry(page)).shellTop).toBe(0);

    // One iOS resize can change width and keyboard-shrunken inner/visual height
    // together. The new height must not be learned as an idle baseline.
    await page.evaluate(() => (
      window as unknown as { __rotateKeyboard: (width: number, height: number, top: number) => void }
    ).__rotateKeyboard(932, 210, 72));
    await expect.poll(async () => (await geometry(page)).shellTop).toBe(0);
    expect((await geometry(page)).dockBottom).toBe(210);

    await page.locator('[data-testid="chat-composer-dock"] textarea').blur();
    await page.evaluate(() => (
      window as unknown as { __rotateKeyboard: (width: number, height: number, top: number) => void }
    ).__rotateKeyboard(932, 430, 0));
    await expect.poll(async () => (await geometry(page)).shellTop).toBe(0);
    await expect.poll(async () => (await geometry(page)).dockBottom).toBe(430);
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
    await expect.poll(async () => (await geometry(page)).dockBottom).toBe(SCREEN);
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
    expect(
      await page
        .getByTestId("chat-header-info-button")
        .getByText(ANYA.full_name, { exact: true })
        .evaluate((element) => getComputedStyle(element).fontSize),
    ).toBe("15px");
  });

  for (const theme of ["light", "dark"] as const) {
    test(`the ${theme} desktop shell keeps its 1440px chat layout`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await openConversation(page, theme);
      await expect(page.locator(`html.${theme}`)).toHaveCount(1);
      await expect(page.getByRole("navigation", { name: "Навигация" })).toBeHidden();
      const desktop = await geometry(page);
      expect(desktop.token).toBe("100dvh");
      expect(desktop.shellHeight).toBe(900);
      expect(desktop.dockBottom).toBe(900);
      if (process.env.KUB_CAPTURE_IOS_VIEWPORT === "1") {
        await page.screenshot({ path: testInfo.outputPath(`${theme}-desktop.png`) });
      }
    });
  }
});
