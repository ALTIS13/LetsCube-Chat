import { expect, type Page, type TestInfo, test } from "@playwright/test";
import sharp from "sharp";
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
import { CHAT_ROLE_COLOUR_KEYS, chatRoleColourValue } from "../../artifacts/kub/src/lib/chatRolePalette";

/**
 * D-214's residual: a card can tell the founder from the technical
 * administrator.
 *
 * `roles.colour` has held a palette key since
 * `20260919170000_a_role_colour_a_reader_can_see.sql` — `owner` is `amber` and
 * `tech_admin` is `blue` — and `ProfileBadgeChip` went on taking its colour from
 * `badgeTone`, which answers `pink` to both. They are the only two standings
 * anybody wears, so on a person's card the two were drawn identically while the
 * catalogue said otherwise, and the administration panel's own hint card
 * promises «цвет — её метку» in writing.
 *
 * **What is asserted here, and why each is a way to be wrong while looking
 * right:**
 *
 *   1. **The two standings are drawn in different colours, and each is its
 *      own.** «Different» alone passes on a build that paints them any two
 *      hues; «its own» alone passes on a build that paints every chip the same
 *      key. Both, together, are the defect.
 *   2. **The mark carries the hue, not the word.** `ChatRoleChip` sits directly
 *      above this strip on a member's card and colours ITS word; if this one
 *      did too, the only thing telling a group's tag from a LETSCUBE standing
 *      would be gone. So the word stays in the interface text colour, and this
 *      test is what refuses the other choice.
 *   3. **The perimeter follows the mark.** Measured off the pixels, a 55%
 *      border reads 2.06–3.14:1 on every ground a badge lands on — under the
 *      3:1 a mark needs on all but one of them: it bounds
 *      the chip and carries nothing, so a border in a different hue from the
 *      mark can only contradict it. That contradiction is what the
 *      administration panel had been drawing since the migration — an amber dot
 *      inside a pink border.
 *   4. **A medal is never coloured.** Shape first, tone second: a standing is a
 *      rank and a medal is earned, and a colour arriving on a medal takes that
 *      apart with nothing failing.
 *   5. **A hex paints nothing.** It is the shape a rollback restores, and
 *      D-214 measured those hexes at 1.50–2.06:1 against a 3:1 floor.
 *   6. **The number is taken on the ground the chip really composites on**, not
 *      on `--kub-surface`. The card is translucent; walking up to the first
 *      fully-opaque ancestor is what recorded 1.58 where the truth was 1.53.
 *
 * Everything here is fictional and mocked. No production screen is rendered.
 */

const AT = "2026-09-12T09:00:00.000Z";
const ME = person("11111111-1111-4111-8111-000000000001", "Максим Орлов", "maksim");
/** The technical administrator, who also holds a medal. */
const ANNA = person("11111111-1111-4111-8111-000000000002", "Анна Смирнова", "anna");
/** Somebody whose role still holds a hex, which is what a rollback leaves. */
const PETR = person("11111111-1111-4111-8111-000000000003", "Пётр Ильин", "petr");
/** A public standing with no glyph, so the mark is the dot rather than an icon. */
const OLGA = person("11111111-1111-4111-8111-000000000004", "Ольга Крылова", "olga");
const CHAT_TEAM = "22222222-2222-4222-8222-000000000001";
const LINE = "Макет главной готов, посмотрите";

/**
 * The floor. 4.5 and not the 3 a non-text mark answers to, because that is what
 * `tests/unit/chat-role-palette.test.mts` pins every entry at on the three
 * declared panel surfaces — and the claim being made here is that the
 * guarantee survives the composite ground as well.
 */
const MARK_CONTRAST_FLOOR = 4.5;

const badge = (
  who: { id: string },
  kind: "global_role" | "achievement",
  key: string,
  title: string,
  icon: string | null,
  colour: string | null,
  rank: number,
) => ({ user_id: who.id, kind, key, title, detail: null, icon, colour, rank });

