import { expect, type Page, type TestInfo, test } from "@playwright/test";
import {
  chat,
  membership,
  message,
  missingFunction,
  openChat,
  openFixture,
  person,
  type Row,
} from "./helpers/messageActionsFixture";
import { RealtimeFixture } from "./helpers/realtime-fixture";

/**
 * A one-to-one call, from the press to the ring and back — slice A of
 * `docs/proposals/2026-09-18-one-to-one-calls.md`.
 *
 * What is real here and what is not, so no assertion below is read as proving
 * more than it does.
 *
 * **Real:** the components that ship, the ring store that ships, the chat-list
 * reader that ships and its one unfiltered `voice_channels` subscription —
 * spoken to over a Phoenix socket that behaves as Supabase Realtime does, so
 * «the ring arrives on the existing subscription» is measured rather than
 * asserted. The route that answers `voice_channels` honours the filter the
 * client actually sends, which is what makes the widening of that query
 * something a mutation can turn red rather than something the fixture hides.
 *
 * **Stubbed:** the four `SECURITY DEFINER` functions (route mocks — they are
 * applied and verified on production, and there is nothing at `127.0.0.1:54321`
 * to answer), the gateway's token, and the SFU through the DEV-only
 * `window.__letscubeVoiceRoom` seam. What a room does when it is really joined
 * is `tests/e2e/voice-call.spec.ts`'s subject and is not re-proved here.
 *
 * Everything runs on the message-actions fixture: fictional people, a mocked
 * backend, no production screen.
 */

