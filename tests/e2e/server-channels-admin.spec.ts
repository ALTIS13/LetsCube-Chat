import { expect, test, type Page, type TestInfo } from "@playwright/test";
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
 * The management half of a group's channels: adding, renaming, moving and
 * removing text channels, voice rooms and the headings that group them.
 *
 * The owner's ask was a server's channel system rather than one voice call
 * everybody joins, so what is measured here is the mechanics rather than the
 * wording — that a second room can be made at all, that a room's two settings
 * are the ones the column really has, that a heading is made and removed apart
 * from the rooms under it, and that a reorder writes positions instead of
 * indices.
 *
 * Everything runs on the message-actions fixture — a mocked backend with
 * fictional people, three invented channels and two invented rooms — so no
 * production screen is ever rendered and no production row is ever read.
 *
 * Two contracts are asserted on the wire rather than on the screen, because
 * neither is visible in a rendering:
 *
 *   - nothing here ever writes `public.voice_participants`. It has no INSERT,
 *     UPDATE or DELETE policy at all, so every such write would be refused;
 *   - a move that lands where it started sends no request. `reorderPositions`
 *     returns only the rows that change, and the proof that the dialog uses it
 *     is the absence of a PATCH.
 */

const AT = "2026-09-14T09:00:00.000Z";
const ME = person("11111111-1111-4111-8111-0000000000a1", "Максим Орлов");
const ANNA = person("11111111-1111-4111-8111-0000000000a2", "Анна Смирнова");
const PETR = person("11111111-1111-4111-8111-0000000000a3", "Пётр Ильин");
const CHAT_TEAM = "22222222-2222-4222-8222-0000000000b1";
const CAT_VOICE = "33333333-3333-4333-8333-0000000000c1";
const TOPIC_GENERAL = "44444444-4444-4444-8444-0000000000d1";
const TOPIC_RELEASES = "44444444-4444-4444-8444-0000000000d2";
const VOICE_MEETING = "55555555-5555-4555-8555-0000000000e1";
const VOICE_LOUNGE = "55555555-5555-4555-8555-0000000000e2";
const LINES = ["Макет главной готов, посмотрите", "Смета на витрину готова, посмотри"];

type MyRole = "owner" | "admin" | "member";

/**
 * The three tables this dialog reads, seeded fresh for every test.
 *
 * Mutable, because the POSTs have to answer with a row whose id the dialog can
 * key on. The PATCHes and the DELETE do **not** change it: the fixture's `rest`
 * hook is handed the resource, the method and the body but not the query, so a
 * `.eq("id", …)` cannot be routed to a row here — and it does not need to be,
 * since the dialog applies a successful write to its own list and the reads are
 * never repeated within a test. What those writes carried is asserted from
 * `fixture.restCalls`, where the query string is recorded verbatim.
 */
interface ChannelStore {
  categories: Row[];
  topics: Row[];
  voice: Row[];
  created: number;
}

function seedStore(): ChannelStore {
  return {
    created: 0,
    categories: [
      { id: CAT_VOICE, chat_id: CHAT_TEAM, name: "Голос", position: 0, created_at: AT },
    ],
    topics: [
      {
        id: TOPIC_GENERAL,
        chat_id: CHAT_TEAM,
        name: "Общий",
        emoji: null,
        position: 0,
        category_id: null,
        is_general: true,
        archived: false,
        created_at: AT,
      },
      {
        id: TOPIC_RELEASES,
        chat_id: CHAT_TEAM,
        name: "Релизы",
        emoji: null,
        position: 1,
        category_id: null,
        is_general: false,
        archived: false,
        created_at: AT,
      },
    ],
    voice: [
      {
        id: VOICE_MEETING,
        chat_id: CHAT_TEAM,
        name: "Переговорная",
        position: 0,
        category_id: CAT_VOICE,
        max_participants: 10,
        speak_role: "member",
        participant_count: 0,
        archived: false,
        created_at: AT,
      },
      {
        id: VOICE_LOUNGE,
        chat_id: CHAT_TEAM,
        name: "Отдых",
        // A gap, on purpose. Positions are not contiguous — a removal leaves
        // holes — and with the two rooms at 0 and 1 «one past the last» and
        // «the count» are the same number, so the insert's position could not
        // tell them apart. Measured: a mutation swapping `nextPosition` for
        // `siblings.length` left every test green until this became 4.
        position: 4,
        category_id: CAT_VOICE,
        max_participants: 5,
        speak_role: "admin",
        participant_count: 2,
        archived: false,
        created_at: AT,
      },
    ],
  };
}

