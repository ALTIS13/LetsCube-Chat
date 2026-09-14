import { expect, test, type Page, type TestInfo } from "@playwright/test";
import {
  chat,
  membership,
  message,
  openChat,
  openFixture,
  person,
  requireFixtureServer,
  type Row,
} from "./helpers/messageActionsFixture";

/**
 * D-167: muting a chat is the account's, and it has durations.
 *
 * The server half has been live since 2026-05-27 and nothing used it. The
 * interface kept its mutes in `localStorage['ng_muted']` — a bare array of chat
 * ids with nobody's name on it — so a chat silenced on a phone read as
 * unsilenced on a computer, clearing the browser's data wiped every mute from
 * the screen while the account kept them, and a failed write left a mute that
 * worked on one device with nothing anywhere saying so.
 *
 * What is measured here is the behaviour in a browser, on top of what
 * `tests/unit/chat-mute.test.mts` measures about the decisions:
 *
 *   - the account's rows are what the screen shows, and a cache never beats
 *     them;
 *   - a cache written by another account is never shown;
 *   - a `muted_until` already past is not a mute, which is what the database's
 *     own `> now()` says;
 *   - the durations write the row a timed mute needs and say when it ends;
 *   - a refused write is visible and does not leave the screen claiming a mute.
 *
 * Everything runs on the message-actions fixture — a mocked backend with
 * fictional people — so no production chat is ever rendered.
 */

const AT = "2026-09-14T09:00:00.000Z";
const ME = person("11111111-1111-4111-8111-000000000001", "Максим Орлов");
const ANNA = person("11111111-1111-4111-8111-000000000002", "Анна Смирнова");
const CHAT_TEAM = "22222222-2222-4222-8222-000000000001";
const CHAT_ANNA = "22222222-2222-4222-8222-000000000002";
const OTHER_ACCOUNT = "11111111-1111-4111-8111-00000000009f";
const CACHE_KEY = "kub_chat_mutes";

const TEAM_LINE = "Смета на витрину готова, посмотри";
const ANNA_LINE = "Заеду к шести, если ничего не поменяется";

function rows(): { chats: Row[]; memberships: Row[]; messages: Row[] } {
  return {
    chats: [chat(CHAT_TEAM, "group", "Команда проекта", AT), chat(CHAT_ANNA, "private", null, AT)],
    memberships: [
      membership(CHAT_TEAM, ME, "owner", AT),
      membership(CHAT_TEAM, ANNA, "member", AT),
      membership(CHAT_ANNA, ME, "member", AT),
      membership(CHAT_ANNA, ANNA, "member", AT),
    ],
    messages: [
      message("55555555-5555-4555-8555-000000000001", CHAT_TEAM, ME, TEAM_LINE, "2026-09-14T10:00:00.000Z"),
      message("55555555-5555-4555-8555-000000000002", CHAT_ANNA, ANNA, ANNA_LINE, "2026-09-14T10:07:00.000Z"),
    ],
  };
}

interface PreferenceRow {
  chat_id: string;
  user_id: string;
  push_enabled: boolean;
  muted_until: string | null;
}

interface MuteFixtureOptions {
  /** What the account already holds. */
  server?: PreferenceRow[];
  /** What this browser remembered, and under whose name. */
  cache?: { userId: string; prefs: Record<string, { pushEnabled: boolean; mutedUntil: string | null }> };
  /** Refuses the write, so the refusal path can be measured. */
  refuseWrite?: { status: number; body: unknown };
}

/**
 * The fixture, plus `chat_notification_preferences` played as a table that
 * remembers.
 *
 * It is implemented through the fixture's own `rest` hook rather than inside the
 * shared helper: nothing else needs this table, and a spec that owns its own
 * storage can make the same table answer differently in five tests.
 */
