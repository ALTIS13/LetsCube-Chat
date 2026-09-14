import { expect, type APIRequestContext, type Locator, type Page, type Route } from "@playwright/test";

/**
 * A backend for the message-action specs, played by route mocks on the DEV
 * fixture host — the pattern `message-forward-feedback.spec.ts` set, shared by
 * the specs that need a chat, its members and its messages, and a say in how
 * each database function answers.
 *
 * It refuses any other configuration and aborts every request to a host that is
 * not this machine, so a misconfigured server cannot reach a real backend.
 */

export const FIXTURE_HOST = "http://127.0.0.1:54321";
const EPOCH = "2026-09-01T09:00:00.000Z";

export type Row = Record<string, unknown>;

export interface Person {
  id: string;
  full_name: string;
  username: string | null;
  avatar_url: null;
  bio: null;
  role: string;
  online_at: string;
  created_at: string;
  updated_at: string;
}

export function person(id: string, fullName: string, username: string | null = null): Person {
  return { id, full_name: fullName, username, avatar_url: null, bio: null, role: "user", online_at: EPOCH, created_at: EPOCH, updated_at: EPOCH };
}

export function membership(chatId: string, who: Person, role: string, lastReadAt: string | null): Row {
  return {
    chat_id: chatId,
    user_id: who.id,
    role,
    joined_at: EPOCH,
    last_read_at: lastReadAt,
    last_delivered_at: lastReadAt,
    hidden_at: null,
    cleared_at: null,
    pinned: false,
    pinned_at: null,
    pinned_order: null,
    profile: who,
  };
}

/**
 * A chat row as the database really holds one.
 *
 * `invite_policy` used to be seeded «admins_only», which production would
 * refuse: its CHECK allows `owner_admin_only` and `members_can_invite` and
 * nothing else, and all 40 chats there carry the first. The client reads only
 * those two as well, so every fixture-based render of the information card
 * showed a state the product cannot be in — «Недоступно» beside a policy nobody
 * had set. The register recorded the symptom on 2026-09-13; this is the cause.
 */
export function chat(id: string, type: "private" | "group" | "channel", name: string | null, updatedAt: string): Row {
  return { id, type, name, description: null, avatar_url: null, created_by: null, created_at: EPOCH, updated_at: updatedAt, is_forum: false, invite_policy: "owner_admin_only" };
}

export function message(id: string, chatId: string, sender: Person, content: string, createdAt: string, extra: Row = {}): Row {
  return {
    id,
    chat_id: chatId,
    topic_id: null,
    user_id: sender.id,
    bot_id: null,
    sender_deleted_at: null,
    content,
    type: "text",
    media_bucket: null,
    media_path: null,
    media_url: null,
    media_metadata: {},
    reply_to_id: null,
    reply_to: null,
    forwarded_from_id: null,
    forwarded_from: null,
    client_message_id: null,
    client_sent_at: null,
    bot_reply_markup: null,
    pinned: false,
    created_at: createdAt,
    edited_at: null,
    deleted_at: null,
    sender,
    bot: null,
    reactions: [],
    ...extra,
  };
}

/** How a mocked database function answers. */
export type RpcAnswer = { status?: number; body: unknown } | { abort: "internetdisconnected" };

export function missingFunction(name: string): RpcAnswer {
  return {
    status: 404,
    body: { code: "PGRST202", details: null, hint: null, message: `Could not find the function public.${name} in the schema cache` },
  };
}

export interface RecordedRequest {
  method: string;
  /** `rpc/<name>`, a table name, or a path outside the REST API. */
  resource: string;
  search: string;
  body: unknown;
  /**
   * The `Prefer` header as it went out. It is the only place a chained
   * `.select()` on an insert shows: PostgREST is asked for the row back with
   * `return=representation`, and on `content_reports` that is exactly what
   * production refuses.
   */
  prefer: string;
}

