import { expect, test, type APIRequestContext, type Page, type Route } from "@playwright/test";
import { installRenderCounter, readRenderCounts, resetRenderCounts, type RenderCounts } from "./helpers/render-counter";
import { RealtimeFixture } from "./helpers/realtime-fixture";

/**
 * Complaints 12 and 13, measured per event: what one message, one receipt, one
 * focus and one reopened chat cost in requests and in renders.
 *
 * (12) «список чатов перезагружается целиком на каждое сообщение, отметку о
 * прочтении и фокус». (13) «повторное открытие чата заново всё загружает и
 * рисует дважды». Decorations were ruled out in triage; the cost is data and
 * rendering, so that is what is counted here:
 *
 * - requests to the backend, by table or RPC, from a route mock of the fixture
 *   host — the pattern of `message-forward-feedback.spec.ts`, which also aborts
 *   every request to a host that is not this machine;
 * - React renders of the chat list, its rows, the conversation and its rows,
 *   with the DevTools hook of `message-render-stability.spec.ts`, which also
 *   records WHICH row rendered;
 * - Realtime events delivered over a mocked Phoenix socket
 *   (`helpers/realtime-fixture.ts`), so the application's own channels receive
 *   them. The mock also plays the server's part in receipts: `mark_chat_read`
 *   and `mark_chat_delivered` write this user's membership and the socket
 *   delivers the UPDATE, as the database does.
 *
 * Each measurement is logged as `[event-cost]` with the numbers, and the cost
 * assertions are soft, so a run against slower code reports every event.
 *
 * The dev server must use `VITE_SUPABASE_URL=http://127.0.0.1:54321`. With
 * `VITE_CHAT_LIST_SUMMARIES_RPC_ENABLED=1` the list is summarised by the RPC, as
 * production builds do; without it, by the per-chat compatibility queries. The
 * spec counts either way and says which it saw.
 */

const FIXTURE_HOST = "http://127.0.0.1:54321";
const ME = "11111111-1111-4111-8111-1111111111a1";
const ANYA = "11111111-1111-4111-8111-1111111111a2";
const BORIS = "11111111-1111-4111-8111-1111111111a3";

const CHAT = {
  A: "22222222-2222-4222-8222-2222222222a1",
  B: "22222222-2222-4222-8222-2222222222a2",
  C: "22222222-2222-4222-8222-2222222222a3",
  D: "22222222-2222-4222-8222-2222222222a4",
  E: "22222222-2222-4222-8222-2222222222a5",
  F: "22222222-2222-4222-8222-2222222222a6",
} as const;
const LABEL_OF_CHAT = Object.fromEntries(Object.entries(CHAT).map(([label, id]) => [id, label]));

const A_HISTORY = 40;
const RENDERED = ["Sidebar", "ChatList", "ChatListItem", "ChatWindow", "MessageList", "MessageRow", "MessageBubble"];
const KEYS = { ChatListItem: ["chat", "id"], MessageRow: ["msg", "id"], MessageBubble: ["message", "id"] };

/** The requests a whole-list refetch is made of. None of them may follow a single event. */
const LIST_REFETCH = ["GET chats", "POST rpc/chat_list_summaries", "GET messages:count"];
/** Everything a chat's data is read from. */
const CHAT_DATA = [
  "GET chat_members",
  "GET chats",
  "POST rpc/chat_list_summaries",
  "GET messages:list",
  "GET messages:one",
  "GET messages:pinned",
  "GET messages:count",
  "GET message_hidden_for_users",
];

type Row = Record<string, unknown>;

