# The interface material

What LETSCUBE's surfaces are made of, and the rules that keep them one material
rather than a set of similar-looking fills. Written after the stage that
introduced it, because seven of the rules below were learned by breaking
something first, and every one of them is cheaper to read than to rediscover.

The source of truth is `artifacts/kub/src/index.css`. This file explains it; it
does not duplicate it. Where the two disagree, the stylesheet is right and this
file is stale.

## The tokens

Defined per theme in the `.dark` and `.light` blocks. Light is not dark with
different numbers — the two grounds behave differently and the values reflect
that, which is noted at each one.

| Token | What it is |
| --- | --- |
| `--glass-fill` | Chrome that content sits on: sidebars, headers, panels |
| `--glass-fill-strong` | Anything covering content it is not part of: menus, dialogs, toasts, tooltips |
| `--glass-line` | The lit top edge. This, more than the border, is what makes a panel read as a sheet of something |
| `--glass-blur` | What turns "translucent" into "frosted" |
| `--glass-shadow` | Ambient pool, contact shadow, and the inset highlight, in one value |
| `--kub-ambient` | The layered light on the page. Not decoration — see rule 2 |
| `--kub-inset` | What a field, a well or a track is cut into |
| `--kub-raised` | A fixed step above a **known** surface |
| `--kub-raise-veil` | A step above **whatever it is laid on** — see rule 5 |
| `--kub-sink-veil` | A step below it: a control that is present but not offered |
| `--kub-rule` | A line **between** things inside a sheet, as against the edge **of** one — see rule 11 |

And two utilities, `.kub-glass` and `.kub-glass-strong`, which carry the whole
material so that what the application is made of is one edit rather than a
search. Plus `.kub-raise` / `.kub-raise-hover` for the veil.

The chat screen adds a set of its own — its wallpaper and scroll edge, the chips
in the conversation, the own bubble's words and wells, and the pane's grey and
accent. They are recorded under «The chat screen», below the rules.

Colours that carry **words** have their own tokens — `--kub-danger-text` and
`--kub-accent-text` — because a colour legible as a border or a filled button
is not necessarily legible as a sentence. Fills, borders and icon shapes keep
`--kub-danger` and `--kub-cyan`: those answer a 3:1 requirement they already
meet.

## The fourteen rules

### 1. Never write the material by hand

No `backdrop-filter`, no `rgba()` fill, no shadow in a component. Only the
utilities. The moment one panel writes its own, the material stops being one
thing and starts being a family resemblance.

### 2. Translucency needs something behind it

A blur over one flat colour returns that same flat colour. `--kub-ambient` is
the condition for everything else, not a decoration on top of it.

The corollary bites more often: **an opaque fill behind a translucent panel
cancels it.** A page root painting `bg-[var(--kub-bg)]` under a glass header
leaves the blur nothing to sample. The fix is to remove the fill, never to add
more blur. This was found three times — the bots page, the tasks page, and both
main shells.

And a second corollary, which is what finally made the material look like
glass: **a ground is not content.** Chrome sitting *beside* the thing it is
made of glass for reveals only the page, and a blurred page is a page. The chat
header and composer were siblings of the message list in a flex column — below
it, never behind it — so their blur sampled a flat fill and returned it. They
now overlay the list, which runs the full height behind them, and the list
compensates with their *measured* height. Frosted text under the header is the
difference between a translucent panel and glass.

Three things that change costs when chrome overlays content:

- **`scroll-padding` is the half that breaks silently.** Without it
  `scrollIntoView` carries a target to the edge of the scrollport, which is now
  covered: the browser reports success and the message sits under the header.
  Padding and scroll-padding move together, on both sides.
- **Do not reach for `z-index` to fix the paint order, and do not reach for
  `order` either.** Positioned siblings with `z-index: auto` paint in tree
  order, so the list covered the header — but a `z-index` on the header makes
  it a stacking context and traps the fixed dialogs inside it, which is rule 3
  arriving by another road. `order: -1` on the list was the first answer and it
  was wrong: see rule 12. What works is tree order — render the list first and
  the chrome after it.
