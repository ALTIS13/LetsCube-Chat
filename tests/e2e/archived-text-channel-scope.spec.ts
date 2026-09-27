import { expect, test } from "@playwright/test";
import {
  FIXTURE_HOST,
  chat,
  membership,
  message,
  openChat,
  openFixture,
  person,
  requireFixtureServer,
  type Row,
} from "./helpers/messageActionsFixture";

test.use({ screenshot: "off", video: "off", trace: "off" });

const AT = "2026-09-27T09:00:00.000Z";
const MEMBER = person("11111111-1111-4111-8111-0000000000a2", "Участник группы");
const CHAT_ID = "22222222-2222-4222-8222-0000000000b1";
const TOPIC_ID = "44444444-4444-4444-8444-0000000000d1";
const GROUP_NAME = "Группа с архивным каналом";
const GENERAL_TEXT = "Сообщение в Общих";
const ARCHIVED_TEXT = "Сохранённое сообщение архивного канала";

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

test("archiving the last text channel never shows its retained messages in General", async ({ page }) => {
  const generalMessage = message("66666666-6666-4666-8666-000000000001", CHAT_ID, MEMBER, GENERAL_TEXT, AT);
  const archivedMessage = message("66666666-6666-4666-8666-000000000002", CHAT_ID, MEMBER, ARCHIVED_TEXT, AT, {
    topic_id: TOPIC_ID,
  });
  const archivedTopic: Row = {
    id: TOPIC_ID,
    chat_id: CHAT_ID,
    name: "Планы",
    emoji: null,
    is_general: false,
    archived: true,
    position: 0,
    category_id: null,
    created_at: AT,
    updated_at: AT,
    created_by: MEMBER.id,
  };
  await openFixture(page, {
    me: MEMBER,
    chats: [chat(CHAT_ID, "group", GROUP_NAME, AT)],
    memberships: [membership(CHAT_ID, MEMBER, "member", AT)],
    messages: [generalMessage, archivedMessage],
    rest: ({ resource, method }) => {
      if (method === "GET" && ["chat_channel_categories", "voice_channels", "voice_participants"].includes(resource)) {
        return { status: 200, body: [] };
      }
      return undefined;
    },
  });

  // The database applies the archived predicate. Returning the archived row
  // to an active-only query would make this test pass for the wrong reason.
  const topicReads: { archived: string | null; count: number }[] = [];
  await page.route(
    (url) => url.origin === FIXTURE_HOST && url.pathname === "/rest/v1/topics",
    async (route) => {
      const url = new URL(route.request().url());
      const rows = url.searchParams.get("archived") === "eq.false" ? [] : [archivedTopic];
      topicReads.push({ archived: url.searchParams.get("archived"), count: rows.length });
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
    },
  );
  const historyQueries: string[] = [];
  await page.route(
    (url) => url.origin === FIXTURE_HOST && url.pathname === "/rest/v1/messages",
    async (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() !== "GET" || !url.searchParams.get("order")?.includes("id.desc")) {
        await route.fallback();
        return;
      }
      historyQueries.push(url.search);
      const topicFilter = url.searchParams.get("topic_id");
      const rows = topicFilter === "is.null"
        ? [generalMessage]
        : topicFilter === `eq.${TOPIC_ID}`
          ? [archivedMessage]
          : [archivedMessage, generalMessage];
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
    },
  );

  const topicsResponse = page.waitForResponse((response) =>
    response.url().startsWith(`${FIXTURE_HOST}/rest/v1/topics?`) && response.status() === 200,
  );
  await openChat(page, GROUP_NAME, GENERAL_TEXT);
  await topicsResponse;
  await page.waitForLoadState("networkidle");

  expect(topicReads.some((read) => read.archived === null && read.count === 1), JSON.stringify(topicReads)).toBe(true);
  expect(historyQueries.length).toBeGreaterThan(0);
  expect(historyQueries.every((search) => new URLSearchParams(search).get("topic_id") === "is.null"),
    JSON.stringify(historyQueries.map((search) => new URLSearchParams(search).get("topic_id")))).toBe(true);
  await expect(page.locator('[data-message-bubble="true"]').filter({ hasText: GENERAL_TEXT })).toBeVisible();
  await expect(page.locator('[data-message-bubble="true"]').filter({ hasText: ARCHIVED_TEXT })).toHaveCount(0);
  await expect(page.locator(`[data-testid="channel-rail-text"][data-channel-id="${TOPIC_ID}"]`)).toHaveCount(0);
});
