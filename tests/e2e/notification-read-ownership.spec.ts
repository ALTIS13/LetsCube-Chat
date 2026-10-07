import { expect, test } from "@playwright/test";
import { openFixture, person, requireFixtureServer } from "./helpers/messageActionsFixture";

const A = person("64111111-1111-4111-8111-000000000041", "Участник проверки", "read_qa");
const B = person("64111111-1111-4111-8111-000000000042", "Другой участник", "read_other");
const CHAT = "64111111-1111-4111-8111-000000000043";
const FIRST = "2026-10-07T09:00:01.000Z";
const SECOND = "2026-10-07T09:00:02.000Z";
const ACK = "2026-10-07T09:00:03.000Z";

test.use({ screenshot: "off", trace: "off", video: "off", serviceWorkers: "block" });
test.beforeEach(async ({ request }) => {
  expect(process.env.KUB_QA_ALLOW_MUTATIONS).toBe("0");
  await requireFixtureServer(request);
});

test("mounted notification centre keeps messages beyond the confirmed read horizon unread", async ({ page }) => {
  const rows = [1, 2].map(index => ({
    id: `64111111-1111-4111-8111-00000000004${index + 3}`,
    user_id: A.id, kind: "message", read_at: null as string | null,
    created_at: index === 1 ? SECOND : FIRST,
    payload: { chat_id: CHAT, message_id: `64111111-1111-4111-8111-00000000005${index}`,
      sender_kind: "user", sender_id: B.id, sender_name: B.full_name,
      chat_name: "Проверка чтения", text: `Тестовое сообщение ${index}` },
  }));
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.name));
  const fixture = await openFixture(page, {
    me: A, people: [B], chats: [], memberships: [], messages: [],
    rest: call => call.resource === "notifications" && call.method === "GET"
      ? { status: 200, body: rows.map(row => ({ ...row })) } : undefined,
    rpc: (name, args) => {
      if (name === "notifications_mark_chat_messages_read") {
        expect(args).toMatchObject({ p_chat_id: CHAT, p_read_until: FIRST });
        rows[0].read_at = ACK;
        return { body: null };
      }
      if (name === "notifications_mark_all_read") {
        for (const row of rows) row.read_at = ACK;
        return { body: null };
      }
      return undefined;
    },
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("notification-bell-button").click();
  const group = page.getByTestId("notification-message-group");
  await expect(group).toContainText("2 новых сообщений");
  await page.evaluate(({ chatId, readUntil }) => {
    window.dispatchEvent(new CustomEvent("kub:chat-notifications-read", { detail: { chatId, readUntil } }));
  }, { chatId: CHAT, readUntil: FIRST });
  await expect.poll(() => fixture.rpcBodies("notifications_mark_chat_messages_read").length).toBe(1);
  await expect(group).not.toContainText("2 новых сообщений");
  await expect(group).not.toContainText("Прочитано");
  expect(rows[1].read_at).toBeNull();
  await page.getByTestId("notification-panel").getByRole("button", { name: "Прочитать", exact: true }).click();
  await expect(group).toContainText("Прочитано");
  expect(errors).toEqual([]);
});
