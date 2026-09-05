import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { gotoOrSkip, loadQaCredentials, loadQaEnvValues, signInFreshOrSkip } from "./helpers/auth";

/**
 * One account, two devices, and a peer.
 *
 * Everything else in this suite runs one browser per account, so nothing had
 * ever exercised the case the owner actually asked about: the same person
 * signed in twice at once. That gap hid a real outage. `chats:user:{id}`
 * carried four postgres_changes bindings — two on `messages`, two on `chats` —
 * and `public.chats` is not in the `supabase_realtime` publication, so the
 * channel reported SUBSCRIBED, was assigned a server id for every binding, and
 * delivered nothing whatsoever. The sidebar's unread badge and last-message
 * preview only moved when some unrelated refetch happened to run.
 *
 * That reads as a two-device bug because one device hides it: you focus the
 * tab, the visibility refetch fires, and the sidebar catches up before you
 * notice anything was ever stale. A second device that is already focused has
 * nothing to hide behind.
 *
 * Device A and device B sign in independently on purpose — see
 * `signInFreshOrSkip`.
 */

const CHAT_MARKER = "md-sync";

test.describe("two devices, one account", () => {
  test.describe.configure({ mode: "serial" });

  let ctxA: BrowserContext;
  let ctxB: BrowserContext;
  let ctxP: BrowserContext;
  let A: Page;
  let B: Page;
  let P: Page;
  let chatId = "";
  let accountId = "";
  const created: { page: Page; id: string }[] = [];

  test.beforeAll(async ({ browser }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium-desktop-1440",
      "the multi-device matrix runs once",
    );
    const env = loadQaEnvValues();
    const allowMutations = process.env.KUB_QA_ALLOW_MUTATIONS || env.get("KUB_QA_ALLOW_MUTATIONS");
    test.skip(
      allowMutations !== "1",
      "this sends real messages; set KUB_QA_ALLOW_MUTATIONS=1 to run it",
    );
    test.skip(
      !loadQaCredentials("client") || !loadQaCredentials("owner"),
      "client and owner QA credentials are required",
    );

    ctxA = await browser.newContext();
    ctxB = await browser.newContext();
    ctxP = await browser.newContext();
    A = await ctxA.newPage();
    B = await ctxB.newPage();
    P = await ctxP.newPage();

    await gotoOrSkip(A, "/");
    await signInFreshOrSkip(A, "client");
    await gotoOrSkip(B, "/");
    await signInFreshOrSkip(B, "client");
    await gotoOrSkip(P, "/");
    await signInFreshOrSkip(P, "owner");

    accountId = await currentUserId(A);
    expect(await currentUserId(B), "both devices must hold the same account").toBe(accountId);
    expect(await currentUserId(P), "the peer must be a different account").not.toBe(accountId);

    for (const [label, page] of [
      ["A", A],
      ["B", B],
      ["P", P],
    ] as const) {
      await assertStoreIsShared(page, label);
    }

    chatId = await openPrivateChatWith(P, accountId);
    await openChat(P, chatId);
    for (const page of [A, B]) {
      await expect.poll(() => unreadCount(page, chatId), { timeout: 20_000 }).not.toBeNull();
    }
  });

  test.afterAll(async () => {
    for (const { page, id } of created) {
      if (page.isClosed()) continue;
      await softDelete(page, id).catch(() => null);
    }
    await ctxA?.close().catch(() => null);
    await ctxB?.close().catch(() => null);
    await ctxP?.close().catch(() => null);
  });

  /**
   * The root cause, guarded directly and cheaply.
   *
   * Mixing tables on one channel is only fatal when one of those tables is
   * absent from the publication, and that is a fact about the database this
   * test cannot see. So it asserts the rule that makes the failure impossible
   * for the sidebar: its bindings are split per table, so a dead binding can
   * only ever take down its own table.
   *
   * Scoped to `chats:user:` deliberately. Other channels in this application
   * still mix tables — `chat-info:{id}`, `admin-dashboard-v2` and `roles:*` all
   * carry a binding on an unpublished table and are silently inert because of
   * it — and a blanket assertion here would fail for reasons this suite is not
   * fixing. It would also be wrong as a universal rule: `task-routing:*` mixes
   * `locations` with `location_members` and works, because both are published.
   */
  test("the sidebar subscribes one channel per table", async () => {
    const sidebar = await A.evaluate(async () => {
      const { getRealtimeClient } = await import("/src/lib/supabase/client.ts");
      const rt = getRealtimeClient() as unknown as {
        getChannels?: () => unknown[];
        channels?: unknown[];
      };
      const list = (typeof rt.getChannels === "function" ? rt.getChannels() : rt.channels) ?? [];
      return (
        list as {
          topic: string;
          bindings?: { postgres_changes?: { filter?: { table?: string } }[] };
        }[]
      )
        .filter((channel) => channel.topic.includes("chats:user:"))
        .map((channel) => ({
          topic: channel.topic,
          tables: [
            ...new Set(
              (channel.bindings?.postgres_changes ?? [])
                .map((binding) => binding.filter?.table)
                .filter((table): table is string => Boolean(table)),
            ),
          ],
        }));
    });

    expect(sidebar.length, "the sidebar subscription must exist").toBeGreaterThan(0);
    for (const channel of sidebar) {
      expect(
        channel.tables,
        `${channel.topic} mixes tables, so one unpublished table silences the rest`,
      ).toHaveLength(1);
    }
    expect(sidebar.map((channel) => channel.tables[0]).sort()).toEqual(["chats", "messages"]);
  });

  test("a read on one device clears the unread count on the other", async () => {
    await closeChat(A);
    await closeChat(B);

    const marker = uniqueMarker();
    for (let index = 0; index < 3; index += 1) {
      await sendAndTrack(P, chatId, `${marker} #${index + 1}`, created);
    }

    // Both devices must first agree that there is something unread. This is the
    // half that was broken: without it the "cleared" assertion below passes
    // vacuously against a badge that never moved off zero.
    await expect.poll(() => unreadCount(A, chatId), { timeout: 25_000 }).toBe(3);
    await expect.poll(() => unreadCount(B, chatId), { timeout: 25_000 }).toBe(3);

    await openChat(A, chatId);

    await expect.poll(() => unreadCount(A, chatId), { timeout: 15_000 }).toBe(0);
    await expect.poll(() => unreadCount(B, chatId), { timeout: 25_000 }).toBe(0);

    // The receipt itself, not just the badge: the peer must see the watermark
    // move, and both devices must agree on where it landed.
    await expect
      .poll(() => memberLastReadAt(P, chatId, accountId), { timeout: 25_000 })
      .not.toBeNull();
    await expect
      .poll(
        async () => {
          const onA = await memberLastReadAt(A, chatId, accountId);
          const onB = await memberLastReadAt(B, chatId, accountId);
          return onA !== null && onA === onB;
        },
        { timeout: 25_000 },
      )
      .toBe(true);
  });

  test("the account stays online while one device is backgrounded", async () => {
    // Longer than the 90s presence threshold, so a heartbeat that stopped for
    // the account rather than for the device would age out inside the window.
    const WINDOW_MS = 100_000;
    test.setTimeout(WINDOW_MS + 90_000);

    await openChat(A, chatId);
    await expect
      .poll(() => peerPresence(P, chatId), { timeout: 30_000 })
      .toMatchObject({
        isOnline: true,
      });

    const first = await peerPresence(P, chatId);
    await setHidden(B, true);
    try {
      const deadline = Date.now() + WINDOW_MS;
      const offline: unknown[] = [];
      let last = first;
      while (Date.now() < deadline) {
        await P.waitForTimeout(10_000);
        last = await peerPresence(P, chatId);
        if (!last.isOnline) offline.push(last);
      }

      expect(
        offline,
        "a backgrounded second device must not make the account look offline",
      ).toEqual([]);

      // The peer's *view* has to keep moving, not merely have started fresh.
      // A frozen `online_at` reads as online for the first 90 seconds on its
      // own, so a shorter check would pass against a value nothing refreshes —
      // which is exactly the state this window was long enough to catch.
      expect(
        new Date(last.online_at ?? 0).getTime(),
        "the peer must see the heartbeat advance, not a frozen timestamp",
      ).toBeGreaterThan(new Date(first.online_at ?? 0).getTime());
    } finally {
      await setHidden(B, false);
    }
  });

  test("messages sent from both devices land in one order everywhere", async () => {
    await openChat(A, chatId);
    await openChat(B, chatId);

    const sequential = uniqueMarker();
    const sent: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const text = `${sequential} #${index + 1}`;
      sent.push(text);
      await sendAndTrack(index % 2 === 0 ? A : B, chatId, text, created);
    }
    for (const page of [A, B, P]) {
      await expect.poll(() => renderedTexts(page, sequential), { timeout: 30_000 }).toEqual(sent);
    }

    // A genuine race: neither device waits for its own acknowledgement, so the
    // inserts interleave. There is no send order to demand here — what must
    // hold is that all three views agree, because two people reading the same
    // two messages in opposite orders is broken however each order was reached.
    const burst = uniqueMarker();
    await Promise.all([
      (async () => {
        await sendViaUi(A, `${burst} a1`);
        await sendViaUi(A, `${burst} a2`);
      })(),
      (async () => {
        await sendViaUi(B, `${burst} b1`);
        await sendViaUi(B, `${burst} b2`);
      })(),
    ]);

    for (const page of [A, B, P]) {
      await expect
        .poll(async () => (await renderedTexts(page, burst)).length, { timeout: 30_000 })
        .toBe(4);
    }
    // Settle before comparing: an order that agrees only for an instant is not
    // agreement, and a late joined-row upsert can still resort the list.
    await A.waitForTimeout(4_000);
    const onA = await renderedTexts(A, burst);
    expect(await renderedTexts(B, burst)).toEqual(onA);
    expect(await renderedTexts(P, burst)).toEqual(onA);

    for (const page of [A, B]) {
      for (const row of await storeMessages(page, chatId, burst)) {
        if (!row.id.startsWith("tmp:")) created.push({ page, id: row.id });
      }
    }
  });

  test("a device that was closed catches up on everything it missed", async () => {
    await closeChat(B);
    await B.close();

    const marker = uniqueMarker();
    const sent: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const text = `${marker} #${index + 1}`;
      sent.push(text);
      await sendAndTrack(P, chatId, text, created);
    }

    B = await ctxB.newPage();
    await B.goto("/", { waitUntil: "domcontentloaded" });
    await B.getByRole("button", { name: "Меню" })
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
    await openChat(B, chatId);

    await expect.poll(() => renderedTexts(B, marker), { timeout: 30_000 }).toEqual(sent);
    const rows = await storeMessages(B, chatId, marker);
    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((row) => row.id)).size, "each message exactly once").toBe(5);
  });

  test("an optimistic send never doubles or leaves a tmp: row behind", async () => {
    await openChat(A, chatId);
    await openChat(B, chatId);
    await openChat(P, chatId);

    const marker = uniqueMarker();
    await sendAndTrack(A, chatId, `${marker} once`, created);
    // Long enough for a second delivery to arrive if one is coming: the
    // realtime echo, the joined refetch and the sidebar refetch all land inside
    // this window.
    await A.waitForTimeout(6_000);

    for (const [label, page] of [
      ["A", A],
      ["B", B],
      ["P", P],
    ] as const) {
      expect(await renderedTexts(page, marker), `${label} rendered it once`).toHaveLength(1);
      expect(await storeMessages(page, chatId, marker), `${label} stored it once`).toHaveLength(1);
      const leftovers = (await storeMessages(page, chatId, null)).filter((row) =>
        row.id.startsWith("tmp:"),
      );
      expect(leftovers, `${label} kept no optimistic row`).toEqual([]);
    }
  });

  /**
   * The duplicate you can actually see.
   *
   * Settled state is not enough to answer "does it ever show twice". The insert
   * is echoed back over realtime as a fully-formed row with a server id, and it
   * routinely arrives *before* the insert's own reply does. Between those two
   * moments the sender holds an optimistic `tmp:` row and a server row for the
   * same message, and only `sameActorClientMessage` — matching on
   * `client_message_id` **and** sender — folds them onto one another. Match on
   * id alone and both are on screen until the reply lands.
   *
   * Normally that window is milliseconds, which is why a settled-state check
   * cannot see it. Holding the reply back stretches it to something a person
   * would: eight seconds of the same message twice, on the device that sent it.
   */
  test("an in-flight send does not show twice before its reply lands", async () => {
    test.setTimeout(90_000);
    await openChat(A, chatId);
    await openChat(B, chatId);

    const HOLD_MS = 8_000; // shorter than the 12s ack timeout: this is the
    // ordinary slow-network case, not the lost-acknowledgement one.
    let held = false;
    await A.route("**/rest/v1/messages*", async (route) => {
      if (held || route.request().method() !== "POST") return route.continue();
      held = true;
      const response = await route.fetch();
      const body = await response.body();
      await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
      await route.fulfill({ response, body });
    });

    const marker = uniqueMarker();
    const text = `${marker} inflight`;
    try {
      await sendViaUi(A, text);

      // Watch the whole window rather than sampling its end.
      const counts: number[] = [];
      const deadline = Date.now() + HOLD_MS + 4_000;
      while (Date.now() < deadline) {
        counts.push((await renderedTexts(A, marker)).length);
        await A.waitForTimeout(400);
      }

      expect(held, "the insert reply was actually held back").toBe(true);
      expect(
        Math.max(...counts),
        `the sender rendered its own message ${Math.max(...counts)} times while it was in flight`,
      ).toBe(1);
      expect(Math.max(...counts), "the message was never rendered at all").toBeGreaterThan(0);
    } finally {
      await A.unroute("**/rest/v1/messages*");
    }

    // And it still settles to exactly one row, with nothing optimistic left.
    await expect.poll(() => renderedTexts(A, marker), { timeout: 30_000 }).toHaveLength(1);
    for (const [label, page] of [
      ["A", A],
      ["B", B],
      ["P", P],
    ] as const) {
      expect(await storeMessages(page, chatId, marker), `${label} stored it once`).toHaveLength(1);
      const leftovers = (await storeMessages(page, chatId, null)).filter((row) =>
        row.id.startsWith("tmp:"),
      );
      expect(leftovers, `${label} kept no optimistic row`).toEqual([]);
    }
    for (const row of await storeMessages(A, chatId, marker)) {
      if (!row.id.startsWith("tmp:")) created.push({ page: A, id: row.id });
    }
  });
});

