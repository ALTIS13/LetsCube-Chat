import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

/**
 * Complaint 5: «переслал сообщение — ничего не произошло».
 *
 * Choosing a chat in the forward dialog closed the dialog, and nothing else
 * happened — whatever the server answered. `forwardMessage` sent a refusal to
 * the console and returned null, and `ChatWindow` awaited it without reading
 * the answer before closing the dialog. A forward the server refused and one it
 * delivered looked exactly alike, so nobody could tell whether to try again.
 *
 * What is pinned: a delivered forward confirms itself and names the chat; a
 * refused one says so with the server's reason and leaves the next attempt one
 * send away; one that never reaches the server is not passed off as sent.
 *
 * 2026-09-11, the owner's Telegram message actions (D-071): choosing the chat
 * no longer sends anything. The chat opens with the message waiting above its
 * composer, a comment can be typed beside it, and the send forwards it. The
 * feedback moved with the send, and so did where a refused forward is kept:
 * the dialog has already closed, so the message goes back above the composer
 * instead of the choice staying open in the dialog. That choosing sends
 * nothing is pinned too — a forward that went out on the click would pass the
 * rest of this file.
 *
 * The backend is a route mock on the fixture host, so the dev server has to be
 * started with `VITE_SUPABASE_URL=http://127.0.0.1:54321`. The spec refuses to
 * run against any other configuration, and aborts every request to a host that
 * is not this machine, so a misconfigured server cannot reach a real backend.
 */

const FIXTURE_HOST = "http://127.0.0.1:54321";
const USER_ID = "11111111-1111-4111-8111-1111111111f1";
const OTHER_ID = "11111111-1111-4111-8111-1111111111f2";
const SOURCE_CHAT_ID = "22222222-2222-4222-8222-2222222222f1";
const TARGET_CHAT_ID = "22222222-2222-4222-8222-2222222222f2";
const SOURCE_MESSAGE_ID = "55555555-5555-4555-8555-5555555555f1";
const FORWARDED_MESSAGE_ID = "55555555-5555-4555-8555-5555555555f2";
const NOW = "2026-09-03T12:00:00.000Z";
const SOURCE_NAME = "Команда проекта";
const TARGET_NAME = "Архив задач";
const MESSAGE_TEXT = "План на пятницу: созвон в десять";

type ServerAnswer = "deliver" | "refuse" | "unreachable";

test.describe("forwarding a message says what happened", () => {
  test.beforeEach(async ({ page, request }) => {
    const client = await request
      .get("/src/lib/supabase/client.ts")
      .then((response) => response.text())
      .catch(() => "");
    if (!client.includes(FIXTURE_HOST)) {
      throw new Error(
        `This spec mocks the backend at ${FIXTURE_HOST}. Start the dev server with VITE_SUPABASE_URL=${FIXTURE_HOST} and VITE_SUPABASE_ANON_KEY=playwright-public-fixture; it will not run against any other configuration.`,
      );
    }
    await page.route(
      (url) => url.hostname !== "127.0.0.1" && url.hostname !== "localhost",
      (route) => route.abort("blockedbyclient"),
    );
    await installSession(page);
  });

  test("a forward the server delivers confirms itself and names the chat", async ({ page }) => {
    const forwards = await installBackend(page, "deliver");
    const { draft } = await forwardFromSourceChat(page, forwards);

    const feedback = page.getByTestId("kub-feedback-viewport");
    const confirmation = feedback.getByRole("status");
    await expect(confirmation).toContainText("Сообщение переслано");
    await expect(confirmation).toContainText(TARGET_NAME);
    await expect(feedback.getByRole("alert")).toHaveCount(0);
    await expect(draft, "a delivered forward is still waiting above the composer").toHaveCount(0);

    expect(forwards).toHaveLength(1);
    expect(forwards[0]).toMatchObject({
      chat_id: TARGET_CHAT_ID,
      user_id: USER_ID,
      forwarded_from_id: SOURCE_MESSAGE_ID,
    });
  });

  test("a forward the server refuses is reported with its reason, and the message waits to be sent again", async ({ page }) => {
    const forwards = await installBackend(page, "refuse");
    const { draft } = await forwardFromSourceChat(page, forwards);

    const feedback = page.getByTestId("kub-feedback-viewport");
    const alert = feedback.getByRole("alert");
    await expect(alert).toContainText("Не удалось переслать сообщение");
    await expect(alert).toContainText("Недостаточно прав для этого действия.");
    await expect(feedback.getByRole("status")).toHaveCount(0);

    // Above the composer is where the next attempt starts, so the refused
    // message goes back there rather than being dropped with the send.
    await expect(draft).toBeVisible();
    await expect(draft).toContainText("Переслать сообщение");
    expect(forwards).toHaveLength(1);
  });

  test("a forward that never reaches the server is not passed off as sent", async ({ page }) => {
    const forwards = await installBackend(page, "unreachable");
    const { draft } = await forwardFromSourceChat(page, forwards);

    const feedback = page.getByTestId("kub-feedback-viewport");
    const alert = feedback.getByRole("alert");
    await expect(alert).toContainText("Не удалось переслать сообщение");
    await expect(alert).toContainText("Сетевой сбой");
    await expect(feedback.getByRole("status")).toHaveCount(0);
    await expect(draft).toBeVisible();
  });
});