export interface FixtureOptions {
  me: Person;
  chats: Row[];
  memberships: Row[];
  messages: Row[];
  /** Answers a database function; undefined leaves the default, `null` with 200. */
  rpc?: (name: string, body: Row) => RpcAnswer | undefined;
  /**
   * Everybody else this deployment has, for the lookups that ask about a person
   * rather than about a chat — «is this никнейм taken?» being the first of them.
   * The members of the chats are found through `memberships`; these are the
   * people a query can reach without one.
   */
  people?: Person[];
  /**
   * Who `me` has already blocked. `user_blocks` is readable only by its own
   * `blocker_id`, so this is exactly what the signed-in person can see, and the
   * fixture keeps it mutable: a block written through the interface lands here
   * and a later read finds it.
   */
  blocks?: string[];
  /**
   * Makes one table call fail, so a refusal path can be measured.
   *
   * Answers `undefined` to leave the fixture's own behaviour alone. This is how
   * a spec asks for SQLSTATE 23505 on a second report, or for the
   * row-level-security refusal a blocked sender's insert really gets.
   */
  rest?: (call: { resource: string; method: string; body: unknown }) => { status: number; body: unknown } | undefined;
}

export interface Fixture {
  requests: RecordedRequest[];
  rpcBodies(name: string): Row[];
  restCalls(resource: string, method?: string): RecordedRequest[];
}

export async function requireFixtureServer(request: APIRequestContext) {
  const client = await request
    .get("/src/lib/supabase/client.ts")
    .then((response) => response.text())
    .catch(() => "");
  if (!client.includes(FIXTURE_HOST)) {
    throw new Error(
      `This spec mocks the backend at ${FIXTURE_HOST}. Start the dev server with VITE_SUPABASE_URL=${FIXTURE_HOST} and VITE_SUPABASE_ANON_KEY=playwright-public-fixture; it will not run against any other configuration.`,
    );
  }
}

async function json(route: Route, body: unknown, status = 200, headers?: Record<string, string>) {
  await route.fulfill({ status, contentType: "application/json", headers, body: JSON.stringify(body) });
}

function readBody(route: Route): unknown {
  try {
    return route.request().postDataJSON();
  } catch {
    return null;
  }
}