test.describe("what one event costs the chat list and the conversation", () => {
  test.beforeEach(async ({ request }) => {
    await requireFixtureServer(request);
  });

  test("a message in another chat changes that row and fetches nothing", async ({ page }) => {
    test.setTimeout(90_000);
    const { backend, realtime } = await boot(page);
    await openChat(page, backend, realtime, CHAT.A);

    await resetRenderCounts(page);
    const mark = backend.mark();
    const text = "Новое сообщение в личном чате";
    realtime.emit({ type: "INSERT", table: "messages", record: backend.insertMessage(CHAT.B, ANYA, text) });
    // Long enough for the delivered mark, which waits 2.5 seconds.
    await settle(page, backend, 3_800);

    const cost = backend.since(mark);
    const renders = await readRenderCounts(page);
    report("message in another chat", cost, renders);

    const row = chatRow(page, CHAT.B);
    await expect(row).toHaveAttribute("data-unread-count", "1");
    await expect(row).toContainText(text);
    await expect(page.getByTestId("chat-list-item").first()).toHaveAttribute("data-chat-id", CHAT.B);
    await expect(page).toHaveTitle("(3) LETSCUBE");

    expect.soft(sum(cost, LIST_REFETCH), `the list was refetched for one message: ${JSON.stringify(cost)}`).toBe(0);
    expect.soft(sum(cost, CHAT_DATA), `chat data was fetched for one message: ${JSON.stringify(cost)}`).toBe(0);
    expect.soft(cost["POST rpc/mark_chat_delivered"] ?? 0, "a private chat still marks the message delivered").toBe(1);
    expect.soft(otherKeys(renders, "ChatListItem", [CHAT.B]), `rows other than its own rendered: ${JSON.stringify(renders.byKey.ChatListItem)}`).toEqual([]);
    expect.soft(renders.counts.ChatListItem, "the row renders for the message and for its delivered mark at most").toBeLessThanOrEqual(2);
    expect.soft(renders.counts.MessageList, "the open conversation rendered for another chat's message").toBe(0);
    expect.soft(renders.counts.MessageRow, "messages rendered for another chat's message").toBe(0);
  });

  test("a message in the open chat renders its own bubble and fetches nothing", async ({ page }) => {
    test.setTimeout(90_000);
    const { backend, realtime } = await boot(page);
    await openChat(page, backend, realtime, CHAT.A);
    const previousLast = backend.lastMessageId(CHAT.A);

    await resetRenderCounts(page);
    const mark = backend.mark();
    const text = "Сообщение в открытом чате";
    const record = backend.insertMessage(CHAT.A, ANYA, text);
    realtime.emit({ type: "INSERT", table: "messages", record });
    await settle(page, backend, 2_500);

    const cost = backend.since(mark);
    const renders = await readRenderCounts(page);
    report("message in the open chat", cost, renders);

    await expect(page.locator('[data-message-bubble="true"]').filter({ hasText: text })).toBeVisible();
    await expect(chatRow(page, CHAT.A)).toHaveAttribute("data-unread-count", "0");
    await expect(chatRow(page, CHAT.A)).toContainText(text);

    expect.soft(sum(cost, LIST_REFETCH), `the list was refetched for one message: ${JSON.stringify(cost)}`).toBe(0);
    expect.soft(sum(cost, CHAT_DATA), `chat data was fetched for a message that arrived whole: ${JSON.stringify(cost)}`).toBe(0);
    // A read now reports what was drawn (`mark_chat_read_through`, 20260911141000).
    expect.soft(cost["POST rpc/mark_chat_read_through"] ?? 0, "the open chat still marks the message read").toBe(1);
    expect.soft(otherKeys(renders, "ChatListItem", [CHAT.A]), `rows other than the open chat's rendered: ${JSON.stringify(renders.byKey.ChatListItem)}`).toEqual([]);
    expect.soft(renders.counts.ChatListItem, "the open chat's row renders for the preview and the read mark at most").toBeLessThanOrEqual(2);
    expect.soft(
      otherKeys(renders, "MessageRow", [String(record.id), previousLast]),
      `messages other than the new one and the one it follows rendered: ${JSON.stringify(renders.byKey.MessageRow)}`,
    ).toEqual([]);
  });

  test("a peer's receipt and this user's own read each change one row and fetch nothing", async ({ page }) => {
    test.setTimeout(90_000);
    const { backend, realtime } = await boot(page);
    await openChat(page, backend, realtime, CHAT.A);

    // Борис reads the one message of mine he had not read yet.
    await resetRenderCounts(page);
    let mark = backend.mark();
    realtime.emit({ type: "UPDATE", table: "chat_members", record: backend.readUpTo(CHAT.A, BORIS) });
    await settle(page, backend, 1_500);
    let cost = backend.since(mark);
    let renders = await readRenderCounts(page);
    report("peer read receipt", cost, renders);
    expect.soft(sum(cost, CHAT_DATA), `chat data was fetched for a peer's receipt: ${JSON.stringify(cost)}`).toBe(0);
    expect.soft(otherKeys(renders, "ChatListItem", [CHAT.A]), `rows other than the receipt's chat rendered: ${JSON.stringify(renders.byKey.ChatListItem)}`).toEqual([]);
    expect.soft(renders.counts.ChatListItem).toBeLessThanOrEqual(1);
    expect.soft(
      otherKeys(renders, "MessageRow", [backend.lastOwnMessageId(CHAT.A)]),
      `messages whose receipt did not change rendered: ${JSON.stringify(renders.byKey.MessageRow)}`,
    ).toEqual([]);

    // This user reads chat C on another device.
    await resetRenderCounts(page);
    mark = backend.mark();
    realtime.emit({ type: "UPDATE", table: "chat_members", record: backend.readUpTo(CHAT.C, ME) });
    await settle(page, backend, 1_500);
    cost = backend.since(mark);
    renders = await readRenderCounts(page);
    report("own read on another device", cost, renders);
    await expect(chatRow(page, CHAT.C)).toHaveAttribute("data-unread-count", "0");
    await expect(page).toHaveTitle("LETSCUBE");
    expect.soft(sum(cost, CHAT_DATA), `chat data was fetched for a read on another device: ${JSON.stringify(cost)}`).toBe(0);
    expect.soft(otherKeys(renders, "ChatListItem", [CHAT.C]), `rows other than the read chat rendered: ${JSON.stringify(renders.byKey.ChatListItem)}`).toEqual([]);
    expect.soft(renders.counts.ChatListItem).toBeLessThanOrEqual(1);
    expect.soft(renders.counts.MessageRow, "messages rendered for a read in another chat").toBe(0);
  });

  test("focus fetches nothing, and coming back from away revalidates once without rendering rows", async ({ page }) => {
    test.setTimeout(120_000);
    const { backend, realtime } = await boot(page);
    await openChat(page, backend, realtime, CHAT.A);

    await resetRenderCounts(page);
    let mark = backend.mark();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await settle(page, backend, 2_000);
    let cost = backend.since(mark);
    let renders = await readRenderCounts(page);
    report("window focus", cost, renders);
    expect.soft(sum(cost, CHAT_DATA), `a focus fetched chat data: ${JSON.stringify(cost)}`).toBe(0);
    expect.soft(renders.counts.ChatListItem, "a focus rendered chat rows").toBe(0);
    expect.soft(renders.counts.MessageRow, "a focus rendered messages").toBe(0);

    await resetRenderCounts(page);
    mark = backend.mark();
    await setVisibility(page, "hidden");
    await page.waitForTimeout(2_000);
    await setVisibility(page, "visible");
    await settle(page, backend, 2_000);
    cost = backend.since(mark);
    renders = await readRenderCounts(page);
    report("hidden for 2s, then visible", cost, renders);
    expect.soft(sum(cost, CHAT_DATA), `a short absence fetched chat data: ${JSON.stringify(cost)}`).toBe(0);
    expect.soft(renders.counts.ChatListItem, "a short absence rendered chat rows").toBe(0);
    expect.soft(renders.counts.MessageRow, "a short absence rendered messages").toBe(0);

    await resetRenderCounts(page);
    mark = backend.mark();
    await setVisibility(page, "hidden");
    await page.waitForTimeout(16_500);
    await setVisibility(page, "visible");
    await settle(page, backend, 2_500);
    cost = backend.since(mark);
    renders = await readRenderCounts(page);
    report("hidden for 16.5s, then visible", cost, renders);
    expect.soft(cost["GET chats"] ?? 0, "coming back revalidates the list, once").toBeLessThanOrEqual(1);
    expect.soft(cost["GET messages:list"] ?? 0, "coming back revalidates the open chat, once").toBeLessThanOrEqual(1);
    expect.soft(renders.counts.ChatListItem, "a revalidation that changed nothing rendered chat rows").toBe(0);
    expect.soft(renders.counts.MessageRow, "a revalidation that changed nothing rendered messages").toBe(0);
    // The rows survive a refetch on their own — the merge keeps the objects the
    // store holds — but a store that takes the refetched list whole still hands
    // the conversation a new array, and the conversation renders for it.
    expect.soft(renders.counts.MessageList, "a revalidation that changed nothing rendered the conversation").toBe(0);
  });

  test("leaving a chat and opening it again renders its history once and fetches it once", async ({ page }) => {
    test.setTimeout(90_000);
    const { backend, realtime } = await boot(page);
    await openChat(page, backend, realtime, CHAT.A);

    await leaveChat(page);
    await settle(page, backend, 1_200);

    await resetRenderCounts(page);
    const mark = backend.mark();
    await chatRow(page, CHAT.A).click();
    await expect(page.locator('[data-message-bubble="true"]').first()).toBeVisible();
    await settle(page, backend, 2_800);
    const cost = backend.since(mark);
    const renders = await readRenderCounts(page);
    report("leave and reopen", cost, renders);

    const scroller = page.getByTestId("message-scroll-container");
    const distance = await scroller.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight);
    expect(distance, "a chat with nothing unread opens at the bottom").toBeLessThanOrEqual(2);

    const perRow = Object.values(renders.byKey.MessageRow ?? {});
    expect.soft(cost["GET messages:list"] ?? 0, `the history was fetched more than once: ${JSON.stringify(cost)}`).toBeLessThanOrEqual(1);
    expect.soft(cost["GET chat_members"] ?? 0, `the clear mark was read more than once: ${JSON.stringify(cost)}`).toBeLessThanOrEqual(1);
    expect.soft(sum(cost, LIST_REFETCH), `the list was refetched for opening a chat: ${JSON.stringify(cost)}`).toBe(0);
    expect.soft(Math.max(0, ...perRow), `a message rendered more than once: ${JSON.stringify(renders.byKey.MessageRow)}`).toBeLessThanOrEqual(1);
    expect.soft(otherKeys(renders, "ChatListItem", [CHAT.A]), `rows other than the opened chat's rendered: ${JSON.stringify(renders.byKey.ChatListItem)}`).toEqual([]);
  });

  test("reopening a chat that received messages while it was closed lands on the first of them", async ({ page }) => {
    // CLAUDE.md section 11: with unread messages a chat opens at the first one.
    // A reopened chat renders from the store, and the store does not have the
    // messages that arrived while it was closed, so this is the case where
    // rendering from what is already known would be wrong. Enough of them that
    // the first one and the bottom cannot both be in view.
    test.setTimeout(90_000);
    const { backend, realtime } = await boot(page);
    await openChat(page, backend, realtime, CHAT.A);
    await leaveChat(page);
    await settle(page, backend, 1_200);

    const unread = 24;
    for (let index = 0; index < unread; index += 1) {
      const sender = index % 2 === 0 ? ANYA : BORIS;
      const record = backend.insertMessage(CHAT.A, sender, `Непрочитанное ${index + 1} — пока чат был закрыт, пришло новое сообщение`);
      realtime.emit({ type: "INSERT", table: "messages", record });
      await page.waitForTimeout(20);
    }
    await expect(chatRow(page, CHAT.A)).toHaveAttribute("data-unread-count", String(unread));
    await settle(page, backend, 1_500);

    await chatRow(page, CHAT.A).click();
    const firstUnread = page.locator('[data-message-bubble="true"]').filter({ hasText: "Непрочитанное 1 —" });
    const lastUnread = page.locator('[data-message-bubble="true"]').filter({ hasText: `Непрочитанное ${unread} —` });
    await expect(page.getByTestId("first-unread-separator")).toBeVisible();
    await expect(firstUnread).toBeInViewport();
    await page.waitForTimeout(1_500);
    await expect(firstUnread, "the reader was moved off the first unread message").toBeInViewport();
    await expect(lastUnread, "the reader was put at the bottom, past the first unread message").not.toBeInViewport();
  });

  test("switching to another chat and back renders the history once and fetches it once", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.includes("mobile"), "a phone has one pane: leaving a chat is the test above");
    test.setTimeout(90_000);
    const { backend, realtime } = await boot(page);
    await openChat(page, backend, realtime, CHAT.A);
    await openChat(page, backend, realtime, CHAT.C);

    await resetRenderCounts(page);
    const mark = backend.mark();
    await chatRow(page, CHAT.A).click();
    await expect(page.locator('[data-message-bubble="true"]').filter({ hasText: "Строка 40" })).toBeVisible();
    await settle(page, backend, 2_800);
    const cost = backend.since(mark);
    const renders = await readRenderCounts(page);
    report("switch back", cost, renders);

    const perRow = Object.values(renders.byKey.MessageRow ?? {});
    expect.soft(cost["GET messages:list"] ?? 0, `the history was fetched more than once: ${JSON.stringify(cost)}`).toBeLessThanOrEqual(1);
    expect.soft(cost["GET chat_members"] ?? 0, `the clear mark was read more than once: ${JSON.stringify(cost)}`).toBeLessThanOrEqual(1);
    expect.soft(Math.max(0, ...perRow), `a message rendered more than once: ${JSON.stringify(renders.byKey.MessageRow)}`).toBeLessThanOrEqual(1);
    expect.soft(otherKeys(renders, "ChatListItem", [CHAT.A, CHAT.C]), `rows other than the two selected ones rendered: ${JSON.stringify(renders.byKey.ChatListItem)}`).toEqual([]);
  });

  test("coming back online after an outage still refetches the list and the open chat", async ({ page }) => {
    test.setTimeout(90_000);
    const { backend, realtime } = await boot(page);
    await openChat(page, backend, realtime, CHAT.A);

    await resetRenderCounts(page);
    await page.context().setOffline(true);
    await realtime.dropConnections();
    await page.waitForTimeout(1_500);
    const mark = backend.mark();
    await page.context().setOffline(false);
    await settle(page, backend, 4_000);
    const cost = backend.since(mark);
    const renders = await readRenderCounts(page);
    report("offline, then online", cost, renders);

    expect(cost["GET chats"] ?? 0, `the list was not refetched after the outage: ${JSON.stringify(cost)}`).toBeGreaterThanOrEqual(1);
    expect(cost["GET messages:list"] ?? 0, `the open chat was not refetched after the outage: ${JSON.stringify(cost)}`).toBeGreaterThanOrEqual(1);
    await expect.poll(() => realtime.joinCount(`messages:chat:${CHAT.A}`), { timeout: 15_000 }).toBeGreaterThanOrEqual(2);

    // Nothing changed during the outage. A revalidation that runs before
    // requests go through again must not empty the list or close the chat.
    await expect(page.getByTestId("chat-composer-dock"), "the reconnect closed the open chat").toBeVisible();
    await expect(page.getByTestId("chat-list-item")).toHaveCount(Object.keys(CHAT).length);
    expect.soft(
      Object.keys(renders.byKey.ChatListItem ?? {}).map((id) => LABEL_OF_CHAT[id] ?? id),
      `rows rendered for a reconnect that changed nothing: ${JSON.stringify(renders.byKey.ChatListItem)}`,
    ).toEqual([]);
  });

  test("a revalidation whose requests fail keeps the list and the open chat", async ({ page }) => {
    // A request that failed says nothing about the chats. Read as "no
    // memberships", it emptied the list and closed the open chat. Realtime
    // rejoining is exactly when a revalidation meets a failing backend, so the
    // membership reads fail while the socket drops and rejoins.
    //
    // They fail with an HTTP 500, not a dropped connection. postgrest-js
    // retries a GET whose fetch rejects, or that answers 503 or 520, three
    // times over 1, 2 and 4 seconds, and hands the caller nothing until the
    // retries are spent — measured, the list's read failed at 1.4s and again
    // at 2.4s while the test waited. Any other error status is answered at
    // once, and that is the case that reached "no memberships".
    test.setTimeout(90_000);
    const { backend, realtime } = await boot(page);
    await openChat(page, backend, realtime, CHAT.A);

    let failedListReads = 0;
    const failedReads: string[] = [];
    let droppedAt = 0;
    const isMemberships = (url: URL) => url.pathname === "/rest/v1/chat_members";
    const failMemberships = async (route: Route) => {
      // The list's read of this user's memberships is the one that selects the
      // pin order. Other reads of the same table — a chat's clear mark, anything
      // else that reconnects — must not stand in for it: this counts the
      // revalidation the test is about.
      const select = new URL(route.request().url()).searchParams.get("select") ?? "";
      failedReads.push(`${Date.now() - droppedAt}ms ${select.slice(0, 60)}`);
      if (select.includes("pinned_order")) failedListReads += 1;
      await json(route, { code: "XX000", details: null, hint: null, message: "fixture: backend unavailable" }, 500);
    };
    await page.route(isMemberships, failMemberships);
    await resetRenderCounts(page);
    const joinsBefore = realtime.joinCount(`chats:user:${ME}:messages`);
    droppedAt = Date.now();
    await realtime.dropConnections();
    await expect.poll(() => realtime.joinCount(`chats:user:${ME}:messages`), { timeout: 15_000 }).toBeGreaterThan(joinsBefore);
    await expect
      .poll(() => failedListReads, { timeout: 10_000, message: `the list did not revalidate when its channel rejoined; failed reads: ${JSON.stringify(failedReads)}` })
      .toBeGreaterThan(0);
    await page.waitForTimeout(1_000);
    console.log(`[event-cost] ${test.info().project.name} reads that failed during the rejoin: ${JSON.stringify(failedReads)}`);

    await expect(page.getByTestId("chat-composer-dock"), "a failed revalidation closed the open chat").toBeVisible();
    await expect(page.getByTestId("chat-list-item")).toHaveCount(Object.keys(CHAT).length);

    await page.unroute(isMemberships, failMemberships);
    const mark = backend.mark();
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await settle(page, backend, 2_500);
    const cost = backend.since(mark);
    const renders = await readRenderCounts(page);
    report("failed revalidation, then online", cost, renders);
    expect(cost["GET chats"] ?? 0, `coming back online did not refetch the list: ${JSON.stringify(cost)}`).toBeGreaterThanOrEqual(1);
    expect.soft(
      Object.keys(renders.byKey.ChatListItem ?? {}).map((id) => LABEL_OF_CHAT[id] ?? id),
      `rows rendered although nothing changed: ${JSON.stringify(renders.byKey.ChatListItem)}`,
    ).toEqual([]);
  });
});

