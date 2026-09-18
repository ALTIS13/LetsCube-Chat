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
  type Fixture,
  type Row,
} from "./helpers/messageActionsFixture";
import sharp from "sharp";
import { installRenderCounter, readRenderCounts, resetRenderCounts } from "./helpers/render-counter";
import {
  CHAT_ROLE_COLOUR_KEYS,
  chatRoleColourOnChat,
  chatRoleColourValue,
} from "../../artifacts/kub/src/lib/chatRolePalette";

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

/* ─────────────────────────────────────────────────────────────────────────────
 * The author line of a message (D-180 slice 4, re-scoped by D-215).
 *
 * D-213's argument, applied one surface further along: a message is read inside
 * one conversation, so the standing beside it is the standing in THAT
 * conversation. Discord colours an author's name by their highest role in that
 * server and puts nothing else on the line — the role's word and its icon are
 * on the popout. The word is already in this group's member list and on the
 * person's card, which is where D-213 put it.
 *
 * **What each test here is a way to be wrong while looking right:**
 *
 *   5. **The colour is measured, not inferred.** A class name, a `style`
 *      attribute or a data attribute all prove the component ran; none proves a
 *      pixel changed. A `--kub-role-*` reference with no declaration behind it
 *      resolves to nothing and paints the inherited colour, which is exactly
 *      the silent failure `chatRolePalette.ts` is written against, so the
 *      assertion is `getComputedStyle().color` against a probe that resolves
 *      the same token in the same scope.
 *   6. **An untagged author is unchanged.** The accent colour has to be read
 *      from a probe inside the conversation rather than written down here:
 *      `.kub-chat-screen` re-points `--kub-accent-text` at
 *      `--kub-chat-accent-text`, so a literal in this file would pin the wrong
 *      value and pass anyway.
 *   7. **A private chat pays nothing.** `enforce_chat_role_scope` refuses a
 *      role there, so the request is not merely useless: it asks a question
 *      whose answer is guaranteed. Counted, not reasoned about.
 *   8. **Sixty messages cost what one costs.** The rule both
 *      `useProfileBadges` and `useChatRoles` state. A hook in the bubble is the
 *      obvious implementation and the counter is the only thing that sees it.
 * ────────────────────────────────────────────────────────────────────────── */

const PRIVATE_CHAT = "22222222-2222-4222-8222-000000000002";
/**
 * A fourth member who wears nothing and is signed in for the photographs.
 *
 * With one of the three as the reader their own messages move to the right and
 * lose their author line, so a frame taken as any of them can show at most two
 * of the three states. As Борис all three are on the left at once: a tagged
 * name, a second tagged name in another colour, and an untagged one in the
 * accent — which is the whole contract in one picture.
 */
const BORIS = person("11111111-1111-4111-8111-000000000004", "Борис Ильин");

/** What the conversation says. Fictional, and long enough to see. */
const SAID = [
  "Сегодня закрыли последнюю задачу по макету",
  "Проверю вечером и отпишусь",
  "Тогда переносим релиз на четверг",
  "Я подготовлю список изменений",
];

/** A run of messages that alternates authors, so every one of them draws a name. */
function conversation(
  chatId: string,
  authors: readonly (typeof ME)[],
  count: number,
): Row[] {
  const rows: Row[] = [];
  for (let index = 0; index < count; index += 1) {
    const who = authors[index % authors.length];
    const minute = String(index % 50).padStart(2, "0");
    rows.push(
      message(
        `55555555-5555-4555-8555-${String(index + 100).padStart(12, "0")}`,
        chatId,
        who,
        `${SAID[index % SAID.length]} (${index + 1})`,
        `2026-09-12T09:${minute}:00.000Z`,
      ),
    );
  }
  return rows;
}

/**
 * Open the group's conversation and keep the fixture, so its requests can be
 * counted. No member list, no card: this is the message list on its own.
 */
