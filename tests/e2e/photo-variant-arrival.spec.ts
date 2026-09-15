import { expect, test, type Page, type Route } from "@playwright/test";
import sharp from "sharp";

/**
 * D-095: a photo's worker copies reach an open chat that holds no video.
 *
 * The chat here is the defect's exact precondition — one picture somebody else
 * sent, and not a video anywhere in it. `useMediaVariants` used to add a
 * condition of its own in front of the D-176 polling rule: only a chat holding
 * a video polled at all. So the single query a chat makes on entry ran before
 * the worker had written anything, nothing asked again, and the conversation
 * drew the full-size original for the rest of the session.
 *
 * What is pinned here is the thing a unit test cannot reach, because the gate
 * was in the hook rather than in the rule: that a second look happens at all,
 * and that the picture is redrawn from the copy when it arrives — with no new
 * message, no reopening of the chat and no reload to prompt it.
 *
 * The backend is a route mock on the fixture host, storage included, as in
 * `attach-sheet.spec.ts`; the spec refuses any other configuration and aborts
 * every request off this machine. Start the dev server with
 * VITE_SUPABASE_URL=http://127.0.0.1:54321.
 */

const FIXTURE_HOST = "http://127.0.0.1:54321";
const USER_ID = "11111111-1111-4111-8111-1111111111e1";
const OTHER_ID = "11111111-1111-4111-8111-1111111111e2";
const CHAT_ID = "22222222-2222-4222-8222-2222222222e1";
const MESSAGE_ID = "55555555-5555-4555-8555-5555555555e1";
const NOW = "2026-09-03T12:00:00.000Z";
const CHAT_NAME = "Витрина на Садовой";

/** Fictional, generated pixels: two flat colours, so which file is on screen is unambiguous. */
const ORIGINAL_PATH = "chat/" + CHAT_ID + "/original.png";
const PREVIEW_PATH = "variants/" + MESSAGE_ID + "/preview.webp";

/**
 * How long the second look may take.
 *
 * `MESSAGE_VARIANT_IMAGE_POLL_INTERVAL_MS` is five seconds, so twelve is two
 * chances and no more. Bounding it is the point: with the gate restored the
 * copy never arrives at all, and an assertion generous enough to wait out a
 * minute would also pass on the video pace — which is the defect half-fixed.
 */
const SECOND_LOOK_TIMEOUT_MS = 12_000;

