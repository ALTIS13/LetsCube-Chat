import { expect, test, type Page, type Route } from "@playwright/test";
import {
  FIXTURE_HOST,
  chat,
  membership,
  message,
  openFixture,
  person,
  requireFixtureServer,
} from "./helpers/messageActionsFixture";
import { RealtimeFixture } from "./helpers/realtime-fixture";

const accountA = person("11111111-1111-4111-8111-0000000000a1", "Fixture A");
const accountB = person("11111111-1111-4111-8111-0000000000b2", "Fixture B");
const chatA = "22222222-2222-4222-8222-0000000000a1";
const chatB = "22222222-2222-4222-8222-0000000000b2";
const messageA = "33333333-3333-4333-8333-0000000000a1";
const joinedAt = "2026-09-27T10:00:00.000Z";
const rowA = { ...chat(chatA, "group", "Fixture chat A", joinedAt), members: [membership(chatA, accountA, "owner", null)] };
const rowB = { ...chat(chatB, "group", "Fixture chat B", joinedAt), members: [membership(chatB, accountB, "owner", null)] };

function accessToken(userId: string): string {
  const segment = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${segment({ alg: "HS256", typ: "JWT" })}.${segment({ aud: "authenticated", role: "authenticated", sub: userId, exp: Math.floor(Date.now() / 1000) + 3600 })}.c2ln`;
}

async function chatSnapshot(page: Page, storeModule: string) {
  return page.evaluate(async (path) => {
    const { useAppStore } = await import(/* @vite-ignore */ path);
    const state = useAppStore.getState();
    return { userId: state.currentUser?.id ?? null, chatIds: state.chats.map((chat: { id: string }) => chat.id) };
  }, storeModule);
}

test.use({ screenshot: "off", trace: "off", video: "off" });

test("a pending summary from A cannot write its preview into B's shared chat", async ({ page, request }) => {
  await requireFixtureServer(request);
  const shared = {
    ...rowA,
    members: [membership(chatA, accountA, "owner", null), membership(chatA, accountB, "member", null)],
  };
  const oldPreview = message(messageA, chatA, accountA, "A-only fixture preview", joinedAt);
  const fixture = await openFixture(page, {
    me: accountA,
    people: [accountB],
    chats: [shared],
    memberships: [membership(chatA, accountA, "owner", null), membership(chatA, accountB, "member", null)],
    messages: [oldPreview],
  });
  const realtime = new RealtimeFixture();
  await realtime.install(page);
  let storeModule: string | null = null;
  page.on("request", (incoming) => {
    if (new URL(incoming.url()).pathname === "/src/store/app.store.ts") storeModule = incoming.url();
  });
  await page.goto("/");
  await expect.poll(() => realtime.isJoined(`chats:user:${accountA.id}:messages`)).toBe(true);
  await expect.poll(() => chatSnapshot(page, storeModule!)).toEqual({ userId: accountA.id, chatIds: [chatA] });
  await expect.poll(() => fixture.restCalls("chat_members", "GET").length).toBeGreaterThanOrEqual(2);
  await page.waitForTimeout(250);

  let releaseSummary!: () => void;
  const summaryGate = new Promise<void>((resolve) => { releaseSummary = resolve; });
  let signalSummary!: () => void;
  const summaryRequested = new Promise<void>((resolve) => { signalSummary = resolve; });
  await page.route(`${FIXTURE_HOST}/rest/v1/messages*`, async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("chat_id") !== `eq.${chatA}` || route.request().headers().prefer?.includes("count=")) {
      return route.fallback();
    }
    signalSummary();
    await summaryGate;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([oldPreview]) });
  });
  expect(realtime.emit({
    type: "UPDATE",
    table: "messages",
    record: { ...oldPreview, deleted_at: new Date().toISOString() },
  })).toBeGreaterThan(0);
  await summaryRequested;

  await page.evaluate(() => {
    history.pushState({}, "", "/tasks");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page.getByTestId("chat-list-item")).toHaveCount(0);
  const beforeRelease = await page.evaluate(async ({ path, nextUser }) => {
    const { useAppStore } = await import(/* @vite-ignore */ path);
    const sharedChat = useAppStore.getState().chats[0];
    useAppStore.getState().setCurrentUser(nextUser);
    useAppStore.getState().setChats([{ ...sharedChat, last_message: null, unread_count: 0 }]);
    const trace: string[] = [];
    (window as typeof window & { __summaryAccountTrace?: string[] }).__summaryAccountTrace = trace;
    useAppStore.subscribe((state: { currentUser: { id: string } | null; chats: Array<{ last_message?: { content?: string } | null }> }) => {
      if (state.currentUser?.id === nextUser.id) trace.push(state.chats[0]?.last_message?.content ?? "");
    });
    return { userId: useAppStore.getState().currentUser?.id, preview: useAppStore.getState().chats[0]?.last_message };
  }, { path: storeModule!, nextUser: accountB });
  expect(beforeRelease).toEqual({ userId: accountB.id, preview: null });
  const countResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/rest/v1/messages" && response.request().headers().prefer?.includes("count=") === true;
  });
  releaseSummary();
  await countResponse;
  await page.waitForTimeout(250);
  const afterRelease = await page.evaluate(async (path) => {
    const { useAppStore } = await import(/* @vite-ignore */ path);
    const state = useAppStore.getState();
    return {
      userId: state.currentUser?.id,
      preview: state.chats[0]?.last_message?.content ?? null,
      trace: (window as typeof window & { __summaryAccountTrace?: string[] }).__summaryAccountTrace ?? [],
    };
  }, storeModule!);
  expect(afterRelease.userId).toBe(accountB.id);
  expect(afterRelease.preview).toBeNull();
  expect(afterRelease.trace).not.toContain("A-only fixture preview");
});

test("a late full fetch for A never publishes A chats or requeues A after switching to B", async ({ page, request }) => {
  await requireFixtureServer(request);
  await openFixture(page, {
    me: accountA,
    people: [accountB],
    chats: [rowA, rowB],
    memberships: [membership(chatA, accountA, "owner", null), membership(chatB, accountB, "owner", null)],
    messages: [],
  });

  const modules = new Map<string, string>();
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (["/src/lib/supabase/client.ts", "/src/store/app.store.ts"].includes(path)) modules.set(path, request.url());
  });

  let releaseA!: () => void;
  const aGate = new Promise<void>((resolve) => { releaseA = resolve; });
  let signalA!: () => void;
  const aRequested = new Promise<void>((resolve) => { signalA = resolve; });
  let bMembershipReads = 0;
  await page.route(`${FIXTURE_HOST}/rest/v1/chat_members*`, async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("user_id") === `eq.${accountB.id}` && url.searchParams.get("select")?.startsWith("chat_id,")) {
      bMembershipReads += 1;
    }
    await route.fallback();
  });
  await page.route(`${FIXTURE_HOST}/rest/v1/chats*`, async (route: Route) => {
    const ids = new URL(route.request().url()).searchParams.get("id");
    if (ids === `in.(${chatA})`) {
      signalA();
      await aGate;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([rowA]) });
    }
    if (ids === `in.(${chatB})`) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([rowB]) });
    }
    return route.fallback();
  });
  await page.route(`${FIXTURE_HOST}/auth/v1/user`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: accountB.id,
        aud: "authenticated",
        role: "authenticated",
        email: "synthetic@example.invalid",
        user_metadata: { full_name: accountB.full_name },
        app_metadata: {},
        created_at: accountB.created_at,
      }),
    }));

  await page.goto("/");
  await aRequested;
  const clientModule = modules.get("/src/lib/supabase/client.ts");
  const storeModule = modules.get("/src/store/app.store.ts");
  expect(clientModule && storeModule).toBeTruthy();

  await page.evaluate(async ({ path, nextUser }) => {
    const { useAppStore } = await import(/* @vite-ignore */ path);
    const trace: Array<{ userId: string | null; chatIds: string[] }> = [];
    (window as typeof window & { __chatAccountTrace?: typeof trace }).__chatAccountTrace = trace;
    useAppStore.subscribe((state: { currentUser: { id: string } | null; chats: Array<{ id: string }> }, previous: { chats: unknown }) => {
      if (state.chats !== previous.chats) trace.push({ userId: state.currentUser?.id ?? null, chatIds: state.chats.map((item) => item.id) });
    });
    useAppStore.getState().setCurrentUser(nextUser);
  }, { path: storeModule!, nextUser: accountB });
  await page.evaluate(async ({ path, token }) => {
    const { createClient } = await import(/* @vite-ignore */ path);
    const { error } = await createClient().auth.setSession({ access_token: token, refresh_token: "synthetic-refresh-b" });
    if (error) throw new Error(error.message);
  }, { path: clientModule!, token: accessToken(accountB.id) });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("kub-auth") ?? "null")?.user?.id ?? null)).toBe(accountB.id);

  releaseA();
  await expect.poll(async () => (await chatSnapshot(page, storeModule!)).chatIds.length).toBeGreaterThan(0);
  expect(await chatSnapshot(page, storeModule!)).toEqual({ userId: accountB.id, chatIds: [chatB] });
  await expect.poll(() => bMembershipReads).toBeGreaterThan(0);
  await expect.poll(() => chatSnapshot(page, storeModule!)).toEqual({ userId: accountB.id, chatIds: [chatB] });
  const trace = await page.evaluate(() =>
    (window as typeof window & { __chatAccountTrace?: Array<{ userId: string | null; chatIds: string[] }> }).__chatAccountTrace ?? []);
  expect(trace.some((entry) => entry.userId === accountB.id && entry.chatIds.includes(chatA))).toBe(false);
});

test("switching to B immediately removes A's loaded and selected chat while B's read waits", async ({ page, request }) => {
  await requireFixtureServer(request);
  await openFixture(page, {
    me: accountA,
    people: [accountB],
    chats: [rowA, rowB],
    memberships: [membership(chatA, accountA, "owner", null), membership(chatB, accountB, "owner", null)],
    messages: [],
  });

  const modules = new Map<string, string>();
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (["/src/lib/supabase/client.ts", "/src/store/app.store.ts"].includes(path)) modules.set(path, request.url());
  });

  let releaseB!: () => void;
  const bGate = new Promise<void>((resolve) => { releaseB = resolve; });
  let signalB!: () => void;
  const bRequested = new Promise<void>((resolve) => { signalB = resolve; });
  await page.route(`${FIXTURE_HOST}/rest/v1/chat_members*`, async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("user_id") === `eq.${accountB.id}` && url.searchParams.get("select")?.startsWith("chat_id,")) {
      signalB();
      await bGate;
    }
    await route.fallback();
  });
  await page.route(`${FIXTURE_HOST}/rest/v1/chats*`, (route: Route) => {
    const ids = new URL(route.request().url()).searchParams.get("id");
    if (ids === `in.(${chatA})`) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([rowA]) });
    }
    if (ids === `in.(${chatB})`) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([rowB]) });
    }
    return route.fallback();
  });
  await page.route(`${FIXTURE_HOST}/auth/v1/user`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: accountB.id,
        aud: "authenticated",
        role: "authenticated",
        email: "synthetic@example.invalid",
        user_metadata: { full_name: accountB.full_name },
        app_metadata: {},
        created_at: accountB.created_at,
      }),
    }));

  await page.goto("/");
  const clientModule = modules.get("/src/lib/supabase/client.ts");
  const storeModule = modules.get("/src/store/app.store.ts");
  expect(clientModule && storeModule).toBeTruthy();
  await expect.poll(() => chatSnapshot(page, storeModule!)).toEqual({ userId: accountA.id, chatIds: [chatA] });
  const row = page.locator(`[data-testid="chat-list-item"][data-chat-id="${chatA}"]`);
  await expect(row).toBeVisible();
  await page.evaluate(async ({ path, chatId }) => {
    const { useAppStore } = await import(/* @vite-ignore */ path);
    useAppStore.getState().setSelectedChatId(chatId);
  }, { path: storeModule!, chatId: chatA });
  await expect(page.getByTestId("chat-chrome-stack")).toBeVisible();
  await page.waitForURL(`**/chat/${chatA}`);

  const sameAccount = await page.evaluate(async (path) => {
    const { useAppStore } = await import(/* @vite-ignore */ path);
    const current = useAppStore.getState().currentUser;
    if (!current) throw new Error("Synthetic account A is missing");
    useAppStore.getState().setCurrentUser({ ...current, full_name: "Fixture A updated" });
    const state = useAppStore.getState();
    return { userId: state.currentUser?.id ?? null, chatIds: state.chats.map((chat: { id: string }) => chat.id), selectedChatId: state.selectedChatId };
  }, storeModule!);
  expect(sameAccount).toEqual({ userId: accountA.id, chatIds: [chatA], selectedChatId: chatA });

  const switched = await page.evaluate(async ({ path, nextUser }) => {
    const { useAppStore } = await import(/* @vite-ignore */ path);
    const trace: Array<{ userId: string | null; chatIds: string[]; selectedChatId: string | null }> = [];
    (window as typeof window & { __accountSwitchTrace?: typeof trace }).__accountSwitchTrace = trace;
    useAppStore.subscribe((state: { currentUser: { id: string } | null; chats: Array<{ id: string }>; selectedChatId: string | null }) => {
      if (state.currentUser?.id === nextUser.id) {
        trace.push({ userId: state.currentUser.id, chatIds: state.chats.map((chat) => chat.id), selectedChatId: state.selectedChatId });
      }
    });
    useAppStore.getState().setCurrentUser(nextUser);
    const state = useAppStore.getState();
    return { userId: state.currentUser?.id ?? null, chatIds: state.chats.map((chat: { id: string }) => chat.id), selectedChatId: state.selectedChatId };
  }, { path: storeModule!, nextUser: accountB });

  try {
    expect(switched).toEqual({ userId: accountB.id, chatIds: [], selectedChatId: null });
    await page.evaluate(async ({ path, token }) => {
      const { createClient } = await import(/* @vite-ignore */ path);
      const { error } = await createClient().auth.setSession({ access_token: token, refresh_token: "synthetic-refresh-b" });
      if (error) throw new Error(error.message);
    }, { path: clientModule!, token: accessToken(accountB.id) });
    await bRequested;
    expect(await chatSnapshot(page, storeModule!)).toEqual({ userId: accountB.id, chatIds: [] });
    await expect(row).toHaveCount(0);
    await expect(page.getByTestId("chat-chrome-stack")).toHaveCount(0);
    const trace = await page.evaluate(() =>
      (window as typeof window & { __accountSwitchTrace?: Array<{ userId: string | null; chatIds: string[]; selectedChatId: string | null }> }).__accountSwitchTrace ?? []);
    expect(trace.length).toBeGreaterThan(0);
    expect(trace.every((entry) => entry.chatIds.length === 0 && entry.selectedChatId === null)).toBe(true);
  } finally {
    releaseB();
  }
  await expect.poll(() => chatSnapshot(page, storeModule!)).toEqual({ userId: accountB.id, chatIds: [chatB] });
});

test("first profile keeps a pending message deep-link selection, but signing out clears A", async ({ page, request }) => {
  await requireFixtureServer(request);
  await openFixture(page, {
    me: accountA,
    chats: [rowA],
    memberships: [membership(chatA, accountA, "owner", null)],
    messages: [message(messageA, chatA, accountA, "Synthetic message", joinedAt)],
  });

  let storeModule: string | null = null;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/src/store/app.store.ts") storeModule = request.url();
  });
  await page.goto(`/chat/${chatA}/m/${messageA}`, { waitUntil: "domcontentloaded" });
  await expect.poll(() => chatSnapshot(page, storeModule!)).toEqual({ userId: accountA.id, chatIds: [chatA] });
  await expect(page.getByTestId("chat-chrome-stack")).toBeVisible();
  expect(storeModule).toBeTruthy();

  const transitions = await page.evaluate(async ({ path, pendingChatId, firstUser }) => {
    const { useAppStore } = await import(/* @vite-ignore */ path);
    const snapshot = () => {
      const state = useAppStore.getState();
      return {
        userId: state.currentUser?.id ?? null,
        chatIds: state.chats.map((chat: { id: string }) => chat.id),
        selectedChatId: state.selectedChatId,
      };
    };
    useAppStore.getState().setCurrentUser(null);
    const signedOut = snapshot();
    useAppStore.getState().setSelectedChatId(pendingChatId);
    const pending = snapshot();
    useAppStore.getState().setCurrentUser(firstUser);
    return { signedOut, pending, firstProfile: snapshot(), path: location.pathname };
  }, { path: storeModule!, pendingChatId: chatA, firstUser: accountA });

  expect(transitions.signedOut).toEqual({ userId: null, chatIds: [], selectedChatId: null });
  expect(transitions.pending).toEqual({ userId: null, chatIds: [], selectedChatId: chatA });
  expect(transitions.firstProfile).toEqual({ userId: accountA.id, chatIds: [], selectedChatId: chatA });
  expect(transitions.path).toBe(`/chat/${chatA}/m/${messageA}`);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await page.evaluate(() => location.pathname)).toBe(`/chat/${chatA}/m/${messageA}`);
  expect(await page.evaluate(async (path) => {
    const { useAppStore } = await import(/* @vite-ignore */ path);
    return useAppStore.getState().selectedChatId;
  }, storeModule!)).toBe(chatA);
});
