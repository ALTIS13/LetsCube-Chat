import { expect, type Page, type TestInfo, test } from "@playwright/test";
import {
  chat,
  membership,
  message,
  missingFunction,
  openChat,
  openFixture,
  person,
  requireFixtureServer,
  type Row,
} from "./helpers/messageActionsFixture";

/**
 * D-215: a group can call somebody something, and it means nothing elsewhere.
 *
 * The tables were applied to production on 2026-09-18 — `chat_roles` and
 * `chat_member_roles`, with a composite key onto `chat_members` so leaving a
 * group takes the tags with the membership. This spec is the interface half.
 *
 * **What it asserts, and why each is a way to be wrong while looking right:**
 *
 *   1. **The group's word takes the tier's place in the row.** Telegram prints
 *      a custom admin title instead of «админ» for exactly this reason: the
 *      group chose the word, and the word says more than the tier. A row that
 *      showed both would carry three facts on a 280px line, which neither
 *      reference does.
 *   2. **The glyph keeps its own accessible name.** The crown beside the name
 *      is still «Владелец группы» to a screen reader even when the visible word
 *      is «Основатель». Passing the tag in as the role label is one line
 *      shorter and silently renames the glyph with it — the first draft of the
 *      change did exactly that.
 *   3. **The card stacks both, group first.** Discord's popout puts the
 *      server's roles above the account's badges, and the two answer different
 *      questions.
 *   4. **A member sees the vocabulary; only the owner may change it.** The
 *      SELECT policy is `is_chat_member` and the write policy is
 *      `is_chat_owner`, so a screen that hides the list from a member is
 *      wrong in one direction and one that offers them «Новая роль» is wrong
 *      in the other.
 *
 * Everything here is fictional and mocked. No production screen is rendered.
 */

const AT = "2026-09-12T09:00:00.000Z";
const ME = person("11111111-1111-4111-8111-000000000001", "Максим Орлов");
const ANNA = person("11111111-1111-4111-8111-000000000002", "Анна Смирнова");
const OLGA = person("11111111-1111-4111-8111-000000000003", "Ольга Крылова");
const CHAT = "22222222-2222-4222-8222-000000000001";
const LINE = "Макет главной готов";

const ROLES: Row[] = [
  {
    id: "33333333-3333-4333-8333-000000000001",
    chat_id: CHAT,
    name: "Основатель",
    colour: "amber",
    icon: "crown",
    priority: 90,
    created_at: AT,
  },
  {
    id: "33333333-3333-4333-8333-000000000002",
    chat_id: CHAT,
    name: "Наставник",
    colour: "teal",
    icon: "star",
    priority: 50,
    created_at: AT,
  },
  {
    id: "33333333-3333-4333-8333-000000000003",
    chat_id: CHAT,
    name: "Дежурный",
    colour: "violet",
    icon: null,
    priority: 10,
    created_at: AT,
  },
];

const TAGS: Row[] = [
  { chat_id: CHAT, user_id: ME.id, role_id: ROLES[0].id },
  { chat_id: CHAT, user_id: ANNA.id, role_id: ROLES[1].id },
  { chat_id: CHAT, user_id: ANNA.id, role_id: ROLES[2].id },
];

interface Store {
  roles: Row[];
  tags: Row[];
  inserted: Row[];
  deleted: number;
}

function store(over: Partial<Store> = {}): Store {
  return {
    roles: over.roles ?? ROLES.map((role) => ({ ...role })),
    tags: over.tags ?? TAGS.map((tag) => ({ ...tag })),
    inserted: [],
    deleted: 0,
  };
}

function restFor(held: Store) {
  return ({ resource, method, body }: { resource: string; method: string; body: unknown }) => {
    if (resource !== "chat_roles" && resource !== "chat_member_roles") return undefined;
    const rows = resource === "chat_roles" ? held.roles : held.tags;
    if (method === "GET") return { status: 200, body: rows };
    if (method === "POST") {
      const sent = (Array.isArray(body) ? body[0] : body) as Row;
      held.inserted.push({ ...sent, resource });
      rows.push({ ...sent });
      // 201 with no body: nothing here reads its own row back, for the reason
      // `lib/chatCreation.ts` sets out — RETURNING is judged by the SELECT
      // policy too, and that is what made group creation answer 403.
      return { status: 201, body: [] };
    }
    if (method === "DELETE") {
      held.deleted += 1;
      return { status: 204, body: [] };
    }
    if (method === "PATCH") return { status: 204, body: [] };
    return undefined;
  };
}