- **A `ResizeObserver` watches the content box by default**, so a composer that
  grows by its own padding — which is how the mobile keyboard inset is
  applied — does not register. Measured: the dock grew to 390px, the padding
  stayed at 94, and the last message went 296px under the composer. Use
  `border-box`.

### 3. `backdrop-filter` is a containing block for `position: fixed`

An element with a backdrop-filter becomes the reference for fixed descendants.
Glass on the root of a 400px sidebar made a dialog and its scrim lay out inside
that column while the chat panel beside it stayed undimmed.

If a surface has fixed descendants, put the material on a **sheet behind** it,
where it has no descendants to capture. `KubGlassLayer` is that sheet.

### 4. An SVG fill cannot be glass

`backdrop-filter` has no effect on one, so a `<rect>` can only ever be an opaque
colour standing in for a pane. Both Windows startup scenes had this. The pane
has to be a real element behind the drawing.

### 5. Elevation is relative; most tokens are absolute

This one cost three rounds. A field, then a chat row, then a menu item, each
painted with a colour that sat one step above the surface beneath it — until
that surface moved and the two went flush. A chat row under the cursor measured
a ratio of **1.002** against the row beside it: the hover had stopped existing.

None of those values was the cause. Each absolute token answers "one step above
*this* surface" and stops answering the moment it is used on another. A fourth
token would have worked until the fifth surface appeared.

`--kub-raise-veil` answers "one step above whatever is under me". It is applied
as a background **image**, which is the whole trick: it composites over the
`background-color` already there instead of replacing it, so one rule reads
correctly on the page, on a panel and inside a menu, and it cannot go flush with
its own ground.

Use `--kub-raised` only where the pair is fixed and a reviewer can confirm it by
looking at two values. Use the veil for anything standing against a surface that
might move.

`--kub-sink-veil` is the same idea downwards, and it exists because **`opacity`
is not a way to be disabled.** The product faded disabled controls with six
different values of it across 79 places, and on a translucent panel opacity
shows the wallpaper straight through the control: measured 2.23:1 in the dark
theme and 1.94:1 in the light one, against a threshold of 4.5. Sinking gives
7.73:1 and 5.02:1. A disabled control still has to be read; it just must not be
offered. This is the one elevation that does **not** reverse between themes — a
well is darker than its surface in both.

Note: it carries **no transition**, deliberately. `background-image` does not
interpolate — from `none` to a gradient is a discrete swap, confirmed in a
browser — so a transition there buys no fade, while a `transition` shorthand
outside any layer beats Tailwind's `@layer utilities` and replaces the
transition of everything it is applied to. A fade would have to be an opacity
transition on a pseudo-element.

### 6. Nothing that scrolls or repeats

A blur is a layer per element per frame. Message bubbles, list rows, feed cards:
the chrome around them, yes; the content, no. What is behind a bubble is the
chat background, so it would pay for revealing nothing.

### 7. Measure contrast from photographed pixels

Not from the token values. Make the text transparent, screenshot the backdrop,
decode the PNG — then blur, alpha and ambient are all in the number. Threshold
4.5:1 for text, both themes.

The worst backdrop a translucent panel can composite to is a solid white field
in the dark theme and a solid black one in the light theme; a blur cannot make a
uniform field lighter or darker than itself, so that really is the limit.

Contrast measurements answer whether text on a surface is legible. They cannot
tell you whether the surface is **visible** — the first version of this material
was correct, measured, and composited to within two values of the opaque fill it
replaced. Look at it as well.

### 8. The elevation direction reverses between themes

On a dark ground a nearer surface is lighter. On a light ground the panel is
already close to white, so a nearer one is told by going down towards the page.

And the light theme's separation is not won on its panels: its page sits nine
values from them where the dark theme's sits two hundred and fifty. Two rounds
went into raising the light fill and then making its shadow actually clear the
panel edge, and both only reached "barely visible". Moving the ground down
doubled the step under every panel at once without touching one of them.

The pre-paint bootstrap colour is written outside any stylesheet in two places
(`src/lib/themeRuntime.ts` and `index.html`) because it runs before CSS is
applied. Moving `--kub-bg` means moving those too, or there is a flash of the
old colour on every cold start. `tests/unit/theme-bootstrap-parity.test.mjs`
enforces it.