test.describe("a photo's copies reach a chat with no video in it (D-095)", () => {
  test.beforeEach(async ({ page, request }) => {
    const client = await request
      .get("/src/lib/supabase/client.ts")
      .then((response) => response.text())
      .catch(() => "");
    if (!client.includes(FIXTURE_HOST)) {
      throw new Error(
        "This spec mocks the backend at " + FIXTURE_HOST + ". Start the dev server with VITE_SUPABASE_URL=" + FIXTURE_HOST + " and VITE_SUPABASE_ANON_KEY=playwright-public-fixture.",
      );
    }
    await page.route(
      (url) => (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "127.0.0.1" && url.hostname !== "localhost",
      (route) => route.abort("blockedbyclient"),
    );
    await installSession(page);
  });

  test("the copy arrives while the chat stays open, with no new message to prompt it", async ({ page }) => {
    const backend = await installBackend(page);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    const row = page.getByTestId("chat-list-item").filter({ hasText: CHAT_NAME });
    await expect(row).toBeVisible();
    await row.click();

    const picture = page.locator('[data-message-bubble="true"] img').first();
    await expect(picture).toBeVisible();

    // Before the worker has written anything the conversation draws the file
    // that was sent. That is not the defect — the defect is that it never stops.
    await expect
      .poll(() => picture.getAttribute("src"), { message: "the picture was never drawn from what was sent" })
      .toContain(ORIGINAL_PATH);
    expect(backend.variantQueries, "the chat asks once on entry").toBeGreaterThanOrEqual(1);

    // The worker finishes. Nothing else happens: no message is sent, the chat
    // is not left, the page is not reloaded.
    backend.previewReady = true;

    await expect
      .poll(() => picture.getAttribute("src"), {
        message: "the worker's copy never reached the open chat",
        timeout: SECOND_LOOK_TIMEOUT_MS,
      })
      .toContain(PREVIEW_PATH);

    expect(backend.variantQueries, "nothing asked a second time").toBeGreaterThanOrEqual(2);
    // And nothing arrived that could have asked on the poll's behalf. The
    // fixture only ever holds this one message, so a second bubble would mean
    // the conversation — not the poll — is what refreshed the variants.
    await expect(page.locator('[data-message-bubble="true"]')).toHaveCount(1);
  });
});

interface Backend {
  variantQueries: number;
  messageQueries: number;
  previewReady: boolean;
}

async function installSession(page: Page) {
  await page.addInitScript(({ userId, now }) => {
    localStorage.setItem("kub-theme", "light");
    localStorage.setItem(
      "kub-auth",
      JSON.stringify({
        access_token: "playwright.user.jwt",
        refresh_token: "playwright-refresh",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        token_type: "bearer",
        user: {
          id: userId,
          aud: "authenticated",
          role: "authenticated",
          email: "media-variants-qa@example.invalid",
          user_metadata: { full_name: "Максим" },
          app_metadata: {},
          created_at: now,
        },
      }),
    );
  }, { userId: USER_ID, now: NOW });
}

async function installBackend(page: Page): Promise<Backend> {
  const backend: Backend = { variantQueries: 0, messageQueries: 0, previewReady: false };
  const me = profile(USER_ID, "Максим", "maksim");
  const anya = profile(OTHER_ID, "Аня", null);
  const memberships = [membership(CHAT_ID, USER_ID, "owner", me), membership(CHAT_ID, OTHER_ID, "member", anya)];
  const chats = [chat(CHAT_ID, CHAT_NAME, "2026-09-03T11:30:00.000Z", memberships)];
  const original = await sharp({ create: { width: 900, height: 1200, channels: 3, background: { r: 30, g: 90, b: 160 } } })
    .png()
    .toBuffer();
  const preview = await sharp({ create: { width: 450, height: 600, channels: 3, background: { r: 160, g: 60, b: 30 } } })
    .webp()
    .toBuffer();
  // One picture, from the other person, and nothing else carrying media.
  const messages = [
    {
      ...message(MESSAGE_ID, CHAT_ID, OTHER_ID, "", "2026-09-03T11:30:00.000Z", anya),
      type: "image",
      media_bucket: "media",
      media_path: ORIGINAL_PATH,
      media_url: FIXTURE_HOST + "/storage/v1/object/public/media/" + ORIGINAL_PATH,
      media_metadata: { width: 900, height: 1200 },
    },
  ];

  await page.route(FIXTURE_HOST + "/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const single = (request.headers().accept ?? "").includes("application/vnd.pgrst.object");
    const eq = (name: string) => {
      const filter = url.searchParams.get(name);
      return filter?.startsWith("eq.") ? filter.slice(3) : null;
    };
    const one = <T,>(rows: T[]) => (single ? rows[0] ?? null : rows);

    if (url.pathname === "/storage/v1/object/public/media/" + ORIGINAL_PATH) {
      return route.fulfill({ status: 200, contentType: "image/png", body: original });
    }
    if (url.pathname === "/storage/v1/object/public/media/" + PREVIEW_PATH) {
      return route.fulfill({ status: 200, contentType: "image/webp", body: preview });
    }
    if (url.pathname === "/auth/v1/user") {
      return json(route, { id: USER_ID, aud: "authenticated", role: "authenticated", email: "media-variants-qa@example.invalid", user_metadata: { full_name: "Максим" }, app_metadata: {}, created_at: NOW });
    }
    if (url.pathname.includes("/rest/v1/media_variants")) {
      // An avatar's query reads the same table; only the message's counts here.
      if (url.searchParams.has("message_id")) {
        backend.variantQueries += 1;
        if (!backend.previewReady) return json(route, []);
        return json(route, [
          {
            id: "variant-1",
            message_id: MESSAGE_ID,
            variant_kind: "image_preview",
            variant_bucket: "media",
            variant_path: PREVIEW_PATH,
            width: 450,
            height: 600,
            status: "ready",
            error_code: null,
            updated_at: "2026-09-03T11:30:20.000Z",
          },
        ]);
      }
      return json(route, []);
    }
    if (url.pathname.includes("/rest/v1/profiles")) return json(route, one([me]));
    if (url.pathname.includes("/rest/v1/chat_members")) {
      const chatId = eq("chat_id");
      const userId = eq("user_id");
      return json(route, one(memberships.filter((r) => (!chatId || r.chat_id === chatId) && (!userId || r.user_id === userId))));
    }
    if (url.pathname.endsWith("/rpc/chat_list_summaries")) {
      return json(route, { code: "PGRST202", details: null, hint: null, message: "Could not find the function public.chat_list_summaries" }, 404);
    }
    if (url.pathname.includes("/rest/v1/chats")) {
      if (method !== "GET") return route.fulfill({ status: 204 });
      const id = eq("id");
      return json(route, one(chats.filter((r) => !id || r.id === id)));
    }
    if (url.pathname.includes("/rest/v1/messages")) {
      if (method !== "GET") return json(route, []);
      backend.messageQueries += 1;
      const chatId = eq("chat_id");
      const rows = messages.filter((r) => !chatId || r.chat_id === chatId);
      if ((request.headers().prefer ?? "").includes("count=exact")) {
        return json(route, [], 200, { "access-control-expose-headers": "Content-Range", "content-range": "*/0" });
      }
      const limit = Number(url.searchParams.get("limit") ?? rows.length);
      return json(route, one(rows.slice(0, Number.isFinite(limit) ? limit : rows.length)));
    }
    if (url.pathname.includes("/rest/v1/rpc/")) return json(route, null);
    return json(route, single ? null : []);
  });

  return backend;
}

