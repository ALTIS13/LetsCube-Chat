import { expect, test, type Page } from "@playwright/test";
import {
  chat,
  membership,
  message,
  missingFunction,
  openChat,
  openFixture,
  person,
  requireFixtureServer,
  type Fixture,
  type Row,
} from "./helpers/messageActionsFixture";

/**
 * The channel rail, in a browser.
 *
 * `tests/unit/server-channel-rail.test.mts` holds the rules; what is measured
 * here is everything those rules cannot reach — that the rail is drawn at all,
 * that it is a **column** beside the conversation where the pane has room and a
 * sheet over it where it has not, that it replaced the topic strip rather than
 * joining it, that the people in a room are listed under that room's own name,
 * and that a click on a row does the thing the row promises.
 *
 * The group is invented, every row of it. Needs the dev server on the fixture
 * host.
 */

const AT = "2026-09-14T09:00:00.000Z";
const ME = person("11111111-1111-4111-8111-000000000001", "Максим Орлов");
const ANNA = person("11111111-1111-4111-8111-000000000002", "Анна Смирнова");
const PETR = person("11111111-1111-4111-8111-000000000003", "Пётр Ильин");
const CHAT_TEAM = "22222222-2222-4222-8222-000000000001";

const LINES = ["Макет главной готов, посмотрите", "Смета на витрину готова, посмотри"];

const CATEGORY_TEXT = "33333333-3333-4333-8333-000000000001";
const CATEGORY_VOICE = "33333333-3333-4333-8333-000000000002";

const TOPIC_GENERAL = "44444444-4444-4444-8444-000000000001";
const TOPIC_DESIGN = "44444444-4444-4444-8444-000000000002";
const TOPIC_RELEASES = "44444444-4444-4444-8444-000000000003";

const ROOM_SMOKING = "55555555-5555-4555-8555-000000000001";
const ROOM_LOBBY = "55555555-5555-4555-8555-000000000002";
const ROOM_STANDUP = "55555555-5555-4555-8555-000000000003";

const CATEGORIES: Row[] = [
  { id: CATEGORY_TEXT, chat_id: CHAT_TEAM, name: "Текстовые", position: 0, created_at: AT },
  { id: CATEGORY_VOICE, chat_id: CHAT_TEAM, name: "Голосовые", position: 1, created_at: AT },
];

const TOPICS: Row[] = [
  { id: TOPIC_GENERAL, chat_id: CHAT_TEAM, name: "Общие", emoji: null, is_general: true, position: 0, archived: false, category_id: null, created_at: AT, updated_at: AT, created_by: null },
  { id: TOPIC_DESIGN, chat_id: CHAT_TEAM, name: "дизайн", emoji: "🎨", is_general: false, position: 0, archived: false, category_id: CATEGORY_TEXT, created_at: AT, updated_at: AT, created_by: null },
  { id: TOPIC_RELEASES, chat_id: CHAT_TEAM, name: "релизы", emoji: null, is_general: false, position: 1, archived: false, category_id: CATEGORY_TEXT, created_at: AT, updated_at: AT, created_by: null },
];

const ROOMS: Row[] = [
  { id: ROOM_SMOKING, chat_id: CHAT_TEAM, name: "Курилка", position: 0, max_participants: 10, speak_role: "member", participant_count: 0, archived: false, category_id: null, created_at: AT },
  { id: ROOM_LOBBY, chat_id: CHAT_TEAM, name: "Общая", position: 0, max_participants: 10, speak_role: "member", participant_count: 2, archived: false, category_id: CATEGORY_VOICE, created_at: AT },
  { id: ROOM_STANDUP, chat_id: CHAT_TEAM, name: "Планёрка", position: 1, max_participants: 4, speak_role: "member", participant_count: 0, archived: false, category_id: CATEGORY_VOICE, created_at: AT },
];

/** Two people in «Общая», which is what the rail has to say without being asked. */
const OCCUPANTS: Row[] = [
  { channel_id: ROOM_LOBBY, user_id: ANNA.id, joined_at: AT, confirmed_at: AT },
  { channel_id: ROOM_LOBBY, user_id: PETR.id, joined_at: AT, confirmed_at: AT },
];

/**
 * The rail as `textContent` reads it: the glyph, the name and the seats run
 * together with no separator, because the space between them is layout rather
 * than text. Written out here so the expectations below stay readable and the
 * markup is not bent to make a test's string prettier.
 */
const FULL_RAIL = [
  "Общие",
  "Курилка0/10",
  "Текстовые",
  "🎨дизайн",
  "релизы",
  "Голосовые",
  "Общая2/10",
  "Планёрка0/4",
];

