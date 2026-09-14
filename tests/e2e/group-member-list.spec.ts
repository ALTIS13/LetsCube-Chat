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
  requireFixtureServer,
} from "./helpers/messageActionsFixture";

/**
 * D-168: a member row says who its people are, and opens them.
 *
 * The entry's four complaints, as four things a browser can be asked:
 *
 *   1. the row «is a `<div>` — not pressable, with no way to reach the person»;
 *   2. «an ordinary member's row carries nothing at all»;
 *   3. «there is no presence dot: `showOnline` exists on the avatar and is not
 *      passed»;
 *   4. «the list has no order».
 *
 * Order is checked by **position**, not by presence: a list of the right names
 * in the wrong sequence would satisfy any `toContainText` written against it,
 * and this repository has measured that mistake before. Every assertion here
 * reads `getBoundingClientRect().top` or the rendered index.
 *
 * Everything is fictional and mocked. No production screen is rendered.
 */

const AT = "2026-09-12T09:00:00.000Z";
/** Long enough ago that `getUserPresenceState` calls it «был(а) недавно». */
const LONG_AGO = "2026-09-01T09:00:00.000Z";

/** The chat's owner. Sorts first on role however her name reads. */
const ZOYA = person("33333333-3333-4333-8333-000000000001", "Зоя Яблокова", "zoya");
/** An administrator whose name would sort last of all under a plain sort. */
const YAKOV = person("33333333-3333-4333-8333-000000000002", "яков Белов", "yakov");
/** An ordinary member wearing nothing, with a nickname. The row D-168 is about. */
const OLGA = person("33333333-3333-4333-8333-000000000003", "Ольга Крылова", "olga");
/** An ordinary member whose name sorts before Olga's. */
const BORIS = person("33333333-3333-4333-8333-000000000004", "БОРИС Ильин", "boris");
/** An ordinary member with no nickname at all — the row that could still be empty. */
const NAMELESS = person("33333333-3333-4333-8333-000000000005", "Анна Тихая", null);

const CHAT_TEAM = "44444444-4444-4444-8444-000000000001";
const LINES = ["Смета готова, посмотрите", "Принял, отвечу к вечеру"];

/**
 * Presence is seeded per person, because the dot is one of the four claims.
 *
 * `online_at` is stamped at load rather than at module scope: the threshold is
 * 90 seconds and a constant written here would be stale by the time a slow
 * project reached this file.
 */
function seedPresence(who: ReturnType<typeof person>, online: boolean) {
  return {
    ...who,
    online_at: online ? new Date().toISOString() : LONG_AGO,
  };
}

function rows(opts: { onlineIds?: string[] } = {}) {
  const online = new Set(opts.onlineIds ?? [OLGA.id]);
  const people = [ZOYA, YAKOV, OLGA, BORIS, NAMELESS].map((who) =>
    seedPresence(who, online.has(who.id)),
  );
  const [zoya, yakov, olga, boris, nameless] = people;
  return {
    chats: [chat(CHAT_TEAM, "group", "Команда проекта", AT)],
    // Seeded in an order that is neither the answer nor alphabetical, so a list
    // that simply prints what the database returned cannot pass.
    memberships: [
      membership(CHAT_TEAM, olga, "member", AT),
      membership(CHAT_TEAM, yakov, "admin", AT),
      membership(CHAT_TEAM, nameless, "member", AT),
      membership(CHAT_TEAM, zoya, "owner", AT),
      membership(CHAT_TEAM, boris, "member", AT),
    ] as Row[],
    messages: LINES.map((text, index) =>
      message(
        "66666666-6666-4666-8666-" + String(index + 1).padStart(12, "0"),
        CHAT_TEAM,
        index === 0 ? zoya : yakov,
        text,
        new Date(Date.UTC(2026, 8, 12, 10, index * 7)).toISOString(),
      ),
    ),
  };
}

type OpenOptions = {
  onlineIds?: string[];
  /**
   * `denied` is the refusal RLS really gives; `unknown` is a failure the
   * mapper does not recognise. They take different paths through
   * `plainFailure` and both were measured rather than assumed — see the two
   * tests at the bottom.
   */
  membersFail?: "denied" | "unknown";
  noMembers?: boolean;
};

