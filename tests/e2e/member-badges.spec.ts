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
 * D-213: the member row is about this group; the person's card is about the
 * person. And D-180 slice 3, whose surface this is.
 *
 * The row used to carry both. `profile_badges` joins `user_global_roles` to
 * `roles` filtered to `scope = 'global'` — it takes no `chat_id` and never
 * reads `chat_members` — so those chips are LETSCUBE-wide standing by
 * construction, and they sat one line below this group's own standing. On the
 * owner's row the word «Владелец» stood twice meaning two different facts, and
 * the owner of this deployment reported exactly that on 2026-09-18: «оно до сих
 * пор отображается как роли глобальные с надписями вместо значков».
 *
 * Both references agree and neither did what this did. A Discord member list
 * carries standing *in that server* — the name's colour, at most one role icon,
 * a crown for the owner — and Discord's own account badges live on the profile
 * popout, never in the list. Telegram prints a short grey word for the group
 * role and no site-wide rank at all.
 *
 * So what is tested here now is a split, and each half is a way this could be
 * built wrong while looking right:
 *
 *   1. **No query per row.** The ids are in hand where the list is built, so
 *      twenty people cost one `profile_badges` call. The fixture records every
 *      request, so the count is measured rather than reasoned about. The call
 *      still happens for the list, because the cards are opened from it.
 *   2. **Nothing global in a row.** Not «fewer chips» — none. A row carries the
 *      glyph for this chat's role and a second line that names the scope in
 *      Telegram's manner («Владелец группы»), and that is all.
 *   3. **Everything on the card.** The whole strip, words included, uncapped —
 *      so a person holding four badges shows four, with no «+N» to press and
 *      nothing counted away.
 *   4. **One glyph, one meaning.** The catalogues were seeded months apart:
 *      `shield` is the administrator's role icon and also what «Тестировщик»
 *      names. Resolved in `lib/badgeVocabulary.ts` and checked here on the
 *      rendered markup, because a table saying «key» proves nothing about what
 *      a browser drew.
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
  // A standing's palette key, as `roles.colour` has held one since D-214's
  // migration. Null everywhere but one row: the test named «the badge's colour
  // never reaches the words» needs a badge that HAS a colour, or it asserts
  // that nothing is not painted.
  colour: string | null = null,
) => ({ user_id: who.id, kind, key, title, detail, icon, colour, rank });

/**
 * What `profile_badges` answers, with the icons the database really holds.
 *
 * The seeded names are used deliberately — `crown` for «Ветеран», `shield` for
 * «Тестировщик» — so this spec exercises the collision rather than a catalogue
 * somebody already repaired.
 */
