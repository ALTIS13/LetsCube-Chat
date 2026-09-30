import { expect, type Page, test } from "@playwright/test";
import {
  chat,
  membership,
  message,
  missingFunction,
  openFixture,
  person,
  type Row,
} from "./helpers/messageActionsFixture";
import { RealtimeFixture } from "./helpers/realtime-fixture";

/**
 * A group chat's call — tracker item 45, second phase.
 *
 * **Real:** the components that ship, the stores that ship, and the chat
 * list's one unfiltered `voice_channels` subscription, over a Phoenix socket
 * that behaves as Supabase Realtime does. The route answering `voice_channels`
 * honours the filter the client sends, so a client that stopped asking for a
 * ringing room would go red here rather than be covered by the fixture.
 *
 * **Stubbed:** `voice_group_call_start` and `voice_group_call_decline` (route
 * mocks; the functions are rehearsed against production in
 * `20260930190000_group_chat_calls.sql`), the gateway's token, and the SFU
 * through the DEV-only `window.__letscubeVoiceRoom` seam, as
 * `voice-ring.spec.ts` does. Fictional people throughout.
 */

test.use({
  screenshot: "off",
  trace: "off",
  video: "off",
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--mute-audio"],
  },
});

const AT = "2026-09-30T09:00:00.000Z";
const ME = person("11111111-1111-4111-8111-000000000001", "Зоя Яблокова", "zoya");
const ANNA = person("11111111-1111-4111-8111-000000000002", "Анна Смирнова", "anna");
const BORIS = person("11111111-1111-4111-8111-000000000003", "Борис Ильин", "boris");
const GROUP = "22222222-2222-4222-8222-000000000021";
const PRIVATE = "22222222-2222-4222-8222-000000000022";
const GROUP_ROOM = "33333333-3333-4333-8333-000000000021";
const PRIVATE_ROOM = "33333333-3333-4333-8333-000000000022";
const CALL_MESSAGE = "55555555-5555-4555-8555-000000000029";
const GROUP_LINE = "Всем привет";
const PRIVATE_LINE = "Созвонимся втроём?";

interface RoomRow {
  id: string;
  chat_id: string;
  name: string;
  participant_count: number;
  archived: boolean;
  ring_started_at: string | null;
  ring_caller: string | null;
  ring_answered_at: string | null;
  call_started_at: string | null;
  call_started_by: string | null;
  call_message_id: string | null;
  call_ringing: Record<string, string>;
  call_moved_to: string | null;
  call_moved_at: string | null;
}

function roomRow(id: string, chatId: string, overrides: Partial<RoomRow> = {}): RoomRow {
  return {
    id,
    chat_id: chatId,
    name: "Звонок",
    participant_count: 0,
    archived: false,
    ring_started_at: null,
    ring_caller: null,
    ring_answered_at: null,
    call_started_at: null,
    call_started_by: null,
    call_message_id: null,
    call_ringing: {},
    call_moved_to: null,
    call_moved_at: null,
    ...overrides,
  };
}

interface Harness {
  realtime: RealtimeFixture;
  rooms: RoomRow[];
  rpcCalls: { name: string; body: Row }[];
  push(room: RoomRow): void;
  probe(): Promise<{ joins: number; left: number }>;
}

