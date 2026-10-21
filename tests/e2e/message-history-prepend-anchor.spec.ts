import { expect, type Locator, type Page, test } from "@playwright/test";

import {
  chat,
  FIXTURE_HOST,
  membership,
  message,
  openChat,
  openFixture,
  person,
  type Row,
  requireFixtureServer,
} from "./helpers/messageActionsFixture";

/**
 * Loading older history leaves the message being read where it was, on every
 * frame and not only once the page has landed (CLAUDE.md section 11), and the
 * entry into a chat never takes back a reader who has started to scroll up.
 *
 * D-109, measured on 2026-09-11 on the fixture and matched on production: the
 * band «Загружаем историю...» was inserted above the conversation as the load
 * began and moved every message 43px down. A scroll event during the load took
 * the anchor again in that moved position, so the prepend restored the wrong
 * place and left the reader 43px off; the signed-in contract in
 * `visual-style-layout` failed at 42.8px.
 *
 * D-110: a settle pass of the entry decided on the bottom while the entry held
 * the reader there, and went a frame later — after the reader's wheel had let
 * go. Opened within four seconds and scrolled up, a chat could throw the reader
 * back to the bottom: measured on the fixture, from 120px to 4238px.
 */

const ME = person("11111111-1111-4111-8111-1111111111d1", "Максим");
const ANYA = person("11111111-1111-4111-8111-1111111111d2", "Аня");
const CHAT_ID = "22222222-2222-4222-8222-2222222222d1";
const LATEST_TEXT = "Последнее из трёхсот";

test.use({ screenshot: "off", trace: "off", video: "off" });

function history(count = 300): Row[] {
  const start = Date.now() - 400 * 60_000;
  return Array.from({ length: count }, (_, index) =>
    message(
      `55555555-5555-4555-8555-5${String(index).padStart(11, "0")}`,
      CHAT_ID,
      index % 2 ? ME : ANYA,
      index === count - 1 ? LATEST_TEXT : `Сообщение ${index + 1}`,
      new Date(start + index * 60_000).toISOString(),
    ),
  );
}

async function openConversation(page: Page, count = 300): Promise<Locator> {
  const now = new Date().toISOString();
  const messages = history(count);
  await openFixture(page, {
    me: ME,
    chats: [chat(CHAT_ID, "private", null, now)],
    memberships: [membership(CHAT_ID, ME, "owner", now), membership(CHAT_ID, ANYA, "member", now)],
    messages,
    rest(call) {
      const params = new URLSearchParams(call.search);
      if (call.resource !== "messages" || call.method !== "GET" || params.get("limit") !== "101") return;
      expect(params.get("chat_id")).toBe(`eq.${CHAT_ID}`);
      expect(params.get("order")).toBe("created_at.desc,id.desc");
      const before = params.get("or");
      let selected = messages.slice();
      if (before) {
        const tuple = /^\(created_at\.lt\."([^"]+)",and\(created_at\.eq\."([^"]+)",id\.lt\.([0-9a-f-]{36})\)\)$/.exec(before);
        expect(tuple, "real SDK emits an exclusive history tuple").not.toBeNull();
        expect(tuple![1]).toBe(tuple![2]);
        selected = selected.filter(row => String(row.created_at) < tuple![1]
          || (row.created_at === tuple![1] && String(row.id) < tuple![3]));
      }
      selected.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))
        || String(b.id).localeCompare(String(a.id)));
      return { status: 200, body: selected.slice(0, 101) };
    },
  });
  await openChat(page, ANYA.full_name, LATEST_TEXT);
  const container = page.getByTestId("message-scroll-container");
  await expect(container).toHaveAttribute("data-has-more-older", "true");
  await expect(container).toHaveAttribute("data-loading-older", "false");
  return container;
}

/** Older pages answer after a pause, so there is a load to watch. */
async function delayOlderPages(page: Page, ms: number) {
  await page.route(`${FIXTURE_HOST}/rest/v1/messages**`, async (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get("created_at")?.startsWith("lt.") || params.get("or")?.includes("created_at.lt.")) {
      await new Promise((resolve) => setTimeout(resolve, ms));
    }
    await route.fallback();
  });
}

function frames(page: Page, count: number) {
  return page.evaluate(
    (left) =>
      new Promise<void>((resolve) => {
        const step = (remaining: number) =>
          remaining ? requestAnimationFrame(() => step(remaining - 1)) : resolve();
        step(left);
      }),
    count,
  );
}

