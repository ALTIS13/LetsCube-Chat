import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PROFILE_COMPACT_BADGE_LIMITS,
  PROFILE_COMPACT_MIN_WIDTH,
  profileFillsPhone,
  profileOffersEscalation,
  resolveProfileTier,
} from "../../artifacts/kub/src/lib/profileTier.ts";

/**
 * The two-tier profile: which surface an act opens, and what the small one may
 * carry.
 *
 * Every constant here is traceable to something measured rather than preferred,
 * and the assertions are on the literals so that changing one is a decision
 * somebody has to take deliberately:
 *
 *  - the **opener axis** (`glance` / `named`) is Discord's own split, read off
 *    stable 615980 by enumerating the importers of wrapper module 342296 —
 *    `docs/operations/reference-clients.md` §15.1;
 *  - the **phone has one tier** was MEASURED ON DEVICE on 2026-09-21: Discord
 *    345.9 on `P212C6000159` opens a message author as a full-screen full-bleed
 *    page with no popout on the way;
 *  - the **badge cap** is this project's own recorded measurement of what fits
 *    on one line (`lib/profileBadges.ts`).
 */

const DESKTOP = 1440;
const PHONE = 390;

test("a face pressed in passing opens the small surface where there is room", () => {
  assert.equal(
    resolveProfileTier({ opener: "glance", escalated: false, viewportWidth: DESKTOP }),
    "compact",
  );
});

test("a glance with nothing to point at opens the full surface instead", () => {
  // The small tier is a popout **beside what you pressed**; that is the whole
  // of what makes it cheap, because the conversation neither moves nor dims.
  // A compact card with no anchor would be a centred dialog wearing a summary
  // — smaller than the full card and no quicker to read, which is the worst of
  // both. The first build of this was exactly that, by oversight rather than
  // by decision.
  assert.equal(
    resolveProfileTier({ opener: "glance", escalated: false, viewportWidth: DESKTOP, anchored: false }),
    "full",
  );
  assert.equal(
    resolveProfileTier({ opener: "glance", escalated: false, viewportWidth: DESKTOP, anchored: true }),
    "compact",
  );
});

test("an act that asked for the person opens the whole thing", () => {
  // The chat list's «Открыть профиль» and a person chosen out of the search are
  // both this. Discord opens its modal directly for every act of the kind — a
  // route, a user link, a widget card — and never a popout first.
  assert.equal(
    resolveProfileTier({ opener: "named", escalated: false, viewportWidth: DESKTOP }),
    "full",
  );
});

test("a phone has one tier, and it is the full one", () => {
  assert.equal(
    resolveProfileTier({ opener: "glance", escalated: false, viewportWidth: PHONE }),
    "full",
  );
  assert.equal(
    resolveProfileTier({ opener: "named", escalated: false, viewportWidth: PHONE }),
    "full",
  );
});

test("the threshold is this product's md, and it is exclusive", () => {
  assert.equal(PROFILE_COMPACT_MIN_WIDTH, 768);
  // At exactly the threshold there is room; one point below there is not.
  assert.equal(
    resolveProfileTier({ opener: "glance", escalated: false, viewportWidth: 768 }),
    "compact",
  );
  assert.equal(
    resolveProfileTier({ opener: "glance", escalated: false, viewportWidth: 767 }),
    "full",
  );
});

test("escalation wins over everything, including the opener", () => {
  assert.equal(
    resolveProfileTier({ opener: "glance", escalated: true, viewportWidth: DESKTOP }),
    "full",
  );
  assert.equal(
    resolveProfileTier({ opener: "named", escalated: true, viewportWidth: PHONE }),
    "full",
  );
});

test("narrowing the window past the threshold promotes a standing popout", () => {
  // The tier is derived from the live width on every render rather than frozen
  // when the surface opened; this is the case that proves it matters.
  const before = resolveProfileTier({ opener: "glance", escalated: false, viewportWidth: 900 });
  const after = resolveProfileTier({ opener: "glance", escalated: false, viewportWidth: 600 });
  assert.equal(before, "compact");
  assert.equal(after, "full");
});

