import { expect, test, type Page } from "@playwright/test";
import {
  chat,
  membership,
  message,
  openFixture,
  person,
  requireFixtureServer,
  type Fixture,
  type Row,
} from "./helpers/messageActionsFixture";

/**
 * Tracker item 37, first phase: a status beside presence, and presence that is
 * never published for somebody who turned it off. Fictional people.
 */

const AT = "2026-09-30T09:00:00.000Z";
const ME = person("d9711111-1111-4111-8111-000000000001", "Максим Орлов");
const VERA_ID = "d9711111-1111-4111-8111-000000000002";
const CHAT_VERA = "d9722222-2222-4222-8222-000000000001";

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 768;

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

function privacyRow(overrides: Row = {}): Row {
  return {
    presence_visible: true,
    forward_origin_visible: true,
    manual_status: "online",
    manual_status_until: null,
    ...overrides,
  };
}

async function open(page: Page, options: { privacy?: Row | null; veraStatus?: string | null } = {}): Promise<Fixture> {
  const vera = {
    ...person(VERA_ID, "Вера Климова"),
    online_at: new Date().toISOString(),
    presence_status: options.veraStatus ?? null,
  };
  const fixture = await openFixture(page, {
    me: ME,
    people: [vera],
    chats: [chat(CHAT_VERA, "private", null, AT)],
    memberships: [membership(CHAT_VERA, ME, "member", AT), membership(CHAT_VERA, vera, "member", AT)],
    messages: [message("d9755555-5555-4555-8555-000000000001", CHAT_VERA, vera, "Созвонимся после обеда?", AT)],
    rest: (call) => {
      if (call.resource !== "privacy_preferences" || call.method !== "GET") return undefined;
      const row = options.privacy ?? null;
      return { status: 200, body: call.single ? row : row ? [row] : [] };
    },
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Созвонимся после обеда?").first()).toBeVisible();
  return fixture;
}

/** Every write that would tell somebody else this person is here. */
function presenceWrites(fixture: Fixture): unknown[] {
  const direct = fixture
    .restCalls("profiles", "PATCH")
    .map((call) => call.body as Row | null)
    .filter((body) => body && typeof body.online_at === "string");
  return [...direct, ...fixture.rpcBodies("presence_beat")];
}

test("the probe sees a heartbeat when presence is on", async ({ page }) => {
  const fixture = await open(page, { privacy: privacyRow() });
  await expect.poll(() => presenceWrites(fixture).length, { timeout: 10_000 }).toBeGreaterThan(0);
});

test("presence turned off is never published, not even once while the app opens", async ({ page }) => {
  const fixture = await open(page, { privacy: privacyRow({ presence_visible: false }) });
  // The heartbeat beats at once when it starts, so a leak lands within the
  // first second; three is the margin.
  await page.waitForTimeout(3_000);
  expect(presenceWrites(fixture)).toEqual([]);
});

test("«Невидимый» publishes nothing at all, and its own person sees a ring", async ({ page }) => {
  const fixture = await open(page, { privacy: privacyRow({ manual_status: "invisible" }) });
  await page.waitForTimeout(3_000);
  expect(presenceWrites(fixture)).toEqual([]);
  if (!isPhone(page)) await expect(page.getByTestId("user-panel-status")).toHaveAttribute("data-status", "invisible");
});

test("«Не беспокоить» on a person is a red dot and the words under their name", async ({ page }) => {
  await open(page, { veraStatus: "dnd" });
  const row = page.locator('[data-presence="dnd"]').first();
  await expect(row).toBeVisible();
  await page.getByText("Созвонимся после обеда?").first().click();
  await expect(page.getByText("не беспокоить", { exact: true }).first()).toBeVisible();
});

test("a status chosen from the panel under the face goes to the database for an hour", async ({ page }) => {
  test.skip(isPhone(page), "the panel is the desktop's; a phone sets it in the settings");
  const fixture = await open(page);
  await page.getByTestId("user-panel-identity").click();
  // Discord's place for it: one row after «Редактировать профиль», naming the
  // status, which opens the choice (reference-clients §21).
  const row = page.getByTestId("user-panel-status-row");
  await expect(row).toHaveText("В сети");
  await expect(page.getByTestId("user-panel-status-menu")).toHaveCount(0);
  const order = await page.getByTestId("user-panel-menu").evaluate((menuElement) => {
    const ids = [...menuElement.querySelectorAll("[data-testid]")].map((element) => element.getAttribute("data-testid"));
    return [ids.indexOf("user-panel-edit-profile"), ids.indexOf("user-panel-status-row")];
  });
  expect(order[0]).toBeGreaterThanOrEqual(0);
  expect(order[1]).toBeGreaterThan(order[0]);
  await row.click();
  const menu = page.getByTestId("user-panel-status-menu");
  await expect(menu).toBeVisible();
  await menu.getByTestId("status-option-dnd").click();
  const before = Date.now();
  const beatsBefore = fixture.rpcBodies("presence_beat").length;
  await menu.getByTestId("status-duration-1h").click();
  await expect.poll(() => fixture.rpcBodies("presence_set_status").length).toBe(1);
  // The choice is published by its own call. A beat sent beside it could read
  // the row before the choice is committed and publish the old status over it.
  await page.waitForTimeout(1_500);
  expect(fixture.rpcBodies("presence_beat").length, "a beat raced the choice").toBe(beatsBefore);
  const [body] = fixture.rpcBodies("presence_set_status");
  expect(body.p_status).toBe("dnd");
  const until = Date.parse(String(body.p_until));
  expect(until - before).toBeGreaterThan(59 * 60_000);
  expect(until - before).toBeLessThan(61 * 60_000);
  await expect(page.getByTestId("user-panel-status")).toHaveAttribute("data-status", "dnd");
  await page.getByTestId("user-panel-identity").click();
  await expect(page.getByTestId("user-panel-status-row")).toContainText("Не беспокоить · до ");
});

test("on a phone the status is set in the settings, until changed", async ({ page }) => {
  test.skip(!isPhone(page), "a desktop sets it from the panel");
  const fixture = await open(page);
  await page.getByRole("button", { name: "Меню" }).first().click();
  await page.getByRole("button", { name: "Настройки" }).first().click();
  await page.getByTestId("settings-open-status").click();
  const section = page.getByTestId("settings-section-status");
  await section.getByTestId("status-option-dnd").click();
  await section.getByTestId("status-duration-forever").click();
  await expect.poll(() => fixture.rpcBodies("presence_set_status").length).toBe(1);
  expect(fixture.rpcBodies("presence_set_status")[0]).toEqual({ p_status: "dnd", p_until: null });
  await expect(page.getByTestId("settings-open-status")).toContainText("Не беспокоить");
});

/**
 * The beat reports when this person last did something; the database decides
 * idle from every device's report. Here the clock is run past Discord's ten
 * minutes with nothing touched, then the pointer moves.
 */
test("ten quiet minutes are reported as they are, and a movement is reported at once", async ({ page }) => {
  test.skip(isPhone(page), "the panel's dot is the desktop's");
  await page.clock.install({ time: new Date("2026-09-30T09:00:00.000Z") });
  const fixture = await open(page);
  await expect.poll(() => fixture.rpcBodies("presence_beat").length).toBeGreaterThan(0);

  await page.clock.runFor(10 * 60_000 + 45_000);
  await expect(page.getByTestId("user-panel-status")).toHaveAttribute("data-status", "idle");
  const quiet = fixture.rpcBodies("presence_beat").at(-1)!;
  const pageNow = await page.evaluate(() => Date.now());
  expect(pageNow - Date.parse(String(quiet.p_active_at))).toBeGreaterThanOrEqual(10 * 60_000);

  const beatsBefore = fixture.rpcBodies("presence_beat").length;
  await page.mouse.move(400, 300);
  await page.mouse.move(420, 320);
  await expect(page.getByTestId("user-panel-status")).toHaveAttribute("data-status", "online");
  await expect.poll(() => fixture.rpcBodies("presence_beat").length).toBeGreaterThan(beatsBefore);
  const back = fixture.rpcBodies("presence_beat").at(-1)!;
  const nowAgain = await page.evaluate(() => Date.now());
  expect(nowAgain - Date.parse(String(back.p_active_at))).toBeLessThan(5_000);
});