async function requireFixtureServer(request: APIRequestContext) {
  const client = await request
    .get("/src/lib/supabase/client.ts")
    .then((response) => response.text())
    .catch(() => "");
  if (!client.includes(FIXTURE_HOST)) {
    throw new Error(
      `This spec mocks the backend at ${FIXTURE_HOST}. Start the dev server with VITE_SUPABASE_URL=${FIXTURE_HOST} and VITE_SUPABASE_ANON_KEY=playwright-public-fixture; it will not run against any other configuration.`,
    );
  }
}

async function boot(page: Page) {
  await page.route(
    (url) => url.hostname !== "127.0.0.1" && url.hostname !== "localhost",
    (route) => route.abort("blockedbyclient"),
  );
  const backend = seed(new FixtureBackend());
  const realtime = new RealtimeFixture();
  backend.realtime = realtime;
  await realtime.install(page);
  await page.route(`${FIXTURE_HOST}/**`, (route) => backend.handle(route));
  await installSession(page);
  await installVisibilityControl(page);
  await installRenderCounter(page, RENDERED, KEYS);

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("chat-list-item")).toHaveCount(Object.keys(CHAT).length);
  await expect.poll(() => realtime.isJoined(`chats:user:${ME}:messages`), { timeout: 15_000 }).toBe(true);
  await expect.poll(() => realtime.isJoined(`chat-members:user:${ME}`), { timeout: 15_000 }).toBe(true);
  const summarised = backend.requests.includes("POST rpc/chat_list_summaries");
  console.log(`[event-cost] ${test.info().project.name} list summaries: ${summarised ? "RPC" : "compatibility queries"}`);
  return { backend, realtime };
}

