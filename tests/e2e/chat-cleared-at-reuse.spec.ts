import { expect, test } from "@playwright/test";
import {
  chat,
  membership,
  message,
  openFixture,
  person,
  requireFixtureServer,
  type Fixture,
} from "./helpers/messageActionsFixture";

const ME = person("11111111-1111-4111-8111-1111111111c1", "Audit Me");
const PEER = person("11111111-1111-4111-8111-1111111111c2", "Audit Peer");
const CHAT_ID = "22222222-2222-4222-8222-2222222222c1";
const CHAT_NAME = "Fresh membership audit";
const MESSAGE_TEXT = "Fresh membership message";
const MESSAGE_AT = "2026-09-01T10:00:00.000Z";
const CLEARED_AT = "2026-09-01T09:30:00.000Z";

function directClearedAtReads(fixture: Fixture) {
  return fixture.restCalls("chat_members", "GET").filter((request) =>
    new URLSearchParams(request.search).get("select") === "cleared_at"
  );
}

test.beforeEach(async ({ page, request }) => {
  await requireFixtureServer(request);
  await page.clock.setFixedTime(new Date("2026-09-03T18:00:00.000Z"));
});

for (const theme of ["light", "dark"] as const) {
  test(`fresh sidebar cleared_at skips the duplicate read in ${theme} mode`, async ({ page }) => {
    const fixture = await openFixture(page, {
      me: ME,
      chats: [chat(CHAT_ID, "private", CHAT_NAME, MESSAGE_AT)],
      memberships: [membership(CHAT_ID, ME, "member", null), membership(CHAT_ID, PEER, "member", null)],
      messages: [message("33333333-3333-4333-8333-3333333333c1", CHAT_ID, PEER, MESSAGE_TEXT, MESSAGE_AT)],
    });
    await page.addInitScript((value) => localStorage.setItem("kub-theme", value), theme);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const row = page.getByTestId("chat-list-item").filter({ hasText: PEER.full_name });
    await expect(row).toBeVisible();
    expect(fixture.restCalls("chat_members", "GET").some((request) =>
      new URLSearchParams(request.search).get("select")?.includes("cleared_at")
    )).toBe(true);

    const directBeforeOpen = directClearedAtReads(fixture).length;
    expect(directBeforeOpen, "a direct mark read happened before chat entry").toBe(0);
    const requestsBeforeOpen = fixture.requests.length;
    await row.click();
    await expect(page.locator('[data-message-bubble="true"]').filter({ hasText: MESSAGE_TEXT })).toBeVisible();
    expect(directClearedAtReads(fixture).length - directBeforeOpen, "the chat open repeated the fresh sidebar membership read").toBe(0);
    const entryRequests = fixture.requests.slice(requestsBeforeOpen);
    const timelineIndex = entryRequests.findIndex((request) => request.resource === "messages" &&
      new URLSearchParams(request.search).get("chat_id") === `eq.${CHAT_ID}` &&
      new URLSearchParams(request.search).get("order") === "created_at.desc,id.desc"
    );
    const hiddenIndex = entryRequests.findIndex((request) => request.resource === "message_hidden_for_users");
    expect(timelineIndex, "chat entry never fetched its message page").toBeGreaterThanOrEqual(0);
    expect(hiddenIndex, "hidden-message privacy check was skipped").toBeGreaterThan(timelineIndex);
  });
}

test("fresh cleared_at still filters older history and waits for hidden IDs", async ({ page }) => {
  const otherChatId = "22222222-2222-4222-8222-2222222222c2";
  const old = message("33333333-3333-4333-8333-3333333333c2", CHAT_ID, PEER, "Cleared private text", "2026-09-01T09:00:00.000Z");
  const hidden = message("33333333-3333-4333-8333-3333333333c3", CHAT_ID, PEER, "Hidden private text", "2026-09-01T10:01:00.000Z");
  const visible = message("33333333-3333-4333-8333-3333333333c4", CHAT_ID, PEER, MESSAGE_TEXT, MESSAGE_AT);
  const myMembership = { ...membership(CHAT_ID, ME, "member", null), cleared_at: CLEARED_AT };
  const fixture = await openFixture(page, {
    me: ME,
    chats: [chat(CHAT_ID, "private", CHAT_NAME, MESSAGE_AT), chat(otherChatId, "group", "Other audit", MESSAGE_AT)],
    memberships: [myMembership, membership(CHAT_ID, PEER, "member", null), membership(otherChatId, ME, "member", null)],
    messages: [old, visible, hidden],
    rest: ({ resource, method }) => {
      if (resource === "messages" && method === "GET") return { status: 200, body: [visible, hidden] };
      if (resource === "message_hidden_for_users" && method === "GET") return { status: 200, body: [{ message_id: hidden.id }] };
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
      if ([...document.querySelectorAll('[data-message-bubble="true"]')].some((bubble) => bubble.textContent?.includes("Hidden private text"))) {
        state.__hiddenBubbleSeen = true;
      }
    };
    new MutationObserver(check).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await row.click();
  await expect(page.locator('[data-message-bubble="true"]').filter({ hasText: MESSAGE_TEXT })).toBeVisible();
  const timelineReads = fixture.restCalls("messages", "GET").filter((request) =>
    new URLSearchParams(request.search).get("chat_id") === `eq.${CHAT_ID}` &&
    new URLSearchParams(request.search).get("created_at") === `gt.${CLEARED_AT}`
  );
  expect(timelineReads.length, "history query lost the cleared_at boundary").toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as typeof window & { __hiddenBubbleSeen?: boolean }).__hiddenBubbleSeen)).toBe(false);
  await expect(page.locator('[data-message-bubble="true"]').filter({ hasText: "Hidden private text" })).toHaveCount(0);
  await expect(page.locator('[data-message-bubble="true"]').filter({ hasText: "Cleared private text" })).toHaveCount(0);

  const back = page.getByRole("button", { name: "Назад", exact: true });
  if (await back.isVisible()) await back.click();
  await page.getByTestId("chat-list-item").filter({ hasText: "Other audit" }).click();
  if (await back.isVisible()) await back.click();
  await row.click();
  await expect(page.locator('[data-message-bubble="true"]').filter({ hasText: MESSAGE_TEXT })).toBeVisible();
  expect(await page.evaluate(() => (window as typeof window & { __hiddenBubbleSeen?: boolean }).__hiddenBubbleSeen)).toBe(false);
});