async function openConversationInGroup(
  page: Page,
  held: Store,
  messageCount: number,
  me: typeof ME = OLGA,
): Promise<Fixture> {
  const rows = conversation(CHAT, [ANNA, OLGA, ME], messageCount);
  const fixture = await openFixture(page, {
    me,
    people: [ME, ANNA, OLGA, BORIS].filter((who) => who.id !== me.id),
    chats: [chat(CHAT, "group", "Команда проекта", AT)],
    memberships: [
      membership(CHAT, ME, "owner", AT),
      membership(CHAT, ANNA, "admin", AT),
      membership(CHAT, OLGA, "member", AT),
      membership(CHAT, BORIS, "member", AT),
    ] as Row[],
    messages: rows,
    rest: restFor(held),
    rpc: (name) => (name === "search_chat_messages" ? missingFunction(name) : undefined),
  });
  await openChat(page, "Команда проекта", String(rows[0].content));
  await expect(page.locator(AUTHOR).first()).toBeVisible();
  return fixture;
}

const AUTHOR = '[data-message-author="true"]';

interface AuthorLineColour {
  actual: string;
  accent: string;
  /** Each palette key as the author line composes it for the wallpaper. */
  roles: Record<string, string>;
  /** Each palette key raw, which is what a panel surface would draw. */
  raw: Record<string, string>;
  tag: string;
}

/**
 * What every author line on screen is actually painted, and what the candidate
 * colours resolve to in that same place.
 *
 * The probe is appended beside the name rather than to `document.body`, because
 * both `--kub-accent-text` and every `--kub-role-*` are custom properties and
 * custom properties inherit: `.kub-chat-screen` re-points the accent at
 * `--kub-chat-accent-text` for the whole chat pane, so a probe outside it
 * answers a different question than the one being asked.
 */
async function authorLineColours(page: Page): Promise<Record<string, AuthorLineColour>> {
  return await page.evaluate(
    ({ composed, plain, selector }) => {
      const out: Record<string, AuthorLineColour> = {};
      for (const node of [...document.querySelectorAll(selector)]) {
        const element = node as HTMLElement;
        const name = (element.textContent ?? "").trim();
        if (!name || out[name]) continue;
        const probe = document.createElement("span");
        probe.style.position = "absolute";
        probe.style.visibility = "hidden";
        element.parentElement?.appendChild(probe);
        const resolve = (value: string) => {
          probe.style.color = value;
          return getComputedStyle(probe).color;
        };
        const roles: Record<string, string> = {};
        const raw: Record<string, string> = {};
        for (const [key, expression] of Object.entries(composed)) roles[key] = resolve(expression);
        for (const [key, expression] of Object.entries(plain)) raw[key] = resolve(expression);
        out[name] = {
          actual: getComputedStyle(element).color,
          accent: resolve("var(--kub-accent-text)"),
          roles,
          raw,
          tag: element.getAttribute("data-author-chat-role") ?? "",
        };
        probe.remove();
      }
      return out;
    },
    {
      selector: AUTHOR,
      // The expressions are built by the palette module, never spelled here:
      // a token name written by hand in a test is a test that stays green while
      // the product paints nothing.
      composed: Object.fromEntries(
        CHAT_ROLE_COLOUR_KEYS.map((key) => [key, chatRoleColourOnChat(key)]),
      ) as Record<string, string>,
      plain: Object.fromEntries(
        CHAT_ROLE_COLOUR_KEYS.map((key) => [key, chatRoleColourValue(key)]),
      ) as Record<string, string>,
    },
  );
}

test("an author's name is painted in this group's own colour for them", async ({ page }) => {
  await openConversationInGroup(page, store(), 6);
  const colours = await authorLineColours(page);

  // Анна wears «Наставник» (teal) and «Дежурный» (violet); the higher priority
  // decides, exactly as `orderChatRoles` decided it for the member row.
  const anna = colours[ANNA.full_name];
  expect(anna, `no author line for ${ANNA.full_name}: ${Object.keys(colours).join(", ")}`).toBeTruthy();
  expect(
    anna.actual,
    `the name is ${anna.actual}; «Наставник» is teal ${anna.roles.teal} and the accent is ${anna.accent}`,
  ).toBe(anna.roles.teal);
  expect(anna.actual, "the colour is the accent, so nothing was applied").not.toBe(anna.accent);
  expect(anna.actual, "the LOWER of the two tags won").not.toBe(anna.roles.violet);
  expect(anna.tag, "the line does not say which tag decided it").toBe(ROLES[1].id);
  // And it is the wallpaper's composition rather than the raw token. The two
  // differ by 20% of `--kub-text`, which is what stands between a readable name
  // and 3.65:1 at the bottom of a light-theme conversation — see
  // `chatRoleColourOnChat`.
  expect(
    anna.actual,
    "the raw palette token reached the wallpaper, where it measures under 4.5:1 in the light theme",
  ).not.toBe(anna.raw.teal);

  // Максим owns the group and wears «Основатель» (amber).
  const maksim = colours[ME.full_name];
  expect(maksim).toBeTruthy();
  expect(maksim.actual).toBe(maksim.roles.amber);
});

