import { expect, test, type Page } from "@playwright/test";

import { emulateInstalledIosApp, type Insets } from "./helpers/ios-standalone";
import {
  chat,
  membership,
  message,
  openChat,
  openFixture,
  person,
  requireFixtureServer,
  type Row,
} from "./helpers/messageActionsFixture";

/**
 * D-111: the installed iPhone app's shell and keyboard.
 *
 * On a tester's iPhone 15 Pro Max the installed app left a band of about 60pt
 * under the composer from its first frame, which stayed after the app was opened
 * again, and with the keyboard up the chat header went off the top of the
 * screen. Neither engine here is iOS. Chromium plays the installed app's flag and
 * its insets, and a stand-in for `visualViewport` plays the keyboard as iOS does:
 * what is visible shrinks and the page does not. What these checks hold is the
 * product's half — the shell's height token, the shell fitted to what is visible
 * while the keys are up, and the height given back when they go.
 */

const INSETS: Insets = { top: 59, right: 0, bottom: 34, left: 0 };
const SCREEN = 932;
const KEYBOARD = 336;
const ME = person("11111111-1111-4111-8111-1111111111f1", "Максим");
const ANYA = person("11111111-1111-4111-8111-1111111111f2", "Аня");
const CHAT_ID = "22222222-2222-4222-8222-2222222222f1";
const LATEST = "Последнее сообщение";

function history(): Row[] {
  return Array.from({ length: 30 }, (_, index) => message(
    `55555555-5555-4555-8555-7${String(index).padStart(11, "0")}`,
    CHAT_ID,
    index % 2 ? ME : ANYA,
    index === 29 ? LATEST : `Сообщение ${index + 1}`,
    new Date(Date.now() - (30 - index) * 60_000).toISOString(),
  ));
}

/** A `visualViewport` the test moves, as iOS moves the real one for its keyboard. */
async function installKeyboardStandIn(page: Page) {
  await page.addInitScript(() => {
    const events = new EventTarget();
    const state = { height: window.innerHeight, offsetTop: 0 };
    const viewport = {
      get width() { return window.innerWidth; },
      get height() { return state.height; },
      get offsetTop() { return state.offsetTop; },
      get offsetLeft() { return 0; },
      get pageTop() { return state.offsetTop + window.scrollY; },
      get pageLeft() { return window.scrollX; },
      scale: 1,
      onresize: null,
      onscroll: null,
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      dispatchEvent: events.dispatchEvent.bind(events),
    };
    Object.defineProperty(window, "visualViewport", { configurable: true, get: () => viewport });
    (window as unknown as { __keyboard: (height: number) => void }).__keyboard = (height: number) => {
      state.height = window.innerHeight - height;
      events.dispatchEvent(new Event("resize"));
    };
  });
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

function keyboard(page: Page, height: number) {
  return page.evaluate((value) => (window as unknown as { __keyboard: (h: number) => void }).__keyboard(value), height);
}

function geometry(page: Page) {
  return page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>('[data-testid="desktop-app-shell"]')?.parentElement ?? null;
    const dock = document.querySelector<HTMLElement>('[data-testid="chat-composer-dock"]');
    const header = document.querySelector<HTMLElement>('[data-testid="chat-control-row"]');
    return {
      token: getComputedStyle(document.documentElement).getPropertyValue("--kub-app-height").trim(),
      fitted: document.documentElement.style.getPropertyValue("--kub-app-height"),
      shellHeight: shell ? Math.round(shell.getBoundingClientRect().height) : null,
      dockBottom: dock ? Math.round(dock.getBoundingClientRect().bottom) : null,
      dockPadding: dock ? getComputedStyle(dock).paddingBottom : null,
      headerTop: header ? Math.round(header.getBoundingClientRect().top) : null,
    };
  });
}

test.describe("the installed iPhone app's shell and keyboard", () => {
  test.use({ viewport: { width: 430, height: SCREEN }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  test.beforeEach(async ({ request }) => {
    await requireFixtureServer(request);
  });

  test("the shell is as tall as the screen, and with the keys up it fits what is visible", async ({ page }) => {
    await emulateInstalledIosApp(page, INSETS);
    await installKeyboardStandIn(page);
    await openConversation(page);

    const rest = await geometry(page);
    expect(rest.token, "the installed app's shell height").toBe("100vh");
    expect(rest.shellHeight, "the shell is as tall as the screen").toBe(SCREEN);
    expect(rest.dockBottom, "the composer's dock reaches the bottom edge").toBe(SCREEN);
    expect(rest.dockPadding, "at rest the composer pads for the home indicator").toBe(`${INSETS.bottom}px`);

    await page.locator('[data-testid="chat-composer-dock"] textarea').focus();
    await keyboard(page, KEYBOARD);
    await expect.poll(async () => (await geometry(page)).fitted, { message: "the shell was not fitted to the keys" }).toBe(`${SCREEN - KEYBOARD}px`);
    const up = await geometry(page);
    expect(up.shellHeight, "the shell fits what the keys leave visible").toBe(SCREEN - KEYBOARD);
    expect(up.dockBottom, "the composer sits on the keys").toBe(SCREEN - KEYBOARD);
    expect(up.headerTop, "the chat header stays on screen").toBeGreaterThanOrEqual(0);
    // The dock's padding eases over 150ms, so it is read once it has come to rest.
    await expect
      .poll(async () => (await geometry(page)).dockPadding, { message: "something still pads for the home indicator under the keys" })
      .toBe("0px");

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await keyboard(page, 0);
    await expect.poll(async () => (await geometry(page)).fitted, { message: "the shell's height was not given back" }).toBe("");
    expect((await geometry(page)).shellHeight, "the shell is as tall as the screen again").toBe(SCREEN);
    await expect
      .poll(async () => (await geometry(page)).dockPadding, { message: "the home indicator's padding did not come back" })
      .toBe(`${INSETS.bottom}px`);
  });

  test("a phone browser that is not the installed app still lifts the composer by the keys' height", async ({ page }) => {
    await installKeyboardStandIn(page);
    await openConversation(page);

    await page.locator('[data-testid="chat-composer-dock"] textarea').focus();
    await keyboard(page, KEYBOARD);
    await expect.poll(async () => (await geometry(page)).dockPadding, { message: "the composer was not lifted" }).toBe(`${KEYBOARD}px`);
    const up = await geometry(page);
    expect(up.fitted, "the shell is fitted only in the installed app").toBe("");
    expect(up.token).toBe("100dvh");
  });
});