async function openChat(page: Page, backend: FixtureBackend, realtime: RealtimeFixture, chatId: string) {
  await chatRow(page, chatId).click();
  await expect(page.locator('[data-message-bubble="true"]').first()).toBeVisible();
  await expect.poll(() => realtime.isJoined(`messages:chat:${chatId}`), { timeout: 15_000 }).toBe(true);
  // Past the join, its reconcile and the read mark, so only what the test does is counted.
  await settle(page, backend, 3_000);
}

/**
 * Leaves the open chat the way a reader does: Escape, which `MainLayout` answers
 * at every width. Not through an imported store: once a source file changes
 * under a running dev server, Vite serves the application's store under a
 * `?t=` URL, and `import("/src/store/app.store.ts")` then returns a second store
 * that nothing renders from — the chat stayed open and a whole measurement was
 * of nothing. So this proves the chat closed.
 */
async function leaveChat(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("chat-composer-dock"), "the chat did not close").toHaveCount(0);
}

function chatRow(page: Page, chatId: string) {
  return page.locator(`[data-testid="chat-list-item"][data-chat-id="${chatId}"]`);
}

/** Waits at least `minimumMs`, then until no request has been made for a second. */
async function settle(page: Page, backend: FixtureBackend, minimumMs: number) {
  const started = Date.now();
  await page.waitForTimeout(minimumMs);
  let seen = backend.requests.length;
  let lastChange = Date.now();
  while (Date.now() - started < minimumMs + 10_000) {
    await page.waitForTimeout(200);
    if (backend.requests.length !== seen) {
      seen = backend.requests.length;
      lastChange = Date.now();
    } else if (Date.now() - lastChange >= 1_000) {
      return;
    }
  }
}