interface Shape {
  /** False for a plain group: no `topics` rows at all, so the rail invents the conversation. */
  forum?: boolean;
  role?: string;
  /** The fixture signs in on the dark theme; the captures need both. */
  theme?: "dark" | "light";
  /**
   * Answer the rooms read with a 500 instead of rows.
   *
   * Not «no rooms»: the point of the test below is that the two are different
   * answers and the interface used to give the same one for both.
   */
  roomsFail?: boolean;
  /**
   * A group with nothing in it at all: no headings, no topics, no rooms.
   *
   * This is every group made before channels existed, and it is the shape the
   * owner reported on 2026-09-15 — «не вижу в уже созданной группе такой
   * опции». `forum: false` is not the same thing: it still answers with one
   * room, which is enough to earn a rail on its own.
   */
  bare?: boolean;
  /**
   * Whether this client is connected to «Общая», and who the SFU says may speak.
   *
   * The rail lists a room two ways and only one of them knows about a
   * permission: outside the call the table answers, and it carries presence and
   * nothing else, so `canSpeak` is `null` — unknown. Inside the call the SDK
   * answers and `canSpeak` is a real boolean. The moderation menu reads exactly
   * that difference, so a test of the silenced mark has to be in the second
   * state, which is what this seed buys: a granting gateway and a stand-in
   * transport whose roster this file controls.
   */
  inLobby?: { silenced?: string[] };
  /** What the two moderation routes answer. A grant by default. */
  moderation?: { status: number; body: unknown };
}

/**
 * The four channel tables, answered from this file rather than from the shared
 * helper: `options.rest` is consulted before every built-in, so a spec can add
 * a table to the fixture backend without touching a file other specs share.
 */
function tablesFor(shape: Shape) {
  const bare = shape.bare === true;
  const forum = !bare && shape.forum !== false;
  const roomsFail = shape.roomsFail === true;
  return (call: { resource: string; method: string }) => {
    if (call.method !== "GET") return undefined;
    if (call.resource === "chat_channel_categories") return { status: 200, body: forum ? CATEGORIES : [] };
    if (call.resource === "topics") return { status: 200, body: forum ? TOPICS : [] };
    if (call.resource === "voice_channels") {
      if (roomsFail) return { status: 500, body: { message: "upstream said no" } };
      if (bare) return { status: 200, body: [] };
      return { status: 200, body: forum ? ROOMS : ROOMS.filter((room) => room.id === ROOM_LOBBY) };
    }
    if (call.resource === "voice_participants") return { status: 200, body: OCCUPANTS };
    return undefined;
  };
}

function seed(shape: Shape): { chats: Row[]; memberships: Row[]; messages: Row[] } {
  return {
    // `is_forum`, so `useTopics` reads the text channels at all: it refuses to
    // for anything else, and the rail takes its text channels from that one
    // reader rather than opening a second.
    chats: [{ ...chat(CHAT_TEAM, "group", "Команда проекта", AT), is_forum: shape.forum !== false }],
    memberships: [
      membership(CHAT_TEAM, ME, shape.role ?? "owner", AT),
      membership(CHAT_TEAM, ANNA, "admin", AT),
      membership(CHAT_TEAM, PETR, "member", AT),
    ],
    messages: LINES.map((text, index) =>
      message(
        "66666666-6666-4666-8666-" + String(index + 1).padStart(12, "0"),
        CHAT_TEAM,
        index === 0 ? ME : ANNA,
        text,
        new Date(Date.UTC(2026, 8, 14, 10, index * 7)).toISOString(),
      ),
    ),
  };
}

interface Opened {
  tokenRequests: string[];
  /** Every moderation call, in order: which route, and the body it carried. */
  moderationCalls: { route: string; body: Record<string, unknown> | null }[];
  fixture: Fixture;
}

/**
 * The SFU seam, for the one state the table cannot produce.
 *
 * A narrow copy of `voice-call.spec.ts`'s stand-in: only the methods a joined
 * call touches, and a roster this file controls so `canSpeak` can be a real
 * boolean. `voice-call.spec.ts` keeps the full one because it tests the call;
 * what this file tests is the rail's rows, and importing that stand-in would
 * couple two specs through a third file for four methods.
 */
async function installLobbyTransport(page: Page, silenced: string[]) {
  // A real audio track, because a joined call is the point here.
  //
  // `openGroup`'s own microphone mock answers with an empty track list: it was
  // written so a click could be seen reaching the gateway, and the gateway
  // refuses there, so the capture never had to be usable. A join that gets a
  // token needs `getTracks()[0]` to be a real `MediaStreamTrack`, and an
  // `AudioContext` destination is one — synthesized by the browser, no device
  // and no permission prompt. Registered after that mock so this one wins.
  await page.addInitScript(() => {
    const devices = navigator.mediaDevices ?? ({} as MediaDevices);
    Object.defineProperty(devices, "getUserMedia", {
      value: async () => {
        const context = new AudioContext();
        return context.createMediaStreamDestination().stream;
      },
      configurable: true,
    });
    if (!navigator.mediaDevices) {
      Object.defineProperty(navigator, "mediaDevices", { value: devices, configurable: true });
    }
  });
  await page.addInitScript(
    ({ me, anna, petr, hushed }) => {
      const roster = () =>
        [
          { userId: me, name: "", muted: false },
          { userId: anna, name: "Анна (из токена)", muted: false },
          { userId: petr, name: "Пётр (из токена)", muted: false },
        ].map((entry) => ({
          ...entry,
          // The SDK reports a permission per participant; `false` is somebody a
          // moderator stopped from publishing. Never `undefined` here — that is
          // the shape the table gives and it means «unknown».
          canSpeak: !(hushed as string[]).includes(entry.userId),
        }));
      window.__letscubeVoiceRoom = (events) => ({
        async join() {
          // Nothing to connect to. What a joined call gives the rail is the
          // roster, and that is the whole point of this stand-in.
          events.onParticipants(roster());
        },
        async setMuted() {},
        async leave() {},
        async sampleHealth() {
          return { at: Date.now(), rttMs: null, jitterMs: null, packetsSent: null, packetsLost: null };
        },
        async setDeafened() {},
        async setOutputDevice() {
          return true;
        },
        serverName() {
          return null;
        },
      });
    },
    { me: ME.id, anna: ANNA.id, petr: PETR.id, hushed: silenced },
  );
}