async function openMuteFixture(page: Page, options: MuteFixtureOptions = {}) {
  const held: PreferenceRow[] = [...(options.server ?? [])];
  // The composer's first-run hint is a plate anchored at the bottom-right, and
  // below `md` this header's menu is a sheet at the bottom of the screen, so on
  // a phone the two land on each other. That overlap belongs to neither of them
  // and is recorded rather than worked around in the product; here the hints are
  // marked read, which is the state a person is in after their first day.
  await page.addInitScript((ids: string[]) => {
    const read: Record<string, { dismissed: boolean; spentMs: number }> = {};
    for (const id of ids) read[id] = { dismissed: true, spentMs: 0 };
    localStorage.setItem("letscube:hints", JSON.stringify(read));
  }, ["recorder-mode", "search-syntax", "admin-entry"]);
  if (options.cache) {
    const cache = options.cache;
    await page.addInitScript(
      ({ key, value }) => {
        localStorage.setItem(key, value);
      },
      { key: CACHE_KEY, value: JSON.stringify(cache) },
    );
  }
  const fixture = await openFixture(page, {
    me: ME,
    ...rows(),
    rest: ({ resource, method, body }) => {
      if (resource !== "chat_notification_preferences") return undefined;
      if (method === "GET") return { status: 200, body: held };
      if (method === "POST") {
        if (options.refuseWrite) return options.refuseWrite;
        const written = (Array.isArray(body) ? body : [body]) as PreferenceRow[];
        for (const row of written) {
          const index = held.findIndex((existing) => existing.chat_id === row.chat_id);
          if (index >= 0) held[index] = { ...held[index], ...row };
          else held.push(row);
        }
        return { status: 201, body: [] };
      }
      return { status: 200, body: [] };
    },
  });
  return { fixture, held };
}

/**
 * The theme, stamped the way the product's own runtime stamps it — and then
 * given a frame to be painted in.
 *
 * The settle is not politeness. Stamping the class and screenshotting in the
 * same turn photographs the frosted surfaces on their **previous** raster: the
 * first light-theme shots taken here showed the menu's text, the header's
 * capsules and the composer's buttons as white-on-white, while
 * `getComputedStyle` on the same elements answered `rgb(7, 17, 31)`. Every one
 * of the washed-out surfaces carried a backdrop filter and every correct one did
 * not. Two frames and a beat is enough; the pixels were compared against a run
 * that stamped the theme before the menu existed at all, and the two agree.
 */
async function stampTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((value) => {
    const root = document.documentElement;
    root.classList.toggle("dark", value === "dark");
    root.classList.toggle("light", value === "light");
    root.setAttribute("data-theme", value as string);
    root.style.colorScheme = value as string;
  }, theme);
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  await page.waitForTimeout(300);
}

function shotPath(info: TestInfo, name: string): string {
  return `output/chat-mute/${name}-${info.project.name}.png`;
}

/** Opens the chat header's «Ещё» menu. */
async function openHeaderMenu(page: Page) {
  await page.getByRole("button", { name: "Ещё" }).click();
  const menu = page.locator('[data-kub-menu="true"]');
  await expect(menu).toBeVisible();
  return menu;
}

const muteRow = (page: Page) => page.locator('[data-chat-menu-item="Отключить уведомления"]');
const unmuteRow = (page: Page) => page.locator('[data-chat-menu-item="Включить уведомления"]');

/**
 * How the product names one instant: «до 21:00», «до завтра, 9:00».
 *
 * Given the instant rather than an offset from now, and read in the page's own
 * clock and time zone. An offset was the first version and it was a flake: the
 * label was computed before the press and compared with one the product built
 * after it, so a run that crossed a minute boundary in between failed on a
 * minute rather than on the product.
 */
function endsLabel(page: Page, iso: string): Promise<string> {
  return page.evaluate((value) => {
    const end = new Date(value);
    const now = new Date();
    const clock = `${end.getHours()}:${String(end.getMinutes()).padStart(2, "0")}`;
    const same = (a: Date, b: Date) =>
      a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (same(end, now)) return `до ${clock}`;
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    return same(end, tomorrow) ? `до завтра, ${clock}` : `до ${end.getDate()}, ${clock}`;
  }, iso);
}

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