async function installSession(page: Page) {
  await page.addInitScript(({ userId }) => {
    localStorage.setItem("kub-theme", "dark");
    localStorage.setItem(
      "kub-auth",
      JSON.stringify({
        access_token: "playwright.user.jwt",
        refresh_token: "playwright-refresh",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        token_type: "bearer",
        user: {
          id: userId,
          aud: "authenticated",
          role: "authenticated",
          email: "event-cost-qa@example.invalid",
          user_metadata: { full_name: "Максим" },
          app_metadata: {},
          created_at: "2026-09-01T09:00:00.000Z",
        },
      }),
    );
  }, { userId: ME });
}

/** `document.visibilityState` under the test's control; a page in a test is never really hidden. */
async function installVisibilityControl(page: Page) {
  await page.addInitScript(() => {
    let state: DocumentVisibilityState = "visible";
    Object.defineProperty(Document.prototype, "visibilityState", { configurable: true, get: () => state });
    Object.defineProperty(Document.prototype, "hidden", { configurable: true, get: () => state === "hidden" });
    (window as unknown as Record<string, unknown>).__letscubeSetVisibility = (next: DocumentVisibilityState) => {
      state = next;
      document.dispatchEvent(new Event("visibilitychange"));
    };
  });
}

async function setVisibility(page: Page, state: "visible" | "hidden") {
  await page.evaluate((next) => {
    (window as unknown as Record<string, (value: string) => void>).__letscubeSetVisibility(next);
  }, state);
}

function sum(cost: Record<string, number>, labels: string[]): number {
  return labels.reduce((total, label) => total + (cost[label] ?? 0), 0);
}

