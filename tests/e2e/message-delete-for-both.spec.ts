import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  chat,
  membership,
  message,
  missingFunction,
  openChat,
  openDesktopMenu,
  openFixture,
  person,
  requireFixtureServer,
  type Fixture,
  type FixtureOptions,
  type RpcAnswer,
} from "./helpers/messageActionsFixture";

/**
 * Delete for both, as Telegram does it — the owner's decision of 2026-09-11.
 *
 * In a private chat either person may delete any message for both, and it
 * leaves no trace: no «Сообщение удалено». A group deletes only your own
 * messages for everyone and keeps the placeholder. Both go through
 * `delete_messages_for_everyone` (20260911143000). Where that function is not
 * deployed, what the dialog did before: your own messages for everyone,
 * someone else's hidden for you — and the dialog stops offering the choice for
 * someone else's.
 */

const ME = person("11111111-1111-4111-8111-1111111111c1", "Максим");
const ANYA = person("11111111-1111-4111-8111-1111111111c2", "Аня");
const BORIS = person("11111111-1111-4111-8111-1111111111c3", "Борис");
const PRIVATE_CHAT = "22222222-2222-4222-8222-2222222222c1";
const GROUP_CHAT = "22222222-2222-4222-8222-2222222222c2";
const ANYA_MESSAGE = "55555555-5555-4555-8555-5555555555c1";
const MY_PRIVATE_MESSAGE = "55555555-5555-4555-8555-5555555555c2";
const ANYA_SECOND_MESSAGE = "55555555-5555-4555-8555-5555555555c3";
const MY_GROUP_MESSAGE = "55555555-5555-4555-8555-5555555555c4";
const ANYA_TEXT = "Удали, пожалуйста, это сообщение";
const MY_TEXT = "Хорошо, договорились";
const ANYA_SECOND_TEXT = "И вот это тоже";
const GROUP_TEXT = "Ошибся чатом, простите";
const GROUP_NAME = "Команда";
const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

function privateChat(deleteAnswer: (ids: unknown) => RpcAnswer | undefined): FixtureOptions {
  return {
    me: ME,
    chats: [chat(PRIVATE_CHAT, "private", null, at(5))],
    memberships: [membership(PRIVATE_CHAT, ME, "owner", at(1)), membership(PRIVATE_CHAT, ANYA, "member", at(1))],
    messages: [
      message(ANYA_MESSAGE, PRIVATE_CHAT, ANYA, ANYA_TEXT, at(9)),
      message(MY_PRIVATE_MESSAGE, PRIVATE_CHAT, ME, MY_TEXT, at(8)),
      message(ANYA_SECOND_MESSAGE, PRIVATE_CHAT, ANYA, ANYA_SECOND_TEXT, at(7)),
    ],
    rpc: (name, body) => (name === "delete_messages_for_everyone" ? deleteAnswer(body.p_message_ids) : undefined),
  };
}

const deleted = (ids: unknown): RpcAnswer => ({ body: ids });

async function openDeleteDialog(page: Page, bubble: Locator): Promise<Locator> {
  const menu = await openDesktopMenu(page, bubble);
  await menu.locator('[data-message-action="delete"]').click();
  const dialog = page.getByRole("dialog").filter({ hasText: "Удалить сообщение?" });
  await expect(dialog).toBeVisible();
  return dialog;
}

function bubbleWith(page: Page, text: string): Locator {
  return page.locator('[data-message-bubble="true"]').filter({ hasText: text });
}

function requested(fixture: Fixture, name: string) {
  return fixture.rpcBodies(name);
}

