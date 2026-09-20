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

/** Every `data-testid="…"` literal in a source, comments stripped first. */
function testIds(source: string): Set<string> {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  return new Set([...code.matchAll(/data-testid="([^"]+)"/g)].map((match) => match[1]));
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

test("the small surface does not hand out group roles", () => {
  // One door per action. Handing a tag out is a management affordance and it
  // belongs where the member list is, which is the full card inside the panel.
  for (const id of ["member-card-role-give", "member-card-role-picker", "member-card-joined"]) {
    assert.ok(!testIds(COMPACT).has(id), `${id} must not be on the compact card`);
  }
  assert.ok(testIds(FULL).has("member-card-role-give"));
});