test("an author with no tag keeps the colour every name used to have", async ({ page }) => {
  // Signed in as Анна, so Ольга — who wears nothing — is one of the names read.
  await openConversationInGroup(page, store(), 6, ANNA);
  const colours = await authorLineColours(page);

  const olga = colours[OLGA.full_name];
  expect(olga, `no author line for ${OLGA.full_name}: ${Object.keys(colours).join(", ")}`).toBeTruthy();
  expect(olga.actual, "an untagged author was repainted").toBe(olga.accent);
  expect(olga.tag, "an untagged author's line names a tag").toBe("");
  for (const [key, value] of Object.entries(olga.roles)) {
    // Not a tautology: the accent and every palette entry are different
    // colours, so this also proves the probe resolves real values rather than
    // falling back to the inherited one for all of them.
    expect(olga.actual, `an untagged author is painted the palette's "${key}"`).not.toBe(value);
  }
});

test("a private conversation draws no colour and does not ask the question", async ({ page }) => {
  const held = store();
  const rows = conversation(PRIVATE_CHAT, [ANNA, ME], 6);
  const fixture = await openFixture(page, {
    me: ME,
    people: [ANNA],
    chats: [chat(PRIVATE_CHAT, "private", null, AT)],
    memberships: [
      // Both sides carry `owner`, which is the 2026-09-11 artefact and the
      // reason `enforce_chat_role_scope` exists: `is_chat_owner` is true here
      // for a conversation that must never have roles.
      membership(PRIVATE_CHAT, ME, "owner", AT),
      membership(PRIVATE_CHAT, ANNA, "owner", AT),
    ] as Row[],
    messages: rows,
    rest: restFor(held),
    rpc: (name) => (name === "search_chat_messages" ? missingFunction(name) : undefined),
  });
  await openChat(page, ANNA.full_name, String(rows[0].content));
  await expect(page.locator(AUTHOR).first()).toBeVisible();

  const colours = await authorLineColours(page);
  const anna = colours[ANNA.full_name];
  expect(anna).toBeTruthy();
  // Soft, so that a failure here does not hide the count below. This test
  // carries two independent claims — nothing is painted, and nothing is asked —
  // and a mutation that breaks the first would otherwise stop the run before
  // the second was ever measured.
  expect.soft(anna.actual, "a private chat painted an author's name").toBe(anna.accent);
  expect.soft(anna.tag).toBe("");

  // The whole point. A request here is not merely wasted: the answer is
  // guaranteed empty by a trigger, and it would be one per private conversation
  // anybody opens.
  //
  // Settled first, so this cannot pass by being early: the membership read
  // happens on every chat open, so waiting for it means this screen's reads are
  // done.
  await expect.poll(() => fixture.restCalls("chat_members").length, { timeout: 5_000 }).toBeGreaterThan(0);
  expect(
    fixture.restCalls("chat_roles").length,
    `a private chat asked chat_roles ${fixture.restCalls("chat_roles").length} time(s)`,
  ).toBe(0);
  expect(fixture.restCalls("chat_member_roles").length).toBe(0);
  expect(held.roles.length, "the fixture's own rows were never touched").toBe(ROLES.length);
});