async function openMembers(page: Page, options: OpenOptions = {}) {
  const seed = rows({ onlineIds: options.onlineIds });
  const fixture = await openFixture(page, {
    // `me` is the owner, so the actions column is drawn for everybody else —
    // which is what keeps this spec honest about the «ещё» control still being
    // reachable beside a row that now activates on a plain press.
    me: ZOYA,
    chats: seed.chats,
    memberships: seed.memberships,
    messages: seed.messages,
    rpc: (name) => {
      if (name === "profile_badges") return { body: [] };
      if (name === "search_chat_messages") return missingFunction(name);
      return undefined;
    },
  });

  /**
   * The panel's own member read, answered differently from everybody else's.
   *
   * The helper's `rest` hook sees a resource name and a method but not the
   * query, and `chat_members` is read by the chat list as well — refusing the
   * table outright took the chat list down with it and the spec never reached
   * the panel at all. Measured, not assumed: the first run of this file failed
   * three tests inside `openChat`.
   *
   * `joined_at` was the first marker tried and it was wrong: `useChats.ts:140`
   * asks for it too, so the chat list went down again and the three tests
   * failed in the same place. The panel's query is the only one that joins
   * `profiles`, which is what this matches now. Registered after `openFixture`
   * because Playwright tries the most recent handler first, and falls through
   * for anything else.
   */
  if (options.membersFail || options.noMembers) {
    await page.route("**/rest/v1/chat_members*", async (route) => {
      const url = new URL(route.request().url());
      const panelRead =
        route.request().method() === "GET" &&
        (url.searchParams.get("select") ?? "").includes("profiles(");
      if (!panelRead) return route.fallback();
      if (options.membersFail === "denied") {
        return route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({
            code: "42501",
            message: "permission denied for table chat_members",
          }),
        });
      }
      if (options.membersFail === "unknown") {
        return route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ code: "XX000", message: "internal error 7f3a" }),
        });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });
  }

  await openChat(page, "Команда проекта", LINES[0]);
  await page.getByTestId("chat-header-info-button").click();
  const panel = page.getByTestId("chat-info-panel");
  await expect(panel).toBeVisible();
  await panel.getByText("УЧАСТНИКИ", { exact: false }).first().click();
  return fixture;
}

const row = (page: Page, who: { id: string }) =>
  page.locator(`[data-testid="chat-info-member"][data-member-id="${who.id}"]`);

async function orderOnScreen(page: Page): Promise<string[]> {
  // Read off the rendered boxes rather than the DOM order: a list reordered by
  // CSS would pass a DOM check and still look wrong to the person reading it.
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="chat-info-member"]')]
      .map((el) => ({
        id: (el as HTMLElement).dataset.memberId ?? "",
        top: el.getBoundingClientRect().top,
      }))
      .sort((a, b) => a.top - b.top)
      .map((entry) => entry.id),
  );
}

async function stampTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((value) => {
    const root = document.documentElement;
    root.classList.toggle("dark", value === "dark");
    root.classList.toggle("light", value === "light");
    root.setAttribute("data-theme", value as string);
    root.style.colorScheme = value as string;
  }, theme);
}

function shotPath(info: TestInfo, name: string): string {
  return `output/group-members/${name}-${info.project.name}.png`;
}

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

// ---------------------------------------------------------------------------
// 4. The order
// ---------------------------------------------------------------------------

test("the list stands in role order, then in Russian alphabetical order", async ({ page }) => {
  await openMembers(page);
  await expect(page.getByTestId("chat-info-member")).toHaveCount(5);

  // Owner, administrator, then the three members by name. «БОРИС» is shouted
  // and «яков» is whispered, so a comparison that did not fold case would put
  // one of them at an end rather than in place — and «Анна Тихая» has no
  // nickname, which must not move her.
  expect(await orderOnScreen(page)).toEqual([
    ZOYA.id, // owner
    YAKOV.id, // admin, despite «яков» sorting last by code unit
    NAMELESS.id, // Анна
    BORIS.id, // БОРИС
    OLGA.id, // Ольга
  ]);
});