function profile(id: string, fullName: string, username: string | null) {
  return { id, full_name: fullName, username, avatar_url: null, bio: null, role: "user", online_at: NOW, created_at: NOW, updated_at: NOW };
}

function membership(chatId: string, userId: string, role: string, person: ReturnType<typeof profile>) {
  return {
    chat_id: chatId,
    user_id: userId,
    role,
    joined_at: "2026-09-01T09:00:00.000Z",
    last_read_at: NOW,
    last_delivered_at: NOW,
    hidden_at: null,
    cleared_at: null,
    pinned: false,
    pinned_at: null,
    pinned_order: null,
    profile: person,
  };
}

function chat(id: string, name: string, updatedAt: string, memberships: Array<ReturnType<typeof membership>>) {
  return {
    id,
    type: "group",
    name,
    description: null,
    avatar_url: null,
    created_by: USER_ID,
    created_at: "2026-09-01T09:00:00.000Z",
    updated_at: updatedAt,
    is_forum: false,
    invite_policy: "owner_admin_only",
    members: memberships.filter((r) => r.chat_id === id),
  };
}

function message(id: string, chatId: string, userId: string, content: string, createdAt: string, sender: ReturnType<typeof profile>) {
  return {
    id,
    chat_id: chatId,
    topic_id: null,
    user_id: userId,
    bot_id: null,
    sender_deleted_at: null,
    content,
    type: "text" as unknown,
    media_bucket: null as unknown,
    media_path: null as unknown,
    media_url: null as unknown,
    media_metadata: {} as unknown,
    reply_to_id: null,
    reply_to: null,
    forwarded_from_id: null,
    forwarded_from: null,
    client_message_id: null as unknown,
    client_sent_at: null as unknown,
    bot_reply_markup: null,
    pinned: false,
    created_at: createdAt,
    edited_at: null,
    deleted_at: null,
    sender,
    bot: null,
    reactions: [],
  };
}

async function json(route: Route, body: unknown, status = 200, headers?: Record<string, string>) {
  await route.fulfill({ status, contentType: "application/json", headers, body: JSON.stringify(body) });
}