test("only the small surface carries the way out of it", () => {
  // Discord's modal does not carry «View Full Profile» at all: a control that
  // opens the surface you are looking at is the inert control §8 refuses.
  assert.equal(profileOffersEscalation("compact"), true);
  assert.equal(profileOffersEscalation("full"), false);
});

test("the full surface takes the whole phone and the compact one never does", () => {
  assert.equal(profileFillsPhone("full"), true);
  assert.equal(profileFillsPhone("compact"), false);
});

test("the compact strip is capped at what was measured onto one line", () => {
  // One standing and one medal. The first guess was two medals, carried over
  // from a measurement taken in a member row, and the render wrapped: at 1440
  // the strip has 302 px of usable width and a chip is 99-100 px, so two chips
  // plus the «+N» is about 242 px and three is about 312 px.
  assert.deepEqual({ ...PROFILE_COMPACT_BADGE_LIMITS }, { standings: 1, medals: 1 });
});

/**
 * The contract that makes the small surface a **summary** rather than a second
 * implementation of a person.
 *
 * Discord's two bodies are different components (851588 and 808261) sharing
 * leaves and a store, and the assessment's warning was that a second component
 * over a second query is the drift the original consolidation was defending
 * against. The store half is `profile-cache.test.mts`. This half is the markup:
 * nothing may appear on the compact card that the full card does not also draw,
 * with exactly one exception — the escalation, which by the rule above belongs
 * only there.
 */
const COMPACT = readFileSync(
  new URL("../../artifacts/kub/src/components/profile/UserProfileCompact.tsx", import.meta.url),
  "utf8",
);
const FULL = readFileSync(
  new URL("../../artifacts/kub/src/components/chat/MemberCard.tsx", import.meta.url),
  "utf8",
);
const LEAF = readFileSync(
  new URL("../../artifacts/kub/src/components/profile/ProfileUsernameLine.tsx", import.meta.url),
  "utf8",
);