test("the order does not depend on what the database happened to return", async ({ page }) => {
  // The seeding order in `rows()` is deliberately none of role order, name
  // order or reverse: olga, yakov, nameless, zoya, boris. A list that printed
  // the answer as it arrived would produce exactly that.
  await openMembers(page);
  const shown = await orderOnScreen(page);
  expect(shown).not.toEqual([OLGA.id, YAKOV.id, NAMELESS.id, ZOYA.id, BORIS.id]);
  expect(shown[0]).toBe(ZOYA.id);
});

// ---------------------------------------------------------------------------
// 2. What a row carries
// ---------------------------------------------------------------------------

test("an ordinary member's row carries something", async ({ page }) => {
  await openMembers(page);

  // The entry's own sentence. Olga wears no badge and holds no chat role, so
  // before this change her row was a name and nothing else.
  const line = row(page, OLGA).getByTestId("chat-info-member-secondary");
  await expect(line).toHaveCount(1);
  await expect(line).toContainText("@olga");
  expect((await line.innerText()).trim().length).toBeGreaterThan(0);
});

test("a member with no nickname is still told apart from an empty row", async ({ page }) => {
  await openMembers(page);
  const line = row(page, NAMELESS).getByTestId("chat-info-member-secondary");
  // Anna has no username and a presence that can be read, so the line is her
  // presence. The alternation this assertion used to carry —
  // /Без имени пользователя|был|сети/ — passed whichever of the two the
  // product drew, which is how «Без имени пользователя · был(а)
  // недавно» reached a screenshot. Announcing what somebody lacks is not a
  // fact about them, and is a line neither Telegram nor Discord writes.
  await expect(line).toHaveText(/был\(а\) недавно/);
  await expect(line).not.toContainText("Без имени пользователя");
  expect((await line.innerText()).trim().length).toBeGreaterThan(0);
});

test("the chat's own role still comes first where there is one", async ({ page }) => {
  await openMembers(page);
  await expect(row(page, ZOYA).getByTestId("chat-info-member-secondary")).toContainText(
    "Владелец группы",
  );
  await expect(row(page, YAKOV).getByTestId("chat-info-member-secondary")).toContainText(
    "Администратор группы",
  );
});

// ---------------------------------------------------------------------------
// 3. The presence dot
// ---------------------------------------------------------------------------

test("presence is drawn on the avatar of whoever is there, and only them", async ({ page }) => {
  await openMembers(page, { onlineIds: [OLGA.id] });

  // Counted in the DOM rather than looked for by eye: the dot is the 8px disc
  // `tests/unit/edge-vocabulary.test.mjs` pins to one size everywhere.
  const dots = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="chat-info-member"]')].map((el) => ({
      id: (el as HTMLElement).dataset.memberId ?? "",
      dots: el.querySelectorAll("span.h-2.w-2.rounded-full").length,
    })),
  );
  const lit = dots.filter((entry) => entry.dots > 0).map((entry) => entry.id);
  expect(lit, "exactly the person who is there carries a dot").toEqual([OLGA.id]);
});

