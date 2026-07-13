import { expect, type Page, test } from "@playwright/test";
import {
  findFirstAvailableQaRole,
  gotoOrSkip,
  hasSavedAuthState,
  loadQaCredentials,
  loadQaEnvValues,
  loginAsRoleOrSkip,
} from "./helpers/auth";

test.describe("LETSCUBE notification center", () => {
  test("opens with category tabs and keeps messages separate from tasks", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => {
      consoleErrors.push(error.message);
    });

    const role = findFirstAvailableQaRole(
      ["owner", "tech_admin", "location_admin", "location_staff", "client"],
      { includeDefault: true },
    );
    test.skip(!role, "QA credentials or auth state are not configured");

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);

    await page.getByTestId("notification-bell-button").click();
    const panel = page.getByTestId("notification-panel");
    await expect(panel).toBeVisible();

    for (const tab of ["all", "tasks", "messages", "system"]) {
      await expect(page.getByTestId(`notification-tab-${tab}`)).toBeVisible();
    }

    await page.getByTestId("notification-tab-tasks").click();
    await expect(page.getByTestId("notification-tab-tasks")).toHaveAttribute(
      "data-state",
      "active",
    );
    await page.getByTestId("notification-tab-messages").click();
    await expect(page.getByTestId("notification-tab-messages")).toHaveAttribute(
      "data-state",
      "active",
    );
    await page.getByTestId("notification-tab-system").click();
    await expect(page.getByTestId("notification-tab-system")).toHaveAttribute(
      "data-state",
      "active",
    );
    await page.getByTestId("notification-tab-all").click();
    await expect(page.getByTestId("notification-tab-all")).toHaveAttribute("data-state", "active");

    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();

    const unexpectedConsoleErrors = consoleErrors.filter(
      (message) =>
        !message.includes("Failed to load resource") &&
        !message.includes("Missing Supabase environment variables"),
    );
    expect(
      unexpectedConsoleErrors,
      `Unexpected console errors:\n${unexpectedConsoleErrors.join("\n")}`,
    ).toEqual([]);
  });

  test("clears recipient message notifications when the chat is read", async ({
    browser,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium-desktop-1440",
      "mutation read-sync check runs once",
    );
    const env = loadQaEnvValues();
    const allowMutations = process.env.KUB_QA_ALLOW_MUTATIONS || env.get("KUB_QA_ALLOW_MUTATIONS");
    const supabaseUrl = process.env.KUB_QA_SUPABASE_URL || env.get("KUB_QA_SUPABASE_URL");
    const supabaseAnonKey =
      process.env.KUB_QA_SUPABASE_ANON_KEY || env.get("KUB_QA_SUPABASE_ANON_KEY");
    test.skip(
      allowMutations !== "1",
      "KUB_QA_ALLOW_MUTATIONS=1 is required for message notification read-sync QA",
    );
    test.skip(!supabaseUrl, "KUB_QA_SUPABASE_URL is required for production-safe read-sync QA");
    test.skip(
      !supabaseAnonKey,
      "KUB_QA_SUPABASE_ANON_KEY is required for production-safe read-sync QA",
    );
    test.skip(
      !hasRoleAuth("owner") || !hasRoleAuth("client"),
      "owner and client QA auth are required",
    );

    const ownerContext = await browser.newContext();
    const clientContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    const clientPage = await clientContext.newPage();

    try {
      await gotoOrSkip(ownerPage, "/");
      await loginAsRoleOrSkip(ownerPage, "owner");
      await gotoOrSkip(clientPage, "/");
      await loginAsRoleOrSkip(clientPage, "client");

      const clientUserId = await getCurrentUserId(clientPage);
      const api = { url: supabaseUrl!, anonKey: supabaseAnonKey! };
      const chatId = await openPrivateChatWith(ownerPage, api, clientUserId);
      const otherChat = clientPage
        .locator(`[data-testid="chat-list-item"]:not([data-chat-id="${chatId}"])`)
        .first();
      test.skip(
        !(await otherChat.isVisible().catch(() => false)),
        "client QA account needs another visible chat to keep the target chat unread",
      );
      await otherChat.click();

      const content = `codex notification read ${Date.now()} ${Math.random().toString(36).slice(2)}`;
      const message = await insertTextMessage(ownerPage, api, chatId, content);

      await expect
        .poll(() => findMessageNotification(clientPage, api, message.id), { timeout: 15_000 })
        .toMatchObject({ read_at: null });
      await expect
        .poll(() => findMessageNotification(ownerPage, api, message.id), { timeout: 5_000 })
        .toBeNull();
      await clientPage.getByTestId("notification-bell-button").click();
      await expect(clientPage.getByTestId("notification-panel")).toBeVisible();
      const messageGroup = clientPage
        .getByTestId("notification-message-group")
        .filter({ hasText: content });
      await expect(messageGroup).toBeVisible({ timeout: 15_000 });
      await messageGroup.click();

      await expect
        .poll(
          async () => (await findMessageNotification(clientPage, api, message.id))?.read_at ?? null,
          {
            timeout: 15_000,
          },
        )
        .not.toBeNull();
    } finally {
      await clientContext.close().catch(() => null);
      await ownerContext.close().catch(() => null);
    }
  });
});