function otherKeys(renders: RenderCounts, name: string, allowed: string[]): string[] {
  return Object.keys(renders.byKey[name] ?? {}).filter((key) => !allowed.includes(key));
}

function report(event: string, cost: Record<string, number>, renders: RenderCounts) {
  const rows = Object.fromEntries(
    Object.entries(renders.byKey.ChatListItem ?? {}).map(([id, count]) => [LABEL_OF_CHAT[id] ?? id, count]),
  );
  const summary = {
    Sidebar: renders.counts.Sidebar,
    ChatList: renders.counts.ChatList,
    ChatListItem: renders.counts.ChatListItem,
    rows,
    ChatWindow: renders.counts.ChatWindow,
    MessageList: renders.counts.MessageList,
    MessageRow: renders.counts.MessageRow,
    messagesRendered: Object.keys(renders.byKey.MessageRow ?? {}).length,
    MessageBubble: renders.counts.MessageBubble,
  };
  console.log(`[event-cost] ${test.info().project.name} ${event}: requests=${JSON.stringify(cost)} renders=${JSON.stringify(summary)}`);
}

/**
 * The fixture database: three people, six chats, and the PostgREST and RPC
 * surface the chat list and the conversation read — filters, order, limit,
 * counts and the joins, answered from these rows.
 */
class FixtureBackend {
  readonly requests: string[] = [];
  realtime: RealtimeFixture | null = null;
  readonly profiles = new Map<string, Row>();
  readonly chats: Row[] = [];
  readonly memberships: Row[] = [];
  readonly messages: Row[] = [];
  private sequence = 0;

  mark(): number {
    return this.requests.length;
  }

  since(mark: number): Record<string, number> {
    const tally: Record<string, number> = {};
    for (const label of this.requests.slice(mark)) tally[label] = (tally[label] ?? 0) + 1;
    return tally;
  }

  membership(chatId: string, userId: string): Row | undefined {
    return this.memberships.find((row) => row.chat_id === chatId && row.user_id === userId);
  }

  lastMessageId(chatId: string): string {
    return String(this.sorted(this.messages.filter((row) => row.chat_id === chatId)).at(-1)?.id);
  }

  lastOwnMessageId(chatId: string): string {
    return String(this.sorted(this.messages.filter((row) => row.chat_id === chatId && row.user_id === ME)).at(-1)?.id);
  }

  insertMessage(chatId: string, userId: string, content: string, at = new Date().toISOString()): Row {
    this.sequence += 1;
    const row = messageRow(`55555555-5555-4555-8555-${String(900000000000 + this.sequence)}`, chatId, userId, content, at);
    this.messages.push(row);
    const chat = this.chats.find((item) => item.id === chatId);
    if (chat) chat.updated_at = at;
    return row;
  }

  readUpTo(chatId: string, userId: string, at = new Date().toISOString()): Row {
    const membership = this.membership(chatId, userId);
    if (!membership) throw new Error(`no membership for ${userId} in ${chatId}`);
    membership.last_read_at = at;
    membership.last_delivered_at = at;
    return { ...membership };
  }

  async handle(route: Route) {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const headers = request.headers();
    this.requests.push(labelOf(method, url, headers));
    const single = (headers.accept ?? "").includes("application/vnd.pgrst.object");
    const path = url.pathname;

    if (method === "OPTIONS") return route.fulfill({ status: 204 });
    if (path === "/auth/v1/user") {
      return json(route, {
        id: ME,
        aud: "authenticated",
        role: "authenticated",
        email: "event-cost-qa@example.invalid",
        user_metadata: { full_name: "Максим" },
        app_metadata: {},
        created_at: "2026-09-01T09:00:00.000Z",
      });
    }
    if (path.startsWith("/auth/v1/")) return json(route, {});

    const resource = path.match(/^\/rest\/v1\/(.+)$/)?.[1] ?? "";
    if (resource.startsWith("rpc/")) {
      let body: Row = {};
      try {
        body = (request.postDataJSON() ?? {}) as Row;
      } catch {
        body = {};
      }
      return this.rpc(route, resource.slice(4), body);
    }

    const params = url.searchParams;
    switch (resource) {
      case "profiles":
        return json(route, pick(single, filterRows([...this.profiles.values()], params)));
      case "chat_members":
        if (method !== "GET") return json(route, single ? null : []);
        return json(route, pick(single, filterRows(this.memberships, params)));
      case "chats": {
        if (method !== "GET") return route.fulfill({ status: 204 });
        const rows = orderRows(filterRows(this.chats, params), params.get("order")).map((chat) => this.chatWithMembers(chat));
        return json(route, pick(single, rows));
      }
      case "messages": {
        if (method !== "GET") return json(route, single ? null : []);
        const matched = orderRows(filterRows(this.messages, params), params.get("order"));
        const limit = Number(params.get("limit") ?? matched.length);
        const rows = matched.slice(0, Number.isFinite(limit) ? limit : matched.length);
        const select = params.get("select") ?? "*";
        const body = rows.map((row) => this.joined(row, select));
        if ((headers.prefer ?? "").includes("count=")) {
          const range = body.length ? `0-${body.length - 1}/${matched.length}` : `*/${matched.length}`;
          return json(route, body, 200, { "access-control-expose-headers": "Content-Range", "content-range": range });
        }
        return json(route, single ? body[0] ?? null : body);
      }
      default:
        return json(route, single ? null : []);
    }
  }