async function installSeam(page: Page) {
  await page.addInitScript(() => {
    const held = { joins: 0, left: 0 };
    (window as unknown as Record<string, unknown>).__groupCallProbe = held;
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
        return { at: Date.now(), rttMs: null, jitterMs: null, packetsSent: null, packetsLost: null };
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

async function open(
  page: Page,
  seed: { rooms?: RoomRow[]; messages?: Row[] } = {},
): Promise<Harness> {
  const realtime = new RealtimeFixture();
  await realtime.install(page);
  await installSeam(page);
  const rooms: RoomRow[] = seed.rooms ?? [];
  const rpcCalls: { name: string; body: Row }[] = [];

  await openFixture(page, {
    me: ME,
    people: [ANNA, BORIS],
    chats: [chat(GROUP, "dm_group", null, AT), chat(PRIVATE, "private", null, AT)],
    memberships: [
      membership(GROUP, ANNA, "owner", AT),
      membership(GROUP, ME, "member", AT),
      membership(GROUP, BORIS, "member", AT),
      membership(PRIVATE, ANNA, "owner", AT),
      membership(PRIVATE, ME, "member", AT),
    ],
    messages: [
      message("55555555-5555-4555-8555-000000000021", GROUP, ANNA, GROUP_LINE, "2026-09-30T10:00:00.000Z"),
      message("55555555-5555-4555-8555-000000000022", PRIVATE, ANNA, PRIVATE_LINE, "2026-09-30T09:30:00.000Z"),
      ...(seed.messages ?? []),
    ],
    rpc: (name, body) => {
      if (name === "search_chat_messages" || name === "current_user_access_snapshot") return missingFunction(name);
      if (name === "voice_group_call_start") {
        rpcCalls.push({ name, body });
        let room = rooms.find((row) => row.chat_id === body.p_chat_id);
        if (!room) {
          room = roomRow(GROUP_ROOM, String(body.p_chat_id));
          rooms.push(room);
        }
        const started = room.call_message_id === null;
        if (started) {
          room.call_started_at = new Date().toISOString();
          room.call_started_by = ME.id;
          room.call_message_id = CALL_MESSAGE;
          room.call_ringing = { [ANNA.id]: room.call_started_at, [BORIS.id]: room.call_started_at };
        }
        return { body: [{ channel_id: room.id, message_id: room.call_message_id, started }] };
      }
      if (name === "voice_group_call_decline") {
        rpcCalls.push({ name, body });
        const room = rooms.find((row) => row.id === body.p_channel_id);
        if (room) delete room.call_ringing[ME.id];
        return { body: true };
      }
      if (name === "voice_calls_allowed_here") return { body: true };
      return undefined;
    },
  });

  await page.route(/\/rest\/v1\/voice_channels/, (route) => {
    const url = new URL(route.request().url());
    const single = (route.request().headers().accept ?? "").includes("application/vnd.pgrst.object");
    const chatFilter = url.searchParams.get("chat_id");
    const orFilter = url.searchParams.get("or");
    const clauses = orFilter ? orFilter.replace(/^\(/, "").replace(/\)$/, "").split(",") : [];
    const visible = (candidate: RoomRow) => {
      if (candidate.archived) return false;
      if (chatFilter && chatFilter !== `eq.${candidate.chat_id}`) return false;
      if (clauses.length === 0) return true;
      return clauses.some((clause) => {
        if (clause === "participant_count.gt.0") return candidate.participant_count > 0;
        if (clause === "ring_started_at.not.is.null") return candidate.ring_started_at !== null;
        if (clause === "call_started_at.not.is.null") return candidate.call_started_at !== null;
        if (clause === "call_moved_to.not.is.null") return candidate.call_moved_to !== null;
        return false;
      });
    };
    const found = rooms.filter(visible);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(single ? (found[0] ?? null) : found),
    });
  });
  await page.route(/\/rest\/v1\/voice_participants/, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route("**/functions/v1/voice-gateway/token", async (route) => {
    const request = route.request().postDataJSON() as Record<string, unknown> | null;
    const channelId = String(request?.channelId ?? request?.channel_id ?? GROUP_ROOM);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, url: "wss://voice.letscube.ru", room: `vc_${channelId}`, identity: ME.id, token: "livekit.join.token", canPublish: true }),
    });
  });

  return {
    realtime,
    rooms,
    rpcCalls,
    push: (room) => realtime.emit({ type: "UPDATE", table: "voice_channels", record: { ...room } }),
    probe: () =>
      page.evaluate(() => {
        const held = (window as unknown as { __groupCallProbe?: { joins: number; left: number } }).__groupCallProbe;
        return { joins: held?.joins ?? 0, left: held?.left ?? 0 };
      }),
  };
}