test("a refused cleared_at lookup cannot start an unbounded history read", async ({ page }) => {
  let refuseMembership = false;
  const fixture = await openFixture(page, {
    me: ME,
    chats: [chat(CHAT_ID, "private", CHAT_NAME, MESSAGE_AT)],
    memberships: [membership(CHAT_ID, ME, "member", null), membership(CHAT_ID, PEER, "member", null)],
    messages: [message("33333333-3333-4333-8333-3333333333c5", CHAT_ID, PEER, MESSAGE_TEXT, MESSAGE_AT)],
    rest: ({ resource, method }) => resource === "chat_members" && method === "GET" && refuseMembership
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
    return url.pathname.endsWith("/rest/v1/chat_members") && url.searchParams.get("select") === "cleared_at";
  });
  await row.click();
  await expect(page.getByTestId("chat-chrome-stack")).toBeVisible();
  expect((await refusal).status()).toBe(503);
  await page.waitForTimeout(300);
  expect(directClearedAtReads(fixture).length).toBeGreaterThan(0);
  await expect(page.locator('[data-message-bubble="true"]').filter({ hasText: MESSAGE_TEXT })).toHaveCount(0);
  expect(fixture.restCalls("messages", "GET").filter((request) =>
    new URLSearchParams(request.search).get("chat_id") === `eq.${CHAT_ID}` &&
    new URLSearchParams(request.search).get("order") === "created_at.desc,id.desc"
  ), "membership refusal was followed by an unbounded timeline query").toHaveLength(0);
});

test("cached history stays covered when a reopened chat cannot verify cleared_at", async ({ page }) => {
  const otherChatId = "22222222-2222-4222-8222-2222222222c3";
  let refuseMembership = false;
  const fixture = await openFixture(page, {
    me: ME,
    chats: [chat(CHAT_ID, "private", CHAT_NAME, MESSAGE_AT), chat(otherChatId, "group", "Other audit", MESSAGE_AT)],
    memberships: [membership(CHAT_ID, ME, "member", null), membership(CHAT_ID, PEER, "member", null), membership(otherChatId, ME, "member", null)],
    messages: [message("33333333-3333-4333-8333-3333333333c6", CHAT_ID, PEER, MESSAGE_TEXT, MESSAGE_AT)],
    rest: ({ resource, method }) => resource === "chat_members" && method === "GET" && refuseMembership
      ? { status: 503, body: { code: "PGRST503", message: "synthetic membership refusal" } }
      : undefined,
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const first = page.getByTestId("chat-list-item").filter({ hasText: PEER.full_name });
  const other = page.getByTestId("chat-list-item").filter({ hasText: "Other audit" });
  const back = page.getByRole("button", { name: "Назад", exact: true });
  await first.click();
  await expect(page.locator('[data-message-bubble="true"]').filter({ hasText: MESSAGE_TEXT })).toBeVisible();
  if (await back.isVisible()) await back.click();
  await other.click();
  await expect(page.getByTestId("chat-chrome-stack")).toBeVisible();
  await page.evaluate((text) => {
    const state = window as typeof window & { __reopenedBubbleSeen?: boolean };
    state.__reopenedBubbleSeen = false;
    const check = () => {
      if ([...document.querySelectorAll('[data-message-bubble="true"]')].some((bubble) => bubble.textContent?.includes(text))) {
        state.__reopenedBubbleSeen = true;
      }
    };
    new MutationObserver(check).observe(document.body, { subtree: true, childList: true, characterData: true });
  }, MESSAGE_TEXT);

  await page.clock.setFixedTime(new Date("2026-09-03T18:00:04.000Z"));
  refuseMembership = true;
  if (await back.isVisible()) await back.click();
  const refusal = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith("/rest/v1/chat_members") && url.searchParams.get("select") === "cleared_at";
  });
  await first.click();
  expect((await refusal).status()).toBe(503);
  await page.waitForTimeout(300);
  expect(directClearedAtReads(fixture).length).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as typeof window & { __reopenedBubbleSeen?: boolean }).__reopenedBubbleSeen)).toBe(false);
  await expect(page.locator('[data-message-bubble="true"]').filter({ hasText: MESSAGE_TEXT })).toHaveCount(0);
});
