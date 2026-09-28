import { expect, test } from "@playwright/test";
import {
  chat,
  membership,
  message,
  openFixture,
  person,
  requireFixtureServer,
} from "./helpers/messageActionsFixture";

/**
 * D-103: a message deleted for everyone keeps the recipients' notifications and
 * loses their words — the database sets `preview` null and `deleted` true. The
 * bell says «Сообщение удалено» in both of its shapes: a single card, and a
 * chat's messages grouped into one entry.
 */

const AT = "2026-09-28T09:00:00.000Z";
const ME = person("c8111111-1111-4111-8111-000000000001", "Максим Орлов");
const ANNA = person("c8111111-1111-4111-8111-000000000002", "Анна Смирнова");
const TEAM = "c8222222-2222-4222-8222-000000000001";
const OTHER = "c8222222-2222-4222-8222-000000000002";

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

const notice = (id: string, chatId: string, messageId: string, over: Record<string, unknown>, createdAt: string) => ({
  id,
  user_id: ME.id,
  kind: "message",
  payload: {
    chat_id: chatId,
    message_id: messageId,
    sender_kind: "user",
    sender_id: ANNA.id,
    bot_id: null,
    sender_name: ANNA.full_name,
    chat_name: chatId === TEAM ? "Команда" : "Склад",
    chat_type: "group",
    message_type: "text",
    ...over,
  },
  read_at: null,
  created_at: createdAt,
});

test("a deleted message's notification says it was deleted, alone and in a group", async ({ page }) => {
  await openFixture(page, {
    me: ME,
    people: [ANNA],
    chats: [chat(TEAM, "group", "Команда", AT), chat(OTHER, "group", "Склад", AT)],
    memberships: [
      membership(TEAM, ME, "owner", AT), membership(TEAM, ANNA, "member", AT),
      membership(OTHER, ME, "owner", AT), membership(OTHER, ANNA, "member", AT),
    ],
    messages: [message("c8666666-6666-4666-8666-000000000009", TEAM, ANNA, "Привет", AT)],
  });
  await page.route("http://127.0.0.1:54321/rest/v1/notifications**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        // Alone in its chat: a single card.
        notice("c8777777-7777-4777-8777-000000000001", OTHER, "c8666666-6666-4666-8666-000000000001",
          { preview: null, deleted: true }, "2026-09-28T10:05:00.000Z"),
        // The newest of two in its chat: the grouped entry shows its line.
        notice("c8777777-7777-4777-8777-000000000002", TEAM, "c8666666-6666-4666-8666-000000000002",
          { preview: null, deleted: true }, "2026-09-28T10:04:00.000Z"),
        notice("c8777777-7777-4777-8777-000000000003", TEAM, "c8666666-6666-4666-8666-000000000003",
          { preview: "Смета во вложении" }, "2026-09-28T10:03:00.000Z"),
      ]),
    }),
  );
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("notification-bell-button").click();
  const panel = page.getByTestId("notification-panel");
  await expect(panel).toBeVisible();
  // Each entry is a button named by what it shows: the chat, then the line.
  const single = panel.getByRole("button", { name: /^Склад / });
  const grouped = panel.getByRole("button", { name: /^Команда .*новых сообщений/ });
  await expect(single).toContainText("Анна Смирнова: Сообщение удалено");
  await expect(grouped).toContainText("Анна Смирнова: Сообщение удалено");
  await expect(panel, "a deleted message read as the generic word").not.toContainText(/Анна Смирнова: Сообщение(?! удалено)/);
});