const BADGE_ROWS = [
  badge(ME, "global_role", "owner", "Владелец", "crown", "amber", 100),
  badge(ANNA, "global_role", "tech_admin", "Тех. администратор", "admin", "blue", 100),
  // A medal carrying a palette key, which `profile_badges` cannot produce:
  // its achievement branch is `null::text as colour`. The fixture supplies it
  // anyway, because the rule being protected is a presentation decision and
  // the only place it can be exercised is the one place the SQL is not in the
  // way. Without this the guard could be deleted and every assertion here
  // would stay green — measured, not supposed.
  badge(ANNA, "achievement", "veteran", "Ветеран", "crown", "amber", 100000 - 40),
  // The pre-migration shape. `#F5B50A` is the exact hex the owner's role held,
  // and the one D-214 measured at 1.50:1 on the light ground.
  badge(PETR, "global_role", "manager", "Менеджер", "manager", "#F5B50A", 60),
  // `roles.badge_icon` is nullable, so a public standing may have no glyph at
  // all. Then `KubBadge` draws its dot, and the dot is the whole of the mark —
  // which is the exact shape the administration panel has been getting wrong:
  // a dot in the role's colour inside a border in the tone's.
  badge(OLGA, "global_role", "moderator", "Модератор", null, "rose", 40),
];

function seed(): { chats: Row[]; memberships: Row[]; messages: Row[] } {
  return {
    chats: [chat(CHAT_TEAM, "group", "Команда проекта", AT)],
    memberships: [
      membership(CHAT_TEAM, ME, "owner", AT),
      membership(CHAT_TEAM, ANNA, "admin", AT),
      membership(CHAT_TEAM, PETR, "member", AT),
      membership(CHAT_TEAM, OLGA, "member", AT),
    ],
    messages: [message("55555555-5555-4555-8555-000000000001", CHAT_TEAM, ME, LINE, AT)],
  };
}

async function openMembers(page: Page) {
  const rows = seed();
  await openFixture(page, {
    me: ME,
    people: [ANNA, PETR, OLGA],
    chats: rows.chats,
    memberships: rows.memberships,
    messages: rows.messages,
    rpc: (name) => {
      if (name === "profile_badges") return { body: BADGE_ROWS };
      if (name === "search_chat_messages") return missingFunction(name);
      return undefined;
    },
  });
  await openChat(page, "Команда проекта", LINE);
  await page.getByTestId("chat-header-info-button").click();
  const panel = page.getByTestId("chat-info-panel");
  await expect(panel).toBeVisible();
  return panel;
}

async function openCard(page: Page, who: { id: string }) {
  const panel = page.getByTestId("chat-info-panel");
  await panel.getByText("УЧАСТНИКИ", { exact: false }).first().click();
  await expect(page.getByTestId("chat-info-member").first()).toBeVisible();
  await page
    .locator(`[data-testid="chat-info-member"][data-member-id="${who.id}"]`)
    .getByTestId("chat-info-member-open")
    .click();
  await expect(page.getByTestId("member-card-joined")).toBeVisible();
  await expect(page.getByTestId("member-card-badges")).toBeVisible();
}

async function stampTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((value) => {
    const root = document.documentElement;
    root.classList.toggle("dark", value === "dark");
    root.classList.toggle("light", value === "light");
    root.setAttribute("data-theme", value);
    root.style.colorScheme = value;
  }, theme);
  await page.waitForTimeout(350);
}

function shotPath(info: TestInfo, name: string): string {
  return `output/profile-badge-colour/${name}-${info.project.name}.png`;
}

// ---------------------------------------------------------------- arithmetic

