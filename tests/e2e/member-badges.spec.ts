import { expect, type Page, type TestInfo, test } from "@playwright/test";
import {
  chat,
  type Fixture,
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
 * D-180, slice 3: a group's member list says who these people are.
 *
 * Until today it said one thing about two of them — «Владелец» or
 * «Администратор», meaning this chat — and nothing at all about anybody else. An
 * administrator of LETSCUBE and somebody who arrived yesterday were the same two
 * lines of text. Slice 1 opened the read path; this is the surface where most
 * people are actually seen.
 *
 * Three things are worth a test here rather than a look, and each is a way this
 * could be built wrong while looking right:
 *
 *   1. **No query per row.** The member ids are already in hand where the list
 *      is built, so a list of twenty people must cost one `profile_badges` call.
 *      The fixture records every request, so the count is measured rather than
 *      reasoned about.
 *   2. **Nothing for nothing.** A member wearing no badge must keep the row they
 *      have always had — no empty strip, no second line, no extra height on
 *      every row in the product for a fact nobody has.
 *   3. **One glyph, one meaning.** The catalogues were seeded months apart:
 *      `shield` is the administrator's role icon and also what «Тестировщик»
 *      names, so a single row would have carried two shields meaning different
 *      things. That is resolved in `lib/badgeVocabulary.ts` and checked here on
 *      the rendered markup, because a table saying «key» proves nothing about
 *      what a browser drew.
 *
 * Everything here is fictional and mocked. No production screen is rendered.
 */

const AT = "2026-09-12T09:00:00.000Z";
/** The chat's owner, and LETSCUBE's owner: the row where both words appear. */
const ME = person("11111111-1111-4111-8111-000000000001", "Максим Орлов");
/** The chat's administrator, who is also a tester — the shield collision. */
const ANNA = person("11111111-1111-4111-8111-000000000002", "Анна Смирнова");
/** An ordinary member with more medals than a row has room for. */
const PETR = person("11111111-1111-4111-8111-000000000003", "Пётр Ильин");
/** An ordinary member wearing nothing at all. */
const OLGA = person("11111111-1111-4111-8111-000000000004", "Ольга Крылова");
const CHAT_TEAM = "22222222-2222-4222-8222-000000000001";
const LINES = ["Макет главной готов, посмотрите", "Смета на витрину готова, посмотри"];

const badge = (
  who: { id: string },
  kind: "global_role" | "achievement",
  key: string,
  title: string,
  detail: string,
  icon: string,
  rank: number,
) => ({ user_id: who.id, kind, key, title, detail, icon, colour: null, rank });

/**
 * What `profile_badges` answers, with the icons the database really holds.
 *
 * The seeded names are used deliberately — `crown` for «Ветеран», `shield` for
 * «Тестировщик» — so this spec exercises the collision rather than a catalogue
 * somebody already repaired.
 */
const BADGE_ROWS = [
  badge(ME, "global_role", "owner", "Владелец", "Полный доступ ко всему LETSCUBE", "crown", 100),
  badge(ANNA, "global_role", "admin", "Администратор", "Управление людьми", "shield", 80),
  badge(
    ANNA,
    "achievement",
    "tester",
    "Тестировщик",
    "Был здесь до первых приложений",
    "shield",
    100000 - 10,
  ),
  badge(ANNA, "achievement", "veteran", "Ветеран", "В LETSCUBE больше года", "crown", 100000 - 40),
  badge(PETR, "global_role", "manager", "Менеджер", "Рабочие разделы", "manager", 60),
  badge(
    PETR,
    "achievement",
    "settled_in",
    "Освоился",
    "В LETSCUBE больше месяца",
    "check",
    100000 - 30,
  ),
  badge(
    PETR,
    "achievement",
    "conversationalist",
    "Собеседник",
    "Отправил 100 сообщений",
    "chats",
    100000 - 50,
  ),
  badge(
    PETR,
    "achievement",
    "storyteller",
    "Рассказчик",
    "Отправил 1000 сообщений",
    "chatRect",
    100000 - 60,
  ),
];

function rows(): { chats: Row[]; memberships: Row[]; messages: Row[] } {
  return {
    chats: [chat(CHAT_TEAM, "group", "Команда проекта", AT)],
    memberships: [
      membership(CHAT_TEAM, ME, "owner", AT),
      membership(CHAT_TEAM, ANNA, "admin", AT),
      membership(CHAT_TEAM, PETR, "member", AT),
      membership(CHAT_TEAM, OLGA, "member", AT),
    ],
    messages: LINES.map((text, index) =>
      message(
        "55555555-5555-4555-8555-" + String(index + 1).padStart(12, "0"),
        CHAT_TEAM,
        index === 0 ? ME : ANNA,
        text,
        new Date(Date.UTC(2026, 8, 12, 10, index * 7)).toISOString(),
      ),
    ),
  };
}

async function openMembers(page: Page, badges: unknown[] = BADGE_ROWS): Promise<Fixture> {
  const seed = rows();
  const fixture = await openFixture(page, {
    me: ME,
    chats: seed.chats,
    memberships: seed.memberships,
    messages: seed.messages,
    rpc: (name) => {
      // The helper answers with an envelope, not a bare body.
      if (name === "profile_badges") return { body: badges };
      if (name === "search_chat_messages") return missingFunction(name);
      return undefined;
    },
  });
  await openChat(page, "Команда проекта", LINES[0]);
  await page.getByTestId("chat-header-info-button").click();
  const panel = page.getByTestId("chat-info-panel");
  await expect(panel).toBeVisible();
  // Scoped to the panel: unscoped, «УЧАСТНИКИ» also matches the conversation.
  await panel.getByText("УЧАСТНИКИ", { exact: false }).first().click();
  await expect(page.getByTestId("chat-info-member").first()).toBeVisible();
  return fixture;
}

const row = (page: Page, who: { id: string }) =>
  page.locator(`[data-testid="chat-info-member"][data-member-id="${who.id}"]`);

const chips = (page: Page, who: { id: string }) => row(page, who).locator("[data-badge-key]");

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
  return `output/member-badges/${name}-${info.project.name}.png`;
}

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