test.describe("the anchor through an older-history load", () => {
  test.use({ hasTouch: false, isMobile: false, viewport: { width: 1440, height: 900 } });
  test.beforeEach(async ({ request }) => {
    await requireFixtureServer(request);
  });

  test("the last older page remains retryable after hidden-ID verification fails", async ({
    page,
  }) => {
    const container = await openConversation(page, 101);
    const oldestId = "55555555-5555-4555-8555-500000000000";
    let refusals = 0;
    await page.route(`${FIXTURE_HOST}/rest/v1/message_hidden_for_users**`, async (route) => {
      if (refusals === 0 && route.request().url().includes(oldestId)) {
        refusals += 1;
        await new Promise((resolve) => setTimeout(resolve, 300));
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ code: "PGRST503", message: "synthetic older-page refusal" }),
        });
        return;
      }
      await route.fallback();
    });
    await container.dispatchEvent("wheel", { deltaY: -1 });
    await container.evaluate((node) => {
      (node as HTMLElement).scrollTop = 0;
    });
    await container.dispatchEvent("scroll");
    await expect(container).toHaveAttribute("data-loading-older", "true");
    await expect.poll(() => refusals).toBe(1);
    await expect(container).toHaveAttribute("data-loading-older", "false");
    await container.dispatchEvent("wheel", { deltaY: -1 });
    // The status-band layout may itself trigger the next top-of-list scroll.
    // If it does not, the reader's next scroll must still be able to retry.
    await expect
      .poll(async () => {
        await container.evaluate((node) => {
          (node as HTMLElement).scrollTop = 0;
        });
        await container.dispatchEvent("scroll");
        return container.locator("[data-message-id]").count();
      })
      .toBe(101);
    await expect(container).toHaveAttribute("data-has-more-older", "false");
  });

  test("the message being read does not move on any painted frame of the load, a scroll during it included", async ({
    page,
  }) => {
    const container = await openConversation(page);
    // The reader takes over from the entry, as a wheel does.
    await container.dispatchEvent("wheel", { deltaY: -1 });
    await frames(page, 3);
    await delayOlderPages(page, 600);

    // Scrolled near the top, which is what asks for the older page. Every frame
    // from here is measured after it is painted: a frame callback, then a task.
    const start = await container.evaluate((node) => {
      const el = node as HTMLElement;
      el.scrollTop = 120;
      const top = el.getBoundingClientRect().top;
      const visible = [...el.querySelectorAll<HTMLElement>("[data-message-id]")].find(
        (item) => item.getBoundingClientRect().bottom > top + 1,
      );
      const id = visible?.dataset.messageId;
      if (!id) return null;
      const offset = () => {
        const target = [...el.querySelectorAll<HTMLElement>("[data-message-id]")].find(
          (item) => item.dataset.messageId === id,
        );
        return target
          ? target.getBoundingClientRect().top - el.getBoundingClientRect().top
          : Number.POSITIVE_INFINITY;
      };
      const first = offset();
      const probe = window as unknown as {
        __anchorOffset: () => number;
        __worstDrift: number;
        __stopDrift: boolean;
      };
      probe.__anchorOffset = offset;
      probe.__worstDrift = 0;
      probe.__stopDrift = false;
      const sample = () => {
        if (probe.__stopDrift) return;
        probe.__worstDrift = Math.max(probe.__worstDrift, Math.abs(offset() - first));
        requestAnimationFrame(() => setTimeout(sample, 0));
      };
      requestAnimationFrame(() => setTimeout(sample, 0));
      return first;
    });
    expect(start, "no message was on screen to anchor to").not.toBeNull();

    await expect(container).toHaveAttribute("data-loading-older", "true", { timeout: 5_000 });
    await frames(page, 2);
    // What a wheel still turning sends while the page is on its way.
    await container.dispatchEvent("scroll");
    await expect(container).toHaveAttribute("data-loading-older", "false", { timeout: 15_000 });
    await expect
      .poll(() => container.evaluate((node) => node.querySelectorAll("[data-message-id]").length))
      .toBeGreaterThan(100);
    await page.waitForTimeout(1_000);

    const result = await page.evaluate(() => {
      const probe = window as unknown as {
        __anchorOffset: () => number;
        __worstDrift: number;
        __stopDrift: boolean;
      };
      probe.__stopDrift = true;
      return { final: probe.__anchorOffset(), worst: probe.__worstDrift };
    });
    expect(
      Math.abs(result.final - start!),
      "where the load left the message being read",
    ).toBeLessThanOrEqual(3);
    expect(
      result.worst,
      "the furthest the message moved on a painted frame of the load",
    ).toBeLessThanOrEqual(3);
  });

  test("continued scrolling after a prepend is not taken back by its settling hold", async ({ page }) => {
    const container = await openConversation(page);
    await container.dispatchEvent("wheel", { deltaY: -1 });
    await delayOlderPages(page, 300);
    await container.evaluate((node) => {
      const el = node as HTMLElement;
      el.scrollTop = 120;
      const state = { started: false, finished: false, steps: 0, start: 0, final: 0 };
      (window as unknown as { __prependMotion: typeof state }).__prependMotion = state;
      let target: HTMLElement | null = null;
      const offset = () => target!.getBoundingClientRect().top - el.getBoundingClientRect().top;
      const step = () => {
        if (!state.started && el.dataset.loadingOlder === "false" && el.querySelectorAll("[data-message-id]").length > 100) {
          const top = el.getBoundingClientRect().top;
          target = [...el.querySelectorAll<HTMLElement>("[data-message-id]")]
            .find(row => row.getBoundingClientRect().bottom > top + 1) ?? null;
          if (!target) throw Error("synthetic motion anchor missing");
          state.started = true;
          state.start = offset();
        }
        if (state.started) {
          if (state.steps === 12) {
            state.final = offset();
            state.finished = true;
            return;
          }
          // A continuing inertial scroll emits scroll events, not a new touchstart.
          el.scrollTop -= 12;
          state.steps++;
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    await container.dispatchEvent("scroll");
    await expect.poll(() => page.evaluate(() =>
      (window as unknown as { __prependMotion: { finished: boolean } }).__prependMotion.finished,
    )).toBe(true);
    const result = await page.evaluate(() =>
      (window as unknown as { __prependMotion: { start: number; final: number; steps: number } }).__prependMotion,
    );
    expect(result.steps).toBe(12);
    expect(result.final - result.start, "the user's continuing scroll must keep its movement, not be pinned to the prepend anchor").toBeGreaterThanOrEqual(120);
  });

  test("a message commit before scroll delivery does not reclaim prepend momentum", async ({ page }) => {
    const container = await openConversation(page);
    await container.dispatchEvent("wheel", { deltaY: -1 });
    await delayOlderPages(page, 300);
    await container.evaluate(async (node) => {
      const modulePath = "/src/store/app.store.ts";
      const { useAppStore } = await import(modulePath);
      const el = node as HTMLElement;
      const state = { finished: false, committed: false, scrollDelivered: false, requested: 0, actual: 0 };
      (window as unknown as { __prependCommit: typeof state }).__prependCommit = state;
      const step = () => {
        if (el.dataset.loadingOlder !== "false" || el.querySelectorAll("[data-message-id]").length <= 100) {
          requestAnimationFrame(step);
          return;
        }
        const store = useAppStore.getState();
        const chatId = store.selectedChatId!;
        const last = store.messages[chatId].at(-1)!;
        const onScroll = () => { state.scrollDelivered = true; };
        el.addEventListener("scroll", onScroll, { once: true });
        el.scrollTop -= 24;
        state.requested = el.scrollTop;
        const content = "Synthetic commit during prepend momentum";
        store.updateMessage(chatId, { ...last, content });
        queueMicrotask(() => {
          state.committed = el.querySelector(`[data-message-id="${last.id}"]`)?.textContent?.includes(content) ?? false;
          state.actual = el.scrollTop;
          el.removeEventListener("scroll", onScroll);
          state.finished = true;
        });
      };
      el.scrollTop = 120;
      requestAnimationFrame(step);
    });
    await container.dispatchEvent("scroll");
    await expect.poll(() => page.evaluate(() =>
      (window as unknown as { __prependCommit: { finished: boolean } }).__prependCommit.finished,
    )).toBe(true);
    const result = await page.evaluate(() =>
      (window as unknown as { __prependCommit: { committed: boolean; scrollDelivered: boolean; requested: number; actual: number } }).__prependCommit,
    );
    expect(result.committed, "actual message-list commit must precede the measured result").toBe(true);
    expect(result.scrollDelivered, "fixture must measure before native scroll delivery").toBe(false);
    expect(Math.abs(result.actual - result.requested), "the commit must leave the reader's momentum in place").toBeLessThanOrEqual(1);
  });

  for (const movement of [0, -24]) test(`first prepend preserves pending scroll=${movement} before its first commit`, async ({ page }) => {
    const container = await openConversation(page);
    await container.dispatchEvent("wheel", { deltaY: -1 });
    await delayOlderPages(page, 300);
    await container.evaluate(async (node, movement) => {
      const modulePath = "/src/store/app.store.ts";
      const { useAppStore } = await import(modulePath);
      const el = node as HTMLElement;
      const original = useAppStore.getState().setMessages;
      const state = { finished: false, committed: false, scrollDelivered: false, publications: 0, expected: 0, actual: 0 };
      (window as unknown as { __firstPrepend: typeof state }).__firstPrepend = state;
      useAppStore.setState({ setMessages(chatId, rows) {
        const current = useAppStore.getState().messages[chatId] ?? [];
        if (state.publications || rows.length <= current.length || rows[0]?.id === current[0]?.id) return original(chatId, rows);
        state.publications++;
        const top = el.getBoundingClientRect().top;
        const target = [...el.querySelectorAll<HTMLElement>("[data-message-id]")].find(row => row.getBoundingClientRect().bottom > top + 1)!;
        const offset = () => target.getBoundingClientRect().top - el.getBoundingClientRect().top;
        const onScroll = () => { state.scrollDelivered = true; };
        el.addEventListener("scroll", onScroll, { once: true });
        el.scrollTop += movement;
        state.expected = offset();
        original(chatId, rows); // Actual store/React publication; only the scheduling input is instrumented.
        queueMicrotask(() => {
          state.committed = el.querySelectorAll("[data-message-id]").length > 100;
          state.actual = offset();
          el.removeEventListener("scroll", onScroll);
          state.finished = true;
        });
      } });
    }, movement);
    await container.evaluate(node => { (node as HTMLElement).scrollTop = 120; });
    await container.dispatchEvent("scroll");
    await expect.poll(() => page.evaluate(() =>
      (window as unknown as { __firstPrepend: { finished: boolean } }).__firstPrepend.finished,
    )).toBe(true);
    const result = await page.evaluate(() =>
      (window as unknown as { __firstPrepend: { committed: boolean; scrollDelivered: boolean; publications: number; expected: number; actual: number } }).__firstPrepend,
    );
    expect(result.publications).toBe(1);
    expect(result.committed, "actual first prepend must commit before measurement").toBe(true);
    expect(result.scrollDelivered, "pending movement must not have reached the scroll handler").toBe(false);
    expect(Math.abs(result.actual - result.expected), "first prepend must restore growth without erasing pending reader movement").toBeLessThanOrEqual(1);
  });

  test("a settle pass of the entry does not take a reader to the bottom after their wheel let go", async ({
    page,
  }) => {
    const container = await openConversation(page);

    // Frames are held, the way a busy main thread delays one, until a settle
    // pass of the entry — still holding the reader at the bottom — has asked for
    // one. Cancelled frames are dropped, as the real queue drops them.
    await page.evaluate(() => {
      type Held = { id: number; callback: FrameRequestCallback };
      const gate = window as unknown as {
        __held: Held[];
        __gateOpen: boolean;
        __nextHeldId: number;
      };
      const request = window.requestAnimationFrame.bind(window);
      const cancel = window.cancelAnimationFrame.bind(window);
      gate.__held = [];
      gate.__gateOpen = false;
      gate.__nextHeldId = -1;
      window.requestAnimationFrame = (callback: FrameRequestCallback) => {
        if (gate.__gateOpen) return request(callback);
        const id = gate.__nextHeldId--;
        gate.__held.push({ id, callback });
        return id;
      };
      window.cancelAnimationFrame = (id: number) => {
        if (id < 0) gate.__held = gate.__held.filter((entry) => entry.id !== id);
        else cancel(id);
      };
    });
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            (window as unknown as { __held: { callback: FrameRequestCallback }[] }).__held.some(
              (entry) => String(entry.callback).includes("applyBottomNow"),
            ),
          ),
        {
          message:
            "no pass of the entry asked for a frame to go to the bottom while it held the reader there",
          timeout: 5_000,
        },
      )
      .toBe(true);

    // The reader's wheel lets go of the entry, and they are up in the history.
    await container.dispatchEvent("wheel", { deltaY: -400 });
    const reading = await container.evaluate((node) => {
      const el = node as HTMLElement;
      el.scrollTop = Math.round((el.scrollHeight - el.clientHeight) / 2);
      el.dispatchEvent(new Event("scroll"));
      return el.scrollTop;
    });

    // Now the frames the main thread was late with.
    await page.evaluate(() => {
      const gate = window as unknown as {
        __held: { callback: FrameRequestCallback }[];
        __gateOpen: boolean;
      };
      gate.__gateOpen = true;
      for (const entry of gate.__held.splice(0)) entry.callback(performance.now());
    });
    await frames(page, 3);

    const after = await container.evaluate((node) => (node as HTMLElement).scrollTop);
    expect(
      Math.abs(after - reading),
      `the reader at ${reading}px was taken to ${after}px`,
    ).toBeLessThanOrEqual(2);
  });
});