### 9. Prove a test by mutation, and prove the mutation applied

Compare the file's SHA-256 before and after the substitution — not the presence
or absence of anchor text, which gives a false "applied" on an insertion. If the
anchor is not unique, the harness must **refuse** to judge rather than guess.

Two specific traps found here, both of which produced a green test over broken
behaviour:

- Matching a bare property name also matches its vendor prefix, so deleting
  `backdrop-filter` left an assertion satisfied by `-webkit-backdrop-filter`.
- A parser that reads a stylesheet without blanking comments will read a
  sentence *about* a token as a declaration of it. Writing prose about a token
  was therefore a way to break the test guarding it.

### 10. The application's own classes are in `@layer components`, below utilities

`.kub-panel`, `.kub-glass`, `.kub-glow-*`, `.kub-interactive`, `.kub-field`,
`.kub-switch` and the rest live in `@layer components`. Utilities live in
`@layer utilities`, which is declared after it, so **a utility on an element
carrying one of these classes wins**, which is what everyone writing markup
already assumed.

They used to sit outside every layer. Unlayered CSS beats everything inside a
layer regardless of specificity and source order, so a utility touching a
property one of these classes also set was silently dead. Two defects came from
it before it was understood as one thing:

- The raise utilities set a `transition` shorthand, which replaced the
  transition of everything they were applied to. A hover that paired
  `transition-all hover:scale-125` went from easing to snapping.
- `.kub-panel` sets `background`, `box-shadow` and the `border` shorthand, so a
  task card's selected state — a fill, a ring and a border colour, all written
  as utilities — never reached a pixel. Selected and unselected composited to
  the same `rgb(16,39,67)`: a ratio of **1.000**.

The move is `tests/unit/cascade-layers.test.mjs`, which also holds the two
things it rests on: that the installed Tailwind still declares `components`
before `utilities`, and that its `transition-*` utilities still read
`--tw-duration` / `--tw-ease`.

Three things are worth knowing before editing the stylesheet.

**The theme blocks stay unlayered.** `.dark`, `.light` and
`.light .bots-management-surface` declare custom properties and nothing else.
No utility declares `--kub-*` or `--tg-*`, so there is no cascade to lose.

**The element half of the touch-target floor stays unlayered too.** A class is
opt-in: whoever writes `kub-field` on a box can also write the height they want,
and a utility that disagrees should win. `select`, `input[type="checkbox"]`,
`input[type="radio"]` and the `label:has(…)` rows are the opposite — they exist
so a control nobody tagged is still reachable by a finger, which only works
while nothing silently outranks them.

**`.kub-interactive` bridges its tokens into Tailwind's own variables.** It
declares no `transition-property`; the property always comes from a
`transition-*` utility beside it, and the pair only ever worked because the
class outranked the utility. Inside the layer the utility's
`transition-duration: var(--tw-duration, var(--default-transition-duration))`
wins, so the class sets `--tw-duration` and `--tw-ease` as well as the
longhands. Measured: 0.14s / `cubic-bezier(.2,.8,.2,1)` before and after,
collapsing to 0.001s under reduced motion both times — and a `duration-*`
written beside it now wins, which it did not before.

Two rules follow from the move, and both are enforced:

- **A glow is a box-shadow.** `.kub-glow-cyan|pink|soft` and a `shadow-*`
  utility on the same element are two answers to one property; the utility now
  wins and replaces the brand halo with a generic black drop shadow. Six
  surfaces carried both and were rendering the glow; the `shadow-*` was removed
  from each. Rule 1 says the same thing from the other direction.
- **A utility that finally works can still be wrong.** The ops report's warning
  and error callouts wrote a tinted fill that had never rendered. Photographed
  in the light theme once it did, `--kub-muted` on the 8% wash measured
  **4.52:1** and **4.39:1** against **5.59:1** on the untinted panel — the
  second under the floor. The fill was dropped and the border colour, which
  costs nothing and carries the same signal, was kept.

### 11. A border belongs to what you aim at, not to what you look at