test.describe("delete for both", () => {
  test.use({ hasTouch: false, isMobile: false, viewport: { width: 1440, height: 900 } });
  test.beforeEach(async ({ request }) => {
    await requireFixtureServer(request);
  });

  test("in a private chat, the other person's message can be deleted for both, and leaves no trace", async ({ page }) => {
    const fixture = await openFixture(page, privateChat(deleted));
    const bubble = await openChat(page, ANYA.full_name, ANYA_TEXT);
    const dialog = await openDeleteDialog(page, bubble);
    await expect(dialog.getByText("Также удалить для Аня", { exact: true })).toBeVisible();
    await dialog.getByTestId("message-delete-for-everyone").check();
    await dialog.getByTestId("message-delete-confirm").click();

    await expect(dialog).toHaveCount(0);
    await expect(bubbleWith(page, ANYA_TEXT)).toHaveCount(0);
    await expect(page.getByText("Сообщение удалено")).toHaveCount(0);
    await expect(bubbleWith(page, MY_TEXT), "the rest of the conversation went with it").toBeVisible();
    expect(requested(fixture, "delete_messages_for_everyone")).toEqual([{ p_message_ids: [ANYA_MESSAGE] }]);
    expect(requested(fixture, "hide_message_for_me")).toEqual([]);
  });

  test("in a private chat, your own message deleted for both leaves no trace either", async ({ page }) => {
    const fixture = await openFixture(page, privateChat(deleted));
    const bubble = await openChat(page, ANYA.full_name, MY_TEXT);
    const dialog = await openDeleteDialog(page, bubble);
    await dialog.getByTestId("message-delete-for-everyone").check();
    await dialog.getByTestId("message-delete-confirm").click();

    await expect(bubbleWith(page, MY_TEXT)).toHaveCount(0);
    await expect(page.getByText("Сообщение удалено")).toHaveCount(0);
    expect(requested(fixture, "delete_messages_for_everyone")).toEqual([{ p_message_ids: [MY_PRIVATE_MESSAGE] }]);
    expect(fixture.restCalls("messages", "PATCH"), "the message was deleted with a table update").toEqual([]);
  });

  test("left unticked, the other person's message is hidden for you only", async ({ page }) => {
    const fixture = await openFixture(page, privateChat(deleted));
    const bubble = await openChat(page, ANYA.full_name, ANYA_TEXT);
    const dialog = await openDeleteDialog(page, bubble);
    await dialog.getByTestId("message-delete-confirm").click();

    await expect(bubbleWith(page, ANYA_TEXT)).toHaveCount(0);
    expect(requested(fixture, "hide_message_for_me")).toEqual([{ p_message_id: ANYA_MESSAGE }]);
    expect(requested(fixture, "delete_messages_for_everyone")).toEqual([]);
  });

  test("in a group, your own message deleted for everyone keeps its placeholder", async ({ page }) => {
    const fixture = await openFixture(page, {
      me: ME,
      chats: [chat(GROUP_CHAT, "group", GROUP_NAME, at(5))],
      memberships: [membership(GROUP_CHAT, ME, "member", at(1)), membership(GROUP_CHAT, BORIS, "owner", at(1))],
      messages: [message(MY_GROUP_MESSAGE, GROUP_CHAT, ME, GROUP_TEXT, at(6))],
      rpc: (name, body) => (name === "delete_messages_for_everyone" ? deleted(body.p_message_ids) : undefined),
    });
    const bubble = await openChat(page, GROUP_NAME, GROUP_TEXT);
    const dialog = await openDeleteDialog(page, bubble);
    await expect(dialog.getByText("Удалить у всех", { exact: true })).toBeVisible();
    await dialog.getByTestId("message-delete-for-everyone").check();
    await dialog.getByTestId("message-delete-confirm").click();

    await expect(bubbleWith(page, GROUP_TEXT)).toHaveCount(0);
    await expect(page.getByText("Сообщение удалено")).toBeVisible();
    expect(requested(fixture, "delete_messages_for_everyone")).toEqual([{ p_message_ids: [MY_GROUP_MESSAGE] }]);
  });

  test("where the server has no delete for both, the other person's message is hidden for you, and the choice is not offered again", async ({ page }) => {
    const fixture = await openFixture(page, privateChat(() => missingFunction("delete_messages_for_everyone")));
    const bubble = await openChat(page, ANYA.full_name, ANYA_TEXT);
    const dialog = await openDeleteDialog(page, bubble);
    await dialog.getByTestId("message-delete-for-everyone").check();
    await dialog.getByTestId("message-delete-confirm").click();

    await expect(bubbleWith(page, ANYA_TEXT)).toHaveCount(0);
    expect(requested(fixture, "delete_messages_for_everyone")).toHaveLength(1);
    await expect.poll(() => requested(fixture, "hide_message_for_me")).toEqual([{ p_message_id: ANYA_MESSAGE }]);

    const second = await openDeleteDialog(page, bubbleWith(page, ANYA_SECOND_TEXT));
    await expect(second.getByTestId("message-delete-for-everyone"), "the dialog offered what the server cannot do").toHaveCount(0);
    await second.getByRole("button", { name: "Отмена" }).click();
    expect(requested(fixture, "delete_messages_for_everyone"), "a function the server lacks was asked for again").toHaveLength(1);
  });
});
