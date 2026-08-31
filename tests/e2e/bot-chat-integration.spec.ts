import { expect, test, type Page, type Route } from "@playwright/test";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const CHAT_ID = "22222222-2222-4222-8222-222222222222";
const BOT_ID = "33333333-3333-4333-8333-333333333333";
const DELETED_BOT_ID = "44444444-4444-4444-8444-444444444444";
const BOT_MESSAGE_ID = "55555555-5555-4555-8555-555555555555";
const DELETED_BOT_MESSAGE_ID = "66666666-6666-4666-8666-666666666666";
const NOTIFICATION_ID = "77777777-7777-4777-8777-777777777777";
const NOW = "2026-08-31T12:00:00.000Z";

test.describe("bot chat integration", () => {
  test.beforeEach(async ({ page }) => {
    await installSession(page);
    await installSupabaseFixture(page);
  });

  test("shows bot last-message identity, preview, and unread count before opening chat", async ({ page }) => {
    const lastMessageRequestPromise = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return (
        request.method() === "GET" &&
        url.pathname.includes("/rest/v1/messages") &&
        url.searchParams.get("select")?.startsWith("*") === true
      );
    });
    const unreadRequestPromise = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return (
        request.method() === "GET" &&
        url.pathname.includes("/rest/v1/messages") &&
        url.searchParams.get("select") === "id" &&
        (request.headers().prefer ?? "").includes("count=exact")
      );
    });
    await page.goto("/");

    const [lastMessageRequest, unreadRequest] = await Promise.all([
      lastMessageRequestPromise,
      unreadRequestPromise,
    ]);
    const lastMessageUrl = new URL(lastMessageRequest.url());
    const unreadUrl = new URL(unreadRequest.url());
    expect(lastMessageUrl.searchParams.get("order")).toBe("created_at.desc");
    expect(unreadUrl.searchParams.get("or")).toContain("bot_id.not.is.null");

    const chatRow = page.locator(`[data-testid="chat-list-item"][data-chat-id="${CHAT_ID}"]`);
    await expect(chatRow).toBeVisible();
    await expect.poll(() => page.evaluate(async () => {
      const { useAppStore } = await import("/src/store/app.store.ts");
      return useAppStore.getState().selectedChatId;
    })).toBeNull();
    await expect(page.locator(`[data-message-id="${BOT_MESSAGE_ID}"]`)).toHaveCount(0);
    await expect(chatRow).toContainText("Удалённый бот: Deleted bot message");
    await expect(chatRow).toHaveAttribute("data-unread-count", "2");
    await expect(chatRow.getByText("2", { exact: true })).toBeVisible();
  });

  test("renders active and deleted bot actors without human mutation controls", async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.includes("desktop"), "hover action coverage runs on desktop");
    await page.goto("/");
    await openFixtureChat(page);

    const activeRow = page.locator(`[data-message-id="${BOT_MESSAGE_ID}"]`);
    const deletedRow = page.locator(`[data-message-id="${DELETED_BOT_MESSAGE_ID}"]`);
    await expect(activeRow).toContainText("Automation Bot");
    await expect(activeRow.getByText("Бот", { exact: true })).toBeVisible();
    await expect(activeRow.locator('[data-message-actor-kind="bot"] img')).toBeVisible();
    await expect(deletedRow).toContainText("Удалённый бот");
    await expect(deletedRow.locator('[data-message-actor-kind="deleted_bot"]')).toBeVisible();

    await activeRow.hover();
    await activeRow.getByRole("button", { name: "Действия сообщения" }).click();
    await expect(page.getByText("Изменить", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Удалить для всех", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Удалить у себя", { exact: true })).toBeVisible();
  });

  test("keeps bots in a separate RPC-only search group and excludes phone queries", async ({ page }, testInfo) => {
    await page.goto("/");
    const input = await openSearch(page, testInfo.project.name.includes("mobile"));

    await input.fill("AutomationProbe");
    const resultRoot = testInfo.project.name.includes("mobile")
      ? page.getByTestId("global-search-palette")
      : page.getByTestId("sidebar-global-search-results");
    const botSection = resultRoot.locator('section[data-search-section="bot"]');
    await expect(botSection).toBeVisible();
    await expect(botSection).toContainText("Боты");
    await expect(botSection.getByText("Automation Bot", { exact: true })).toBeVisible();

    const phoneQuery = "+7 (999) 123-45-67";
    const queriesBeforePhone = await botSearchQueries(page);
    await input.fill(phoneQuery);
    await page.waitForTimeout(500);
    const queriesAfterPhone = await botSearchQueries(page);
    expect(queriesAfterPhone.slice(queriesBeforePhone.length)).not.toContain(phoneQuery);
    await expect(resultRoot.locator('section[data-search-section="bot"]')).toHaveCount(0);
  });

  test("preserves bot notification actor metadata and jumps to the exact message", async ({ page }) => {
    await page.addInitScript(() => {
      window.addEventListener("kub:chat-message-jump", (event) => {
        (window as typeof window & { __task6Jump?: unknown }).__task6Jump = (event as CustomEvent).detail;
      });
    });
    await page.goto("/");

    await page.getByTestId("notification-bell-button").click();
    const group = page.getByTestId("notification-message-group");
    await expect(group).toContainText("Automation Bot");
    await expect(group).toContainText("Bot notification probe");
    await group.click();

    await expect.poll(() => page.evaluate(() => (
      window as typeof window & { __task6Jump?: unknown }
    ).__task6Jump)).toEqual({ chatId: CHAT_ID, messageId: BOT_MESSAGE_ID });
    await expect(page.locator(`[data-message-id="${BOT_MESSAGE_ID}"]`)).toBeVisible();
  });
});