One blue line of one weight used to be drawn around the panel, around the card
inside the panel, around the field inside the card and around the chip beside
the field — 276 perimeters and 109 single sides from one token. When everything
is outlined the outline stops being a message, and nested boxes of equal weight
are the thing that reads as dated. Three jobs were being done by one
declaration:

- the **edge** of a sheet, and of chrome pinned against a scroll area, which has
  to hold against arbitrary content passing under it: `--kub-border-color`;
- a **rule** between two blocks that share one surface and scroll together:
  `--kub-rule`, a third of the edge's weight;
- a **nested box** inside a sheet: no perimeter at all, separated by a step of
  material.

Photographed on real pages, the old token as a rule measured a step of 59 in the
dark theme against a sheet edge of 89, and 56 in the light theme against an edge
of **46** — a divider inside a panel was heavier than the panel's own outline.
`--kub-rule` gives 29 and 36, still visible hairlines.

For the 69 boxes that lost their perimeter, what separates them went from a fill
step of 11 (dark) and 14 (light) to **27** and **26**, with a worst case of 26
and 23 — the border did the work before and the material does it now. The
threshold is not invented: 23 is the step by which a panel in this theme stands
off the page (rule 8), so a nested box clearing it is as visible as a panel is.

Four things keep their perimeter, and each is a measurement or a signal rather
than a preference:

- **A well.** A box filled from `--kub-inset` already has a step and it goes
  down; in the dark theme that step measures 18–20 against the panel holding it,
  under the floor. The same wells measure 36–44 in the light theme and would
  have been fine — one value cannot be right in both, and the darker theme
  decides it.
- **A target.** A field, a segment, a task row. Removing the line also removes
  the channel its hover, selection and disabled states speak in — and a resting
  step equal to the hover step is rule 5's 1.002 all over again.
- **A covering surface.** A menu, a toast, a floating pill has to stand on a
  backdrop nobody chose, so it cannot be separated by a step relative to it.
- **A line that means something.** `border-dashed` for empty or deleted, a tone
  on `KubBadge` and `KubNotice`, a media frame, and any variant whose name is
  `outline`.

Two failure modes belong to doing this in bulk, and both happened here. Removing
a width and leaving the colour gives a declaration that draws nothing and looks
deliberate. Adding a resting veil to something that already veils on hover
deletes the hover. `tests/unit/edge-vocabulary.test.mjs` holds both, along with
the named exceptions.

### 12. `order` does not move paint order in WebKit

The chrome overlays the conversation, and which of the two paints on top is the
whole effect. Both are positioned boxes with `z-index: auto`, so the answer is
tree order — and the header came first in the markup. `order: -1` on the list
was what moved it underneath.

`order` re-orders painting for flex items in Chromium. **WebKit does not apply
it to positioned boxes at all.** Reduced to two divs in a flex column, with the
chrome absolutely positioned first and the list `position: relative; order: -1`
second, Chromium paints the chrome on top and WebKit paints the list on top;
with the list `position: static` both agree. The layout is identical in every
case — same box, same offsets — and only the painting differs, which is why
nothing about the geometry gave it away.

What it cost: for the whole of this stage the chat header did not exist on any
iPhone. Measured on WebKit 26.4 at 390x844, the header's own box was at top 0
with height 56 and byte-identical geometry to Chromium, no ancestor carried a
backdrop-filter, and the topmost element at the centre of the header was a
message bubble. The back button's own centre hit-tested to a bubble, and the
header's menu could not be opened at any width, 1440 included. On a phone that
header is the only way out of a conversation.

Three things follow.

- **Tree order is the mechanism.** The list is rendered first and the chrome
  after it. It costs reading order — the conversation is read before its
  header — and that is the cheapest price on offer.
- **The alternatives were measured, not assumed.** A `z-index` on the chrome,
  or an `isolation` on the column, makes a stacking context and clamps every
  `fixed` overlay in the subtree: this header's menu and modals, the composer's
  camera and video recorder, a bubble's context menu. Whichever of the two
  chrome boxes then lost would have its full-screen dialog covered by the
  other, and on a phone the header's menu opens exactly where the composer is.
  A negative `z-index` on the list is worse still: measured, the list stops
  being the hit-test target in both engines.