test("a presence nobody could read is not reported as being away", async ({ page }) => {
  // Everyone stale: nobody is lit, and no row claims «не в сети» — a sentence
  // the record does not support (D-140, D-193 on the other side).
  await openMembers(page, { onlineIds: [] });
  const dots = await page.evaluate(
    () => document.querySelectorAll('[data-testid="chat-info-member"] span.h-2.w-2.rounded-full').length,
  );
  expect(dots).toBe(0);
  await expect(page.getByTestId("chat-info-member").filter({ hasText: "не в сети" })).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// 1. Reaching the person
// ---------------------------------------------------------------------------

test("a member row is pressable, and opens the person", async ({ page }) => {
  await openMembers(page);

  const opener = row(page, OLGA).getByTestId("chat-info-member-open");
  // A real button, not a div wearing a handler: the tag is what gives it
  // keyboard focus and Enter.
  expect(await opener.evaluate((el) => el.tagName)).toBe("BUTTON");

  await opener.click();
  const card = page.getByTestId("chat-info-member-card");
  await expect(card).toHaveAttribute("data-state", "current");
  await expect(card.getByTestId("member-card-username")).toHaveText("@olga");
  await expect(card.getByTestId("member-card-joined")).toContainText("В группе с");
  await expect(card.getByTestId("member-card-open-chat")).toBeVisible();
});

test("the keyboard reaches the person too", async ({ page }) => {
  await openMembers(page);
  const opener = row(page, OLGA).getByTestId("chat-info-member-open");
  await opener.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("chat-info-member-card")).toHaveAttribute("data-state", "current");
});

test("the card goes back the way every other layer of this panel does", async ({ page }) => {
  await openMembers(page);
  await row(page, OLGA).getByTestId("chat-info-member-open").click();
  await expect(page.getByTestId("chat-info-member-card")).toHaveAttribute("data-state", "current");

  await page.getByTestId("chat-info-back").click();
  await expect(page.getByTestId("chat-info-member-card")).toHaveAttribute("data-state", "ahead");
  await expect(page.getByTestId("chat-info-root-view")).toHaveAttribute("data-state", "current");
});

test("opening a person does not cost the actions their control", async ({ page }) => {
  // D-163 made the «ещё» control always drawn and reachable three ways. The row
  // activating on a plain press must not have eaten it.
  await openMembers(page);
  const more = row(page, OLGA).locator('[aria-label="Действия с участником"]');
  await expect(more).toHaveCount(1);
  await more.click();
  await expect(page.getByTestId("chat-info-member-card")).toHaveAttribute("data-state", "ahead");
});

// ---------------------------------------------------------------------------
// A failed read is not an empty list
// ---------------------------------------------------------------------------

test("a list nobody was allowed to read says so, in the words that help", async ({ page }) => {
  await openMembers(page, { membersFail: "denied" });
  const notice = page.getByTestId("chat-info-members-error");
  await expect(notice).toBeVisible();

  // Measured rather than predicted. The first version of this test expected
  // «Не удалось загрузить участников» and the surface said «Недостаточно прав
  // для этого действия» — which is right: `plainFailure` refuses internals and
  // deliberately passes through the one failure a person could act on. The
  // fallback path is the test below.
  await expect(notice).toContainText("Недостаточно прав");
  await expect(notice).toContainText("Список мог остаться неполным");
  // And the machine's own words never arrive.
  await expect(notice).not.toContainText("permission denied");
  await expect(notice).not.toContainText("chat_members");
  await expect(notice).not.toContainText("42501");
  await expect(page.getByTestId("chat-info-members-empty")).toHaveCount(0);
});

test("a failure nobody recognised still says something in Russian", async ({ page }) => {
  await openMembers(page, { membersFail: "unknown" });
  const notice = page.getByTestId("chat-info-members-error");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("Не удалось загрузить участников");
  await expect(notice).not.toContainText("internal error");
  await expect(notice).not.toContainText("XX000");
  await expect(page.getByTestId("chat-info-members-empty")).toHaveCount(0);
});

test("a group with nobody in it says a different thing", async ({ page }) => {
  await openMembers(page, { noMembers: true });
  await expect(page.getByTestId("chat-info-members-empty")).toBeVisible();
  await expect(page.getByTestId("chat-info-members-error")).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// The pixels
// ---------------------------------------------------------------------------

for (const theme of ["light", "dark"] as const) {
  test(`the member list holds in the ${theme} theme`, async ({ page }, info) => {
    await openMembers(page);
    await stampTheme(page, theme);
    await expect(row(page, OLGA)).toBeVisible();
    await page.getByTestId("chat-info-panel").screenshot({ path: shotPath(info, `list-${theme}`) });
  });

  test(`the person's card holds in the ${theme} theme`, async ({ page }, info) => {
    await openMembers(page);
    await stampTheme(page, theme);
    await row(page, OLGA).getByTestId("chat-info-member-open").click();
    await expect(page.getByTestId("chat-info-member-card")).toHaveAttribute("data-state", "current");
    await page.getByTestId("chat-info-panel").screenshot({ path: shotPath(info, `card-${theme}`) });
  });
}

test("the refusal holds in the dark theme", async ({ page }, info) => {
  await openMembers(page, { membersFail: "denied" });
  await stampTheme(page, "dark");
  await expect(page.getByTestId("chat-info-members-error")).toBeVisible();
  await page.getByTestId("chat-info-panel").screenshot({ path: shotPath(info, "refused-dark") });
});