async function openGroup(page: Page, shape: Shape = {}): Promise<Opened> {
  const rows = seed(shape);
  const tokenRequests: string[] = [];
  const moderationCalls: { route: string; body: Record<string, unknown> | null }[] = [];

  // The microphone, answered before anything asks the person for it. Joining a
  // room asks for it first (a person who declines costs the gateway nothing),
  // so without this every join ends at the browser's own prompt and the click's
  // effect — which room it asked for — could not be seen at all.
  await page.addInitScript(() => {
    const fake = { getTracks: () => [] };
    const devices = navigator.mediaDevices ?? ({} as MediaDevices);
    Object.defineProperty(devices, "getUserMedia", { value: async () => fake, configurable: true });
    if (!navigator.mediaDevices) {
      Object.defineProperty(navigator, "mediaDevices", { value: devices, configurable: true });
    }
  });

  // After the microphone mock above, never before: init scripts run in the
  // order they were registered, and that one answers with an empty track list.
  // Registered first, this one was simply overwritten and the join stopped at
  // «Подключаемся…» with `stream.getAudioTracks is not a function`.
  if (shape.inLobby) await installLobbyTransport(page, shape.inLobby.silenced ?? []);

  const fixture = await openFixture(page, {
    me: ME,
    chats: rows.chats,
    memberships: rows.memberships,
    messages: rows.messages,
    people: [ANNA, PETR],
    rest: tablesFor(shape),
    rpc: (name) => (name === "search_chat_messages" ? missingFunction(name) : undefined),
  });

  // After `openFixture`, so this wins: init scripts run in the order they were
  // registered and the fixture's own sets the dark theme.
  if (shape.theme) {
    await page.addInitScript((theme) => localStorage.setItem("kub-theme", theme), shape.theme);
  }

  // The gateway, refusing cleanly. What matters is the channel id the client
  // asked for; a clean refusal then puts the call back into a state where the
  // next room can be clicked, which is how «switching is one click» is shown.
  //
  // `inLobby` is the exception and it grants, because the one thing a refusal
  // cannot produce is a joined call — and a joined call is the only state where
  // the rail knows whether somebody may speak.
  await page.route("**/functions/v1/voice-gateway/token", async (route) => {
    const body = route.request().postDataJSON() as { channelId?: string } | null;
    tokenRequests.push(body?.channelId ?? "");
    if (shape.inLobby && body?.channelId === ROOM_LOBBY) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          url: "wss://sfu.invalid/rtc",
          token: "fixture-token",
          canPublish: true,
        }),
      });
      return;
    }
    await route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ code: "forbidden" }),
    });
  });

  // The two moderation routes, recorded rather than answered blindly: what this
  // spec has to see is the **body** — a field name the gateway does not know is
  // silently discarded there, so a typo would be a 200 that changed nothing.
  for (const route of ["force-mute", "remove"] as const) {
    await page.route(`**/functions/v1/voice-gateway/${route}`, async (handler) => {
      let body: Record<string, unknown> | null = null;
      try {
        body = handler.request().postDataJSON() as Record<string, unknown> | null;
      } catch {
        body = null;
      }
      moderationCalls.push({ route, body });
      const answer =
        shape.moderation ??
        (route === "remove"
          ? { status: 200, body: { ok: true, channelId: body?.channelId, userId: body?.userId } }
          : {
              status: 200,
              body: {
                ok: true,
                channelId: body?.channelId,
                userId: body?.userId,
                muted: body?.muted === true,
                canPublish: body?.muted !== true,
              },
            });
      await handler.fulfill({
        status: answer.status,
        contentType: "application/json",
        body: JSON.stringify(answer.body),
      });
    });
  }

  await openChat(page, "Команда проекта", LINES[0]);
  return { tokenRequests, moderationCalls, fixture };
}

/**
 * Which half of the matrix a project belongs to, by its viewport rather than by
 * its name.
 *
 * Named projects would have pinned these tests to Chromium, and this repository
 * has already paid for a Chromium-only matrix once: D-062 put the chat header
 * underneath the conversation on every iPhone for six deploys, because `order`
 * re-orders painting for positioned boxes in Chromium and WebKit does not apply
 * it at all. The rail has two shapes decided by width, so the width is the
 * honest gate and `webkit-mobile-390` runs the phone half for free.
 */