test("a conversation of sixty messages costs what a conversation of one costs", async ({ page }) => {
  // One message first, to establish what a conversation costs at all.
  const one = await openConversationInGroup(page, store(), 1);
  await expect
    .poll(() => one.restCalls("chat_roles", "GET").length, { timeout: 5_000 })
    .toBeGreaterThan(0);
  const single = {
    roles: one.restCalls("chat_roles", "GET").length,
    tags: one.restCalls("chat_member_roles", "GET").length,
  };
  expect(single.roles, "one conversation is more than one read of the vocabulary").toBe(1);
  expect(single.tags).toBe(1);

  // Sixty messages from three authors: sixty author lines, three tagged people.
  // A hook in the bubble would make this sixty; a hook keyed on the author would
  // make it three. Both are the mistake this is written against.
  const many = await openConversationInGroup(page, store(), 60);
  await expect
    .poll(() => many.restCalls("chat_roles", "GET").length, { timeout: 5_000 })
    .toBeGreaterThan(0);
  const drawn = await page.locator(AUTHOR).count();
  expect(drawn, "the conversation drew too few author lines for this to prove anything").toBeGreaterThan(20);

  expect(
    many.restCalls("chat_roles", "GET").length,
    `${drawn} author lines cost ${many.restCalls("chat_roles", "GET").length} reads of chat_roles ` +
      `against ${single.roles} for a single message`,
  ).toBe(single.roles);
  expect(many.restCalls("chat_member_roles", "GET").length).toBe(single.tags);
});

test("opening the card beside the conversation does not ask a second time", async ({ page }) => {
  // `ChatInfoPanel` read the two tables itself until the author line needed the
  // same answer. Both are children of `ChatWindow` and on a wide window both are
  // on screen at once, so leaving the panel's own mount in place would have
  // doubled every conversation's cost the moment somebody opened the card.
  const fixture = await openConversationInGroup(page, store(), 6, ME);
  await expect.poll(() => fixture.restCalls("chat_roles", "GET").length, { timeout: 5_000 }).toBe(1);

  await page.getByTestId("chat-header-info-button").click();
  await expect(page.getByTestId("chat-info-panel")).toBeVisible();
  await intoMembers(page);
  // The member list is drawn from the same read: this is what says the panel is
  // using the answer rather than quietly having none.
  await expect(row(page, ANNA).getByTestId("chat-info-member-secondary")).toContainText("Наставник");

  expect(
    fixture.restCalls("chat_roles", "GET").length,
    "the card mounted a second reader of the same two tables",
  ).toBe(1);
  expect(fixture.restCalls("chat_member_roles", "GET").length).toBe(1);
});

test("a conversation that renders again does not render its bubbles again", async ({ page }) => {
  // `message-render-stability.spec.ts` guards the conversation on the DEV
  // capture page, which renders `MessageList` with no roles at all — so it
  // cannot see this prop. The hazard a map prop invites is a fresh `ChatRole`
  // object per read: the rows are memoised on `Object.is`, so a copy handed
  // down would render every bubble on screen every time `ChatWindow` renders,
  // for a colour that did not change.
  //
  // The provocation is text long enough to WRAP the composer, which is the one
  // `message-render-stability.spec.ts` uses and the only one of three tried
  // here that reaches this component. A short word does not: the draft lives in
  // the composer's own state and `ChatWindow` never renders, so the first
  // version of this test stayed green under the very mutation it was written to
  // catch. Neither does a height-only viewport change. Hence the ChatWindow
  // count below — zero bubbles means nothing unless something did render.
  await installRenderCounter(page, ["ChatWindow", "MessageList", "MessageBubble"]);
  const fixture = await openConversationInGroup(page, store(), 12, BORIS);
  await expect.poll(() => fixture.restCalls("chat_roles", "GET").length, { timeout: 5_000 }).toBe(1);
  // The colour is on screen, so the answer has been applied and not merely
  // fetched — otherwise this would measure the quiet before the work.
  await expect
    .poll(async () => page.locator(`${AUTHOR}[data-author-chat-role="${ROLES[1].id}"]`).count(), {
      timeout: 5_000,
    })
    .toBeGreaterThan(0);
  await page.waitForTimeout(600);

  await resetRenderCounts(page);
  const composer = page.getByRole("textbox", { name: /Сообщение/i });
  await composer.click();
  await composer.fill(`${SAID[0]} ${SAID[1]} ${SAID[2]} ${SAID[3]} ${SAID[0]} ${SAID[1]}`);
  await page.waitForTimeout(400);
  await composer.fill("");
  await page.waitForTimeout(400);

  const counts = await readRenderCounts(page);
  expect(
    counts.counts.ChatWindow,
    "the conversation never rendered again, so a count of zero bubbles proves nothing",
  ).toBeGreaterThan(0);
  expect(
    counts.counts.MessageBubble,
    `${counts.counts.MessageBubble} bubbles rendered across ${counts.counts.ChatWindow} renders of the ` +
      `conversation, with no message changed. A copied ChatRole is the usual cause: the row's memo ` +
      `compares with Object.is and a copy is never equal.`,
  ).toBe(0);
});

