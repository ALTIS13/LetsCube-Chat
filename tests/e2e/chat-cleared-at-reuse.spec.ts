import { expect, test } from "@playwright/test";
import {
  chat,
  type Fixture,
  membership,
  message,
  missingFunction,
  openFixture,
  person,
  requireFixtureServer,
} from "./helpers/messageActionsFixture";

const ME = person("11111111-1111-4111-8111-1111111111c1", "Audit Me");
const PEER = person("11111111-1111-4111-8111-1111111111c2", "Audit Peer");
const CHAT_ID = "22222222-2222-4222-8222-2222222222c1";
const CHAT_NAME = "Fresh membership audit";
const MESSAGE_TEXT = "Fresh membership message";
const MESSAGE_AT = "2026-09-01T10:00:00.000Z";
const CLEARED_AT = "2026-09-01T09:30:00.000Z";

function directClearedAtReads(fixture: Fixture) {
  return fixture
    .restCalls("chat_members", "GET")
    .filter((request) => new URLSearchParams(request.search).get("select") === "cleared_at");
}

test.beforeEach(async ({ page, request }) => {
  await requireFixtureServer(request);
  await page.clock.setFixedTime(new Date("2026-09-03T18:00:00.000Z"));
});

test("fallback chat preview hides unverified text when hidden-ID lookup is refused", async ({
  page,
}) => {
  const messageRow = message(
    "33333333-3333-4333-8333-3333333333c9",
    CHAT_ID,
    PEER,
    "Unverified preview text",
    MESSAGE_AT,
  );
  const fixture = await openFixture(page, {
    me: ME,
    chats: [chat(CHAT_ID, "private", CHAT_NAME, MESSAGE_AT)],
    memberships: [
      membership(CHAT_ID, ME, "member", null),
      membership(CHAT_ID, PEER, "member", null),
    ],
    messages: [messageRow],
    rpc: (name) => (name === "chat_list_summaries" ? missingFunction(name) : undefined),
    rest: ({ resource, method }) =>
      resource === "message_hidden_for_users" && method === "GET"
        ? { status: 503, body: { code: "PGRST503", message: "synthetic preview refusal" } }
        : undefined,
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const row = page.getByTestId("chat-list-item").filter({ hasText: PEER.full_name });
  await expect(row).toBeVisible();
  await expect
    .poll(() => fixture.restCalls("message_hidden_for_users", "GET").length)
    .toBeGreaterThan(0);
  await expect(row).not.toContainText(messageRow.content as string);
});

test("a late response from the previous chat cannot cover the current history", async ({
  page,
}, info) => {
  test.skip(
    info.project.name !== "chromium-desktop-1440",
    "The desktop sidebar stays available during chat loading.",
  );
  const otherChatId = "22222222-2222-4222-8222-2222222222c5";
  const firstMessage = message(
    "33333333-3333-4333-8333-3333333333d1",
    CHAT_ID,
    PEER,
    "Slow old chat",
    MESSAGE_AT,
  );
  const secondMessage = message(
    "33333333-3333-4333-8333-3333333333d2",
    otherChatId,
    PEER,
    "Current chat stays visible",
    MESSAGE_AT,
  );
  await openFixture(page, {
    me: ME,
    chats: [
      chat(CHAT_ID, "private", CHAT_NAME, MESSAGE_AT),
      chat(otherChatId, "group", "Other audit", MESSAGE_AT),
    ],
    memberships: [
      membership(CHAT_ID, ME, "member", null),
      membership(CHAT_ID, PEER, "member", null),
      membership(otherChatId, ME, "member", null),
    ],
    messages: [firstMessage, secondMessage],
  });
  let holdFirst = false;
  let signalFirst!: () => void;
  let releaseFirst!: () => void;
  const firstLookup = new Promise<void>((resolve) => {
    signalFirst = resolve;
  });
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  await page.route("http://127.0.0.1:54321/rest/v1/message_hidden_for_users**", async (route) => {
    if (
      holdFirst &&
      route
        .request()
        .url()
        .includes(firstMessage.id as string)
    ) {
      holdFirst = false;
      signalFirst();
      await firstGate;
    }
    await route.fallback();
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const first = page.getByTestId("chat-list-item").filter({ hasText: PEER.full_name });
  const second = page.getByTestId("chat-list-item").filter({ hasText: "Other audit" });
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  holdFirst = true;
  await first.click();
  await firstLookup;
  await second.click();
  const currentBubble = page
    .locator('[data-message-bubble="true"]')
    .filter({ hasText: secondMessage.content as string });
  await expect(currentBubble).toBeVisible();
  await page.evaluate(() => {
    const state = window as typeof window & { __currentBubbleDisappeared?: boolean };
    state.__currentBubbleDisappeared = false;
    new MutationObserver(() => {
      if (
        ![...document.querySelectorAll('[data-message-bubble="true"]')].some((node) =>
          node.textContent?.includes("Current chat stays visible"),
        )
      ) {
        state.__currentBubbleDisappeared = true;
      }
    }).observe(document.body, { subtree: true, childList: true });
  });
  releaseFirst();
  await page.waitForTimeout(400);
  await expect(currentBubble).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __currentBubbleDisappeared?: boolean })
          .__currentBubbleDisappeared,
    ),
  ).toBe(false);
});