function channel(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

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
 * `color-mix()` computes to `color(srgb r g b / a)` in Chromium, with channels
 * in 0..1. A parser that only knows `rgb()` reads «color(srgb 0.94 0.29 0.57)»
 * as 0, 94 and 29 — not an error, just a wrong colour, and the first pass of
 * this measurement reported a pink border as grey because of it.
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

interface ChipFacts {
  key: string;
  kind: string;
  colour: string;
  icon: string;
  word: string;
  /** What the mark is drawn in: the glyph's colour, or the dot's fill. */
  mark: string;
  border: string;
  text: string;
  box: { x: number; y: number; w: number; h: number };
}

async function readChip(page: Page, key: string): Promise<ChipFacts> {
  const chip = page.getByTestId("member-card-badges").locator(`[data-badge-key="${key}"]`);
  await expect(chip).toBeVisible();
  return chip.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const svg = el.querySelector("svg");
    const dot = [...el.children].find(
      (child) => child.tagName === "SPAN" && child.clientWidth > 0 && child.clientWidth <= 8,
    ) as HTMLElement | undefined;
    const styles = getComputedStyle(el);
    const wordNode = [...el.querySelectorAll("span")].find(
      (node) => (node.textContent ?? "").trim().length > 1,
    );
    return {
      key: el.getAttribute("data-badge-key") ?? "",
      kind: el.getAttribute("data-badge-kind") ?? "",
      colour: el.getAttribute("data-badge-colour") ?? "",
      icon: el.getAttribute("data-badge-icon") ?? "",
      word: (el.textContent ?? "").trim(),
      mark: svg
        ? getComputedStyle(svg).color
        : dot
          ? getComputedStyle(dot).backgroundColor
          : "",
      border: styles.borderTopColor,
      text: wordNode ? getComputedStyle(wordNode).color : styles.color,
      box: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
    };
  });
}

/**
 * The ground a chip's mark composites on, read off the photograph.
 *
 * The most common pixel inside the chip's own box with the ink and its
 * near-blends thrown out. Throwing the ink out is not tidiness: on a 2.625x
 * device a glyph's strokes are several device pixels of one flat colour while
 * the translucent card gives the background many near-identical shades, so the
 * ink wins the tally and the mark appears to be drawn on itself.
 */
async function groundUnder(page: Page, box: ChipFacts["box"], ink: readonly [number, number, number]) {
  const shot = await page.screenshot();
  const raw = await sharp(shot).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, channels } = raw.info;
  const scale = width / (page.viewportSize()?.width ?? width);
  // Inset by a pixel so the border ring is not counted as ground.
  const left = Math.round((box.x + 2) * scale);
  const top = Math.round((box.y + 2) * scale);
  const right = Math.round((box.x + box.w - 2) * scale);
  const bottom = Math.round((box.y + box.h - 2) * scale);
  const tally = new Map<string, number>();
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const at = (y * width + x) * channels;
      const pixel = [raw.data[at], raw.data[at + 1], raw.data[at + 2]] as const;
      if (pixel.every((value, index) => Math.abs(value - ink[index]) <= 24)) continue;
      const name = pixel.join(",");
      tally.set(name, (tally.get(name) ?? 0) + 1);
    }
  }
  expect(tally.size, "the chip has no pixel that is not its own ink").toBeGreaterThan(0);
  const ground = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return ground.split(",").map(Number) as [number, number, number];
}


/**
 * What a CSS value computes to INSIDE the strip, not at the document root.
 *
 * `.kub-chat-screen` re-points `--kub-cyan`, `--kub-muted` and
 * `--kub-accent-text` to the values measured over the tinted wallpaper, and the
 * information panel is inside it. A probe appended to `document.body` therefore
 * reads a different colour than the chip does — which is how the first run of
 * this spec compared a chip's cyan border against the dark theme's `:root`
 * cyan and called it a defect.
 */
async function resolveInStrip(page: Page, css: string): Promise<string> {
  return page.getByTestId("member-card-badges").evaluate((el, value) => {
    const probe = document.createElement("span");
    probe.style.color = value;
    el.append(probe);
    const read = getComputedStyle(probe).color;
    probe.remove();
    return read;
  }, css);
}

// ------------------------------------------------------------------- the spec

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