async function boot(page: Page, harness: Harness) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("chat-list-item").first()).toBeVisible();
  await expect.poll(() => harness.realtime.isJoined("voice-presence"), { timeout: 15_000 }).toBe(true);
}

async function openGroup(page: Page) {
  await page.getByTestId("chat-list-item").filter({ hasText: "Анна, Борис" }).click();
  await expect(page.getByText(GROUP_LINE).last()).toBeVisible();
}

const band = (page: Page) => page.getByTestId("voice-ring");

test("«Позвонить» in a group chat starts its call and takes this reader into the room", async ({ page }) => {
  const harness = await open(page);
  await boot(page, harness);
  await openGroup(page);

  const control = page.getByTestId("chat-header-group-call");
  await expect(control).toHaveAttribute("data-mode", "start");
  await expect(control).toHaveAttribute("aria-label", "Позвонить всем");
  await control.click();

  await expect.poll(() => harness.rpcCalls.map((call) => call.name)).toEqual(["voice_group_call_start"]);
  expect(harness.rpcCalls[0].body).toEqual({ p_chat_id: GROUP });
  await expect.poll(async () => (await harness.probe()).joins).toBe(1);
  // In the call, the header offers nothing more: the call bar carries it.
  await expect(control).toHaveCount(0);
  await expect(page.getByTestId("voice-call-bar").filter({ visible: true })).toBeVisible();
});

test("a group call ringing this reader draws the band, and «Ответить» takes a seat", async ({ page }) => {
  const now = new Date().toISOString();
  // Nobody seated yet: the caller's seat is confirmed by a webhook that lags
  // the ring, so a read that asked only for occupied rooms would miss it.
  const room = roomRow(GROUP_ROOM, GROUP, {
    participant_count: 0,
    call_started_at: now,
    call_started_by: ANNA.id,
    call_message_id: CALL_MESSAGE,
    call_ringing: { [ME.id]: now, [BORIS.id]: now },
  });
  const harness = await open(page, { rooms: [room] });
  await boot(page, harness);

  await expect(band(page)).toBeVisible();
  await expect(band(page)).toHaveAttribute("data-kind", "group");
  await expect(page.getByTestId("voice-ring-who")).toHaveText("Анна, Борис");
  await expect(page.getByTestId("voice-ring-detail")).toContainText("Входящий групповой звонок");

  await page.getByTestId("voice-ring-answer").click();
  await expect.poll(async () => (await harness.probe()).joins).toBe(1);
  await expect(band(page)).toHaveCount(0);
});

test("«Отклонить» stops this reader's own ring and nobody else's", async ({ page }) => {
  const now = new Date().toISOString();
  const room = roomRow(GROUP_ROOM, GROUP, {
    participant_count: 1,
    call_started_at: now,
    call_started_by: ANNA.id,
    call_message_id: CALL_MESSAGE,
    call_ringing: { [ME.id]: now, [BORIS.id]: now },
  });
  const harness = await open(page, { rooms: [room] });
  await boot(page, harness);

  await page.getByTestId("voice-ring-decline").click();
  await expect.poll(() => harness.rpcCalls.map((call) => call.name)).toEqual(["voice_group_call_decline"]);
  expect(harness.rpcCalls[0].body).toEqual({ p_channel_id: GROUP_ROOM });
  await expect(band(page)).toHaveCount(0);
  expect((await harness.probe()).joins).toBe(0);
  // The row still rings Boris, and still carries the call; the band stays away.
  harness.push(room);
  await page.waitForTimeout(400);
  await expect(band(page)).toHaveCount(0);
});

test("a ring older than 45 seconds does not ring, as a private one does not", async ({ page }) => {
  const long = new Date(Date.now() - 46_000).toISOString();
  const room = roomRow(GROUP_ROOM, GROUP, {
    participant_count: 1,
    call_started_at: long,
    call_started_by: ANNA.id,
    call_message_id: CALL_MESSAGE,
    call_ringing: { [ME.id]: long },
  });
  const harness = await open(page, { rooms: [room] });
  await boot(page, harness);
  await page.waitForTimeout(500);
  await expect(band(page)).toHaveCount(0);
});

