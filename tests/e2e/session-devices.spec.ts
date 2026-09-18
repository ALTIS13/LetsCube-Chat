import { expect, type Page, type TestInfo, test } from "@playwright/test";

import {
  CHAT_LIST_DEFAULT_WIDTH,
  CHAT_LIST_MAX_WIDTH,
  CHAT_LIST_MIN_WIDTH,
} from "../../artifacts/kub/src/lib/desktopChatList";
import { type Row, requireFixtureServer } from "./helpers/messageActionsFixture";
import {
  openDisclosure,
  openSettingsScreen,
  setColumnWidth,
} from "./helpers/settingsColumnFixture";

/**
 * «Активные сеансы», and the switch that decides whether a device rings.
 *
 * Slice F of `docs/proposals/2026-09-18-one-to-one-calls.md`, client half. The
 * rules are `lib/sessionDevices.ts` and `tests/unit/session-devices.test.mts`
 * holds them; what cannot be asserted there is that they **reach a screen** —
 * that the row is mounted, that the list is drawn in the order the rule gives,
 * that the switch writes what it says it writes and puts itself back when the
 * server refuses. A declaration is not a surface.
 *
 * The other half of the feature — a silenced device getting no ring and no
 * sound — is measured in `tests/e2e/voice-ring.spec.ts`, where the ring lives.
 *
 * **Everything seeded here is invented.** The three database functions are
 * route mocks (they are applied and rehearsed on production, and there is
 * nothing at 127.0.0.1:54321 to answer them), every user agent is a generic
 * published string, and every address is from the documentation ranges of
 * RFC 5737 — `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`, which exist
 * precisely so that no real machine can hold one. `session_devices_list`
 * returns a real address on a real screen; none of it is ever to reach a
 * fixture, a screenshot or a report.
 */

const CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const APK_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
/** A string no pattern in `lib/sessionDevices.ts` recognises, and none should. */
const UNREADABLE = "okhttp/4.12.0";

const DESKTOP = "44444444-4444-4444-8444-000000000001";
const PHONE = "44444444-4444-4444-8444-000000000002";
const TABLET = "44444444-4444-4444-8444-000000000003";
const ODD = "44444444-4444-4444-8444-000000000004";

interface Session {
  session_id: string;
  user_agent: string;
  ip: string;
  created_at: string;
  refreshed_at: string;
  calls_enabled: boolean;
  is_current: boolean;
}

/**
 * Four authorisations, one of them the reader's own.
 *
 * `refreshed_at` is written relative to the moment the test runs, because the
 * line under each name is «how long ago» and a fixed timestamp would make it
 * read «больше месяца назад» on every row the day after this was written.
 */
function seed(options: { currentIndex?: number | null } = {}): Session[] {
  // Which row the reader is looking from, seeded **before** the screen mounts:
  // the list is read once, as the settings column opens, so a fixture edited
  // after that is a fixture nothing has seen.
  const current = options.currentIndex === undefined ? 0 : options.currentIndex;
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
  return [
    {
      session_id: DESKTOP,
      user_agent: CHROME_WINDOWS,
      ip: "198.51.100.24",
      created_at: ago(26 * 24 * 3_600_000),
      refreshed_at: ago(4 * 60_000),
      calls_enabled: true,
      is_current: current === 0,
    },
    {
      session_id: PHONE,
      user_agent: APK_ANDROID,
      ip: "203.0.113.47",
      created_at: ago(20 * 24 * 3_600_000),
      refreshed_at: ago(3 * 3_600_000),
      calls_enabled: false,
      is_current: current === 1,
    },
    {
      session_id: TABLET,
      user_agent: SAFARI_IPHONE,
      ip: "192.0.2.88",
      created_at: ago(12 * 24 * 3_600_000),
      refreshed_at: ago(2 * 24 * 3_600_000),
      calls_enabled: true,
      is_current: current === 2,
    },
    {
      session_id: ODD,
      user_agent: UNREADABLE,
      ip: "198.51.100.7",
      created_at: ago(11 * 24 * 3_600_000),
      refreshed_at: ago(9 * 24 * 3_600_000),
      calls_enabled: true,
      is_current: current === 3,
    },
  ];
}

interface Harness {
  /** The rows the function answers with, which `session_device_set_calls` edits. */
  rows: Session[];
  /** Every write the switch sent, in order. */
  writes: Row[];
  /** Refuse the next write with this body, as PostgREST would. */
  refuse: { body: unknown; status: number } | null;
}