test.use({
  launchOptions: {
    // A real audio track, without a microphone and without a prompt — the two
    // switches `voice-call.spec.ts` uses for the same reason.
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

const AT = "2026-09-13T09:00:00.000Z";
const ME = person("11111111-1111-4111-8111-000000000001", "Максим Орлов");
const ANNA = person("11111111-1111-4111-8111-000000000002", "Анна Смирнова");
const PETR = person("11111111-1111-4111-8111-000000000003", "Пётр Ильин");
/** A private conversation **Anna** opened, so she is its `owner` and I am a `member`. */
const CHAT_PRIVATE = "22222222-2222-4222-8222-000000000011";
const CHAT_TEAM = "22222222-2222-4222-8222-000000000012";
const ROOM = "33333333-3333-4333-8333-000000000011";
const LINE = "Привет, посмотри смету";
const TEAM_LINE = "Макет главной готов";
const GRANT = {
  ok: true,
  url: "wss://voice.letscube.ru",
  room: `vc_${ROOM}`,
  identity: ME.id,
  token: "livekit.join.token",
  canPublish: true,
};

/** The room row, as the table holds it. Mutable: the four functions write to it. */
interface RoomRow {
  id: string;
  chat_id: string;
  name: string;
  participant_count: number;
  archived: boolean;
  ring_started_at: string | null;
  ring_caller: string | null;
  ring_answered_at: string | null;
}

function emptyRoom(): RoomRow {
  return {
    id: ROOM,
    chat_id: CHAT_PRIVATE,
    name: "Звонок",
    participant_count: 0,
    archived: false,
    ring_started_at: null,
    ring_caller: null,
    ring_answered_at: null,
  };
}

interface Seed {
  theme?: "light" | "dark";
  /** The room as it is when the page loads. Absent means a chat with no room yet. */
  room?: Partial<RoomRow>;
  /** Refuse `voice_call_ring` with this body, as PostgREST would. */
  ringRefusal?: { status: number; body: unknown };
}

interface Harness {
  realtime: RealtimeFixture;
  /** The row the table holds, which the tests read and write directly. */
  room: RoomRow;
  /** Push the row at every subscription, the way an UPDATE on it really would. */
  push(): void;
  rpcCalls: { name: string; body: Row }[];
  probe(): Promise<{ joins: number; left: number }>;
}

/**
 * The SFU seam and a probe, installed before anything loads.
 *
 * Deliberately thinner than `voice-call.spec.ts`'s: nothing here is about what
 * a transport does with a track. What these tests need to know is only whether
 * the client joined a room and whether it left one, because that is the whole
 * of the ring's contract with the call — ring then join, cancel then leave.
 */
async function installSeam(page: Page) {
  await page.addInitScript(() => {
    const held = { joins: 0, left: 0 };
    (window as unknown as Record<string, unknown>).__ringProbe = held;
    (window as unknown as Record<string, unknown>).__letscubeVoiceRoom = (events: {
      onParticipants(participants: unknown[]): void;
    }) => ({
      async join() {
        held.joins += 1;
        events.onParticipants([]);
      },
      async setMuted() {},
      async setMicrophoneOpen() {},
      async setDeafened() {},
      async setParticipantVolume() {},
      async leave() {
        held.left += 1;
      },
      async sampleHealth() {
        return {
          at: Date.now(),
          rttMs: null,
          jitterMs: null,
          packetsSent: null,
          packetsLost: null,
        };
      },
      async setOutputDevice() {
        return true;
      },
      serverName() {
        return null;
      },
    });
  });
}

async function open(page: Page, seed: Seed = {}): Promise<Harness> {
  const realtime = new RealtimeFixture();
  await realtime.install(page);
  await installSeam(page);

  const room: RoomRow = { ...emptyRoom(), ...seed.room };
  const rpcCalls: { name: string; body: Row }[] = [];

  const rows: { chats: Row[]; memberships: Row[]; messages: Row[] } = {
    chats: [
      chat(CHAT_PRIVATE, "private", null, AT),
      chat(CHAT_TEAM, "group", "Команда проекта", AT),
    ],
    memberships: [
      // Anna opened the conversation, so she holds `owner` and I hold `member`.
      // That is the asymmetry `voice_private_room` exists to close, and it is
      // seeded this way round on purpose: the control below is offered to the
      // participant who could **not** have created the room.
      membership(CHAT_PRIVATE, ANNA, "owner", AT),
      membership(CHAT_PRIVATE, ME, "member", AT),
      membership(CHAT_TEAM, ME, "member", AT),
      membership(CHAT_TEAM, PETR, "owner", AT),
    ],
    messages: [
      message(
        "55555555-5555-4555-8555-000000000011",
        CHAT_PRIVATE,
        ANNA,
        LINE,
        "2026-09-13T10:00:00.000Z",
      ),
      message(
        "55555555-5555-4555-8555-000000000012",
        CHAT_TEAM,
        PETR,
        TEAM_LINE,
        "2026-09-13T10:05:00.000Z",
      ),
    ],
  };

  await openFixture(page, {
    me: ME,
    chats: rows.chats,
    memberships: rows.memberships,
    messages: rows.messages,
    people: [ANNA, PETR],
    rpc: (name, body) => {
      if (name === "search_chat_messages") return missingFunction(name);
      if (name === "voice_call_ring") {
        rpcCalls.push({ name, body });
        if (seed.ringRefusal) return seed.ringRefusal;
        room.ring_started_at = new Date().toISOString();
        room.ring_caller = ME.id;
        room.ring_answered_at = null;
        // Ringing means joining, and the caller is in the room from the press.
        room.participant_count = 1;
        return { body: [{ channel_id: ROOM, ring_started_at: room.ring_started_at }] };
      }
      if (name === "voice_call_answer") {
        rpcCalls.push({ name, body });
        room.ring_answered_at = new Date().toISOString();
        room.participant_count = 2;
        return { body: room.ring_answered_at };
      }
      if (name === "voice_call_stop") {
        rpcCalls.push({ name, body });
        const was = room.ring_answered_at ? "answered" : room.ring_started_at ? "ringing" : "idle";
        room.ring_started_at = null;
        room.ring_caller = null;
        room.ring_answered_at = null;
        room.participant_count = 0;
        return { body: was };
      }
      if (name === "voice_private_room") {
        rpcCalls.push({ name, body });
        return { body: ROOM };
      }
      return undefined;
    },
  });

  if (seed.theme) {
    // After `openFixture`, which writes «dark» in an init script of its own:
    // init scripts run in registration order and the later write is the one the
    // application reads.
    await page.addInitScript(
      (value) => localStorage.setItem("kub-theme", value as string),
      seed.theme,
    );
  }

  /**
   * `voice_channels`, answering the filter the client actually sent.
   *
   * This is the line that makes the widened read testable. The chat list's
   * query is «somebody in it **or** a live ring»; a mock that answered every
   * row regardless would be green whether the client asked for the ring or not,
   * which is precisely the mutation these tests have to catch.
   */
  await page.route(/\/rest\/v1\/voice_channels/, (route) => {
    const url = new URL(route.request().url());
    const single = (route.request().headers().accept ?? "").includes(
      "application/vnd.pgrst.object",
    );
    const chatFilter = url.searchParams.get("chat_id");
    const countFilter = url.searchParams.get("participant_count");
    const orFilter = url.searchParams.get("or");
    const visible = (candidate: RoomRow) => {
      if (candidate.archived) return false;
      if (chatFilter && chatFilter !== `eq.${candidate.chat_id}`) return false;
      const clauses = orFilter
        ? orFilter.replace(/^\(/, "").replace(/\)$/, "").split(",")
        : countFilter
          ? [`participant_count.${countFilter}`]
          : [];
      if (clauses.length === 0) return true;
      return clauses.some((clause) =>
        clause === "participant_count.gt.0"
          ? candidate.participant_count > 0
          : clause === "ring_started_at.not.is.null"
            ? candidate.ring_started_at !== null
            : false,
      );
    };
    const found = visible(room) ? [room] : [];
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(single ? (found[0] ?? null) : found),
    });
  });
  await page.route(/\/rest\/v1\/voice_participants/, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route("**/functions/v1/voice-gateway/token", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(GRANT) }),
  );

  return {
    realtime,
    room,
    push: () => {
      realtime.emit({ type: "UPDATE", table: "voice_channels", record: { ...room } });
    },
    rpcCalls,
    probe: () =>
      page.evaluate(() => {
        const held = (window as unknown as { __ringProbe?: { joins: number; left: number } })
          .__ringProbe;
        return { joins: held?.joins ?? 0, left: held?.left ?? 0 };
      }),
  };
}