async function forwardFromSourceChat(
  page: Page,
  forwards: Array<Record<string, unknown>>,
): Promise<{ draft: Locator }> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const row = page.getByTestId("chat-list-item").filter({ hasText: SOURCE_NAME });
  await expect(row).toBeVisible();
  await row.click();

  const bubble = page.locator('[data-message-bubble="true"]').filter({ hasText: MESSAGE_TEXT });
  await expect(bubble).toBeVisible();
  await bubble.click({ button: "right" });
  await page.locator("[data-action-menu]").getByRole("menuitem", { name: "Переслать", exact: true }).click();

  const dialog = page.getByRole("dialog").filter({ hasText: "Переслать в…" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: new RegExp(TARGET_NAME) }).click();

  // Choosing the chat sends nothing: the dialog closes, and the message waits
  // above the target chat's composer until the send.
  await expect(dialog).toHaveCount(0);
  const draft = page.getByTestId("composer-forward-draft");
  await expect(draft).toContainText("Переслать сообщение");
  await expect(draft).toContainText(MESSAGE_TEXT);
  expect(forwards, "choosing the chat already sent the forward").toHaveLength(0);

  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  return { draft };
}

async function installSession(page: Page) {
  await page.addInitScript(({ userId, now }) => {
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
          email: "forward-qa@example.invalid",
          user_metadata: { full_name: "Максим" },
          app_metadata: {},
          created_at: now,
        },
      }),
    );
  }, { userId: USER_ID, now: NOW });
}