async function openFixtureChat(page: Page) {
  await expect.poll(() => page.evaluate(async (targetChatId) => {
    const { useAppStore } = await import("/src/store/app.store.ts");
    return useAppStore.getState().chats.some((chat) => chat.id === targetChatId);
  }, CHAT_ID)).toBe(true);
  await page.evaluate(async (targetChatId) => {
    const { useAppStore } = await import("/src/store/app.store.ts");
    useAppStore.getState().setSelectedChatId(targetChatId);
  }, CHAT_ID);
  await expect(page.locator(`[data-message-id="${BOT_MESSAGE_ID}"]`)).toBeVisible();
}

async function openSearch(page: Page, mobile: boolean) {
  if (mobile) {
    await page.getByRole("button", { name: /^Поиск$/i }).click();
    const input = page.getByTestId("global-search-input");
    await expect(input).toBeFocused();
    return input;
  }
  const input = page.getByTestId("sidebar-search-input");
  await expect(input).toBeVisible();
  await input.click();
  await expect(input).toBeFocused();
  return input;
}

async function botSearchQueries(page: Page): Promise<string[]> {
  return page.evaluate(() => [...((window as typeof window & { __task6BotSearchQueries?: string[] }).__task6BotSearchQueries ?? [])]);
}

async function installSession(page: Page) {
  await page.addInitScript(({ userId, now }) => {
    const user = {
      id: userId,
      aud: "authenticated",
      role: "authenticated",
      email: "bot-chat-qa@example.invalid",
      user_metadata: { full_name: "Bot Chat QA" },
      app_metadata: {},
      created_at: now,
    };
    localStorage.setItem("kub-theme", "dark");
    localStorage.setItem(
      "kub-auth",
      JSON.stringify({
        access_token: "playwright.user.jwt",
        refresh_token: "playwright-refresh",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        token_type: "bearer",
        user,
      }),
    );
  }, { userId: USER_ID, now: NOW });
}

