import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * The application's frame is made of the same material as its overlays, and
 * neither is written out by hand.
 *
 * `tests/unit/overlay-glass.test.mjs` holds this line for `components/ui`. This
 * file holds it for the shell: the top bar, the sidebar column, the bottom
 * navigation, the chat header and the composer. They are the surfaces content
 * *sits on*, so they take `kub-glass`; the menus that open over that content
 * take `kub-glass-strong`.
 *
 * Three separate things are asserted, because three separate things went wrong
 * while this was being built:
 *
 *  1. The surface uses the utility at all. A panel that keeps
 *     `bg-[var(--kub-surface)]` is simply not made of the material.
 *  2. Nothing competes with the utility on the same element. `.kub-glass` and
 *     `.kub-glow-soft` both set `box-shadow` and both sit unlayered in
 *     index.css, so whichever is written later in the file wins — the panel's
 *     depth would then depend on stylesheet order rather than on a decision.
 *  3. The shells behind the glass stay transparent. `--kub-ambient` is painted
 *     once, on `body`; an opaque shell over it hands every panel one flat
 *     colour to blur and the whole material collapses to paint. This is not a
 *     style preference — it is the precondition for the other two mattering,
 *     and it is invisible in a screenshot of a single panel.
 */

const root = new URL("../../artifacts/kub/src/", import.meta.url);
const read = (file) => readFileSync(new URL(file, root), "utf8");

/**
 * Chrome that content sits on, and that opens nothing, so it can wear the
 * material on the element itself. `-strong` here would be a heavier panel than
 * the job needs.
 */
const panels = [
  ["components/layout/AppTopBar.tsx", "kub-app-topbar-height", "kub-glass"],
  ["components/layout/BottomNav.tsx", "justify-around", "kub-glass"],
  ["components/kub/KubHeader.tsx", "border-b border-[color:var(--kub-border-color)]", "kub-glass"],
];

/**
 * Chrome that content sits on *and* that opens something `fixed`.
 *
 * These take the material as a layer instead. `backdrop-filter` makes its
 * element a containing block for fixed descendants, so with `kub-glass` on the
 * sidebar's own box the settings dialog was laid out against the 400px column,
 * scrim and all, and rendered under the top bar. Each entry is [file, the root
 * class string].
 *
 * The body that has to sit over the layer is not named here. It is found
 * structurally, as the element immediately after `<KubGlassLayer />`, because a
 * landmark taken from the body's own classes is a landmark the mutation under
 * test can delete — three mutations did exactly that and turned "the body is
 * unpositioned" into "no class string found".
 */
const layered = [
  ["components/sidebar/Sidebar.tsx", "relative flex h-full w-full flex-col"],
  ["components/chat/ChatHeader.tsx", "relative flex flex-shrink-0 flex-col"],
  ["components/chat/MessageInput.tsx", "relative flex-shrink-0"],
  ["pages/public/PublicPreviewCapturePage.tsx", "relative h-full flex-shrink-0 flex-col border-r"],
];

/** The class string of whatever the layer is painted behind. */
function bodyAfterLayer(source) {
  // An optional JSX comment may sit between the two, explaining the pairing.
  const found = source.match(
    /<KubGlassLayer[^>]*\/>\s*(?:\{\/\*[\s\S]*?\*\/\}\s*)?<div\s+className="([^"]*)"/,
  );
  assert.ok(found, "no element follows <KubGlassLayer />, so nothing is painted over it");
  return found[1];
}

/** Chrome that covers content it is not part of. */
const covers = [
  ["components/sidebar/SidebarHeader.tsx", "absolute left-0 top-12 w-64", "kub-glass-strong"],
  ["components/chat/ChatHeader.tsx", "max-h-[min(70vh,480px)]", "kub-glass-strong"],
  ["components/kub/KubModal.tsx", "kub-modal-panel", "kub-glass-strong"],
  ["components/kub/KubTooltip.tsx", "text-[color:var(--kub-text)] border", "kub-glass-strong"],
  ["components/kub/KubFeedbackViewport.tsx", "py-2.5 pl-4 pr-3", "kub-glass-strong"],
  // The chat list's context menu, in both the shapes it takes.
  ["components/sidebar/ChatList.tsx", "w-[272px] max-w-[calc(100vw-24px)]", "kub-glass-strong"],
  ["components/sidebar/ChatList.tsx", "max-h-[82vh] w-full overflow-hidden", "kub-glass-strong"],
];

