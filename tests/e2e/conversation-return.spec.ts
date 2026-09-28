import { expect, test, type Page } from "@playwright/test";
import {
  chat,
  membership,
  message,
  missingFunction,
  openFixture,
  person,
  requireFixtureServer,
  type Row,
} from "./helpers/messageActionsFixture";
import { RealtimeFixture } from "./helpers/realtime-fixture";

/**
 * Coming back to a conversation left a moment ago (tracker item 58, D-322).
 *
 * The tester, 2026-09-28: «я вот из чата с тобой захожу в другой, потом
 * возвращаюсь к тебе и секунду жду прогрузки, а зачем? Если кэш существует».
 * Measured on this fixture with every read slowed to 1.5 s: the held rows were
 * drawn after 3.4 s — the «cleared for me» mark, and then the hidden ids, two
 * round trips in a row, before anything that was already in memory appeared.
 * The two checks stay — a history cleared, or a message hidden, on another
 * device must not flash from the held copy (`chat-cleared-at-reuse.spec`) —
 * but they are asked together now: one round trip.
 *
 * And D-322, found while measuring it: a message deleted for both while its
 * private chat was closed came back on the return and stayed until a reload.
 */

const AT = "2026-09-28T09:00:00.000Z";
const ME = person("cb111111-1111-4111-8111-000000000001", "Максим Орлов");
const ANNA = person("cb111111-1111-4111-8111-000000000002", "Анна Смирнова");
const BORIS = person("cb111111-1111-4111-8111-000000000003", "Борис Ковалёв");
const A = "cb222222-2222-4222-8222-000000000001";
const B = "cb222222-2222-4222-8222-000000000002";

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

/** How many pings reached a hides channel: the live test waits for one before measuring. */
let pingsDelivered = 0;

async function boot(page: Page, realtime?: RealtimeFixture) {
  const messages: Row[] = [];
  for (let i = 0; i < 12; i += 1) {
    messages.push(
      message(
        `cb555555-5555-4555-8555-${String(i).padStart(12, "0")}`,
        A,
        i % 2 ? ANNA : ME,
        `Строка А ${i + 1}`,
        new Date(Date.parse(AT) - (12 - i) * 60_000).toISOString(),
      ),
    );
  }
  messages.push(message("cb666666-6666-4666-8666-000000000001", B, BORIS, "Строка Б", AT));
  await openFixture(page, {
    me: ME,
    people: [ANNA, BORIS],
    chats: [chat(A, "private", null, AT), chat(B, "private", null, AT)],
    memberships: [
      membership(A, ME, "owner", AT),
      membership(A, ANNA, "member", AT),
      membership(B, ME, "owner", AT),
      membership(B, BORIS, "member", AT),
    ],
    messages,
    rpc: (name) => {
      if (name === "search_chat_messages") return missingFunction(name);
      // The database answers the ping on this account's own topic (item 58).
      if (name === "hides_live_ping" && realtime) {
        setTimeout(() => {
          pingsDelivered += realtime.broadcast("hides:", "ping", { ping: true });
        }, 30);
        return { body: null };
      }
      return undefined;
    },
  });
  if (realtime) await realtime.install(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  return messages;
}

const rowOf = (page: Page, name: string) => page.getByTestId("chat-list-item").filter({ hasText: name });
const bubble = (page: Page, text: string) => page.locator('[data-message-bubble="true"]').filter({ hasText: text });

async function backToList(page: Page) {
  if ((page.viewportSize()?.width ?? 0) < 768) await page.getByTestId("chat-control-row").getByLabel("Назад").click();
}

/** Anna's chat, then Boris's, then — the thing measured — Anna's again. */
async function visitAndLeave(page: Page) {
  await rowOf(page, "Анна").click();
  await expect(bubble(page, "Строка А 12")).toBeVisible();
  await backToList(page);
  await rowOf(page, "Борис").click();
  await expect(bubble(page, "Строка Б")).toBeVisible();
  // Past the clear mark's three seconds of reuse, as a person switching back
  // after reading the other chat is.
  await page.waitForTimeout(3_500);
  await backToList(page);
}

test("coming back asks its two checks together, not one after the other", async ({ page }) => {
  await boot(page);
  await visitAndLeave(page);

  const started = new Map<string, number>();
  await page.route("**/rest/v1/**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      const url = new URL(request.url());
      const resource = url.pathname.replace("/rest/v1/", "");
      const key = resource === "chat_members" && url.searchParams.get("select") === "cleared_at" ? "mark" : resource;
      if (!started.has(key)) started.set(key, Date.now());
      await new Promise((resolve) => setTimeout(resolve, 1_500));
    }
    await route.fallback();
  });

  const clicked = Date.now();
  await rowOf(page, "Анна").click();
  await bubble(page, "Строка А 12").waitFor({ state: "visible", timeout: 10_000 });
  const painted = Date.now() - clicked;

  const mark = started.get("mark");
  const hidden = started.get("message_hidden_for_users");
  expect(mark, "the clear mark was not read again").toBeDefined();
  expect(hidden, "the hidden ids were not asked").toBeDefined();
  // In flight together: the second did not wait for the first to answer.
  expect(Math.abs(mark! - hidden!), `mark at ${mark! - clicked} ms, hidden ids at ${hidden! - clicked} ms`).toBeLessThan(700);
  // One slowed round trip and the drawing, not two.
  expect(painted, `the held rows were drawn after ${painted} ms`).toBeLessThan(2_700);
});