  private rpc(route: Route, name: string, body: Row) {
    if (name === "chat_list_summaries") {
      return json(route, this.summaries((body.p_chat_ids as string[] | null | undefined) ?? null));
    }
    if (name === "mark_chat_read" || name === "mark_chat_read_through" || name === "mark_chat_delivered") {
      const membership = this.membership(String(body.p_chat_id), ME);
      if (membership) {
        const now = new Date().toISOString();
        // A read through reports what the client drew, never past now.
        const reported = typeof body.p_read_through === "string" && time(body.p_read_through) < time(now)
          ? body.p_read_through
          : now;
        const mark = name === "mark_chat_read_through" ? reported : now;
        if (name !== "mark_chat_delivered") membership.last_read_at = later(membership.last_read_at, mark);
        membership.last_delivered_at = later(membership.last_delivered_at, mark);
        const record = { ...membership };
        setTimeout(() => this.realtime?.emit({ type: "UPDATE", table: "chat_members", record }), 30);
      }
      return route.fulfill({ status: 204 });
    }
    return json(route, null);
  }

  private summaries(chatIds: string[] | null) {
    return this.memberships
      .filter((membership) => membership.user_id === ME && (!chatIds || chatIds.includes(String(membership.chat_id))))
      .map((membership) => {
        const cleared = time(membership.cleared_at);
        const visible = this.sorted(this.messages.filter((row) =>
          row.chat_id === membership.chat_id && !row.deleted_at && (!membership.cleared_at || time(row.created_at) > cleared)
        ));
        const last = visible.at(-1) ?? null;
        const watermark = Math.max(time(membership.joined_at), time(membership.last_read_at), cleared);
        const unread = this.messages.filter((row) =>
          row.chat_id === membership.chat_id &&
          !row.deleted_at &&
          row.type !== "system" &&
          ((row.user_id && !row.bot_id && row.user_id !== ME) || (row.bot_id && !row.user_id)) &&
          time(row.created_at) > watermark
        ).length;
        return { chat_id: membership.chat_id, last_message: last ? this.joined(last, "*,sender,bot") : null, unread_count: unread };
      });
  }

  private chatWithMembers(chat: Row): Row {
    return {
      ...chat,
      members: this.memberships
        .filter((membership) => membership.chat_id === chat.id)
        .map((membership) => ({ ...membership, profile: this.profiles.get(String(membership.user_id)) ?? null })),
    };
  }

  private joined(row: Row, select: string): Row {
    const joinedRow: Row = {
      ...row,
      sender: row.user_id ? this.profiles.get(String(row.user_id)) ?? null : null,
      bot: null,
    };
    if (select.includes("reactions")) {
      joinedRow.reply_to = null;
      joinedRow.reactions = [];
    }
    return joinedRow;
  }

  private sorted(rows: Row[]): Row[] {
    return [...rows].sort((a, b) => time(a.created_at) - time(b.created_at) || String(a.id).localeCompare(String(b.id)));
  }
}

function seed(backend: FixtureBackend): FixtureBackend {
  const hour = 60 * 60 * 1000;
  const start = Date.now() - 3 * hour;
  const at = (minutes: number) => new Date(start + minutes * 60_000).toISOString();
  const long = "2026-09-01T09:00:00.000Z";

  backend.profiles.set(ME, profileRow(ME, "Максим", "maksim"));
  backend.profiles.set(ANYA, profileRow(ANYA, "Аня", null));
  backend.profiles.set(BORIS, profileRow(BORIS, "Борис", null));

  const chat = (id: string, type: string, name: string, updatedAt: string) => ({
    id,
    type,
    name,
    description: null,
    avatar_url: null,
    created_by: ME,
    created_at: long,
    updated_at: updatedAt,
    is_forum: false,
    invite_policy: "admins_only",
  });
  const member = (chatId: string, userId: string, readAt: string, role = "member") => ({
    chat_id: chatId,
    user_id: userId,
    role,
    joined_at: long,
    last_read_at: readAt,
    last_delivered_at: readAt,
    hidden_at: null,
    cleared_at: null,
    pinned: false,
    pinned_at: null,
    pinned_order: null,
  });

  // A: the open group. Every third message is mine; the last one is, too.
  for (let index = 0; index < A_HISTORY; index += 1) {
    const sender = index % 3 === 0 ? ME : index % 3 === 1 ? ANYA : BORIS;
    backend.messages.push(messageRow(
      `55555555-5555-4555-8555-${String(100000000000 + index)}`,
      CHAT.A,
      sender,
      `Строка ${index + 1} — синтетический текст открытого чата`,
      at(60 + index),
    ));
  }
  const aLast = at(60 + A_HISTORY - 1);
  backend.chats.push(chat(CHAT.A, "group", "Команда проекта", aLast));
  backend.memberships.push(
    member(CHAT.A, ME, aLast, "owner"),
    member(CHAT.A, ANYA, aLast),
    // Борис has read up to my second-to-last message and not my last one.
    member(CHAT.A, BORIS, at(60 + A_HISTORY - 3)),
  );

  // B: private with Аня, read.
  for (let index = 0; index < 3; index += 1) {
    backend.messages.push(messageRow(`55555555-5555-4555-8555-${String(200000000000 + index)}`, CHAT.B, index === 1 ? ME : ANYA, `Личное ${index + 1}`, at(40 + index)));
  }
  backend.chats.push(chat(CHAT.B, "private", "private", at(42)));
  backend.memberships.push(member(CHAT.B, ME, at(42), "owner"), member(CHAT.B, ANYA, at(42)));

  // C: a group with two messages this user has not read.
  for (let index = 0; index < 3; index += 1) {
    backend.messages.push(messageRow(`55555555-5555-4555-8555-${String(300000000000 + index)}`, CHAT.C, BORIS, `Архив ${index + 1}`, at(30 + index)));
  }
  backend.chats.push(chat(CHAT.C, "group", "Архив задач", at(32)));
  backend.memberships.push(member(CHAT.C, ME, at(30), "owner"), member(CHAT.C, BORIS, at(32)));

  // D, E, F: quiet chats further down.
  const quiet: Array<[string, string, number]> = [[CHAT.D, "Дизайн", 20], [CHAT.E, "Релизы", 10], [CHAT.F, "Поддержка", 5]];
  for (const [id, name, minute] of quiet) {
    backend.messages.push(messageRow(`55555555-5555-4555-8555-${String(400000000000 + minute)}`, id, ANYA, `${name}: последнее`, at(minute)));
    backend.chats.push(chat(id, "group", name, at(minute)));
    backend.memberships.push(member(id, ME, at(minute), "owner"), member(id, ANYA, at(minute)));
  }
  return backend;
}