async function installSupabaseFixture(page: Page) {
  const profile = {
    id: USER_ID,
    full_name: "Bot Chat QA",
    username: "bot_chat_qa",
    avatar_url: null,
    bio: null,
    role: "admin",
    online_at: NOW,
    created_at: NOW,
    updated_at: NOW,
  };
  const membership = {
    chat_id: CHAT_ID,
    user_id: USER_ID,
    role: "owner",
    joined_at: "2026-08-31T11:00:00.000Z",
    last_read_at: "2026-08-31T11:30:00.000Z",
    last_delivered_at: "2026-08-31T11:30:00.000Z",
    hidden_at: null,
    cleared_at: null,
    pinned: false,
    pinned_at: null,
    pinned_order: null,
    profile,
  };
  const messages = [activeBotMessage(), deletedBotMessage()];
  const notification = {
    id: NOTIFICATION_ID,
    user_id: USER_ID,
    kind: "message_received",
    payload: {
      chat_id: CHAT_ID,
      message_id: BOT_MESSAGE_ID,
      sender_kind: "bot",
      sender_id: null,
      bot_id: BOT_ID,
      sender_name: "Automation Bot",
      sender_avatar_url: "/icons/icon-192.png",
      message_type: "text",
      preview: "Bot notification probe",
      route: `/?chat=${CHAT_ID}&message=${BOT_MESSAGE_ID}`,
      group_tag: `message:chat:${CHAT_ID}`,
      chat_name: "Task 6 chat",
      chat_type: "group",
    },
    read_at: null,
    created_at: "2026-08-31T12:02:00.000Z",
  };

  await page.addInitScript(() => {
    (window as typeof window & { __task6BotSearchQueries?: string[] }).__task6BotSearchQueries = [];
  });
  await page.route("http://127.0.0.1:54321/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const accept = request.headers().accept ?? "";

    if (url.pathname === "/auth/v1/user") return json(route, profile);
    if (url.pathname.includes("/rest/v1/profiles")) return json(route, profile);
    if (url.pathname.includes("/rest/v1/chat_members")) {
      return json(route, accept.includes("application/vnd.pgrst.object") ? membership : [membership]);
    }
    if (url.pathname.includes("/rest/v1/chats")) {
      return json(route, [{
        id: CHAT_ID,
        type: "group",
        name: "Task 6 chat",
        description: null,
        avatar_url: null,
        created_by: USER_ID,
        created_at: "2026-08-31T11:00:00.000Z",
        updated_at: "2026-08-31T12:01:00.000Z",
        is_forum: false,
        invite_policy: "admins_only",
        members: [membership],
      }]);
    }
    if (url.pathname.endsWith("/rpc/chat_list_summaries")) {
      return json(route, {
        code: "PGRST202",
        details: null,
        hint: null,
        message: "Could not find the function public.chat_list_summaries",
      }, 404);
    }
    if (url.pathname.endsWith("/rpc/search_public_bots")) {
      const payload = (request.postDataJSON() ?? {}) as { p_query?: unknown };
      await page.evaluate((query) => {
        const target = window as typeof window & { __task6BotSearchQueries?: string[] };
        target.__task6BotSearchQueries ??= [];
        target.__task6BotSearchQueries.push(query);
      }, String(payload.p_query ?? ""));
      return json(route, [{
        id: BOT_ID,
        username: "automation_probe_bot",
        display_name: "Automation Bot",
        description: "Task 6 public bot",
        avatar_url: "/icons/icon-192.png",
      }]);
    }
    if (url.pathname.endsWith("/rpc/global_search_v2")) return json(route, []);
    if (url.pathname.includes("/rest/v1/messages")) {
      if (request.method() !== "GET") return json(route, []);
      const exactCountRequested = (request.headers().prefer ?? "").includes("count=exact");
      if (!exactCountRequested) {
        const rows = [...messages];
        if (url.searchParams.get("order") === "created_at.desc") {
          rows.sort((left, right) => (
            new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
          ));
        }
        const limit = Number(url.searchParams.get("limit") ?? rows.length);
        return json(route, rows.slice(0, Number.isFinite(limit) ? limit : rows.length));
      }

      const actorFilter = url.searchParams.get("or") ?? "";
      const readFilter = url.searchParams.get("created_at") ?? "";
      const readAfter = readFilter.startsWith("gt.")
        ? new Date(readFilter.slice(3)).getTime()
        : Number.POSITIVE_INFINITY;
      const unreadRows = actorFilter.includes("bot_id.not.is.null")
        ? messages.filter((message) => new Date(message.created_at).getTime() > readAfter)
        : [];
      const limit = Number(url.searchParams.get("limit") ?? unreadRows.length);
      const returnedRows = unreadRows
        .slice(0, Number.isFinite(limit) ? limit : unreadRows.length)
        .map(({ id }) => ({ id }));
      const contentRange = returnedRows.length > 0
        ? `0-${returnedRows.length - 1}/${unreadRows.length}`
        : `*/${unreadRows.length}`;
      return json(
        route,
        returnedRows,
        200,
        {
          "access-control-expose-headers": "Content-Range",
          "content-range": contentRange,
        },
      );
    }
    if (url.pathname.includes("/rest/v1/message_hidden_for_users")) return json(route, []);
    if (url.pathname.includes("/rest/v1/notifications")) return json(route, request.method() === "GET" ? [notification] : []);
    if (url.pathname.includes("/rest/v1/rpc/")) return json(route, null);
    return json(route, []);
  });
}

function activeBotMessage() {
  return message(BOT_MESSAGE_ID, BOT_ID, "Deployment check complete", {
    id: BOT_ID,
    username: "automation_probe_bot",
    display_name: "Automation Bot",
    description: "Task 6 public bot",
    avatar_url: "/icons/icon-192.png",
    state: "active",
    created_at: NOW,
    updated_at: NOW,
  }, "2026-08-31T12:01:00.000Z");
}

function deletedBotMessage() {
  return message(DELETED_BOT_MESSAGE_ID, DELETED_BOT_ID, "Deleted bot message", {
    id: DELETED_BOT_ID,
    username: "deleted_probe_bot",
    display_name: "Deleted bot",
    description: "",
    avatar_url: null,
    state: "deleted",
    created_at: NOW,
    updated_at: NOW,
  }, "2026-08-31T12:02:00.000Z");
}

function message(id: string, botId: string, content: string, bot: Record<string, unknown>, createdAt: string) {
  return {
    id,
    chat_id: CHAT_ID,
    topic_id: null,
    user_id: null,
    bot_id: botId,
    sender_deleted_at: null,
    content,
    type: "text",
    media_bucket: null,
    media_path: null,
    media_url: null,
    media_metadata: {},
    reply_to_id: null,
    reply_to: null,
    forwarded_from_id: null,
    forwarded_from: null,
    client_message_id: null,
    client_sent_at: null,
    bot_reply_markup: null,
    pinned: false,
    created_at: createdAt,
    edited_at: null,
    deleted_at: null,
    sender: null,
    bot,
    reactions: [],
  };
}

async function json(
  route: Route,
  body: unknown,
  status = 200,
  headers?: Record<string, string>,
) {
  await route.fulfill({
    status,
    contentType: "application/json",
    headers,
    body: JSON.stringify(body),
  });
}