/** The list, booted, with the one subscription this whole design rests on live. */
async function boot(page: Page, harness: Harness) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("chat-list-item").first()).toBeVisible();
  await expect
    .poll(() => harness.realtime.isJoined("voice-presence"), { timeout: 15_000 })
    .toBe(true);
}

const card = (page: Page) => page.getByTestId("voice-ring");

// ---------------------------------------------------------------------------
// The control, offered to the participant who could not have made the room
// ---------------------------------------------------------------------------

test("a private chat offers a call to the participant who is not its owner", async ({ page }) => {
  const harness = await open(page);
  await openChat(page, "Анна Смирнова", LINE);
  // `voice_channels` INSERT is `is_chat_admin(chat_id)`, and Anna opened this
  // conversation, so she is its `owner` and this reader is a `member`. Before
  // `voice_private_room` this person could not have created the room a call
  // needs at all — which is the asymmetry nobody had named.
  await expect(page.getByTestId("chat-header-call")).toBeVisible();
  expect(harness.rpcCalls).toHaveLength(0);
});

test("a group offers no call, because a one-to-one call is a private chat's", async ({ page }) => {
  await open(page);
  await openChat(page, "Команда проекта", TEAM_LINE);
  await expect(page.getByTestId("chat-header-call")).toHaveCount(0);
  // And the menu it sits beside is untouched, so this is an addition rather
  // than a rearrangement.
  await expect(page.getByTestId("chat-control-row")).toBeVisible();
});

// ---------------------------------------------------------------------------
// Calling
// ---------------------------------------------------------------------------