async function openMembers(page: Page, held: Store, me: typeof ME = ME, myRole = "owner") {
  await openFixture(page, {
    me,
    people: [ME, ANNA, OLGA].filter((who) => who.id !== me.id),
    chats: [chat(CHAT, "group", "Команда проекта", AT)],
    memberships: [
      membership(CHAT, ME, ME.id === me.id ? myRole : "owner", AT),
      membership(CHAT, ANNA, ANNA.id === me.id ? myRole : "admin", AT),
      membership(CHAT, OLGA, OLGA.id === me.id ? myRole : "member", AT),
    ] as Row[],
    messages: [message("55555555-5555-4555-8555-000000000001", CHAT, ME, LINE, AT)],
    rest: restFor(held),
    rpc: (name) => (name === "search_chat_messages" ? missingFunction(name) : undefined),
  });
  await openChat(page, "Команда проекта", LINE);
  await page.getByTestId("chat-header-info-button").click();
  await expect(page.getByTestId("chat-info-panel")).toBeVisible();
}

/**
 * Into the member list, which is a tab of the panel rather than its root.
 *
 * «Роли группы» sits in the panel's own actions, which are on the root — so a
 * test that enters the member list first cannot see it. That is not a defect:
 * it is where every other action of this card lives, and the first run of this
 * spec failed five tests on it.
 */
async function intoMembers(page: Page) {
  const panel = page.getByTestId("chat-info-panel");
  await panel.getByText("УЧАСТНИКИ", { exact: false }).first().click();
  await expect(page.getByTestId("chat-info-member").first()).toBeVisible();
}

const row = (page: Page, who: { id: string }) =>
  page.locator(`[data-testid="chat-info-member"][data-member-id="${who.id}"]`);

function shotPath(info: TestInfo, name: string): string {
  return `output/chat-roles/${name}-${info.project.name}.png`;
}

/**
 * Boot in a theme for real, and then walk back to where we were.
 *
 * Two traps, both met. The fixture writes `kub-theme = "dark"` in its own init
 * script, and init scripts run in registration order — so the theme has to be
 * registered AFTER `openFixture`, and calling `openFixture` again afterwards
 * puts dark back. The first light capture from this spec came out dark for
 * exactly that reason, and it was labelled «light». The routes survive a
 * reload, so the walk below needs no second fixture.
 */
