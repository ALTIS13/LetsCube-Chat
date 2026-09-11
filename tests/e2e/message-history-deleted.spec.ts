import { expect, test, type Page } from "@playwright/test";

import {
  chat,
  membership,
  message,
  openChat,
  openFixture,
  person,
  requireFixtureServer,
  type Fixture,
  type Row,
} from "./helpers/messageActionsFixture";

/**
 * A private chat draws no deleted message (D-102), so its pages must not be made
 * of them.
 *
 * Measured on production on 2026-09-11, after the delete for both was taken in:
 * the latest page of a private chat held 98 deleted messages of 100. The
 * conversation drew two, it could not scroll, and older history was never asked
 * for, because a scroll to the top is what asks — the signed-in history-prepend
 * check of `visual-style-layout` failed on exactly that (D-108).
 */

const ME = person("11111111-1111-4111-8111-1111111111a1", "Максим");
const ANYA = person("11111111-1111-4111-8111-1111111111a2", "Аня");
const PRIVATE_CHAT = "22222222-2222-4222-8222-2222222222a1";
const GROUP_CHAT = "22222222-2222-4222-8222-2222222222a2";
const GROUP_NAME = "Команда";
const LATEST_TEXT = "Последнее, что осталось";
/** The page size `useMessages` asks for: a hundred, and one to know there is more. */
const PAGE_LIMIT = "101";

/**
 * Three hundred messages, oldest first: two hundred kept, then a hundred of
 * which only two are not deleted — the shape measured on production.
 */
function history(chatId: string, marker: string): Row[] {
  const start = Date.now() - 400 * 60_000;
  const deletedAt = new Date(start + 350 * 60_000).toISOString();
  return Array.from({ length: 300 }, (_, index) => {
    const kept = index < 200 || index === 250 || index === 299;
    return message(
      `55555555-5555-4555-8555-${marker}${String(index).padStart(11, "0")}`,
      chatId,
      index % 2 ? ME : ANYA,
      index === 299 ? LATEST_TEXT : `Сообщение ${index + 1}`,
      new Date(start + index * 60_000).toISOString(),
      kept ? {} : { deleted_at: deletedAt },
    );
  });
}

function pageRequests(fixture: Fixture, chatId: string): URLSearchParams[] {
  return fixture
    .restCalls("messages", "GET")
    .map((call) => new URLSearchParams(call.search))
    .filter((params) => params.get("chat_id") === `eq.${chatId}` && params.get("limit") === PAGE_LIMIT);
}

function bubbles(page: Page) {
  return page.locator('[data-message-bubble="true"]');
}

test.describe("the history of a chat with deleted messages", () => {
  test.use({ hasTouch: false, isMobile: false, viewport: { width: 1440, height: 900 } });
  test.beforeEach(async ({ request }) => {
    await requireFixtureServer(request);
  });

  test("a private chat asks for pages without deleted messages, fills the view, and loads older history", async ({ page }) => {
    const now = new Date().toISOString();
    const fixture = await openFixture(page, {
      me: ME,
      chats: [chat(PRIVATE_CHAT, "private", null, now)],
      memberships: [membership(PRIVATE_CHAT, ME, "owner", now), membership(PRIVATE_CHAT, ANYA, "member", now)],
      messages: history(PRIVATE_CHAT, "1"),
    });
    await openChat(page, ANYA.full_name, LATEST_TEXT);

    await expect.poll(() => pageRequests(fixture, PRIVATE_CHAT).length).toBeGreaterThan(0);
    expect(
      pageRequests(fixture, PRIVATE_CHAT).map((params) => params.get("deleted_at")),
      "a private chat asked for the deleted messages it does not draw",
    ).toEqual(pageRequests(fixture, PRIVATE_CHAT).map(() => "is.null"));

    const container = page.getByTestId("message-scroll-container");
    await expect(container).toHaveAttribute("data-has-more-older", "true");
    const overflow = await container.evaluate((node) => node.scrollHeight - node.clientHeight);
    expect(overflow, `the first page drew ${await bubbles(page).count()} messages and did not fill the view`).toBeGreaterThan(240);
    const firstPage = await bubbles(page).count();

    await expect
      .poll(
        async () => {
          await container.evaluate((node) => {
            node.scrollTop = 0;
            node.dispatchEvent(new Event("scroll", { bubbles: true }));
          });
          return bubbles(page).count();
        },
        { message: "a scroll to the top never brought older history", timeout: 15_000 },
      )
      .toBeGreaterThan(firstPage);
    const older = pageRequests(fixture, PRIVATE_CHAT).filter((params) => (params.get("created_at") ?? "").startsWith("lt."));
    expect(older.length, "no older page was asked for").toBeGreaterThan(0);
    expect(older.map((params) => params.get("deleted_at")), "an older page asked for deleted messages").toEqual(older.map(() => "is.null"));
  });

  test("a group still asks for its deleted messages, and draws their placeholders", async ({ page }) => {
    const now = new Date().toISOString();
    const fixture = await openFixture(page, {
      me: ME,
      chats: [chat(GROUP_CHAT, "group", GROUP_NAME, now)],
      memberships: [membership(GROUP_CHAT, ME, "owner", now), membership(GROUP_CHAT, ANYA, "member", now)],
      messages: history(GROUP_CHAT, "2"),
    });
    await openChat(page, GROUP_NAME, LATEST_TEXT);

    await expect.poll(() => pageRequests(fixture, GROUP_CHAT).length).toBeGreaterThan(0);
    expect(
      pageRequests(fixture, GROUP_CHAT).some((params) => params.has("deleted_at")),
      "a group left its deleted messages out of the page",
    ).toBe(false);
    await expect(page.getByText("Сообщение удалено").first()).toBeVisible();
  });
});
