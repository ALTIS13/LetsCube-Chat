import { expect, test, type Page } from "@playwright/test";

import {
  chat,
  clockTime,
  membership,
  message,
  missingFunction,
  openChat,
  openDesktopMenu,
  openFixture,
  openPhoneMenu,
  person,
  requireFixtureServer,
  type FixtureOptions,
  type RpcAnswer,
} from "./helpers/messageActionsFixture";

/**
 * «Прочитано» and «Кто прочитал» say when each person read this message.
 *
 * They used to show the reader's chat-wide read pointer, `last_read_at` — when
 * they last read anything in the chat, the same for every message they had
 * read. `message_read_times` (20260911141000) answers the sender with the time
 * each reader read this message, or with no time when there is none to show.
 * Where that function is not deployed, the pointer, as before, asked once.
 *
 * The times below are far enough apart that the message, its real read and the
 * pointer each print a different clock time.
 */

const ME = person("11111111-1111-4111-8111-1111111111e1", "Максим");
const ANYA = person("11111111-1111-4111-8111-1111111111e2", "Аня");
const BORIS = person("11111111-1111-4111-8111-1111111111e3", "Борис");
const VERA = person("11111111-1111-4111-8111-1111111111e4", "Вера");
const PRIVATE_CHAT = "22222222-2222-4222-8222-2222222222e1";
const GROUP_CHAT = "22222222-2222-4222-8222-2222222222e2";
const PRIVATE_MESSAGE = "55555555-5555-4555-8555-5555555555e1";
const GROUP_MESSAGE = "55555555-5555-4555-8555-5555555555e2";
const PRIVATE_TEXT = "Скинул отчёт в общую папку";
const GROUP_TEXT = "Созвон переносится на четыре";
const GROUP_NAME = "Команда проекта";

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const SENT = minutesAgo(40);
const EXACT = minutesAgo(31);
const POINTER = minutesAgo(8);

function privateChat(readTimes: RpcAnswer): FixtureOptions {
  return {
    me: ME,
    chats: [chat(PRIVATE_CHAT, "private", null, SENT)],
    memberships: [membership(PRIVATE_CHAT, ME, "owner", SENT), membership(PRIVATE_CHAT, ANYA, "member", POINTER)],
    messages: [message(PRIVATE_MESSAGE, PRIVATE_CHAT, ME, PRIVATE_TEXT, SENT)],
    rpc: (name) => (name === "message_read_times" ? readTimes : undefined),
  };
}

function groupChat(readTimes: RpcAnswer): FixtureOptions {
  return {
    me: ME,
    chats: [chat(GROUP_CHAT, "group", GROUP_NAME, SENT)],
    memberships: [
      membership(GROUP_CHAT, ME, "owner", SENT),
      membership(GROUP_CHAT, ANYA, "member", POINTER),
      membership(GROUP_CHAT, BORIS, "member", POINTER),
      membership(GROUP_CHAT, VERA, "member", null),
    ],
    messages: [message(GROUP_MESSAGE, GROUP_CHAT, ME, GROUP_TEXT, SENT)],
    rpc: (name) => (name === "message_read_times" ? readTimes : undefined),
  };
}

const anyaReadExactly: RpcAnswer = { body: [{ reader_id: ANYA.id, has_read: true, read_at: EXACT }] };
const anyaReadHidden: RpcAnswer = { body: [{ reader_id: ANYA.id, has_read: true, read_at: null }] };
const groupReads: RpcAnswer = {
  body: [
    { reader_id: ANYA.id, has_read: true, read_at: EXACT },
    { reader_id: BORIS.id, has_read: true, read_at: null },
    { reader_id: VERA.id, has_read: false, read_at: null },
  ],
};

async function times(page: Page) {
  return { exact: await clockTime(page, EXACT), pointer: await clockTime(page, POINTER) };
}