async function bootInTheme(page: Page, theme: "light" | "dark") {
  await page.addInitScript((value) => localStorage.setItem("kub-theme", value as string), theme);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect
    .poll(async () => page.evaluate(() => document.documentElement.classList.contains("dark")), {
      timeout: 5_000,
    })
    .toBe(theme === "dark");
  await openChat(page, "Команда проекта", LINE);
  await page.getByTestId("chat-header-info-button").click();
  await expect(page.getByTestId("chat-info-panel")).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

test("the group's own word stands where the tier used to", async ({ page }) => {
  await openMembers(page, store());
  await intoMembers(page);

  // The SECOND LINE, not the whole row. `toContainText` on the row also reads
  // the crown's accessible name, which is «Владелец группы» on purpose — the
  // next test is the one that checks it is still there. Asserting on the row
  // would have made these two tests contradict each other, and the first run
  // did exactly that.
  const secondLine = (who: { id: string }) =>
    row(page, who).getByTestId("chat-info-member-secondary");

  // Максим is the chat's owner AND wears «Основатель». Telegram's rule: the
  // group's word wins.
  await expect(secondLine(ME)).toContainText("Основатель");
  await expect(
    secondLine(ME),
    "the tier and the group's word are both on the line",
  ).not.toContainText("Владелец группы");

  // Анна wears two; the row takes the higher one and only that one.
  await expect(secondLine(ANNA)).toContainText("Наставник");
  await expect(secondLine(ANNA)).not.toContainText("Дежурный");

  // Ольга wears none, so her row keeps exactly what it had.
  await expect(secondLine(OLGA)).not.toContainText("Основатель");
  await expect(secondLine(OLGA)).toContainText("был(а)");
});

test("the glyph still says which tier this is, even when the word is the group's", async ({
  page,
}) => {
  await openMembers(page, store());
  await intoMembers(page);
  const labels = await page.evaluate((ids) =>
    ids.map((id) => {
      const line = document.querySelector(`[data-member-id="${id}"]`);
      const marks = [...(line?.querySelectorAll("svg") ?? [])].filter((svg) =>
        Boolean(svg.closest("[aria-label]")),
      );
      return marks.map((svg) => svg.closest("[aria-label]")?.getAttribute("aria-label") ?? "");
    }),
  [ME.id, ANNA.id]);
  expect(
    labels[0],
    "a screen reader lost the fact that this person owns the group",
  ).toContain("Владелец группы");
  expect(labels[1]).toContain("Администратор группы");
});

test("the card stacks the group's words above LETSCUBE's", async ({ page }, info) => {
  await openMembers(page, store());
  await intoMembers(page);
  await row(page, ANNA).getByTestId("chat-info-member-open").click();
  await expect(page.getByTestId("member-card-joined")).toBeVisible();

  const group = page.getByTestId("member-card-group-roles");
  await expect(group).toBeVisible();
  // Both of them here, not just the highest: the card is about the person.
  await expect(group).toContainText("Наставник");
  await expect(group).toContainText("Дежурный");

  // Group first, LETSCUBE second — Discord's popout order. Measured by
  // position rather than by reading the source, because a flex-column's order
  // is a fact about the rendered box.
  const order = await page.evaluate(() => {
    const roles = document.querySelector('[data-testid="member-card-group-roles"]');
    const badges = document.querySelector('[data-testid="member-card-badges"]');
    if (!roles) return null;
    return {
      rolesTop: roles.getBoundingClientRect().top,
      badgesTop: badges ? badges.getBoundingClientRect().top : null,
    };
  });
  expect(order).not.toBeNull();
  if (order?.badgesTop !== null && order?.badgesTop !== undefined) {
    expect(order.rolesTop, "LETSCUBE's badges are above the group's roles").toBeLessThan(
      order.badgesTop,
    );
  }

  await bootInTheme(page, "light");
  await intoMembers(page);
  await row(page, ANNA).getByTestId("chat-info-member-open").click();
  await expect(page.getByTestId("member-card-group-roles")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(350);
  await page.getByTestId("chat-info-panel").screenshot({ path: shotPath(info, "card-light") });
});

test("a member reads the vocabulary and is offered nothing to press", async ({ page }) => {
  // The SELECT policy is `is_chat_member` and the write policy is
  // `is_chat_owner`. Hiding the list from a member is wrong in one direction
  // and offering them «Новая роль» is wrong in the other, and only one of those
  // produces a 403 nobody can explain.
  await openMembers(page, store(), OLGA, "member");
  await page.getByTestId("chat-info-roles").click();
  const modal = page.getByTestId("chat-roles-modal");
  await expect(modal).toBeVisible();
  await expect(modal).toContainText("Основатель");
  await expect(modal.getByTestId("chat-roles-new")).toHaveCount(0);
  await expect(modal.getByTestId("chat-roles-edit")).toHaveCount(0);
  await expect(modal.getByTestId("chat-roles-denial")).toContainText("владелец");
});

test("the owner can name a new one, and the row that is sent is the row the table takes", async ({
  page,
}) => {
  const held = store();
  await openMembers(page, held);
  await page.getByTestId("chat-info-roles").click();
  await expect(page.getByTestId("chat-roles-modal")).toBeVisible();

  await page.getByTestId("chat-roles-new").click();
  const form = page.getByTestId("chat-roles-form");
  await expect(form).toBeVisible();

  // The duplicate is refused before it is sent, folded the way the unique index
  // folds it: `lower(btrim(name))`.
  await form.getByTestId("chat-roles-name").fill("  основатель ");
  await expect(form.getByTestId("chat-roles-name-taken")).toBeVisible();
  await expect(page.getByTestId("chat-roles-save")).toBeDisabled();

  await form.getByTestId("chat-roles-name").fill("Дежурный по кухне");
  await form.getByTestId("chat-roles-colour-green").click();
  await form.getByTestId("chat-roles-icon-check").click();
  await expect(page.getByTestId("chat-roles-save")).toBeEnabled();
  await page.getByTestId("chat-roles-save").click();

  await expect.poll(() => held.inserted.length, { timeout: 5_000 }).toBe(1);
  const sent = held.inserted[0];
  expect(sent.name, "the name reached the table untrimmed").toBe("Дежурный по кухне");
  expect(sent.colour).toBe("green");
  expect(sent.icon).toBe("check");
  expect(sent.chat_id).toBe(CHAT);
  expect(typeof sent.id, "the client did not choose the id, so it asked for the row back").toBe(
    "string",
  );
});

test("a name of thirty-three characters is refused where the CHECK would refuse it", async ({
  page,
}) => {
  const held = store();
  await openMembers(page, held);
  await page.getByTestId("chat-info-roles").click();
  await page.getByTestId("chat-roles-new").click();
  const form = page.getByTestId("chat-roles-form");
  await form.getByTestId("chat-roles-name").fill("О".repeat(33));
  await expect(form.getByTestId("chat-roles-name-error")).toBeVisible();
  await expect(page.getByTestId("chat-roles-save")).toBeDisabled();
  // Thirty-two is accepted, so the boundary is the database's and not one off.
  await form.getByTestId("chat-roles-name").fill("О".repeat(32));
  await expect(form.getByTestId("chat-roles-name-error")).toHaveCount(0);
  await expect(page.getByTestId("chat-roles-save")).toBeEnabled();
  expect(held.inserted.length, "nothing was sent while the form was being corrected").toBe(0);
});

test("an administrator hands a tag out without being able to invent one", async ({ page }) => {
  const held = store();
  await openMembers(page, held, ANNA, "admin");
  await intoMembers(page);
  await row(page, OLGA).getByTestId("chat-info-member-open").click();
  await expect(page.getByTestId("member-card-joined")).toBeVisible();

  const picker = page.getByTestId("member-card-role-picker");
  await expect(picker, "an administrator was offered nothing to hand out").toBeVisible();
  await picker.getByTestId("member-card-role-give").first().click();
  await expect.poll(() => held.inserted.length, { timeout: 5_000 }).toBe(1);
  expect(held.inserted[0].user_id).toBe(OLGA.id);
  expect(held.inserted[0].chat_id).toBe(CHAT);

  // And the screen that invents them is still read-only for this account.
  // «Назад» returns to the card's root, but the root remembers which tab it was
  // on — so the actions are behind «СВЕДЕНИЯ» again, not on screen. Worth the
  // extra line rather than a `force: true`: it is the walk a person takes.
  await page.getByTestId("chat-info-back").click();
  await page.getByTestId("chat-info-panel").getByText("СВЕДЕНИЯ", { exact: false }).first().click();
  await page.getByTestId("chat-info-roles").click();
  await expect(page.getByTestId("chat-roles-new")).toHaveCount(0);
});

for (const theme of ["dark", "light"] as const) {
  test(`the roles screen is photographed in the ${theme} theme`, async ({ page }, info) => {
    const held = store();
    await openMembers(page, held);
    await bootInTheme(page, theme);
    await page.getByTestId("chat-info-roles").click();
    await expect(page.getByTestId("chat-roles-modal")).toBeVisible();
    await page.getByTestId("chat-roles-new").click();
    await expect(page.getByTestId("chat-roles-form")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    await page.screenshot({ path: shotPath(info, `screen-${theme}`), fullPage: false });
  });

  test(`the member list is photographed in the ${theme} theme`, async ({ page }, info) => {
    const held = store();
    await openMembers(page, held);
    await bootInTheme(page, theme);
    await intoMembers(page);
    await expect(row(page, ME)).toContainText("Основатель");
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(350);
    await page.getByTestId("chat-info-panel").screenshot({ path: shotPath(info, `list-${theme}`) });
  });
}