test("a message deleted for both while its private chat was closed does not come back", async ({ page }) => {
  const messages = await boot(page);
  await rowOf(page, "Анна").click();
  await expect(bubble(page, "Строка А 8")).toBeVisible();
  await backToList(page);
  await rowOf(page, "Борис").click();
  await expect(bubble(page, "Строка Б")).toBeVisible();

  // Anna deletes «Строка А 8» for both while this reader is in Boris's chat.
  const deleted = messages.find((row) => row.content === "Строка А 8")!;
  deleted.deleted_at = new Date().toISOString();

  await backToList(page);
  await rowOf(page, "Анна").click();
  await expect(bubble(page, "Строка А 12")).toBeVisible();
  // The return's own read is what proves it gone: the held copy must not
  // outlive it.
  await expect(bubble(page, "Строка А 8")).toHaveCount(0, { timeout: 8_000 });
  await expect(bubble(page, "Строка А 7")).toBeVisible();
});

test("with this account's hides heard live, coming back draws at once and a hide made elsewhere is heard", async ({ page }) => {
  // Tracker item 58, the last round trip. The account's hides are broadcast
  // on its own private topic, so once that channel is proved live — its own
  // ping came back through it — the rows held need no hidden-ids read before
  // they are drawn.
  const realtime = new RealtimeFixture();
  const messages = await boot(page, realtime);
  await expect.poll(() => realtime.isJoined("hides:")).toBe(true);
  await expect.poll(() => pingsDelivered, { message: "the ping never came back" }).toBeGreaterThan(0);
  await visitAndLeave(page);
  // Every hidden-ids read slowed well past the bar below: a return that
  // waited for one could not meet it.
  await page.route("**/rest/v1/message_hidden_for_users**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await route.fallback();
  });
  const clicked = Date.now();
  await rowOf(page, "Анна").click();
  await bubble(page, "Строка А 12").waitFor({ state: "visible", timeout: 10_000 });
  const painted = Date.now() - clicked;
  expect(painted, `the held rows waited ${painted} ms for a read the channel made needless`).toBeLessThan(1_000);

  // A line hidden «for me» on the reader's phone: heard, and gone.
  const target = messages.find((row) => row.content === "Строка А 11")!;
  // By its exact line: a bubble's text runs into its time, so «Строка А 1»
  // sent at 11:47 also contains «Строка А 11».
  const line = page.getByText("Строка А 11", { exact: true });
  await expect(line).toBeVisible();
  const reached = realtime.broadcast("hides:", "hide", { message_id: target.id, chat_id: A, hidden: true });
  expect(reached, "no hides channel was joined").toBeGreaterThan(0);
  await expect(line, "a hide heard live was not applied").toHaveCount(0);
  await expect(bubble(page, "Строка А 12")).toBeVisible();

  // And one hidden while this chat is closed: the return draws without a
  // read, so the held copy itself must have lost it.
  await backToList(page);
  await rowOf(page, "Борис").click();
  await expect(bubble(page, "Строка Б")).toBeVisible();
  const closed = messages.find((row) => row.content === "Строка А 10")!;
  expect(realtime.broadcast("hides:", "hide", { message_id: closed.id, chat_id: A, hidden: true })).toBeGreaterThan(0);
  await backToList(page);
  await rowOf(page, "Анна").click();
  await bubble(page, "Строка А 12").waitFor({ state: "visible", timeout: 10_000 });
  await expect(page.getByText("Строка А 10", { exact: true }), "a hide heard while the chat was closed flashed back").toHaveCount(0);
});