async function open(
  page: Page,
  options: {
    theme?: "dark" | "light";
    /** Which row is «this device»; `null` for a list with none. */
    currentIndex?: number | null;
    webFont?: boolean;
  } = {},
): Promise<Harness> {
  const harness: Harness = {
    rows: seed({ currentIndex: options.currentIndex }),
    writes: [],
    refuse: null,
  };
  await openSettingsScreen(page, {
    theme: options.theme ?? "dark",
    webFont: options.webFont ?? false,
    rpc: (name, body) => {
      if (name === "session_devices_list") return { body: harness.rows };
      if (name === "session_device_set_calls") {
        harness.writes.push(body);
        if (harness.refuse) return harness.refuse;
        const id = body.p_session_id as string;
        const row = harness.rows.find((entry) => entry.session_id === id);
        if (row) row.calls_enabled = body.p_enabled as boolean;
        return { body: body.p_enabled };
      }
      if (name === "voice_calls_allowed_here") return { body: true };
      return undefined;
    },
  });
  return harness;
}

const rows = (page: Page) => page.getByTestId("session-device");

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

test("each device is named, dated and marked, with this one at the top", async ({
  page,
  request,
}) => {
  await requireFixtureServer(request);
  await open(page);
  await openDisclosure(page, "devices");

  await expect(rows(page)).toHaveCount(4);
  // The order is the rule's: this device first, then the most recently seen.
  // The function itself answers newest first, and the fixture's own order puts
  // the current row first already — so the assertion that matters is the next
  // test, where the current row is *not* the newest.
  await expect(page.getByTestId("session-device-title")).toHaveText([
    "Windows · Chrome",
    "Android · приложение",
    "iPhone · Safari",
    "Неизвестное устройство",
  ]);

  // Exactly one «Это устройство», and it is the first row.
  await expect(page.getByTestId("session-device-current")).toHaveCount(1);
  await expect(rows(page).first()).toHaveAttribute("data-current", "true");
  await expect(rows(page).first().getByTestId("session-device-meta")).toContainText(
    "4 минуты назад",
  );
  await expect(rows(page).nth(1).getByTestId("session-device-meta")).toContainText("3 часа назад");
  await expect(rows(page).nth(2).getByTestId("session-device-meta")).toContainText("2 дня назад");
});

test("this device is lifted to the top even when it is not the newest", async ({
  page,
  request,
}) => {
  await requireFixtureServer(request);
  // The oldest row is the one the reader is looking from.
  await open(page, { currentIndex: 3 });
  await openDisclosure(page, "devices");

  await expect(rows(page)).toHaveCount(4);
  await expect(rows(page).first()).toHaveAttribute("data-current", "true");
  await expect(rows(page).first().getByTestId("session-device-title")).toHaveText(
    "Неизвестное устройство",
  );
  // And the rest keep the function's own order behind it.
  await expect(page.getByTestId("session-device-title")).toHaveText([
    "Неизвестное устройство",
    "Windows · Chrome",
    "Android · приложение",
    "iPhone · Safari",
  ]);
});

test("a string nothing recognises says so, and is still shown", async ({ page, request }) => {
  await requireFixtureServer(request);
  await open(page);
  await openDisclosure(page, "devices");

  const odd = rows(page).nth(3);
  await expect(odd.getByTestId("session-device-title")).toHaveText("Неизвестное устройство");
  await expect(odd.getByTestId("session-device-raw")).toHaveText(UNREADABLE);
  // And a device that *was* recognised does not print its string: the name is
  // the answer there, and the raw line would be noise on every row.
  await expect(rows(page).first().getByTestId("session-device-raw")).toHaveCount(0);
});

test("with nothing marked current the list still makes sense", async ({ page, request }) => {
  // The state the migration designed for: an access token with no `session_id`
  // claim. Nothing can be pointed at, every switch still works, and the reason
  // is said rather than left as an unexplained absence.
  await requireFixtureServer(request);
  await open(page, { currentIndex: null });
  await openDisclosure(page, "devices");

  await expect(rows(page)).toHaveCount(4);
  await expect(page.getByTestId("session-device-current")).toHaveCount(0);
  await expect(page.getByTestId("session-devices-no-current")).toBeVisible();
  await expect(page.getByTestId("session-devices-no-current")).toContainText(
    "Не удалось определить",
  );
  // Every switch is still a switch.
  await expect(page.getByTestId("session-device-calls")).toHaveCount(4);
});

