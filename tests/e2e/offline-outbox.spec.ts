import { expect, test, type Page, type Route } from "@playwright/test";
import {
  chat,
  membership,
  message,
  openFixture,
  person,
  requireFixtureServer,
} from "./helpers/messageActionsFixture";
import { sendFromField } from "./helpers/composerSend";

// A controlling SW bypasses page/context network mocks on reload in WebKit.
// This suite measures the durable outbox, not SW routing or cache behavior.
test.use({ serviceWorkers: "block" });

/**
 * Tracker item 52. Two testers, on their first day: a message written without a
 * connection could not be sent later — it turned red at once, and a restart
 * lost it; a voice note had to be recorded again. «Прям сильно
 * пользовательский опыт погубило».
 *
 * Telegram's mechanic, which the outbox adopts: the bubble waits with a clock,
 * is kept on the device, and goes by itself, in order, when the connection
 * answers — after a restart too. Red only for a refusal. The rules and the
 * runner are `tests/unit/outbox.test.mts`; what is measured here is the
 * application: the composer, the bubble, the device's storage, the reload.
 */

const AT = "2026-09-28T09:00:00.000Z";
const ME = person("b5111111-1111-4111-8111-000000000001", "Максим Орлов");
const ANNA = person("b5111111-1111-4111-8111-000000000002", "Анна Смирнова");
const TEAM = "b5222222-2222-4222-8222-000000000001";
const FIRST = "Макет главной готов";

type Server = "answer" | "unreachable" | "refuse" | "busy" | "internal" | "lost";

