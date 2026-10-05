import { expect, test, type Page, type Route } from "@playwright/test";
import { FIXTURE_HOST, chat, membership, message, openChat, openFixture, person, requireFixtureServer } from "./helpers/messageActionsFixture";

const ME = person("64111111-1111-4111-8111-000000000001", "Участник проверки", "push_reader");
const PEER = person("64111111-1111-4111-8111-000000000002", "Другой участник", "push_peer");
const A = "64222222-2222-4222-8222-000000000001";
const B = "64222222-2222-4222-8222-000000000002";
const MA = "64555555-5555-4555-8555-000000000001";
const MB = "64555555-5555-4555-8555-000000000002";
const AT = "2026-10-05T12:00:00.000Z";

test.use({ screenshot: "off", trace: "off", video: "off", serviceWorkers: "block" });
test.beforeEach(async ({ request }) => {
  expect(process.env.KUB_QA_ALLOW_MUTATIONS).toBe("0");
  await requireFixtureServer(request);
});

async function boot(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.name));
  await openFixture(page, {
    me: ME, people: [PEER],
    chats: [chat(A, "group", "Первый чат проверки", AT), chat(B, "group", "Второй чат проверки", AT)],
    memberships: [membership(A, ME, "member", AT), membership(A, PEER, "member", AT), membership(B, ME, "member", AT), membership(B, PEER, "member", AT)],
    messages: [message(MA, A, PEER, "Сообщение первой проверки", AT), message(MB, B, PEER, "Сообщение второй проверки", AT)],
  });
  await openChat(page, "Первый чат проверки", "Сообщение первой проверки");
  await page.evaluate(() => {
    (window as unknown as { __qaPushJumps: unknown[] }).__qaPushJumps = [];
    window.addEventListener("kub:chat-message-jump", (event) => {
      (window as unknown as { __qaPushJumps: unknown[] }).__qaPushJumps.push((event as CustomEvent).detail);
    });
  });
  return errors;
}

async function card(page: Page, chatId: string, messageId: string) {
  await page.evaluate(({ chatId, messageId }) => navigator.serviceWorker.dispatchEvent(new MessageEvent("message", {
    data: { type: "kub-open", url: `/?chat=${chatId}&message=${messageId}` },
  })), { chatId, messageId });
}

async function holdAccess(page: Page, chatId: string) {
  let release!: () => void;
  let started!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const arrived = new Promise<void>((resolve) => { started = resolve; });
  const matcher = (url: URL) => url.origin === FIXTURE_HOST && url.pathname === "/rest/v1/chat_members"
    && url.searchParams.get("select") === "chat_id" && url.searchParams.get("chat_id") === `eq.${chatId}`;
  const completed = page.waitForEvent("requestfinished", { predicate: (request) => matcher(new URL(request.url())) });
  const handler = async (route: Route) => {
    started(); await held;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ chat_id: chatId }) });
  };
  await page.route(matcher, handler);
  return { arrived, release: async () => { release(); await completed; }, close: () => page.unroute(matcher, handler) };
}

test("the actual service-worker click selects and jumps to its exact message", async ({ page }) => {
  const errors = await boot(page);
  await card(page, B, MB);
  await expect(page).toHaveURL(new RegExp(`/chat/${B}/m/${MB}$`));
  await expect.poll(() => page.evaluate(() => (window as unknown as { __qaPushJumps: unknown[] }).__qaPushJumps))
    .toEqual([{ chatId: B, messageId: MB }]);
  expect(errors).toEqual([]);
});

test("a slower old card cannot undo a newer card's route or jump", async ({ page }) => {
  const errors = await boot(page);
  const held = await holdAccess(page, A);
  await card(page, A, MA); await held.arrived;
  await card(page, B, MB);
  await expect(page).toHaveURL(new RegExp(`/chat/${B}/m/${MB}$`));
  await expect.poll(() => page.evaluate(() => (window as unknown as { __qaPushJumps: unknown[] }).__qaPushJumps))
    .toEqual([{ chatId: B, messageId: MB }]);
  await held.release(); await held.close();
  await page.waitForTimeout(250);
  await expect(page).toHaveURL(new RegExp(`/chat/${B}/m/${MB}$`));
  expect(await page.evaluate(() => (window as unknown as { __qaPushJumps: unknown[] }).__qaPushJumps))
    .toEqual([{ chatId: B, messageId: MB }]);
  expect(errors).toEqual([]);
});

test("the real store's logout and same-account return refuse a held old card", async ({ page }) => {
  const errors = await boot(page);
  const held = await holdAccess(page, B);
  await card(page, B, MB); await held.arrived;
  const epochDelta = await page.evaluate(async () => {
    const { useAppStore } = await import("/src/store/app.store.ts" /* @vite-ignore */);
    const owner = useAppStore.getState().currentUser;
    const epoch = useAppStore.getState().accountEpoch;
    useAppStore.getState().setCurrentUser(null); useAppStore.getState().setCurrentUser(owner);
    return useAppStore.getState().accountEpoch - epoch;
  });
  expect(epochDelta).toBe(2);
  await held.release(); await held.close();
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => (window as unknown as { __qaPushJumps: unknown[] }).__qaPushJumps)).toEqual([]);
  expect(page.url()).not.toContain(`/chat/${B}/m/${MB}`);
  expect(errors).toEqual([]);
});

test("a real manual chat round trip cancels an older pending card", async ({ page }) => {
  const errors = await boot(page);
  const held = await holdAccess(page, B);
  await card(page, B, MB); await held.arrived;
  await page.evaluate(async ({ a, b }) => {
    const { useAppStore } = await import("/src/store/app.store.ts" /* @vite-ignore */);
    useAppStore.getState().setSelectedChatId(b);
    useAppStore.getState().setSelectedChatId(a);
  }, { a: A, b: B });
  await held.release(); await held.close();
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => (window as unknown as { __qaPushJumps: unknown[] }).__qaPushJumps)).toEqual([]);
  expect(page.url()).not.toContain(`/chat/${B}/m/${MB}`);
  expect(errors).toEqual([]);
});