for (const theme of ["dark", "light"] as const) {
  test(`the conversation's author lines are photographed in the ${theme} theme`, async ({ page }, info) => {
    await openConversationInGroup(page, store(), 8, BORIS);
    // The same walk `bootInTheme` takes, and for the same recorded reason: the
    // fixture writes `kub-theme = "dark"` in an init script, and init scripts
    // run in registration order, so the theme has to be registered after
    // `openFixture` and reached by a reload rather than by stamping a class.
    await page.addInitScript((value) => localStorage.setItem("kub-theme", value as string), theme);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.classList.contains("dark")), {
        timeout: 5_000,
      })
      .toBe(theme === "dark");
    await openChat(page, "Команда проекта", `${SAID[0]} (1)`);
    await expect(page.locator(AUTHOR).first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    await page.screenshot({ path: shotPath(info, `authors-${theme}`), fullPage: false });
  });
}

/* ─────────────────────────────────────────────────────────────────────────────
 * The conversation's wallpaper is a fourth surface, and it is measured here.
 *
 * `tests/unit/chat-role-palette.test.mts` holds every palette entry at 4.5:1 on
 * `--kub-surface`, `--kub-surface-2` and `--kub-surface-3`. An author's name
 * sits on none of them: it sits on `.chat-bg`, which is `--kub-chat-ground`
 * under `--kub-chat-wallpaper` — a gradient with three coloured radials over
 * it. In the LIGHT theme that composite is darker than all three panel
 * surfaces, and darkest at the bottom left, which is exactly where author names
 * are. Measured there, the raw tokens read 3.65 to 4.57; `chatRoleColourOnChat`
 * is why they read 4.71 to 6.59 instead.
 *
 * None of that is knowable from the tokens, because the ground under a name is
 * a composite of five background layers at that pixel. So this reads the
 * PHOTOGRAPH: the modal colour inside each name's own box is the ground between
 * its letters, and the name's own computed colour is the ink. That is the same
 * method `docs/operations/interface-material.md` rule 7 requires of a
 * translucent surface, for the same reason — what a token promises and what
 * reaches the reader are different claims.
 * ────────────────────────────────────────────────────────────────────────── */

/** A word needs this much. Not the 3:1 a dot or a border answers to. */
const NAME_CONTRAST_FLOOR = 4.5;

const PALETTE_PEOPLE = CHAT_ROLE_COLOUR_KEYS.map((key, index) =>
  person(`44444444-4444-4444-8444-0000000000${String(index + 10)}`, `Участник ${key}`),
);
const PALETTE_ROLES: Row[] = CHAT_ROLE_COLOUR_KEYS.map((key, index) => ({
  id: `66666666-6666-4666-8666-0000000000${String(index + 10)}`,
  chat_id: CHAT,
  name: `Роль ${key}`,
  colour: key,
  icon: null,
  // Each person wears exactly one, so priority only has to be stable.
  priority: 100 - index,
  created_at: AT,
}));
const PALETTE_TAGS: Row[] = PALETTE_PEOPLE.map((who, index) => ({
  chat_id: CHAT,
  user_id: who.id,
  role_id: PALETTE_ROLES[index].id,
}));

