import { expect, test, type Page } from "@playwright/test";
import {
  chat,
  membership,
  message,
  missingFunction,
  openFixture,
  person,
  requireFixtureServer,
  type Fixture,
  type Row,
} from "./helpers/messageActionsFixture";
import { RealtimeFixture } from "./helpers/realtime-fixture";

/**
 * Tracker item 54. A tester, 2026-09-28, with Telegram's topic list beside our
 * «Каналы»: «ты не видишь вот этих каналов в формате последнего сообщения… тебе
 * надо будет протыкивать каждый канал вручную». Each text channel now carries
 * Telegram's topic line — the author's first name, what they wrote, and when —
 * read once when the list is shown and kept current from the conversation's
 * own socket, which hears every channel of the server.
 */

const AT = "2026-09-28T09:00:00.000Z";
const ME = person("d8111111-1111-4111-8111-000000000001", "Максим Орлов");
const ANNA = person("d8111111-1111-4111-8111-000000000002", "Анна Смирнова");
const PETR = person("d8111111-1111-4111-8111-000000000003", "Пётр Ильин");
const TEAM = "d8222222-2222-4222-8222-000000000001";
const CAT = "d8333333-3333-4333-8333-000000000001";
const T_GENERAL = "d8444444-4444-4444-8444-000000000001";
const T_CHECKS = "d8444444-4444-4444-8444-000000000002";
const T_PHOTOS = "d8444444-4444-4444-8444-000000000003";

const TOPICS: Row[] = [
  { id: T_GENERAL, chat_id: TEAM, name: "Общий", emoji: null, is_general: true, position: 0, archived: false, category_id: null, created_at: AT, updated_at: AT, created_by: null },
  { id: T_CHECKS, chat_id: TEAM, name: "Чеки", emoji: null, is_general: false, position: 0, archived: false, category_id: CAT, created_at: AT, updated_at: AT, created_by: null },
  { id: T_PHOTOS, chat_id: TEAM, name: "Фото зала", emoji: null, is_general: false, position: 1, archived: false, category_id: CAT, created_at: AT, updated_at: AT, created_by: null },
];

const ROWS: Row[] = [
  message("d8666666-6666-4666-8666-000000000001", TEAM, ANNA, "Смена закрыта, касса сдана", "2026-09-28T08:15:00.000Z", { topic_id: T_CHECKS }),
  message("d8666666-6666-4666-8666-000000000002", TEAM, PETR, "", "2026-09-28T08:19:00.000Z", { topic_id: T_PHOTOS, type: "image" }),
  message("d8666666-6666-4666-8666-000000000003", TEAM, ME, "Всем доброе утро", "2026-09-28T09:00:00.000Z"),
];

/** The fixture of the last `open`, for the tests that read what was sent. */
let opened: Fixture | null = null;

async function open(page: Page, unread?: Row[]) {
  opened = await openFixture(page, {
    me: ME,
    people: [ANNA, PETR],
    chats: [{ ...chat(TEAM, "group", "CUBE. Минская", AT), is_forum: true }],
    memberships: [membership(TEAM, ME, "owner", AT), membership(TEAM, ANNA, "admin", AT), membership(TEAM, PETR, "member", AT)],
    messages: ROWS,
    rest: (call) => {
      if (call.method !== "GET") return undefined;
      if (call.resource === "chat_channel_categories") return { status: 200, body: [{ id: CAT, chat_id: TEAM, name: "Текстовые", position: 0, created_at: AT }] };
      if (call.resource === "topics") return { status: 200, body: TOPICS };
      if (call.resource === "voice_channels" || call.resource === "voice_participants") return { status: 200, body: [] };
      return undefined;
    },
    rpc: (name) => {
      if (name === "search_chat_messages") return missingFunction(name);
      // Each channel's unread count (item 54, the unread half); without one,
      // the database of before, which has no such function.
      if (name === "channel_unread_counts") return unread ? { body: unread } : missingFunction(name);
      if (name === "mark_channel_read") return { body: null };
      return undefined;
    },
  });
  // A channel's newest lines, read as the list asks for them: its own topic,
  // or for the general channel no topic or the general one.
  await page.route("**/rest/v1/messages*", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET" || url.searchParams.get("limit") !== "5") return route.fallback();
    const topic = url.searchParams.get("topic_id")?.replace(/^eq\./, "") ?? null;
    const or = url.searchParams.get("or");
    const hits = ROWS.filter((row) =>
      topic ? row.topic_id === topic : or ? row.topic_id === null || or.includes(String(row.topic_id)) : row.topic_id === null,
    ).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(hits) });
  });
  const realtime = new RealtimeFixture();
  await realtime.install(page);
  // The rows are dated 2026-09-28 and the time asserted below is today's
  // «ЧЧ:ММ»: unpinned, this spec went red on the 29th with nothing in the
  // product changed — «Вчера» where it expects a time. Pinned to the fixture's
  // own morning, as `jump-to-bottom.spec.ts` pins its own; timers keep running.
  await page.clock.setFixedTime(new Date("2026-09-28T10:00:00.000Z"));
  await page.goto(`/chat/${TEAM}`, { waitUntil: "domcontentloaded" });
  // A phone opens a server on its list by itself (item 54); a computer has the column.
  await expect(page.getByTestId("channel-rail-list")).toBeVisible();
  return realtime;
}