test("the account's own rows are what the screen shows, and a cache cannot beat them", async ({ page }) => {
  // The defect, reproduced and then denied. The browser remembers that «Команда
  // проекта» is silenced and «Анна Смирнова» is not; the account holds the
  // opposite. Before this change the browser won.
  await openMuteFixture(page, {
    server: [{ chat_id: CHAT_ANNA, user_id: ME.id, push_enabled: false, muted_until: null }],
    cache: {
      userId: ME.id,
      prefs: { [CHAT_TEAM]: { pushEnabled: false, mutedUntil: null } },
    },
  });

  // The list is the landing screen at both widths, and below `md` it is the only
  // one: once a conversation is open the product replaces the column with it, so
  // the glyphs are read here, where they are really on screen.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const list = page.getByTestId("chat-list-item");
  const annaRow = list.filter({ hasText: "Анна Смирнова" });
  const teamRow = list.filter({ hasText: "Команда проекта" });
  await expect(annaRow).toBeVisible();
  // The account's row wins on the sidebar…
  await expect(annaRow.getByLabel("Уведомления отключены")).toBeVisible();
  // …and the cache's row is gone from it.
  await expect(teamRow.getByLabel(/Уведомления отключены/)).toHaveCount(0);

  // And in the open chat's own menu, which is the surface that used to lie.
  await openChat(page, "Команда проекта", TEAM_LINE);
  await openHeaderMenu(page);
  await expect(muteRow(page)).toBeVisible();
  await expect(unmuteRow(page)).toHaveCount(0);
});

test("a cache written by another account is never shown", async ({ page }) => {
  // Two people, one browser. The cache is well-formed and carries a real mute;
  // it is simply not this person's.
  await openMuteFixture(page, {
    server: [],
    cache: { userId: OTHER_ACCOUNT, prefs: { [CHAT_TEAM]: { pushEnabled: false, mutedUntil: null } } },
  });
  await openChat(page, "Команда проекта", TEAM_LINE);
  await expect(page.getByTestId("chat-list-item").getByLabel(/Уведомления отключены/)).toHaveCount(0);
  await openHeaderMenu(page);
  await expect(muteRow(page)).toBeVisible();
});

test("a muted_until already past is not a mute, because the database asks `> now()`", async ({ page }) => {
  // The row exists, so «is there a row?» and «is muted_until set?» both say
  // silenced — and the server delivers every message in it.
  await openMuteFixture(page, {
    server: [{
      chat_id: CHAT_TEAM,
      user_id: ME.id,
      push_enabled: true,
      muted_until: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    }],
  });
  await openChat(page, "Команда проекта", TEAM_LINE);
  await expect(page.getByTestId("chat-list-item").getByLabel(/Уведомления отключены/)).toHaveCount(0);
  await openHeaderMenu(page);
  await expect(muteRow(page)).toBeVisible();
  await expect(unmuteRow(page)).toHaveCount(0);
});

test("the durations write the row a timed mute needs, and say when it ends", async ({ page }, info) => {
  const { fixture, held } = await openMuteFixture(page);
  await openChat(page, "Команда проекта", TEAM_LINE);

  await openHeaderMenu(page);
  await muteRow(page).click();

  // The menu stepped into the durations, and there is a way back out.
  for (const label of ["Назад", "На 1 час", "На 8 часов", "До завтра", "Навсегда"]) {
    await expect(page.locator(`[data-chat-menu-item="${label}"]`)).toBeVisible();
  }
  // While the durations are open they are the whole menu.
  await expect(page.locator('[data-chat-menu-item="Поиск в чате"]')).toHaveCount(0);
  await stampTheme(page, "dark");
  await page.screenshot({ path: shotPath(info, "durations-dark") });
  await stampTheme(page, "light");
  await page.screenshot({ path: shotPath(info, "durations-light") });
  await stampTheme(page, "dark");

  await page.locator('[data-chat-menu-item="На 1 час"]').click();

  // The row that went to the account is read first, so the sentence below is
  // checked against the instant that was really written rather than against one
  // this process computed a moment earlier.
  await expect
    .poll(() => fixture.restCalls("chat_notification_preferences", "POST").length)
    .toBe(1);
  const writes = fixture.restCalls("chat_notification_preferences", "POST");
  const written = (Array.isArray(writes[0].body) ? writes[0].body[0] : writes[0].body) as PreferenceRow;
  const inAnHour = (await endsLabel(page, written.muted_until as string)).replace(/^до /, "");

  // The confirmation names the end.
  await expect(page.getByText(`Уведомления отключены до ${inAnHour}`)).toBeVisible();
  await page.screenshot({ path: shotPath(info, "confirmation-dark") });

  // A timed mute, not a permanent one: `push_enabled` stays true so
  // `_notification_push_allowed` reaches the second condition at all.
  expect(written.chat_id).toBe(CHAT_TEAM);
  expect(written.user_id).toBe(ME.id);
  expect(written.push_enabled).toBe(true);
  expect(written.muted_until).not.toBeNull();
  const ahead = Date.parse(written.muted_until as string) - Date.now();
  expect(ahead).toBeGreaterThan(55 * 60 * 1000);
  expect(ahead).toBeLessThan(65 * 60 * 1000);
  expect(held).toHaveLength(1);

  // And the interface now says so, with the end beside it. The glyph is checked
  // by its label rather than by its visibility, because below `md` the list is
  // not on screen while a conversation is open — the product's layout, not this
  // feature's business. It is read visible in the first test of this file, where
  // the list is the screen.
  const teamRow = page.getByTestId("chat-list-item").filter({ hasText: "Команда проекта" });
  await expect(teamRow.getByLabel(`Уведомления отключены до ${inAnHour}`)).toHaveCount(1);
  // The confirmation is given its own time before the menu is photographed
  // again. `KubFeedbackViewport` is `fixed` at `--kub-safe-top + 6.75rem` across
  // the full width, and this header's menu drops from the capsule at the same
  // corner, so a shot taken while both are up shows the card across the row —
  // an overlap this file did not introduce and does not own.
  await expect(page.getByText(`Уведомления отключены до ${inAnHour}`)).toBeHidden({ timeout: 10_000 });
  await openHeaderMenu(page);
  await expect(unmuteRow(page)).toBeVisible();
  await expect(unmuteRow(page).locator('[data-chat-mute-detail="true"]')).toHaveText(`до ${inAnHour}`);
  await stampTheme(page, "dark");
  await page.screenshot({ path: shotPath(info, "muted-dark") });
  await stampTheme(page, "light");
  await page.screenshot({ path: shotPath(info, "muted-light") });
});