async function boot(page: Page, theme: "dark" | "light" = "dark") {
  await openFixture(page, {
    me: ME,
    theme,
    people: [ANNA],
    chats: [chat(TEAM, "group", "Команда проекта", AT)],
    memberships: [membership(TEAM, ME, "owner", AT), membership(TEAM, ANNA, "member", AT)],
    messages: [message("b5333333-3333-4333-8333-000000000001", TEAM, ANNA, FIRST, AT)],
  });
  const server = { server: "answer" as Server, inserts: [] as Record<string, unknown>[], landed: new Map<string, Record<string, unknown>>() };
  await page.route("**/rest/v1/messages*", async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const clientId = url.searchParams.get("client_message_id");
    if (request.method() === "POST") {
      if (server.server === "unreachable") return route.abort("internetdisconnected");
      const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
      server.inserts.push(body);
      if (server.server === "busy" || server.server === "internal") {
        return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({
          code: server.server === "busy" ? "55P03" : "XX000", details: null, hint: null,
          message: server.server === "busy" ? "fixture_coverage_busy" : "fictional_internal_error",
        }) });
      }
      if (server.server === "refuse") {
        return route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({ code: "42501", details: null, hint: null, message: 'new row violates row-level security policy for table "messages"' }),
        });
      }
      const row = {
        ...message(`b5444444-4444-4444-8444-${String(server.inserts.length).padStart(12, "0")}`, String(body.chat_id), ME, String(body.content ?? ""), new Date().toISOString()),
        client_message_id: body.client_message_id ?? null,
        client_sent_at: body.client_sent_at ?? null,
      };
      server.landed.set(String(body.client_message_id), row);
      if (server.server === "lost") return route.abort("internetdisconnected");
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(row) });
    }
    // «Did it land?» — asked after an attempt that got no answer.
    if (clientId) {
      if (server.server === "unreachable") return route.abort("internetdisconnected");
      const landed = server.landed.get(decodeURIComponent(clientId.replace(/^eq\./, "")));
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(landed ? [landed] : []) });
    }
    return route.fallback();
  });
  await page.goto(`/chat/${TEAM}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-message-bubble="true"]').filter({ hasText: FIRST })).toBeVisible();
  return server;
}

const bubble = (page: Page, text: string) => page.locator('[data-message-bubble="true"]').filter({ hasText: text });
/** The delivery mark's own words: the icon is `role="img"` named by its state. */
const state = (page: Page, text: string, name: "Отправляется" | "Не удалось отправить") =>
  bubble(page, text).locator("[data-message-delivery-slot]").getByRole("img", { name });

async function write(page: Page, text: string) {
  const composer = page.getByPlaceholder("Сообщение…").first();
  await composer.fill(text);
  await sendFromField(composer);
}

async function sendSoundAsks(page: Page) {
  return page.evaluate(() => ((window as unknown as {
    __letscubeCallSounds?: { asks: { ask: string; sound: string | null; bursts: number }[] };
  }).__letscubeCallSounds?.asks ?? []).filter((ask) => ask.ask === "once" && ask.sound === "messageSent")
    .map(({ ask, sound, bursts }) => ({ ask, sound, bursts })));
}

test.describe("messages written without a connection (item 52)", () => {
  test.beforeEach(async ({ request }) => {
    await requireFixtureServer(request);
  });

  test("send cue waits for the real ACK and sounds once after a lost response", async ({ page }) => {
    const server = await boot(page);
    server.server = "unreachable";
    const asks = () => sendSoundAsks(page);
    await write(page, "Fictional send sound check");
    await expect(state(page, "Fictional send sound check", "Отправляется")).toBeVisible();
    expect(await asks()).toEqual([]);
    server.server = "lost";
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(() => server.inserts.length).toBe(1);
    await expect.poll(asks).toEqual([{ ask: "once", sound: "messageSent", bursts: 1 }]);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    expect(await asks()).toHaveLength(1);
  });

  for (const change of ["sound off", "capture", "other chat"] as const) {
    test(`send cue respects ${change} changed before the ACK`, async ({ page }) => {
      const server = await boot(page);
      let release!: () => void;
      const barrier = new Promise<void>((resolve) => { release = resolve; });
      let requested = false;
      await page.route("**/rest/v1/messages*", async (route) => {
        if (route.request().method() === "POST") { requested = true; await barrier; }
        await route.fallback();
      });
      await write(page, "Fictional delayed ACK");
      await expect.poll(() => requested).toBe(true);
      await page.evaluate(async (change) => {
        if (change === "sound off") localStorage.setItem("kub:audio-settings:v1", JSON.stringify({ notificationSoundEnabled: false }));
        if (change === "capture") {
          const recorder = document.createElement("div");
          recorder.dataset.recordingPhase = "recording";
          document.body.append(recorder);
        }
        if (change === "other chat") {
          const store = await import("/src/store/app.store.ts");
          store.useAppStore.setState({ selectedChatId: null });
        }
      }, change);
      release();
      await expect.poll(() => server.inserts.length).toBe(1);
      await expect.poll(async () => (await durableEntries(page)).length).toBe(0);
      expect(await sendSoundAsks(page)).toEqual([]);
    });
  }

  test("one-shot scheduling rechecks its caller after a delayed AudioContext resume", async ({ page }) => {
    await boot(page);
    const result = await page.evaluate(async () => {
      let release!: () => void;
      let resumed = false;
      const barrier = new Promise<void>((resolve) => { release = resolve; });
      class DelayedContext {
        state = "suspended";
        async resume() { resumed = true; await barrier; this.state = "running"; }
        createOscillator() { throw new Error("a withdrawn sound may not create an oscillator"); }
        createGain() { throw new Error("a withdrawn sound may not create a gain"); }
      }
      window.__letscubeAudioContext = DelayedContext as unknown as typeof AudioContext;
      // Isolate the player's context, not its scheduling implementation.
      const player = await import("/src/lib/callSoundPlayer.ts?delayed-send-cue");
      let allowed = true;
      const pending = player.playCallSoundOnce("messageSent", () => allowed);
      await Promise.resolve();
      if (!resumed) throw new Error("the test did not enter the resume boundary");
      allowed = false;
      release();
      await pending;
      return window.__letscubeCallSounds?.asks.filter((ask) => ask.ask === "once" && ask.sound === "messageSent")
        .map(({ bursts }) => ({ bursts }));
    });
    expect(result).toEqual([{ bursts: 0 }]);
  });

  test("send cue coalesces ACKs below 100ms but permits the exact next boundary", async ({ page }) => {
    await boot(page);
    const params = { userId: ME.id, chatId: TEAM, topicId: null };
    await page.evaluate(async (params) => {
      const sounds = await import("/src/hooks/useCallSound.ts");
      const original = performance.now.bind(performance);
      let now = 1_000_000;
      Object.defineProperty(performance, "now", { configurable: true, value: () => now });
      try {
        for (const timestamp of [1_000_000, 1_000_099, 1_000_100]) {
          now = timestamp;
          sounds.playMessageSentSoundFor(params);
          // primeCallSounds and begin both yield before scheduling.
          await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
        }
      } finally { Object.defineProperty(performance, "now", { configurable: true, value: original }); }
    }, params);
    await expect.poll(() => sendSoundAsks(page)).toEqual([
      { ask: "once", sound: "messageSent", bursts: 1 },
      { ask: "once", sound: "messageSent", bursts: 0 },
      { ask: "once", sound: "messageSent", bursts: 1 },
    ]);
  });

  test("waits with its clock instead of turning red, and goes by itself when the connection answers", async ({ page }) => {
    const server = await boot(page);
    server.server = "unreachable";
    await write(page, "Бетон привезут к девяти");

    await expect(bubble(page, "Бетон привезут к девяти")).toBeVisible();
    // Given the time the old path took to turn red: a failed fetch is almost
    // instant, so a second is a fair premise.
    await page.waitForTimeout(1_000);
    await expect(state(page, "Бетон привезут к девяти", "Отправляется")).toBeVisible();
    await expect(bubble(page, "Бетон привезут к девяти").getByRole("button", { name: "Повторить" })).toHaveCount(0);
    await expect(page.getByText("Сетевой сбой", { exact: false })).toHaveCount(0);

    // The connection is back: the moment the browser says so, it goes.
    server.server = "answer";
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(() => server.inserts.length).toBe(1);
    await expect(state(page, "Бетон привезут к девяти", "Отправляется")).toHaveCount(0);
    await expect(state(page, "Бетон привезут к девяти", "Не удалось отправить")).toHaveCount(0);
  });

  test("survives a restart and goes after it, once", async ({ page }) => {
    const server = await boot(page);
    server.server = "unreachable";
    await write(page, "Кран заказан на десять");
    await expect(state(page, "Кран заказан на десять", "Отправляется")).toBeVisible();

    // The application is closed and opened again, the connection still down.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(bubble(page, FIRST)).toBeVisible();
    await expect(bubble(page, "Кран заказан на десять"), "a restart lost the message").toBeVisible();
    await expect(state(page, "Кран заказан на десять", "Отправляется")).toBeVisible();

    server.server = "answer";
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(() => server.inserts.length).toBe(1);
    await expect(state(page, "Кран заказан на десять", "Отправляется")).toHaveCount(0);
    // Once: the same client id, whatever the number of attempts.
    await page.waitForTimeout(1_000);
    expect(server.inserts.length).toBe(1);
    expect(new Set(server.inserts.map((row) => row.client_message_id)).size).toBe(1);
  });

  test("several go in the order they were written", async ({ page }) => {
    const server = await boot(page);
    server.server = "unreachable";
    for (const text of ["Первое", "Второе", "Третье"]) await write(page, text);
    await expect(state(page, "Третье", "Отправляется")).toBeVisible();
    server.server = "answer";
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(() => server.inserts.length).toBe(3);
    expect(server.inserts.map((row) => row.content)).toEqual(["Первое", "Второе", "Третье"]);
  });

  test("a refusal is red at once: waiting would not change it", async ({ page }) => {
    const server = await boot(page);
    server.server = "refuse";
    await write(page, "Это не пройдёт");
    await expect(state(page, "Это не пройдёт", "Не удалось отправить")).toBeVisible();
    expect(server.inserts.length).toBe(1);
    expect(await sendSoundAsks(page)).toEqual([]);
  });
});

async function durableEntries(page: Page) {
  return page.evaluate(async () => new Promise<Record<string, unknown>[]>((resolve, reject) => {
    const opening = indexedDB.open("kub-outbox", 1);
    opening.onerror = () => reject(new Error("fictional outbox unavailable"));
    opening.onsuccess = () => {
      const db = opening.result, tx = db.transaction("entries", "readonly");
      let entries: Record<string, unknown>[] = [];
      tx.objectStore("entries").getAll().onsuccess = (event) => { entries = (event.target as IDBRequest).result; };
      tx.oncomplete = () => { db.close(); resolve(entries); };
      tx.onerror = () => { db.close(); reject(new Error("fictional outbox read failed")); };
    };
  }));
}

test.describe("narrow busy recovery through real application and IndexedDB", () => {
  test.beforeEach(async ({ request }) => { await requireFixtureServer(request); });

  for (const theme of ["dark", "light"] as const) {
    test(`busy message survives reload and keeps one identity in ${theme}`, async ({ page }, info) => {
      const server = await boot(page, theme); server.server = "busy";
      await write(page, "Проверка временной блокировки");
      await expect(state(page, "Проверка временной блокировки", "Отправляется")).toBeVisible();
      await expect.poll(async () => (await durableEntries(page)).length).toBe(1);
      await expect.poll(async () => (await durableEntries(page))[0]?.attempts ?? 0).toBeGreaterThanOrEqual(1);
      const stored = (await durableEntries(page))[0];
      expect(stored.content).toBe("Проверка временной блокировки");
      await page.screenshot({ path: info.outputPath(`outbox-busy-${theme}.png`) });
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(state(page, "Проверка временной блокировки", "Отправляется")).toBeVisible();
      await expect.poll(async () => (await durableEntries(page))[0]?.attempts ?? 0).toBeGreaterThan(Number(stored.attempts));
      expect((await durableEntries(page))[0].clientMessageId).toBe(stored.clientMessageId);
      server.server = "answer";
      // No online event: the scheduled retry must also work by itself.
      await expect.poll(() => server.landed.size).toBe(1);
      await expect(state(page, "Проверка временной блокировки", "Отправляется")).toHaveCount(0);
      await expect(state(page, "Проверка временной блокировки", "Не удалось отправить")).toHaveCount(0);
      await expect.poll(async () => (await durableEntries(page)).length).toBe(0);
      expect(new Set(server.inserts.map((row) => row.client_message_id)).size).toBe(1);
      expect(server.inserts.every((row) => row.chat_id === TEAM && row.user_id === ME.id)).toBe(true);
    });
  }

  test("revoked authority after busy becomes final, not a new cached send", async ({ page }) => {
    const server = await boot(page); server.server = "busy";
    await write(page, "Право отправки отозвано");
    await expect.poll(async () => (await durableEntries(page)).length).toBe(1);
    await expect.poll(async () => (await durableEntries(page))[0]?.attempts ?? 0).toBeGreaterThanOrEqual(1);
    server.server = "refuse";
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(state(page, "Право отправки отозвано", "Не удалось отправить")).toBeVisible();
    await expect.poll(async () => (await durableEntries(page)).length).toBe(0);
    const calls = server.inserts.length;
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.waitForTimeout(2_100);
    expect(server.inserts.length).toBe(calls); expect(server.landed.size).toBe(0);
  });

  test("an unrelated 500 is refused and is not put in a busy loop", async ({ page }) => {
    const server = await boot(page); server.server = "internal";
    await write(page, "Окончательная ошибка сервера");
    await expect(state(page, "Окончательная ошибка сервера", "Не удалось отправить")).toBeVisible();
    expect((await durableEntries(page)).length).toBe(0);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.waitForTimeout(2_100); expect(server.inserts.length).toBe(1);
  });

  test("immediate lost-response ACK removes the durable entry without a second POST", async ({ page }) => {
    const server = await boot(page); server.server = "lost";
    await write(page, "Ответ потерялся после доставки");
    await expect.poll(() => server.landed.size).toBe(1);
    await expect(state(page, "Ответ потерялся после доставки", "Отправляется")).toHaveCount(0);
    await expect.poll(async () => (await durableEntries(page)).length).toBe(0);
    await page.waitForTimeout(2_100); expect(server.inserts.length).toBe(1);
  });
});