for (const theme of ["light", "dark"] as const) {
  test(`the founder and the technical administrator are told apart in the ${theme} theme`, async ({
    page,
  }, info) => {
    await openMembers(page);

    await openCard(page, ME);
    await stampTheme(page, theme);
    const owner = await readChip(page, "owner");
    const ownerGround = await groundUnder(page, owner.box, parseColour(owner.mark));
    await page.getByTestId("member-card-badges").screenshot({
      path: shotPath(info, `owner-${theme}`),
    });
    await page.getByTestId("chat-info-back").click();

    await openCard(page, ANNA);
    await stampTheme(page, theme);
    const techAdmin = await readChip(page, "tech_admin");
    const medal = await readChip(page, "veteran");
    const techGround = await groundUnder(page, techAdmin.box, parseColour(techAdmin.mark));
    await page.getByTestId("member-card-badges").screenshot({
      path: shotPath(info, `tech-admin-${theme}`),
    });

    // 1. Different, and each its own. `badgeTone` gives both of these `pink`
    //    and always will; what separates them is the palette key.
    expect(owner.colour).toBe("amber");
    expect(techAdmin.colour).toBe("blue");
    expect(
      parseColour(owner.mark),
      "the founder and the technical administrator are drawn in one colour again",
    ).not.toEqual(parseColour(techAdmin.mark));

    // And each mark is that key's own token rather than any two hues. Resolved
    // through the palette module, so a renamed token fails here rather than
    // painting nothing.
    const resolve = (css: string) => resolveInStrip(page, css);
    expect(parseColour(owner.mark)).toEqual(parseColour(await resolve(chatRoleColourValue("amber"))));
    expect(parseColour(techAdmin.mark)).toEqual(parseColour(await resolve(chatRoleColourValue("blue"))));

    // 2. The mark carries the hue, not the word.
    const interfaceText = await resolve("var(--kub-text)");
    expect(
      parseColour(owner.text),
      "the standing's word took the role's colour, which is the group tag's mechanic and not this one",
    ).toEqual(parseColour(interfaceText));
    expect(parseColour(techAdmin.text)).toEqual(parseColour(interfaceText));

    // 3. The perimeter follows the mark. The border is the same colour mixed to
    //    55%, so its three channels are the mark's.
    expect(
      parseColour(owner.border),
      "an amber mark inside a border of some other hue is one chip saying two things",
    ).toEqual(parseColour(owner.mark));
    expect(parseColour(techAdmin.border)).toEqual(parseColour(techAdmin.mark));

    // 4. A medal is never coloured, and keeps the neutral that separates the
    //    families. Its glyph is the interface text colour, exactly as it was
    //    before any of this, and its perimeter is the neutral rule rather than
    //    a tone — so neither carries a hue a palette key could have put there.
    expect(medal.colour).toBe("");
    expect(parseColour(medal.mark)).toEqual(parseColour(interfaceText));
    const rule = parseColour(await resolve("var(--kub-border-color)"));
    expect(parseColour(medal.border)).toEqual(rule);
    for (const key of CHAT_ROLE_COLOUR_KEYS) {
      const token = parseColour(await resolve(chatRoleColourValue(key)));
      expect(parseColour(medal.mark), `a medal's glyph was painted «${key}»`).not.toEqual(token);
      expect(parseColour(medal.border), `a medal's perimeter was painted «${key}»`).not.toEqual(token);
    }

    // 6. The number, on the ground the chip really composites on — which is not
    //    a declared surface, and that is the point of photographing it.
    for (const [chip, ground] of [
      [owner, ownerGround],
      [techAdmin, techGround],
    ] as const) {
      const ratio = contrastRatio(parseColour(chip.mark), ground);
      expect(
        ratio,
        `«${chip.word}» is drawn ${chip.mark} at ${ratio.toFixed(2)}:1 on rgb(${ground.join(",")}). ` +
          `The palette is pinned at ${MARK_CONTRAST_FLOOR}:1 as TEXT on the three declared panel ` +
          `surfaces; this is the composite the card actually puts under it. Either a token moved or ` +
          `the material behind the card did.`,
      ).toBeGreaterThanOrEqual(MARK_CONTRAST_FLOOR);
    }

    // Colour is never the only carrier. Remove the hue and these two chips are
    // still a crown beside «Владелец» and a gear beside «Тех. администратор» —
    // the glyphs `badge-vocabulary.test.mts` refuses to let two badges share,
    // and two different words. The frame below is the same strip drawn with
    // every hue taken out, kept so the claim can be looked at.
    expect(owner.icon).toBe("crown");
    expect(techAdmin.icon).toBe("admin");
    expect(owner.icon).not.toBe(techAdmin.icon);
    expect(owner.word).not.toBe(techAdmin.word);
    await page.getByTestId("member-card-badges").evaluate((el) => {
      (el as HTMLElement).style.filter = "grayscale(1)";
    });
    await page.getByTestId("member-card-badges").screenshot({
      path: shotPath(info, `tech-admin-${theme}-no-colour`),
    });
  });
}

