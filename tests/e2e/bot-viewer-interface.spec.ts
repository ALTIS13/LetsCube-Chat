import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";
import {
  chat, membership, message, openFixture, person, requireFixtureServer,
  type Fixture, type Row,
} from "./helpers/messageActionsFixture";

const ME = person("11111111-1111-4111-8111-00000000b001", "Актёр", "actor");
const OTHER = person("11111111-1111-4111-8111-00000000b002", "Другой", "other");
const CHAT_ID = "22222222-2222-4222-8222-00000000b001";
const BOT_ID = "33333333-3333-4333-8333-00000000b001";
const MESSAGE_ID = "55555555-5555-4555-8555-00000000b001";
const CALLBACK_ID = "66666666-6666-4666-8666-00000000b001";
const PANEL_ID = "77777777-7777-4777-8777-00000000b001";
const AT = "2026-09-26T11:00:00Z";
const BOT = { id: BOT_ID, username: "shiftbot", display_name: "Смены", state: "active", avatar_url: null };

function panel(callbackId = CALLBACK_ID, expiresAt = new Date(Date.now() + 60_000).toISOString()) {
  return {
    id: PANEL_ID,
    bot_id: BOT_ID,
    callback_query_id: callbackId,
    source_message_id: MESSAGE_ID,
    version: 1,
    expires_at: expiresAt,
    state: {
      title: "Личный статус",
      body: "Готовим вашу смену",
      progress: 40,
      buttons: [[{ key: "stop", text: "Остановить" }]],
    },
  };
}

interface State {
  rows: Row[];
  reads: number;
  revealAfterRead?: number;
  answer?: Row | null;
  press?: { status: number; body: unknown };
  action?: { status: number; body: unknown };
}

async function seed(page: Page, state: State, account = ME, theme: "dark" | "light" = "dark"): Promise<Fixture> {
  return openFixture(page, {
    me: account,
    theme,
    chats: [chat(CHAT_ID, "group", "Команда", AT)],
    memberships: [membership(CHAT_ID, account, "member", AT)],
    messages: [{
      ...message(MESSAGE_ID, CHAT_ID, account, "Выберите действие", AT),
      user_id: null,
      sender: null,
      bot_id: BOT_ID,
      bot: BOT,
      bot_reply_markup: { inline_keyboard: [[{ text: "Открыть", callback_data: "open" }]] },
    }],
    rest: ({ resource, method }) => {
      if (method === "GET" && resource === "chat_bot_members") return {
        status: 200,
        body: [{ chat_id: CHAT_ID, bot_id: BOT_ID, joined_at: AT, removed_at: null, bot: { username: BOT.username, state: BOT.state } }],
      };
      if (method === "GET" && resource === "bot_commands") return { status: 200, body: [] };
      return undefined;
    },
    rpc: (name) => {
      if (name === "bot_viewer_interfaces_for_actor") {
        state.reads += 1;
        return { body: state.reads >= (state.revealAfterRead ?? 0) ? state.rows : [] };
      }
      if (name === "bot_callback_press") return state.press ?? { status: 200, body: CALLBACK_ID };
      if (name === "bot_callback_answer_for_actor") return { body: state.answer ?? null };
      if (name === "bot_viewer_interface_press") return state.action ?? { status: 200, body: CALLBACK_ID };
      if (name === "bot_viewer_interface_dismiss") {
        state.rows = [];
        return { body: true };
      }
      return undefined;
    },
  });
}

async function openChat(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect.poll(() => page.evaluate(async (id) => {
    const { useAppStore } = await import("/src/store/app.store.ts");
    return useAppStore.getState().chats.some((row) => row.id === id);
  }, CHAT_ID)).toBe(true);
  await page.evaluate(async (id) => {
    const { useAppStore } = await import("/src/store/app.store.ts");
    useAppStore.getState().setSelectedChatId(id);
  }, CHAT_ID);
}

async function captureFeedback(page: Page) {
  await page.evaluate(async () => {
    const { actionFeedback } = await import("/src/lib/actionFeedback.ts");
    const seen: string[] = [];
    actionFeedback.subscribe(() => {
      seen.push(...actionFeedback.getSnapshot().map((item) => item.title));
    });
    (window as typeof window & { botViewerFeedback?: string[] }).botViewerFeedback = seen;
  });
}