function restFor(store: ChannelStore) {
  return ({ resource, method, body }: { resource: string; method: string; body: unknown }) => {
    const held =
      resource === "chat_channel_categories"
        ? store.categories
        : resource === "topics"
          ? store.topics
          : resource === "voice_channels"
            ? store.voice
            : null;
    if (!held) return undefined;
    if (method === "GET") return { status: 200, body: held };
    if (method === "POST") {
      store.created += 1;
      const sent = (Array.isArray(body) ? body[0] : body) as Row;
      // An object, not an array: the insert chains `.select().single()`, which
      // asks PostgREST for `application/vnd.pgrst.object+json`.
      const row: Row = {
        id: `99999999-9999-4999-8999-${String(store.created).padStart(12, "0")}`,
        emoji: null,
        is_general: false,
        max_participants: 10,
        speak_role: "member",
        participant_count: 0,
        archived: false,
        created_at: AT,
        ...sent,
      };
      held.push(row);
      return { status: 201, body: row };
    }
    // A PATCH or a DELETE with `return=minimal`. The dialog only reads `error`.
    return { status: 200, body: [] };
  };
}

function rows(myRole: MyRole): { chats: Row[]; memberships: Row[]; messages: Row[] } {
  return {
    chats: [chat(CHAT_TEAM, "group", "Команда проекта", AT)],
    memberships: [
      membership(CHAT_TEAM, ME, myRole, AT),
      membership(CHAT_TEAM, ANNA, myRole === "owner" ? "admin" : "owner", AT),
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

function shotPath(info: TestInfo, name: string): string {
  return `output/server-channels-admin/${name}-${info.project.name}.png`;
}

/**
 * A screenshot with the pointer parked off the dialog.
 *
 * Measured rather than tidied: the click that opens the dialog leaves the mouse
 * inside the sheet, and on the mobile projects — which emulate a touch device
 * and still carry a mouse — the element that lands under that coordinate keeps
 * `:hover`. The first capture at 390 showed one reorder arrow wearing
 * `kub-raise-hover`'s veil with nothing hovering it on purpose, and
 * `document.querySelectorAll(":hover")` named the parked pointer. A picture of
 * the rest state has to move the mouse away first.
 */
async function shoot(page: Page, path: string) {
  await page.mouse.move(1, 1);
  // And with every colour transition finished. The segmented pickers carry
  // `transition-colors`, so a capture taken in the frame after a click shows
  // both the option being left and the option being taken part-way between
  // their fills — photographed once in the light theme, where it read as two
  // selected options, one of them washed out. `getAnimations` on the document
  // includes CSS transitions, and a transition that has ended is dropped from
  // it.
  await page.waitForFunction(
    () => document.getAnimations().every((animation) => animation.playState !== "running"),
    undefined,
    { timeout: 5000 },
  );
  await page.screenshot({ path, fullPage: false });
}

/**
 * The theme, stamped the way the product's own runtime stamps it.
 *
 * Not through `localStorage`: the fixture writes «dark» in its own init script,
 * which runs after anything this file could add, so a theme set that way is
 * overwritten before the application reads it. The same four lines
 * `group-settings.spec.ts` uses, and nothing else decides the palette.
 */
async function stampTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((value) => {
    const root = document.documentElement;
    root.classList.toggle("dark", value === "dark");
    root.classList.toggle("light", value === "light");
    root.setAttribute("data-theme", value as string);
    root.style.colorScheme = value as string;
  }, theme);
}

/** Until the information card's layers have finished sliding. */
async function settled(page: Page) {
  await page.waitForFunction(() => {
    const layers = document.querySelectorAll<HTMLElement>(".kub-subview");
    return Array.from(layers).every((layer) => {
      const opacity = Number.parseFloat(getComputedStyle(layer).opacity);
      return layer.dataset.state === "current" ? opacity === 1 : opacity === 0;
    });
  });
}

async function openInfo(
  page: Page,
  store: ChannelStore,
  myRole: MyRole,
  theme: "light" | "dark",
): Promise<Fixture> {
  const seed = rows(myRole);
  const fixture = await openFixture(page, {
    me: ME,
    chats: seed.chats,
    memberships: seed.memberships,
    messages: seed.messages,
    rest: restFor(store),
    rpc: (name) => (name === "search_chat_messages" ? missingFunction(name) : undefined),
  });
  await openChat(page, "Команда проекта", LINES[0]);
  await stampTheme(page, theme);
  await page.getByTestId("chat-header-info-button").click();
  await expect(page.getByTestId("chat-info-panel")).toBeVisible();
  return fixture;
}

async function openSettings(
  page: Page,
  store: ChannelStore,
  myRole: MyRole = "owner",
  theme: "light" | "dark" = "dark",
): Promise<Fixture> {
  const fixture = await openInfo(page, store, myRole, theme);
  await page.getByLabel("Редактировать").click();
  await expect(page.getByTestId("chat-info-settings-view")).toHaveAttribute("data-state", "current");
  await settled(page);
  return fixture;
}

async function openDialog(
  page: Page,
  store: ChannelStore,
  myRole: MyRole = "owner",
  theme: "light" | "dark" = "dark",
): Promise<Fixture> {
  const fixture = await openSettings(page, store, myRole, theme);
  await page.getByTestId("chat-settings-row-channels").click();
  await expect(page.getByTestId("channel-manage-dialog")).toBeVisible();
  return fixture;
}

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

test("a member is offered nothing: the row is not there to press", async ({ page }) => {
  // A control the database will refuse is worse than no control. «admins manage
  // topics» is `is_chat_admin(chat_id)` FOR ALL, which `canManageChannels`
  // mirrors exactly, so a member gets no row rather than a refused dialog.
  //
  // The settings screen itself is unreachable for a member — the pencil that
  // opens it belongs to `canEditChatProfile` — but `ChatSettingsView` is
  // **mounted** behind the card either way, parked and inert rather than
  // absent. So a count of zero here is this row's own gate answering, not the
  // pencil's: an unguarded row would be in the document and merely off-screen.
  await openInfo(page, seedStore(), "member", "dark");
  await expect(page.getByTestId("chat-info-settings-view")).toHaveCount(1);
  await expect(page.getByLabel("Редактировать")).toHaveCount(0);
  await expect(page.getByTestId("chat-settings-row-channels")).toHaveCount(0);
});

test("an administrator sees every channel grouped the way the rail draws them", async ({ page }, info) => {
  await openDialog(page, seedStore(), "admin");

  // Exactly one dialog, with two hosts mounted. `ChatWindow` renders a host
  // beside the rail and the settings screen renders another, and the request
  // goes out as an event both are listening to; only the one that registered
  // first acts. Two would stack identical sheets on each other, and on a phone
  // the one underneath would still take taps.
  await expect(page.getByTestId("channel-manage-dialog")).toHaveCount(1);

  const groups = page.getByTestId("channel-manage-group");
  await expect(groups).toHaveCount(2);
  // Uncategorised first, above every heading: that is where a server puts them
  // and where a channel whose heading was just deleted has to appear.
  await expect(groups.nth(0).getByTestId("channel-manage-group-name")).toHaveText("Без раздела");
  await expect(groups.nth(1).getByTestId("channel-manage-group-name")).toHaveText("Голос");

  await expect(groups.nth(0).getByTestId("channel-row-name")).toHaveText(["Общий", "Релизы"]);
  await expect(groups.nth(1).getByTestId("channel-row-name")).toHaveText(["Переговорная", "Отдых"]);

  // A room says what it is: its seats, and who may speak when that is narrower
  // than the group.
  const rooms = groups.nth(1).getByTestId("channel-row-summary");
  await expect(rooms.nth(0)).toHaveText("10 мест");
  await expect(rooms.nth(1)).toHaveText("5 мест · Только администраторы");

  await shoot(page, shotPath(info, "list"));
});

test("the general channel is offered no removal, and every other one is", async ({ page }) => {
  await openDialog(page, seedStore());
  const rowsLocator = page.getByTestId("channel-manage-row");
  const general = rowsLocator.filter({ has: page.getByText("Общий", { exact: true }) });
  await expect(general.getByTestId("channel-remove")).toHaveCount(0);
  await expect(general.getByTestId("channel-row-summary")).toHaveText("Основной канал группы");
  // The column the missing control would have filled stays open, so the rows of
  // one list keep their four columns in line. Photographed at 390 before this:
  // the general channel's pencil sat where every other row's ✕ sits.
  const generalSlot = general.getByTestId("channel-action-slot").last();
  const releasesRemove = rowsLocator
    .filter({ has: page.getByText("Релизы", { exact: true }) })
    .getByTestId("channel-remove");
  // Measured under `toPass`, not once. The dialog is still settling when it
  // becomes visible — the sheet's entrance, and a web font that has not swapped
  // in yet — and a single `boundingBox()` taken in that window measures a
  // layout nobody sees. It retries the measurement, not the contract: columns
  // that never line up still fail.
  await expect(async () => {
    const slotBox = await generalSlot.boundingBox();
    const removeBox = await releasesRemove.boundingBox();
    expect(slotBox, "the general channel has no held-open column").not.toBeNull();
    expect(removeBox, "the other channel has no removal control").not.toBeNull();
    expect(
      Math.abs(slotBox!.x - removeBox!.x),
      `the held-open column is at ${slotBox!.x} and the removal it stands in for is at ${removeBox!.x}`,
    ).toBeLessThanOrEqual(1);
  }).toPass({ timeout: 5000 });

  const releases = rowsLocator.filter({ has: page.getByText("Релизы", { exact: true }) });
  await expect(releases.getByTestId("channel-remove")).toHaveCount(1);
});

test("a second voice room is one form away, and the insert carries its heading", async ({ page }, info) => {
  const store = seedStore();
  const fixture = await openDialog(page, store);

  await page.getByTestId("channel-create-open").click();
  const form = page.getByTestId("channel-create-form");
  await expect(form).toBeVisible();
  await form.getByTestId("channel-create-kind-voice").click();
  await form.getByTestId("channel-create-name").fill("Планёрка");
  await form.getByTestId("channel-create-category").selectOption(CAT_VOICE);

  // The two settings a room has appear the moment it is a room, and the note
  // that keeps a restricted room from reading as a closed one appears with the
  // setting that restricts it.
  await expect(form.getByTestId("channel-create-seats")).toBeVisible();
  await expect(form.getByTestId("channel-create-listeners-note")).toHaveCount(0);
  await form.getByTestId("channel-create-speak-admin").click();
  await expect(form.getByTestId("channel-create-listeners-note")).toHaveText(
    "Остальные смогут зайти и слушать.",
  );

  await shoot(page, shotPath(info, "create-voice"));

  await form.getByTestId("channel-create-submit").click();
  await expect(page.getByTestId("channel-create-form")).toHaveCount(0);

  const inserts = fixture.restCalls("voice_channels", "POST");
  expect(inserts).toHaveLength(1);
  expect(inserts[0].body).toMatchObject({
    chat_id: CHAT_TEAM,
    name: "Планёрка",
    category_id: CAT_VOICE,
    // One past the last, not the count: the two rooms sit at 0 and 4, so the
    // count would be 2 — a position one of them already holds.
    position: 5,
  });
  // Nothing was inserted into `topics`: the kind picker decides the table.
  expect(fixture.restCalls("topics", "POST")).toHaveLength(0);

  const voiceGroup = page.getByTestId("channel-manage-group").nth(1);
  await expect(voiceGroup.getByTestId("channel-row-name")).toHaveText([
    "Переговорная",
    "Отдых",
    "Планёрка",
  ]);
});

test("a room's seats and who may speak are saved as the columns that hold them", async ({ page }, info) => {
  const store = seedStore();
  const fixture = await openDialog(page, store);

  const meeting = page
    .getByTestId("channel-manage-row")
    .filter({ has: page.getByText("Переговорная", { exact: true }) });
  await meeting.getByTestId("channel-edit").click();
  const form = page.getByTestId("channel-edit-form");
  await expect(form).toBeVisible();
  await expect(form.getByTestId("channel-edit-seats")).toHaveValue("10");
  await form.getByTestId("channel-edit-seats").fill("4");
  await form.getByTestId("channel-edit-speak-owner").click();

  await shoot(page, shotPath(info, "voice-settings"));

  await form.getByTestId("channel-edit-submit").click();
  await expect(page.getByTestId("channel-edit-form")).toHaveCount(0);

  const patches = fixture.restCalls("voice_channels", "PATCH");
  const settings = patches.filter((call) => {
    const sent = call.body as Record<string, unknown> | null;
    return Boolean(sent && ("max_participants" in sent || "speak_role" in sent));
  });
  expect(settings).toHaveLength(1);
  expect(settings[0].body).toMatchObject({ max_participants: 4, speak_role: "owner" });
  expect(settings[0].search).toContain(`id=eq.${VOICE_MEETING}`);

  await expect(meeting.getByTestId("channel-row-summary")).toHaveText("4 места · Только владелец");
});

test("a seat count outside the product's bounds is clamped before it is written", async ({ page }) => {
  const store = seedStore();
  const fixture = await openDialog(page, store);

  const lounge = page
    .getByTestId("channel-manage-row")
    .filter({ has: page.getByText("Отдых", { exact: true }) });
  await lounge.getByTestId("channel-edit").click();
  // 999 is storable in a smallint and unservable by any room, and 0 is the one
  // value whose meaning at the gateway has not been measured. Neither reaches
  // the column.
  await page.getByTestId("channel-edit-seats").fill("999");
  await page.getByTestId("channel-edit-submit").click();
  await expect(page.getByTestId("channel-edit-form")).toHaveCount(0);

  const written = fixture
    .restCalls("voice_channels", "PATCH")
    .map((call) => (call.body as Record<string, unknown>)?.max_participants)
    .filter((value) => value !== undefined);
  expect(written).toEqual([99]);
});

test("removing a heading keeps its rooms, says so first, and uncategorises them", async ({ page }, info) => {
  const store = seedStore();
  const fixture = await openDialog(page, store);

  const voiceGroup = page.getByTestId("channel-manage-group").nth(1);
  await voiceGroup.getByTestId("category-remove").click();

  const question = page.getByRole("dialog").filter({ hasText: "Удалить раздел?" });
  await expect(question).toBeVisible();
  // `on delete set null (category_id)`: the rooms survive. A question that did
  // not say so would be asking permission for something worse than what
  // happens.
  await expect(question).toContainText("2 канала из него останутся на месте");
  await shoot(page, shotPath(info, "category-removal"));
  await question.getByRole("button", { name: "Удалить" }).click();

  // The visible outcome first. The confirmation resolves a promise and the
  // write leaves afterwards, so reading the recorded requests straight after
  // the click reads them before the request exists — which is a green test
  // waiting to be written the wrong way round.
  //
  // One group left, and both rooms are in it rather than gone with the heading.
  const groups = page.getByTestId("channel-manage-group");
  await expect(groups).toHaveCount(1);
  await expect(groups.nth(0).getByTestId("channel-manage-group-name")).toHaveText("Без раздела");
  await expect(groups.nth(0).getByTestId("channel-row-name")).toHaveText([
    "Общий",
    "Релизы",
    "Переговорная",
    "Отдых",
  ]);

  const deletes = fixture.restCalls("chat_channel_categories", "DELETE");
  expect(deletes).toHaveLength(1);
  expect(deletes[0].search).toContain(`id=eq.${CAT_VOICE}`);
});

test("removing a channel archives it rather than deleting anything", async ({ page }) => {
  const store = seedStore();
  const fixture = await openDialog(page, store);

  const releases = page
    .getByTestId("channel-manage-row")
    .filter({ has: page.getByText("Релизы", { exact: true }) });
  await releases.getByTestId("channel-remove").click();

  const question = page.getByRole("dialog").filter({ hasText: "Убрать канал?" });
  await expect(question).toBeVisible();
  await expect(question).toContainText("сообщения в нём не удаляются");
  await question.getByRole("button", { name: "Убрать" }).click();

  await expect(page.getByTestId("channel-manage-row")).toHaveCount(3);
  // The one action whose result is not visible in the list says so out loud.
  await expect(page.getByTestId("kub-feedback-viewport")).toContainText("Канал убран");

  // `archived = true`, and no DELETE anywhere near `topics`.
  const patches = fixture.restCalls("topics", "PATCH");
  expect(patches).toHaveLength(1);
  expect(patches[0].body).toMatchObject({ archived: true });
  expect(patches[0].search).toContain(`id=eq.${TOPIC_RELEASES}`);
  expect(fixture.restCalls("topics", "DELETE")).toHaveLength(0);
});

test("a reorder writes positions, and a move that cannot happen writes nothing", async ({ page }) => {
  const store = seedStore();
  const fixture = await openDialog(page, store);

  const loose = page.getByTestId("channel-manage-group").nth(0);
  const general = loose.getByTestId("channel-manage-row").nth(0);
  // The first row of a run has nowhere above it, so no control is drawn — and
  // the column it would have filled is held open, or the four action columns
  // of one list stop lining up with each other.
  await expect(general.getByTestId("channel-up")).toHaveCount(0);
  await expect(general.getByTestId("channel-action-slot")).toHaveCount(2);
  await expect(loose.getByTestId("channel-manage-row").nth(1).getByTestId("channel-up")).toHaveCount(1);

  await general.getByTestId("channel-down").click();
  await expect(loose.getByTestId("channel-row-name")).toHaveText(["Релизы", "Общий"]);

  const patches = fixture.restCalls("topics", "PATCH");
  // Two rows change and both are written; the whole run is renumbered from zero
  // rather than nudged.
  expect(patches).toHaveLength(2);
  const written = patches.map((call) => ({
    position: (call.body as Record<string, unknown>).position,
    id: /id=eq\.([0-9a-f-]+)/.exec(call.search)?.[1],
  }));
  expect(written).toEqual([
    { id: TOPIC_RELEASES, position: 0 },
    { id: TOPIC_GENERAL, position: 1 },
  ]);
});

test("no write ever reaches voice_participants", async ({ page }) => {
  const store = seedStore();
  const fixture = await openDialog(page, store);

  // Touch every verb the dialog has that could plausibly reach for it.
  await page.getByTestId("channel-create-open").click();
  await page.getByTestId("channel-create-kind-voice").click();
  await page.getByTestId("channel-create-name").fill("Планёрка");
  await page.getByTestId("channel-create-submit").click();
  await expect(page.getByTestId("channel-create-form")).toHaveCount(0);

  // Located by id rather than by the name on it: this test renames the room
  // and then removes it, and a locator keyed on the old text would go stale
  // between the two — which is a timeout that reads like a broken control.
  const lounge = page.locator(`[data-testid="channel-manage-row"][data-channel-id="${VOICE_LOUNGE}"]`);
  await lounge.getByTestId("channel-edit").click();
  await page.getByTestId("channel-edit-name").fill("Отдых и кофе");
  await page.getByTestId("channel-edit-submit").click();
  await expect(page.getByTestId("channel-edit-form")).toHaveCount(0);
  await expect(lounge.getByTestId("channel-row-name")).toHaveText("Отдых и кофе");

  await lounge.getByTestId("channel-remove").click();
  await page.getByRole("dialog").filter({ hasText: "Убрать комнату?" }).getByRole("button", { name: "Убрать" }).click();
  await expect(page.getByTestId("kub-feedback-viewport")).toContainText("Комната убрана");

  // The table has no INSERT, UPDATE or DELETE policy at all, so any of these
  // would be refused in production and the refusal would arrive as a dead
  // button rather than as an error anybody reads.
  const writes = fixture.requests.filter(
    (entry) => entry.resource === "voice_participants" && entry.method !== "GET" && entry.method !== "OPTIONS",
  );
  expect(writes).toHaveLength(0);
});

test("a heading is made without touching a single channel", async ({ page }, info) => {
  const store = seedStore();
  const fixture = await openDialog(page, store);

  await page.getByTestId("category-create-open").click();
  const form = page.getByTestId("category-create-form");
  await expect(form).toBeVisible();
  await form.getByTestId("category-create-form-name").fill("  Работа   и   планы  ");
  await shoot(page, shotPath(info, "create-category"));
  await form.getByTestId("category-create-form-submit").click();
  await expect(page.getByTestId("category-create-form")).toHaveCount(0);

  const inserts = fixture.restCalls("chat_channel_categories", "POST");
  expect(inserts).toHaveLength(1);
  // Runs of whitespace collapse and the ends are trimmed, because
  // `chat_channel_categories_name_length` counts `btrim(name)` and a heading of
  // three spaces is a heading nobody typed.
  expect(inserts[0].body).toMatchObject({ chat_id: CHAT_TEAM, name: "Работа и планы", position: 1 });
  expect(fixture.restCalls("topics", "PATCH")).toHaveLength(0);
  expect(fixture.restCalls("voice_channels", "PATCH")).toHaveLength(0);

  await expect(page.getByTestId("channel-manage-group")).toHaveCount(3);
  await expect(
    page.getByTestId("channel-manage-group").nth(2).getByTestId("channel-manage-group-name"),
  ).toHaveText("Работа и планы");
});

test("the dialog is readable in the light theme too", async ({ page }, info) => {
  await openDialog(page, seedStore(), "owner", "light");
  await expect(page.getByTestId("channel-manage-dialog")).toBeVisible();
  await expect(page.getByTestId("channel-manage-row")).toHaveCount(4);
  await shoot(page, shotPath(info, "light-list"));
  await page.getByTestId("channel-create-open").click();
  await expect(page.getByTestId("channel-create-form")).toBeVisible();
  await page.getByTestId("channel-create-kind-voice").click();
  await page.getByTestId("channel-create-speak-admin").click();
  await shoot(page, shotPath(info, "light-create"));
});