test("«Навсегда» writes push_enabled false, and unmuting clears both fields", async ({ page }) => {
  const { fixture } = await openMuteFixture(page);
  await openChat(page, "Команда проекта", TEAM_LINE);

  await openHeaderMenu(page);
  await muteRow(page).click();
  await page.locator('[data-chat-menu-item="Навсегда"]').click();
  await expect(page.getByText("Уведомления отключены", { exact: true })).toBeVisible();

  await openHeaderMenu(page);
  await expect(unmuteRow(page)).toBeVisible();
  await expect(unmuteRow(page).locator('[data-chat-mute-detail="true"]')).toHaveText("навсегда");
  await unmuteRow(page).click();
  await expect(page.getByText("Уведомления включены")).toBeVisible();

  const writes = fixture
    .restCalls("chat_notification_preferences", "POST")
    .map((call) => (Array.isArray(call.body) ? call.body[0] : call.body) as PreferenceRow);
  expect(writes).toHaveLength(2);
  expect(writes[0].push_enabled).toBe(false);
  expect(writes[0].muted_until).toBeNull();
  expect(writes[1].push_enabled).toBe(true);
  expect(writes[1].muted_until).toBeNull();

  await openHeaderMenu(page);
  await expect(muteRow(page)).toBeVisible();
});

test("a refused write is visible, and the screen stops claiming the mute", async ({ page }, info) => {
  // The bare `catch {}` this replaces is why a mute that never reached the
  // account looked exactly like one that did.
  await openMuteFixture(page, {
    refuseWrite: {
      status: 403,
      body: { code: "42501", details: null, hint: null, message: "permission denied for table chat_notification_preferences" },
    },
  });
  await openChat(page, "Команда проекта", TEAM_LINE);

  await openHeaderMenu(page);
  await muteRow(page).click();
  await page.locator('[data-chat-menu-item="На 1 час"]').click();

  // One sentence about the situation, and never the database's own words.
  const feedback = page.getByText("Недостаточно прав для этого действия.");
  await expect(feedback).toBeVisible();
  await expect(page.getByText(/permission denied|chat_notification_preferences|42501/)).toHaveCount(0);
  await page.screenshot({ path: shotPath(info, "refusal-dark") });
  await stampTheme(page, "light");
  await page.screenshot({ path: shotPath(info, "refusal-light") });
  await stampTheme(page, "dark");

  // And the interface is not left claiming a mute the account does not hold.
  await expect(page.getByTestId("chat-list-item").getByLabel(/Уведомления отключены/)).toHaveCount(0);
  await openHeaderMenu(page);
  await expect(muteRow(page)).toBeVisible();
  await expect(unmuteRow(page)).toHaveCount(0);
});