test("the whole list is answered for in one request, not one per row", async ({ page }) => {
  const fixture = await openMembers(page);
  await expect(chips(page, ANNA).first()).toBeVisible();

  const calls = fixture.rpcBodies("profile_badges");
  expect(
    calls.length,
    "a badge strip that costs a round trip per member is a member list that costs twenty",
  ).toBe(1);

  // And it asked about everybody, so «one call» is not «one call for one person
  // and the others quietly left blank».
  const asked = calls[0].p_user_ids as string[];
  expect([...asked].sort()).toEqual([ME.id, ANNA.id, PETR.id, OLGA.id].sort());
});

test("the chat's own role and the person's standing stand side by side, each saying which it is", async ({
  page,
}, info) => {
  await openMembers(page);

  // The row that would have read «Владелец Владелец»: this chat's owner, who is
  // also LETSCUBE's. The second line names the chat; the chip does not.
  const mine = row(page, ME);
  await expect(mine).toContainText("Владелец группы");
  await expect(chips(page, ME)).toHaveCount(1);
  await expect(chips(page, ME).first()).toContainText("Владелец");

  await expect(row(page, ANNA)).toContainText("Администратор группы");

  // The fixture signs in with the dark theme stored, so the light one has to be
  // stamped or both screenshots come out the same file — which is how the first
  // pair of these was taken, and they were byte-identical.
  await stampTheme(page, "light");
  await page.getByTestId("chat-info-panel").screenshot({ path: shotPath(info, "light") });
});

test("a shield does not mean two things in one row", async ({ page }) => {
  await openMembers(page);

  // Анна is this chat's administrator — a `shield` role — and a «Тестировщик»,
  // whose catalogue row also names `shield`. Before the vocabulary resolved it,
  // the same glyph stood twice on one line meaning two different things.
  const standing = chips(page, ANNA).filter({ hasText: "Администратор" });
  const tester = chips(page, ANNA).filter({ hasText: "Тестировщик" });
  await expect(standing).toHaveCount(1);
  await expect(tester).toHaveCount(1);

  await expect(standing).toHaveAttribute("data-badge-icon", "shield");
  await expect(tester).toHaveAttribute("data-badge-icon", "key");
  // «Ветеран» is counted rather than drawn — the row shows one medal — and its
  // own glyph is pinned in `tests/unit/badge-vocabulary.test.mts`.
  await expect(row(page, ANNA)).toContainText("+1");

  // And the same question asked of what the browser drew, because an attribute
  // naming «key» proves only that this component agrees with itself.
  const drawn = await page.evaluate((memberId) => {
    const line = document.querySelector(`[data-member-id="${memberId}"]`);
    const glyphs = [...(line?.querySelectorAll("[data-badge-key] svg") ?? [])];
    return glyphs.map((svg) => svg.innerHTML);
  }, ANNA.id);
  expect(drawn.length, "every chip in this row carries a glyph").toBe(2);
  expect(new Set(drawn).size, "two chips in one row are drawing the same picture").toBe(2);
});

