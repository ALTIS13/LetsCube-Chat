import { expect, test, type Page } from "@playwright/test";
import {
  gotoOrSkip,
  hasSavedAuthState,
  loadQaCredentials,
  loadQaEnvValues,
  loginAsRoleOrSkip,
} from "./helpers/auth";

test.describe("realtime incoming messages", () => {
  test("keeps chat list preview in sync after sending from the open chat", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop-1440", "chat list mutation check runs once");
    const env = loadQaEnvValues();
    const allowMutations = process.env.KUB_QA_ALLOW_MUTATIONS || env.get("KUB_QA_ALLOW_MUTATIONS");
    test.skip(allowMutations !== "1", "KUB_QA_ALLOW_MUTATIONS=1 is required for chat list mutation QA");
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
      await openChat(ownerPage, chatId);
      await expect.poll(() => hasChatInStore(ownerPage, chatId), { timeout: 10_000 }).toBe(true);

      const content = `codex preview sync ${Date.now()} ${Math.random().toString(36).slice(2)}`;
      await ownerPage.getByPlaceholder("Сообщение…").fill(content);
      await ownerPage.getByRole("button", { name: "Отправить" }).click();

      await expect(messageText(ownerPage, content).first()).toBeVisible({ timeout: 15_000 });
      await expect.poll(
        () => getChatLastMessageContent(ownerPage, chatId),
        { timeout: 3_000 },
      ).toBe(content);

      await ownerPage.evaluate(async () => {
        const { useAppStore } = await import("/src/store/app.store.ts");
        useAppStore.getState().setSelectedChatId(null);
      });
      await expect(ownerPage.getByTestId("chat-list-item").filter({ hasText: content }).first()).toBeVisible();

      await delayInitialMessagesFetch(ownerPage, chatId);
      await openChat(ownerPage, chatId);
      await expect(messageText(ownerPage, content).first()).toBeVisible({ timeout: 1_500 });
    } finally {
      await clientContext.close().catch(() => null);
      await ownerContext.close().catch(() => null);
    }
  });

  test("hydrates chat metadata before opening a push target missing from local chat list", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop-1440", "push target hydration check runs once");
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
      const expectedTitle = await getCurrentUserDisplayName(clientPage);

      const opened = await ownerPage.evaluate(async (targetChatId) => {
        const { useAppStore } = await import("/src/store/app.store.ts");
        const { safeOpenChat } = await import("/src/lib/safeOpenChat.ts");
        const state = useAppStore.getState();
        state.setSelectedChatId(null);
        state.setChats(state.chats.filter((chat) => chat.id !== targetChatId));
        return safeOpenChat(targetChatId);
      }, chatId);

      expect(opened).toBe(true);
      await expect.poll(() => getChatHeaderTitle(ownerPage, chatId), { timeout: 5_000 }).toBe(expectedTitle);
    } finally {
      await clientContext.close().catch(() => null);
      await ownerContext.close().catch(() => null);
    }
  });

  test("reconciles a missed incoming private message after reconnect without page refresh", async ({ browser }) => {
    const env = loadQaEnvValues();
    const allowMutations = process.env.KUB_QA_ALLOW_MUTATIONS || env.get("KUB_QA_ALLOW_MUTATIONS");
    test.skip(allowMutations !== "1", "KUB_QA_ALLOW_MUTATIONS=1 is required for realtime message mutation QA");
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
      await openChat(ownerPage, chatId);

      const incomingText = `codex incoming ${Date.now()} ${Math.random().toString(36).slice(2)}`;
      await ownerContext.setOffline(true);
      await insertTextMessage(clientPage, chatId, incomingText);
      await expect(messageText(ownerPage, incomingText)).toHaveCount(0, { timeout: 1_000 });

      await ownerContext.setOffline(false);
      await ownerPage.evaluate((targetChatId) => {
        window.dispatchEvent(
          new CustomEvent("kub:chats-refresh", {
            detail: { reason: "message-realtime", chatId: targetChatId },
          }),
        );
      }, chatId);

      await expect(messageText(ownerPage, incomingText).first()).toBeVisible({ timeout: 15_000 });
      await ownerPage.evaluate((targetChatId) => {
        window.dispatchEvent(
          new CustomEvent("kub:chats-refresh", {
            detail: { reason: "message-realtime", chatId: targetChatId },
          }),
        );
      }, chatId);
      await ownerPage.waitForTimeout(1_200);
      await expect(messageText(ownerPage, incomingText)).toHaveCount(1);

      const ownText = `codex own ${Date.now()} ${Math.random().toString(36).slice(2)}`;
      await insertTextMessage(ownerPage, chatId, ownText);
      await expect(messageText(ownerPage, ownText).first()).toBeVisible({ timeout: 15_000 });

      const incomingBox = await messageText(ownerPage, incomingText).first().boundingBox();
      const ownBox = await messageText(ownerPage, ownText).first().boundingBox();
      expect(incomingBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(ownBox?.y ?? 0);
    } finally {
      await ownerContext.setOffline(false).catch(() => null);
      await clientContext.close().catch(() => null);
      await ownerContext.close().catch(() => null);
    }
  });
});

function hasRoleAuth(role: "owner" | "client") {
  return Boolean(loadQaCredentials(role) || hasSavedAuthState(role));
}

async function hasChatInStore(page: Page, chatId: string): Promise<boolean> {
  return page.evaluate(async (targetChatId) => {
    const { useAppStore } = await import("/src/store/app.store.ts");
    return useAppStore.getState().chats.some((chat) => chat.id === targetChatId);
  }, chatId);
}

async function getChatLastMessageContent(page: Page, chatId: string): Promise<string | null> {
  return page.evaluate(async (targetChatId) => {
    const { useAppStore } = await import("/src/store/app.store.ts");
    const chat = useAppStore.getState().chats.find((item) => item.id === targetChatId);
    return chat?.last_message?.content ?? null;
  }, chatId);
}

async function getCurrentUserDisplayName(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const { createClient } = await import("/src/lib/supabase/client.ts");
    const supabase = createClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user?.id) throw new Error("qa_user_not_available");
    const { data, error } = await supabase
      .from("profiles")
      .select("full_name,username")
      .eq("id", userData.user.id)
      .single();
    if (error || !data) throw new Error("qa_profile_not_available");
    return data.full_name || data.username || "Личный чат";
  });
}

async function getChatHeaderTitle(page: Page, chatId: string): Promise<string | null> {
  return page.evaluate(async (targetChatId) => {
    const { useAppStore } = await import("/src/store/app.store.ts");
    const chat = useAppStore.getState().chats.find((item) => item.id === targetChatId);
    return chat?.name ?? null;
  }, chatId);
}

async function delayInitialMessagesFetch(page: Page, chatId: string) {
  let delayed = false;
  await page.route("**/rest/v1/messages?**", async (route) => {
    const url = route.request().url();
    if (!delayed && route.request().method() === "GET" && url.includes(`chat_id=eq.${chatId}`)) {
      delayed = true;
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
    await route.continue();
  });
}

function messageText(page: Page, text: string) {
  return page.locator('[data-message-text-content="true"]').filter({ hasText: text });
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

async function openChat(page: Page, chatId: string) {
  await page.evaluate(async (targetChatId) => {
    const { safeOpenChat } = await import("/src/lib/safeOpenChat.ts");
    const opened = await safeOpenChat(targetChatId);
    if (!opened) throw new Error("qa_chat_not_opened");
  }, chatId);
}

async function insertTextMessage(page: Page, chatId: string, content: string) {
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