function uniqueMarker() {
  return `${CHAT_MARKER} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Proves this suite is reading the store the application is actually using.
 *
 * Every assertion below reaches into the store through
 * `import("/src/store/app.store.ts")`. Under a Vite dev server that has hot
 * reloaded since it started, the app's own import carries an invalidation
 * timestamp (`?t=...`) and this one does not, so the two resolve to *different
 * module instances* — a second, empty Zustand store. The application keeps
 * working perfectly; this suite just reads a store nobody writes to, and every
 * chat looks absent.
 *
 * That is worth failing loudly on rather than debugging twice: it cost an
 * afternoon once, because a mutation run reported four caught mutants that had
 * really all died in setup. A signed-in page whose store has no current user is
 * the tell.
 */
async function assertStoreIsShared(page: Page, label: string) {
  const hasUser = await page.evaluate(async () => {
    const { useAppStore } = await import("/src/store/app.store.ts");
    return Boolean(useAppStore.getState().currentUser);
  });
  expect(
    hasUser,
    `device ${label} is signed in but its store has no current user. The dev server has hot ` +
      `reloaded since it started, so this suite is reading a second module instance. ` +
      `Restart the Vite server and run again.`,
  ).toBe(true);
}

async function currentUserId(page: Page): Promise<string> {
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
    if (!(await safeOpenChat(targetChatId))) throw new Error("qa_chat_not_opened");
  }, chatId);
}

async function closeChat(page: Page) {
  await page.evaluate(async () => {
    const { useAppStore } = await import("/src/store/app.store.ts");
    useAppStore.getState().setSelectedChatId(null);
  });
}

async function unreadCount(page: Page, chatId: string): Promise<number | null> {
  return page.evaluate(async (targetChatId) => {
    const { useAppStore } = await import("/src/store/app.store.ts");
    const chat = useAppStore.getState().chats.find((item) => item.id === targetChatId);
    return chat ? (chat.unread_count ?? 0) : null;
  }, chatId);
}

async function memberLastReadAt(
  page: Page,
  chatId: string,
  memberId: string,
): Promise<string | null> {
  return page.evaluate(
    async ({ targetChatId, targetMemberId }) => {
      const { useAppStore } = await import("/src/store/app.store.ts");
      const chat = useAppStore.getState().chats.find((item) => item.id === targetChatId);
      return (
        chat?.members?.find((member) => member.user_id === targetMemberId)?.last_read_at ?? null
      );
    },
    { targetChatId: chatId, targetMemberId: memberId },
  );
}

async function peerPresence(page: Page, chatId: string) {
  return page.evaluate(async (targetChatId) => {
    const { useAppStore } = await import("/src/store/app.store.ts");
    const { getUserPresenceState } = await import("/src/lib/presence.ts");
    const chat = useAppStore.getState().chats.find((item) => item.id === targetChatId);
    const state = getUserPresenceState(chat?.other_user ?? null, Date.now());
    return {
      online_at: chat?.other_user?.online_at ?? null,
      isOnline: state.isOnline,
      label: state.label,
    };
  }, chatId);
}

/** Drives the page's own visibility handlers, which is what the heartbeat reads. */
async function setHidden(page: Page, hidden: boolean) {
  await page.evaluate((isHidden) => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (isHidden ? "hidden" : "visible"),
    });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => isHidden });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

async function renderedTexts(page: Page, marker: string): Promise<string[]> {
  return page.evaluate((needle) => {
    return [...document.querySelectorAll("[data-message-text-content='true']")]
      .map((node) => (node.textContent ?? "").trim())
      .filter((text) => text.includes(needle));
  }, marker);
}

async function storeMessages(page: Page, chatId: string, marker: string | null) {
  return page.evaluate(
    async ({ targetChatId, needle }) => {
      const { useAppStore } = await import("/src/store/app.store.ts");
      return (useAppStore.getState().messages[targetChatId] ?? [])
        .filter((message) => !needle || (message.content ?? "").includes(needle))
        .map((message) => ({ id: message.id, created_at: message.created_at }));
    },
    { targetChatId: chatId, needle: marker },
  );
}

async function sendViaUi(page: Page, text: string) {
  await page.getByPlaceholder("Сообщение…").fill(text);
  await page.getByRole("button", { name: "Отправить" }).click();
}

async function sendAndTrack(
  page: Page,
  chatId: string,
  text: string,
  created: { page: Page; id: string }[],
) {
  await sendViaUi(page, text);
  await expect
    .poll(
      async () => {
        const rows = await storeMessages(page, chatId, text);
        return rows.length === 1 && !rows[0].id.startsWith("tmp:") ? rows[0].id : null;
      },
      { timeout: 25_000 },
    )
    .not.toBeNull();
  const [row] = await storeMessages(page, chatId, text);
  created.push({ page, id: row.id });
}

/** Cleanup uses the product's own soft delete rather than a raw row removal. */
async function softDelete(page: Page, messageId: string) {
  await page.evaluate(async (id) => {
    const { createClient } = await import("/src/lib/supabase/client.ts");
    await createClient()
      .from("messages")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
  }, messageId);
}
