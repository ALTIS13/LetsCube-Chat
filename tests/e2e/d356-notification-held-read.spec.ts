import { expect, test, type Request } from "@playwright/test";
import { FIXTURE_HOST, chat, membership, message, openFixture, person, requireFixtureServer } from "./helpers/messageActionsFixture";
import { RealtimeFixture } from "./helpers/realtime-fixture";

const id = (n: number) => `35610000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ME = person(id(1), "D356 Held Reader");
const PEER = person(id(2), "D356 Held Sender");
const SID1 = id(3);
const SID2 = id(4);
const OLD = { chatId: id(5), messageId: id(6), title: "D356 Old Notice" };
const NEXT = { chatId: id(7), messageId: id(8), title: "D356 New Notice" };
const AT = "2026-11-05T09:00:00.000Z";
const EMAIL = "d356-held-reader@example.invalid";
const PASSWORD = "fictional-d356-held-reader";
const READ_RPC = "/rest/v1/rpc/notifications_mark_chat_messages_read";

function fixtureSession(sid: string) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const iat = Math.floor(Date.now() / 1000);
  return {
    access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
      sub: ME.id, session_id: sid, role: "authenticated", iat, exp: iat + 3600,
    })}.${encode("fixture-signature")}`,
    refresh_token: "fictional-fixture-refresh", token_type: "bearer", expires_in: 3600,
    user: { id: ME.id, aud: "authenticated", role: "authenticated", email: EMAIL,
      user_metadata: { full_name: ME.full_name }, app_metadata: {}, created_at: AT },
  };
}

test.use({ screenshot: "off", trace: "off", video: "off", serviceWorkers: "block" });

