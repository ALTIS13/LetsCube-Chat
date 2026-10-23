import { expect, test } from "@playwright/test";
import { chat, membership, message, openFixture, person, requireFixtureServer } from "./helpers/messageActionsFixture";

const ME = person("74000000-0000-4000-8000-000000000001", "Offline QA");
const PEER = person("74000000-0000-4000-8000-000000000002", "Offline peer");
const CHAT = "74000000-0000-4000-8000-000000000010";
const ID = "74000000-0000-4000-8000-000000000011";
test.use({ screenshot: "off", trace: "off", video: "off", serviceWorkers: "block" });
test.beforeEach(async ({ request }) => requireFixtureServer(request));

test("actual app cold restore: list, received history, reconnect replacement and clear", async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", error => runtimeErrors.push(error.stack ?? error.message));
  page.on("console", message => { if (message.type() === "error" && message.text().includes("Error")) runtimeErrors.push(message.text()); });
  let disconnected = false, changed = false, cleared = false, denied = false;
  const initial = message(ID, CHAT, PEER, "Synthetic offline original", new Date(Date.now() - 60000).toISOString());
  const mine = membership(CHAT, ME, "owner", null);
  const fixture = await openFixture(page, {
    me: ME, chats: [chat(CHAT, "private", null, new Date().toISOString())],
    memberships: [mine, membership(CHAT, PEER, "member", null)],
    messages: [initial],
    rpc(name) {
      if (name !== "clear_chat_for_me") return;
      cleared = true; mine.cleared_at = new Date().toISOString();
      return { status: 200, body: null };
    },
    rest(call) {
      if (disconnected) return { status: 503, body: { code: "SYNTHETIC_OFFLINE" } };
      if (denied && call.resource === "messages" && call.method === "GET") return { status: 403, body: { message: "Synthetic permission refusal" } };
      if (cleared && call.resource === "messages" && call.method === "GET") return { status: 200, body: [] };
      if (changed && call.resource === "messages" && call.method === "GET") return { status: 200, body: [{ ...initial, content: "Synthetic online replacement" }] };
    },
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const entry = page.getByTestId("chat-list-item").filter({ hasText: PEER.full_name });
  await expect(entry).toBeVisible(); await entry.click();
  await expect(page.locator(`[data-message-id="${ID}"]`)).toContainText("Synthetic offline original");
  // Wait for actual durable transaction, not an in-memory write acknowledgement.
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open("kub-history-cache"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try { if (!db.objectStoreNames.contains("records")) return false; return await new Promise<boolean>(resolve => { const tx = db.transaction("records"); const r = tx.objectStore("records").getAll(); r.onsuccess = () => resolve(r.result.some(row => typeof row.scope === "string" && row.scope.startsWith("messages:"))); }); } finally { db.close(); }
  })).toBe(true);
  disconnected = true;
  await page.reload({ waitUntil: "domcontentloaded" });
  // Mobile correctly reopens the addressed chat, with the list behind it.
  if ((page.viewportSize()?.width ?? 1440) < 768) {
    await expect(page.locator(`[data-message-id="${ID}"]`)).toContainText("Synthetic offline original", { timeout: 12000 });
    await page.getByTestId("chat-header-shell").getByRole("button", { name: "Назад", exact: true }).click();
  }
  await expect(entry).toBeVisible({ timeout: 12000 }); await entry.click();
  await expect(page.locator(`[data-message-id="${ID}"]`)).toContainText("Synthetic offline original", { timeout: 12000 });
  await expect(page.getByTestId("offline-history-status")).toBeVisible();
  changed = true; disconnected = false;
  const beforeRecovery = fixture.requests.length;
  const recoveryState = await page.evaluate(async () => {
    const { useAppStore } = await import("/src/store/app.store.ts");
    const state = useAppStore.getState();
    return { source: state.authSessionSource, epoch: state.accountEpoch, hasProfile: !!state.currentUser,
      visible: document.visibilityState, online: navigator.onLine,
      fetches: window.__kubDevInstrumentation?.cumulativeFetches };
  });
  await page.evaluate(() => {
    const probe = { started: [] as string[], ended: [] as string[], online: 0, markStarted: 0, markEnded: 0 };
    (window as unknown as { offlineProbe: typeof probe }).offlineProbe = probe;
    const original = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const url = new URL(typeof args[0] === "string" ? args[0] : args[0] instanceof URL ? args[0].href : args[0].url);
      const name = url.pathname; probe.started.push(name);
      try { const result = await original(...args); probe.ended.push(name + ":" + result.status); return result; }
      catch (error) { probe.ended.push(name + ":" + (error as Error).name); throw error; }
    };
    window.addEventListener("online", () => { probe.online++; });
  });
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  try {
    await expect(page.locator(`[data-message-id="${ID}"]`)).toContainText("Synthetic online replacement", { timeout: 15000 });
  } catch (error) {
    // Synthetic fixture only: expose the stalled boundary, never message bodies.
    const finalState = await page.evaluate(async () => {
      const { createClient } = await import("/src/lib/supabase/client.ts");
      const auth = createClient().auth as unknown as { lockAcquired?: boolean; pendingInLock?: unknown[]; refreshingDeferred?: unknown };
      return { fetches: window.__kubDevInstrumentation?.cumulativeFetches, probe: (window as unknown as { offlineProbe: unknown }).offlineProbe,
        auth: { lockAcquired: auth.lockAcquired, pending: auth.pendingInLock?.length, refreshing: !!auth.refreshingDeferred },
        locks: typeof navigator.locks?.query === "function" ? await navigator.locks.query() : null };
    });
    console.log(JSON.stringify({ recoveryState, finalState, runtimeErrors, recoveryCalls: fixture.requests.slice(beforeRecovery).map(call => ({ resource: call.resource, method: call.method })) }));
    throw error;
  }
  await expect(page.getByTestId("offline-history-status")).toHaveCount(0);
  await expect(page.getByText("Synthetic offline original", { exact: true })).toHaveCount(0);
  denied = true;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.locator(`[data-message-id="${ID}"]`)).toHaveCount(0);
  await expect(page.getByTestId("offline-history-status")).toHaveCount(0);
  denied = false;
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(page.locator(`[data-message-id="${ID}"]`)).toContainText("Synthetic online replacement");
  await page.getByTestId("chat-header-shell").getByRole("button", { name: "Ещё", exact: true }).click();
  await page.locator('[data-chat-menu-item="Очистить историю у себя"]').click();
  await page.getByRole("button", { name: "Очистить", exact: true }).click();
  await expect(page.locator(`[data-message-id="${ID}"]`)).toHaveCount(0);
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open("kub-history-cache"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try { return await new Promise<boolean>(resolve => { const tx = db.transaction("records"); const r = tx.objectStore("records").getAll(); r.onsuccess = () => resolve(r.result.some(row => typeof row.payload === "string" && row.payload.includes("Synthetic online replacement"))); }); } finally { db.close(); }
  })).toBe(false);
});