/**
 * Elevation is relative, and the two halves of that are not interchangeable.
 *
 * `--kub-raised` is an absolute colour. It answers "one step above THIS
 * surface", so it is right where the pairing is fixed and reviewable — the
 * strips that always sit on the composer and nowhere else. It is wrong for
 * anything whose ground can move, which is how the same defect landed three
 * times in a row: a field, a list row and a menu item each held a colour that
 * had been one step above its surface until that surface shifted, and each was
 * measured flush afterwards (1.002 for the row's hover, which is to say it had
 * stopped existing while still being perfectly present in the source).
 *
 * `.kub-raise-hover` is a veil laid on as a background IMAGE, so it composites
 * over whatever fill the element already has instead of replacing it. One rule
 * reads the same on the page, on a panel and inside a menu, and it cannot go
 * flush with its own background. Every hover in this zone uses it; measured, a
 * chat row moves 1.211 and a menu item inside a frosted menu 1.229, where the
 * absolute token could not have moved the menu item at all.
 */
const raised = [
  ["components/chat/MessageInput.tsx", "bg-[var(--kub-raised)]", 7],
];

/** [file, how many hovers it carries]. Leftover elevation fills must be zero. */
const veiled = [
  ["components/sidebar/ChatListItem.tsx", 2],
  ["components/sidebar/ChatList.tsx", 1],
  ["components/sidebar/SidebarHeader.tsx", 4],
  ["components/sidebar/FolderTabs.tsx", 1],
  ["components/sidebar/NotificationBell.tsx", 6],
  ["components/sidebar/SettingsModal.tsx", 2],
  ["components/sidebar/FolderEditModal.tsx", 2],
  ["components/sidebar/FolderListModal.tsx", 1],
  ["components/sidebar/AudioSettingsSection.tsx", 1],
  ["components/sidebar/NewGroupModal.tsx", 1],
  ["components/sidebar/NewChatModal.tsx", 1],
  ["components/layout/AppTopBar.tsx", 1],
  ["components/layout/DesktopWindowChrome.tsx", 1],
  ["components/kub/KubModal.tsx", 1],
  ["components/kub/KubButton.tsx", 2],
  ["components/kub/KubFilterChip.tsx", 1],
  ["components/kub/KubFeedbackViewport.tsx", 1],
  ["components/chat/ChatHeader.tsx", 5],
  ["components/chat/MessageInput.tsx", 8],
];

/** The class string of one surface, found by a landmark that is not the glass class itself. */
function classString(file, needle) {
  const hit = [...read(file).matchAll(/"([^"\n]{12,})"/g)]
    .map((match) => match[1])
    .find((value) => value.includes(needle));
  assert.ok(hit, `${file}: no class string containing "${needle}"`);
  return hit;
}