function callMessage(payload: Record<string, unknown>, content: string): Row {
  return {
    ...message(CALL_MESSAGE, GROUP, ANNA, content, "2026-09-30T10:10:00.000Z"),
    type: "system",
    user_id: null,
    sender: null,
    content,
    system_payload: { kind: "call", mode: "group", caller: ANNA.id, started_at: "2026-09-30T10:10:00.000Z", ...payload },
  };
}

test("a running call's message offers a join, and the join goes into its room", async ({ page }) => {
  const now = new Date().toISOString();
  const room = roomRow(GROUP_ROOM, GROUP, {
    participant_count: 2,
    call_started_at: now,
    call_started_by: ANNA.id,
    call_message_id: CALL_MESSAGE,
  });
  const harness = await open(page, {
    rooms: [room],
    messages: [callMessage({ ended_at: null, duration_ms: null, participants: [ANNA.id, BORIS.id] }, "Звонок")],
  });
  await boot(page, harness);
  await openGroup(page);

  const record = page.locator('[data-call-mode="group"]');
  await expect(record).toHaveAttribute("data-call-state", "running");
  await expect(record).toContainText("Идёт звонок");
  await expect(page.getByTestId("chat-header-group-call")).toHaveAttribute("data-mode", "join");
  await page.getByTestId("group-call-record-join").click();
  await expect.poll(() => harness.rpcCalls.map((call) => call.name)).toEqual(["voice_group_call_start"]);
  await expect.poll(async () => (await harness.probe()).joins).toBe(1);
  await expect(page.getByTestId("group-call-record-join")).toHaveCount(0);
});

test("an ended call reads as missed for whoever was not in it, and the list says so too", async ({ page }) => {
  const harness = await open(page, {
    messages: [
      callMessage(
        { ended_at: "2026-09-30T10:13:12.000Z", duration_ms: 192_000, participants: [ANNA.id, BORIS.id] },
        "Звонок, 3 мин 12 с",
      ),
    ],
  });
  await boot(page, harness);
  await expect(page.getByTestId("chat-list-item").filter({ hasText: "Анна, Борис" })).toContainText("Пропущенный звонок");
  await openGroup(page);
  const record = page.locator('[data-call-mode="group"]');
  await expect(record).toHaveAttribute("data-call-missed", "true");
  await expect(record).toContainText("Пропущенный звонок");
});

test("a call this reader took part in reads as a call and its length", async ({ page }) => {
  const harness = await open(page, {
    messages: [
      callMessage(
        { ended_at: "2026-09-30T10:13:12.000Z", duration_ms: 192_000, participants: [ANNA.id, ME.id] },
        "Звонок, 3 мин 12 с",
      ),
    ],
  });
  await boot(page, harness);
  await openGroup(page);
  const record = page.locator('[data-call-mode="group"]');
  await expect(record).toHaveAttribute("data-call-missed", "false");
  await expect(record.locator('[data-call-record-headline="true"]')).toHaveText("Звонок");
  await expect(record.locator('[data-call-record-duration="true"]')).toHaveText("3 мин 12 с");
});

