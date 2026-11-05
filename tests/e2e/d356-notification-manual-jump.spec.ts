import { expect, test } from "@playwright/test";
import { FIXTURE_HOST, chat, membership, message, openFixture, person, requireFixtureServer } from "./helpers/messageActionsFixture";
import { RealtimeFixture } from "./helpers/realtime-fixture";

const id = (n: number) => `35600000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ME = person(id(1), "D356 Reader");
const PEER = person(id(2), "D356 Sender");
const TARGET = id(3);
const MANUAL = id(4);
const MESSAGE = id(5);
const SESSION = id(6);
const NOTICE = id(7);
const AT = "2026-11-05T09:00:00.000Z";
const JUMP = { chatId: TARGET, messageId: MESSAGE };

test.use({ screenshot: "off", trace: "off", video: "off", serviceWorkers: "block" });

test("D356: manual chat round trip retires an already queued bell jump", async ({ page, request, baseURL }) => {
  expect(process.env.KUB_QA_ALLOW_MUTATIONS).toBe("0");
  const app = new URL(baseURL!);
  expect(app.protocol).toBe("http:");
  expect(app.hostname).toBe("127.0.0.1");
  await requireFixtureServer(request);
  await page.context().route(url => url.origin !== app.origin, route => route.abort("blockedbyclient"));
  await page.context().routeWebSocket(/.*/, socket => socket.close());
  const realtime = new RealtimeFixture();
  await realtime.install(page);

  const notice = {
    id: NOTICE, user_id: ME.id, kind: "message", read_at: null as string | null,
    created_at: AT, alert_suppressed_at: null, feed_revision: 1,
    payload: { chat_id: TARGET, chat_type: "group", message_id: MESSAGE,
      sender_id: PEER.id, sender_kind: "user", sender_name: PEER.full_name, text: "D356 Target Message" },
  };
  const feed = () => ({ v: 2, next: null, rows: [notice] });
  const lookup = (ids: string[]) => ({ v: 2, rows: ids.includes(NOTICE) ? [notice] : [],
    unavailable_ids: ids.filter(value => value !== NOTICE) });
  let opens = 0;
  const fixture = await openFixture(page, {
    me: ME, people: [PEER],
    chats: [chat(TARGET, "group", "D356 Target Chat", AT), chat(MANUAL, "group", "D356 Manual Chat", AT)],
    memberships: [TARGET, MANUAL].flatMap(chatId => [ME, PEER].map(who => membership(chatId, who, "member", AT))),
    messages: [message(MESSAGE, TARGET, PEER, "D356 Target Message", AT)],
    rpc(name, args) {
      if (name === "notification_feed_open_v2") return { body: {
        v: 2, barrier_event_id: id(10 + ++opens), page: feed(), lookup: lookup(args.p_held_ids as string[]),
      } };
      if (name === "notification_feed_page_v2") return { body: feed() };
      if (name === "notification_feed_lookup_v2") return { body: lookup(args.p_ids as string[]) };
      if (name === "notifications_mark_chat_messages_read" && args.p_chat_id === TARGET && !notice.read_at) {
        notice.read_at = AT;
        notice.feed_revision++;
      }
      return undefined;
    },
  });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.name));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const bell = page.getByTestId("notification-bell-button");
  await expect(bell).toBeVisible();
  await page.evaluate(async ({ uid, sid }) => {
    const { createClient } = await import("/src/lib/supabase/client.ts" /* @vite-ignore */);
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: unknown) => btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
    const access_token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
      sub: uid, session_id: sid, role: "authenticated", iat: now, exp: now + 3600,
    })}.${encode("fixture-signature")}`;
    const { error } = await createClient().auth.setSession({ access_token, refresh_token: "fixture-refresh" });
    if (error) throw Error("D356 fixture session refused");
  }, { uid: ME.id, sid: SESSION });
  await expect.poll(() => opens).toBe(1);
  expect(realtime.isJoined(`notification-feed-v2:${ME.id}:${SESSION}`)).toBe(true);
  expect(realtime.emit({ type: "INSERT", table: "notification_feed_events_v2", record: {
    event_id: id(11), recipient_id: ME.id, notification_id: null, event_kind: "invalidate", created_at: AT,
  } })).toBe(1);
  await page.evaluate(() => {
    const jumps: unknown[] = [];
    Object.assign(window, { d356Jumps: jumps });
    window.addEventListener("kub:chat-message-jump", event => jumps.push((event as CustomEvent).detail));
  });

  const jumps = () => page.evaluate(() => (window as Window & { d356Jumps?: unknown[] }).d356Jumps);
  const onRoute = (path: string) => expect(page).toHaveURL(new URL(path, app).href);
  const jumpPath = `/chat/${TARGET}/m/${MESSAGE}`;
  const clickChat = async (name: string, chatId: string) => {
    await page.getByTestId("chat-list-item").filter({ hasText: name }).click();
    await onRoute(`/chat/${chatId}`);
  };
  const clickBellNotice = async () => {
    await bell.click();
    await page.getByTestId("notification-message-group").filter({ hasText: PEER.full_name }).click();
    await onRoute(jumpPath);
  };
  const bellReads = () => fixture.rpcBodies("notifications_mark_chat_messages_read")
    .filter(args => args.p_read_until === null);

  // Freeze time before clicking: the two real sidebar clicks cannot race the
  // 150ms callback. Advance less than useChatAddress's first 250ms jump.
  const now = new Date();
  await page.clock.install({ time: now });
  await page.clock.pauseAt(new Date(now.getTime() + 1000));
  await clickBellNotice();
  expect(bellReads()).toEqual([{ p_chat_id: TARGET, p_read_until: null }]);
  expect(await jumps()).toEqual([]);
  await page.clock.runFor(200);
  expect(await jumps()).toEqual([JUMP]);

  await clickChat("D356 Manual Chat", MANUAL);
  await clickBellNotice();
  expect(bellReads()).toEqual(Array(2).fill({ p_chat_id: TARGET, p_read_until: null }));
  await clickChat("D356 Manual Chat", MANUAL);
  await clickChat("D356 Target Chat", TARGET);
  expect(await jumps()).toEqual([JUMP]);

  await page.clock.runFor(200);
  await onRoute(`/chat/${TARGET}`);
  expect(await jumps(), "the old bell must not jump after the user manually reopens its chat").toEqual([JUMP]);
  expect(errors).toEqual([]);
});