function paneIsWide(testInfo: { project: { use: { viewport?: { width: number } | null } } }): boolean {
  return (testInfo.project.use.viewport?.width ?? 0) >= 1000;
}

/** The rail's rows in the order they are drawn, whichever shape is on screen. */
async function drawnOrder(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(
      document.querySelectorAll(
        '[data-testid="channel-rail-list"] [data-testid="channel-rail-text"], [data-testid="channel-rail-list"] [data-testid="channel-rail-voice"], [data-testid="channel-rail-list"] [data-testid="channel-rail-heading"]',
      ),
    ).map((element) => (element.textContent ?? "").replace(/\s+/gu, " ").trim()),
  );
}

test.describe("the channel rail", () => {
  test.beforeEach(async ({ request }) => {
    await requireFixtureServer(request);
  });

  test("a computer gets a column, and the topic strip is gone", async ({ page }, testInfo) => {
    test.skip(!paneIsWide(testInfo), "the column's width is the point");
    await openGroup(page);

    const rail = page.getByTestId("channel-rail");
    await expect(rail).toBeVisible();
    await expect(rail).toHaveAttribute("data-shape", "column");
    // The rail replaces the strip rather than standing beside it. That is the
    // shape change the owner asked for; two navigations for one group would be
    // the relabelling he has rejected before.
    await expect(page.getByTestId("topic-strip")).toHaveCount(0);
    await expect(page.getByTestId("channel-rail-trigger")).toHaveCount(0);

    const box = await rail.boundingBox();
    expect(box, "the rail column has no box").not.toBeNull();
    expect(Math.round(box!.width)).toBe(224);
  });

  test("a rooms read that failed keeps the rail and says so", async ({ page }, testInfo) => {
    test.skip(!paneIsWide(testInfo), "the sentence is the same in both shapes");
    // D-193. The read used to become `[]`, so a 500 looked exactly like a group
    // with no rooms — and a group whose only extra channels are rooms lost its
    // whole rail with nothing on screen saying why.
    await openGroup(page, { forum: false, roomsFail: true });

    const rail = page.getByTestId("channel-rail");
    await expect(rail).toBeVisible();
    const notice = page.getByTestId("channel-rail-unreadable");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("Не удалось загрузить каналы.");
    // An admission, not a claim about the group.
    await expect(notice).not.toContainText("нет");
    await expect(page.getByTestId("channel-rail-retry")).toBeVisible();
  });

  test("uncategorised channels stand above the headings, text above voice", async ({ page }, testInfo) => {
    test.skip(!paneIsWide(testInfo), "one shape is enough for an order");
    await openGroup(page);
    await expect(page.getByTestId("channel-rail")).toBeVisible();

    expect(await drawnOrder(page)).toEqual(FULL_RAIL);
  });

  test("who is in a room is listed under that room's own name", async ({ page }, testInfo) => {
    test.skip(!paneIsWide(testInfo), "the list is the same in both shapes");
    await openGroup(page);

    // Scoped to the room rather than to the page: the point is not that the
    // names are somewhere, it is that they are under «Общая» and not under
    // «Планёрка», which is what makes the rail answer «where is everybody».
    const lobby = page.locator(`[data-testid="channel-rail-voice-group"][data-channel-id="${ROOM_LOBBY}"]`);
    await expect(lobby.getByTestId("channel-rail-occupant-name")).toHaveText([
      "Анна Смирнова",
      "Пётр Ильин",
    ]);

    const standup = page.locator(`[data-testid="channel-rail-voice-group"][data-channel-id="${ROOM_STANDUP}"]`);
    await expect(standup.getByTestId("channel-rail-occupants")).toHaveCount(0);
  });

  test("a text channel is chosen by clicking it, and the conversation follows", async ({ page }, testInfo) => {
    test.skip(!paneIsWide(testInfo), "the sheet's own click is covered below");
    const opened = await openGroup(page);

    // A forum has a real `is_general` row, so the conversation's row is that
    // row rather than the invented one — the plain group below is the other
    // half of this.
    const general = page.locator(`[data-testid="channel-rail-text"][data-channel-id="${TOPIC_GENERAL}"]`);
    const releases = page.locator(`[data-testid="channel-rail-text"][data-channel-id="${TOPIC_RELEASES}"]`);
    // The conversation is the chosen row before anything is clicked: the store
    // holds null for the general stream, which is «the conversation» rather
    // than «nothing chosen».
    await expect(general).toHaveAttribute("data-active", "true");
    await expect(releases).toHaveAttribute("data-active", "false");

    await releases.click();
    await expect(releases).toHaveAttribute("data-active", "true");
    await expect(general).toHaveAttribute("data-active", "false");

    // Back to the conversation. The general row writes `null` to the store, so
    // a rail that wrote its row id instead would lose the highlight here within
    // a render — `useTopics` resets it.
    await general.click();
    await expect(general).toHaveAttribute("data-active", "true");
    await expect(releases).toHaveAttribute("data-active", "false");

    // And the id never reaches the store, which the DOM alone cannot show:
    // `useTopics` resets a general selection to null within a render, so a rail
    // that wrote the row id would come to rest looking exactly like this one.
    // What differs is the fetch that render fires — `useMessages` filters by
    // `topic_id=eq.<id>` — so the request log is where the mistake is visible.
    const askedForTheGeneralRow = opened.fixture
      .restCalls("messages", "GET")
      .some((call) => call.search.includes(`topic_id=eq.${TOPIC_GENERAL}`));
    expect(askedForTheGeneralRow, "the conversation was fetched as a topic of its own").toBe(false);
  });

  test("a group with nothing in it still offers its owner a way to make a channel", async ({ page }, testInfo) => {
    test.skip(!paneIsWide(testInfo), "the shape is not what is being checked");
    // Every group made before channels existed: no headings, no topics, no
    // rooms. Reported by the owner — «не вижу в уже созданной группе такой
    // опции» — and this is why: the rail is where the «+» lives, and the rail
    // was offered only once something besides the conversation existed. The
    // only other door was a pencil in the information panel's header.
    await openGroup(page, { bare: true, role: "owner" });

    await expect(page.getByTestId("channel-rail")).toBeVisible();
    await expect(page.getByTestId("channel-rail-manage").first()).toBeVisible();
    // And the conversation is still there to read while it is the only thing in
    // the group — the rail invents that row, so an empty rail never happens.
    await expect(
      page.locator('[data-testid="channel-rail-text"][data-channel-id="general"]'),
    ).toBeVisible();
  });

  test("a plain group with a room gets a rail, and the conversation is in it", async ({ page }, testInfo) => {
    test.skip(!paneIsWide(testInfo), "the shape is not what is being checked");
    await openGroup(page, { forum: false });

    await expect(page.getByTestId("channel-rail")).toBeVisible();
    // No `topics` row describes this conversation — the group is not a forum —
    // so without an invented row the rail would list the room and offer no way
    // back to the conversation the person is reading.
    expect(await drawnOrder(page)).toEqual(["Общие", "Общая2/10"]);
    await expect(page.locator('[data-testid="channel-rail-text"][data-channel-id="general"]')).toHaveAttribute(
      "data-active",
      "true",
    );
  });

  test("a heading folds, and keeps what is happening under it", async ({ page }, testInfo) => {
    test.skip(!paneIsWide(testInfo), "collapsing is shape-independent");
    await openGroup(page);

    const voiceHeading = page.locator('[data-testid="channel-rail-heading"]').filter({ hasText: "Голосовые" });
    await voiceHeading.click();
    await expect(voiceHeading).toHaveAttribute("data-collapsed", "true");

    // «Общая» has two people in it and stays; «Планёрка» is quiet and goes.
    expect(await drawnOrder(page)).toEqual([
      "Общие",
      "Курилка0/10",
      "Текстовые",
      "🎨дизайн",
      "релизы",
      "Голосовые",
      "Общая2/10",
    ]);

    const textHeading = page.locator('[data-testid="channel-rail-heading"]').filter({ hasText: "Текстовые" });
    await textHeading.click();
    // Nothing under «Текстовые» is being read — the conversation is — so the
    // whole group folds away.
    expect(await drawnOrder(page)).toEqual([
      "Общие",
      "Курилка0/10",
      "Текстовые",
      "Голосовые",
      "Общая2/10",
    ]);

    await voiceHeading.click();
    await expect(voiceHeading).toHaveAttribute("data-collapsed", "false");
    expect(await drawnOrder(page)).toEqual([
      "Общие",
      "Курилка0/10",
      "Текстовые",
      "Голосовые",
      "Общая2/10",
      "Планёрка0/4",
    ]);
  });

  test("a folded heading keeps the channel being read", async ({ page }, testInfo) => {
    test.skip(!paneIsWide(testInfo), "collapsing is shape-independent");
    await openGroup(page);

    await page.locator(`[data-testid="channel-rail-text"][data-channel-id="${TOPIC_RELEASES}"]`).click();
    await page.locator('[data-testid="channel-rail-heading"]').filter({ hasText: "Текстовые" }).click();

    // Folding a heading must not hide the conversation that is open: that reads
    // as the rail losing your place rather than as a heading closing.
    expect(await drawnOrder(page)).toEqual([
      "Общие",
      "Курилка0/10",
      "Текстовые",
      "релизы",
      "Голосовые",
      "Общая2/10",
      "Планёрка0/4",
    ]);
  });

  test("one click joins a room, and one more click moves to another", async ({ page }, testInfo) => {
    test.skip(!paneIsWide(testInfo), "the join path is the same in both shapes");
    const opened = await openGroup(page);

    await page.locator(`[data-testid="channel-rail-voice"][data-channel-id="${ROOM_STANDUP}"]`).click();
    await expect.poll(() => opened.tokenRequests).toEqual([ROOM_STANDUP]);

    // No «выйти» in between: the second room is one click, as it is on a
    // server. `joinVoiceChannel` leaves whatever it finds this client in.
    await page.locator(`[data-testid="channel-rail-voice"][data-channel-id="${ROOM_LOBBY}"]`).click();
    await expect.poll(() => opened.tokenRequests).toEqual([ROOM_STANDUP, ROOM_LOBBY]);
  });

  test("a phone gets a trigger and a sheet, never a column", async ({ page }, testInfo) => {
    test.skip(paneIsWide(testInfo), "the narrow shape is the point");
    await openGroup(page);

    await expect(page.getByTestId("channel-rail")).toHaveCount(0);
    await expect(page.getByTestId("topic-strip")).toHaveCount(0);

    const trigger = page.getByTestId("channel-rail-trigger");
    await expect(trigger).toBeVisible();
    // It names the channel being read, and says that somebody is in a room, so
    // the answer the rail exists for survives the rail being closed.
    await expect(trigger).toContainText("Общие");
    await expect(trigger.getByTestId("channel-rail-trigger-live")).toContainText("1");

    await trigger.click();
    const sheet = page.getByTestId("channel-rail-sheet");
    await expect(sheet).toBeVisible();
    expect(await drawnOrder(page)).toEqual(FULL_RAIL);

    // Choosing a channel is choosing it and getting out of the way.
    await page.locator(`[data-testid="channel-rail-text"][data-channel-id="${TOPIC_RELEASES}"]`).click();
    await expect(sheet).toHaveCount(0);
    await expect(trigger).toContainText("релизы");
  });

  test("the sheet closes on the scrim and on Escape", async ({ page }, testInfo) => {
    test.skip(paneIsWide(testInfo), "there is no sheet at a computer's width");
    await openGroup(page);

    await page.getByTestId("channel-rail-trigger").click();
    await expect(page.getByTestId("channel-rail-sheet")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("channel-rail-sheet")).toHaveCount(0);

    await page.getByTestId("channel-rail-trigger").click();
    await page.getByTestId("channel-rail-scrim").click({ position: { x: 340, y: 400 } });
    await expect(page.getByTestId("channel-rail-sheet")).toHaveCount(0);
  });

  test("the management control is an administrator's alone", async ({ page }, testInfo) => {
    test.skip(!paneIsWide(testInfo), "the permission does not depend on width");
    await openGroup(page, { role: "member" });
    await expect(page.getByTestId("channel-rail")).toBeVisible();
    await expect(page.getByTestId("channel-rail-manage")).toHaveCount(0);
  });

  test("the capsule under the header stops offering a room the rail lists", async ({ page }, testInfo) => {
    test.skip(!paneIsWide(testInfo), "the capsule is the same at both widths");
    await openGroup(page);
    await expect(page.getByTestId("channel-rail")).toBeVisible();

    // Before the rail there was one room per group and this capsule was the way
    // into it. With a list of rooms on screen it named whichever came first and
    // offered to join that — photographed in the first capture as «Курилка ·
    // Никого нет · Присоединиться» beside a rail listing three rooms. Joining
    // is the rail's job now; the capsule is for the call you are in.
    await expect(page.getByTestId("voice-capsule")).toHaveCount(0);

    // And it comes back for a call: a join puts the capsule up naming that room.
    await page.locator(`[data-testid="channel-rail-voice"][data-channel-id="${ROOM_STANDUP}"]`).click();
    await expect(page.getByTestId("voice-capsule-title")).toHaveText("Планёрка");
  });

  /**
   * The pixels, for the eye that judges them.
   *
   * Opt-in, because a capture is not an assertion: it is run deliberately with
   * `KUB_CAPTURE_RAIL=1` and the images are read by a person. Every visual
   * decision in this product is judged on rendered pixels, literally, so a
   * green test above is not evidence that any of this is readable.
   */
  for (const theme of ["dark", "light"] as const) {
    test(`capture: the rail in the ${theme} theme`, async ({ page }, testInfo) => {
      test.skip(process.env.KUB_CAPTURE_RAIL !== "1", "captures are opt-in");
      await openGroup(page, { theme });
      if (!paneIsWide(testInfo)) await page.getByTestId("channel-rail-trigger").click();
      await expect(page.getByTestId("channel-rail-list")).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(600);
      // Named by project, so the engine is in the filename: a WebKit render of
      // the phone's sheet is the one that matches the installed iPhone app.
      await page.screenshot({ path: `output/server-channels/rail-${testInfo.project.name}-${theme}.png` });
    });
  }

  test("an administrator's control opens the management dialog", async ({ page }, testInfo) => {
    test.skip(!paneIsWide(testInfo), "the dialog does not depend on width");
    await openGroup(page, { role: "owner" });
    const manage = page.getByTestId("channel-rail-manage").first();
    await expect(manage).toBeVisible();
    await manage.click();
    // The dialog is another surface's; what is measured here is that the rail's
    // control reaches it, which is the whole of the seam between the two.
    await expect(page.getByTestId("channel-manage-dialog")).toBeVisible();
  });
});

