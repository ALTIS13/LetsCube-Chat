import { expect, type Page, type TestInfo, test } from "@playwright/test";
import {
  chat,
  membership,
  message,
  missingFunction,
  openFixture,
  person,
  type Row,
} from "./helpers/messageActionsFixture";

/**
 * The record a one-to-one call leaves in the conversation — slice B of
 * `docs/proposals/2026-09-18-one-to-one-calls.md`.
 *
 * What is real here and what is not, so nothing below is read as proving more
 * than it does.
 *
 * **Real:** `MessageList` as it ships, its system-message branch, the chat
 * list's preview, and `lib/callRecord.ts` deciding every word of it. The rows
 * are seeded as `messages` rows carrying exactly the `system_payload`
 * `voice_call_stop` writes, so a change to that parser turns these red.
 *
 * **Stubbed:** the four `SECURITY DEFINER` functions, as route mocks — they are
 * applied and verified on production and there is nothing at `127.0.0.1:54321`
 * to answer. The call back is measured on **what was sent**, not on what a
 * mocked ring then did with it.
 *
 * Everything runs on the message-actions fixture: fictional people, a mocked
 * backend, no production screen.
 */

const AT = "2026-09-13T09:00:00.000Z";
const ME = person("11111111-1111-4111-8111-000000000001", "Максим Орлов");
const ANNA = person("11111111-1111-4111-8111-000000000002", "Анна Смирнова");
const PETR = person("11111111-1111-4111-8111-000000000003", "Пётр Ильин");
/** A private conversation Anna opened, so she is its `owner` and I am a `member`. */
const CHAT_PRIVATE = "22222222-2222-4222-8222-000000000011";
const CHAT_TEAM = "22222222-2222-4222-8222-000000000012";
const ROOM = "33333333-3333-4333-8333-000000000011";
const LINE = "Привет, посмотри смету";
const TEAM_LINE = "Макет главной готов";

type Outcome = "answered" | "missed" | "cancelled" | "declined";

/**
 * A call record as the database writes one.
 *
 * `content` is the neutral sentence `voice_call_record_line` produces, written
 * out here rather than computed, so a test that expected the card and got the
 * fallback says which sentence it got. These are the migration's own self-check
 * values.
 */
function callRow(
  id: string,
  caller: typeof ME,
  outcome: Outcome,
  createdAt: string,
  over: { durationMs?: number | null; content?: string; payload?: unknown; chatId?: string } = {},
): Row {
  const content =
    over.content ??
    (outcome === "answered"
      ? over.durationMs
        ? "Звонок, 3 мин 12 с"
        : "Звонок"
      : outcome === "missed"
        ? "Пропущенный звонок"
        : outcome === "declined"
          ? "Звонок отклонён"
          : "Отменённый звонок");
  const payload =
    "payload" in over
      ? over.payload
      : {
          kind: "call",
          outcome,
          caller: caller.id,
          duration_ms: outcome === "answered" ? (over.durationMs ?? null) : null,
        };
  return {
    ...message(id, over.chatId ?? CHAT_PRIVATE, ME, content, createdAt),
    type: "system",
    user_id: null,
    sender: null,
    system_payload: payload,
  };
}

/** The group-call line of D-229: a system row with no payload at all. */
function groupCallRow(id: string, createdAt: string, chatId = CHAT_TEAM): Row {
  return {
    ...message(id, chatId, PETR, "Начался разговор в канале «Общий»", createdAt),
    type: "system",
    user_id: null,
    sender: null,
    system_payload: null,
  };
}

interface Seed {
  theme?: "light" | "dark";
  /** Extra rows beyond the one text message each conversation carries. */
  rows?: Row[];
}

interface Harness {
  rpcCalls: { name: string; body: Row }[];
}

