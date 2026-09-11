import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  chat,
  FIXTURE_HOST,
  membership,
  message,
  openChat,
  openFixture,
  person,
  requireFixtureServer,
  type Row,
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

function history(): Row[] {
  const start = Date.now() - 400 * 60_000;
  return Array.from({ length: 300 }, (_, index) => message(
    `55555555-5555-4555-8555-5${String(index).padStart(11, "0")}`,
    CHAT_ID,
    index % 2 ? ME : ANYA,
    index === 299 ? LATEST_TEXT : `Сообщение ${index + 1}`,
    new Date(start + index * 60_000).toISOString(),
  ));
}

async function openConversation(page: Page): Promise<Locator> {
  const now = new Date().toISOString();
  await openFixture(page, {
    me: ME,
    chats: [chat(CHAT_ID, "private", null, now)],
    memberships: [membership(CHAT_ID, ME, "owner", now), membership(CHAT_ID, ANYA, "member", now)],
    messages: history(),
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
    const createdAt = new URL(route.request().url()).searchParams.get("created_at");
    if (createdAt?.startsWith("lt.")) await new Promise((resolve) => setTimeout(resolve, ms));
    await route.fallback();
  });
}

function frames(page: Page, count: number) {
  return page.evaluate((left) => new Promise<void>((resolve) => {
    const step = (remaining: number) => (remaining ? requestAnimationFrame(() => step(remaining - 1)) : resolve());
    step(left);
  }), count);
}

test.describe("the anchor through an older-history load", () => {
  test.use({ hasTouch: false, isMobile: false, viewport: { width: 1440, height: 900 } });
  test.beforeEach(async ({ request }) => {
    await requireFixtureServer(request);
  });

  test("the message being read does not move on any painted frame of the load, a scroll during it included", async ({ page }) => {
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
      const visible = [...el.querySelectorAll<HTMLElement>("[data-message-id]")]
        .find((item) => item.getBoundingClientRect().bottom > top + 1);
      const id = visible?.dataset.messageId;
      if (!id) return null;
      const offset = () => {
        const target = [...el.querySelectorAll<HTMLElement>("[data-message-id]")].find((item) => item.dataset.messageId === id);
        return target ? target.getBoundingClientRect().top - el.getBoundingClientRect().top : Number.POSITIVE_INFINITY;
      };
      const first = offset();
      const probe = window as unknown as { __anchorOffset: () => number; __worstDrift: number; __stopDrift: boolean };
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
    await expect.poll(() => container.evaluate((node) => node.querySelectorAll("[data-message-id]").length)).toBeGreaterThan(100);
    await page.waitForTimeout(1_000);

    const result = await page.evaluate(() => {
      const probe = window as unknown as { __anchorOffset: () => number; __worstDrift: number; __stopDrift: boolean };
      probe.__stopDrift = true;
      return { final: probe.__anchorOffset(), worst: probe.__worstDrift };
    });
    expect(Math.abs(result.final - start!), "where the load left the message being read").toBeLessThanOrEqual(3);
    expect(result.worst, "the furthest the message moved on a painted frame of the load").toBeLessThanOrEqual(3);
  });

  test("a settle pass of the entry does not take a reader to the bottom after their wheel let go", async ({ page }) => {
    const container = await openConversation(page);

    // Frames are held, the way a busy main thread delays one, until a settle
    // pass of the entry — still holding the reader at the bottom — has asked for
    // one. Cancelled frames are dropped, as the real queue drops them.
    await page.evaluate(() => {
      type Held = { id: number; callback: FrameRequestCallback };
      const gate = window as unknown as { __held: Held[]; __gateOpen: boolean; __nextHeldId: number };
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
        () => page.evaluate(() => (window as unknown as { __held: { callback: FrameRequestCallback }[] }).__held
          .some((entry) => String(entry.callback).includes("applyBottomNow"))),
        { message: "no pass of the entry asked for a frame to go to the bottom while it held the reader there", timeout: 5_000 },
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
      const gate = window as unknown as { __held: { callback: FrameRequestCallback }[]; __gateOpen: boolean };
      gate.__gateOpen = true;
      for (const entry of gate.__held.splice(0)) entry.callback(performance.now());
    });
    await frames(page, 3);

    const after = await container.evaluate((node) => (node as HTMLElement).scrollTop);
    expect(Math.abs(after - reading), `the reader at ${reading}px was taken to ${after}px`).toBeLessThanOrEqual(2);
  });
});