const BADGE_ROWS = [
  badge(ME, "global_role", "owner", "Владелец", "Полный доступ ко всему LETSCUBE", "crown", 100),
  badge(ANNA, "global_role", "admin", "Администратор", "Управление людьми", "shield", 80, "rose"),
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

/** Chips inside a member's row. After D-213 this must always be empty. */
const chips = (page: Page, who: { id: string }) => row(page, who).locator("[data-badge-key]");

/** Chips on the person's own card, which is where the whole strip lives now. */
const cardChips = (page: Page) => page.getByTestId("member-card-badges").locator("[data-badge-key]");

/**
 * Open one person's card from their row.
 *
 * Through the row's own button rather than by setting state: the card is
 * reached by pressing a person, and if that press ever stops working the chips
 * are unreachable no matter how right they are. D-168 built this opening.
 */
async function openCard(page: Page, who: { id: string }) {
  await row(page, who).getByTestId("chat-info-member-open").click();
  await expect(page.getByTestId("member-card-joined")).toBeVisible();
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
  return `output/member-badges/${name}-${info.project.name}.png`;
}

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

test("the whole list is answered for in one request, and a card costs none", async ({
  page,
}) => {
  const fixture = await openMembers(page);
  // Waited for by the measurement itself. This used to wait for a chip in a
  // row to appear, and after D-213 there is no chip in a row — so the wait had
  // to become the thing under test rather than a side effect of it.
  await expect
    .poll(() => fixture.rpcBodies("profile_badges").length, { timeout: 10_000 })
    .toBe(1);

  const calls = fixture.rpcBodies("profile_badges");
  expect(
    calls.length,
    "a badge strip that costs a round trip per member is a member list that costs twenty",
  ).toBe(1);

  // And it asked about everybody, so «one call» is not «one call for one person
  // and the others quietly left blank».
  const asked = calls[0].p_user_ids as string[];
  expect([...asked].sort()).toEqual([ME.id, ANNA.id, PETR.id, OLGA.id].sort());

  // Opening two cards adds nothing. The strips are computed once per answer for
  // the whole list, and the card reads the same map — which is the reason the
  // list still asks at all now that no row draws a chip. If a card ever fetched
  // for itself, a list of twenty people would cost twenty-one requests to walk.
  await openCard(page, ANNA);
  await expect(cardChips(page).first()).toBeVisible();
  // «Назад» from a sub-view returns to the card root, not to the member list,
  // so the list has to be re-entered — which is also the walk a person takes.
  await page.getByTestId("chat-info-back").click();
  const panel = page.getByTestId("chat-info-panel");
  await panel.getByText("УЧАСТНИКИ", { exact: false }).first().click();
  await expect(row(page, PETR)).toBeVisible();
  await openCard(page, PETR);
  await expect(cardChips(page).first()).toBeVisible();
  expect(
    fixture.rpcBodies("profile_badges").length,
    "opening a card asked the server again",
  ).toBe(1);
});

test("a row carries this group's standing, and no LETSCUBE standing at all", async ({
  page,
}, info) => {
  await openMembers(page);

  // The row that used to read «Владелец  [♛ Владелец]»: this chat's owner, who
  // is also LETSCUBE's. One word, one meaning, and the meaning is named.
  const mine = row(page, ME);
  await expect(mine).toContainText("Владелец группы");
  await expect(mine).not.toContainText("Полный доступ ко всему LETSCUBE");
  await expect(
    chips(page, ME),
    "a LETSCUBE-wide chip is back in a row about one group (D-213)",
  ).toHaveCount(0);

  // Not just the one row: nobody's row carries a chip, including the two people
  // who hold four badges between them.
  for (const who of [ME, ANNA, PETR, OLGA]) {
    await expect(chips(page, who)).toHaveCount(0);
  }
  await expect(page.getByTestId("chat-info-member-badges")).toHaveCount(0);

  // And the standing that IS in the row is a glyph, which is what «значки
  // вместо надписей» asked for. Read off the DOM: one icon on the name line,
  // whose accessible name is the scoped sentence, so a screen reader is told
  // which «Владелец» this is.
  const glyphs = await page.evaluate((ids) => {
    return ids.map((id) => {
      const line = document.querySelector(`[data-member-id="${id}"]`);
      const marks = [...(line?.querySelectorAll("svg") ?? [])].filter((svg) =>
        Boolean(svg.closest("[aria-label]")),
      );
      return marks.map((svg) => svg.closest("[aria-label]")?.getAttribute("aria-label") ?? "");
    });
  }, [ME.id, ANNA.id, OLGA.id]);
  expect(glyphs[0], "the owner's row lost its crown").toContain("Владелец группы");
  expect(glyphs[1], "the administrator's row lost its shield").toContain("Администратор группы");
  expect(
    glyphs[2].filter((label) => label.includes("группы")),
    "an ordinary member was given a standing glyph",
  ).toEqual([]);

  await expect(row(page, ANNA)).toContainText("Администратор группы");

  // The fixture signs in with the dark theme stored, so the light one has to be
  // stamped or both screenshots come out the same file — which is how the first
  // pair of these was taken, and they were byte-identical.
  await stampTheme(page, "light");
  await page.getByTestId("chat-info-panel").screenshot({ path: shotPath(info, "light") });
});

test("the card carries the whole set, words and all", async ({ page }, info) => {
  await openMembers(page);
  // Пётр holds four: a standing and three medals. The row shows none of them
  // and the card shows all four — uncapped, because a card is about the person
  // rather than one entry in a list, so there is nothing to count away.
  await openCard(page, PETR);
  await expect(cardChips(page)).toHaveCount(4);
  const card = page.getByTestId("member-card-badges");
  await expect(card).toContainText("Менеджер");
  await expect(card).toContainText("Освоился");
  await expect(card).toContainText("Собеседник");
  await expect(card).toContainText("Рассказчик");
  await expect(card, "«+N» on a surface with no limit is a count of nothing").not.toContainText("+");

  await stampTheme(page, "light");
  await page.getByTestId("chat-info-panel").screenshot({ path: shotPath(info, "card-light") });
});

test("a shield does not mean two things on one card", async ({ page }) => {
  await openMembers(page);
  // Анна is LETSCUBE's administrator — a `shield` role — and a «Тестировщик»,
  // whose catalogue row also names `shield`. Before the vocabulary resolved it
  // the same glyph stood twice meaning two different things. The collision moved
  // with the chips: the card is where both now appear together, and where all
  // three of her badges appear at once rather than two and a «+1».
  await openCard(page, ANNA);
  await expect(cardChips(page)).toHaveCount(3);

  const standing = cardChips(page).filter({ hasText: "Администратор" });
  const tester = cardChips(page).filter({ hasText: "Тестировщик" });
  const veteran = cardChips(page).filter({ hasText: "Ветеран" });
  await expect(standing).toHaveCount(1);
  await expect(tester).toHaveCount(1);
  await expect(veteran).toHaveCount(1);

  await expect(standing).toHaveAttribute("data-badge-icon", "shield");
  await expect(tester).toHaveAttribute("data-badge-icon", "key");
  await expect(veteran).toHaveAttribute("data-badge-icon", "clock");

  // And the same question asked of what the browser drew, because an attribute
  // naming «key» proves only that this component agrees with itself.
  const drawn = await page.evaluate(() => {
    const strip = document.querySelector('[data-testid="member-card-badges"]');
    const glyphs = [...(strip?.querySelectorAll("[data-badge-key] svg") ?? [])];
    return glyphs.map((svg) => svg.innerHTML);
  });
  expect(drawn.length, "every chip on this card carries a glyph").toBe(3);
  expect(new Set(drawn).size, "two chips on one card are drawing the same picture").toBe(3);
});

test("nothing is counted away, on either surface", async ({ page }) => {
  await openMembers(page);
  // This test used to assert the opposite of itself: the row had room for one
  // standing and one medal, so Пётр's four badges came out as two chips and a
  // «+2» that nothing could open. That budget was sized for a strip beside a
  // name, and D-213 took the strip out of the row — so the number it produced
  // has nowhere left to be shown, and «+N» must not appear on either surface.
  await expect(row(page, PETR)).not.toContainText("+2");
  await expect(chips(page, PETR)).toHaveCount(0);
  await openCard(page, PETR);
  await expect(cardChips(page)).toHaveCount(4);
  await expect(page.getByTestId("member-card-badges")).not.toContainText("+2");
});

test("somebody wearing nothing still wears no strip", async ({ page }) => {
  await openMembers(page);

  const plain = row(page, OLGA);
  await expect(plain).toBeVisible();
  // No strip: an empty one would render as nothing at all, and «Без роли»
  // would be a claim where there is only a gap. That half of the original
  // assertion is unchanged.
  await expect(plain.getByTestId("chat-info-member-badges")).toHaveCount(0);

  // **The other half was reversed on purpose, by D-168.**
  //
  // This test used to require `chat-info-member-standing` to be absent from an
  // ordinary member's row, and to prove it by the row being shorter. D-168 is
  // the register entry for exactly that state — «an ordinary member's row
  // carries nothing at all» — and its answer is not the «Без роли» this test
  // rightly refused: it is the person's own nickname, which is a fact rather
  // than a claim, plus the presence sentence when presence can be read.
  //
  // So the second line is now drawn for everybody, and what survives from the
  // original is the rule underneath it: the line is never *empty*. Measured at
  // 1440 on 2026-09-15, this costs an undecorated row 52 -> 70 points, and a
  // decorated one is still the taller of the two.
  const line = plain.getByTestId("chat-info-member-standing");
  await expect(line).toHaveCount(1);
  expect((await line.innerText()).trim().length).toBeGreaterThan(0);
  await expect(row(page, ANNA).getByTestId("chat-info-member-standing")).toHaveCount(1);

  // The height comparison this test used to end with is gone with the chips:
  // it asserted a decorated row is taller than a plain one, and after D-213 no
  // row is decorated. That is the point rather than a loss — measured at 1440,
  // every row in the list is now the same 70 points, which is what a list of
  // people should be.
  const heights = await page.evaluate(
    (ids) =>
      ids.map(
        (id) =>
          document.querySelector(`[data-member-id="${id}"]`)?.getBoundingClientRect().height ?? -1,
      ),
    [OLGA.id, ANNA.id, ME.id, PETR.id],
  );
  expect(heights[0]).toBeGreaterThan(0);
  expect(
    new Set(heights).size,
    `the rows no longer agree on their height (${heights.join(", ")}) — something is ` +
      `decorating one of them again`,
  ).toBe(1);
});

test("the badge's colour never reaches the words", async ({ page }) => {
  await openMembers(page);
  await openCard(page, ANNA);
  // Measured rather than asserted from the source. The role tones read 4.05,
  // 4.18 and 3.82 against the surfaces a chip sits on, under the 4.5 a label
  // needs, so the tone lives on the border and the dot and the word takes the
  // interface text colour — the same colour the person's name is drawn in.
  //
  // The word is looked for by walking to the deepest element that holds it,
  // not among the chip's own child nodes. It stopped being a direct text node
  // on 2026-09-18, when D-222 gave `KubBadge` `pillTextChildren` to keep a pill
  // on one line: runs of text are wrapped in a `min-w-0 truncate` span, so
  // `hasText` had been false — and this test red — ever since, while the thing
  // it guards was never broken. Found on 2026-09-19 by D-214's residual work
  // and confirmed against the commit before it.
  //
  // And the colour is now read off the element that actually holds the word
  // rather than off the chip, which is what the assertion always meant: a chip
  // whose own colour is right and whose label is painted by a child would pass
  // the old spelling.
  const colours = await page.evaluate(() => {
    const strip = document.querySelector('[data-testid="member-card-badges"]');
    const name = document.querySelector('[data-testid="member-card-joined"]');
    const chip = strip?.querySelector("[data-badge-key]");
    const wanted = (chip?.textContent ?? "").trim();
    let holder: Element | null = chip ?? null;
    if (chip && wanted) {
      for (;;) {
        const next = [...holder!.children].find(
          (child) => (child.textContent ?? "").trim() === wanted,
        );
        if (!next) break;
        holder = next;
      }
    }
    return {
      reference: name ? getComputedStyle(name.parentElement as Element).color : null,
      chip: holder ? getComputedStyle(holder).color : null,
      hasText: Boolean(wanted),
    };
  });
  expect(colours.hasText, "the chip must carry a word, or this proves nothing").toBe(true);
  expect(colours.chip).toBe(colours.reference);
});

test("both surfaces hold in the dark theme", async ({ page }, info) => {
  await openMembers(page);
  await stampTheme(page, "dark");
  await expect(row(page, ANNA)).toContainText("Администратор группы");
  await page.getByTestId("chat-info-panel").screenshot({ path: shotPath(info, "dark") });
  await openCard(page, ANNA);
  await expect(cardChips(page).first()).toBeVisible();
  await page.getByTestId("chat-info-panel").screenshot({ path: shotPath(info, "card-dark") });
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