test("D356: a held bell read ACK cannot continue after ordinary same-user reauthentication", async ({ page, request, baseURL }) => {
  expect(process.env.KUB_QA_ALLOW_MUTATIONS).toBe("0");
  const app = new URL(baseURL!);
  expect(app.protocol).toBe("http:");
  expect(app.hostname).toBe("127.0.0.1");
  await requireFixtureServer(request);
  await page.context().route(url => url.origin !== app.origin, route => route.abort("blockedbyclient"));
  await page.context().routeWebSocket(/.*/, socket => socket.close());
  const realtime = new RealtimeFixture();
  await realtime.install(page);

  const first = fixtureSession(SID1);
  const second = fixtureSession(SID2);
  const rows = [OLD, NEXT].map((target, index) => ({
    id: id(20 - index), user_id: ME.id, kind: "message", read_at: null as string | null,
    created_at: AT, alert_suppressed_at: null, feed_revision: 1,
    payload: { chat_id: target.chatId, chat_type: "group", chat_name: target.title, message_id: target.messageId,
      sender_id: PEER.id, sender_kind: "user", sender_name: PEER.full_name, preview: target.title },
  }));
  let active: "old" | "guest" | "new" = "old";
  const visible = () => active === "old" ? rows.slice(0, 1) : active === "new" ? rows : [];
  const feed = () => ({ v: 2, next: null, rows: visible() });
  const lookup = (ids: string[]) => {
    const retained = visible().filter(row => ids.includes(row.id));
    return { v: 2, rows: retained, unavailable_ids: ids.filter(value => !retained.some(row => row.id === value)) };
  };
  let opens = 0;
  await openFixture(page, {
    me: ME, people: [PEER],
    chats: [OLD, NEXT].map(target => chat(target.chatId, "group", target.title, AT)),
    memberships: [OLD, NEXT].flatMap(target => [ME, PEER].map(who => membership(target.chatId, who, "member", AT))),
    messages: [OLD, NEXT].map(target => message(target.messageId, target.chatId, PEER, target.title, AT)),
    rpc(name, args) {
      if (name === "notification_feed_open_v2") return { body: {
        v: 2, barrier_event_id: id(30 + ++opens), page: feed(), lookup: lookup(args.p_held_ids as string[]),
      } };
      if (name === "notification_feed_page_v2") return { body: feed() };
      if (name === "notification_feed_lookup_v2") return { body: lookup(args.p_ids as string[]) };
      return undefined;
    },
  });
  const uses = (req: Request, session: typeof first) =>
    req.headers().authorization === `Bearer ${session.access_token}`;
  let localLogout = 0;
  let logoutResponse: number | undefined;
  let logoutFailure: string | undefined;
  let passwordGrant = 0;
  page.on("response", res => {
    if (new URL(res.url()).pathname === "/auth/v1/logout") logoutResponse = res.status();
  });
  page.on("requestfailed", req => {
    if (new URL(req.url()).pathname === "/auth/v1/logout") logoutFailure = req.failure()?.errorText;
  });
  await page.route(url => url.origin === FIXTURE_HOST && url.pathname === "/auth/v1/logout", async route => {
    const req = route.request();
    expect(req.method()).toBe("POST");
    expect(new URL(req.url()).search).toBe("?scope=local");
    expect(uses(req, first)).toBe(true);
    expect(active).toBe("old");
    active = "guest";
    localLogout++;
    // Chromium aborts a synthetic 204 from route.fulfill on this Auth path.
    // A JSON 200 exercises the SDK's successful local sign-out without that transport artifact.
    await route.fulfill({ status: 200, json: {} });
  });
  await page.route(url => url.origin === FIXTURE_HOST && url.pathname === "/auth/v1/token", async route => {
    const req = route.request();
    expect(req.method()).toBe("POST");
    expect(new URL(req.url()).search).toBe("?grant_type=password");
    const body = req.postDataJSON();
    expect(body.email === EMAIL && body.password === PASSWORD).toBe(true);
    expect(active).toBe("guest");
    active = "new";
    passwordGrant++;
    await route.fulfill({ json: second });
  });

  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let held: Request | undefined;
  let oldFinished = false;
  let newReads = 0;
  let releasing = false;
  const late: string[] = [];
  page.on("requestfinished", req => { if (req === held) oldFinished = true; });
  page.on("request", req => {
    if (!releasing || new URL(req.url()).origin !== FIXTURE_HOST) return;
    const url = new URL(req.url());
    if (uses(req, first)) late.push("old-SID request");
    if (url.pathname === "/rest/v1/chat_members" && url.searchParams.get("select") === "chat_id"
        && url.searchParams.get("chat_id") === `eq.${OLD.chatId}`) late.push("old access lookup");
  });
  await page.route(url => url.origin === FIXTURE_HOST && url.pathname === READ_RPC, async route => {
    const req = route.request();
    const args = req.postDataJSON();
    // The visible chat can report a bounded read horizon separately.
    if (args.p_read_until !== null) return route.fallback();
    expect(req.method()).toBe("POST");
    if (args.p_chat_id === OLD.chatId) {
      expect(uses(req, first)).toBe(true);
      expect(active).toBe("old");
      expect(held).toBeUndefined();
      rows[0].read_at = AT;
      rows[0].feed_revision++;
      held = req;
      await gate;
    } else {
      expect(args.p_chat_id).toBe(NEXT.chatId);
      expect(uses(req, second)).toBe(true);
      expect(active).toBe("new");
      rows[1].read_at = AT;
      rows[1].feed_revision++;
      newReads++;
    }
    await route.fulfill({ status: 200, json: null });
  });

  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.name));
  await page.addInitScript(() => {
    const jumps: unknown[] = [];
    Object.assign(window, { d356HeldRead: { documentId: crypto.randomUUID(), jumps } });
    window.addEventListener("kub:chat-message-jump", event => jumps.push((event as CustomEvent).detail));
  });
  const probe = () => page.evaluate(() => (window as Window & {
    d356HeldRead?: { documentId: string; jumps: unknown[] };
  }).d356HeldRead);
  const bell = page.getByTestId("notification-bell-button");
  const admitFeed = async (sid: string, ordinal: number) => {
    await expect.poll(() => opens).toBe(ordinal);
    expect(realtime.isJoined(`notification-feed-v2:${ME.id}:${sid}`)).toBe(true);
    expect(realtime.emit({ type: "INSERT", table: "notification_feed_events_v2", record: {
      event_id: id(30 + ordinal), recipient_id: ME.id, notification_id: null, event_kind: "invalidate", created_at: AT,
    } })).toBe(1);
  };
  const clickNotice = async (target: typeof OLD) => {
    await bell.click();
    await page.getByTestId("notification-message-group").filter({ hasText: target.title }).click();
  };
  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(bell).toBeVisible();
    const initial = await probe();
    expect(initial?.documentId).toBeTruthy();
    await page.evaluate(async session => {
      const { createClient } = await import("/src/lib/supabase/client.ts" /* @vite-ignore */);
      const { error } = await createClient().auth.setSession(session);
      if (error) throw Error("D356 fixture session refused");
    }, { access_token: first.access_token, refresh_token: first.refresh_token });
    await admitFeed(SID1, 1);
    await clickNotice(OLD);
    await expect.poll(() => Boolean(held)).toBe(true);
    expect(oldFinished).toBe(false);
    expect(await probe()).toEqual(initial);

    const menu = page.getByTestId("side-menu-button");
    if (await menu.isVisible()) await menu.click();
    else await page.getByRole("button", { name: "Меню", exact: true }).click();
    await page.getByRole("button", { name: "Выйти", exact: true }).click();
    const signOut = page.getByRole("dialog", { name: "Выйти из аккаунта?", exact: true })
      .or(page.getByRole("alertdialog", { name: "Выйти из аккаунта?", exact: true }));
    await signOut.getByRole("button", { name: "Выйти", exact: true }).click();
    await expect.poll(() => localLogout, { message: "the dialog must issue the exact SID1 local logout" }).toBe(1);
    const email = page.getByPlaceholder("Эл. почта", { exact: true });
    const home = page.locator("#public-home-title");
    await expect.poll(async () => ({
      guest: await home.isVisible() || await email.isVisible(),
      signedIn: await bell.isVisible(),
      logoutError: await page.getByText("Не удалось выйти", { exact: true }).isVisible(),
      logoutResponse,
      logoutFailure,
    })).toEqual({ guest: true, signedIn: false, logoutError: false, logoutResponse: 200, logoutFailure: undefined });
    if (await home.isVisible()) {
      const login = page.getByRole("link", { name: "Войти", exact: true });
      await expect(login).toHaveAttribute("href", "/login");
      await login.click();
    }
    await expect(page).toHaveURL(new URL("/login", app).href);
    await email.fill(EMAIL);
    await page.getByPlaceholder("Пароль", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await expect(bell).toBeVisible();
    expect(passwordGrant).toBe(1);
    await admitFeed(SID2, 2);
    expect(await probe()).toEqual(initial);

    await clickNotice(NEXT);
    const nextRoute = new URL(`/chat/${NEXT.chatId}/m/${NEXT.messageId}`, app).href;
    await expect(page).toHaveURL(nextRoute);
    const expected = { documentId: initial!.documentId, jumps: [{ chatId: NEXT.chatId, messageId: NEXT.messageId }] };
    await expect.poll(probe).toEqual(expected);
    expect(newReads).toBe(1);
    expect(oldFinished).toBe(false);

    releasing = true;
    release();
    await expect.poll(() => oldFinished).toBe(true);
    // Allow the actual JS continuation and its 150ms jump, if any, to execute.
    await page.waitForTimeout(400);
    expect(late, "retired read must not start another request for the old chat or SID").toEqual([]);
    await expect(page).toHaveURL(nextRoute);
    expect(await probe()).toEqual(expected);
    expect(errors).toEqual([]);
  } finally {
    release();
  }
});