function channel(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance, the same arithmetic the unit contrast tests use. */
function luminance([r, g, b]: readonly [number, number, number]): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(
  ink: readonly [number, number, number],
  ground: readonly [number, number, number],
): number {
  const a = luminance(ink);
  const b = luminance(ground);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * A computed colour, whichever notation the engine chose.
 *
 * `color-mix()` computes to `color(srgb r g b)` with fractional channels in
 * Chromium rather than to `rgb()`. A parser that only knows `rgb()` reads the
 * first three numbers of «color(srgb 0.68 0.72 0.77)» as 0, 68 and 72 — which
 * is not an error, just a wrong colour, and the first run of this measurement
 * reported ratios in the hundreds of millions because of it.
 */
function parseColour(value: string): [number, number, number] {
  const srgb = value.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (srgb) {
    return [1, 2, 3].map((index) => Math.round(Number(srgb[index]) * 255)) as [number, number, number];
  }
  const numbers = value.match(/[\d.]+/g);
  expect(numbers, `a colour this test cannot read: ${value}`).not.toBeNull();
  return numbers!.slice(0, 3).map(Number) as [number, number, number];
}

for (const theme of ["dark", "light"] as const) {
  test(`every role colour clears 4.5:1 on the conversation's own wallpaper in the ${theme} theme`, async ({
    page,
  }, info) => {
    const rows: Row[] = [];
    for (let index = 0; index < 32; index += 1) {
      rows.push(
        message(
          `77777777-7777-4777-8777-${String(index + 100).padStart(12, "0")}`,
          CHAT,
          PALETTE_PEOPLE[index % PALETTE_PEOPLE.length],
          `${SAID[index % SAID.length]} (${index + 1})`,
          `2026-09-12T09:${String(index).padStart(2, "0")}:00.000Z`,
        ),
      );
    }
    await openFixture(page, {
      me: BORIS,
      people: PALETTE_PEOPLE,
      chats: [chat(CHAT, "group", "Команда проекта", AT)],
      memberships: [
        membership(CHAT, BORIS, "owner", AT),
        ...PALETTE_PEOPLE.map((who) => membership(CHAT, who, "member", AT)),
      ] as Row[],
      messages: rows,
      rest: ({ resource, method }) => {
        if (resource === "chat_roles" && method === "GET") return { status: 200, body: PALETTE_ROLES };
        if (resource === "chat_member_roles" && method === "GET") {
          return { status: 200, body: PALETTE_TAGS };
        }
        return undefined;
      },
      rpc: (name) => (name === "search_chat_messages" ? missingFunction(name) : undefined),
    });
    await page.addInitScript((value) => localStorage.setItem("kub-theme", value as string), theme);
    await openChat(page, "Команда проекта", `${SAID[0]} (1)`);
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.classList.contains("dark")), {
        timeout: 5_000,
      })
      .toBe(theme === "dark");
    await expect(page.locator(AUTHOR).first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);

    const drawn = await page.evaluate(({ selector, composed }) => {
      const probe = document.createElement("span");
      probe.style.position = "absolute";
      probe.style.visibility = "hidden";
      const out: {
        name: string;
        tag: string;
        colour: string;
        wanted: string;
        box: { x: number; y: number; w: number; h: number };
      }[] = [];
      for (const node of [...document.querySelectorAll(selector)]) {
        const element = node as HTMLElement;
        const rect = element.getBoundingClientRect();
        // Only a name wholly on screen: a clipped box would sample the chrome.
        if (rect.width < 8 || rect.height < 8) continue;
        if (rect.y < 0 || rect.y + rect.height > window.innerHeight) continue;
        // What this person's key SHOULD compose to, resolved right here so the
        // comparison is between two computed colours rather than between a
        // computed colour and a string this file wrote down.
        const key = (element.textContent ?? "").trim().replace(/^Участник\s+/, "");
        element.parentElement?.appendChild(probe);
        probe.style.color = composed[key] ?? "";
        const wanted = composed[key] ? getComputedStyle(probe).color : "";
        probe.remove();
        out.push({
          name: (element.textContent ?? "").trim(),
          tag: element.getAttribute("data-author-chat-role") ?? "",
          colour: getComputedStyle(element).color,
          wanted,
          box: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
        });
      }
      return out;
    }, {
      selector: AUTHOR,
      composed: Object.fromEntries(
        CHAT_ROLE_COLOUR_KEYS.map((key) => [key, chatRoleColourOnChat(key)]),
      ) as Record<string, string>,
    });
    expect(drawn.length, "no author line was measurable, so this test proved nothing").toBeGreaterThan(3);

    const shot = await page.screenshot();
    const raw = await sharp(shot).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width, channels } = raw.info;
    // The device pixel ratio, because a phone project photographs at 2.625x and
    // a CSS box would otherwise index the wrong pixels entirely.
    const scale = Math.round((width / (page.viewportSize()?.width ?? width)) * 1000) / 1000;

    const measured: { key: string; ratio: number; ground: string; y: number }[] = [];
    for (const entry of drawn) {
      expect(entry.tag, `«${entry.name}» wears a tag but the line names none`).not.toBe("");
      // Bound to the mechanic, not only to the ratio: without this the whole
      // measurement passes on a build that applies no role colour at all,
      // because `--kub-chat-accent-text` is comfortable on this wallpaper. The
      // ratio answers «is it readable»; this answers «is it the role's».
      // Soft, so the ratio below is still measured when this fires. The two are
      // separate claims — «it is the role's colour» and «it is readable there» —
      // and with this hard, dropping the composition would stop the run before
      // the number that justifies the composition was ever taken.
      expect.soft(
        entry.colour,
        `«${entry.name}» is drawn ${entry.colour}, which is not what its own palette key composes to`,
      ).toBe(entry.wanted);
      const left = Math.round(entry.box.x * scale);
      const top = Math.round(entry.box.y * scale);
      const right = Math.round((entry.box.x + entry.box.w) * scale);
      const bottom = Math.round((entry.box.y + entry.box.h) * scale);
      // The most common pixel inside the name's own box, with the ink and its
      // near-blends thrown out first, is the ground between the letters.
      //
      // Throwing the ink out is not tidiness. Without it this measured 1.00:1
      // for most names at 390 and passed at 1440, which is the worst kind of
      // wrong: on a 2.625x device the glyph strokes are three device pixels of
      // one flat colour while the wallpaper's gradient and its pattern give the
      // background dozens of near-identical shades, so the INK wins the tally
      // and every name appears to be drawn on itself. Anti-aliased blends are
      // spread across many levels and no single one of them is modal.
      const ink = parseColour(entry.colour);
      const tally = new Map<string, number>();
      for (let y = top; y < bottom; y += 1) {
        for (let x = left; x < right; x += 1) {
          const at = (y * width + x) * channels;
          const pixel = [raw.data[at], raw.data[at + 1], raw.data[at + 2]] as const;
          const isInk = pixel.every((value, channel) => Math.abs(value - ink[channel]) <= 24);
          if (isInk) continue;
          const key = pixel.join(",");
          tally.set(key, (tally.get(key) ?? 0) + 1);
        }
      }
      expect(tally.size, `«${entry.name}» has no pixel that is not its own ink`).toBeGreaterThan(0);
      const ground = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const ratio = contrastRatio(ink, ground.split(",").map(Number) as [number, number, number]);
      measured.push({ key: entry.name, ratio, ground, y: Math.round(entry.box.y) });
    }

    const worst = measured.reduce((held, entry) => (entry.ratio < held.ratio ? entry : held));
    expect.soft(
      worst.ratio,
      `«${worst.key}» is drawn at ${worst.ratio.toFixed(2)}:1 on rgb(${worst.ground}) at y=${worst.y}. ` +
        `The palette is pinned at 4.5:1 on the three PANEL surfaces; this is the wallpaper, which in ` +
        `the light theme is darker than all of them. Either the composition in ` +
        `chatRoleColourOnChat() was dropped or one of the two grounds moved. ` +
        `All measured: ${measured.map((entry) => `${entry.key}=${entry.ratio.toFixed(2)}`).join(", ")}`,
    ).toBeGreaterThanOrEqual(NAME_CONTRAST_FLOOR);

    await page.screenshot({ path: shotPath(info, `palette-${theme}`), fullPage: false });
  });
}
