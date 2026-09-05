import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * The administration panel is made of the application's material.
 *
 * `tests/unit/overlay-glass.test.mjs` holds this line for `components/ui` and
 * `tests/unit/shell-glass.test.mjs` for the chat shell. This file holds it for
 * `pages/admin`, which is a dense working tool rather than a showcase: the
 * material there has to help a person read the structure — what is chrome, what
 * covers what, what is a field — and not merely look like glass.
 *
 * The rules being enforced are `docs/operations/interface-material.md`. Four of
 * them have a test here because four of them were broken in this zone before
 * the pass:
 *
 *  1. Rule 1 — the material is never written by hand. Two surfaces did:
 *     the bulk-action bar carried `backdrop-blur` and `shadow-lg` on top of a
 *     panel that already has both, and two support dialogs carried `shadow-2xl`.
 *  2. Rule 2 — an opaque fill behind a translucent panel cancels it. The panel
 *     root painted --kub-bg, and the scroller under it painted --kub-bg again
 *     through `kub-grid-subtle`, so every panel in the work area had one flat
 *     colour to blur.
 *  3. Rule 3 — `backdrop-filter` is a containing block for `position: fixed`.
 *     The support workspace hosts two `fixed inset-0` dialogs, so it cannot
 *     wear the material itself.
 *  4. Rule 6 — nothing that scrolls or repeats. Table rows stay off the glass.
 */

const root = new URL("../../artifacts/kub/src/", import.meta.url);
const read = (file) => readFileSync(new URL(file, root), "utf8");

/** Comments explain the measurements; only the code is under these rules. */
const withoutComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/**
 * The class strings containing `needle`, and the assertion that there are
 * exactly `expected` of them.
 *
 * Rule 9's second half: a harness that cannot identify its subject must refuse
 * to judge rather than pick the first candidate. `flex-shrink-0` matches two
 * strings in AdminLayout, and a helper that silently took the first would have
 * gone on passing after the landmark moved to the other one.
 *
 * The count is spelled out rather than defaulted to one, because two of these
 * surfaces are genuinely a pair written identically — the audit tab's two
 * typeaheads and the support tab's two dialogs — and "one or more" would let a
 * pass on one half of a pair stand for both.
 */
function classStrings(file, needle, expected) {
  const hits = [...read(file).matchAll(/className="([^"\n]{12,})"/g)]
    .map((match) => match[1])
    .filter((value) => value.includes(needle));
  assert.equal(
    hits.length,
    expected,
    `${file}: "${needle}" identifies ${hits.length} class strings, not ${expected} — the ` +
      "landmark cannot say which surface is under test",
  );
  return hits;
}

/** The class string of the element carrying `data-testid`. */
function classesOf(file, testid) {
  const tag = read(file).match(
    new RegExp(`<[A-Za-z][^>]*?data-testid="${testid}"[\\s\\S]*?>`),
  );
  assert.ok(tag, `${file}: no element carries data-testid="${testid}"`);
  const classes = tag[0].match(/className="([^"]*)"/);
  assert.ok(classes, `${file}: the element at data-testid="${testid}" has no className`);
  return classes[1];
}