test("a standing with no glyph gets a coloured dot, and the perimeter follows it", async ({
  page,
}, info) => {
  // D-214's second residual, at the primitive rather than at the call site.
  // `roles.badge_icon` is nullable; with no glyph the dot IS the mark, and the
  // administration panel has been drawing exactly this pairing wrong since the
  // migration — the role's colour on the dot and `badgeTone`'s on the border,
  // so an amber dot sat inside a pink one. One chip cannot say two things.
  await openMembers(page);
  await openCard(page, OLGA);
  await stampTheme(page, "light");
  const moderator = await readChip(page, "moderator");

  expect(moderator.icon, "this case is only interesting while the badge has no glyph").toBe("");
  expect(moderator.colour).toBe("rose");
  const rose = await resolveInStrip(page, chatRoleColourValue("rose"));
  expect(parseColour(moderator.mark), "the dot is not the role's colour").toEqual(parseColour(rose));
  expect(
    parseColour(moderator.border),
    "the dot and the perimeter disagree, which is the defect this closes",
  ).toEqual(parseColour(moderator.mark));
  await page.getByTestId("member-card-badges").screenshot({
    path: shotPath(info, "dot-and-border-light"),
  });
});

test("a hex is refused, which is what makes the migration reversible", async ({ page }) => {
  // `roles.colour` held `^#[0-9a-fA-F]{6}$` until 2026-09-19 and holds it again
  // if that migration is rolled back. D-214 measured those hexes at 1.50–2.06:1
  // in the light theme against a 3:1 floor for a mark, because they were the
  // DARK palette's values reused in a theme nobody had checked them in. So the
  // chip takes the tone instead, and the rollback needs no second client
  // deploy.
  await openMembers(page);
  await openCard(page, PETR);
  await stampTheme(page, "light");
  const manager = await readChip(page, "manager");

  expect(manager.colour, "a hex reached the chip's colour attribute").toBe("");
  const gold: [number, number, number] = [0xf5, 0xb5, 0x0a];
  expect(parseColour(manager.mark), "the 1.50:1 gold D-214 measured is being painted").not.toEqual(gold);
  expect(parseColour(manager.border)).not.toEqual(gold);
  // And it is the tone, drawn exactly as it was before any of this: `manager`
  // is not a critical key, so `badgeTone` gives it cyan — the cyan this chip
  // sees, which is not the one `:root` declares (`.kub-chat-screen` re-points
  // it to the value measured over the wallpaper). A probe anchored anywhere
  // else reads a different colour and the comparison is meaningless; the first
  // run of this assertion did exactly that.
  const cyan = await resolveInStrip(page, "var(--kub-cyan)");
  expect(parseColour(manager.border)).toEqual(parseColour(cyan));
  // The glyph keeps the interface text colour: with no palette key there is
  // nothing to paint it with.
  const text = await resolveInStrip(page, "var(--kub-text)");
  expect(parseColour(manager.mark)).toEqual(parseColour(text));
});