async function open(page: Page, seed: Seed = {}): Promise<Harness> {
  const rpcCalls: { name: string; body: Row }[] = [];
  await openFixture(page, {
    me: ME,
    people: [ANNA, PETR],
    chats: [
      chat(CHAT_PRIVATE, "private", null, AT),
      chat(CHAT_TEAM, "group", "Команда проекта", AT),
    ],
    memberships: [
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
      ...(seed.rows ?? []),
    ],
    rpc: (name, body) => {
      if (name === "search_chat_messages") return missingFunction(name);
      if (name === "voice_call_ring") {
        rpcCalls.push({ name, body });
        return { body: [{ channel_id: ROOM, ring_started_at: new Date().toISOString() }] };
      }
      if (
        name === "voice_private_room" ||
        name === "voice_call_stop" ||
        name === "voice_call_answer"
      ) {
        rpcCalls.push({ name, body });
        return { body: null };
      }
      return undefined;
    },
  });
  if (seed.theme) {
    // After `openFixture`, which writes «dark» in an init script of its own:
    // init scripts run in registration order and the later write wins.
    await page.addInitScript(
      (value) => localStorage.setItem("kub-theme", value as string),
      seed.theme,
    );
  }
  await page.route(/\/rest\/v1\/voice_channels/, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route(/\/rest\/v1\/voice_participants/, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  return { rpcCalls };
}

/** Open a conversation and wait for its last line, whatever kind of line it is. */
async function enter(page: Page, chatName: string) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const row = page.getByTestId("chat-list-item").filter({ hasText: chatName });
  await expect(row).toBeVisible();
  await row.click();
}

const records = (page: Page) => page.locator('[data-call-record="true"]');
const notices = (page: Page) => page.locator("[data-system-message]");

// ---------------------------------------------------------------------------
// The four outcomes, from both ends of the same row
// ---------------------------------------------------------------------------

const FOUR: { outcome: Outcome; mine: string; theirs: string }[] = [
  { outcome: "answered", mine: "Исходящий звонок", theirs: "Входящий звонок" },
  { outcome: "missed", mine: "Звонок без ответа", theirs: "Пропущенный звонок" },
  { outcome: "cancelled", mine: "Отменённый звонок", theirs: "Пропущенный звонок" },
  { outcome: "declined", mine: "Звонок отклонён", theirs: "Вы отклонили звонок" },
];

test("one row, two readers: the call I made and the call they made read differently", async ({
  page,
}) => {
  await open(page, {
    rows: FOUR.flatMap((entry, index) => [
      callRow(
        `66666666-6666-4666-8666-00000000001${index}`,
        ME,
        entry.outcome,
        `2026-09-13T11:0${index}:00.000Z`,
        {
          durationMs: entry.outcome === "answered" ? 192_000 : null,
        },
      ),
      callRow(
        `66666666-6666-4666-8666-00000000002${index}`,
        ANNA,
        entry.outcome,
        `2026-09-13T12:0${index}:00.000Z`,
        {
          durationMs: entry.outcome === "answered" ? 192_000 : null,
        },
      ),
    ]),
  });
  await enter(page, "Анна Смирнова");
  await expect(records(page)).toHaveCount(8);

  // The conversation is ordered by `created_at`, so the four I made come first
  // and the four they made follow — not interleaved, whatever order they were
  // seeded in.
  for (const [index, entry] of FOUR.entries()) {
    const mine = records(page).nth(index);
    const theirs = records(page).nth(FOUR.length + index);
    await expect(mine).toHaveAttribute("data-call-direction", "outgoing");
    await expect(mine).toHaveAttribute("data-call-outcome", entry.outcome);
    await expect(mine.locator("[data-call-record-headline]")).toHaveText(entry.mine);
    await expect(theirs).toHaveAttribute("data-call-direction", "incoming");
    await expect(theirs.locator("[data-call-record-headline]")).toHaveText(entry.theirs);
  }
});

test("red is spent once: a call that came here and got no answer from here", async ({ page }) => {
  await open(page, {
    rows: FOUR.flatMap((entry, index) => [
      callRow(
        `66666666-6666-4666-8666-00000000001${index}`,
        ME,
        entry.outcome,
        `2026-09-13T11:0${index}:00.000Z`,
      ),
      callRow(
        `66666666-6666-4666-8666-00000000002${index}`,
        ANNA,
        entry.outcome,
        `2026-09-13T12:0${index}:00.000Z`,
      ),
    ]),
  });
  await enter(page, "Анна Смирнова");
  await expect(records(page)).toHaveCount(8);

  // Exactly the two cells that say «Пропущенный звонок»: they rang, and this
  // reader neither answered nor refused. A call you declined is not one you
  // missed, and one you cancelled yourself is not a failure of any kind.
  const missed = page.locator('[data-call-missed="true"]');
  await expect(missed).toHaveCount(2);
  for (const nth of [0, 1]) {
    await expect(missed.nth(nth)).toHaveAttribute("data-call-direction", "incoming");
    await expect(missed.nth(nth).locator("[data-call-record-headline]")).toHaveText(
      "Пропущенный звонок",
    );
  }
  // And the colour is really on the words, not only in the attribute.
  const colour = await missed
    .first()
    .locator("[data-call-record-headline]")
    .evaluate((node) => getComputedStyle(node.parentElement as Element).color);
  const plain = await records(page)
    .nth(0)
    .locator("[data-call-record-headline]")
    .evaluate((node) => getComputedStyle(node.parentElement as Element).color);
  expect(colour).not.toBe(plain);
});

test("an answered call says how long, in the units the sentence beneath it uses", async ({
  page,
}) => {
  await open(page, {
    rows: [
      callRow(
        "66666666-6666-4666-8666-000000000031",
        ANNA,
        "answered",
        "2026-09-13T11:00:00.000Z",
        {
          durationMs: 192_000,
        },
      ),
      // Answered and hung up inside a second. The database says «Звонок» and
      // shows no length; so does this.
      callRow(
        "66666666-6666-4666-8666-000000000032",
        ANNA,
        "answered",
        "2026-09-13T11:05:00.000Z",
        {
          durationMs: 400,
          content: "Звонок",
        },
      ),
      callRow("66666666-6666-4666-8666-000000000033", ANNA, "missed", "2026-09-13T11:10:00.000Z"),
    ],
  });
  await enter(page, "Анна Смирнова");
  await expect(records(page).nth(0).locator("[data-call-record-duration]")).toHaveText(
    "3 мин 12 с",
  );
  await expect(records(page).nth(1).locator("[data-call-record-duration]")).toHaveCount(0);
  await expect(records(page).nth(2).locator("[data-call-record-duration]")).toHaveCount(0);
  // The accessible name says the same length in words, because «три мин
  // двенадцать с» is not a sentence.
  await expect(records(page).nth(0).getByTestId("call-record-back")).toHaveAttribute(
    "aria-label",
    "Входящий звонок, 3 минуты 12 секунд. Позвонить",
  );
});

// ---------------------------------------------------------------------------
// What a payload this bundle cannot read does, and what it must not disturb
// ---------------------------------------------------------------------------

test("a payload this bundle cannot read renders the sentence the database wrote", async ({
  page,
}) => {
  await open(page, {
    rows: [
      // A `kind` from a newer deployment.
      callRow("66666666-6666-4666-8666-000000000041", ANNA, "missed", "2026-09-13T11:00:00.000Z", {
        payload: { kind: "poll", outcome: "missed", caller: ANNA.id, duration_ms: null },
        content: "Пропущенный звонок",
      }),
      // An outcome this bundle does not know.
      callRow("66666666-6666-4666-8666-000000000042", ANNA, "missed", "2026-09-13T11:01:00.000Z", {
        payload: { kind: "call", outcome: "ringing", caller: ANNA.id, duration_ms: null },
        content: "Пропущенный звонок",
      }),
      // No identity, so no direction, so no card.
      callRow("66666666-6666-4666-8666-000000000043", ANNA, "missed", "2026-09-13T11:02:00.000Z", {
        payload: { kind: "call", outcome: "missed", caller: null, duration_ms: null },
        content: "Пропущенный звонок",
      }),
      // Not an object at all.
      callRow(
        "66666666-6666-4666-8666-000000000044",
        ANNA,
        "answered",
        "2026-09-13T11:03:00.000Z",
        {
          payload: "call",
          content: "Звонок, 3 мин 12 с",
        },
      ),
    ],
  });
  await enter(page, "Анна Смирнова");
  await expect(notices(page)).toHaveCount(4);
  // Not one card, and not one empty chip: four complete sentences, which is
  // exactly what a bundle older than this branch renders.
  await expect(records(page)).toHaveCount(0);
  for (const [index, text] of [
    "Пропущенный звонок",
    "Пропущенный звонок",
    "Пропущенный звонок",
    "Звонок, 3 мин 12 с",
  ].entries()) {
    await expect(notices(page).nth(index)).toHaveText(text);
  }
});

test("a group's call line is untouched by any of this", async ({ page }) => {
  // D-229 writes its own system message from a trigger, with no payload. It is
  // the regression this slice is most likely to cause, so it is asserted in the
  // conversation it lives in rather than argued about.
  await open(page, {
    rows: [
      groupCallRow("66666666-6666-4666-8666-000000000051", "2026-09-13T11:00:00.000Z"),
      {
        ...groupCallRow("66666666-6666-4666-8666-000000000052", "2026-09-13T11:20:00.000Z"),
        content: "Разговор в канале «Общий» закончился",
      },
    ],
  });
  await enter(page, "Команда проекта");
  await expect(notices(page)).toHaveCount(2);
  await expect(records(page)).toHaveCount(0);
  await expect(notices(page).nth(0)).toHaveText("Начался разговор в канале «Общий»");
  await expect(notices(page).nth(1)).toHaveText("Разговор в канале «Общий» закончился");
});

// ---------------------------------------------------------------------------
// The chat list
// ---------------------------------------------------------------------------

test("the list says which call it was, from the reader's own side", async ({ page }) => {
  await open(page, {
    rows: [
      callRow("66666666-6666-4666-8666-000000000061", ANNA, "missed", "2026-09-13T13:00:00.000Z"),
      groupCallRow("66666666-6666-4666-8666-000000000062", "2026-09-13T13:05:00.000Z"),
    ],
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const privateRow = page.getByTestId("chat-list-item").filter({ hasText: "Анна Смирнова" });
  await expect(privateRow).toContainText("Пропущенный звонок");
  // The group's row still prints what the trigger wrote, which is the same
  // fallback the conversation uses.
  await expect(
    page.getByTestId("chat-list-item").filter({ hasText: "Команда проекта" }),
  ).toContainText("Начался разговор в канале «Общий»");
});

test("the same row in the list reads the other way for the person who rang", async ({ page }) => {
  await open(page, {
    rows: [
      callRow("66666666-6666-4666-8666-000000000071", ME, "answered", "2026-09-13T13:00:00.000Z", {
        durationMs: 192_000,
      }),
    ],
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  // «Исходящий», not the `content` «Звонок, 3 мин 12 с» — so the preview really
  // is reading the payload against the reader rather than printing the row.
  await expect(
    page.getByTestId("chat-list-item").filter({ hasText: "Анна Смирнова" }),
  ).toContainText("Исходящий звонок");
});

// ---------------------------------------------------------------------------
// Calling back
// ---------------------------------------------------------------------------

test("a call record rings the same person again", async ({ page }) => {
  const harness = await open(page, {
    rows: [
      callRow("66666666-6666-4666-8666-000000000081", ANNA, "missed", "2026-09-13T11:00:00.000Z"),
    ],
  });
  await enter(page, "Анна Смирнова");
  const back = records(page).getByTestId("call-record-back");
  await expect(back).toHaveAttribute("aria-label", "Пропущенный звонок. Позвонить");
  await back.click();
  // Measured on what was sent, and only on the part this slice owns: one
  // `voice_call_ring` for this conversation, as the press.
  //
  // What follows it is slice A's and is deliberately not asserted here. This
  // fixture has no microphone and no gateway, so `startVoiceRing` goes on to
  // fail its join and cancel the ring it just started — correctly, because a
  // caller who cannot hear anything must not leave the other side ringing. An
  // assertion on the whole list would be an assertion about that, and it was
  // flaky for exactly that reason: green at 1440 and red at 390, on which of
  // the two round trips landed first.
  await expect
    .poll(() => harness.rpcCalls.filter((call) => call.name === "voice_call_ring").length, {
      timeout: 10_000,
    })
    .toBe(1);
  expect(harness.rpcCalls[0].name).toBe("voice_call_ring");
  expect(harness.rpcCalls[0].body).toEqual({ p_chat_id: CHAT_PRIVATE });
});

test("a call that failed is not a call, so the second press rings again", async ({ page }) => {
  // The guard this surface owns, from the side that is cheap to reach. This
  // fixture has no microphone and no gateway, so the first press rings, fails
  // its join and cancels itself — leaving `useVoiceCall` holding
  // `{ phase: "failed", channelId }`, because the interface has to be able to
  // name the call that was refused.
  //
  // A guard written as «channelId is set» would refuse from here on, and every
  // call back in the product would answer «Вы в другом голосовом чате» until
  // the page was reloaded. The second ring below is what proves it does not.
  const harness = await open(page, {
    rows: [
      callRow("66666666-6666-4666-8666-0000000000d1", ANNA, "missed", "2026-09-13T11:00:00.000Z"),
    ],
  });
  await enter(page, "Анна Смирнова");
  const back = records(page).getByTestId("call-record-back");
  await back.click();
  await expect
    .poll(() => harness.rpcCalls.filter((call) => call.name === "voice_call_stop").length, {
      timeout: 10_000,
    })
    .toBe(1);

  await back.click();
  await expect
    .poll(() => harness.rpcCalls.filter((call) => call.name === "voice_call_ring").length, {
      timeout: 10_000,
    })
    .toBe(2);
});

test("a group's call line is not a button, because there is nobody to ring", async ({ page }) => {
  // A one-to-one call is a private chat's, and a group has no second
  // participant to name. The row is still a record; it is simply not a control.
  await open(page, {
    rows: [groupCallRow("66666666-6666-4666-8666-000000000091", "2026-09-13T11:00:00.000Z")],
  });
  await enter(page, "Команда проекта");
  await expect(notices(page)).toHaveCount(1);
  await expect(page.getByTestId("call-record-back")).toHaveCount(0);
});

test("a call record where there is nobody to ring is a record, not a control", async ({ page }) => {
  // The database cannot write this: `voice_call_stop` runs on a ring, and a
  // ring only exists in a private chat. It is seeded anyway, because the
  // previous test proves nothing about the offer — a group's line has no
  // payload, so it never reaches the card at all, and the mutation that hands
  // every system row the press came back green against it.
  //
  // Three people and no single «other», so the card draws and the tap does not.
  await open(page, {
    rows: [
      callRow("66666666-6666-4666-8666-0000000000e1", ANNA, "missed", "2026-09-13T11:00:00.000Z", {
        chatId: CHAT_TEAM,
      }),
    ],
  });
  await enter(page, "Команда проекта");
  await expect(records(page)).toHaveCount(1);
  await expect(records(page).locator("[data-call-record-headline]")).toHaveText(
    "Пропущенный звонок",
  );
  await expect(page.getByTestId("call-record-back")).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// The pixels
// ---------------------------------------------------------------------------

for (const theme of ["dark", "light"] as const) {
  test(`what a call record looks like, ${theme}`, async ({ page }, info: TestInfo) => {
    // A test per theme rather than a restamp inside one: the theme is read from
    // storage at boot, and stamping the DOM afterwards produces a hybrid — the
    // tokens move while React still holds the old theme.
    //
    // Both sides of all four outcomes in one frame, with a group's call line
    // above them, so the two kinds of system row are photographed together.
    await open(page, {
      theme,
      rows: [
        groupCallRow(
          "66666666-6666-4666-8666-0000000000a0",
          "2026-09-13T10:30:00.000Z",
          CHAT_PRIVATE,
        ),
        ...FOUR.flatMap((entry, index) => [
          callRow(
            `66666666-6666-4666-8666-0000000000b${index}`,
            ME,
            entry.outcome,
            `2026-09-13T11:0${index}:00.000Z`,
            {
              durationMs: entry.outcome === "answered" ? 192_000 : null,
            },
          ),
          callRow(
            `66666666-6666-4666-8666-0000000000c${index}`,
            ANNA,
            entry.outcome,
            `2026-09-13T12:0${index}:00.000Z`,
            {
              durationMs: entry.outcome === "answered" ? 192_000 : null,
            },
          ),
        ]),
      ],
    });
    await enter(page, "Анна Смирнова");
    await expect(records(page)).toHaveCount(8);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: `output/call-record/all-outcomes-${theme}-${info.project.name}.png`,
      fullPage: true,
    });
  });
}