for (const [file, needle, expected] of [...panels, ...covers]) {
  test(`${file} (${needle}) is made of ${expected}`, () => {
    const classes = classString(file, needle);
    // `kub-glass-strong` contains `kub-glass`, so the weaker one is matched on
    // a word boundary that a `-strong` suffix breaks.
    const pattern =
      expected === "kub-glass"
        ? /\bkub-glass(?!-strong)\b/
        : /\bkub-glass-strong\b/;
    assert.match(classes, pattern, `${file} does not take its surface from ${expected}`);

    assert.doesNotMatch(
      classes,
      /\bbg-\[var\(--kub-(surface|chat-bg|bg)/,
      `${file} keeps an opaque fill beside the glass utility`,
    );
    assert.doesNotMatch(
      classes,
      /\bshadow-(2xs|xs|sm|md|lg|xl|2xl)\b/,
      `${file} keeps its own drop shadow beside --glass-shadow`,
    );
    assert.doesNotMatch(
      classes,
      /\bkub-glow-(soft|cyan|pink)\b/,
      `${file} keeps a glow beside --glass-shadow; both set box-shadow and only one survives`,
    );
    assert.doesNotMatch(
      classes,
      /\bbackdrop-blur\b/,
      `${file} frosts by hand instead of through the utility`,
    );
  });
}

for (const [file, rootClasses] of layered) {
  test(`${file} takes the material as a layer, not as a filter on itself`, () => {
    const source = read(file);

    assert.match(
      source,
      /<KubGlassLayer\b/,
      `${file} does not paint the material at all`,
    );

    const rootHit = classString(file, rootClasses);
    assert.doesNotMatch(
      rootHit,
      /\bkub-glass(-strong)?\b/,
      `${file} frosts the box that its overlays live in; a fixed dialog opened from here ` +
        "would be laid out against this panel instead of the viewport",
    );
    // Positioned, or `absolute inset-0` on the layer has nothing to resolve
    // against and the material lands on the wrong box.
    assert.match(rootHit, /\brelative\b/, `${file}'s root is not a positioning context`);

    // The layer is positioned, so the body has to be positioned too: two
    // positioned boxes with `z-index: auto` paint in tree order, which is what
    // keeps the content above the material without a stacking context.
    const bodyHit = bodyAfterLayer(source);
    assert.match(bodyHit, /\brelative\b/, `${file}'s body would paint under the glass layer`);
    assert.doesNotMatch(
      bodyHit,
      /\b-?z-\d/,
      `${file}'s body takes a z-index; that makes it a stacking context and clamps the ` +
        "overlays it opens",
    );
  });
}

for (const [file, needle, count] of raised) {
  test(`${file} keeps its static raised surfaces on --kub-raised`, () => {
    const source = read(file);
    const found = source.split(needle).length - 1;
    assert.equal(found, count, `${file}: expected ${count} element(s) on "${needle}", found ${found}`);
    // And none left on the token that used to serve this and no longer can:
    // --kub-surface-2 composites BELOW the chrome these sit on.
    const stale = withoutComments(source).split("bg-[var(--kub-surface-2)]").length - 1;
    assert.equal(
      stale,
      0,
      `${file}: ${stale} surface(s) still filled from --kub-surface-2, which now composites ` +
        "below the chrome they lie on",
    );
  });
}

/** Any neutral elevation fill spent on a hover, which the veil replaces. */
const LEFTOVER = /hover:bg-\[var\(--kub-(raised|surface-2|surface-3)\)\]/g;

for (const [file, count] of veiled) {
  test(`${file} finds its hovers with the veil, not with a fixed colour`, () => {
    const source = read(file);
    const found = source.split("kub-raise-hover").length - 1;
    assert.equal(found, count, `${file}: expected ${count} hover(s) on the veil, found ${found}`);
    // Counting the survivors as well as the converts: a partial conversion is
    // the failure that actually happens, and one hover left behind is
    // invisible in a screenshot of the others.
    const leftBehind = (withoutComments(source).match(LEFTOVER) ?? []).length;
    assert.equal(
      leftBehind,
      0,
      `${file}: ${leftBehind} hover(s) still painted with a fixed elevation colour, which goes ` +
        "flush the moment the surface under it moves",
    );
  });
}

test("the glass layer is a leaf that carries the material and nothing else", () => {
  const source = read("components/kub/KubGlassLayer.tsx");
  // Both fills, so a layered panel can still choose to cover content.
  assert.match(source, /"kub-glass-strong"/, "the layer cannot express a covering surface");
  assert.match(source, /"kub-glass"/, "the layer cannot express a panel surface");

  // Anchored on `absolute inset-0`, which none of the mutations below remove;
  // an anchor that included `pointer-events-none` would vanish along with the
  // very property being tested.
  const classes = classString("components/kub/KubGlassLayer.tsx", "absolute inset-0");
  // It sits over the panel's whole box and must never take a click meant for
  // the panel underneath it.
  assert.match(classes, /\bpointer-events-none\b/, "the layer would swallow clicks");
  assert.doesNotMatch(
    classes,
    /\bshadow-(2xs|xs|sm|md|lg|xl|2xl)\b|\bkub-glow-(soft|cyan|pink)\b/,
    "the layer carries a second shadow beside --glass-shadow",
  );
  // A z-index here would need the host to be a stacking context, which is the
  // very thing the layer exists to avoid.
  assert.doesNotMatch(classes, /\b-?z-\d/, "the layer takes a z-index and forces a stacking context");
});

/**
 * The shells that must stay transparent, and the fill each one used to paint.
 *
 * Named individually rather than swept, so that deleting the assertion is the
 * only way to lose the coverage — a repository-wide scan would go quiet the
 * moment a file was renamed.
 */
const transparentShells = [
  ["components/layout/MainLayout.tsx", "flex flex-col h-[100dvh] w-screen"],
  ["components/chat/ChatWindow.tsx", "relative flex h-full w-full min-w-0"],
  ["components/sidebar/FolderTabs.tsx", "relative flex items-center flex-shrink-0"],
  ["pages/public/PublicPreviewCapturePage.tsx", "flex h-[100dvh] w-screen flex-col"],
];

for (const [file, needle] of transparentShells) {
  test(`${file} lets the page ambient through`, () => {
    const classes = classString(file, needle);
    assert.doesNotMatch(
      classes,
      /\bbg-\[var\(--kub-(bg|chat-bg|surface)/,
      `${file} paints over --kub-ambient, so every panel above it blurs a flat colour`,
    );
  });
}

/** Comments explain the measurements; only the code is under this rule. */
const withoutComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

test("the shell never writes the material by hand", () => {
  const files = [...new Set([...panels, ...covers].map(([file]) => file))].concat(
    "components/kub/KubGlassLayer.tsx",
  );
  for (const file of files) {
    const source = withoutComments(read(file));
    // `backdrop-blur` is not banned file-wide, and deliberately so: a scrim
    // behind a dialog and a badge over a video frame both use it legitimately,
    // and neither is a chrome surface. What the material rule forbids is a
    // *panel* frosting itself, and the per-surface assertions above already
    // reject `backdrop-blur` on the glass elements themselves.
    assert.doesNotMatch(
      source,
      /backdrop-filter\s*:|backdropFilter\s*:/,
      `${file} writes its own frosting`,
    );
    // `color-mix(in srgb, var(--token) …)` stays allowed: that is a token being
    // shaded, not a colour invented in a component. A literal rgb()/rgba() is
    // the thing this rule exists to stop.
    //
    // No `\b` in front. Tailwind arbitrary values write their spaces as
    // underscores, so the commonest way to smuggle a colour in is
    // `shadow-[0_2px_4px_rgba(0,0,0,.4)]` — and `_` is a word character, so a
    // word boundary is exactly what is missing there. A mutation putting that
    // string into KubFeedbackViewport survived the earlier `\brgba?\(`.
    // `color-mix(in srgb, …)` is still safe: `srgb` is not followed by `(`.
    assert.doesNotMatch(source, /rgba?\(/, `${file} writes its own fill`);
    // The declaration, not the word: `transition-[…,box-shadow]` names the
    // property it animates and invents no depth.
    assert.doesNotMatch(source, /box-shadow\s*:|boxShadow\s*:/, `${file} writes its own shadow`);
  }
});

/**
 * The list rows and the message bubbles are deliberately NOT glass.
 *
 * There are dozens of each on screen and each blur is a layer the compositor
 * pays for on every scrolled frame — to reveal the chat background, which is
 * the thing already behind them. The frame around them is the material; their
 * contents are not.
 */
for (const file of ["components/sidebar/ChatListItem.tsx", "components/chat/MessageBubble.tsx"]) {
  test(`${file} is not made of glass`, () => {
    assert.doesNotMatch(
      read(file),
      /\bkub-glass(-strong)?\b/,
      `${file} pays for a blur per row on every scrolled frame`,
    );
  });
}