test("pressing «Позвонить» rings, joins, and says who is being called", async ({ page }) => {
  const harness = await open(page);
  await openChat(page, "Анна Смирнова", LINE);
  await page.getByTestId("chat-header-call").click();

  await expect(card(page)).toBeVisible();
  await expect(card(page)).toHaveAttribute("data-direction", "outgoing");
  await expect(page.getByTestId("voice-ring-who")).toHaveText("Анна Смирнова");
  await expect(page.getByTestId("voice-ring-detail")).toHaveText("Звоним…");
  await expect(page.getByTestId("voice-ring-cancel")).toBeVisible();
  // The caller is never offered their own ring to answer.
  await expect(page.getByTestId("voice-ring-answer")).toHaveCount(0);

  expect(harness.rpcCalls.map((call) => call.name)).toEqual(["voice_call_ring"]);
  expect(harness.rpcCalls[0].body).toEqual({ p_chat_id: CHAT_PRIVATE });
  // Ring **then** join: the caller is in the room from the press, so an answer
  // lands on a connection that is already up.
  await expect.poll(async () => (await harness.probe()).joins, { timeout: 10_000 }).toBe(1);

  // And the bar stands down while it rings. Without that rule it would say «Вы
  // в разговоре» about a call nobody has taken.
  await expect(page.getByTestId("voice-call-bar")).toHaveCount(0);
  // The control that started it is gone with it: a second press would be
  // refused `already_ringing`, and a control that is only ever refused should
  // not have been drawn.
  await expect(page.getByTestId("chat-header-call")).toHaveCount(0);
});

test("«Отменить» clears the ring and leaves the room it was waiting in", async ({ page }) => {
  const harness = await open(page);
  await openChat(page, "Анна Смирнова", LINE);
  await page.getByTestId("chat-header-call").click();
  await expect(card(page)).toBeVisible();

  await page.getByTestId("voice-ring-cancel").click();
  await expect(card(page)).toHaveCount(0);

  const stop = harness.rpcCalls.filter((call) => call.name === "voice_call_stop");
  expect(stop).toHaveLength(1);
  expect(stop[0].body).toEqual({ p_channel_id: ROOM, p_reason: "cancelled" });
  await expect.poll(async () => (await harness.probe()).left, { timeout: 10_000 }).toBe(1);
  // The chat can be called again straight away.
  await expect(page.getByTestId("chat-header-call")).toBeVisible();
});

test("a refused ring says why, and nothing is joined", async ({ page }) => {
  const harness = await open(page, {
    // What `blocked_from_chat` produces: `raise exception 'blocked' using
    // errcode = '42501'`. The SQLSTATE alone cannot tell it from
    // `not_a_member`, which is why the message is what the client reads.
    ringRefusal: {
      status: 403,
      body: { code: "42501", details: null, hint: null, message: "blocked" },
    },
  });
  await openChat(page, "Анна Смирнова", LINE);
  await page.getByTestId("chat-header-call").click();

  await expect(page.getByText("Этот человек недоступен для звонка.")).toBeVisible();
  await expect(card(page)).toHaveCount(0);
  expect((await harness.probe()).joins).toBe(0);
});

// ---------------------------------------------------------------------------
// Being called
// ---------------------------------------------------------------------------

test("a ring arrives on the subscription that already existed", async ({ page }) => {
  const harness = await open(page);
  await boot(page, harness);
  // Nothing is on screen: the chat list, and no call anywhere.
  await expect(card(page)).toHaveCount(0);

  // Anna calls. On the server that is an UPDATE to this row; here it is the
  // same UPDATE, delivered down the one unfiltered `voice_channels` channel
  // `useVoicePresenceReader` opened on boot.
  harness.room.ring_started_at = new Date().toISOString();
  harness.room.ring_caller = ANNA.id;
  // Nought, and it is the point: the caller has pressed and is joining, and the
  // SFU's webhook has not bumped this counter yet. A room with nobody in it is
  // exactly what the old gt(participant_count, 0) read could not see, which
  // is how the ring was invisible to the subscription it was designed to reach.
  harness.room.participant_count = 0;
  harness.push();

  await expect(card(page)).toBeVisible({ timeout: 10_000 });
  await expect(card(page)).toHaveAttribute("data-direction", "incoming");
  await expect(page.getByTestId("voice-ring-who")).toHaveText("Анна Смирнова");
  await expect(page.getByTestId("voice-ring-detail")).toHaveText("Входящий звонок");
  await expect(page.getByTestId("voice-ring-answer")).toBeVisible();
  await expect(page.getByTestId("voice-ring-decline")).toBeVisible();
  // Answered from the chat list, with no conversation open at all — which is
  // the point of a card fixed to the window rather than docked into a pane.
  await expect(page.getByTestId("chat-list-item").first()).toBeVisible();
});