- **The matrix had six Chromium viewports and no WebKit.** That is the reason a
  defect this size survived six deploys. `webkit-mobile-390` is now in
  `playwright.config.ts`; with the pre-fix source restored exactly, all seven
  Chromium checks pass and WebKit fails two, which is the proof that the engine
  is the variable and no width of Chromium substitutes for it.

### 13. The page is drawn under the hardware, and every edge reads how much

`index.html` asks for `viewport-fit=cover`. The installed iPhone app is then
drawn from edge to edge — under the status bar, the Dynamic Island and the home
indicator in portrait, and under the notch on both long edges in landscape —
and `env(safe-area-inset-*)` reports how much of each edge the hardware takes.

Without `cover` iOS decides where an installed web app goes, and it does not
document that decision: the owner's two screenshots of one build did not agree
with each other. With `cover` the placement is documented and the work moves to
us, because every surface pinned to an edge has to read the insets. Before this
rule four places read the top inset, five the bottom and none the sides; the
chat header, the list header and the top bar read nothing, the update banner
sat 12px from the top of the screen — under the island — and the chat header's
phone menu sat 12px from the bottom, on the home indicator.

- **One source.** `--kub-safe-top`, `-right`, `-bottom` and `-left` on `:root`
  take `env(…, 0px)` once, and everything else reads the tokens — including the
  surfaces that place themselves in script, through `lib/safeArea.ts`, which
  measures them as a computed padding. `tests/unit/safe-area-insets.test.mjs`
  fails on any other `env(safe-area-inset-*)`. That is not tidiness: Playwright's
  WebKit reports every inset as `0px`, so a surface reading `env()` cannot be
  checked in Safari's engine at all, and a token can be given a value there.
- **The material goes under; controls and text do not.** A header, a sheet or a
  bar pads the inset out of itself, so its glass runs under the status bar or
  the home indicator and its row starts clear of them. The height grows by the
  inset instead of the row shrinking by it — boxes are `border-box`, and padding
  beside a fixed height comes out of the row, which is D-065 again.
- **A sum when the gap is from the hardware, `max()` when it is from the
  edge.** A banner 12px below the status bar is `calc(0.75rem + inset)`; a dialog
  that keeps 16px from every edge is `p-safe-gap` with `[--kub-safe-gap:1rem]`.
  Either way a screen without insets gets exactly the geometry it had.
- **The keyboard covers the home indicator.** The composer pads the larger of the
  two, never their sum; the sum left a strip of the inset's height between the
  composer and the keys.
- **Held sideways, the notch is on the sides.** The shells pad `px-safe`, and the
  page ground shows in the two bands, which is what iOS paints there for a page
  that does not ask for the whole screen. The hand-placed surfaces — the support
  window, the contact card, the notification panel, the chat list's menu — are
  placed in the part of the screen the hardware leaves alone and drawn offset by
  the insets, so the clamping they already had keeps them off the notch without
  knowing there is one.
- **Which chrome is on top depends on the width.** Below `md` the pane headers are
  the top of the screen and carry the inset; from `md` the application's top bar
  does, and the pane headers do not.
- **The status bar is iOS's, and so is its glyphs' colour.** `black-translucent`
  draws the status bar over the page, and over the light theme's glass the clock
  and the battery disappeared. The meta tag cannot follow the theme — iOS reads it
  when the app is added to the home screen — so in the light theme the page paints
  an opaque band of `#3D78B8` over the top inset, in the installed app only
  (`data-ios-standalone`, set from `navigator.standalone`). Opaque, because a veil
  changes with what scrolls under it, and the first one, 0.6 of the dark ground,
  turned the band grey and was rejected when it was shown. Mid-toned, because the
  documentation says the glyphs are white while screenshots from the owner's
  iPhone show them dark over the light theme: this blue gives white 4.59:1 and
  black 4.58:1. The unit test does that arithmetic and the WebKit stand
  photographs it. Switching the status bar style instead would put a white band
  over the dark theme and need every icon re-added.