async function feedbackTitles(page: Page) {
  return page.evaluate(() =>
    (window as typeof window & { botViewerFeedback?: string[] }).botViewerFeedback ?? [],
  );
}

test.describe("bot viewer interface", () => {
  test.beforeEach(async ({ request }) => { await requireFixtureServer(request); });

  test("a callback reveals only its matching private panel outside message history", async ({ page }) => {
    const state: State = { rows: [panel()], reads: 0, revealAfterRead: 2, answer: { text: "fallback", show_alert: false } };
    const fixture = await seed(page, state);
    await openChat(page);
    await captureFeedback(page);
    await page.locator('[data-bot-keyboard-button="0:0"]').click();
    const viewer = page.locator('[data-bot-viewer-panel]');
    await expect(viewer).toBeVisible();
    await expect(viewer).toContainText("Личный статус");
    await expect(viewer).toContainText("Готовим вашу смену");
    await expect(page.locator(`[data-message-id="${MESSAGE_ID}"] [data-bot-viewer-panel]`)).toHaveCount(0);
    await expect(page.locator('[data-bot-keyboard-button="0:0"]')).toHaveAttribute("data-bot-keyboard-busy", "false");
    expect(await feedbackTitles(page)).not.toContain("fallback");
    expect(fixture.rpcBodies("bot_callback_press")).toEqual([{ p_message_id: MESSAGE_ID, p_data: "open" }]);
    expect(fixture.restCalls("messages", "POST")).toHaveLength(0);
  });

  test("an unrelated panel does not swallow the original callback answer", async ({ page }) => {
    const state: State = { rows: [panel("66666666-6666-4666-8666-00000000b099")], reads: 0, answer: { text: "Обычный ответ", show_alert: false } };
    await seed(page, state);
    await openChat(page);
    await expect(page.locator("[data-bot-viewer-panel]")).toBeVisible();
    await captureFeedback(page);
    await page.locator('[data-bot-keyboard-button="0:0"]').click();
    await expect.poll(async () => (await feedbackTitles(page)).some((title) =>
      title === "Обычный ответ" || title === "Запрос передан боту",
    )).toBe(true);
  });

  test("a stalled private read does not hold the original keyboard feedback", async ({ page }) => {
    const state: State = { rows: [panel("66666666-6666-4666-8666-00000000b099")], reads: 0, answer: { text: "Обычный ответ", show_alert: false } };
    const fixture = await seed(page, state);
    await openChat(page);
    await expect(page.locator("[data-bot-viewer-panel]")).toBeVisible();
    await captureFeedback(page);
    let release = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/rest/v1/rpc/bot_viewer_interfaces_for_actor", async (route) => {
      await held;
      await route.fallback();
    });
    try {
      await page.locator('[data-bot-keyboard-button="0:0"]').click();
      await expect.poll(async () => (await feedbackTitles(page)).some((title) =>
        title === "Обычный ответ" || title === "Запрос передан боту",
      ), { timeout: 6000 }).toBe(true);
      expect(fixture.rpcBodies("bot_callback_press")).toHaveLength(1);
    } finally {
      release();
    }
  });

  test("message row remount does not discard an accepted callback answer", async ({ page }) => {
    const state: State = { rows: [], reads: 0, answer: { text: "Ответ после обновления", show_alert: false } };
    const fixture = await seed(page, state);
    await openChat(page);
    await captureFeedback(page);
    await page.locator('[data-bot-keyboard-button="0:0"]').click();
    await expect.poll(() => fixture.rpcBodies("bot_callback_press").length).toBe(1);
    const remounted = await page.evaluate(async (chatId) => {
      const { useAppStore } = await import("/src/store/app.store.ts");
      const original = useAppStore.getState().messages[chatId] ?? [];
      const keyboard = document.querySelector('[data-bot-keyboard="true"]');
      useAppStore.getState().setMessages(chatId, []);
      await new Promise((resolve) => window.setTimeout(resolve, 100));
      useAppStore.getState().setMessages(chatId, original);
      await new Promise((resolve) => window.setTimeout(resolve, 100));
      return keyboard !== document.querySelector('[data-bot-keyboard="true"]');
    }, CHAT_ID);
    expect(remounted).toBe(true);
    await expect.poll(async () => (await feedbackTitles(page)).includes("Ответ после обновления")).toBe(true);
  });

  test("a panel arriving after feedback grace still appears without a message", async ({ page }) => {
    const state: State = { rows: [], reads: 0 };
    const fixture = await seed(page, state);
    await openChat(page);
    await expect.poll(() => state.reads).toBeGreaterThan(0);
    await expect(page.locator("[data-bot-viewer-panel]")).toHaveCount(0);
    await captureFeedback(page);
    let release = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/rest/v1/rpc/bot_viewer_interfaces_for_actor", async (route) => {
      await held;
      await route.fallback();
    });
    try {
      await page.locator('[data-bot-keyboard-button="0:0"]').click();
      await expect.poll(async () => (await feedbackTitles(page)).includes("Запрос передан боту"), { timeout: 6000 }).toBe(true);
      state.rows = [panel()];
    } finally {
      release();
    }
    await expect(page.locator("[data-bot-viewer-panel]")).toBeVisible({ timeout: 10_000 });
    expect(fixture.restCalls("messages", "POST")).toHaveLength(0);
  });

  test("an original keyboard press keeps its mapped failure feedback", async ({ page }) => {
    await seed(page, {
      rows: [], reads: 0,
      press: { status: 409, body: { code: "23505", message: "duplicate key" } },
    });
    await openChat(page);
    await page.locator('[data-bot-keyboard-button="0:0"]').click();
    await expect(page.getByText("Такая запись уже существует.")).toBeVisible();
    await expect(page.locator("[data-bot-viewer-panel]")).toHaveCount(0);
  });

  test("reentry reads actor panels again, while a second account sees none", async ({ page, browser }) => {
    const state: State = { rows: [panel()], reads: 0 };
    const fixture = await seed(page, state);
    await openChat(page);
    await expect(page.locator("[data-bot-viewer-panel]")).toBeVisible();
    await page.evaluate(async () => {
      const { useAppStore } = await import("/src/store/app.store.ts");
      useAppStore.getState().setSelectedChatId(null);
    });
    await expect(page.locator("[data-bot-viewer-panel]")).toHaveCount(0);
    await page.evaluate(async (id) => {
      const { useAppStore } = await import("/src/store/app.store.ts");
      useAppStore.getState().setSelectedChatId(id);
    }, CHAT_ID);
    await expect(page.locator("[data-bot-viewer-panel]")).toBeVisible();
    expect(fixture.rpcBodies("bot_viewer_interfaces_for_actor").length).toBeGreaterThanOrEqual(2);
    expect(fixture.rpcBodies("bot_viewer_interfaces_for_actor").every((body) => body.p_chat_id === CHAT_ID)).toBe(true);

    const context = await browser.newContext();
    try {
      const otherPage = await context.newPage();
      await seed(otherPage, { rows: [], reads: 0 }, OTHER);
      await openChat(otherPage);
      await expect(otherPage.locator("[data-bot-viewer-panel]")).toHaveCount(0);
      await expect(otherPage.getByText("Личный статус")).toHaveCount(0);
    } finally { await context.close(); }
  });

  test("expiry, reconnect and account change remove private content", async ({ page }) => {
    await page.clock.install({ time: new Date() });
    const state: State = { rows: [panel(CALLBACK_ID, new Date(Date.now() + 20_000).toISOString())], reads: 0 };
    await seed(page, state);
    await openChat(page);
    await expect(page.locator("[data-bot-viewer-panel]")).toBeVisible();
    await page.clock.fastForward(21_000);
    await expect(page.locator("[data-bot-viewer-panel]")).toHaveCount(0, { timeout: 5000 });
    state.rows = [panel()];
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.locator("[data-bot-viewer-panel]")).toBeVisible();
    state.rows = [];
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.locator("[data-bot-viewer-panel]")).toHaveCount(0);
    state.rows = [panel()];
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.locator("[data-bot-viewer-panel]")).toBeVisible();
    await page.evaluate(async () => {
      const { useAppStore } = await import("/src/store/app.store.ts");
      useAppStore.setState({ currentUser: { ...useAppStore.getState().currentUser!, id: "11111111-1111-4111-8111-00000000b099" } });
    });
    await expect(page.locator("[data-bot-viewer-panel]")).toHaveCount(0);
  });

  test("a held actor read cannot flash a panel after account switch", async ({ page }) => {
    const state: State = { rows: [panel()], reads: 0 };
    await seed(page, state);
    let release = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    let started = () => {};
    const requested = new Promise<void>((resolve) => { started = resolve; });
    await page.route("**/rest/v1/rpc/bot_viewer_interfaces_for_actor", async (route) => {
      started();
      await held;
      await route.fallback();
    });
    await openChat(page);
    await requested;
    await page.evaluate(async () => {
      const { useAppStore } = await import("/src/store/app.store.ts");
      useAppStore.setState({ currentUser: { ...useAppStore.getState().currentUser!, id: "11111111-1111-4111-8111-00000000b099" } });
    });
    release();
    await expect(page.locator("[data-bot-viewer-panel]")).toHaveCount(0);
    await expect(page.getByText("Личный статус")).toHaveCount(0);
  });

  test("panel action and dismiss use only key and expected version, with no automatic retry", async ({ page }) => {
    const state: State = { rows: [panel()], reads: 0, action: { status: 409, body: { code: "40001", message: "conflict" } } };
    const fixture = await seed(page, state);
    await openChat(page);
    const viewer = page.locator("[data-bot-viewer-panel]");
    await expect(viewer).toBeVisible();
    const action = viewer.getByRole("button", { name: "Остановить" });
    await action.focus();
    await expect(action).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(action).toBeEnabled();
    expect(fixture.rpcBodies("bot_viewer_interface_press")).toEqual([{
      p_interface_id: PANEL_ID,
      p_expected_version: 1,
      p_button_key: "stop",
    }]);
    state.rows = [panel()];
    await viewer.getByRole("button", { name: "Закрыть" }).click();
    await expect(viewer).toHaveCount(0);
    expect(fixture.rpcBodies("bot_viewer_interface_dismiss")).toEqual([{ p_interface_id: PANEL_ID, p_expected_version: 1 }]);
  });

  test("successful panel action reads its callback answer and refreshes actor state", async ({ page }) => {
    const state: State = { rows: [panel()], reads: 0, answer: { text: "Действие принято", show_alert: false } };
    const fixture = await seed(page, state);
    await openChat(page);
    const viewer = page.locator("[data-bot-viewer-panel]");
    await expect(viewer).toBeVisible();
    await captureFeedback(page);
    await viewer.getByRole("button", { name: "Остановить" }).click();
    await expect.poll(() => fixture.rpcBodies("bot_viewer_interface_press").length).toBe(1);
    state.rows = [{ ...panel(), version: 2, state: { ...panel().state, body: "Смена остановлена", progress: 100 } }];
    await expect.poll(async () => (await feedbackTitles(page)).includes("Действие принято")).toBe(true);
    await expect(viewer).toContainText("Смена остановлена");
    expect(fixture.rpcBodies("bot_viewer_interface_press")).toEqual([{
      p_interface_id: PANEL_ID,
      p_expected_version: 1,
      p_button_key: "stop",
    }]);
    expect(fixture.rpcBodies("bot_callback_answer_for_actor")).toContainEqual({ p_callback_query_id: CALLBACK_ID });
    expect(fixture.restCalls("messages", "POST")).toHaveLength(0);
  });

  for (const theme of ["dark", "light"] as const) {
    test(`panel fits 1440 and 390 in ${theme} theme`, async ({ page }, testInfo) => {
      await seed(page, { rows: [panel()], reads: 0 }, ME, theme);
      await openChat(page);
      const viewer = page.locator("[data-bot-viewer-panel]");
      await expect(viewer).toBeVisible();
      const box = await viewer.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(testInfo.project.use.viewport?.width ?? 1440);
      if (testInfo.project.name.includes("mobile")) {
        const hint = page.getByTestId("kub-hint").filter({ hasText: "микрофон" });
        if (await hint.isVisible()) {
          const action = await viewer.getByRole("button", { name: "Остановить" }).boundingBox();
          const hintBox = await hint.boundingBox();
          expect(action).not.toBeNull();
          expect(hintBox).not.toBeNull();
          expect(action!.y + action!.height, "the recorder hint must not cover the private action").toBeLessThanOrEqual(hintBox!.y);
        }
      }
      const screenshotDir = process.env.BOT_VIEWER_SCREENSHOT_DIR;
      if (screenshotDir) await page.screenshot({ path: join(screenshotDir, `${testInfo.project.name}-${theme}.png`) });
    });
  }
});