test("a row with more than it can show counts the rest instead of dropping them", async ({
  page,
}) => {
  await openMembers(page);
  // One standing and one medal is the room a name has beside it — lowered from
  // the proposal's two after looking at the rendered list at 390, where a second
  // medal wrapped every decorated row onto a third line. Пётр holds four badges;
  // the two that do not fit are counted rather than quietly lost.
  await expect(chips(page, PETR)).toHaveCount(2);
  await expect(row(page, PETR)).toContainText("Менеджер");
  await expect(row(page, PETR)).toContainText("+2");
});

test("somebody wearing nothing keeps the row they always had", async ({ page }) => {
  await openMembers(page);

  const plain = row(page, OLGA);
  await expect(plain).toBeVisible();
  // No strip, and no line to put one on. An empty strip would render as nothing
  // at all — and «Без роли» would be a claim where there is only a gap.
  await expect(plain.getByTestId("chat-info-member-badges")).toHaveCount(0);
  await expect(plain.getByTestId("chat-info-member-standing")).toHaveCount(0);
  await expect(row(page, ANNA).getByTestId("chat-info-member-standing")).toHaveCount(1);

  // And the row is really shorter, rather than merely emptier: an invisible
  // second line would cost every ordinary member height for nothing.
  const heights = await page.evaluate(
    (ids) =>
      ids.map(
        (id) =>
          document.querySelector(`[data-member-id="${id}"]`)?.getBoundingClientRect().height ?? -1,
      ),
    [OLGA.id, ANNA.id],
  );
  expect(heights[0]).toBeGreaterThan(0);
  expect(heights[0]).toBeLessThan(heights[1]);
});

test("the badge's colour never reaches the words", async ({ page }) => {
  await openMembers(page);
  // Measured rather than asserted from the source. The role tones read 4.05,
  // 4.18 and 3.82 against the surfaces a chip sits on, under the 4.5 a label
  // needs, so the tone lives on the border and the dot and the word takes the
  // interface text colour — the same colour the member's name is drawn in.
  const colours = await page.evaluate((memberId) => {
    const line = document.querySelector(`[data-member-id="${memberId}"]`);
    const name = line?.querySelector("span.truncate");
    const chip = line?.querySelector("[data-badge-key]");
    const text = chip
      ? [...chip.childNodes].find((node) => node.nodeType === Node.TEXT_NODE)
      : null;
    return {
      name: name ? getComputedStyle(name).color : null,
      chip: chip ? getComputedStyle(chip as Element).color : null,
      hasText: Boolean(text && (text.textContent ?? "").trim()),
    };
  }, ANNA.id);
  expect(colours.hasText, "the chip must carry a word, or this proves nothing").toBe(true);
  expect(colours.chip).toBe(colours.name);
});

test("the strip holds in the dark theme", async ({ page }, info) => {
  await openMembers(page);
  await stampTheme(page, "dark");
  await expect(chips(page, ANNA).first()).toBeVisible();
  await page.getByTestId("chat-info-panel").screenshot({ path: shotPath(info, "dark") });
});

test("an answer that never came leaves the list as it was", async ({ page }) => {
  // A failed RPC is not an answer that nobody wears anything, and it is
  // certainly not a reason for a member list to break.
  const seed = rows();
  await openFixture(page, {
    me: ME,
    chats: seed.chats,
    memberships: seed.memberships,
    messages: seed.messages,
    rpc: (name) => missingFunction(name),
  });
  await openChat(page, "Команда проекта", LINES[0]);
  await page.getByTestId("chat-header-info-button").click();
  const panel = page.getByTestId("chat-info-panel");
  await expect(panel).toBeVisible();
  await panel.getByText("УЧАСТНИКИ", { exact: false }).first().click();

  await expect(page.getByTestId("chat-info-member")).toHaveCount(4);
  await expect(page.getByTestId("chat-info-member-badges")).toHaveCount(0);
  await expect(row(page, ME)).toContainText("Владелец группы");
});