test("«Ответить» accepts, joins, and hands the call to the bar", async ({ page }) => {
  const harness = await open(page, {
    room: { ring_started_at: new Date().toISOString(), ring_caller: ANNA.id, participant_count: 0 },
  });
  await boot(page, harness);
  await expect(card(page)).toBeVisible({ timeout: 10_000 });

  await page.getByTestId("voice-ring-answer").click();
  // Answered: the card stands down and the call bar takes over, with the
  // person's name on it rather than «Звонок».
  await expect(card(page)).toHaveCount(0, { timeout: 10_000 });
  expect(harness.rpcCalls.map((call) => call.name)).toEqual(["voice_call_answer"]);
  expect(harness.rpcCalls[0].body).toEqual({ p_channel_id: ROOM });
  await expect.poll(async () => (await harness.probe()).joins, { timeout: 10_000 }).toBe(1);
  await expect(page.getByTestId("voice-call-bar")).toBeVisible();
  await expect(page.getByTestId("voice-call-bar-room")).toHaveText("Анна Смирнова");
});

test("«Отклонить» stops the ring without joining anything", async ({ page }) => {
  const harness = await open(page, {
    room: { ring_started_at: new Date().toISOString(), ring_caller: ANNA.id, participant_count: 0 },
  });
  await boot(page, harness);
  await expect(card(page)).toBeVisible({ timeout: 10_000 });

  await page.getByTestId("voice-ring-decline").click();
  await expect(card(page)).toHaveCount(0);
  const stop = harness.rpcCalls.filter((call) => call.name === "voice_call_stop");
  expect(stop).toHaveLength(1);
  expect(stop[0].body).toEqual({ p_channel_id: ROOM, p_reason: "declined" });
  expect((await harness.probe()).joins).toBe(0);
});

test("a ring that clears stops every device, whatever that device thought", async ({ page }) => {
  // §4a: one row reaches every device the person is signed in on, and the row
  // changing stops the rest. This is that, from the losing device's side — the
  // caller hung up, or somebody's other phone answered.
  const harness = await open(page, {
    room: { ring_started_at: new Date().toISOString(), ring_caller: ANNA.id, participant_count: 0 },
  });
  await boot(page, harness);
  await expect(card(page)).toBeVisible({ timeout: 10_000 });

  harness.room.ring_started_at = null;
  harness.room.ring_caller = null;
  harness.room.participant_count = 0;
  harness.push();

  await expect(card(page)).toHaveCount(0, { timeout: 10_000 });
  // Nothing was pressed here, so nothing was sent.
  expect(harness.rpcCalls).toHaveLength(0);
});

test("a ring that ran out before this device saw it does not ring", async ({ page }) => {
  // §4a's second trap: a laptop woken ten minutes after the call was missed
  // receives the row on resubscribe. The expiry is evaluated on arrival rather
  // than trusted, and the boundary is the database's — 45 seconds, inclusive.
  const harness = await open(page, {
    room: {
      ring_started_at: new Date(Date.now() - 600_000).toISOString(),
      ring_caller: ANNA.id,
      participant_count: 1,
    },
  });
  await boot(page, harness);
  await page.waitForTimeout(1_500);
  await expect(card(page)).toHaveCount(0);
});