- **Android is unaffected today and cannot double.** Capacitor 8's `SystemBars`
  hands the insets to the page only when the WebView is 140 or newer *and* the
  viewport has `cover`; otherwise it pads the WebView's parent and gives the page
  zero. It never does both. On a WebView older than 140 the shell keeps padding
  as it does now; on a newer one the next APK draws edge to edge and depends on
  exactly this rule.

The stand is `tests/e2e/ios-standalone-safe-area.spec.ts`: WebKit at iPhone 14
Pro size with the insets injected through the tokens (`webkit-ios-standalone`),
and Chromium with the insets overridden inside the engine, so `env()` itself
reports them (on `chromium-mobile-390`). Both assert that nothing a person can
see or tap is inside an unsafe area. Neither proves what iOS does with the
viewport — the device checklist in the defect register does that.

### 14. A surface that animates in hides itself, never its container

A surface placed in script is laid out once invisibly, measured, and moved to
where it belongs; `visibility: hidden` covers that one pass. When the hidden
element is a container and the surfaces opening with `kub-menu-in` are inside
it, **WebKit can end their entrance without ever applying it**: the animation
runs and finishes, and the style computed for the surfaces stays on the first
keyframe — opacity 0 at .98 — until something else restyles the page.

Measured on WebKit 26.4 with the desktop message menu (D-091). The column that
holds the reaction bar and the action card flipped its visibility; the
animation reached its end and fired `animationend`, and both surfaces still read
opacity 0 more than a second later. Taking off the backdrop filters, the
transitions, the shadow, the positioning or the card's animation changed
nothing; forcing the column visible fixed it. The phone's surfaces, each fixed
and hiding itself, came to rest in the same engine.

- **The visibility goes on the surface.** A container that only positions keeps
  its `top` and `left`, and every surface in it that animates carries its own
  `visibility` until placed — `hiddenUntilPlaced` and `shownOncePlaced` in
  `MessageActionLayer.tsx` are the two shapes.
- **A screenshot does not see it.** Taking one restyles the page, and the picture
  showed both surfaces at rest. Read the computed style: `settleAnimations` in
  `tests/e2e/emoji-touch-targets.spec.ts` waits for every `kub-menu-in` surface to
  reach opacity 1 with no transform, and names one that does not.
- **Nor does the document's list of animations.** WebKit drops an animation from
  `getAnimations()` when it ends, and the computed style can trail it: the hover
  column read .99 until 700 ms after an end at 480, and the menu never caught up.
- **No blank-page reduction reproduced it**, with or without a backdrop filter,
  in a wrapper hidden for one or two frames. The rule is the product's shape that
  failed, kept because nothing about it showed in Chromium.

## The chat screen

On 2026-09-11 the owner put the installed iPhone app beside Telegram on iOS 26,
and from the assessment that followed chose option C, «Капсулы и цвет» — the
geometry and the colour together — for every shell: the installed iPhone app,
Android, the web app and the Windows app. What it is:

- **No band.** Nothing is drawn under the status bar or across the
  conversation. The header is three capsules in its row: the way back, with the
  count of what is unread in the other chats, below `md` only, where no chat
  list is beside it; the avatar and name, centred on the pane; and a round «⋯».
  The pinned message, the search panel, the topic strip and the selection bar
  float as capsules under it. The composer is a round attach button, a field
  capsule and a round microphone.
- **A scroll edge** behind the chrome and under the composer: the conversation
  dimmed to 96% of the wallpaper's own colour at the screen's edge and 88% at
  the chrome's foot, frosted, and let go over 24px.
- **A wallpaper.** LETSCUBE's own pattern — a cube, a message, a task's check
  mark, a location pin and a key, with a smaller cube and a few dots — over
  three pools of the brand's hues and a vertical gradient, painted on the
  scroller that already painted the chat's ground.
- **A saturated own bubble**, royal blue `#3B5CCF` in both themes, with white
  words. Incoming bubbles have no outline. The date, the unread marker, a system
  notice and the history band are filled chips.

The code is `lib/chatChrome.ts`, the chat screen's tokens in `.dark` and
`.light`, and the rules under «The chat screen» in `@layer components`. The
renders and every number below come from `scripts/render-chat-chrome-frames.mjs`.