test("the mark is absent from a list that has one", async ({ page, request }) => {
  // The other half of the test above, so neither can pass for the wrong reason.
  await requireFixtureServer(request);
  await open(page);
  await openDisclosure(page, "devices");
  await expect(page.getByTestId("session-devices-no-current")).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// The switch
// ---------------------------------------------------------------------------

test("the switch writes for the device it sits on, and moves at once", async ({
  page,
  request,
}) => {
  await requireFixtureServer(request);
  const harness = await open(page);
  await openDisclosure(page, "devices");

  const android = rows(page).nth(1);
  await expect(android).toHaveAttribute("data-calls", "off");
  await android.getByTestId("session-device-calls").click();

  await expect(android).toHaveAttribute("data-calls", "on");
  // The switch moves optimistically — that is the point of it — so the
  // attribute lands a round trip before the write does. Poll for the write.
  await expect.poll(() => harness.writes.length, { timeout: 10_000 }).toBe(1);
  expect(harness.writes).toEqual([{ p_session_id: PHONE, p_enabled: true }]);

  // And off again, for the device the reader is holding.
  await rows(page).first().getByTestId("session-device-calls").click();
  await expect(rows(page).first()).toHaveAttribute("data-calls", "off");
  await expect.poll(() => harness.writes.length, { timeout: 10_000 }).toBe(2);
  expect(harness.writes).toEqual([
    { p_session_id: PHONE, p_enabled: true },
    { p_session_id: DESKTOP, p_enabled: false },
  ]);
});

test("a refused write puts the switch back and says why", async ({ page, request }) => {
  await requireFixtureServer(request);
  const harness = await open(page);
  await openDisclosure(page, "devices");
  // What `session_device_set_calls` raises for a session that is not the
  // caller's own — and for one that does not exist, deliberately identically.
  harness.refuse = {
    status: 400,
    body: { code: "P0002", details: null, hint: null, message: "no_such_device" },
  };

  const iphone = rows(page).nth(2);
  await expect(iphone).toHaveAttribute("data-calls", "on");
  await iphone.getByTestId("session-device-calls").click();

  await expect(
    page.getByText("Этого устройства больше нет в списке — обновите страницу."),
  ).toBeVisible();
  // The switch must not be left showing a state the server refused.
  await expect(iphone).toHaveAttribute("data-calls", "on");
});

test("a list that cannot be read says so instead of showing an empty one", async ({
  page,
  request,
}) => {
  await requireFixtureServer(request);
  const harness: { failed: boolean } = { failed: true };
  await openSettingsScreen(page, {
    rpc: (name) => {
      if (name === "session_devices_list" && harness.failed) {
        return {
          status: 404,
          body: {
            code: "PGRST202",
            details: null,
            hint: null,
            message: "Could not find the function public.session_devices_list in the schema cache",
          },
        };
      }
      return undefined;
    },
  });
  await openDisclosure(page, "devices");

  await expect(page.getByTestId("session-devices-error")).toBeVisible();
  await expect(page.getByTestId("session-devices-error")).toContainText("пока недоступен");
  await expect(rows(page)).toHaveCount(0);
  // And the empty-state sentence is not stacked under the failure: «пусто» and
  // «не удалось прочитать» are different facts.
  await expect(page.getByTestId("session-devices-empty")).toHaveCount(0);
});

test("an empty list explains itself rather than looking broken", async ({ page, request }) => {
  await requireFixtureServer(request);
  await openSettingsScreen(page, {
    rpc: (name) => (name === "session_devices_list" ? { body: [] } : undefined),
  });
  await openDisclosure(page, "devices");

  await expect(page.getByTestId("session-devices-empty")).toBeVisible();
  await expect(page.getByTestId("session-devices-empty")).toContainText("в течение часа");
});

// ---------------------------------------------------------------------------
// What the row says before it is opened, and what the screen does not offer
// ---------------------------------------------------------------------------

test("the closed row counts the devices and the silent ones", async ({ page, request }) => {
  await requireFixtureServer(request);
  await open(page);
  const row = page.getByTestId("settings-open-devices");
  await expect(row).toBeVisible();
  await expect(row).toContainText("Активные сеансы");
  await expect(row).toContainText("4 устройства · без звонков: 1");
});

test("the row is reachable by what a person would type", async ({ page, request }) => {
  // The search field belongs to the settings COLUMN, which exists from md. The
  // sheet below it is the other form of the same screen and has never had one.
  test.skip((page.viewportSize()?.width ?? 0) < 768, "the search field is the column's");
  await requireFixtureServer(request);
  await open(page);
  await page.getByTestId("settings-search-input").fill("устройства");
  await expect(page.getByTestId("settings-open-devices")).toBeVisible();
  await expect(page.getByTestId("settings-search-counter")).toContainText("1 в 1 разделе");
});

test("nothing here offers to end a session", async ({ page, request }) => {
  // Telegram's «Активные сеансы» ends a session from the list; this one does
  // not, by the migration's own decision — signing another device out is a
  // security action with its own failure modes, and what was asked for is the
  // call switch. A test rather than a comment, because scope arrives quietly.
  await requireFixtureServer(request);
  await open(page);
  await openDisclosure(page, "devices");

  const card = page.getByTestId("session-devices-card");
  const text = (await card.textContent()) ?? "";
  for (const word of ["Завершить", "Выйти", "Отключить устройство"]) {
    expect(text, `the section grew «${word}»`).not.toContain(word);
  }
  // The only controls in the block are the switches.
  expect(await card.locator("button").count()).toBe(4);
  expect(await card.locator("button[role='switch']").count()).toBe(4);
});

// ---------------------------------------------------------------------------
// The box this is drawn in, which is not the window (D-222)
// ---------------------------------------------------------------------------

test("no device name is cut off at any width the handle allows", async ({ page, request }) => {
  // The block renders inside the chat-list column, which the owner drags between
  // 260 and 540 points, so no viewport breakpoint can predict its width. The
  // names carry `truncate`, so a cell too narrow for one does not wrap it — the
  // word is simply gone, which is what «Тестиро…» was in D-222.
  test.skip((page.viewportSize()?.width ?? 0) < 768, "the draggable column is the desktop layout");
  await requireFixtureServer(request);
  await open(page);
  await openDisclosure(page, "devices");

  const clipped = () =>
    page.evaluate(() =>
      [
        ...document.querySelectorAll(
          "[data-testid='session-devices-card'] [data-testid='session-device-title']",
        ),
      ]
        .filter((node) => node.scrollWidth > node.clientWidth + 0.5)
        .map((node) => node.textContent ?? ""),
    );

  // And the switch has to stay inside the block rather than being pushed out of
  // it — the failure a fixed-width cell beside flexible text produces.
  const overflowing = () =>
    page.evaluate(() => {
      const card = document.querySelector("[data-testid='session-devices-card']");
      if (!card) throw new Error("the block is not on screen");
      const right = card.getBoundingClientRect().right;
      return [...card.querySelectorAll("[data-testid='session-device-calls']")].filter(
        (node) => node.getBoundingClientRect().right > right + 0.5,
      ).length;
    });

  for (const width of [CHAT_LIST_MIN_WIDTH, CHAT_LIST_DEFAULT_WIDTH, CHAT_LIST_MAX_WIDTH]) {
    await setColumnWidth(page, width);
    expect(await clipped(), `a device name is clipped at a ${width}pt column`).toEqual([]);
    expect(await overflowing(), `a switch is outside the block at ${width}pt`).toBe(0);
  }
});

// ---------------------------------------------------------------------------
// Photographed
// ---------------------------------------------------------------------------

test("photographed", async ({ page, request }, info: TestInfo) => {
  await requireFixtureServer(request);
  for (const theme of ["dark", "light"] as const) {
    await open(page, { theme, webFont: true });
    await openDisclosure(page, "devices");
    await expect(rows(page)).toHaveCount(4);
    await page.evaluate(() => document.fonts.ready);
    await page.getByTestId("session-devices-card").scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);

    // Recorded rather than asserted: a contract must not depend on a font host
    // being reachable, but a screenshot taken without the shipped font is a
    // picture of a different product, so the reader of these files has to know
    // which they are looking at. `document.fonts.check` is not consulted — it
    // answers true for a face that never loaded.
    const interFaces = await page.evaluate(
      () => [...document.fonts].filter((face) => face.status === "loaded").length,
    );
    info.annotations.push({
      type: "font",
      description: `${theme}: ${interFaces} web faces loaded`,
    });

    await page.getByTestId("session-devices-card").screenshot({
      path: `output/session-devices/list-${theme}-${info.project.name}.png`,
    });
    await page.screenshot({
      path: `output/session-devices/screen-${theme}-${info.project.name}.png`,
    });
  }
  info.annotations.push({
    type: "capture",
    description: `output/session-devices/{list,screen}-{dark,light}-${info.project.name}.png`,
  });
});