test("a ring nobody answers runs out, and the caller writes it off", async ({ page }) => {
  // The 45 seconds are the owner's answer and the database's default, and in
  // this slice it is the client that is present which enforces them. The ring
  // is aged **just before the page is opened**, not when the fixture is built:
  // booting costs a second and a half, and a ring seeded half a second short of
  // the boundary had already run out by the time anything rendered — measured,
  // and it is the same class of mistake as trusting a clock you do not control.
  //
  // This device is the **caller**, which is the only side that writes the ring
  // off: a callee whose ring ran out simply stops ringing.
  const harness = await open(page);
  harness.room.ring_started_at = new Date(Date.now() - 40_000).toISOString();
  harness.room.ring_caller = ME.id;
  harness.room.participant_count = 1;
  await boot(page, harness);
  await expect(card(page)).toBeVisible({ timeout: 10_000 });
  await expect(card(page)).toHaveAttribute("data-direction", "outgoing");

  // Nothing is pressed. The store's own timer is the only thing that can end
  // this, and what it must do is write the ring off rather than merely hide it.
  await expect(card(page)).toHaveCount(0, { timeout: 15_000 });
  await expect
    .poll(() => harness.rpcCalls.filter((call) => call.name === "voice_call_stop").length, {
      timeout: 10_000,
    })
    .toBe(1);
  expect(harness.rpcCalls.find((call) => call.name === "voice_call_stop")?.body).toEqual({
    p_channel_id: ROOM,
    p_reason: "missed",
  });
});

// ---------------------------------------------------------------------------
// The chat list's mark, which the widened read must not have broken
// ---------------------------------------------------------------------------

test("a ringing room is read but is not «somebody is talking here»", async ({ page }) => {
  const harness = await open(page, {
    room: { ring_started_at: new Date().toISOString(), ring_caller: ANNA.id, participant_count: 0 },
  });
  await boot(page, harness);
  // The ring reached the screen, so the room is genuinely in the read.
  await expect(card(page)).toBeVisible({ timeout: 10_000 });
  // And the conversation's row says nothing: the caller is sitting in the room
  // waiting to be answered, which is not a conversation in progress.
  await expect(page.getByTestId("chat-list-voice")).toHaveCount(0);

  // Answered, and it becomes one.
  harness.room.ring_answered_at = new Date().toISOString();
  harness.room.participant_count = 2;
  harness.push();
  await expect(page.getByTestId("chat-list-voice")).toHaveCount(1, { timeout: 10_000 });
  await expect(page.getByTestId("chat-list-voice")).toHaveAttribute("data-voice-count", "2");
});

// ---------------------------------------------------------------------------
// The pixels
// ---------------------------------------------------------------------------

for (const theme of ["dark", "light"] as const) {
  test(`what a call looks like, ${theme}`, async ({ page }, info: TestInfo) => {
    // A test per theme rather than a restamp inside one: the theme is read from
    // storage at boot, and `chat-roles-reach.spec.ts` records what stamping the
    // DOM afterwards produces — the tokens move while React still holds the old
    // theme, and the photograph comes out a hybrid with a light label.
    const harness = await open(page, { theme });
    await boot(page, harness);

    harness.room.ring_started_at = new Date().toISOString();
    harness.room.ring_caller = ANNA.id;
    harness.room.participant_count = 1;
    harness.push();
    await expect(card(page)).toBeVisible({ timeout: 10_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `output/voice-ring/incoming-${theme}-${info.project.name}.png` });

    // The same card the other way round, from the caller's own press.
    harness.room.ring_started_at = null;
    harness.room.ring_caller = null;
    harness.room.participant_count = 0;
    harness.push();
    await expect(card(page)).toHaveCount(0, { timeout: 10_000 });
    await openChat(page, "Анна Смирнова", LINE);
    await page.getByTestId("chat-header-call").click();
    await expect(card(page)).toBeVisible({ timeout: 10_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `output/voice-ring/outgoing-${theme}-${info.project.name}.png` });
  });
}