### What it bends, and why

- **Rule 13, "the material goes under": bent.** Under the status bar there is no
  material, only the scroll edge. The capsules still start below the inset — the
  header pads `--kub-safe-top` out of itself, as it did — and the edge runs under
  the hardware. The light theme keeps its opaque `#3D78B8` band in the installed
  app: the glyphs' colour is still iOS's to choose, and whether iOS 26 adapts it
  to what is under it has not been checked on a device.
- **Rule 1, "never write the material by hand": bent once, in the stylesheet.**
  The scroll edge writes its own `backdrop-filter`, `--kub-chat-edge-blur` at
  10px, on two pseudo-elements. It cannot be `.kub-glass`: it is a gradient of
  the wallpaper's own colour, dense on purpose, and not a panel. No component
  writes a filter.
- **Rule 11: kept in spirit, one token over.** A floating capsule keeps its
  perimeter, as a covering surface does, but the rim is `--glass-line`: a capsule
  is not a sheet. The bubbles lost their outlines — the own one stands off the
  ground by its fill, 3.02:1 in the dark theme and 3.49:1 in the light one on a
  phone, and the incoming one by its shape — and the composer's well lost its
  perimeter with the band it was cut into. Perimeters in the sheet-edge colour
  went from 202 to 197, and the ratchet went with them.
- **D-062: reversed for the chips in the conversation.** They take
  `--kub-chat-chip`, a flat token fill: still no blur, still no hand-mixed
  translucent fill, still not the veil. Over a patterned ground a word needs a
  ground of its own. The light theme's pink unread marker works out at 4.28:1 on
  the wallpaper's bare ground.
- **Rule 5's hover moves onto the glass.** A capsule that is itself a control
  cannot take `.kub-raise-hover`: the veil is painted on the button's own
  background, under the glass layer that is its first child, where the light
  theme's .80 fill hides it. The capsule steps its glass instead, with the same
  two veils laid on the layer through `group-hover/capsule` and
  `group-active/capsule` (`CAPSULE_CONTROL_GLASS`). The hover is inside
  `(hover: hover)`, so a finger leaves none behind.
- **Words scoped to the pane.** `.kub-chat-screen` hands the chat pane its own
  grey, accent text and accent, and `.kub-message-own` hands the own bubble its
  own words and wells. They were measured over the wallpaper and under a blue
  bubble passing beneath the translucent capsules, where the product's grey and
  accent measured 3.65:1 and 4.05:1. The rest of the product was measured on
  other grounds and keeps its values. The own bubble's wells — a reply preview, a
  reaction chip, the read-receipt chip — are a darker step of its blue, because
  the theme's surface tokens are near-white in the light theme, where the white
  words over them vanished.
- **Rule 8: untouched.** `--kub-bg` does not move. The chat's ground is
  `--kub-chat-ground` on the scroller, so no bootstrap colour changes and a cold
  start does not flash.
- **Rule 2: served.** The opaque `.chat-bg` that covered the ambient with one
  navy became the coloured ground the capsules' glass samples.
- **Rules 3, 6 and 12: kept.** Every capsule's glass is a `KubGlassLayer` leaf
  with a positioned control or row over it. The edges are pseudo-elements with no
  descendants and no pointer. Paint order is still tree order, with no z-index,
  and nothing that scrolls is blurred. `tests/unit/shell-glass.test.mjs` and
  `tests/unit/chat-chrome.test.mts` hold these.
- **The cost.** Blurred layers in a phone chat went from 3 to 9: two edges, the
  way back, the title, «⋯», the pinned message, attach, the field and the
  microphone. On a desktop there are 8. That is proven in Chromium and in
  Playwright's WebKit, not on an iPhone, and not yet on an older one.

### Measured

Photographed, worst pixel, threshold 4.5:1. The conversation at rest, on the
fictional private chat of the renders:

| Text | iPhone, dark | iPhone, light | Android, dark | Desktop, dark | Desktop, light |
| --- | --- | --- | --- | --- | --- |
| Own message | 5.80 | 5.80 | 5.80 | 5.80 | 5.80 |
| Own message's time | 4.75 | 4.75 | 4.75 | 4.75 | 4.75 |
| Incoming message | 13.92 | 18.94 | 13.92 | 13.92 | 18.94 |
| Incoming message's time | 8.19 | 7.55 | 8.19 | 8.19 | 7.55 |
| Sender's name | 8.84 | 5.35 | 8.76 | 8.71 | 5.15 |
| Date chip | 9.68 | 17.22 | 10.00 | 9.95 | 17.19 |
| The way back's count | 15.29 | 18.09 | 14.87 | — | — |
| Header, name | 14.95 | 17.94 | 14.84 | 15.31 | 17.98 |
| Header, status | 8.86 | 7.14 | 8.73 | 9.02 | 7.21 |
| Pinned, label | 9.18 | 9.32 | 9.59 | 9.81 | 9.56 |
| Pinned, text | 8.73 | 7.10 | 8.88 | 9.00 | 7.22 |
| Composer, placeholder | 7.11 | 5.43 | 7.11 | 7.10 | 5.43 |

And the chrome's words over the worst field a translucent surface can meet —
solid white under the dark theme, solid black under the light one — which is
what bright content passing under the capsules can at most become:

| Chrome text | iPhone, dark | iPhone, light | Android, dark | Desktop, dark | Desktop, light |
| --- | --- | --- | --- | --- | --- |
| The way back's count | 13.69 | 17.48 | 14.11 | — | — |
| Header, name | 13.23 | 17.32 | 13.74 | 12.96 | 17.32 |
| Header, status | 7.98 | 6.96 | 8.17 | 8.20 | 7.02 |
| Pinned, label | 8.39 | 9.16 | 8.52 | 8.59 | 9.18 |
| Pinned, text | 7.60 | 6.90 | 7.67 | 7.68 | 6.90 |
| Composer, placeholder | 5.86 | 5.21 | 6.00 | 5.68 | 5.16 |

Before this, over the same fields, the dark header's name measured 2.54:1 and
its status 1.12:1, and the light header's status 3.64:1.

- **D-117.** The light theme's own-bubble time measured 4.31:1 on the old
  tinted bubble. On the royal blue it is 4.75:1.
- **The light accent text is two steps darker than the option rendered.**
  `#2B45A3` held a sender's name at 4.52:1 on a phone and 4.35:1 on a desktop,
  where the names sit on the violet pool at the left and a pattern stroke over it
  is the darkest ground a word meets. `#213A94` is 5.15:1 there.
- **The Windows app.** The window's own buttons are in the application's top
  bar, 44px across both panes, and the chat pane starts under it, so its capsules
  are in a different row. Measured at 1360×860: the title and «⋯» are 7px below
  the buttons with no overlap, and a click at the centre of each capsule and of
  each window button reaches it. D-112 is about the pages whose own controls sit
  in the buttons' row; the chat pane is not one of them.

## Where the material is not used, on purpose

- **Message bubbles and list rows** — rule 6.
- **Anything carrying a danger fill with guaranteed-contrast text on it.** The
  signal comes before the surface, and the foreground colour is only guaranteed
  against the undiluted fill.
- **`card.tsx`** — content, not chrome, and it repeats down a scrolling page.
- **The media viewer's frame** — glass would tint the photograph.

## Fallback

`@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter:
blur(1px)))` gives opaque fills. A translucent panel over unblurred content is
unreadable, which is worse than no effect at all.

Both spellings, because the fallback is for a browser that frosts through
neither. Safari before 18 frosts only through the prefixed property, and a
condition naming the unprefixed one alone would give every iPhone still on iOS
17 a flat fill over a material that renders. The shipped stylesheet already
carried both — Lightning CSS adds the prefixed branch for the browsers it
targets — so this was insurance, not a repair: the source no longer depends on
the build's target list to say it. `tests/unit/backdrop-fallback-condition.test.mjs`
holds it. The fallback cannot match the composited values, so what it preserves is
the **relationship**: strong is the lighter of the two in the dark theme,
because that is what "above" means there, and a menu must not read as a recess
in the panel it opens over.