function hasRoleAuth(role: "owner" | "client") {
  return Boolean(loadQaCredentials(role) || hasSavedAuthState(role));
}

async function getCurrentUserId(page: Page): Promise<string> {
  return (await getQaSession(page)).userId;
}

type QaSupabaseConfig = { url: string; anonKey: string };

async function openPrivateChatWith(
  page: Page,
  api: QaSupabaseConfig,
  targetUserId: string,
): Promise<string> {
  const data = await qaSupabaseRequest(page, api, "/rest/v1/rpc/open_or_create_private_chat", {
    method: "POST",
    body: { target_user_id: targetUserId },
  });
  if (!data) throw new Error("qa_private_chat_not_available");
  return String(data);
}

async function insertTextMessage(
  page: Page,
  api: QaSupabaseConfig,
  chatId: string,
  content: string,
): Promise<{ id: string; created_at: string }> {
  const session = await getQaSession(page);
  const data = await qaSupabaseRequest(page, api, "/rest/v1/messages?select=id,created_at", {
    method: "POST",
    prefer: "return=representation",
    body: {
      chat_id: chatId,
      user_id: session.userId,
      type: "text",
      content,
      client_message_id: crypto.randomUUID(),
      client_sent_at: new Date().toISOString(),
    },
  });
  const row = Array.isArray(data) ? data[0] : null;
  if (!row || typeof row.id !== "string" || typeof row.created_at !== "string") {
    throw new Error("qa_message_insert_failed");
  }
  return { id: row.id, created_at: row.created_at };
}

async function findMessageNotification(
  page: Page,
  api: QaSupabaseConfig,
  messageId: string,
): Promise<{ id: string; read_at: string | null } | null> {
  const data = await qaSupabaseRequest(
    page,
    api,
    "/rest/v1/notifications?select=id,kind,payload,read_at,created_at&order=created_at.desc&limit=50",
  );
  const rows = Array.isArray(data) ? data : [];
  const row = rows.find((item) => {
    const payload =
      item.payload && typeof item.payload === "object" && !Array.isArray(item.payload)
        ? (item.payload as Record<string, unknown>)
        : {};
    return String(item.kind).includes("message") && payload.message_id === messageId;
  });
  return row ? { id: row.id, read_at: row.read_at } : null;
}

type QaSession = { accessToken: string; userId: string };

async function getQaSession(page: Page): Promise<QaSession> {
  const raw = await page.evaluate(() => window.localStorage.getItem("kub-auth"));
  if (!raw) throw new Error("qa_session_not_available");
  const parsed = JSON.parse(raw) as { access_token?: unknown; user?: { id?: unknown } };
  if (typeof parsed.access_token !== "string" || typeof parsed.user?.id !== "string") {
    throw new Error("qa_session_not_available");
  }
  return { accessToken: parsed.access_token, userId: parsed.user.id };
}

async function qaSupabaseRequest(
  page: Page,
  api: QaSupabaseConfig,
  path: string,
  options: { method?: string; prefer?: string; body?: Record<string, unknown> } = {},
): Promise<any> {
  const session = await getQaSession(page);
  const response = await page.request.fetch(`${api.url.replace(/\/$/, "")}${path}`, {
    method: options.method ?? "GET",
    headers: {
      apikey: api.anonKey,
      Authorization: `Bearer ${session.accessToken}`,
      "Content-Type": "application/json",
      ...(options.prefer ? { Prefer: options.prefer } : {}),
    },
    data: options.body,
  });
  if (!response.ok()) throw new Error(`qa_supabase_request_failed_${response.status()}`);
  if (response.status() === 204) return null;
  return response.json();
}