const row = (page: Page, channelId: string) => page.locator(`[data-testid="channel-rail-text"][data-channel-id="${channelId}"]`);

test.describe("a server's channels say what happened in them (item 54)", () => {
  test.beforeEach(async ({ request }) => {
    await requireFixtureServer(request);
  });

  test("each text channel shows who wrote last, what, and when", async ({ page }) => {
    await open(page);
    await expect(row(page, T_CHECKS).getByTestId("channel-rail-preview")).toHaveText("Анна: Смена закрыта, касса сдана");
    await expect(row(page, T_PHOTOS).getByTestId("channel-rail-preview")).toHaveText("Пётр: Фото");
    await expect(row(page, T_GENERAL).getByTestId("channel-rail-preview")).toHaveText("Вы: Всем доброе утро");
    await expect(row(page, T_CHECKS).getByTestId("channel-rail-preview-time")).toHaveText(/^\d{2}:\d{2}$/);
  });

  test("a message in another channel changes that channel's line without opening it", async ({ page }) => {
    const realtime = await open(page);
    await expect.poll(() => realtime.isJoined(`messages:chat:${TEAM}`)).toBe(true);
    await expect(row(page, T_CHECKS).getByTestId("channel-rail-preview")).toHaveText("Анна: Смена закрыта, касса сдана");
    const delivered = realtime.emit({
      type: "INSERT",
      table: "messages",
      record: {
        ...message("d8666666-6666-4666-8666-000000000009", TEAM, PETR, "Касса сверена", new Date().toISOString(), { topic_id: T_CHECKS }),
        sender: undefined,
      },
    });
    expect(delivered).toBeGreaterThan(0);
    await expect(row(page, T_CHECKS).getByTestId("channel-rail-preview")).toHaveText("Пётр: Касса сверена");
    // The channel on screen is still the one being read: nothing was opened.
    await expect(row(page, T_GENERAL)).toHaveAttribute("data-active", "true");
  });
});

test.describe("a server's channels say how much is unread in them (item 54)", () => {
  test.beforeEach(async ({ request }) => {
    await requireFixtureServer(request);
  });

  test("a count per channel, Telegram's, and none on the one being read", async ({ page }) => {
    const realtime = await open(page, [
      { channel: "general", unread: 4 },
      { channel: T_CHECKS, unread: 3 },
      { channel: T_PHOTOS, unread: 120 },
    ]);
    await expect(row(page, T_CHECKS).getByTestId("channel-rail-unread")).toHaveText("3");
    await expect(row(page, T_PHOTOS).getByTestId("channel-rail-unread")).toHaveText("99+");
    // The general channel is the one on screen: it is being read.
    await expect(row(page, T_GENERAL)).toHaveAttribute("data-active", "true");
    await expect(row(page, T_GENERAL).getByTestId("channel-rail-unread")).toHaveCount(0);

    // Somebody writes in «Чеки» while the reader is elsewhere: one more.
    await expect.poll(() => realtime.isJoined(`messages:chat:${TEAM}`)).toBe(true);
    realtime.emit({
      type: "INSERT",
      table: "messages",
      record: {
        ...message("d8666666-6666-4666-8666-000000000011", TEAM, ANNA, "Ещё чек", new Date().toISOString(), { topic_id: T_CHECKS }),
        sender: undefined,
      },
    });
    await expect(row(page, T_CHECKS).getByTestId("channel-rail-unread")).toHaveText("4");

    // Opening it reads it: the count goes, and its mark is sent.
    await row(page, T_CHECKS).click();
    if ((page.viewportSize()?.width ?? 0) < 768) await page.getByTestId("channel-rail-trigger").click().catch(() => undefined);
    await expect(row(page, T_CHECKS).getByTestId("channel-rail-unread")).toHaveCount(0);
    await expect
      .poll(() => opened!.rpcBodies("mark_channel_read").some((body) => body.p_channel === T_CHECKS && body.p_chat_id === TEAM))
      .toBe(true);
    // The other channel's count is its own.
    await expect(row(page, T_PHOTOS).getByTestId("channel-rail-unread")).toHaveText("99+");
  });

  test("a database without the counts draws the list as it was", async ({ page }) => {
    await open(page);
    await expect(row(page, T_CHECKS).getByTestId("channel-rail-preview")).toHaveText("Анна: Смена закрыта, касса сдана");
    await expect(page.getByTestId("channel-rail-unread")).toHaveCount(0);
  });
});