test.describe("on a desktop, the menu says when a message of yours was read", () => {
  test.use({ hasTouch: false, isMobile: false, viewport: { width: 1440, height: 900 } });
  test.beforeEach(async ({ request }) => {
    await requireFixtureServer(request);
  });

  test("a private chat names the moment the message was read, not the moment the chat was last read", async ({ page }) => {
    const fixture = await openFixture(page, privateChat(anyaReadExactly));
    const bubble = await openChat(page, ANYA.full_name, PRIVATE_TEXT);
    const { exact, pointer } = await times(page);
    const menu = await openDesktopMenu(page, bubble);
    await expect(menu.getByText(`Прочитано в ${exact}`, { exact: true })).toBeVisible();
    await expect(menu).not.toContainText(pointer);
    expect(fixture.rpcBodies("message_read_times")[0]).toEqual({ p_message_id: PRIVATE_MESSAGE });
  });

  test("a group's readers each show the time they read the message", async ({ page }) => {
    await openFixture(page, groupChat(groupReads));
    const bubble = await openChat(page, GROUP_NAME, GROUP_TEXT);
    const { exact, pointer } = await times(page);
    const menu = await openDesktopMenu(page, bubble);
    await menu.locator('[data-message-menu-readers="true"]').click();
    const readers = page.locator('[data-message-readers="true"]');
    const anya = readers.locator("li").filter({ hasText: ANYA.full_name });
    await expect(anya).toContainText(exact);
    await expect(anya).not.toContainText(pointer);
    const boris = readers.locator("li").filter({ hasText: BORIS.full_name });
    await expect(boris).toBeVisible();
    await expect(boris, "a reader who hides their time was given one").not.toContainText(/\d{2}:\d{2}/);
    await expect(readers.locator("li").filter({ hasText: VERA.full_name })).toHaveCount(0);
  });

  test("a read time that is not shown leaves the message read, without a time", async ({ page }) => {
    const fixture = await openFixture(page, privateChat(anyaReadHidden));
    const bubble = await openChat(page, ANYA.full_name, PRIVATE_TEXT);
    const menu = await openDesktopMenu(page, bubble);
    await expect.poll(() => fixture.rpcBodies("message_read_times").length, { message: "the read times were never asked for" }).toBeGreaterThan(0);
    await page.waitForTimeout(300);
    await expect(menu.getByText(/^Прочитано/)).toHaveText("Прочитано");
  });

  test("where the server has no read times, the menu shows the chat's read time as before, and asks only once", async ({ page }) => {
    const fixture = await openFixture(page, privateChat(missingFunction("message_read_times")));
    const bubble = await openChat(page, ANYA.full_name, PRIVATE_TEXT);
    const { pointer } = await times(page);
    let menu = await openDesktopMenu(page, bubble);
    await expect(menu.getByText(`Прочитано в ${pointer}`, { exact: true })).toBeVisible();
    await expect.poll(() => fixture.rpcBodies("message_read_times").length).toBe(1);

    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    menu = await openDesktopMenu(page, bubble);
    await expect(menu.getByText(`Прочитано в ${pointer}`, { exact: true })).toBeVisible();
    await page.waitForTimeout(500);
    expect(fixture.rpcBodies("message_read_times"), "a function the server lacks was asked for again").toHaveLength(1);
  });
});

test.describe("on a phone, the details say when a message of yours was read", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  test.beforeEach(async ({ request, browserName }) => {
    test.skip(browserName !== "chromium", "the taps go through Chromium's own touch pipeline");
    await requireFixtureServer(request);
  });

  test("a private message's details show when it was read", async ({ page }) => {
    await openFixture(page, privateChat(anyaReadExactly));
    const bubble = await openChat(page, ANYA.full_name, PRIVATE_TEXT);
    const { exact, pointer } = await times(page);
    const card = await openPhoneMenu(page, bubble);
    await card.locator('[data-message-action="details"]').click();
    const details = page.locator('[data-message-details="true"]');
    await expect(details).toContainText("Прочитано");
    await expect(details).toContainText(exact);
    await expect(details).not.toContainText(pointer);
  });

  test("a group message's details list each reader with the time they read it", async ({ page }) => {
    await openFixture(page, groupChat(groupReads));
    const bubble = await openChat(page, GROUP_NAME, GROUP_TEXT);
    const { exact, pointer } = await times(page);
    const card = await openPhoneMenu(page, bubble);
    await card.locator('[data-message-action="details"]').click();
    const anya = page.locator('[data-message-readers="true"] li').filter({ hasText: ANYA.full_name });
    await expect(anya).toContainText(exact);
    await expect(anya).not.toContainText(pointer);
    await expect(page.locator('[data-message-menu-view="details"]')).toContainText("Кто прочитал · 2 из 3");
  });

  test("a read time that is not shown says so", async ({ page }) => {
    await openFixture(page, privateChat(anyaReadHidden));
    const bubble = await openChat(page, ANYA.full_name, PRIVATE_TEXT);
    const { pointer } = await times(page);
    const card = await openPhoneMenu(page, bubble);
    await card.locator('[data-message-action="details"]').click();
    const details = page.locator('[data-message-details="true"]');
    await expect(details).toContainText("Время не показывается");
    await expect(details).not.toContainText(pointer);
  });
});