/** A source with its block and line comments removed. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Every `data-testid="…"` literal in a source, comments stripped first. */
function testIds(source: string): Set<string> {
  return new Set([...withoutComments(source).matchAll(/data-testid="([^"]+)"/g)].map((match) => match[1]));
}

/** The escalation, which is the one block the small surface may own alone. */
const ESCALATION = "profile-open-full";

test("every block on the compact card exists on the full card", () => {
  const compact = testIds(COMPACT);
  const full = new Set([...testIds(FULL), ...testIds(LEAF)]);
  const onlyCompact = [...compact].filter((id) => !full.has(id));
  assert.deepEqual(onlyCompact, [ESCALATION]);
});

test("the escalation is on the small surface and nowhere else", () => {
  assert.ok(testIds(COMPACT).has(ESCALATION));
  assert.ok(!testIds(FULL).has(ESCALATION));
  assert.ok(!testIds(LEAF).has(ESCALATION));
});

test("the copy control lives on the shared leaf, not in either card", () => {
  // It came from the search's «Мини-профиль», the third surface this change
  // deleted. One spelling, drawn by both tiers — which is the division Discord
  // uses for everything the two surfaces both say.
  assert.ok(testIds(LEAF).has("profile-copy-username"));
  assert.ok(!COMPACT.includes("navigator.clipboard"));
  assert.ok(!FULL.includes("navigator.clipboard"));
});

test("the bio is clamped on the small surface and whole on the large one", () => {
  // Two lines, measured: 45 px against the full card's 68 px for the same text
  // at 1440. Discord treats exactly this difference as worth a control of its
  // own — «View Full Bio» (`YDiPq8`) in the popout's bio block opens the modal.
  assert.ok(COMPACT.includes("line-clamp-2"));
  assert.ok(!FULL.includes("line-clamp"));
});

/**
 * Comments stripped before every scan below.
 *
 * The first version of these guards read the popout's own doc comment — which
 * explains that the surface **used to be** a `KubModal` — as evidence that it
 * still is. The register carries that trap already («a grep that matched a
 * comment»), and the fix is the one `testIds` above uses.
 */
const POPOUT = withoutComments(
  readFileSync(
    new URL("../../artifacts/kub/src/components/profile/UserProfilePopout.tsx", import.meta.url),
    "utf8",
  ),
);
const OVERLAY = readFileSync(
  new URL("../../artifacts/kub/src/components/profile/UserProfileOverlay.tsx", import.meta.url),
  "utf8",
);

test("the small surface is a popout beside its trigger, not a centred dialog", () => {
  // The divergence the first build did not name. Discord's popout is anchored
  // to what you pressed; a centred card takes the eye to the middle of the
  // screen and hands it back to a conversation that has left attention.
  // The **usage**, not the identifier: an import line survives a swapped
  // component and kept this guard green when the element became `AnchoredLayer`.
  assert.match(POPOUT, /<BesideLayer[^A-Za-z]/, "the popout no longer places itself beside its anchor");
  assert.doesNotMatch(POPOUT, /<AnchoredLayer[^A-Za-z]/, "the popout places itself above or below again");
  assert.ok(!POPOUT.includes("KubModal"), "the popout is a modal again");
  // No scrim: the conversation stays lit. A backdrop would dim the very thing
  // the reader was looking at, which is what the glance is for.
  assert.ok(!/bg-black|backdrop|scrim/i.test(POPOUT), "the popout dims the conversation");
  // And the container really is chosen by tier.
  assert.match(OVERLAY, /tier === "compact" && anchor/, "the overlay no longer picks a container by tier");
});

test("every door of the popout goes through one requestClose", () => {
  // The register's own rule, from the settings screen: a guard written into one
  // container leaves the others exactly as they were. There is nothing to guard
  // here yet, which is why the single door is cheap to build now.
  const doors = (POPOUT.match(/requestClose\(\)/g) ?? []).length;
  assert.ok(doors >= 3, `expected every door to call requestClose, found ${doors}`);
  // Escape, an outside press, a scroll and a resize — the four that mean «I
  // have moved on». The scroll is the sharpest: the card is anchored to a box
  // that has just moved.
  // **`addEventListener`, not the bare name.** Removing an `addEventListener`
  // line leaves its `removeEventListener` behind, so a guard that only looked
  // for the string stayed green with the door welded shut — two of the four
  // survived a mutation pass that way before this line was written.
  for (const door of ["keydown", "pointerdown", "scroll", "resize"]) {
    assert.match(
      POPOUT,
      new RegExp(`addEventListener\\("${door}"`),
      `the popout does not dismiss on ${door}`,
    );
  }
  // Nothing may call the prop directly and step around the one door.
  const direct = (POPOUT.match(/onClose\(\)/g) ?? []).length;
  assert.equal(direct, 1, "a door calls onClose directly instead of requestClose");
});

test("the scroll and the outside press are heard in the capture phase", () => {
  // A scroll inside the message list does not bubble to `window`, so a
  // bubbling listener never hears the one scroll that actually moves the
  // anchor. The press is captured for the opposite reason: without it the
  // first press after opening both dismisses the card and acts on what is
  // under it.
  assert.match(POPOUT, /addEventListener\("scroll", onScroll, true\)/);
  assert.match(POPOUT, /addEventListener\("pointerdown", onPointerDown, true\)/);
});

test("the small surface does not hand out group roles", () => {
  // One door per action. Handing a tag out is a management affordance and it
  // belongs where the member list is, which is the full card inside the panel.
  for (const id of ["member-card-role-give", "member-card-role-picker", "member-card-joined"]) {
    assert.ok(!testIds(COMPACT).has(id), `${id} must not be on the compact card`);
  }
  assert.ok(testIds(FULL).has("member-card-role-give"));
});