test("messages arriving during hidden-ID verification survive the initial merge", async ({
  page,
}) => {
  const firstMessage = message(
    "33333333-3333-4333-8333-3333333333d3",
    CHAT_ID,
    PEER,
    "First stored message",
    MESSAGE_AT,
  );
  const incoming = message(
    "33333333-3333-4333-8333-3333333333d4",
    CHAT_ID,
    PEER,
    "Arrived during verification",
    "2026-09-01T10:00:01.000Z",
  );
  const pending = message(
    "tmp:33333333-3333-4333-8333-3333333333d5",
    CHAT_ID,
    ME,
    "Pending local send",
    "2026-09-01T10:00:02.000Z",
    { pending: true },
  );
  const fixture = await openFixture(page, {
    me: ME,
    chats: [chat(CHAT_ID, "private", CHAT_NAME, MESSAGE_AT)],
    memberships: [
      membership(CHAT_ID, ME, "member", null),
      membership(CHAT_ID, PEER, "member", null),
    ],
    messages: [firstMessage],
  });
  let holdInitial = false;
  let signalLookup!: () => void;
  let releaseLookup!: () => void;
  const lookupStarted = new Promise<void>((resolve) => {
    signalLookup = resolve;
  });
  const lookupGate = new Promise<void>((resolve) => {
    releaseLookup = resolve;
  });
  await page.route("http://127.0.0.1:54321/rest/v1/message_hidden_for_users**", async (route) => {
    if (
      holdInitial &&
      route
        .request()
        .url()
        .includes(firstMessage.id as string)
    ) {
      holdInitial = false;
      signalLookup();
      await lookupGate;
    }
    await route.fallback();
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const row = page.getByTestId("chat-list-item").filter({ hasText: PEER.full_name });
  await expect(row).toBeVisible();
  holdInitial = true;
  await row.click();
  await lookupStarted;
  await page.evaluate(
    async ({ chatId, incomingRow, pendingRow }) => {
      const modulePath = "/src/store/app.store.ts";
      const { useAppStore } = await import(modulePath);
      useAppStore.getState().addMessage(chatId, incomingRow);
      useAppStore.getState().addMessage(chatId, pendingRow);
    },
    { chatId: CHAT_ID, incomingRow: incoming, pendingRow: pending },
  );
  releaseLookup();
  await expect(
    page
      .locator('[data-message-bubble="true"]')
      .filter({ hasText: firstMessage.content as string }),
  ).toBeVisible();
  await expect(
    page.locator('[data-message-bubble="true"]').filter({ hasText: incoming.content as string }),
  ).toBeVisible();
  await expect(
    page.locator('[data-message-bubble="true"]').filter({ hasText: pending.content as string }),
  ).toBeVisible();
  const hiddenReads = fixture.restCalls("message_hidden_for_users", "GET");
  expect(hiddenReads.some((request) => request.search.includes(incoming.id as string))).toBe(true);
  expect(hiddenReads.every((request) => !request.search.includes("tmp:"))).toBe(true);
});

test("clearing a chat invalidates a history request already in flight", async ({ page }, info) => {
  test.skip(
    info.project.name !== "chromium-desktop-1440",
    "The clear-menu race is checked in the desktop layout.",
  );
  const old = message(
    "33333333-3333-4333-8333-3333333333d6",
    CHAT_ID,
    PEER,
    "History cleared during request",
    MESSAGE_AT,
  );
  const myMembership = membership(CHAT_ID, ME, "member", null);
  await openFixture(page, {
    me: ME,
    chats: [chat(CHAT_ID, "private", CHAT_NAME, MESSAGE_AT)],
    memberships: [myMembership, membership(CHAT_ID, PEER, "member", null)],
    messages: [old],
    rpc: (name) => {
      if (name !== "clear_chat_for_me") return undefined;
      myMembership.cleared_at = "2026-09-03T18:00:00.000Z";
      return { status: 200, body: null };
    },
  });
  let holdHistory = false;
  let signalHistory!: () => void;
  let releaseHistory!: () => void;
  const historyStarted = new Promise<void>((resolve) => {
    signalHistory = resolve;
  });
  const historyGate = new Promise<void>((resolve) => {
    releaseHistory = resolve;
  });
  await page.route("http://127.0.0.1:54321/rest/v1/message_hidden_for_users**", async (route) => {
    if (
      holdHistory &&
      route
        .request()
        .url()
        .includes(old.id as string)
    ) {
      holdHistory = false;
      signalHistory();
      await historyGate;
    }
    await route.fallback();
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("chat-list-item").filter({ hasText: PEER.full_name }).click();
  const oldBubble = page
    .locator('[data-message-bubble="true"]')
    .filter({ hasText: old.content as string });
  await expect(oldBubble).toBeVisible();
  holdHistory = true;
  await page.evaluate(
    (chatId) =>
      window.dispatchEvent(
        new CustomEvent("kub:chats-refresh", { detail: { reason: "message-realtime", chatId } }),
      ),
    CHAT_ID,
  );
  await historyStarted;
  await page.getByTestId("chat-header-shell").getByRole("button", { name: "Ещё" }).click();
  await page.locator('[data-chat-menu-item="Очистить историю у себя"]').click();
  await page.getByRole("button", { name: "Очистить", exact: true }).click();
  await expect(oldBubble).toHaveCount(0);
  releaseHistory();
  await page.waitForTimeout(400);
  await expect(oldBubble).toHaveCount(0);
});

for (const theme of ["light", "dark"] as const) {
  test(`fresh sidebar cleared_at skips the duplicate read in ${theme} mode`, async ({ page }) => {
    const fixture = await openFixture(page, {
      me: ME,
      chats: [chat(CHAT_ID, "private", CHAT_NAME, MESSAGE_AT)],
      memberships: [
        membership(CHAT_ID, ME, "member", null),
        membership(CHAT_ID, PEER, "member", null),
      ],
      messages: [
        message("33333333-3333-4333-8333-3333333333c1", CHAT_ID, PEER, MESSAGE_TEXT, MESSAGE_AT),
      ],
    });
    await page.addInitScript((value) => localStorage.setItem("kub-theme", value), theme);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const row = page.getByTestId("chat-list-item").filter({ hasText: PEER.full_name });
    await expect(row).toBeVisible();
    expect(
      fixture
        .restCalls("chat_members", "GET")
        .some((request) =>
          new URLSearchParams(request.search).get("select")?.includes("cleared_at"),
        ),
    ).toBe(true);

    const directBeforeOpen = directClearedAtReads(fixture).length;
    expect(directBeforeOpen, "a direct mark read happened before chat entry").toBe(0);
    const requestsBeforeOpen = fixture.requests.length;
    await row.click();
    await expect(
      page.locator('[data-message-bubble="true"]').filter({ hasText: MESSAGE_TEXT }),
    ).toBeVisible();
    expect(
      directClearedAtReads(fixture).length - directBeforeOpen,
      "the chat open repeated the fresh sidebar membership read",
    ).toBe(0);
    const entryRequests = fixture.requests.slice(requestsBeforeOpen);
    const timelineIndex = entryRequests.findIndex(
      (request) =>
        request.resource === "messages" &&
        new URLSearchParams(request.search).get("chat_id") === `eq.${CHAT_ID}` &&
        new URLSearchParams(request.search).get("order") === "created_at.desc,id.desc",
    );
    const hiddenIndex = entryRequests.findIndex(
      (request) => request.resource === "message_hidden_for_users",
    );
    expect(timelineIndex, "chat entry never fetched its message page").toBeGreaterThanOrEqual(0);
    expect(hiddenIndex, "hidden-message privacy check was skipped").toBeGreaterThan(timelineIndex);
  });
}

test("fresh cleared_at still filters older history and waits for hidden IDs", async ({ page }) => {
  const otherChatId = "22222222-2222-4222-8222-2222222222c2";
  const old = message(
    "33333333-3333-4333-8333-3333333333c2",
    CHAT_ID,
    PEER,
    "Cleared private text",
    "2026-09-01T09:00:00.000Z",
  );
  const hidden = message(
    "33333333-3333-4333-8333-3333333333c3",
    CHAT_ID,
    PEER,
    "Hidden private text",
    "2026-09-01T10:01:00.000Z",
  );
  const visible = message(
    "33333333-3333-4333-8333-3333333333c4",
    CHAT_ID,
    PEER,
    MESSAGE_TEXT,
    MESSAGE_AT,
  );
  const myMembership = { ...membership(CHAT_ID, ME, "member", null), cleared_at: CLEARED_AT };
  const fixture = await openFixture(page, {
    me: ME,
    chats: [
      chat(CHAT_ID, "private", CHAT_NAME, MESSAGE_AT),
      chat(otherChatId, "group", "Other audit", MESSAGE_AT),
    ],
    memberships: [
      myMembership,
      membership(CHAT_ID, PEER, "member", null),
      membership(otherChatId, ME, "member", null),
    ],
    messages: [old, visible, hidden],
    rest: ({ resource, method }) => {
      if (resource === "messages" && method === "GET")
        return { status: 200, body: [visible, hidden] };
      if (resource === "message_hidden_for_users" && method === "GET")
        return { status: 200, body: [{ message_id: hidden.id }] };
      return undefined;
    },
  });
  await page.route("http://127.0.0.1:54321/rest/v1/message_hidden_for_users**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    await route.fallback();
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const row = page.getByTestId("chat-list-item").filter({ hasText: PEER.full_name });
  await expect(row).toBeVisible();
  await page.evaluate(() => {
    const state = window as typeof window & { __hiddenBubbleSeen?: boolean };
    state.__hiddenBubbleSeen = false;
    const check = () => {
      if (
        [...document.querySelectorAll('[data-message-bubble="true"]')].some((bubble) =>
          bubble.textContent?.includes("Hidden private text"),
        )
      ) {
        state.__hiddenBubbleSeen = true;
      }
    };
    new MutationObserver(check).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
  await row.click();
  await expect(
    page.locator('[data-message-bubble="true"]').filter({ hasText: MESSAGE_TEXT }),
  ).toBeVisible();
  const timelineReads = fixture
    .restCalls("messages", "GET")
    .filter(
      (request) =>
        new URLSearchParams(request.search).get("chat_id") === `eq.${CHAT_ID}` &&
        new URLSearchParams(request.search).get("created_at") === `gt.${CLEARED_AT}`,
    );
  expect(timelineReads.length, "history query lost the cleared_at boundary").toBeGreaterThan(0);
  expect(
    await page.evaluate(
      () => (window as typeof window & { __hiddenBubbleSeen?: boolean }).__hiddenBubbleSeen,
    ),
  ).toBe(false);
  await expect(
    page.locator('[data-message-bubble="true"]').filter({ hasText: "Hidden private text" }),
  ).toHaveCount(0);
  await expect(
    page.locator('[data-message-bubble="true"]').filter({ hasText: "Cleared private text" }),
  ).toHaveCount(0);

  const back = page.getByRole("button", { name: "Назад", exact: true });
  if (await back.isVisible()) await back.click();
  await page.getByTestId("chat-list-item").filter({ hasText: "Other audit" }).click();
  if (await back.isVisible()) await back.click();
  await row.click();
  await expect(
    page.locator('[data-message-bubble="true"]').filter({ hasText: MESSAGE_TEXT }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as typeof window & { __hiddenBubbleSeen?: boolean }).__hiddenBubbleSeen,
    ),
  ).toBe(false);
});

test("a refused cleared_at lookup cannot start an unbounded history read", async ({ page }) => {
  let refuseMembership = false;
  const fixture = await openFixture(page, {
    me: ME,
    chats: [chat(CHAT_ID, "private", CHAT_NAME, MESSAGE_AT)],
    memberships: [
      membership(CHAT_ID, ME, "member", null),
      membership(CHAT_ID, PEER, "member", null),
    ],
    messages: [
      message("33333333-3333-4333-8333-3333333333c5", CHAT_ID, PEER, MESSAGE_TEXT, MESSAGE_AT),
    ],
    rest: ({ resource, method }) =>
      resource === "chat_members" && method === "GET" && refuseMembership
        ? { status: 503, body: { code: "PGRST503", message: "synthetic membership refusal" } }
        : undefined,
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const row = page.getByTestId("chat-list-item").filter({ hasText: PEER.full_name });
  await expect(row).toBeVisible();
  await page.clock.setFixedTime(new Date("2026-09-03T18:00:04.000Z"));
  refuseMembership = true;
  const refusal = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname.endsWith("/rest/v1/chat_members") &&
      url.searchParams.get("select") === "cleared_at"
    );
  });
  await row.click();
  await expect(page.getByTestId("chat-chrome-stack")).toBeVisible();
  expect((await refusal).status()).toBe(503);
  await page.waitForTimeout(300);
  expect(directClearedAtReads(fixture).length).toBeGreaterThan(0);
  await expect(
    page.locator('[data-message-bubble="true"]').filter({ hasText: MESSAGE_TEXT }),
  ).toHaveCount(0);
  expect(
    fixture
      .restCalls("messages", "GET")
      .filter(
        (request) =>
          new URLSearchParams(request.search).get("chat_id") === `eq.${CHAT_ID}` &&
          new URLSearchParams(request.search).get("order") === "created_at.desc,id.desc",
      ),
    "membership refusal was followed by an unbounded timeline query",
  ).toHaveLength(0);
});

test("cached history stays covered when a reopened chat cannot verify cleared_at", async ({
  page,
}) => {
  const otherChatId = "22222222-2222-4222-8222-2222222222c3";
  let refuseMembership = false;
  const fixture = await openFixture(page, {
    me: ME,
    chats: [
      chat(CHAT_ID, "private", CHAT_NAME, MESSAGE_AT),
      chat(otherChatId, "group", "Other audit", MESSAGE_AT),
    ],
    memberships: [
      membership(CHAT_ID, ME, "member", null),
      membership(CHAT_ID, PEER, "member", null),
      membership(otherChatId, ME, "member", null),
    ],
    messages: [
      message("33333333-3333-4333-8333-3333333333c6", CHAT_ID, PEER, MESSAGE_TEXT, MESSAGE_AT),
    ],
    rest: ({ resource, method }) =>
      resource === "chat_members" && method === "GET" && refuseMembership
        ? { status: 503, body: { code: "PGRST503", message: "synthetic membership refusal" } }
        : undefined,
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const first = page.getByTestId("chat-list-item").filter({ hasText: PEER.full_name });
  const other = page.getByTestId("chat-list-item").filter({ hasText: "Other audit" });
  const back = page.getByRole("button", { name: "Назад", exact: true });
  await first.click();
  await expect(
    page.locator('[data-message-bubble="true"]').filter({ hasText: MESSAGE_TEXT }),
  ).toBeVisible();
  if (await back.isVisible()) await back.click();
  await other.click();
  await expect(page.getByTestId("chat-chrome-stack")).toBeVisible();
  await page.evaluate((text) => {
    const state = window as typeof window & { __reopenedBubbleSeen?: boolean };
    state.__reopenedBubbleSeen = false;
    const check = () => {
      if (
        [...document.querySelectorAll('[data-message-bubble="true"]')].some((bubble) =>
          bubble.textContent?.includes(text),
        )
      ) {
        state.__reopenedBubbleSeen = true;
      }
    };
    new MutationObserver(check).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  }, MESSAGE_TEXT);

  await page.clock.setFixedTime(new Date("2026-09-03T18:00:04.000Z"));
  refuseMembership = true;
  if (await back.isVisible()) await back.click();
  const refusal = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname.endsWith("/rest/v1/chat_members") &&
      url.searchParams.get("select") === "cleared_at"
    );
  });
  await first.click();
  expect((await refusal).status()).toBe(503);
  await page.waitForTimeout(300);
  expect(directClearedAtReads(fixture).length).toBeGreaterThan(0);
  expect(
    await page.evaluate(
      () => (window as typeof window & { __reopenedBubbleSeen?: boolean }).__reopenedBubbleSeen,
    ),
  ).toBe(false);
  await expect(
    page.locator('[data-message-bubble="true"]').filter({ hasText: MESSAGE_TEXT }),
  ).toHaveCount(0);
});

test("a newly hidden cached message never flashes on warm reopen", async ({ page }) => {
  const otherChatId = "22222222-2222-4222-8222-2222222222c4";
  const hidden = message(
    "33333333-3333-4333-8333-3333333333c7",
    CHAT_ID,
    PEER,
    "Hidden after leaving",
    MESSAGE_AT,
  );
  let hiddenElsewhere = false;
  const fixture = await openFixture(page, {
    me: ME,
    chats: [
      chat(CHAT_ID, "private", CHAT_NAME, MESSAGE_AT),
      chat(otherChatId, "group", "Other audit", MESSAGE_AT),
    ],
    memberships: [
      membership(CHAT_ID, ME, "member", null),
      membership(CHAT_ID, PEER, "member", null),
      membership(otherChatId, ME, "member", null),
    ],
    messages: [hidden],
    rest: ({ resource, method }) =>
      resource === "message_hidden_for_users" && method === "GET"
        ? { status: 200, body: hiddenElsewhere ? [{ message_id: hidden.id }] : [] }
        : undefined,
  });
  await page.route("http://127.0.0.1:54321/rest/v1/message_hidden_for_users**", async (route) => {
    if (hiddenElsewhere) await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fallback();
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const first = page.getByTestId("chat-list-item").filter({ hasText: PEER.full_name });
  const other = page.getByTestId("chat-list-item").filter({ hasText: "Other audit" });
  const back = page.getByRole("button", { name: "Назад", exact: true });
  await first.click();
  await expect(
    page.locator('[data-message-bubble="true"]').filter({ hasText: hidden.content as string }),
  ).toBeVisible();
  if (await back.isVisible()) await back.click();
  await other.click();
  await expect(page.getByTestId("chat-chrome-stack")).toBeVisible();
  if (await back.isVisible()) await back.click();
  hiddenElsewhere = true;
  await page.evaluate((text) => {
    const state = window as typeof window & { __hiddenReopenFlash?: boolean };
    state.__hiddenReopenFlash = false;
    new MutationObserver(() => {
      if (
        [...document.querySelectorAll('[data-message-bubble="true"]')].some((bubble) =>
          bubble.textContent?.includes(text),
        )
      ) {
        state.__hiddenReopenFlash = true;
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  }, hidden.content as string);
  const readsBeforeReopen = fixture.restCalls("message_hidden_for_users", "GET").length;
  await first.click();
  await expect
    .poll(() => fixture.restCalls("message_hidden_for_users", "GET").length)
    .toBeGreaterThan(readsBeforeReopen);
  await expect(
    page.locator('[data-message-bubble="true"]').filter({ hasText: hidden.content as string }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => (window as typeof window & { __hiddenReopenFlash?: boolean }).__hiddenReopenFlash,
    ),
  ).toBe(false);
});

for (const theme of ["light", "dark"] as const) {
  test(`a refused hidden-message lookup cannot display unchecked messages in ${theme} mode`, async ({
    page,
  }, info) => {
    const messageRow = message(
      "33333333-3333-4333-8333-3333333333c8",
      CHAT_ID,
      PEER,
      "Unchecked hidden text",
      MESSAGE_AT,
    );
    let refuseHidden = true;
    const fixture = await openFixture(page, {
      me: ME,
      chats: [chat(CHAT_ID, "private", CHAT_NAME, MESSAGE_AT)],
      memberships: [
        membership(CHAT_ID, ME, "member", null),
        membership(CHAT_ID, PEER, "member", null),
      ],
      messages: [messageRow],
      rest: ({ resource, method }) =>
        resource === "message_hidden_for_users" && method === "GET"
          ? refuseHidden
            ? { status: 503, body: { code: "PGRST503", message: "synthetic hidden-ID refusal" } }
            : { status: 200, body: [] }
          : undefined,
    });
    await page.addInitScript((value) => localStorage.setItem("kub-theme", value), theme);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByTestId("chat-list-item").filter({ hasText: PEER.full_name }).click();
    await expect
      .poll(() => fixture.restCalls("message_hidden_for_users", "GET").length)
      .toBeGreaterThan(0);
    await page.waitForTimeout(250);
    await expect(
      page
        .locator('[data-message-bubble="true"]')
        .filter({ hasText: messageRow.content as string }),
    ).toHaveCount(0);
    await expect(page.getByText("Историю не удалось проверить")).toBeVisible();
    await page.screenshot({
      path: info.outputPath(`history-refused-${theme}.png`),
      fullPage: false,
    });
    refuseHidden = false;
    await page.getByRole("button", { name: "Повторить", exact: true }).click();
    await expect(
      page
        .locator('[data-message-bubble="true"]')
        .filter({ hasText: messageRow.content as string }),
    ).toBeVisible();
  });
}