test("a private call that moved into a group chat follows it, and is not hung up on the way", async ({ page }) => {
  const now = new Date().toISOString();
  // Anna rings this reader in the private chat, and the reader answers.
  const privateRoom = roomRow(PRIVATE_ROOM, PRIVATE, {
    participant_count: 1,
    ring_started_at: now,
    ring_caller: ANNA.id,
  });
  const harness = await open(page, { rooms: [privateRoom] });
  await boot(page, harness);
  await expect(band(page)).toHaveAttribute("data-kind", "private");
  // Answering is `voice_call_answer`; the fixture's blanket RPC handler answers it.
  await page.route("**/rest/v1/rpc/voice_call_answer", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(new Date().toISOString()) }),
  );
  await page.getByTestId("voice-ring-answer").click();
  await expect.poll(async () => (await harness.probe()).joins).toBe(1);
  privateRoom.ring_answered_at = new Date().toISOString();
  privateRoom.participant_count = 2;
  harness.push(privateRoom);
  await expect(page.getByTestId("voice-call-bar").filter({ visible: true })).toBeVisible();

  // Anna adds Boris: the database writes the private call down, clears its
  // ring, starts the group chat's call ringing Boris, and points the private
  // room at the group's — all in one transaction, so one read carries it all.
  const moved = new Date().toISOString();
  privateRoom.ring_started_at = null;
  privateRoom.ring_caller = null;
  privateRoom.ring_answered_at = null;
  privateRoom.call_moved_to = GROUP_ROOM;
  privateRoom.call_moved_at = moved;
  harness.rooms.push(
    roomRow(GROUP_ROOM, GROUP, {
      participant_count: 1,
      call_started_at: moved,
      call_started_by: ANNA.id,
      call_message_id: CALL_MESSAGE,
      call_ringing: { [BORIS.id]: moved },
    }),
  );
  harness.push(privateRoom);

  // Left the private room and joined the group's: two joins, and the bar names
  // the group chat rather than going away.
  await expect.poll(async () => (await harness.probe()).joins).toBe(2);
  await expect(page.getByTestId("voice-call-bar").filter({ visible: true })).toBeVisible();
  await expect(page.getByTestId("voice-call-bar-room").filter({ visible: true })).toContainText("Анна, Борис");
  // Not rung into the call it is already in.
  await expect(band(page)).toHaveCount(0);
});

test("a move that lands while this reader is still connecting goes to the group chat, not the room the call left", async ({ page }) => {
  const now = new Date().toISOString();
  const privateRoom = roomRow(PRIVATE_ROOM, PRIVATE, {
    participant_count: 1,
    ring_started_at: now,
    ring_caller: ANNA.id,
  });
  const harness = await open(page, { rooms: [privateRoom] });
  await boot(page, harness);
  await page.route("**/rest/v1/rpc/voice_call_answer", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(new Date().toISOString()) }),
  );
  // The private room's token is held back: this reader is mid-connection when
  // the move arrives, which is the state `joinVoiceChannel` refuses a second
  // join in.
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const asked: string[] = [];
  await page.route("**/functions/v1/voice-gateway/token", async (route) => {
    const request = route.request().postDataJSON() as { channelId?: string } | null;
    const channelId = String(request?.channelId ?? "");
    asked.push(channelId);
    if (channelId === PRIVATE_ROOM) await held;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, url: "wss://voice.letscube.ru", room: `vc_${channelId}`, identity: ME.id, token: "livekit.join.token", canPublish: true }),
    });
  });
  await page.getByTestId("voice-ring-answer").click();
  await expect.poll(() => asked).toContain(PRIVATE_ROOM);

  const moved = new Date().toISOString();
  privateRoom.ring_started_at = null;
  privateRoom.ring_caller = null;
  privateRoom.call_moved_to = GROUP_ROOM;
  privateRoom.call_moved_at = moved;
  harness.rooms.push(
    roomRow(GROUP_ROOM, GROUP, {
      participant_count: 1,
      call_started_at: moved,
      call_started_by: ANNA.id,
      call_message_id: CALL_MESSAGE,
      call_ringing: { [BORIS.id]: moved },
    }),
  );
  harness.push(privateRoom);
  await expect.poll(() => asked).toContain(GROUP_ROOM);
  release();

  await expect(page.getByTestId("voice-call-bar-room").filter({ visible: true })).toContainText("Анна, Борис");
  // One seat taken, and it is the group chat's: the held private join was
  // cancelled rather than completed.
  await expect.poll(async () => (await harness.probe()).joins).toBe(1);
});
