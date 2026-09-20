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
 * The conversation's address (queue item 35, first piece).
 *
 * One promise, stated as an equality rather than as a behaviour: **entering a
 * conversation through its URL lands exactly where entering it through a click
 * lands.** The same message at the top, the same unread divider, the same
 * jump-to-bottom control. Anything that differs between the two routes is the
 * defect — the point of an address is that a reload stops costing anything, and
 * a reload that returns you to the right conversation at the wrong place is
 * half a promise, which reads as a fault rather than as a feature.
 *
 * That equality is reachable for us and not for Discord, and the reason is
 * where the fact lives. Their reading position is a client fact that dies with
 * the page, so their cold boot lands at the bottom with a banner; ours comes
 * from `chat.unread_count` and `chat_members.last_read_at`, read from the
 * database on every boot (`ChatWindow.tsx:691`), so the divider is as available
 * after a reload as before one. Section 9 of
 * `docs/operations/reference-clients.md` carries both cases with their grades.
 *
 * The fixture is the mocked backend the message-action specs already use, so
 * this runs against the real `MainLayout`, the real `useChats` and the real
 * `MessageList` with nothing stubbed inside the application.
 */

const CHAT_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const READ_AT = "2026-09-01T09:20:00.000Z";
const ME = person("11111111-1111-4111-8111-111111111111", "Максим", "maksim");
const ANYA = person("22222222-2222-4222-8222-222222222222", "Аня", "anya");

/** Forty messages, the last eight of them arriving after the read boundary. */
const MESSAGES = Array.from({ length: 40 }, (_, index) => {
  const minute = String(index).padStart(2, "0");
  const sender = index % 2 === 0 ? ANYA : ME;
  return message(
    `msg-${minute}`,
    CHAT_ID,
    index >= 32 ? ANYA : sender,
    `Строка ${minute} — достаточно длинный текст, чтобы занять несколько строк пузыря.`,
    `2026-09-01T09:${minute}:00.000Z`,
  );
});

const FIRST_UNREAD_ID = "msg-32";
const LAST_MESSAGE_TEXT = "Строка 39";
const CHAT_NAME = "Команда проекта";

async function installBackend(page: Page) {
  await openFixture(page, {
    me: ME,
    chats: [chat(CHAT_ID, "group", CHAT_NAME, "2026-09-01T09:39:00.000Z")],
    memberships: [
      membership(CHAT_ID, ME, "member", READ_AT),
      membership(CHAT_ID, ANYA, "member", null),
    ],
    messages: MESSAGES,
  });
}

/**
 * Where the conversation is standing, in the terms a reader would use.
 *
 * Not a scroll offset: a pixel differs between two loads for reasons that are
 * nobody's fault — a font arriving a frame later, a picture measured twice. The
 * message a reader's eye lands on does not, and neither does whether the
 * divider and the jump control are on screen. So the signature is what is
 * *visible*, and it is taken from the scroller's own coordinates.
 */
async function landing(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  // The entry scroll settles over several frames and holds a bottom lock for a
  // moment afterwards; `MessageList` documents both. Reading before it finishes
  // would compare two moments rather than two routes.
  await page.waitForTimeout(1500);
  return page.evaluate(() => {
    const scroller = document.querySelector('[data-testid="message-scroll-container"]');
    if (!scroller) return { error: "no scroller" };
    const frame = scroller.getBoundingClientRect();
    const rows = Array.from(document.querySelectorAll<HTMLElement>("[data-message-id]"));
    const visible = rows.filter((row) => {
      const box = row.getBoundingClientRect();
      return box.bottom > frame.top + 1 && box.top < frame.bottom - 1;
    });
    const separator = document.querySelector('[data-testid="first-unread-separator"]');
    const separatorBox = separator?.getBoundingClientRect() ?? null;
    return {
      topMessageId: visible[0]?.getAttribute("data-message-id") ?? null,
      lastMessageId: visible[visible.length - 1]?.getAttribute("data-message-id") ?? null,
      separatorOnScreen: Boolean(
        separatorBox && separatorBox.bottom > frame.top && separatorBox.top < frame.bottom,
      ),
      jumpControl: Boolean(document.querySelector('button[aria-label="К последним сообщениям"]')),
      atBottom: Math.abs(
        (scroller as HTMLElement).scrollHeight
          - (scroller as HTMLElement).scrollTop
          - (scroller as HTMLElement).clientHeight,
      ) < 120,
    };
  });
}

test.describe("the conversation's address", () => {
  test.beforeEach(async ({ request }) => {
    await requireFixtureServer(request);
  });

  test("a click writes the address, and reloading it lands in the same place", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installBackend(page);

    // Entering by a click, which is the behaviour the address has to carry.
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const row = page.getByTestId("chat-list-item").filter({ hasText: CHAT_NAME });
    await expect(row).toBeVisible();
    await row.click();
    await expect(page.locator(`[data-message-id="${FIRST_UNREAD_ID}"]`)).toBeVisible();

    // The address the click wrote. Before this existed the URL stayed at `/`
    // and a reload landed on the chat list.
    await expect(page).toHaveURL(new RegExp(`/chat/${CHAT_ID}$`));
    const byClick = await landing(page);
    expect(byClick, "the conversation did not render").not.toHaveProperty("error");
    expect(byClick.separatorOnScreen, "entering by a click did not show the unread divider").toBe(true);

    // The same URL, from nothing: no store, no history, no chat list loaded.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(`[data-message-id="${FIRST_UNREAD_ID}"]`)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/chat/${CHAT_ID}$`));
    const byAddress = await landing(page);

    expect(byAddress, "a reload landed somewhere else than the click did").toEqual(byClick);
  });

  test("a conversation with nothing unread opens at the end, by either route", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openFixture(page, {
      me: ME,
      chats: [chat(CHAT_ID, "group", CHAT_NAME, "2026-09-01T09:39:00.000Z")],
      // Read past the last message: the other half of the entry contract, and
      // the half a divider-shaped fix would quietly break.
      memberships: [
        membership(CHAT_ID, ME, "member", "2026-09-01T10:00:00.000Z"),
        membership(CHAT_ID, ANYA, "member", null),
      ],
      messages: MESSAGES,
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    const row = page.getByTestId("chat-list-item").filter({ hasText: CHAT_NAME });
    await expect(row).toBeVisible();
    await row.click();
    await expect(page.getByText(LAST_MESSAGE_TEXT, { exact: false }).first()).toBeVisible();
    const byClick = await landing(page);
    expect(byClick.atBottom, "a fully read conversation did not open at the end").toBe(true);
    expect(byClick.separatorOnScreen).toBe(false);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText(LAST_MESSAGE_TEXT, { exact: false }).first()).toBeVisible();
    const byAddress = await landing(page);

    expect(byAddress, "a reload landed somewhere else than the click did").toEqual(byClick);
  });

  test("the address survives the conversation being left and re-entered", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installBackend(page);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/$/);
    const row = page.getByTestId("chat-list-item").filter({ hasText: CHAT_NAME });
    await row.click();
    await expect(page).toHaveURL(new RegExp(`/chat/${CHAT_ID}$`));

    // The header's way out, which on a phone is the only one. It clears the
    // selection; the address has to follow rather than be left behind.
    await page.getByRole("button", { name: "Назад" }).first().click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("chat-list-item").filter({ hasText: CHAT_NAME })).toBeVisible();

    // And Back goes into the conversation again, which is what an address is
    // for. Both reference clients push a history entry per conversation.
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/chat/${CHAT_ID}$`));
    await expect(page.locator(`[data-message-id="${FIRST_UNREAD_ID}"]`)).toBeVisible();
  });
});
