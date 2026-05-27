import { expect, test, type Page } from "@playwright/test";
import {
  findFirstAvailableQaRole,
  gotoOrSkip,
  hasSavedAuthState,
  loadQaCredentials,
  loadQaEnvValues,
  loginAsRoleOrSkip,
} from "./helpers/auth";

test.describe("KUB notification center", () => {
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
    await expect(page.getByTestId("notification-tab-tasks")).toHaveAttribute("data-state", "active");
    await page.getByTestId("notification-tab-messages").click();
    await expect(page.getByTestId("notification-tab-messages")).toHaveAttribute("data-state", "active");
    await page.getByTestId("notification-tab-system").click();
    await expect(page.getByTestId("notification-tab-system")).toHaveAttribute("data-state", "active");
    await page.getByTestId("notification-tab-all").click();
    await expect(page.getByTestId("notification-tab-all")).toHaveAttribute("data-state", "active");

    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();

    const unexpectedConsoleErrors = consoleErrors.filter(
      (message) =>
        !message.includes("Failed to load resource") &&
        !message.includes("Missing Supabase environment variables"),
    );
    expect(unexpectedConsoleErrors, `Unexpected console errors:\n${unexpectedConsoleErrors.join("\n")}`).toEqual([]);
  });

  test("clears recipient message notifications when the chat is read", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop-1440", "mutation read-sync check runs once");
    const env = loadQaEnvValues();
    const allowMutations = process.env.KUB_QA_ALLOW_MUTATIONS || env.get("KUB_QA_ALLOW_MUTATIONS");
    test.skip(allowMutations !== "1", "KUB_QA_ALLOW_MUTATIONS=1 is required for message notification read-sync QA");
    test.skip(!hasRoleAuth("owner") || !hasRoleAuth("client"), "owner and client QA auth are required");

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
      const chatId = await openPrivateChatWith(ownerPage, clientUserId);
      const otherChatId = await findOtherVisibleChat(clientPage, chatId);
      test.skip(!otherChatId, "client QA account needs another visible chat to keep the target chat unread");
      await openChat(clientPage, otherChatId);

      const content = `codex notification read ${Date.now()} ${Math.random().toString(36).slice(2)}`;
      const message = await insertTextMessage(ownerPage, chatId, content);

      await expect
        .poll(() => findMessageNotification(clientPage, message.id), { timeout: 15_000 })
        .toMatchObject({ read_at: null });
      await expect.poll(() => findMessageNotification(ownerPage, message.id), { timeout: 5_000 }).toBeNull();
      await clientPage.getByTestId("notification-bell-button").click();
      await expect(clientPage.getByTestId("notification-panel")).toBeVisible();
      await clientPage.keyboard.press("Escape");

      await openChat(clientPage, chatId);
      await expect
        .poll(async () => (await findMessageNotification(clientPage, message.id))?.read_at ?? null, {
          timeout: 15_000,
        })
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
  return page.evaluate(async () => {
    const { createClient } = await import("/src/lib/supabase/client.ts");
    const { data, error } = await createClient().auth.getUser();
    if (error || !data.user?.id) throw new Error("qa_user_not_available");
    return data.user.id;
  });
}

async function openPrivateChatWith(page: Page, targetUserId: string): Promise<string> {
  return page.evaluate(async (userId) => {
    const { createClient } = await import("/src/lib/supabase/client.ts");
    const { data, error } = await createClient().rpc("open_or_create_private_chat", {
      target_user_id: userId,
    });
    if (error || !data) throw new Error("qa_private_chat_not_available");
    return String(data);
  }, targetUserId);
}

async function findOtherVisibleChat(page: Page, excludedChatId: string): Promise<string | null> {
  return page.evaluate(async (chatId) => {
    const { createClient } = await import("/src/lib/supabase/client.ts");
    const { data: userData, error: userError } = await createClient().auth.getUser();
    if (userError || !userData.user?.id) throw new Error("qa_user_not_available");
    const { data, error } = await createClient()
      .from("chat_members")
      .select("chat_id")
      .eq("user_id", userData.user.id)
      .neq("chat_id", chatId)
      .limit(1);
    if (error) throw new Error("qa_other_chat_lookup_failed");
    return data?.[0]?.chat_id ?? null;
  }, excludedChatId);
}

async function openChat(page: Page, chatId: string) {
  await page.evaluate(async (targetChatId) => {
    const { safeOpenChat } = await import("/src/lib/safeOpenChat.ts");
    const opened = await safeOpenChat(targetChatId);
    if (!opened) throw new Error("qa_chat_not_opened");
  }, chatId);
}

async function insertTextMessage(page: Page, chatId: string, content: string): Promise<{ id: string; created_at: string }> {
  return page.evaluate(async ({ targetChatId, text }) => {
    const { createClient } = await import("/src/lib/supabase/client.ts");
    const supabase = createClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user?.id) throw new Error("qa_user_not_available");
    const { data, error } = await supabase
      .from("messages")
      .insert({
        chat_id: targetChatId,
        user_id: userData.user.id,
        type: "text",
        content: text,
        client_message_id: crypto.randomUUID(),
        client_sent_at: new Date().toISOString(),
      })
      .select("id,created_at")
      .single();
    if (error || !data) throw new Error("qa_message_insert_failed");
    return data;
  }, { targetChatId: chatId, text: content });
}

async function findMessageNotification(
  page: Page,
  messageId: string,
): Promise<{ id: string; read_at: string | null } | null> {
  return page.evaluate(async (targetMessageId) => {
    const { createClient } = await import("/src/lib/supabase/client.ts");
    const { data, error } = await createClient()
      .from("notifications")
      .select("id,kind,payload,read_at,created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error("qa_notifications_lookup_failed");
    const row = data?.find((item) => {
      const payload = item.payload && typeof item.payload === "object" && !Array.isArray(item.payload)
        ? item.payload as Record<string, unknown>
        : {};
      return String(item.kind).includes("message") && payload.message_id === targetMessageId;
    });
    return row ? { id: row.id, read_at: row.read_at } : null;
  }, messageId);
}