test("a bare group's rail, photographed for the report that asked for it", async ({ page }, testInfo) => {
  test.skip(!paneIsWide(testInfo), "the column is what is being photographed");
  await openGroup(page, { bare: true, role: "owner", theme: "dark" });
  await expect(page.getByTestId("channel-rail")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `output/bare-group-rail/rail-${testInfo.project.name}.png`, fullPage: false });
});

/**
 * Silencing and disconnecting somebody from the rail (D-221).
 *
 * The rules are `tests/unit/voice-moderation.test.mts`, which holds the client's
 * matrix against the **deployed gateway's own module** on every combination.
 * What is measured here is what that cannot reach: whether the row is pressable
 * at all, which items are drawn, and — the assertion that matters most — the
 * exact body each item sends. The gateway discards a request field it does not
 * recognise, so a misspelled name would be a 200 that changed nothing, and no
 * assertion about the interface would notice.
 */
test.describe("moderating somebody in a voice room", () => {
  test.beforeEach(async ({ request }) => {
    await requireFixtureServer(request);
  });

  /** The row for one person inside «Общая». */
  const occupant = (page: Page, userId: string) =>
    page.locator(
      `[data-testid="channel-rail-voice-group"][data-channel-id="${ROOM_LOBBY}"] ` +
        `[data-testid="channel-rail-occupant"][data-user-id="${userId}"]`,
    );

  const menuItem = (page: Page, label: string) =>
    page.getByRole("menuitem").filter({ hasText: label });

  /** Opens the rail where it is a sheet, so the phone half runs these too. */
  async function showRail(page: Page, wide: boolean) {
    if (!wide) await page.getByTestId("channel-rail-trigger").click();
    await expect(page.getByTestId("channel-rail-list")).toBeVisible();
  }

  /**
   * Join «Общая», and get the rail back.
   *
   * Joining closes the sheet — `onJoinVoice` calls `setRailOpen(false)`, which
   * is right: on a phone the drawer covers the conversation it just put you
   * into. So on the phone half the rail has to be opened again, and the first
   * version of these three tests failed on exactly that: nine green on the
   * desktop, three red at 390, all of them looking for a row inside a drawer
   * that had closed itself.
   */
  async function joinLobby(page: Page, wide: boolean) {
    await page
      .locator(`[data-testid="channel-rail-voice"][data-channel-id="${ROOM_LOBBY}"]`)
      .click();
    if (!wide) {
      await expect(page.getByTestId("channel-rail-list")).toHaveCount(0);
      await page.getByTestId("channel-rail-trigger").click();
    }
    await expect(page.getByTestId("channel-rail-list")).toBeVisible();
  }

  test("the owner may act on a member, and a plain member may act on nobody", async ({
    page,
  }, testInfo) => {
    const wide = paneIsWide(testInfo);
    await openGroup(page, { role: "owner" });
    await showRail(page, wide);

    // Petr is a member and Anna an administrator: an owner may silence both.
    await expect(occupant(page, PETR.id)).toHaveAttribute("data-moderatable", "true");
    await expect(occupant(page, ANNA.id)).toHaveAttribute("data-moderatable", "true");

    // And a row that offers nothing is not a button at all — no hover, no
    // cursor, no focus stop. Asserted on the tag rather than on the attribute,
    // because the attribute is what the component claims and the tag is what
    // the browser gives a person.
    await openGroup(page, { role: "member" });
    await showRail(page, wide);
    await expect(occupant(page, ANNA.id)).toHaveAttribute("data-moderatable", "false");
    expect(
      await occupant(page, ANNA.id).evaluate((node) => node.tagName.toLowerCase()),
    ).toBe("div");
  });

  test("a silence names the channel, the person and the direction, in the gateway's own field names", async ({
    page,
  }, testInfo) => {
    const wide = paneIsWide(testInfo);
    const opened = await openGroup(page, { role: "admin" });
    await showRail(page, wide);

    await occupant(page, PETR.id).click();
    await menuItem(page, "Заглушить в канале").click();

    await expect
      .poll(() => opened.moderationCalls.length, { message: "the menu sent nothing at all" })
      .toBe(1);
    expect(opened.moderationCalls[0]).toEqual({
      route: "force-mute",
      // Exactly these three keys and no others. `muted` is a real boolean: the
      // gateway refuses `"true"` and `1` rather than coercing them, because a
      // moderation action decided by a truthiness accident is the wrong kind of
      // accident.
      body: { channelId: ROOM_LOBBY, userId: PETR.id, muted: true },
    });

    // And the result is said out loud, because outside a joined call nothing on
    // screen can change: the table carries presence and no permission.
    await expect(page.getByTestId("kub-feedback-viewport")).toContainText(
      "больше не может говорить",
    );
  });

  test("outside the room both directions are offered, because nothing out there knows", async ({
    page,
  }, testInfo) => {
    const wide = paneIsWide(testInfo);
    await openGroup(page, { role: "owner" });
    await showRail(page, wide);
    await occupant(page, PETR.id).click();

    // `canSpeak` is null here — the rail is reading the table. Hiding the lift
    // would leave a moderator who silences somebody and then leaves the room
    // unable to undo it, which is worse than an item that turns out to be a
    // no-op; both directions are idempotent on the server.
    await expect(menuItem(page, "Заглушить в канале")).toBeVisible();
    await expect(menuItem(page, "Разрешить говорить")).toBeVisible();
    await expect(menuItem(page, "Отключить от канала")).toBeVisible();
  });

  test("inside the room the silenced person is marked, and only the lift is offered", async ({
    page,
  }, testInfo) => {
    const wide = paneIsWide(testInfo);
    await openGroup(page, { role: "owner", inLobby: { silenced: [PETR.id] } });
    await showRail(page, wide);

    // Join, so the roster comes from the transport rather than from the table —
    // the only state in which a permission is known at all.
    await joinLobby(page, wide);
    await expect(occupant(page, PETR.id)).toHaveAttribute("data-silenced", "true");
    await expect(occupant(page, ANNA.id)).toHaveAttribute("data-silenced", "false");

    // Two silhouettes rather than one glyph in two colours: a rail row is 12
    // pixels of text and colour is never the only signal.
    await expect(occupant(page, PETR.id).getByLabel("Заглушён модератором")).toBeVisible();

    await occupant(page, PETR.id).click();
    await expect(menuItem(page, "Разрешить говорить")).toBeVisible();
    // The one this test exists for. Offering «Заглушить» to somebody already
    // silenced is a control that does nothing, which is the defect being closed
    // rather than one to add.
    await expect(menuItem(page, "Заглушить в канале")).toHaveCount(0);
  });

  test("a lift the gateway did not grant is not reported as speech", async ({ page }, testInfo) => {
    const wide = paneIsWide(testInfo);
    await openGroup(page, {
      role: "owner",
      // The gateway lifted the silence and recomputed the permission from the
      // person's role against the channel's `speak_role`; the answer was still
      // no. Both halves have to reach the reader.
      moderation: { status: 200, body: { ok: true, muted: false, canPublish: false } },
    });
    await showRail(page, wide);
    await occupant(page, PETR.id).click();
    await menuItem(page, "Разрешить говорить").click();

    const feedback = page.getByTestId("kub-feedback-viewport");
    await expect(feedback).toContainText("Заглушение снято");
    await expect(feedback).toContainText("не хватает прав");
    await expect(feedback).not.toContainText("снова может говорить");
  });

  test("a refusal is a sentence, and nothing is claimed to have happened", async ({
    page,
  }, testInfo) => {
    const wide = paneIsWide(testInfo);
    await openGroup(page, {
      role: "owner",
      // A code the interface cannot pre-empt: the person left the room between
      // the rail's last read and the press. The ones the interface *can*
      // pre-empt are not offered at all, which is the point of the matrix.
      moderation: { status: 403, body: { ok: false, error: "participant_not_in_room" } },
    });
    await showRail(page, wide);
    await occupant(page, PETR.id).click();
    await menuItem(page, "Заглушить в канале").click();

    await expect(page.getByTestId("kub-feedback-viewport")).toContainText(
      "уже не в голосовом канале",
    );
  });

  test("disconnecting asks first, and answering no sends nothing", async ({ page }, testInfo) => {
    const wide = paneIsWide(testInfo);
    const opened = await openGroup(page, { role: "owner" });
    await showRail(page, wide);
    await occupant(page, PETR.id).click();
    await menuItem(page, "Отключить от канала").click();

    // The question, and the fact that it says the disconnect is not a ban —
    // a moderator who reads it as one will be surprised a second later.
    const question = page.getByText("Отключить от голосового канала?");
    await expect(question).toBeVisible();
    await expect(page.getByText("Вернуться в канал это не запрещает.")).toBeVisible();

    await page.getByRole("button", { name: "Отмена", exact: true }).click();
    await expect(question).toHaveCount(0);
    expect(opened.moderationCalls).toEqual([]);

    // And answering yes does send it, to the other route.
    await occupant(page, PETR.id).click();
    await menuItem(page, "Отключить от канала").click();
    await page.getByRole("button", { name: "Отключить", exact: true }).click();
    await expect.poll(() => opened.moderationCalls.length).toBe(1);
    expect(opened.moderationCalls[0]).toEqual({
      route: "remove",
      // No `muted` on this route. A field the gateway does not know is
      // discarded in silence, so sending one would be a 200 nobody could tell
      // from a success.
      body: { channelId: ROOM_LOBBY, userId: PETR.id },
    });
  });

  for (const theme of ["dark", "light"] as const) {
    test("the menu on an occupant, photographed in the " + theme + " theme", async ({
      page,
    }, testInfo) => {
      const wide = paneIsWide(testInfo);
      await openGroup(page, { role: "owner", theme, inLobby: { silenced: [PETR.id] } });
      await showRail(page, wide);
      await joinLobby(page, wide);
      await expect(occupant(page, PETR.id)).toHaveAttribute("data-silenced", "true");
      await occupant(page, PETR.id).click();
      await expect(menuItem(page, "Разрешить говорить")).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(400);
      await page.screenshot({
        path: `output/voice-moderation/menu-${testInfo.project.name}-${theme}.png`,
      });
    });
  }
});