test("the card's own row says what the account holds, and opens in place", async ({ page }, info) => {
  // The third surface, and the one difference between them. The durations open
  // **in place** here rather than replacing the whole card: on the card the rows
  // are sections separated by rules, so five duration rows sit inside their own
  // section; in a menu they would be five items in a single list with «Удалить
  // групповой чат» two rows below a half-made choice.
  //
  // The row's second line was a value on the right for one round. At 380px —
  // the card's width at 1440 as well as at 390 — «Отключены до завтра, 0:45»
  // beside the label left «Включить уведом…» cut mid-word. Photographed, then
  // changed to the two-line shape the menus use.
  const inEightHours = new Date(Date.now() + 8 * 60 * 60 * 1000);
  await openMuteFixture(page, {
    server: [{
      chat_id: CHAT_TEAM,
      user_id: ME.id,
      push_enabled: true,
      muted_until: inEightHours.toISOString(),
    }],
  });
  await openChat(page, "Команда проекта", TEAM_LINE);
  await page.getByTestId("chat-header-info-button").click();
  const panel = page.getByTestId("chat-info-panel");
  await expect(panel).toBeVisible();

  const ends = await endsLabel(page, inEightHours.toISOString());
  const resting = panel.locator('[data-chat-mute-row="unmute"]');
  await expect(resting).toContainText("Включить уведомления");
  await expect(resting.locator('[data-chat-mute-detail="true"]')).toHaveText(ends);
  await stampTheme(page, "dark");
  await panel.screenshot({ path: shotPath(info, "card-muted-dark") });
  await stampTheme(page, "light");
  await panel.screenshot({ path: shotPath(info, "card-muted-light") });
  await stampTheme(page, "dark");

  // Unmute, then open the durations in place.
  await resting.click();
  await expect(page.getByText("Уведомления включены")).toBeVisible();
  const off = panel.locator('[data-chat-mute-row="mute"]');
  await expect(off).toContainText("Отключить уведомления");
  // Nothing is off, so there is no end to name and the row stays one line.
  await expect(off.locator('[data-chat-mute-detail="true"]')).toHaveCount(0);
  await off.click();
  for (const label of ["Назад", "На 1 час", "На 8 часов", "До завтра", "Навсегда"]) {
    await expect(panel.getByText(label, { exact: true })).toBeVisible();
  }
  // The confirmation from the unmute above is given its time before the card is
  // photographed: `KubFeedbackViewport` is fixed across the full width at
  // `--kub-safe-top + 6.75rem`, which is where this card's own head is.
  await expect(page.getByText("Уведомления включены")).toBeHidden({ timeout: 10_000 });
  await stampTheme(page, "dark");
  await panel.screenshot({ path: shotPath(info, "card-durations-dark") });
  await stampTheme(page, "light");
  await panel.screenshot({ path: shotPath(info, "card-durations-light") });

  // The choice is closed off from what follows it. Photographed before this
  // line existed: «Навсегда» and «Пригласить пользователя» stood in one
  // undivided run of rows, so the invitation read as a fifth way to mute the
  // chat. Measured as a real line rather than as a class name.
  const invite = panel.getByRole("button", { name: "Пригласить пользователя" });
  const dividedWhileOpen = await invite.evaluate((el) => {
    const box = el.parentElement;
    return box ? getComputedStyle(box).borderTopWidth : "0px";
  });
  expect(parseFloat(dividedWhileOpen), "the durations run into the invitation").toBeGreaterThan(0);

  // «Назад» is a way out, not a duration.
  await panel.locator('[data-chat-mute-row="back"]').click();
  await expect(panel.locator('[data-chat-mute-row="mute"]')).toBeVisible();
  await expect(panel.locator('[data-chat-mute-row="hour"]')).toHaveCount(0);

  // And the rule is only there while the choice is: a divider under a settled
  // list would be a section boundary the card does not have.
  const dividedAtRest = await invite.evaluate((el) => {
    const box = el.parentElement;
    return box ? getComputedStyle(box).borderTopWidth : "0px";
  });
  expect(parseFloat(dividedAtRest), "the divider outlived the choice").toBe(0);
});