function profileRow(id: string, fullName: string, username: string | null): Row {
  return {
    id,
    full_name: fullName,
    username,
    avatar_url: null,
    bio: null,
    role: "user",
    // Long enough ago that nobody's presence changes while a test runs.
    online_at: "2026-09-01T09:00:00.000Z",
    created_at: "2026-09-01T09:00:00.000Z",
    updated_at: "2026-09-01T09:00:00.000Z",
  };
}

function messageRow(id: string, chatId: string, userId: string | null, content: string, createdAt: string): Row {
  return {
    id,
    chat_id: chatId,
    topic_id: null,
    user_id: userId,
    bot_id: null,
    sender_deleted_at: null,
    content,
    type: "text",
    media_bucket: null,
    media_path: null,
    media_url: null,
    media_metadata: {},
    reply_to_id: null,
    forwarded_from_id: null,
    client_message_id: null,
    client_sent_at: null,
    bot_reply_markup: null,
    pinned: false,
    created_at: createdAt,
    edited_at: null,
    deleted_at: null,
  };
}

function labelOf(method: string, url: URL, headers: Record<string, string>): string {
  const path = url.pathname;
  if (path.startsWith("/auth/v1/")) return `${method} auth${path.slice("/auth/v1".length)}`;
  const resource = path.match(/^\/rest\/v1\/(.+)$/)?.[1];
  if (!resource) return `${method} ${path}`;
  if (resource === "messages" && method === "GET") {
    if ((headers.prefer ?? "").includes("count=")) return "GET messages:count";
    if (url.searchParams.get("id")?.startsWith("eq.") || url.searchParams.get("client_message_id")) return "GET messages:one";
    if (url.searchParams.get("pinned")) return "GET messages:pinned";
    return "GET messages:list";
  }
  return `${method} ${resource}`;
}

const NON_FILTER_PARAMS = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);

function filterRows(rows: Row[], params: URLSearchParams): Row[] {
  return rows.filter((row) => {
    for (const [column, expression] of params) {
      if (NON_FILTER_PARAMS.has(column)) continue;
      if (column === "or") {
        if (!matchesAny(row, expression)) return false;
        continue;
      }
      if (!matchesCondition(row[column], expression)) return false;
    }
    return true;
  });
}

function matchesAny(row: Row, expression: string): boolean {
  const inner = expression.replace(/^\(/, "").replace(/\)$/, "");
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of inner) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  if (current) parts.push(current);
  return parts.some((part) => {
    const dot = part.indexOf(".");
    return matchesCondition(row[part.slice(0, dot)], part.slice(dot + 1));
  });
}

function matchesCondition(value: unknown, expression: string): boolean {
  const negated = expression.startsWith("not.");
  const body = negated ? expression.slice(4) : expression;
  const dot = body.indexOf(".");
  const operator = body.slice(0, dot);
  const operand = body.slice(dot + 1);
  const present = value !== null && value !== undefined;
  let result: boolean;
  switch (operator) {
    case "eq":
      result = present && String(value) === operand;
      break;
    case "neq":
      result = present && String(value) !== operand;
      break;
    case "is":
      result = operand === "null" ? !present : String(value) === operand;
      break;
    case "gt":
      result = present && compare(value, operand) > 0;
      break;
    case "gte":
      result = present && compare(value, operand) >= 0;
      break;
    case "lt":
      result = present && compare(value, operand) < 0;
      break;
    case "lte":
      result = present && compare(value, operand) <= 0;
      break;
    case "in":
      result = present && operand.replace(/^\(/, "").replace(/\)$/, "").split(",").map((item) => item.replace(/^"|"$/g, "")).includes(String(value));
      break;
    default:
      result = true;
  }
  return negated ? !result : result;
}

function compare(value: unknown, operand: string): number {
  const left = Date.parse(String(value));
  const right = Date.parse(operand);
  if (Number.isFinite(left) && Number.isFinite(right)) return left - right;
  return String(value).localeCompare(operand);
}

function orderRows(rows: Row[], order: string | null): Row[] {
  if (!order) return rows;
  const keys = order.split(",").map((part) => {
    const [column, direction] = part.split(".");
    return { column, descending: direction === "desc" };
  });
  return [...rows].sort((a, b) => {
    for (const { column, descending } of keys) {
      const byValue = compare(a[column], String(b[column]));
      if (byValue !== 0) return descending ? -byValue : byValue;
    }
    return 0;
  });
}

function pick(single: boolean, rows: Row[]) {
  return single ? rows[0] ?? null : rows;
}

function time(value: unknown): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

function later(current: unknown, next: string): string {
  return time(next) > time(current) ? next : String(current);
}

async function json(route: Route, body: unknown, status = 200, headers?: Record<string, string>) {
  await route.fulfill({
    status,
    contentType: "application/json",
    headers,
    body: JSON.stringify(body),
  });
}