/** Nothing may compete with the material on the element wearing it. */
function assertUncontested(where, classes) {
  assert.doesNotMatch(
    classes,
    /\bbg-\[var\(--kub-(surface|chat-bg|bg)/,
    `${where} keeps an opaque fill beside the glass utility`,
  );
  assert.doesNotMatch(
    classes,
    /\bshadow-(2xs|xs|sm|md|lg|xl|2xl)\b/,
    `${where} keeps its own drop shadow beside --glass-shadow`,
  );
  assert.doesNotMatch(
    classes,
    /\bkub-glow-(soft|cyan|pink)\b/,
    `${where} keeps a glow beside --glass-shadow; both set box-shadow and only one survives`,
  );
  assert.doesNotMatch(
    classes,
    /\bbackdrop-blur\b/,
    `${where} frosts by hand instead of through the utility`,
  );
}

// ── Chrome that content sits on ──────────────────────────────────────────────

test("AdminLayout wears the material on one sheet, not on two stacked ones", () => {
  const classes = classesOf("pages/admin/AdminLayout.tsx", "admin-chrome");
  assert.match(
    classes,
    /\bkub-glass(?!-strong)\b/,
    "the admin chrome does not take its surface from kub-glass",
  );
  assertUncontested("the admin chrome", classes);

  // The title row and the tab strip live inside it. Given the material
  // separately each would carry its own lit top edge and drop its own shadow
  // onto the other, so the frame of one tool would read as two panels.
  const source = withoutComments(read("pages/admin/AdminLayout.tsx"));
  const wearers = (source.match(/\bkub-glass(?!-strong)\b/g) ?? []).length;
  assert.equal(
    wearers,
    1,
    `AdminLayout paints the panel material ${wearers} times; the chrome is one sheet`,
  );
});

/**
 * Rule 2, and the reason it is the precondition for everything else here:
 * --kub-ambient is painted once, on `body`. The panel root painted --kub-bg
 * over it, and the work-area scroller painted --kub-bg again through
 * `kub-grid-subtle` — whose lattice and fill cannot be separated from outside
 * index.css, which is why the grid had to go rather than the colour.
 *
 * [testid, what it is].
 */
const transparentShells = [
  ["admin-shell", "the panel root"],
  ["admin-content", "the work area every panel stands in"],
];

for (const [testid, what] of transparentShells) {
  test(`AdminLayout lets the page ambient through at ${what}`, () => {
    const classes = classesOf("pages/admin/AdminLayout.tsx", testid);
    assert.doesNotMatch(
      classes,
      /\bbg-\[var\(--kub-(bg|chat-bg|surface)/,
      `${what} paints over --kub-ambient, so every panel above it blurs a flat colour`,
    );
    assert.doesNotMatch(
      classes,
      /\bkub-grid-(bg|subtle)\b/,
      `${what} carries a grid class, and both of those set background-color: var(--kub-bg)`,
    );
  });
}

/**
 * Rule 3. The support workspace is a card with two `fixed inset-0` dialogs
 * inside it. With the filter on the card itself they would be laid out against
 * the card rather than the viewport — and `overflow-hidden` here would then
 * clip them as well, since it only clips fixed descendants once the clipper is
 * in their containing-block chain.
 */
test("the support workspace takes the material as a layer, not as a filter on itself", () => {
  const source = read("pages/admin/SupportTab.tsx");
  assert.match(source, /<KubGlassLayer\b/, "the support workspace paints no material at all");

  const rootClasses = classesOf("pages/admin/SupportTab.tsx", "support-operator-workspace");
  assert.doesNotMatch(
    rootClasses,
    /\bkub-glass(-strong)?\b/,
    "the support workspace frosts the box its dialogs live in; a fixed dialog opened from " +
      "here would be laid out against the card instead of the viewport",
  );
  // Positioned, or the layer's `absolute inset-0` has nothing to resolve
  // against and the material lands on the wrong box.
  assert.match(rootClasses, /\brelative\b/, "the workspace root is not a positioning context");
  assertUncontested("the support workspace", rootClasses);

  // Found structurally, as the element after <KubGlassLayer />, because a
  // landmark taken from the body's own classes is a landmark a mutation can
  // delete — that turns "the body is unpositioned" into "no class found".
  const body = source.match(
    /<KubGlassLayer[^>]*\/>\s*(?:\{\/\*[\s\S]*?\*\/\}\s*)?<div\s+className="([^"]*)"/,
  );
  assert.ok(body, "no element follows <KubGlassLayer />, so nothing is painted over it");
  assert.match(body[1], /\brelative\b/, "the workspace body would paint under the glass layer");
  assert.doesNotMatch(
    body[1],
    /\b-?z-\d/,
    "the workspace body takes a z-index; that makes it a stacking context and clamps the " +
      "dialogs it opens",
  );
});

// ── Chrome that covers content it is not part of ─────────────────────────────

/** [file, landmark, what it covers]. */
const covers = [
  ["pages/admin/UsersTab.tsx", "sticky top-2 z-10", 1, "the bulk-action bar over the rows it acts on"],
  ["pages/admin/AuditTab.tsx", "max-h-72 overflow-y-auto", 2, "the audit typeaheads over the filter panel"],
  ["pages/admin/SupportTab.tsx", "max-h-[90dvh]", 2, "the support dialogs"],
  ["pages/admin/dashboard/RegistrationTrend.tsx", "group-hover:block", 1, "the chart's value readout"],
];

for (const [file, needle, count, what] of covers) {
  test(`${what}: made of kub-glass-strong`, () => {
    for (const classes of classStrings(file, needle, count)) {
      assert.match(
        classes,
        /\bkub-glass-strong\b/,
        `${what} does not take the surface from kub-glass-strong; at panel opacity it competes ` +
          "with what it covers",
      );
      assertUncontested(what, classes);
    }
  });
}

// ── Rule 1: the material is never written by hand ────────────────────────────

const ADMIN_FILES = [
  "AdminLayout.tsx", "AuditTab.tsx", "BanModal.tsx", "BansMutesTab.tsx",
  "DashboardTab.tsx", "InvitesTab.tsx", "LocationsTab.tsx", "MuteModal.tsx",
  "OpsReportTab.tsx", "RolesPermissionsTab.tsx", "SupportTab.tsx", "UsersTab.tsx",
  "dashboard/DashboardMetricStrip.tsx", "dashboard/RecentActivity.tsx",
  "dashboard/RegistrationTrend.tsx", "support/SupportConversation.tsx",
  "support/SupportQueue.tsx", "support/SupportTicketDetails.tsx",
].map((name) => `pages/admin/${name}`);

test("the admin panel never writes the material by hand", () => {
  for (const file of ADMIN_FILES) {
    const source = withoutComments(read(file));
    assert.doesNotMatch(
      source,
      /backdrop-filter\s*:|backdropFilter\s*:/,
      `${file} writes its own frosting`,
    );
    // `color-mix(in srgb, var(--token) …)` stays allowed: that is a token being
    // shaded. A literal rgb()/rgba() is what this rule exists to stop. No `\b`
    // in front, because Tailwind arbitrary values write spaces as underscores
    // and `_` is a word character — `shadow-[0_2px_4px_rgba(0,0,0,.4)]` slips
    // straight past a word boundary.
    assert.doesNotMatch(source, /rgba?\(/, `${file} writes its own fill`);
    assert.doesNotMatch(
      source,
      /box-shadow\s*:|boxShadow\s*:/,
      `${file} writes its own shadow`,
    );

    // The declaration is not the only way in. A mutation adding
    // `shadow-[0_2px_4px_var(--kub-bg)]` to a card survived every rule above:
    // it is not a `box-shadow:` declaration, it carries no `rgba(`, and the
    // per-surface checks only look at the four elements that wear the glass.
    //
    // A ring is allowed and depth is not, and the two are told apart by the
    // value: `0_0_0_Npx` has no offset and no blur, so it draws an outline
    // saying "focused" or "selected" rather than inventing an elevation. All
    // four in this zone are that shape.
    for (const [, value] of source.matchAll(/\bshadow-\[([^\]]*)\]/g)) {
      assert.match(
        value,
        /^0_0_0_/,
        `${file} writes its own depth in shadow-[${value}]; only a spread-only ring ` +
          "(0_0_0_Npx) is a signal rather than an elevation",
      );
    }
  }
});

/**
 * The fills that were there before, and must not come back.
 *
 * One survivor, named rather than swept under: the user row is a card on a
 * phone and a bare line on a desktop, and its card fill is a row's, not
 * chrome's. Measured in composited pixels it now sits at 1.022 against the
 * panel in the dark theme, which is to say the card has stopped existing there
 * — but the fix belongs with the row's hover, which another change owns, and
 * changing the fill to the veil would silently cancel that hover, since both
 * write the same background-image.
 */
const KNOWN_ROW_FILL = 1;

test("no admin surface paints an opaque fill under the material", () => {
  const offenders = [];
  for (const file of ADMIN_FILES) {
    const found = (withoutComments(read(file)).match(/bg-\[var\(--kub-(?:surface|bg)[^\]]*\)\]/g) ?? []);
    for (const hit of found) offenders.push(`${file}: ${hit}`);
  }
  assert.equal(
    offenders.length,
    KNOWN_ROW_FILL,
    `expected exactly ${KNOWN_ROW_FILL} known opaque fill in pages/admin, found ` +
      `${offenders.length}:\n  ${offenders.join("\n  ")}`,
  );
  assert.match(
    offenders[0],
    /UsersTab\.tsx: bg-\[var\(--kub-surface-2\)\]/,
    `the one permitted fill is the user row's card on a phone, not ${offenders[0]}`,
  );
});

/**
 * Rule 6, and the shape of the mistake it guards: the admin tables are the
 * densest lists in the product, so a blur per row would be paid on every
 * scrolled frame to reveal the panel already behind them.
 */
for (const file of ["pages/admin/UsersTab.tsx", "pages/admin/AuditTab.tsx",
                    "pages/admin/BansMutesTab.tsx", "pages/admin/support/SupportQueue.tsx"]) {
  test(`${file} keeps its rows off the glass`, () => {
    const source = withoutComments(read(file));
    const rowGlass = source
      .split("\n")
      .filter((line) => /\bkub-glass(-strong)?\b/.test(line) && /\bmap\(|key=\{/.test(line));
    assert.deepEqual(rowGlass, [], `${file} pays for a blur per row on every scrolled frame`);
  });
}

/**
 * Fields, wells and tracks are cut INTO a surface, so they take --kub-inset
 * rather than an elevation colour. --kub-surface-2 was doing this job and can
 * no longer: it also means "a step above", and in the dark theme it now
 * composites within two values of the panel a field sits on — a field flush
 * with the panel holding it, which is what this zone actually looked like.
 *
 * [file, how many wells it carries].
 */
const wells = [
  ["pages/admin/UsersTab.tsx", 3],
  ["pages/admin/AuditTab.tsx", 8],
  ["pages/admin/LocationsTab.tsx", 6],
  ["pages/admin/RolesPermissionsTab.tsx", 6],
  ["pages/admin/InvitesTab.tsx", 1],
  ["pages/admin/BanModal.tsx", 4],
  ["pages/admin/MuteModal.tsx", 6],
  ["pages/admin/SupportTab.tsx", 5],
  ["pages/admin/support/SupportConversation.tsx", 3],
  ["pages/admin/support/SupportTicketDetails.tsx", 3],
  ["pages/admin/dashboard/RegistrationTrend.tsx", 1],
];

for (const [file, count] of wells) {
  test(`${file} cuts its fields into the surface with --kub-inset`, () => {
    const found = (withoutComments(read(file)).match(/bg-\[var\(--kub-inset\)\]/g) ?? []).length;
    assert.equal(found, count, `${file}: expected ${count} well(s) on --kub-inset, found ${found}`);
  });
}