export async function openFixture(page: Page, options: FixtureOptions): Promise<Fixture> {
  const { me } = options;
  const requests: RecordedRequest[] = [];
  const blocks: { blocked_id: string; created_at: string }[] = (options.blocks ?? []).map((id) => ({
    blocked_id: id,
    created_at: EPOCH,
  }));
  const fixture: Fixture = {
    requests,
    rpcBodies: (name) => requests.filter((entry) => entry.resource === `rpc/${name}`).map((entry) => (entry.body ?? {}) as Row),
    restCalls: (resource, method) =>
      requests.filter((entry) => entry.resource === resource && (!method || entry.method === method)),
  };

  // Only the network. WebKit routes a `blob:` load as well, and with the load
  // that decodes a picked file aborted, staging never finishes on it.
  await page.route(
    (url) => (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "127.0.0.1" && url.hostname !== "localhost",
    (route) => route.abort("blockedbyclient"),
  );
  await page.addInitScript(({ user, now }) => {
    localStorage.setItem("kub-theme", "dark");
    localStorage.setItem(
      "kub-auth",
      JSON.stringify({
        access_token: "playwright.user.jwt",
        refresh_token: "playwright-refresh",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        token_type: "bearer",
        user: {
          id: user.id,
          aud: "authenticated",
          role: "authenticated",
          email: "message-actions-qa@example.invalid",
          user_metadata: { full_name: user.full_name },
          app_metadata: {},
          created_at: now,
        },
      }),
    );
  }, { user: me, now: EPOCH });

  await page.route(`${FIXTURE_HOST}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const single = (request.headers().accept ?? "").includes("application/vnd.pgrst.object");
    const eq = (name: string) => {
      const filter = url.searchParams.get(name);
      return filter?.startsWith("eq.") ? decodeURIComponent(filter.slice(3)) : null;
    };
    const one = <T,>(rows: T[]) => (single ? rows[0] ?? null : rows);
    const isRest = url.pathname.startsWith("/rest/v1/");
    const resource = isRest ? url.pathname.slice("/rest/v1/".length) : url.pathname;
    const body = method === "GET" || method === "HEAD" ? null : readBody(route);
    requests.push({ method, resource, search: url.search, body, prefer: request.headers().prefer ?? "" });

    if (method === "OPTIONS") return route.fulfill({ status: 204 });
    // A refusal the spec asked for, before anything else answers. It is checked
    // after the call is recorded, so a spec can still assert what was sent.
    const failure = isRest ? options.rest?.({ resource, method, body }) : undefined;
    if (failure) return json(route, failure.body, failure.status);
    if (url.pathname === "/auth/v1/user") {
      return json(route, { id: me.id, aud: "authenticated", role: "authenticated", email: "message-actions-qa@example.invalid", user_metadata: { full_name: me.full_name }, app_metadata: {}, created_at: EPOCH });
    }
    if (!isRest) return json(route, single ? null : {});

    if (resource.startsWith("rpc/")) {
      const name = resource.slice(4);
      if (name === "chat_list_summaries") return json(route, (missingFunction(name) as { body: unknown }).body, 404);
      const answer = options.rpc?.(name, (body ?? {}) as Row);
      if (!answer) return json(route, null);
      if ("abort" in answer) return route.abort(answer.abort);
      return json(route, answer.body, answer.status ?? 200);
    }

    if (resource === "profiles") {
      // A lookup by никнейм is its own question: the settings screen asks
      // whether a name is free while it is being typed, and a route that
      // answered `me` to every filter would report every name taken. Only the
      // people this fixture was given exist.
      const username = eq("username");
      if (username) {
        const holder = [me, ...(options.people ?? [])].find(
          (person) => (person as Row).username === username,
        );
        return json(route, one(holder ? [holder] : []));
      }
      // `id=in.(…)` is how a list of people is fetched by id — the blocked-people
      // list does exactly this. Only the people this fixture was given exist;
      // every other filter still answers `me`, as it did.
      const ids = url.searchParams.get("id");
      if (ids?.startsWith("in.")) {
        const wanted = new Set(
          decodeURIComponent(ids.slice(3))
            .replace(/^\(/, "")
            .replace(/\)$/, "")
            .split(",")
            .map((value) => value.replace(/^"|"$/g, "")),
        );
        return json(route, [me, ...(options.people ?? [])].filter((person) => wanted.has(person.id)));
      }
      return json(route, one([me]));
    }
    if (resource === "user_blocks") {
      if (method === "GET") return json(route, one(blocks));
      if (method === "POST") {
        const row = (Array.isArray(body) ? body[0] : body) as { blocked_id?: string } | null;
        if (row?.blocked_id && !blocks.some((held) => held.blocked_id === row.blocked_id)) {
          blocks.push({ blocked_id: row.blocked_id, created_at: new Date().toISOString() });
        }
        return route.fulfill({ status: 201 });
      }
      if (method === "DELETE") {
        const blockedId = eq("blocked_id");
        for (let index = blocks.length - 1; index >= 0; index -= 1) {
          if (!blockedId || blocks[index].blocked_id === blockedId) blocks.splice(index, 1);
        }
        return route.fulfill({ status: 204 });
      }
      return json(route, single ? null : []);
    }
    if (resource === "content_reports") {
      // 201 and nothing in the body: the insert carries no RETURNING, because
      // reading the row back needs a SELECT policy the reporter does not have.
      if (method === "POST") return route.fulfill({ status: 201 });
      return json(route, single ? null : []);
    }
    if (resource === "chat_members") {
      if (method !== "GET") return json(route, single ? null : []);
      const chatId = eq("chat_id");
      const userId = eq("user_id");
      return json(route, one(options.memberships.filter((row) => (!chatId || row.chat_id === chatId) && (!userId || row.user_id === userId))));
    }
    if (resource === "chats") {
      if (method !== "GET") return route.fulfill({ status: 204 });
      const id = eq("id");
      const rows = options.chats
        .filter((row) => !id || row.id === id)
        .map((row) => ({ ...row, members: options.memberships.filter((member) => member.chat_id === row.id) }));
      return json(route, one(rows));
    }
    if (resource === "messages") {
      if (method === "PATCH") {
        const id = eq("id");
        for (const row of options.messages) if (row.id === id) Object.assign(row, body as Row);
        return json(route, []);
      }
      if (method !== "GET") return json(route, single ? null : []);
      const chatId = eq("chat_id");
      const id = eq("id");
      const pinned = eq("pinned");
      const createdAt = url.searchParams.get("created_at");
      const before = createdAt?.startsWith("lt.") ? decodeURIComponent(createdAt.slice(3)) : null;
      const withoutDeleted = url.searchParams.get("deleted_at") === "is.null";
      // The shared-media queries, which no spec asked of this fixture before
      // D-171: `.in("type", […])` narrows to the message types one kind can be
      // built from, and `.not("media_url", "is", null)` drops a row whose
      // attachment is gone. Unfiltered, the media grid was handed every text
      // message in the chat.
      const typeFilter = url.searchParams.get("type");
      const wantedTypes = typeFilter?.startsWith("in.")
        ? new Set(
          decodeURIComponent(typeFilter.slice(3))
            .replace(/^\(/, "")
            .replace(/\)$/, "")
            .split(",")
            .map((value) => value.replace(/^"|"$/g, "")),
        )
        : null;
      const withMedia = url.searchParams.get("media_url") === "not.is.null";
      let rows = options.messages.filter((row) =>
        (!chatId || row.chat_id === chatId) &&
        (!id || row.id === id) &&
        (pinned === null || String(row.pinned) === pinned) &&
        (!withoutDeleted || !row.deleted_at) &&
        (!wantedTypes || wantedTypes.has(String(row.type))) &&
        (!withMedia || Boolean(row.media_url)) &&
        (before === null || String(row.created_at) < before),
      );
      if ((request.headers().prefer ?? "").includes("count=")) {
        return json(route, [], 200, { "access-control-expose-headers": "Content-Range", "content-range": `*/${rows.length}` });
      }
      if ((url.searchParams.get("order") ?? "").startsWith("created_at.desc")) {
        rows = [...rows].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      }
      // `.range(from, to)` in this version of postgrest-js is `offset` and
      // `limit` on the query string, not a `Range` header. Without the offset
      // every page of the shared-media list is page one.
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const start = Number.isFinite(offset) && offset > 0 ? offset : 0;
      const limit = Number(url.searchParams.get("limit") ?? rows.length);
      const end = start + (Number.isFinite(limit) ? limit : rows.length);
      return json(route, one(rows.slice(start, end)));
    }
    if (resource === "reactions") {
      const messageId = eq("message_id");
      const userId = eq("user_id");
      const target = options.messages.find((row) => row.id === (messageId ?? (body as Row | null)?.message_id));
      const held = (target?.reactions ?? []) as Row[];
      if (method === "GET") return json(route, one(held.filter((row) => !userId || row.user_id === userId)));
      if (method === "POST" && target) {
        const inserted = { id: `r-${held.length + 1}-${Date.now()}`, created_at: new Date().toISOString(), ...(body as Row) };
        target.reactions = [...held, inserted];
        return json(route, [inserted], 201);
      }
      if (method === "DELETE" && target) {
        target.reactions = held.filter((row) => userId && row.user_id !== userId);
        return route.fulfill({ status: 204 });
      }
      return json(route, []);
    }
    return json(route, single ? null : []);
  });

  return fixture;
}

export async function openChat(page: Page, chatName: string, text: string): Promise<Locator> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const row = page.getByTestId("chat-list-item").filter({ hasText: chatName });
  await expect(row).toBeVisible();
  await row.click();
  const bubble = page.locator('[data-message-bubble="true"]').filter({ hasText: text });
  await expect(bubble).toBeVisible();
  return bubble;
}

/** The right-click menu, as a pointer opens it. */
export async function openDesktopMenu(page: Page, bubble: Locator): Promise<Locator> {
  await bubble.click({ button: "right" });
  const menu = page.locator('[data-message-menu="desktop"]');
  await expect(menu).toBeVisible();
  return menu;
}

/** The card under a tapped message, as a thumb opens it. */
export async function openPhoneMenu(page: Page, bubble: Locator): Promise<Locator> {
  await page.evaluate(() => document.fonts.ready);
  // The conversation's entry settles over several frames; a tap lands after it.
  await page.waitForTimeout(800);
  const box = await bubble.locator('[data-message-text-content="true"]').first().boundingBox();
  expect(box, "the message's text has no box").not.toBeNull();
  await page.touchscreen.tap(Math.round(box!.x + Math.min(20, box!.width / 2)), Math.round(box!.y + Math.min(12, box!.height / 2)));
  const card = page.locator("[data-action-menu]");
  await expect(card).toBeVisible();
  return card;
}

/** A time as the menus print it, in the page's own locale and time zone. */
export function clockTime(page: Page, iso: string): Promise<string> {
  return page.evaluate((value) => new Date(value).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }), iso);
}
