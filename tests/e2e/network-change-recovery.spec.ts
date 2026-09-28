import { expect, test, type Request, type Route } from "@playwright/test";
import {
  chat,
  membership,
  message,
  openFixture,
  person,
  requireFixtureServer,
} from "./helpers/messageActionsFixture";
import { RealtimeFixture } from "./helpers/realtime-fixture";

/**
 * Tracker item 53: «Если меняется IP… приходится перезапускать мессенджер».
 *
 * A VPN switched off to open another app left the messenger dead until it was
 * restarted. The mechanism reproduced here: a read sent over the old route is
 * never answered, the chat list runs one read at a time, and every later
 * refresh queued behind the dead one — so nothing on screen could change again.
 * The rules are `lib/supabase/requestDeadline.ts` and `lib/realtimeRevival.ts`
 * and their cases are `tests/unit/connection-revival.test.mts`; what is
 * measured here is the whole chain in the application: a moment of doubt cuts
 * the stranded read, and the refresh that queued behind it goes out and lands.
 *
 * A route handler that never answers stands in for the dead socket: the browser
 * waits on it exactly as it waits on a TCP connection that vanished.
 */

const AT = "2026-09-28T09:00:00.000Z";
const ME = person("a7111111-1111-4111-8111-000000000001", "Максим Орлов");
const ANNA = person("a7111111-1111-4111-8111-000000000002", "Анна Смирнова");
const TEAM = "a7222222-2222-4222-8222-000000000001";

test.describe("a change of network does not need a restart (item 53)", () => {
  test.beforeEach(async ({ request }) => {
    await requireFixtureServer(request);
  });

  test("a read stranded on the old route is cut, and the refresh behind it lands", async ({ page }) => {
    await openFixture(page, {
      me: ME,
      people: [ANNA],
      chats: [chat(TEAM, "group", "Команда проекта", AT)],
      memberships: [membership(TEAM, ME, "owner", AT), membership(TEAM, ANNA, "member", AT)],
      messages: [message("a7333333-3333-4333-8333-000000000001", TEAM, ANNA, "Макет главной готов", AT)],
    });

    // The membership read is the chat list's first; while it waits, every other
    // refresh of the list queues behind it.
    let strand = false;
    const stranded: Route[] = [];
    const reads: Request[] = [];
    await page.route("**/rest/v1/chat_members*", async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      reads.push(route.request());
      if (strand) {
        strand = false;
        stranded.push(route);
        return; // never answered: the old route's socket
      }
      return route.fallback();
    });
    const failures: string[] = [];
    page.on("requestfailed", (request) => {
      if (request.url().includes("/rest/v1/chat_members")) failures.push(request.failure()?.errorText ?? "");
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("chat-list-item")).toHaveCount(1);

    // The network changes; the list's next read goes out over the dead route.
    strand = true;
    const before = reads.length;
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(() => stranded.length).toBe(1);

    // Another refresh is asked for and queues behind the stranded one — the
    // state the report describes. Nothing reaches the server.
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.waitForTimeout(500);
    expect(reads.length, "a refresh went out although one was already in flight").toBe(before + 1);

    // The moment of doubt, once the read has waited past the point where a
    // change can have stranded it. On a phone this is the network type's own
    // `change` or the return from the other app; `online` is the one every
    // browser raises.
    await page.waitForTimeout(3_100);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));

    // The stranded read was cut rather than left to the operating system…
    await expect.poll(() => failures.length).toBeGreaterThan(0);
    // …and the refresh that queued behind it went out and was answered.
    await expect.poll(() => reads.length).toBeGreaterThan(before + 1);
    await expect(page.getByTestId("chat-list-item")).toHaveCount(1);
    await expect(page.getByTestId("chat-list-stale")).toHaveCount(0);
    await expect(page.getByTestId("chat-list-unavailable")).toHaveCount(0);
  });
  // The words Telegram puts where the list's title is (`lib/connectionState.ts`):
  // a list that looks current while nothing arrives has to say so.
  test("a connection that was up and is lost says «Соединение...» until it is back", async ({ page }) => {
    test.setTimeout(60_000);
    const realtime = new RealtimeFixture();
    await realtime.install(page);
    await openFixture(page, {
      me: ME,
      people: [ANNA],
      chats: [chat(TEAM, "group", "Команда проекта", AT)],
      memberships: [membership(TEAM, ME, "owner", AT), membership(TEAM, ANNA, "member", AT)],
      messages: [message("a7333333-3333-4333-8333-000000000002", TEAM, ANNA, "Макет главной готов", AT)],
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect.poll(() => realtime.isJoined(":messages"), { timeout: 15_000 }).toBe(true);

    const status = page.locator("[data-connection-state]").filter({ visible: true });
    await page.waitForTimeout(1_500);
    await expect(status).toHaveCount(0);

    await realtime.goDark();
    // After the grace: a socket replaced on purpose is not announced.
    await expect(status).toHaveText("Соединение...", { timeout: 10_000 });
    await expect(status).toHaveAttribute("data-connection-state", "connecting");

    realtime.restore();
    await expect(status).toHaveCount(0, { timeout: 30_000 });
  });

  test("a device without network says «Ожидание сети...» at once", async ({ page, context }) => {
    await openFixture(page, {
      me: ME,
      people: [ANNA],
      chats: [chat(TEAM, "group", "Команда проекта", AT)],
      memberships: [membership(TEAM, ME, "owner", AT), membership(TEAM, ANNA, "member", AT)],
      messages: [message("a7333333-3333-4333-8333-000000000003", TEAM, ANNA, "Макет главной готов", AT)],
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("chat-list-item")).toHaveCount(1);
    const status = page.locator("[data-connection-state]").filter({ visible: true });
    await expect(status).toHaveCount(0);

    await context.setOffline(true);
    await expect(status).toHaveText("Ожидание сети...", { timeout: 3_000 });
    await context.setOffline(false);
    // This fixture has no socket at all, so back online is simply online.
    await expect(status).toHaveCount(0, { timeout: 5_000 });
  });
});