async function installBackend(page: Page, answer: ServerAnswer): Promise<Array<Record<string, unknown>>> {
  const forwards: Array<Record<string, unknown>> = [];
  const me = profile(USER_ID, "Максим", "maksim");
  const anya = profile(OTHER_ID, "Аня", null);
  const memberships = [SOURCE_CHAT_ID, TARGET_CHAT_ID].flatMap((chatId) => [
    membership(chatId, USER_ID, "owner", me),
    membership(chatId, OTHER_ID, "member", anya),
  ]);
  const chats = [
    chat(SOURCE_CHAT_ID, SOURCE_NAME, "2026-09-03T11:30:00.000Z", memberships),
    chat(TARGET_CHAT_ID, TARGET_NAME, "2026-09-03T10:00:00.000Z", memberships),
  ];
  const messages = [
    message(SOURCE_MESSAGE_ID, SOURCE_CHAT_ID, OTHER_ID, MESSAGE_TEXT, "2026-09-03T11:30:00.000Z", anya),
  ];

  await page.route(`${FIXTURE_HOST}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const single = (request.headers().accept ?? "").includes("application/vnd.pgrst.object");
    // Only `eq.` narrows the rows. Any other operator — the chat list asks for
    // `id=in.(…)` — returns every row, which for these two chats is the answer.
    const eq = (name: string) => {
      const filter = url.searchParams.get(name);
      return filter?.startsWith("eq.") ? filter.slice(3) : null;
    };
    const one = <T,>(rows: T[]) => (single ? rows[0] ?? null : rows);

    if (url.pathname === "/auth/v1/user") {
      return json(route, { id: USER_ID, aud: "authenticated", role: "authenticated", email: "forward-qa@example.invalid", user_metadata: { full_name: "Максим" }, app_metadata: {}, created_at: NOW });
    }
    if (url.pathname.includes("/rest/v1/profiles")) return json(route, one([me]));
    if (url.pathname.includes("/rest/v1/chat_members")) {
      const chatId = eq("chat_id");
      const userId = eq("user_id");
      return json(route, one(memberships.filter((row) =>
        (!chatId || row.chat_id === chatId) && (!userId || row.user_id === userId),
      )));
    }
    if (url.pathname.endsWith("/rpc/chat_list_summaries")) {
      return json(route, { code: "PGRST202", details: null, hint: null, message: "Could not find the function public.chat_list_summaries" }, 404);
    }
    if (url.pathname.includes("/rest/v1/chats")) {
      if (method !== "GET") return route.fulfill({ status: 204 });
      const id = eq("id");
      return json(route, one(chats.filter((row) => !id || row.id === id)));
    }
    if (url.pathname.endsWith("/rest/v1/messages") && method === "POST") {
      const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
      forwards.push(body);
      if (answer === "unreachable") return route.abort("internetdisconnected");
      if (answer === "refuse") {
        return json(route, {
          code: "42501",
          details: null,
          hint: null,
          message: 'new row violates row-level security policy for table "messages"',
        }, 403);
      }
      return json(route, {
        ...message(FORWARDED_MESSAGE_ID, String(body.chat_id), USER_ID, String(body.content ?? ""), NOW, me),
        forwarded_from_id: body.forwarded_from_id ?? null,
        client_message_id: body.client_message_id ?? null,
        client_sent_at: body.client_sent_at ?? null,
      }, 201);
    }
    if (url.pathname.includes("/rest/v1/messages")) {
      if (method !== "GET") return json(route, []);
      const chatId = eq("chat_id");
      const rows = messages.filter((row) => !chatId || row.chat_id === chatId);
      if ((request.headers().prefer ?? "").includes("count=exact")) {
        return json(route, [], 200, { "access-control-expose-headers": "Content-Range", "content-range": "*/0" });
      }
      const limit = Number(url.searchParams.get("limit") ?? rows.length);
      return json(route, one(rows.slice(0, Number.isFinite(limit) ? limit : rows.length)));
    }
    if (url.pathname.includes("/rest/v1/rpc/")) return json(route, null);
    return json(route, single ? null : []);
  });

  return forwards;
}

function profile(id: string, fullName: string, username: string | null) {
  return {
    id,
    full_name: fullName,
    username,
    avatar_url: null,
    bio: null,
    role: "user",
    online_at: NOW,
    created_at: NOW,
    updated_at: NOW,
  };
}

function membership(chatId: string, userId: string, role: string, person: ReturnType<typeof profile>) {
  return {
    chat_id: chatId,
    user_id: userId,
    role,
    joined_at: "2026-09-01T09:00:00.000Z",
    last_read_at: NOW,
    last_delivered_at: NOW,
    hidden_at: null,
    cleared_at: null,
    pinned: false,
    pinned_at: null,
    pinned_order: null,
    profile: person,
  };
}

function chat(id: string, name: string, updatedAt: string, memberships: Array<ReturnType<typeof membership>>) {
  return {
    id,
    type: "group",
    name,
    description: null,
    avatar_url: null,
    created_by: USER_ID,
    created_at: "2026-09-01T09:00:00.000Z",
    updated_at: updatedAt,
    is_forum: false,
    invite_policy: "admins_only",
    members: memberships.filter((row) => row.chat_id === id),
  };
}

function message(id: string, chatId: string, userId: string, content: string, createdAt: string, sender: ReturnType<typeof profile>) {
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
    sender,
    bot: null,
    reactions: [],
  };
}

async function json(route: Route, body: unknown, status = 200, headers?: Record<string, string>) {
  await route.fulfill({
    status,
    contentType: "application/json",
    headers,
    body: JSON.stringify(body),
  });
}
