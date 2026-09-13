# LETSCUBE Interface Defect Register

Deliverable of queue item 18 in `docs/PRODUCTION_PRIORITY_TRACKER.md` — the
interface audit and polish stage.

The stage itself is scheduled after the public home plan closes. This register is
open early because defects were found while capturing the product previews from
the shipping components, and evidence is cheapest to record at the moment it is
observed.

D-001 to D-003 and D-006 to D-007 were pulled forward and fixed on 2026-09-01,
because they were contaminating the product imagery that the public home is about
to publish. The remaining entries belong to the stage.

Rules for entries: a reproduction, the exact surface with `file:line`, what is
actually wrong, and the observable consequence. No entry without evidence.

Status legend: `[ ]` open, `[~]` fix in progress, `[x]` fixed with a regression
test.

---

## D-001 `[x]` Incoming message bubbles have no background at all

**Severity:** high. Every incoming message in the product, in both themes.

**Surface:** `artifacts/kub/src/components/chat/MessageBubble.tsx:927`, also
`:1134` and `artifacts/kub/src/components/chat/TypingIndicator.tsx:6`.

**Defect:** all three read `var(--kub-message-in)`. That custom property is
**never defined**. `artifacts/kub/src/index.css` defines `--kub-message-out` for
both themes (`:148` dark, `:281` light) and `--kub-surface` (`:131`, `:264`), but
there is no `--kub-message-in` anywhere in the repository. An undefined custom
property makes `background-color` resolve to nothing, so the bubble is
transparent and only its border remains.

**Evidence:** sampled from the captured light-theme phone preview —

| Sample | RGB |
| --- | --- |
| Chat wallpaper, empty area | `244, 248, 251` |
| Inside an incoming bubble | `244, 247, 253` |
| Inside an outgoing bubble | `130, 143, 157` |

The incoming bubble is indistinguishable from the wallpaper behind it; the
outgoing bubble, which uses a defined `color-mix` on `--kub-cyan`, is not.

**Consequence:** incoming messages read as text floating on the wallpaper inside
a thin outline rather than as bubbles. It is a large part of why the chat looks
unfinished. The selected-message highlight at `:1134` mixes against the same
undefined token, so selection is also weaker than intended.

**Fixed** 2026-09-01. `--kub-message-in: var(--kub-surface)` is now defined in
both theme blocks, which is the token the bubble tail already resolved to. Same
sample after the fix: incoming bubble `251, 255, 255` against a `244, 248, 251`
wallpaper. Covered by `tests/unit/theme-token-contract.test.mjs`, which asserts
that every referenced theme token is defined and that both message-surface
tokens differ from the chat background in each theme.

---

## D-002 `[x]` The bubble tail is a different colour from its own bubble and lands on the avatar

**Severity:** high. Every last-in-group message.

**Surface:** `artifacts/kub/src/index.css:433-456` (`.bubble-out::after`,
`.bubble-in::after`), applied at
`artifacts/kub/src/components/chat/MessageBubble.tsx:1130-1131`.

**Defect:** three problems in one element.

1. **Colour mismatch.** The incoming tail is filled with `--tg-message-in`,
   which `index.css:217` and `:350` alias to `--kub-surface` — a *defined*
   token. The bubble it belongs to is filled with the *undefined*
   `--kub-message-in` (D-001). The tail is therefore opaque while its own bubble
   is transparent. Sampled tail: `248, 252, 255` against a `244, 247, 253`
   bubble interior.
2. **It overlaps the avatar.** The tail is positioned `left: -8px` outside the
   bubble box, and the incoming avatar sits immediately to the left, so the
   triangle is drawn on top of the avatar circle.
3. **It has no border.** The bubble carries
   `border border-[color:var(--kub-border-color)]`; the tail is a bare CSS
   border-triangle, so the outline visibly breaks where the tail attaches.

**Consequence:** a light wedge that appears to overlap the bubble and clip into
the avatar. This is the element a reader notices first and cannot explain.
Reported by the user against the captured previews on 2026-09-01.

**Fixed** 2026-09-01. The triangles are removed. A 9px triangle in a 6px row gap
cannot avoid the avatar, and a CSS border triangle cannot carry the bubble's own
border, so the element could not be made correct in place. The end of a group is
now expressed by squaring the bubble's corner on the sender's side
(`rounded-bl-none` / `rounded-br-none`), which reads the same, matches the fill
and border exactly, and cannot collide with anything. The two `--tg-message-*`
aliases existed only to colour those triangles and were removed with them. The
contract test asserts the rules and the classes do not come back.

---

## D-003 `[x]` The group read receipt is illegible at its rendered size

**Severity:** medium.

**Surface:** `artifacts/kub/src/components/chat/MessageBubble.tsx:828`.

**Defect:** the receipt renders Phosphor's `Checks` glyph
(`artifacts/kub/src/components/kub/icons.ts:228`) at `size={11}`. At that size
the two overlapping ticks merge into a pair of thin diagonal strokes that read
as a small arrow or a double slash rather than as checkmarks. The sibling
single-message delivery indicator on the same row uses `size={13}`
(`:806-814`), so two related indicators are drawn at different sizes.

**Consequence:** users cannot tell what the mark means. Reported by the user as
"a small arrow with no logical meaning" on 2026-09-01.

**Partly fixed** 2026-09-01. The receipt now renders at 13px, matching the
single-message delivery indicator on the same row. The glyph choice itself is
still Phosphor `Checks`; whether that reads as a receipt at any size is a design
question for the stage, and D-004 covers the label beside it.

---

## D-004 `[x]` The read count reads as a bare fraction with no unit or affordance

> **Closed 2026-09-04.** Batch 6 added the chip's markup on 2026-09-02 but it
> was invisible on screen — see the closing note at the end of this file. The
> boundary that makes it a control landed 2026-09-04.

**Severity:** medium.

**Surface:** `artifacts/kub/src/components/chat/MessageBubble.tsx:817-831`,
label from `artifacts/kub/src/lib/groupReadReceipts.ts:62-65`.

**Defect:** the compact label is `${readCount}/${totalRecipients}`, rendered as
plain text immediately after a `tabular-nums` timestamp with a `gap-0.5`. It is
a `<button>` that opens the receipt list, but nothing about it looks
interactive. The accessible name is correct
(`groupReadReceipts.ts:67-72`, "Прочитано всеми: 3 из 3"), so the information
exists but only for assistive technology.

**Consequence:** a sighted user sees `15:02 ⁄⁄ 3/3` and cannot decode it, and
does not discover that it is clickable.

---

## D-005 `[x]` The message meta row packs up to six elements without a hierarchy

> **Closed in fix batch 6**, which also corrected this entry's premise: the
> sizes already formed a scale and what was missing was grouping.

**Severity:** low, but it is the general reason the bubble looks crude.

**Surface:** `artifacts/kub/src/components/chat/MessageBubble.tsx:794-840`.

**Defect:** the row can contain a pin icon (12 px), an "изм." label (10 px), the
timestamp (10 px, min-width `2.75rem`), then either a 13 px delivery icon or an
11 px icon plus a text fraction, then a 20 px actions button. Three different
icon sizes and two different type sizes sit at `gap-0.5` inside the bubble
padding, with no grouping.

**Consequence:** the densest part of the bubble is also the least organised, and
it is what the eye lands on after the message text.

---

## Notes on scope

D-004 and D-005 are design decisions rather than defects with a single correct
answer, so they stay with the stage.

The fixes recorded above were verified by regenerating the product previews and
re-sampling the pixels, not by reading the diff. Anything that changes how
messages render should be verified the same way.

The contract test written for D-001 immediately found D-006 and D-007, which had
been live on public pages. It is worth running that class of check over the other
design systems in the repository during the stage.

---

## D-006 `[x]` Muted text on the live public pages had no colour

**Severity:** medium. `/privacy` and `/bots/docs` are public and already deployed.

**Surface:** `artifacts/kub/src/pages/public/BotDocsPage.tsx` (8 occurrences) and
`artifacts/kub/src/pages/public/PrivacyPage.tsx` (1).

**Defect:** both referenced `--kub-text-muted`, which does not exist. The defined
token is `--kub-muted`. As with D-001 the declaration resolved to nothing, so
every paragraph meant to be secondary inherited the full-strength text colour and
the pages lost their typographic hierarchy.

**Fixed** 2026-09-01 by using the defined token. Found by the contract test
written for D-001, not by inspection.

---

## D-007 `[x]` Registration separator referenced an undefined token

**Severity:** low.

**Surface:** `artifacts/kub/src/components/auth/RegisterForm.tsx`.

**Defect:** the `/` separator was coloured with `--kub-border-strong`, which is
not defined anywhere, so it rendered at inherited colour instead of as a muted
divider.

**Fixed** 2026-09-01 by using `--kub-muted`. Also found by the contract test.

---

## D-008 `[x]` A wrapped message always pushes its time onto a separate line

> **Closed in fix batch 5** (`06298ff`, 2026-09-02). The `singleLineText`
> condition described below no longer exists. The text that follows is the
> original report, kept as written; do not read it as current.

**Severity:** medium. Every message long enough to wrap, which is most of them.

**Surface:** `artifacts/kub/src/components/chat/MessageBubble.tsx`, inside
`MeasuredTextWithMeta`: `const singleLineText = lineRects.length <= 1;` feeding
`canInline = singleLineText && available >= footerRect.width + gap`.

**Defect:** the measurement already computes whether the meta fits after the
last rendered line. The additional single-line condition overrides that result,
so a message that wraps to two or more lines can never keep its time inline even
when its last line ends well short of the bubble edge. The bubble then gains a
row that is empty except for a right-aligned timestamp.

**Consequence:** a conversation alternates between compact bubbles and bubbles
with a nearly empty extra row, which is the main reason a normal chat reads as
untidy. Reported by the user against the product previews on 2026-09-01.

**Not fixed here.** Removing the condition is a one-line change, but
`MeasuredTextWithMeta` carries hysteresis (`inlineBlockedRef`) precisely to stop
placement oscillation, and the surrounding contracts include chat scroll
anchoring and history prepend stability. It needs the chat regression suite that
belongs to this stage rather than a drive-by edit. Two related savings were
taken already: the timestamp no longer reserves a fixed `2.75rem` it never uses,
and D-003 aligned the receipt icon size.

The product previews avoid the case by using concise fixture replies, which is a
content choice for imagery and not a workaround for the defect.

## D-009 — an unreleased platform announced release progress it did not have

**Where:** `artifacts/kub/src/components/public/PlatformShowcase.tsx`, the status
line under each platform heading. Every viewport, both themes, all catalog
states.

**Defect:** the status line was keyed on the platform state alone, and
`unavailable` was labelled `Готовим выпуск`. That state covers two different
situations: a published platform between releases, and a platform with no
published catalog at all. macOS and iOS are the second kind — no manifest, no
build, no schedule — and were told to a logged-out visitor as a release being
prepared.

**Consequence:** one screen carried three statements about macOS at once — the
heading status `Готовим выпуск`, the button `В разработке`, and the summary
`macOS и iOS в разработке`. The first contradicts the other two and invents
progress, which the product rules for this surface forbid.

**Fixed.** `statusLabel()` returns `В разработке` whenever `catalogPublished` is
false, before consulting the state. `tests/e2e/public-home.spec.ts` now asserts
that neither unreleased section contains `готовим выпуск`; reverting the guard
turns that test red.

**Found by review, not by eye.** The component file is untouched by the change
that reported it — splitting `готовим к выпуску` from `в разработке` in the
summary is what turned a long-standing conflation into a visible contradiction.

---

# Audit pass, 2026-09-02

Entries from here on come from `scripts/interface-audit.mjs`, which measured the
five release viewports across both themes on seven surfaces: 70 cells, 426 raw
findings, 0 unreachable. The raw report is `output/audit/browser-report.json`
with a screenshot per cell.

Raw findings are not entries. 426 collapsed to 48 distinct (defect, element)
groups, and each group below was then confirmed by hand before being written
down. Three candidate groups were rejected as harness faults rather than
recorded, and the harness was fixed and pinned with a test for each: scripted
focus not matching `:focus-visible`, screen-reader-only labels counted as
clipped text, and a decorative image bleeding past a full-screen container.

## D-010 — keyboard focus is invisible on every primary button

**Severity:** P1. For a keyboard-only user this does not merely make a task
harder; it removes the ability to know which control is about to be activated.

**Where:** `artifacts/kub/src/components/kub/KubButton.tsx` with
`artifacts/kub/src/index.css`. Observed on the primary action of four surfaces —
`Войти` (login), `Отправить и открыть чат` (support), `Создать бота` (bots),
`Новая` and `Создать задачу` (tasks) — at all five viewports and in both themes.

**Reproduction:** open `/login`, press Tab four times to reach `Войти`, and
compare the computed `outline` and `box-shadow` before and after. They are
identical: `outline: none 3px rgb(5, 11, 24)` and
`box-shadow: … 0px 4px 24px -8px` in both states, while `document.activeElement`
is the button.

**Cause.** `KubButton` asks for the ring with
`focus-visible:ring-2 focus-visible:ring-[color:var(--kub-cyan)]`, which Tailwind
v4 implements as a `box-shadow`. The `primary` and `accent` variants also carry
`kub-glow-soft` / `kub-glow-pink`, plain classes in `index.css` that set
`box-shadow` outright. Both are single-class specificity, so source order
decides and the glow wins. The ring is requested, composed, and then overwritten.

**Not a lint-level miss.** The classes are present and look correct in review;
only the computed style shows the ring never renders. That is why this needed a
measuring harness rather than a reading.

## D-011 — the accent colour fails contrast in the light theme

**Severity:** P1. It is the colour of the primary button's own label, so the
most important control on each surface is the least legible.

**Where:** `--brand-blue: #427fc2` in `artifacts/kub/src/index.css`, reached
through `--kub-cyan` and `--kub-action-primary-background`. Light theme only.

**Measured:**

| pair | ratio | needs |
| --- | --- | --- |
| brand blue on `--kub-bg` `#F4F8FC` | 3.90:1 | 4.5:1 |
| brand blue on `--kub-surface` `#FFFFFF` | 4.16:1 | 4.5:1 |
| button label `#F4F8FC` on brand blue | 3.90:1 | 4.5:1 |
| brand blue on the dark `--kub-bg` `#050B18` | 4.73:1 | passes |

**Surfaces:** `Войти` and its label, `Забыли пароль?`, `Зарегистрироваться`
(login), `Политикой конфиденциальности` (support and login), `Все платформы` and
the `LETSCUBE` eyebrow (public home), `Правовые документы` (privacy). Five
viewports, light theme.

**Note for the fix.** The palette already contains a shade that passes:
`--kub-cyan-hover: #2d6fac` measures 5.27:1 on white and 4.94:1 on `--kub-bg`.
The dark theme passes as it is and must not be dragged along by a shared token
change.

## D-012 — avatar monograms are unreadable on every palette colour

**Severity:** P1. At 1.19:1 the letter is not low-contrast, it is invisible.

**Where:** `getAvatarColor` in `artifacts/kub/src/components/ui/ChatAvatar.tsx`.
Both themes, every viewport, anywhere an avatar has no image.

**Measured.** The monogram is `text-white` over a generated pastel background.
All ten palette colours fail, and all ten pass with a dark foreground:

| background | white | black |
| --- | --- | --- |
| `#FFEAA7` | 1.19:1 | 17.58:1 |
| `#F7DC6F` | 1.36:1 | 15.42:1 |
| `#98D8C8` | 1.62:1 | 12.99:1 |
| `#96CEB4` | 1.78:1 | 11.78:1 |
| `#4ECDC4` | 1.93:1 | 10.85:1 |
| `#85C1E9` | 1.94:1 | 10.80:1 |
| `#DDA0DD` | 2.07:1 | 10.15:1 |
| `#45B7D1` | 2.35:1 | 8.95:1 |
| `#BB8FCE` | 2.65:1 | 7.93:1 |
| `#FF6B6B` | 2.78:1 | 7.57:1 |

Ten of ten fail with white; ten of ten pass with black. The palette was chosen
for dark text and is being drawn with light text.

## D-013 — controls below the touch target on the mobile viewports

**Severity:** P2, with a caveat that keeps it honest.

**Where:** 30 distinct elements across `login`, `support`, `tasks`, `messenger`,
`privacy` and `public-home`, at `390x844` and `412x915`, both themes.

**Split before fixing.** Not every one of these is a defect. Inline links inside
running prose are exempt from the target-size requirement, and several findings
are exactly that — `Зарегистрироваться` at 14px, `Политикой конфиденциальности`
at 15px, `privacy@app.letscube.ru` at 16px sit inside sentences. The ones that
are real are the standalone controls:

- form inputs at 20px high (`login`, `support`, `tasks`, and the messenger's
  sidebar search)
- checkboxes at 16px (`support`, `tasks`)
- the password reveal toggle at 16px (`login`)
- the `Забыли пароль?` trigger at 16px (`login`)
- the `Карточки` view switch at 30px (`tasks`)

The register records both halves so the fix batch cannot quietly widen into
restyling prose links.

## Rejected, with the harness fixed

Kept here because a rejected candidate is evidence about the audit's own
reliability, and because each one would otherwise be rediscovered.

1. **Primary buttons reported as having no focus indicator.** The harness used
   `node.focus()`; browsers deliberately do not match `:focus-visible` for
   scripted focus. It now tabs with the keyboard. D-010 survived that fix and is
   real; the same finding on secondary controls did not.
2. **Screen-reader-only labels reported as clipped text**, three on the tasks
   page. `sr-only` is clipped on purpose. Visually-hidden nodes are excluded.
3. **The login page's mascot reported as a 461px clipping defect** at every
   viewport. A decorative image bleeding past a full-screen container is a design
   choice; clipping is now only reported when text or a control is what gets cut
   off.

Each fix is pinned by a test in `tests/unit/interface-audit-harness.test.mjs`.

## D-014 — both accents miss contrast on surfaces in the dark theme

**Severity:** P2. A near-miss rather than an invisible letter, but a real one,
and it is the reason the "dark theme is fine" conclusion in D-011 was wrong.

**Found by the contract, not by eye.** D-011 checked the accents against the
page background, where the dark theme passes at 4.73:1, and concluded the dark
theme needed nothing. The test written for D-011 also checks `--kub-surface`,
which is what cards and panels are painted with, and there the brand blue
measures 4.36:1 and the brand magenta 4.38:1 — both under 4.5:1.

**Fixed** by lightening each along its own hue by the smallest step that clears
every surface: `--kub-cyan` to `#4d8bd0` and `--kub-pink` to `#f04a92`.

---

# Fix batch 1, 2026-09-02

Three systemic defects closed. Each fix is pinned by a test, and each test was
mutation-checked: the fix was reverted and the test watched go red.

**D-010 — fixed.** The focus indicator is an outline rather than a Tailwind
ring, because a ring is a `box-shadow` and the variant glow classes set
`box-shadow` at equal specificity. An outline is a separate property that a
box-shadow cannot overwrite. Pinned by
`tests/e2e/interface-focus-visibility.spec.ts`, which tabs with the keyboard and
compares the computed style before and after — restoring the ring makes it fail
with the D-010 message. Confirmed in the rendered page: `focus-invisible`
findings went from every login and support cell to none.

**D-011 and D-014 — fixed.** Light theme: `--kub-cyan` `#2d6fac` (4.94:1 on the
background, 5.27:1 on white), hover `#2b5e91`; `--kub-pink` `#c03068`. Dark
theme: `--kub-cyan` `#4d8bd0`, `--kub-pink` `#f04a92`. The blue shades were
already in the palette rather than invented. Pinned by
`tests/unit/theme-accent-contrast.test.mjs`, which reads the tokens out of
`index.css` and follows `var()` indirection to a colour, so a token change is
what it measures. Four mutations fail it, including reverting either accent.

**D-012 — fixed.** `avatarInkFor` in `artifacts/kub/src/lib/avatarInk.ts` picks
the higher-contrast ink per background instead of forcing white. Pinned by
`tests/unit/avatar-monogram-contrast.test.mts`, which reads the palette out of
the component so a new colour is covered automatically, and which also asserts a
dark background still gets light ink — without that, hardcoding dark ink would
pass. Four mutations fail it.

**Still open:** D-013 (touch targets), and D-004, D-005, D-008 from the earlier
pass.

**Verification.** Re-running the harness over the public surfaces after the fix
leaves 0 contrast and 0 focus findings where there were 4 to 6 per light cell
and 1 per surface respectively. 631/632 unit tests, typecheck and production
build clean; the single failure is the pre-existing `android-release-signing`
fixture, untouched by this branch.

# Fix batch 2, 2026-09-02 — D-013 touch targets

**The field that looked tappable and was not.** `KubInput` paints a 44px field
and the `<input>` sat inside it at its intrinsic 20px, vertically centred. Proved
by tapping rather than by measuring: a click 4px below the field's visible top
edge left focus on `body`, while a click in the middle focused the input. The
control looked like a 44px target and answered only in its middle 20px, so a
mobile user missing it low or high hit nothing at all.

**Fixed** with `h-full` on the input. Pinned by a test in
`tests/e2e/interface-focus-visibility.spec.ts` that taps the top and bottom
edges and asserts the input takes focus; removing `h-full` makes it fail. The
test taps rather than measures on purpose — a min-height would satisfy a
measurement while leaving the dead zone.

**Password reveal toggle**, login and register: a 16x16 button inside a 44px
field, the hardest thing on the form to hit. The icon stays 16px; the button now
carries a 44px box with a negative margin so the field's height is unchanged.

**`Забыли пароль?`**: a standalone action 16px tall. It is not a link inside a
sentence, so it is held to the target size; padding grows the hit area without
changing the type size.

**Deliberately not changed.** `Зарегистрироваться` and
`Политикой конфиденциальности` sit inside running sentences, where the target
size requirement does not apply. Enlarging them would mean restyling prose, and
the batch was scoped to keep that out.

**Harness correction found by this batch.** The first re-audit still reported
the fields at 42px, because the missing two pixels are the wrapper's own border.
The check now measures the effective tappable box — a control that fills a
bordered wrapper counts as that wrapper — with tests in both directions: a
filled 44px field is not a finding, and a small control inside a large wrapper it
does not fill still is.

**Result.** The login surface went from 6 touch-target findings to 2 on mobile
and 0 on desktop, and the 2 that remain are the exempt prose links.

**Still open:** the header links and the logo link at 28-32px on the public
surfaces, the support form's checkbox at 16px, and the tasks view switch at
30px, plus D-004, D-005 and D-008 from the earlier pass.

## D-015 — the shared button size scale is below the touch target

**Severity:** P2, but the widest entry in this register: it is one component,
used everywhere.

**Where:** `sizeClass` in `artifacts/kub/src/components/kub/KubButton.tsx`.

| size | height | meets 44px |
| --- | --- | --- |
| `sm` | 32px | no |
| `md` | 40px | no |
| `lg` | 48px | yes |
| `icon` | 36px | no |

Three of the four sizes are under the target, and `size="sm"` alone appears 118
times across 41 files. Every one of those is an undersized target on a phone.

**Deliberately not fixed in the touch-target batch.** Raising the scale changes
the height of most buttons in the product, which is a visible design change and
would have turned a scoped batch into a restyling. It needs its own decision and
its own before/after review.

**The option worth reviewing first** is to keep every size exactly as it looks
and grow only the hit area on coarse pointers, so desktop layout is untouched
and a phone gets a real target. That keeps the visual scale, which is the part
the owner chose, and fixes the part that is measurably wrong.

**Local consequences accepted for now.** The privacy page's `Версия для печати`
is a `KubButton size="sm"` and stays 32px until this is decided; its neighbour
`Задать вопрос` is a plain link and was raised to 44px in fix batch 2.

# Fix batch 3, 2026-09-02 — the rest of D-013 on the public surfaces

**Shared public header**, which serves the home, privacy and support pages: the
logo link was a 28px target and the navigation links and the sign-in action were
32px. All now carry a 44px box; the marks and labels keep their size.

**Privacy table of contents**: 22 entries at 32px. These are standalone
navigation rather than links inside a sentence, so they are held to the target
size; the type size is unchanged and only the row height grows. That one change
accounts for most of the page's cluster.

**Footer contacts** on every public page: two `mailto:` links at 16px, again
standalone rather than inline in prose.

**Two more harness corrections, both found by re-auditing rather than by
reading.** A control that fills a bordered wrapper now counts as that wrapper —
the fields were still being reported at 42px because the missing two pixels are
the wrapper's border. And a control wrapped in a `<label>` is now measured by
the label, because a label toggles its control natively: the support form's 16px
consent checkbox sits inside a padded row that is the real target, and calling
it undersized would have led to inflating a checkbox that was already fine. Both
directions are tested, including a bare checkbox with no label, which is still
reported.

**Result on the public surfaces at 390x844**, findings before and after this
stage: home 5 → 0, privacy 22 → 1, support 12 → 1, login 6 → 2. Everything that
remains is either an exempt link inside a sentence or the `KubButton size="sm"`
deferred to D-015.

# Fix batch 4, 2026-09-02 — D-015 closed for touch, scale untouched for pointers

**Fixed**, and with a correction to what this register proposed. The entry
suggested growing the hit area with an overlay so the layout would not move at
all. Thinking it through further, two adjacent 32px controls would then have
overlapping 44px hit areas and one would start stealing the other's taps —
worse than the defect. The rule raises the real height instead, and is scoped to
`@media (pointer: coarse)`: a finger gets a real target, a cursor sees exactly
what it saw before. The size scale, which is the part that was chosen, is
untouched on a pointer device.

**Both halves are pinned**, in `tests/e2e/interface-focus-visibility.spec.ts`.
One test asserts a small button reaches 44px under `hasTouch`, the other asserts
the same button stays under 44px with a fine pointer. Testing only the first
would pass equally well if the scale had been raised for everyone, which is the
change that was deliberately not made. Both mutations fail: removing the rule
breaks the touch half, applying it to every pointer breaks the other.

**A harness correction this exposed.** The audit measured phone viewports with a
mouse, so `(pointer: coarse)` never matched and it would have reported this fix
as having changed nothing. Mobile viewports now emulate touch.

**Result at 390x844 with touch**: privacy 1 → 0, home 0, and the only findings
left anywhere on the public surfaces are links inside sentences, which the target
size requirement does not cover.

**Still open:** D-004, D-005 and D-008 from the earlier pass, and the
shell-specific audit of Windows and Android.

# Shell audit, 2026-09-02 — Android

Run inside the real Android WebView rather than against an emulated viewport.
A debug build of the branch was installed under a suffixed applicationId, the
WebView's DevTools socket was forwarded over adb, and the same checks the
browser audit uses were evaluated in the shell itself.

**The device confirms the D-015 fix on real hardware.** `(pointer: coarse)`
matches and `(any-hover: hover)` does not, so the touch rule is active rather
than merely emulated, and the primary action measures 48px in the shell.

**Findings: two**, both the links inside sentences that the target size
requirement does not cover. Everything else on the login surface is clean in the
shell.

**Keyboard insets behave.** Focusing a field takes the viewport from 748 to 482
and the layout resizes with it, so the form is not left behind the keyboard: the
primary action moves from a bottom edge of 483 to 402 and stays fully visible.
No defect.

**Capture stopped on the second phone.** Its first screenshot caught an unrelated
video call in a floating window. The image was deleted rather than kept or
described, and the audit continued on the other device and through the DevTools
bridge, which reads the page rather than the screen. Nothing personal from either
device is recorded anywhere.

**Cleanup:** the debug package is uninstalled from both phones, both still report
`com.kub.messenger 0.1.2`, the port forward is removed and `build.gradle` is
reverted.

# Shell audit, 2026-09-02 — Windows

## D-016 — outside the messenger the desktop window cannot be moved or closed

**Severity:** P1. It affects the login screen, which every desktop user sees
before anything else, and it removes control of the window rather than making it
awkward.

**Where:** `windows-tauri/src-tauri/tauri.conf.json` sets `"decorations": false`,
so the application draws its own title bar. That bar is `AppTopBar`, and
`AppTopBar` is rendered only by `MainLayout` — the authenticated messenger.

**Reproduction, confirmed by doing it rather than by reading the code.** Open the
Windows application while signed out. The window's top edge carries no title bar
and no minimise, maximise or close control. Dragging from the top strip does not
move the window: it stays exactly where it was. The only ways out are Alt+F4, the
taskbar, or the window edges for resizing.

**Surfaces affected:** login, register, the loading screen, the retryable
loading error, and the ban screen — everything the messenger shell does not
render.

**Fixed** with `DesktopWindowChrome`, which renders nothing outside the Windows
shell and nothing where `AppTopBar` is already present, so the messenger keeps
exactly one title bar. Its glyphs mirror `AppTopBar`'s so the two cannot drift
apart.

**Simplified on 2026-09-12.** `AppTopBar` was removed — the owner had it taken
out because it pushed the folder rail below the window's top edge and drew the
LETSCUBE mark a second time — so there is no surface left to suppress this one
on, and `DesktopWindowChrome` is now the whole product's only window chrome. The
`suppressed` prop went with the bar. What the bar also did, which this one
cannot, was hold the panes clear of the buttons by taking 44px of height: this
is an overlay and takes none, so the panes reserve `--kub-window-caption`
themselves through `pt-window-top`. See D-112.

## The rest of the Windows shell

The updater surface behaves: with an update available the pill reads
`Доступно обновление` with `Обновить` and `Позже`, and it sits inside the content
area rather than over a control. No finding.

The window is `resizable: true`, so edge resizing worked throughout, which is why
the missing chrome was a loss of control rather than a trap.

## D-017 — the entry document has no cache policy, so clients keep running an old build

**Severity:** P1, and not an interface defect at all — it was found by trying to
verify one. It can leave every client on an old build indefinitely.

**How it surfaced.** After deploying the D-016 fix, the Windows shell still
would not let the window be dragged. The fix was live: fetching the deployed
bundle and rendering it with a stubbed desktop bridge showed
`desktop-window-chrome` present, 32px tall, with three buttons. The shell was
simply running an older `index.html`.

**Measured:**

| resource | Cache-Control |
| --- | --- |
| `/` (index.html) | *absent* |
| `/assets/index-*.js` | `public, immutable, max-age=31536000` |
| `/sw.js` | `no-cache, no-store, must-revalidate` |

`index.html` names the hashed asset filenames, so it is the document that
decides which build a client runs. With no directive its freshness falls to a
browser heuristic, typically a fraction of the time since `Last-Modified`, and a
client can keep loading the previous bundle long after a deploy.

**The configuration already reasons this way one block further down**, where
`/sw.js` carries the comment "must NEVER be cached, otherwise updates stick".
The entry document needed the same treatment and had been missed.

**Fixed** with an explicit `Cache-Control: no-cache` on `index.html`, which
costs nothing in traffic because the assets it names stay immutable. Pinned by
`tests/unit/web-cache-policy.test.mjs`, including a check that the SPA fallback
does not reintroduce a long cache for the documents it serves; deleting the
block fails it.

**Observed in passing during the same deploy:** for a short window the served
`index.html` referenced an asset that returned 404, and it resolved by itself on
the next poll. That is the rolling replacement briefly serving a new document
with the previous replica's assets. Recorded rather than acted on — it is
transient and self-correcting, but worth knowing before reading a 404 as an
outage.

# Fix batch 5, 2026-09-02 — D-008 closed

**Fixed.** The single-line condition is gone from `canInline`. Whether the meta
fits was already a measurement — `available` is the room left after the *last*
rendered line, however many lines there are — and the extra condition sat on top
of it refusing every wrapped message. A bubble whose last line ended well short
of the edge still grew a row containing nothing but a right-aligned timestamp.

**Why the register held it back, and why that is now settled.** The concern was
oscillation, since `MeasuredTextWithMeta` carries `inlineBlockedRef` to stop
placement flapping. It cannot loop: the guard above the calculation flips to
anchored and sets that ref the first time an inline footer fails to land on the
last text line, so a given message changes its mind at most once. A test asserts
placement is unchanged across two further settling periods.

**Tested against the DEV preview capture route** with an injected fixture, so
the messages are deterministic and no production conversation is involved.
Passes at `1440x900` and `390x844`. Restoring the single-line condition fails it
with the D-008 message.

**One limitation, recorded rather than papered over.** The anchored branch is
asserted as an invariant instead of by constructing a message that must take it.
Bubbles are `w-fit`, so with normal wrapping the last line is never the widest
and a wrapped message essentially always has room — the anchored case cannot be
built reliably from text. What is asserted instead is the property that matters
either way: an inline time never overlaps the words it sits beside. An earlier
draft of this test measured room against the bubble's outer edge rather than the
text's right limit inside it, which is a different quantity from the one the
component decides on; that assertion was removed rather than left in looking
meaningful.

**Chat contracts re-checked:** scroll anchoring, history anchoring, footer
stability and read synchronisation all pass.

# Fix batch 6, 2026-09-02 — D-004 and D-005

Both were recorded as design decisions rather than defects with a single correct
answer, so both changes are deliberately restrained and the before and after
were put in front of the owner rather than asserted.

**D-004 — fixed.** The read count was a `<button>` that opened the receipt list
and looked like more text: a bare `3/3` after a timestamp. Its accessible name
was already correct, so the information existed for assistive technology and for
nobody else. It now sits in a faint chip with its check icon and carries a focus
outline, so it reads as one pressable unit. No word was added to a row that is
already crowded.

**D-005 — addressed by grouping, not by resizing.** Reading the row properly
first showed the premise needed correcting: the sizes already form a coherent
scale — 12px flags, 13px status, 20px actions, one type size throughout — so
three icon sizes is a hierarchy rather than an accident. What was missing was
separation. A single step of extra space now divides the flags that can precede
the time, the pin and `изм.`, from the status cluster of time and delivery,
which belong together. Nothing is resized, moved or removed.

**Verified by regenerating the previews and looking at the pixels**, as this
register requires of anything that changes how messages render, not by reading
the diff.

**A test correction this exposed.** The footer-width contract matched a literal
`className="…"` on the time element. Composing that class with `cn()` — which
the conditional spacing needs — made it fail on a change that kept every
property it exists to protect. It now reads the element and checks
`tabular-nums` and `shrink-0` within it; removing either still fails it.

## D-018 — the auth screen offered a scrollbar with nothing to scroll to

**Severity:** P2, reported by the owner, who saw it in the browser and in both
native shells.

**Where:** `.kub-auth-shell::after` and `.kub-auth-mascot` in
`artifacts/kub/src/index.css`.

**Measured.** `.kub-auth-shell` scrolls on purpose so the form stays reachable on
a short window or with a keyboard up. Two decorative layers were absolutely
positioned inside it and hung past its bottom edge, so that overhang counted as
scrollable area:

| viewport | scrollable | 18% of the height |
| --- | --- | --- |
| 1440x900 | 162px | 162px |
| 1440x700 | 126px | 126px |
| 390x844 | 152px | 152px |

The match is exact, which identified `inset: auto -12% -18% 40%` on the glow.
The remaining 24px on a desktop and 48px on a phone were the mascot's
`bottom: -1.5rem` / `-3rem`.

**Two wrong guesses, recorded because they cost time and might be repeated.**
The first was that `overflow-x: hidden` was forcing `overflow-y` to `auto`; the
shell sets `overflow-y: auto` explicitly and deliberately. The second was that
the mascot alone was responsible — hiding it changed nothing, because the glow
was four times larger. The arithmetic, not the reasoning, found it.

**Fixed** by taking both decorative layers out of the shell's scroll area with
fixed positioning. Neither is interactive and neither needs to scroll with the
form, and their painted position is unchanged.

**Both directions are pinned** in `tests/e2e/interface-focus-visibility.spec.ts`:
nothing scrolls at three viewports where the form fits, and a 400px-tall window
still scrolls far enough to reach the sign-in button. Returning either layer to
absolute positioning fails it. Removing the scroll entirely would be the obvious
over-correction and would strand the button on a short window, which is why the
second half exists.

# Fix batch 7, 2026-09-02 — the status chip, and two tones it exposed

The chip is `KubBadge`: 69 uses across 16 files, so one component carries every
status in the product. That leverage is why it came first when converting the
interface to the approved design.

**The pairing that failed.** The label was painted in the tone over an 18% tint
of the same tone. Measured across the three surfaces a badge sits on, that
ranged 3.17:1 to 5.55:1, and the audit caught `Активна` at 2.62:1.

**Removing the tint alone was not enough**, which is worth recording because it
was the obvious fix. On `--kub-surface-3` the tone as a label still measures
4.05:1 (cyan), 4.18:1 (pink) and 3.82:1 (danger) — all under 4.5:1. So the label
takes the interface text colour, which passes on every surface, and the tone
moves to the dot and border, where the requirement is 3:1 and every tone clears
it.

**That makes the dot load-bearing.** With a neutral label, a thin border would be
the only carrier of meaning, so the dot is on by default for coloured tones. It
also means status is never signalled by colour alone: there is a dot, a border
and a word.

**Two tones the contract then caught, neither noticed by eye.** In the light
theme `--kub-online` `#4FAE4E` measured 2.80:1 on white and 2.62:1 on the page,
and `--kub-warn` `#C2870A` measured 2.55:1 on `--kub-surface-3` — both under the
3:1 an indicator needs. Darkened along their own hues to `#3C8B3C` and
`#A8760A`. The dark theme's tones all pass unchanged.

**Pinned** by `tests/unit/status-badge-contrast.test.mjs`, which reads the tone
list out of the component and the colours out of `index.css`, so a new tone or a
changed token is covered without editing the test. Five mutations fail it:
painting the label in the tone, restoring the tint, dropping the default dot,
and reverting either light-theme tone.

# Fix batch 8, 2026-09-02 — the staff area's targets

The same two defects the public surfaces had, in the area the owner asked to be
reviewed, fixed as shared rules rather than per screen.

**Icon-only actions** — back arrows, row menus, clear buttons — were 28-32px
across `AdminLayout`, `AuditTab`, `BansMutesTab` and `UsersTab`. They now carry
`.kub-icon-action`, which keeps the dense 32px on a pointer device and gives a
coarse pointer the full 44px. Same bargain as D-015: the scale the design chose
is untouched where it shows, and a finger gets a real target.

**Search fields** repeated the D-013 shape: a 20px input floating inside a 40px
box, so the visible field answered only in its middle. The box is now 44px and
the input fills it.

**A test correction, recorded because it reported a fix as missing.** The first
version of the contract located the search field by the placeholder word
"Поиск" and did not find `AuditTab`'s, which is labelled "Имя или @никнейм" — so
it failed on a field that was already fixed. It now locates fields by what they
are, an input stretched inside a styled box, and checks every one it finds.

Pinned by `tests/unit/touch-target-system.test.mjs`; four mutations fail it,
including inflating the resting size for every pointer, which is the change
deliberately not made.

# Fix batch 9, 2026-09-02 — the last measured findings, everywhere

The batch that takes the whole matrix to zero. Before it: 52 findings on the
staff area, 44 on the client surfaces. After it, measured on the deployed build
at `abca555`: **160 cells — five viewports, both themes, sixteen surfaces —
0 findings, 0 unreachable.**

## D-019 — a sentence painted in the tone it is tinted behind

The inline notice set its text in `--kub-warn` on a wash of `--kub-warn`.
Measured on the live staff area, 3.74:1 for a warning and 3.98:1 for a success
figure, both under the 4.5:1 a sentence needs. A source scan found **76
instances** of the pairing across the product, so this was never one screen's
mistake — it was the house style.

`KubNotice` applies the rule D-011 settled for the badge: the sentence takes
`--kub-text`, which passes on every surface, and the tone moves to a 4px rail
and the border, where 3:1 applies and every tone clears it. The rail is what
keeps a notice reading as a warning once its sentence is neutral.

The staff area is converted here; the client surfaces are a later batch. The
trend percentage lost its green for the same reason — the bar directly beneath
it already carries that meaning at 3:1.

**Deliberately not converted:** the icon chip in `RecentActivity`. It holds an
icon, not a sentence, so 3:1 applies, and it measures 3.74:1 to 4.71:1 across
the three surfaces in both themes. The live harness, which applies the right
threshold per element, never flagged it either.

**Pinned** by `tests/unit/notice-contrast.test.mjs`. Four mutations fail it,
including hand-rolling the pairing back into a staff screen and removing the
rail — a tone nobody can see is a deletion, not a fix.

## D-020 — native controls nobody had tagged

Selects were 40px, and a 16px tick box inside a `flex items-center` label made
a 20px-tall row. Both are now covered **by element** rather than by an opt-in
class, so a select or tick box added tomorrow is correct without anyone
remembering. The reach is deliberately narrow — two element types whose intent
is universal — and the rule is touch-only, so the pointer scale is untouched.

The same sweep tagged the controls that had been missed by class: the sidebar
and folder actions, the tasks tab strip, the support filters, and the last
`p-2 rounded-lg` icon buttons in `ChatHeader` and `TasksPage`.

**The switch needed a structural change, not a class.** It was a 44x24 target
because the button *was* the track. The two are now separate: the track keeps
its designed 24px, and `.kub-switch` gives the control around it a full-height
target on a coarse pointer.

**Pinned** by `tests/unit/touch-target-system.test.mjs`, each rule in both
directions — a test that only checked the coarse half would pass equally well if
the whole scale had been inflated, which is the change deliberately not made.

## D-021 — a destructive button's label at 3.76:1

White on `--kub-danger`, measured on the live invites screen. It could not be
fixed by darkening the tone: the same token is the dot on a badge and the rail
on a notice, where a light red is what clears 3:1 against a dark surface. One
value cannot be both, so the fill became its own token —
`--kub-action-danger-background`, mirroring what `--kub-action-primary-*`
already did.

**Found beside it, same class:** the accent button was white on `--kub-pink`
at 3.43:1 in the dark theme. Its label now takes `--kub-bg`, which is exactly
how the primary action already makes a bright fill work, so the brand magenta is
unchanged.

Both dropped `hover:brightness-110`. Brightening a fill that only just passes
walks straight back into the failure; hover is now a declared colour.

**Pinned** by `tests/unit/action-button-contrast.test.mjs`, which reads the
filled actions out of the stylesheet rather than listing them, and checks the
hover value as well as the resting one.

## D-022 — an invisible tooltip made the messenger wider than the phone

The bubble was laid out permanently at `opacity: 0`. At 390px the one on the
sidebar's right-most button pushed the page to 393px, which the harness reported
as clipped content — the visible symptom of something nobody could see.

It now leaves the flow entirely until shown. `display` is what changes, so the
fade survives through `transition-behavior: allow-discrete` and
`@starting-style`. Two things came free: on a touch device, where hover does
not exist, the bubble is never laid out at all; and `:focus-within` means the
keyboard reaches it, which hover alone never did.

**Pinned** by `tests/unit/motion-contract.test.mts`, which now also refuses a
shared class that hard-codes a duration beside its tokens — the earlier version
accepted a rule with one token and one literal.

## A harness correction, not a product fix

Three reported links on `login` and `support` were **not defects**. Both WCAG
target-size criteria exempt a link inside a sentence: its height is set by the
line box of the surrounding text, and padding it to 44px would break the
paragraph. All three were of exactly that kind.

The exception's *limit* is what the test pins: a link alone in its container is a
button in all but name, gets no exemption, and is still reported. Widening the
exception to swallow it turns
`tests/unit/interface-audit-harness.test.mjs` red.

## Evidence

- Local dev server, full release matrix: 160 cells, 0 findings, 0 unreachable.
- Deployed production `https://app.letscube.ru` at `abca555`, two viewports
  and both themes: 64 cells, 0 findings, 0 unreachable.
- The deployed stylesheet hashes identically to the locally verified build
  (`index-Dme-bWla.css`), so the CSS measured here is byte-for-byte the CSS
  that shipped.
- Nine mutations checked across the four defects; all turn the suite red.
- Unit suite 686/687. The one failure is the pre-existing
  `android-release-signing` fixture, unrelated to the interface and already
  tracked separately.

# Stage 2, 2026-09-02 — bringing the staff screens to the approved design

The measured half is closed; this is the half the owner actually asked for:
"привести всё приложение" to the standard of the approved canvas. It is not
defect-driven, so each change below names the decision it implements rather
than a finding.

## Filters that say what they are doing

The users tab kept five selects open above the list at all times, and the
journal four. They cost the list the space it needed — on a phone the journal's
took the top third of the screen before a single entry was visible — and, worse,
an inactive select looks like an active one, so a filtered list read exactly
like the full one.

Filters now collapse behind a button carrying their count, and what is on shows
as chips that each remove themselves. New shared primitives: `KubFilterButton`,
`KubFilterChip`, `KubFilterSummary`. The remove control is a real button with
its own accessible name, so a filter can be dropped by keyboard and a screen
reader hears which one.

**Three counts were removed for being untrue, not added.**

1. `Условия отсеяли 0 пользователей`. After a server-side search the number in
   memory is the count of what matched, not of what was removed, and the
   unfiltered total is not there at all.
2. `Найдено 0 из 0` is true and useless; `5 из 5` invites the reader to look
   for a difference that is not there. Each branch now says only what it knows.
3. `Найдено 1 из 340` would be a lie on the users tab, where the search runs on
   the server and the other five filters run in the browser over one loaded
   page — 339 of those were never examined. When there is more than one page the
   line says so.

## States the screens did not have

A spinner in an empty panel says something is happening and nothing about what
is coming, and the layout jumps by the full height of the list when data lands.
`KubSkeletonRows` holds the final dimensions instead, with `aria-busy` and a
label because a shimmer is silent to a screen reader. Applied to the users tab,
the journal, invites and the sanction history.

`KubNoResults` replaces "Никого не найдено", which left a person to work out
that they were looking at a filtered list, which condition was responsible, and
how to undo it. It names the condition and offers to drop it.

The shimmer takes its own token rather than joining `MOTION_MS`: it is an
ambient loop, not a reaction to anything a person did, and the approved
interaction contract should not be widened to hold it. Under reduced motion the
movement goes and the block stays.

## One ambiguity the tests caught on production

With a single filter on, "Снять «X»" and "Сбросить всё" are the identical
action, and the empty state put them side by side under the summary line's own
reset. The production e2e run could not decide which button it meant — the test
reporting a real ambiguity rather than a test problem. The empty state now
offers the named one when there is one filter, and the reset otherwise.

## Evidence

- `tests/e2e/admin-user-filters.spec.ts`, four behaviours, green on the local
  build and on production.
- Ten mutations checked across the two batches; all turn the suite red,
  including a chip that hides itself without widening the list, a reset that
  forgets the search field, a skeleton that collapses to nothing, a skeleton
  silent to a screen reader, and either invented count coming back.
- Interface audit after the rebuild: users, journal, invites and bans measure
  0 findings at both viewports and both themes, including the filtered and
  empty states measured directly rather than at rest.
- The audit's own sweep does not reach a control that only exists while a field
  has text; measuring the filtered state directly found two 18px clear buttons
  that the resting sweep could not see.

# Stage 2, batch 3, 2026-09-02 — the rest of the staff screens, and a real defect underneath

## The list goes first

Locations, invites and roles each kept a creation form permanently expanded in a
left column, and in all three the list a person had come to read began below the
fold. Creating is occasional; reading is constant. `KubCreateSection` closes the
form and moves focus to its first field on open — without that the fields appear
somewhere below the button and a keyboard user has to hunt for them, which is
the usual reason a disclosure ends up worse than what it replaced.

The roles screen also carried three explainer cards across its top on every
visit, about 130px before the list. Deleting them would cost a first-time
administrator real help, so `KubHelpNotes` opens them by default and remembers
once someone closes them — per browser and per person, which is the right scope
for a statement about what one reader already knows.

## Copy removed for saying nothing

- "Административная роль" on every administrator row in locations, repeating
  what the badge beside it said — and it was the string being truncated.
- "Глобальная: нет · Локация: нет · Роль в локации: нет", three columns of an
  invite row to say what one phrase now says once.
- The metric cards' ordinals, 01 to 08, in tabular numerals beside the one
  figure on each card that means something.

## Clipping and a chart that overstated

Locations' assignment row went to four columns from 768px inside a panel about
590px wide, so a name got roughly 155px and came out as "Maxim Ko…", while a
role badge held a fixed 180px it never needed. Three selects and a button never
fitted one row at any width the panel reaches; they are two per row now.

The support queue's filters were sliced mid-word at the 350px column edge, and a
scroller with its bar hidden gives no sign anything is off to the right. They
wrap.

**A day with no registrations was drawn as a 3% bar.** On a 200px chart that is
a visible stub reading as a small number rather than as none, which is the one
thing a chart must not do. It draws nothing now. The 10% floor for non-zero
values stays: that makes a real value visible rather than inventing one.

## D-023 — a stalled session load locked people out of signing in

Found while chasing an intermittent e2e failure, whose page snapshot on
production showed the app sitting on its own "Загрузка длится дольше обычного"
panel.

`supabase.auth.getSession()` refreshes a stale token internally, and that
request can fail to come back. `loading` then stays true — and because the boot
gate covered **every** route, `/login` rendered the loading screen too. The one
route that can rescue the situation was unreachable; the only way through was
the "Выйти" button on the loading screen, which is a poor thing to require of
someone who just wants to sign in.

An auth route now renders on its own once the boot has been stuck for four
seconds. Measured on production in exactly this state, the form arrives in 4.6
to 4.9 seconds; a healthy `getSession()` settles in a few hundred milliseconds,
so nobody with a working session sees a form flash.

**Two wrong turns are recorded because they cost time and could be repeated.**

1. The first diagnosis of the flake blamed an expired saved auth state. The
   measurement behind it compared a state saved for `127.0.0.1:5191` against
   production and read the resulting public home as proof of expiry, when the
   helper had simply — and correctly — declined to restore a state from another
   origin. The expiry check written for that wrong reason is kept, but on its
   own merits: restoring a dead session costs a six-second timeout per test.
2. An earlier version of the recovery test stubbed **both** token grants, so the
   password grant the helper falls back to was stubbed too and the test passed
   for the wrong reason. Only the refresh grant is held open now.

## Evidence

- `tests/e2e/auth-boot-recovery.spec.ts` and `auth-helper-recovery.spec.ts`
  reproduce the stall deliberately. Three mutations turn the first red,
  including restoring the old all-routes gate and setting the grace to zero,
  which would flash the form on every healthy boot.
- `tests/e2e/admin-create-sections.spec.ts`, four behaviours; five mutations
  turn it red, including a form that opens without moving focus and an explainer
  that forgets it was closed.
- `tests/unit/e2e-auth-state.test.mts` pins the session-expiry rule including
  its margin: a session with five seconds left dies mid-test and counts as dead.
- Interface audit, full matrix on the deployed build: 64 cells, 0 findings, 0
  unreachable.
- One test was relocated rather than fixed: the auth-callback ordering contract
  matched the literal `if (loading || loadingError)` and went red when that
  condition was rewritten, reporting a regression in a contract that had not
  moved. It now asserts what it means.

## D-024 — the timestamp drifted into the middle of wrapped bubbles

**Reported by the user with a screenshot**, 2026-09-03. Desktop and mobile, both
themes, every wrapped message.

A bubble takes its width from its longest line, and the time flowed inline after
the last word. On a message whose final line is short, the time therefore landed
in the middle of the bubble. Measured on a 560px bubble: **348px, 328px and
157px** from the right edge, against 13px for a single-line message.

Fixed by pinning the meta to the bubble's bottom right and reserving its width
at the end of the last line with an invisible spacer. All cases now measure 13px.

Two pieces of reasoning in that code had gone stale and were removed:

- A guard flipped a message to a separate meta row whenever the footer was not
  vertically on the last text line. That question was about a footer in the text
  flow; with the footer positioned it has no meaning, and asking it anyway sent
  every short single-line message to its own row.
- The fit test asked how much room remained to the RIGHT of the last line. For
  an own message that is always zero — the bubble is pinned to the right edge
  and grows leftwards. Measured, a 150px message with a 29px timestamp inside a
  536px allowance was refused. It now asks whether the last line and the meta
  fit inside the width the bubble may reach.

Contract: `tests/e2e/message-meta-placement.spec.ts`, and
`tests/unit/message-bubble-meta-stability.test.mjs` rewritten around the
property rather than the removed latch. Both mutations turn it red.

**The e2e had been skipping on every run.** Its fixture stamps messages at 10:02
and the app refuses a message stamped later than "now", so before 10am the
capture route threw and the spec skipped itself. Its clock is pinned now.

## D-025 — hover actions overlapped the message they act on

**Reported by the user with a screenshot**, 2026-09-03.

The action cluster used `-right-20`, putting its right edge 80px past the
bubble while the group itself is about 92px wide — so it sat roughly 12px *over*
the message. Anchored to the bubble's edge instead, it now measures 7px of clear
air, and reads as one pill rather than three separately bordered circles.

The reaction row in the context menu was cramped at 32px and its "more
reactions" control showed the vertical ellipsis — the glyph that already means
"more actions" on the button beside every message. It is 40px (44 on a coarse
pointer) with a plus.

## D-026 — every message re-renders and re-measures on any change

Not user-visible as a defect in itself; it is the cost behind "the interface is
not smooth".

Measured on production against a CPU throttled 4x, standing in for a slower
machine: **switching chats dropped 22-72 frames of 124-348, with worst frames of
299-423ms and 786-1177ms of blocking.** Scrolling and typing measured clean at
60fps in the same runs, and at full speed everything measures clean — so this
bites people on modest hardware, not on this workstation.

Two contributions were found and one is fixed:

- **Fixed.** `document.fonts.ready` was read from every bubble's measurement
  effect. Counted directly: 291 reads across four chat switches, against 0 with
  the promise shared for the page; a CPU profile put it at 304ms of self time,
  the second largest non-idle entry, and it no longer appears in the profile.
  The ResizeObserver also watched five nested nodes per bubble, so one resize
  produced five measurements per message; it watches the two that can change
  independently. Contract:
  `tests/unit/message-bubble-measurement-cost.test.mjs`.

  **Stated plainly: this removed real work but did not measurably move frame
  timing.** Repeated throttled runs vary by a factor of nine on this machine,
  and the before/after distributions overlap.

- **Open, and the structural cause.** `MessageBubble` is not memoised and
  `MessageList` renders every message through `.map`, so any state change
  re-renders every bubble on screen — each then re-running a layout measurement
  that forces `getBoundingClientRect` and `getClientRects`. The profile still
  shows 173ms in `getBoundingClientRect` alone after the fix above.

  `React.memo` alone will not help: every callback prop is an inline arrow
  created per message per render, so no comparison would ever hit. Doing this
  properly means stabilising those handlers, and `MessageList` carries the
  critical scroll-anchoring contracts — so it needs its own change with its own
  verification pass, not a patch appended to a batch of visual fixes.

## D-027 — every message changed height a frame after it appeared

Reported as "лаги и визуальные баги при перелистывании", 2026-09-03. Found by
the critical contract `loading older messages preserves the visible history
anchor`, which had been skipping on every run until 2026-09-02.

Measured on production, on a chat of 100 messages: **304 height changes after
mount and 1865px of total growth.** Every one was the timestamp's placement
flipping from inline to a row of its own, adding 12-15px. The same churn broke
the reader's place when older history was prepended: the anchor drifted 1147px
while the content grew 6469px, against a contract that allows 3px.

Four causes, all fixed, and the order they were found in matters because each
one hid the next:

1. **The measurement ran after paint.** It went through
   `requestAnimationFrame`, so the first frame showed one layout and the second
   another. It now measures synchronously in the layout effect.

2. **The fit test read a width that depended on its own answer.**
   `parsePixelValue` accepted anything `parseFloat` would take, so a computed
   `max-width: 100%` came back as 100 *pixels*; `getMaxContentWidth` then fell
   back to the bubble's CURRENT width — the one quantity that differs between
   the two placements. Inline made the bubble narrow, the narrow bubble said the
   meta did not fit, anchored made it wide, the wide bubble said it did. It
   measures the row now, whose width is the same either way.

3. **The initial guess was written for the old layout.** A message longer than
   56 characters started with a meta row and dropped it a frame later — painted
   at 81px, settled at 59px. Inline is what the measurement almost always
   chooses now that the meta is positioned and its space reserved.

4. **A bubble mounting inside a prepended page was measured against a row that
   reported zero width**, which says the meta can never fit. Every prepended
   message therefore appeared with a row it did not need: measured, 706px of
   list height vanished at t=303ms and took the anchor with it. The measurement
   now declines to answer on a width that cannot be real and waits for the next
   pass.

The anchor restore was also made to hold. It ran once, at the moment React
committed the prepended page — the one moment the heights are guaranteed to be
wrong. It now repeats until four consecutive frames need no correction, bounded
by the safety timeout that already existed, and it is released by real input so
it never drags a reader back.

That release needed a distinction: the wheel that scrolls to the top of the
history IS the gesture that asks for the older page, so releasing on any input
cancelled the hold before it ran — the anchor still drifted exactly 445px,
identically across runs, and that reproducibility is what gave it away.

The contract passes on production. Scrolling back through a fully loaded chat
measured 0 drifts over 24px in 18 steps and no empty frames.

## D-028 — a chat lurched on entry, because a narrow row collapsed every bubble

Reported as "очень сильно дёргает при заходе", 2026-09-03. Reproduced on a
seeded chat of 1368 messages — the size is what made it visible.

Measured on entry: the view moved 9,734px while the content's height collapsed
from **26,366px to 10,464px** with the same hundred messages rendered. The
scroll is set against the tall version, so the reader is thrown.

The cause was the action lane added earlier the same day. `100%` in that width
cap is the message ROW, and the row is not its final width for the first frames
after a chat opens: measured at 142px in one sample, which took the lane term to
38px and wrapped a short message into **thirteen lines instead of four**.

Floored, the same entry measures a 1,290px settle rather than a 15,902px
collapse, and the first bubble renders 142x36 on one line instead of 40x281 on
thirteen.

**The second half of the report is not reproduced.** "Сверху вниз перелистывает
в рандомные моменты" did not appear in any of: sitting still for 45s scrolled
up (0 unrequested moves), three messages arriving from the other participant
while scrolled up (the reader kept their place; the gap from the bottom grew
from 4,200px to 4,403px, which is correct), leaving and returning to the tab, or
resizing the window. Recorded as open rather than treated as fixed by the entry
change.

The QA owner's chat `a04cccda` now holds 1368 messages for further work on this.

## D-029 — media previews load the full file, not a preview-sized one

Requested 2026-09-03: message media previews, and the gallery in particular,
should load a compressed version for preview rather than the original.

Investigated and largely fixed on 2026-09-04. The answer was neither of the two
guesses: the pipeline already produces everything needed and the message and
gallery paths already ask for it. The waste was in **avatars**.

What was measured first. The pipeline produces `image_thumb` (360px),
`image_preview` (1280px), `video_poster`, `video_720p`, `avatar_128` and
`avatar_256`; coverage is 124 of 127 image messages. `MessageBubble` already
takes `previewUrl` with a `srcSet` offering the 360px thumb, and the gallery
already takes `thumbUrl`. So the message surfaces were fine.

Avatars were not, for two compounding reasons:

1. `UserAvatar` could use a variant only through an optional `avatarVariant`
   prop, and six of forty-two call sites passed it.
2. It would not have helped anyway: the RLS policy on `media_variants` allowed
   reading only your **own** profile's rows, so somebody else's avatar could
   never resolve to a variant.

Measured on the administrator's user list, the densest avatar surface, with the
HTTP cache disabled: **7 avatar originals totalling 6,250 kB became 7 variants
totalling 20 kB**. Avatar originals average 734 kB against 2,717 bytes for
`avatar_128`. On a single private chat the page went from 215 kB to 87 kB.

Fixed in three parts. `20260904000000_avatar_variants_readable.sql` lets any
non-banned account read the two avatar variant kinds — which exposes nothing,
since the files are in the public `media` bucket and the profile's avatar URL
is already world-readable; message variants stay scoped to chat membership.
`lib/avatarVariantStore.ts` lets an avatar ask for itself, coalescing a whole
frame's ids into one query and remembering "this profile has none". And the
picture now waits for that answer before falling back to the original, because
starting the original while the answer is in flight downloads both — which is
how the first attempt still fetched 128 kB after the variant was already
working.

Still open, and smaller: `ChatAvatar` for a group chat has no profile to ask
about, so a group's own picture is still its original. Group avatars have no
variants in the pipeline today, so this needs the pipeline, not the client.

## D-030 — notifications read as one undifferentiated stream

Requested 2026-09-03, to be taken up after the profile decoration work: the
notification surfaces should carry more of the meaning they already have.

What the owner asked for, in their own terms: notifications that are more
interactive and better looking; colour that distinguishes one kind from
another; a preview when the message that triggered it carries an attachment;
and an urgent task from an administrator standing out — red was the example —
so that "у пользователя всё не смешивается в кашу". The stated goal is the
micro-moments that keep one thing from reading like another, not decoration for
its own sake.

Not yet investigated. What to establish before changing anything: which
notification kinds actually exist today and what each one already knows about
its subject (the notification centre groups them, so the data may already be
there); whether task priority and the administrator origin reach the client on
the notification itself or only on the task; and what the message payload
carries about an attachment, since a preview needs a variant URL rather than
the original — which ties this to D-029.

The colour work must stay inside the existing token palette and keep contrast
in both themes; an urgent red that only reads on a dark background would fail
the same audit that produced this register. Motion and feedback belong to the
approved shared-motion plan rather than to a second system built beside it.

## D-031 — the pre-paint theme script never ran

Found 2026-09-03 while investigating an unrelated console error in the
notification centre's e2e run, and confirmed against production before any of
that day's changes: `https://app.letscube.ru` threw
`SyntaxError: Unexpected token '.'` on every page load.

`THEME_INIT_SCRIPT` in `artifacts/kub/src/lib/themeRuntime.ts` is a template
literal that emits the inline bootstrap. It contained
`/letscube-night\/([01])/`, and inside a template literal a lone backslash is
consumed by the string — so the emitted regex was
`/letscube-night/([01])/`, whose inner slash closes the literal early. The
whole script failed to parse. Measured: `new Function(THEME_INIT_SCRIPT)`
threw the production message verbatim.

Two consequences, both of which had been observed and neither explained:

1. There was no pre-paint theme at all. Every load painted the default and
   then corrected itself once the application mounted.
2. The Android shell's night marker was never read. The WebView does not pass
   night mode through to the media query, which is why the shell writes
   `letscube-night/1` into the user agent — and that branch was unreachable.
   This is the most likely explanation for the open "Android cold launch is
   light" item; a reload has always been fine because by then the React path
   applies the theme.

Why nothing caught it: `tests/unit/theme-bootstrap-parity.test.mjs` compared
index.html against `THEME_INIT_SCRIPT` and they matched — being identically
broken. Parity proves the copies agree, not that either one works.

Fixed by doubling the backslash in the template literal and regenerating the
HTML copy. The parity suite now also parses both copies with `new Function`
and asserts the emitted pattern equals the marker the shell writes; all three
mutations of the shipped regression — both copies broken, either one alone —
turn it red. `tests/e2e/theme-bootstrap.spec.ts` drives a browser with the
night marker in the user agent and the system set to light, and asserts the
marker wins.

Still to confirm on a device: the Android cold-launch run, which is where the
symptom was reported.

## D-028 continued — four more triggers ruled out, and why the earlier ones could not have found it

Re-investigated 2026-09-04. Still not reproduced. What changed is that the
earlier attempt's method was found to be blind to the most plausible mechanism,
and that mechanism was then measured directly and found not to occur either.

**The earlier attempt counted the wrong thing.** It counted moves of
`scrollTop`. The leading hypothesis from a full reading of `MessageList.tsx`
does not move `scrollTop` at all: browser scroll anchoring is switched off on
both the scroller and the content (`[overflow-anchor:none]`, lines 650 and 656)
and the custom anchoring runs only during a history prepend. So if a bubble
above the viewport shrinks by N pixels, everything below slides up by N and the
reader is carried *down* the history with `scrollTop` unchanged. That is
"сверху вниз", and it would have measured as zero moves.

Measured directly instead: scrolled up in a 1 367-message chat, then sampled
four times a second for three minutes — `scrollTop`, `scrollHeight`, and the
`data-message-id` of whatever sits under a fixed point in the middle of the
viewport. **Zero events.** Nothing moved, nothing resized, and the message under
the probe never changed. That also covers the 60-second media-variant refresh
interval, which the earlier 45-second observation stopped one tick short of.

Also ruled out, each by measurement:

- Scrolling up with the keyboard during the entry lock and then waiting for the
  whole ladder of settle timers: the reader stayed 3 832 px from the bottom and
  the down-arrow was correctly showing.
- The same with the wheel: 3 741 px, arrow showing.
- The other participant marking the chat read while the reader is scrolled up —
  the hypothesis being that the receipt re-keys every outgoing bubble's
  measurement and shrinks the content above. `chat_members.last_read_at` was
  updated for the other member mid-measurement; nothing moved. Weaker evidence
  than the others, because it was not confirmed that the receipt produced a
  visible change on this account.

Real findings from the reading, which stand whether or not they are the
reported symptom:

- `handleScroll` (line 370) sets `isAtBottomRef.current = true` **without
  measuring** for as long as the entry lock is armed, and nothing resets it
  until the next scroll event after the lock expires. An assertion that outlives
  the condition that justified it.
- `releaseScrollControl` was wired to `onPointerDown`, `onTouchStart` and
  `onWheel` but not to the keyboard, so PageUp, Home, the arrows and space
  scrolled the list without telling the component the reader had taken over.
  Fixed, as a consistency fix and labelled as one: removing the fix again does
  not change any measurement that could be taken here, so no test claims it
  does. Every other input device released the hold; the keyboard now does too.
- `pendingJumpRef` in `ChatWindow.tsx` is cleared only on success, and the retry
  effect runs on every `messages` identity change, so a jump that failed
  minutes ago can fire when its target finally mounts. Not observed; recorded.

The entry lock's duration and its ladder of eight timers were doubled in
`07b5a0d` (2026-06-23) from 1 800 ms and five timers to 4 200 ms and eight.
That commit most enlarged the window in which the list moves itself, and is the
first place to look if the symptom is reported again.

What would settle it: the symptom needs to be caught while it happens. The
probe above — `scrollTop` plus the message id under a fixed point, sampled per
frame — is the instrument, and it is drift rather than a jump that it is
looking for.

## D-013 closed — two were already fixed, and the third had been fixed into a different defect

Re-measured 2026-09-04 with the register's own harness (`PAGE_CHECKS` from
`scripts/interface-audit.mjs`, imported rather than reimplemented) at 390x844
and 412x915, both themes, with touch emulation. The three items the earlier
passes left as "Still open" were checked rather than assumed, and only one of
them was still real.

**Header links and the logo link — already fixed.** Measured on `/`,
`/download`, `/privacy` and `/support`: the logo link 28x44, «Конфиденциальность»
147x44, «Войти» 80x44. Fix batch 3 put `min-h-11` on all of them in
`PublicPageShell.tsx`; the "still open" note predates that batch and was simply
stale.

**The support form's checkbox — already fixed.** The input measures 24x24 and
its `<label>` row — which is the real target, because a label toggles its own
control — measures 324x106. Closed by the coarse-pointer rules in `index.css`
together with the harness's label correction.

**The tasks view switch — the target was fixed, and the fix left a visual
defect.** The 30px is long gone: the segments carry `kub-button`, so D-015's
coarse-pointer rule grows them to 44px on a phone without anyone touching this
page. What that rule could not reach was the track around them, pinned at `h-9`.
Measured with touch: segment 168..212 (44px) inside a track 165..205 (36px) — an
**11px overhang**, with the active segment's filled pill visibly breaking out
through the rounded bottom border. On a cursor the same control is correctly
nested, 30px inside 36px, which is the designed scale and why nobody saw it.

This is precisely the mistake `KubSwitch` documents — a fixed decorative size
sitting on the element that has to grow — so it takes the same fix: `h-9` became
`min-h-9`, the designed height as a floor rather than a clamp. After: 44px
segment inside a 50px track with a 3px inset on a finger, unchanged at 30/36 on
a cursor.

The hit area was deliberately **not** grown past the track. Fix batch 4 rejected
overlay hit areas, and a segmented control has two targets sharing one track, so
each segment has to be 44px itself and the track has to follow.

**What the test asserts, and why it is containment rather than height.** Under
the mutation that restores `h-9`, the `>= 44` height assertion still *passes* —
the segment really is 44px, just in the wrong place. Overhang is the load-bearing
assertion. Both mutations turn it red in the right direction: restoring `h-9`
fails the touch case only, and inflating the track for every pointer fails the
cursor case only.

Harness re-measure after the fix: **0 touch-target findings across all 20
cells**. D-013 is closed.

Noted so a later reading does not mistake it for a finding: the tasks search
input measures 42px inside a 44px bordered wrapper, and the harness correctly
counts 44 — the missing 2px is the border.


## A note on how to read this register

Added 2026-09-04, after it cost an assignment.

This file is append-only: an entry keeps its original text forever and a fix is
recorded in a `# Fix batch N` section at the end. That is good for history and
bad for anyone reading top to bottom — D-008's entry still said "**Not fixed
here**" nine hundred lines above the batch that closed it, and work was
commissioned against three defects of which two were already done.

The checkbox in an entry's heading is the answer. `[x]` means closed, with a
pointer to where. Before acting on an entry, check its box and search the file
for its identifier: the last mention is the current state, not the first.

## D-004 closed — the chip shipped as markup and was invisible

Batch 6 recorded this as fixed on 2026-09-02, "verified by regenerating the
previews". It could not have been: the product previews contain no own group
message, and the chip only ever renders on an own message —
`getGroupReadReceiptInfo` returns null for anyone else's — so it was never in
the pictures that were checked.

Measured on 2026-09-04 against the surface it actually sits on, which is always
the tinted own bubble (`--kub-cyan` at 22% over `--kub-surface`): the faint fill
alone came to **1.07:1 in dark and 1.11:1 in light**, against the 3:1 that a
control boundary asks for. Rendered and looked at: "3/3" read as bare text after
the timestamp — the original defect, unchanged.

Fixed with a border in the accent already used for this chip's hover and focus,
so no new colour enters the product: **3.78:1 dark, 3.90:1 light**. The chip
grew 40→42px wide, its height and the bubble's 173x55 are unchanged, so the
footer measurement D-008 depends on is undisturbed.

The test that now protects it computes the ratio from `index.css` rather than
looking for a class name. That distinction is the whole point: a test that
searched for a class would have passed against the invisible chip, exactly as
the previews did. Removing the boundary — the state that actually shipped —
turns it red with the measured ratio in the message.

## The meta-placement contracts had gone back to skipping silently

The four tests in `tests/e2e/message-meta-placement.spec.ts` are the only thing
standing behind D-008, D-024 and D-027. They need the DEV capture route, and
when it was not served they skipped themselves — so a run of the suite reported
success while enforcing none of it. That is the hazard D-024 recorded ("the e2e
had been skipping on every run"), returned in a new form, and it was live
through this whole stage: every run of that spec against the ordinary dev server
reported `4 skipped`.

Absence of the prerequisite is now a failure that says what to set, and skipping
must be asked for with `KUB_ALLOW_PREVIEW_FIXTURE_SKIP=1`. The dev-server recipe
sets `VITE_PUBLIC_PREVIEW_FIXTURE=1` so the ordinary path runs them: 5/5 pass.

## D-032 — a nearly-full last line still grows the bubble, 180ms after paint

Found 2026-09-04 while closing D-004, and deliberately not fixed. **Closed
2026-09-05 — see "D-032 and D-041 closed" at the end of this file.**

A message whose last line is nearly full takes the inline branch anyway, because
`getMaxContentWidth` measures the row and so over-estimates on purpose. The
reserve spacer then wraps and the bubble grows **+22px at t≈1999ms, 180ms after
first paint at 1820ms**. The time still ends up bottom-right and the history
anchor contract passes on the real chat, so this is a late reflow rather than an
anchor break.

Not fixed because the fix means re-reading a declared `max-width`, which is the
exact thing that caused D-027's feedback loop, and because D-024 calls the
over-estimate "the safe direction". Note that the existing stability test cannot
see this: it samples bubble index 1 only and compares a boolean.

## D-033 — a chat id alone reached a group's picture, for about an hour

Introduced by me in `0e6c5da`, found and closed in `64eb2cb` the same night.
Recorded because the reasoning that produced it looked sound in review.

The chat avatar variant row was scoped to chat members, with the argument that
a public row "would newly tell any authenticated non-member that a given chat
id has a picture, and where to get it, since the variant path is derivable from
the chat id alone". The scope was applied to the row. The bytes are served by
storage, and the check that would have caught this — fetching the variant as an
anonymous client — was not run until after the deploy:

    GET /storage/v1/object/public/media/variants/chats/<chat-id>/avatar_128.webp
    -> HTTP 200, anonymous

What actually holds a group photo private is that its original is written to
`chat-avatars/{chat_id}/avatar-{uuid}.png` and `chats`, the only place that name
appears, is readable through `Chat members can view chats` alone — so a chat id
was **not** sufficient. The derivable variant path made it sufficient.

Closed by deriving the variant folder from a hash of the source path, so it is
as hard to find as the original. Six objects already written to derivable
addresses were deleted first; the public URL went 200 -> 400. Their blobs remain
on disk (~45 kB, six files under `variants/chats/<uuid>/avatar_{128,256}.webp`)
because `storage.protect_delete()` correctly refuses direct row deletion and the
deletion was done through the database rather than by handling a service key —
**orphan cleanup is outstanding** and needs the Storage API with
`SELFHOST_SERVICE_ROLE_KEY`, which the operator supplies.

The lesson worth keeping: a policy on a metadata row is not a policy on the
object it addresses. For anything served from a public bucket, the access check
is the fetch, not the row.

## D-034 — the media variants worker retried, forever, work that could never succeed

Pre-existing, found 2026-09-04 while verifying D-033's deploy. Diagnosed and
fixed the same day; the fix is unpushed and undeployed at the time of writing.

`letscube-worker` logged `mediaVariantsWorker storage download failed`
(`StorageApiError`, status 400) exactly twice per 60-second tick — 826 times in
the seven hours before it was noticed, and it resumed at the same rate after
each redeploy.

**The path shapes were a red herring.** The 115- and 128-character
`media_path` values in the first measurement convert perfectly well: of 30 live
image messages with a 128-character path, 27 have both variants, and every
115-character path in the table is `ready`. `resolveStoragePath` was never
wrong. Two entirely separate causes were hiding behind one symptom.

### Cause 1 — two objects that are genuinely gone

Two live video messages carry `media_bucket`/`media_path` NULL and a
`media_url` on **`nhogbeojfnbjcfipitrh.supabase.co`** — the hosted Supabase
project this deployment moved off. `resolveStoragePath` reads the bucket and
key out of the URL and ignores the host, so the worker asked the self-hosted
`media` bucket for a key that only ever existed on the old project. Proven from
the storage service's own log:

    "error":{"raw":"{\"httpStatusCode\":404,\"userStatusCode\":400,
    \"resource\":\"…/1778030470210.mp4\",\"code\":\"NoSuchKey\"…}"

Storage answers a missing object with **HTTP 400 over a 404 body**, which is why
the log said 400 and why 400 read as a puzzle rather than as "gone". Twelve rows
point at the old host in total; ten are already deleted, two are live. The bytes
are not on this server and are not recoverable in code.

### Cause 2 — three objects whose bytes are not a picture

Three live image messages had `status='failed'` rows and **no log line at all**,
because a generation failure is recorded and never logged. Their objects exist —
68 bytes each, all three with the same eTag, replaced in place at
2026-09-03T21:33Z. Parsed on disk:

| chunk | length | CRC |
|---|---|---|
| IHDR | 13 (1x1, 8-bit, grey+alpha) | ok |
| IDAT | 11 | **wrong** |
| IEND | 0 | ok |

libpng refuses a critical chunk whose checksum does not match, so sharp raises
`vipspng: libpng read error` — reproduced locally against a byte-identical
reconstruction, which converts fine once the CRC is repaired. sharp's error is a
bare `Error` with no `code`, so it sanitized to `variant_generation_failed`,
indistinguishable from a transient failure. Six `media_variants` rows were being
deleted and re-inserted every 60 seconds, silently, since the objects were
replaced.

### Why either one lasted

The worker keeps no queue. Every tick it re-scans `messages` and asks
`media_variants` **only which kinds are `ready`** — so a row it had already
failed on looked exactly like a row it had never seen. Nothing could ever leave
the candidate set.

### The fix

A failure is now the worker's memory. Two codes describe the source rather than
the moment — `source_missing` (storage has no such object) and
`source_unreadable` (the bytes will not decode) — and a kind carrying one of
them, against the same bucket and path, is not attempted again. The download
path records a missing source instead of only warning about it, and warns once
rather than every minute. Everything else — a timeout, a 5xx, an upload the
service refused — is unchanged and still retried on the next tick, so the fix
cannot strand a picture that a later attempt would have converted. Replaced
media has a different source path, so the recorded verdict does not carry over
to it.

`safeStorageFailureDetails` now also carries the service's own `statusCode`.
The old log printed `{name, status:400}` and nothing else, which is precisely
why 826 warnings never said "not found".

No migration: `media_variants.error_code` has no CHECK constraint, and both
existing failure shapes re-record themselves as terminal on the first tick after
deploy. Expected production effect: four new rows for the two orphaned videos,
three messages' rows relabelled, two log lines, then silence.

Tests are in `tests/server/media-variants-terminal-failures.test.mjs` and drive
a real tick against a stubbed PostgREST and Storage, because the contract is
about the *second* pass. Ten mutations were run, including restoring
`status = 'ready'` to the candidate query and suppressing every failure rather
than the terminal ones; each was caught.

Not fixed, on purpose: the 19 objects that do exist needed no repair — 16 of
them converted on their own between the two measurements, because a 720p
transcode is slow, not because anything was stuck. The remaining three cannot be
converted by any code: their stored bytes are corrupt, and those three messages
already show nothing in the client regardless of variants. Repairing or removing
them is a data decision for the owner.

Profile and chat avatars were unaffected throughout — all 7 profiles and all 3
groups have their variants — but the avatar loader had the identical latent
defect and is covered by the same change.

## D-035 — every variant the worker uploaded carried a doubled max-age

Mine, from the media caching stage, found 2026-09-04 while verifying D-033 and
fixed in `43ec239`. The most useful entry here, because the source read
correctly the whole time.

`uploadVariant` passed the finished directive to the storage client's
`cacheControl` option. That option takes **seconds**: for a Buffer body the
client writes ``headers["cache-control"] = `max-age=${options.cacheControl}` ``
itself. So every variant this worker produced was served with

    Cache-Control: max-age=max-age=31536000, immutable

an unparseable delta-seconds. That is worse than sending nothing — a client
that cannot parse `max-age` does not cache, so the saving the whole caching
stage was written to buy was not being collected on anything the worker made.

Scope, measured on production rather than reasoned about:

| uploaded by | body | header before the fix |
|---|---|---|
| worker variants | Buffer | **`max-age=max-age=31536000, immutable`** |
| user / chat / bot avatars | Blob | `max-age=31536000, immutable` |
| message media | Blob | `max-age=31536000, immutable` |

Only the Buffer path was wrong: a Blob is sent as a form field the service reads
verbatim. The existing profile and message variants read correctly **only**
because the earlier backfill re-uploaded them through the raw API, which is
precisely what kept this hidden — the objects a source reviewer would have
sampled were the repaired ones.

Fixed by sending seconds through `cacheControl` and the real directive through
`headers`, which the client applies last. The six chat variants were regenerated
and re-checked on the wire. The test drives the real client and asserts the
header it emits, and pins the broken shape too, since a source scan is what
missed this.

Worth carrying forward: **for anything whose value a library reformats, the
assertion belongs on the wire, not on the argument.**

### D-034 — closed in production, 2026-09-04

Deployed as `388c6be`. Verified on the running worker rather than in the test
suite:

| | before | after |
|---|---|---|
| `storage download failed` in the log | 20 per 10 min | **0 per 3 min** |
| anything at all beyond healthz | two warnings a tick | nothing |

The failures are now recorded instead of repeated. `media_variants` carries
`source_missing` on 4 rows / 2 messages (the two videos whose bytes only ever
existed on the hosted project the app moved off) and `source_unreadable` on 6
rows / 3 messages (the 68-byte PNGs whose IDAT chunk fails its CRC — verified
independently by walking the chunks: signature valid, IHDR ok, **IDAT
mismatch**, IEND ok).

Five messages remain without a preview and always will: those two videos have
no bytes on this server, and those three images cannot be decoded by anything,
so they show nothing in the client regardless. That is now a fact in the data
with a reason attached, rather than a warning repeating every sixty seconds.

Two of the mutations were re-run independently before deploying: removing the
memory of a terminal failure fails 3 tests, and forgetting *which* source a
failure was about — so replaced media would never be retried — fails 1.

## D-036 — the decorative lattice paints a rule on the block's own edge

Reported by the owner on 2026-09-04 from a screenshot crop: near the edit
pencil, rules that should form a corner do not converge. Partly fixed the same
day; the mechanism is now measured rather than reasoned about.

**What was proven.** `.kub-grid-subtle` paints a 56px lattice with
`linear-gradient(colour 1px, transparent 1px)`, which puts its rule at the TOP
of every tile, and a background is anchored to the element's own padding box.
With no `background-position` there is therefore a rule at y=0 and at x=0 —
on the element's own edge, sharing it with whatever border sits there.

Measured on a standalone reproduction of the profile panel (header with
`border-b`, then the summary block carrying the class), read out of the live
DOM rather than judged by eye:

```
headerBottomBorderAtY   57
summaryPaddingBoxTopY   57      gap 0
latticeLinesAtY         57, 113
```

A 1px cyan rule and a 1px border occupy the same edge. That is what reads as
lines failing to meet.

**Fixed** by offsetting the lattice half a tile, so no rule lands on an edge of
the block that draws it. Same reproduction, both offsets measured: `0` gives
lines at 0 and 56 and hits the top edge; `28px` gives 28 and 84 and hits
neither. Mutation-tested — restoring the zero offset fails the test.

**What is NOT fixed, deliberately.** Each element still starts its own lattice,
so two adjacent blocks that both carry the class still cannot align with each
other. Making them share one requires the grid to live on a single ancestor
with the blocks transparent, which is a structural change larger than this
defect justifies. No two of the four surfaces that carry the class are
currently adjacent, so nothing depends on it today.

`.kub-grid-bg` has the same zero offset and is left alone on purpose: it is used
only on `min-h-screen` shells, where the edge in question is the viewport's and
there is no border to collide with. A test records that as a decision.

**Still unconfirmed:** whether this is the exact thing the owner photographed.
The crop was too small to identify the surface, and two earlier guesses at it
(the settings profile header, then a pair of adjacent lattices) were both
wrong. The mechanism above is real and measured either way.

## D-037 — the list jerks up and down on every chat entry

Reported by the owner on 2026-09-04: "пролаг при заходе в чат, каждый раз
происходит (дёргается интерфейс вверх и вниз на мгновение)".

Not yet reproduced or diagnosed. The shape — a visible settle immediately after
paint — points at the entry anchoring in `MessageList.tsx`: the list paints,
then scrolls to the bottom or to the first unread message, and the correction is
visible rather than instantaneous.

**Do not "fix" this by removing the scroll.** Section 11 of `CLAUDE.md` makes
the anchoring itself a contract: no unread means the bottom, unread means the
first unread, search and notification jumps land on the exact message, a history
prepend preserves the anchor, and fast upward scrolling must never snap. The
defect is that the correction is *seen*, not that it happens.

Worth measuring first: how many scroll writes happen between first paint and
settle, whether the list is scrolled before or after images and variants have
reserved their space, and whether `getMediaAspectStyle` is reserving the right
box for every media row. D-032 already records a bubble that grows 22px 180ms
after paint, which would move the anchor under exactly these conditions.

## D-038 — a sent message appears near the composer before it reaches the list

Reported by the owner on 2026-09-04: "при отправке сообщения оно появляется
где-то в районе модуля ввода текста и с пролагом попадает в чат".

Not yet reproduced. The description is a position error rather than a timing
one — the bubble is painted somewhere near the composer and then arrives in the
stream — which is the signature of a row rendered before the list has scrolled
to it, or of an entrance transform being seen against a list that is itself
moving.

The message entrance animation was changed the same day (`c2a8d1b`): it is now
opacity plus a 4px lift on new messages only, replacing an unconditional
`translateY(6px) scale(0.98)` that played on every mount. **Check whether that
change is implicated before looking anywhere else** — 4px is far too small to
explain "near the composer", but the interaction between the entrance and the
scroll-to-bottom is the obvious place to start, and if the two compound the fix
belongs in one of them rather than in both.

## D-037 and D-038 closed — one mechanism, measured frame by frame

Diagnosed and fixed 2026-09-04. Both reports are the same defect seen at two
moments, and neither is about where the list ends up.

**Every correction of the scroll position was scheduled with
`requestAnimationFrame` from a passive `useEffect`, so it ran after the browser
had painted the commit that made it necessary.** The first painted frame was
therefore always the uncorrected one. Measured on the real chat against
production data, a Vite dev server on a dedicated port with a QA account, every
scroll write intercepted and the container's geometry sampled per animation
frame:

### D-037 — entry

`ChatWindow` renders a spinner while a chat loads, so `MessageList` unmounts and
remounts on every entry and its container starts at `scrollTop = 0`, which is the
top of the loaded history.

| t (ms) | scrollTop | scrollHeight | distance from bottom |
|---|---|---|---|
| 403.8 | 0 | 3538 | **2808** |
| 471.4 | 0 | 3538 | **2808** |
| 492.0 | 42 | 3562 | **2790** |
| 495.4 | 2832 | 3562 | 0 |

Three painted frames, 88ms, at the top of the history, then a snap of 2790px.
Two screencast frames 85ms apart show it: the conversation opens on its oldest
loaded day and the next composited frame is at the newest message.

Thirteen scroll writes were issued in the first 4.6 seconds. The first was
`behavior: "smooth"` from the message-count effect — and it never delivered
anything, because Chromium's smooth scroll eases in: it covered 42px of 2808 in
88ms before an instant write from another path overtook it. The remaining eight
were the `[120, 320, 680, 1200, 1750, 2600, 3600, 4150]` settle timers, all of
which found the position already correct.

### D-038 — send

| t (ms) | rows | last row top | container bottom | row bottom |
|---|---|---|---|---|
| 3.6 | 54 | 592.8 | 806 | 781.5 |
| 90.6 | 55 | 681.5 | 830 | **865.8** |
| 138.1 | 55 | 678.5 | 830 | 862.8 |
| 141.1 | 55 | 621.5 | 830 | 805.8 |

For three frames and 50ms the sent bubble was painted 36px *below* the bottom
edge of the list — clipped, hard against the composer — and then jumped 57px up
into the stream. That is "появляется где-то в районе модуля ввода текста и с
пролагом попадает в чат", photographed. The composer shrinking back to one line
in the same commit moved the container's own bottom edge 24px at the same
moment.

**The entrance animation from `c2a8d1b` is ruled out as the cause.** Measured,
it applies correctly and its transform is 4px against a 61px displacement. It
did, though, hide a second defect of its own: the bubble faded in at t=68ms,
finished at t=182ms, and **faded in again from opacity 0 at t=231ms** — the
moment the optimistic `tmp:` row was replaced by the server row. Two React keys,
two DOM nodes, two plays of the animation. A message you had just sent blinked.

### The fix

The placement now happens in a layout effect — after React has written the DOM
and before the browser paints — so the first frame is already the settled one.
Nothing about the anchoring changed: same targets, same guards, same settle
timers, same older-history hold. `scrollToBottom` still exists for the deferred
passes and for the scroll-to-bottom button, where smooth is a user action.

The `ResizeObserver` correction moved inside the callback too. That callback runs
after layout and before paint, which is the only place that can catch the bubble
reflowing 22px on its own (D-032) — no React commit describes it. Deferred by a
frame it was painted first and corrected after, and that was the last visible
step on entry.

The entrance is now tracked by `messageEntranceKey` — `client_message_id`, the
one value the optimistic row and the server row share — so the swap no longer
counts as an arrival. `advanceMessageEntrance` takes the rendered ids separately,
because its idempotency cache has to key off what React rendered while arrival
has to key off what survives the swap; collapsing the two puts the double play
straight back.

### After

Same measurements, same server, same account:

| | before | after |
|---|---|---|
| entry: worst painted distance from bottom | 2790px | 24px, corrected inside the same frame |
| entry: painted frames away from the bottom | 3 | 0 |
| entry: smooth scroll writes | 1 | 0 |
| send: first frame with the new row | 61px out, 36px clipped | 0px |
| send: entrance animation plays | 2 | 1 |

Verified at 1440x900, 1920x1080 and 390x844.

### What was ruled out, and what could not be measured

`getMediaAspectStyle` reserves nothing for an image whose message carries no
width/height metadata: `MediaVideo` passes a 16/9 fallback, `MessageImage`
passes none, so `aspectStyle` is `undefined`, `hasReservedAspect` is false, and a
`loading="lazy"` image with `width: 100%` and no height occupies 0px until its
bytes arrive and then jumps to as much as 340px. It is a real unreserved-height
path and it would aggravate any of this, but it is **not** the cause: the wrong
frame is painted before any image has been asked for. It could not be exercised
live — none of the QA account's chats contains a media message — so it is
recorded from the code and left open.

D-032 is implicated but only as the residual: the bubble's own late growth
measured 12–24px here, inside the window the entry correction already covers.

## D-039 `[withdrawn]` — a history prepend is painted 1233px out for exactly one frame

**Read the withdrawal below before acting on any of this.** Re-measured
2026-09-05: the frame is never painted, and the fix this entry recommends was
implemented and measured to be considerably worse than the defect it claims to
remove. The entry is kept in full because the withdrawal is only readable
against it.

Found 2026-09-04 while proving that the D-037/D-038 fix left the older-history
anchoring alone. Measured identical **with and without** that fix, so it is
pre-existing and is recorded rather than changed.

Scrolling to the top of a chat and letting a page of older messages land, with a
witness row sampled every animation frame:

| t (ms) | witness offset | drift | scrollTop | scrollHeight | rows |
|---|---|---|---|---|---|
| 11509 | -38 | 0 | 100 | 6075 | 100 |
| 11967 | -80 | -42 | 4696 | 10591 | 200 |
| 12032 | 1195 | **+1233** | 4696 | **11866** | 200 |
| 12049 | -80 | -42 | 5971 | 11866 | 200 |

The restore does its job on the commit: 100 rows arrive and the reader keeps
their place within 42px. Then the prepended rows finish laying out and the
content grows another 1275px **without a React commit** — the same shape as
D-032, at a hundred times the size — and the hold loop, which runs in
`requestAnimationFrame`, corrects it on the *next* frame. One frame is painted
1233px out.

The settled contract holds and nothing snaps to the bottom, which is why every
existing check passes. This is the same class as D-037 and D-038: a correction
that is applied after the frame it belongs to. The obvious direction is the same
one that closed the 24px residual — the `ResizeObserver` on the content already
fires after layout and before paint, and it currently returns early while the
older hold is active precisely so it does not fight it; restoring the anchor
there instead of returning would land the correction a frame earlier.

Deliberately not attempted here. The older-history hold is the most tuned
mechanism in `MessageList` — this register already records 445px, 706px and
1147px measurements behind its current shape — the contract it serves is in
section 11 of `CLAUDE.md`, and nothing in CI can exercise it: it needs a signed-in
chat with real history, and the e2e suite is unauthenticated. It wants its own
task with its own measurement, not a change made in passing.

## D-039 withdrawn — the frame was never painted, and the proposed fix is worse

Re-measured 2026-09-05 in the task the entry above asked for. **Nothing above
this line survives except the caution.** No frame is painted out of place, and
the direction the entry recommended makes a real 1252px defect where there was
none.

### The instrument was wrong

The 1233px came from a `requestAnimationFrame` sampler. **rAF callbacks run
before style and layout**, so reading `getBoundingClientRect()` there forces an
early layout: it reports the layout the frame is *about to* have, which is not
what the previous frame painted. The hold loop is also a rAF callback, and it
runs later in the same phase. The sampler was reading the list between the
growth and its correction, inside one frame, and reporting it as a painted
frame.

A second probe settles it. A `ResizeObserver` created *after* the component's
own runs last among the observers — after layout, after every correction any
code can still make, immediately before the paint — so what it reads is what is
painted. A private element resized from rAF each frame gives it something to
fire on every frame, not only when the list changes size. Both probes, one
frame, with the intercepted writes numbered in order:

| reading | seq | witness offset | drift | scrollTop | content |
|---|---|---|---|---|---|
| rAF sampler, t=11977 | 22 | 1195 | **+1233** | 4696 | 11817 |
| *write #23, from `hold`* | 23 | | | 4696 → **5971** | |
| pre-paint probe, t=11978 | 23 | -80 | **-42** | 5971 | 11817 |

Same frame. The growth and its correction are both inside it, and the paint is
the corrected one.

The pre-paint probe is not blind to the real thing: with a deliberate control
that skips the correction on the frame the content grows, it reports
`worstPaintedDrift 1233` and one painted frame off anchor — and the control also
leaves the reader 1233px out permanently, which is what a broken hold actually
looks like. On the shipped code, over 13 consecutive prepends from 100 rows to
1368, it reports **0** painted frames more than 100px off the anchor and a worst
painted displacement of **42px**. Reproduced identically at 1440x900 and 390x844
and under 4x and 10x CPU throttling; at 390x844 the phantom is 1828px and still
nothing is painted.

A CDP screencast was run alongside and is recorded as a limitation rather than
evidence: it delivers about 13 frames a second even headed, so it cannot resolve
a one-frame event. Under 6x CPU throttling it caught frames either side of the
window and they are identical, which agrees with the probe but proves less.

### The proposed fix, measured

Restoring the anchor from the `ResizeObserver` while the hold is active —
exactly what the entry above suggested — was implemented and measured against
the same 13 prepends with the same probe:

| | shipped | with the observer restoring |
|---|---|---|
| prepends measured | 13 | 13 |
| prepends painting a frame >100px off anchor | **0** | **11** |
| worst painted displacement | 42px | **1252px** |
| painted frames displaced by the loading band | 465 (42px each) | 0 |
| frames snapped to the bottom | 0 | 0 |

The stacks say why, to the millisecond:

```
t 133640  scrollTop 4696 -> 5971   at hold (MessageList.tsx:365)
t 133641  scrollTop 5971 -> 4696   at ResizeObserver.<anonymous> (MessageList.tsx:463)
```

The observer runs after the hold, and it restores against
`olderScrollAnchorRef`, which `handleScroll` has meanwhile recaptured at the
pre-growth position — the restore write fires a scroll event, and the handler
recaptures on every scroll event while preserving. So the observer undoes the
hold's correction one frame later, and *that* frame is painted 1252px out. It is
the register's own warning, measured: the observer returns early there precisely
so it does not fight the hold.

Reverted. `MessageList.tsx` and `messageScrollAnchor.ts` are byte-identical to
what they were before this task.

### What was added instead

Guards for the two properties the measurement showed are load-bearing, in
`tests/unit/message-history-anchoring.test.mjs` and
`tests/unit/message-scroll-anchor.test.mts`: the hold restores synchronously in
its own rAF callback and releases only after four settled frames, the observer
carries no anchor restore, and the restore itself converges rather than
accumulates, lands an anchor exactly after the content above it has grown, and
clamps to the last scrollable pixel. Seven mutations, each verified to have
applied by matching the original text exactly once and confirming its absence
afterwards; all seven caught, including both halves of the reverted change.

The source guards are still source guards. The frame-level proof cannot live in
CI for the reason the entry above gives, and the rig that produced these numbers
is the only thing that can re-check them.

## D-040 — a sent message twitched the whole conversation a quarter-second after it landed

Found and fixed 2026-09-04, after the D-037/D-038 fix had already removed the
lag the owner first reported. What was left, verbatim: "только если в момент
когда они просто появляются в чате, прям резко очень будто с дёрганием по
горизонту" — the movement's quality, not its destination.

Measured the same way as D-037 and D-038: a Vite dev server against production
Supabase, signed in with the QA owner and, for the arrival case, a second
context signed in as the QA client in the same chat. Every write to `scrollTop`
and `scrollTo` intercepted with its stack, and a **witness row** — an ordinary
message already on screen — measured every animation frame. The witness is the
horizon; how far it moves between two consecutive frames is the whole question.

### Sending, while at the bottom, before

| t (ms) | witness moved | row height | meta placement | what happened |
|---|---|---|---|---|
| 0 | **-39px** | 38.8 | inline | the message arrives and takes its space |
| +14…28 | **-15px** | 53.8 | anchored | the bubble finds its real height |
| +250 | **+15px** | 38.8 | inline | the server row replaces the optimistic one |
| +265 | **-15px** | 53.8 | anchored | and measures itself all over again |

Four steps, 84px of travel for 54px of net movement, reproduced identically on
three runs. The last two are the defect: nothing about the message had changed,
yet the entire conversation stepped down and back up a quarter of a second after
it had settled.

The cause is the React key. `MessageList` keyed each row by `msg.id`, and a
message you send is rendered twice under two ids — `tmp:<client id>` first, the
server row after — so React tore the first node down and built a second one.
Everything `MeasuredTextWithMeta` had measured about itself went with it, and the
replacement started again from `getInitialMetaPlacement`'s guess.

### After

Keyed by `messageEntranceKey` — `client_message_id`, the one value both sides of
the swap share — the row is updated instead of rebuilt. Measured over three runs
at 1440x900, and again headed at the display's real cadence:

| | before | after |
|---|---|---|
| separate movements per sent message | 4 | 2 |
| witness travel | 84px | 54px |
| movement after the message settled | 15px down, 15px up | none |
| entrance animation | plays once, completes | unchanged |

**Receiving, while at the bottom, is unchanged and was already correct**: one
movement of 39–57px, the height of the arriving row, and nothing after it. So is
the section 11 contract — scrolled 700px up, an arriving message left `scrollTop`
identical to the pixel, moved the witness 0px, and only raised the counter.

The key is safe to derive: `addMessage` and `replaceMessage` both collapse a row
that is `sameActorClientMessage` with the incoming one, so the optimistic row and
its server row are never in the list at once.

## D-041 — every own message is painted one row short and grows on the next frame

Found 2026-09-04 while measuring D-040, and deliberately not fixed. **Closed
2026-09-05 — see "D-032 and D-041 closed" at the end of this file, which also
corrects this entry: the update from the layout effect WAS flushed before paint,
and a passive reset then overwrote it.**

`MeasuredTextWithMeta` decides whether the time fits beside the last line of text
or needs a row of its own. The two answers differ by a whole row — 38.8px against
53.8px for the same message — and the decision needs the bubble and the stack,
which it is handed as refs.

**React attaches a host ref during the layout phase, and that phase walks
children before parents.** Both elements are ancestors of the component doing the
measuring, so on the one mount that matters its own layout effect runs with
`bubbleRef.current === null`, returns at its first guard, and leaves the guess
standing. Instrumented on the real chat: the first pass logged `bubbleEl: false`
at t=167ms, the real one landed at t=268ms, and the row grew between them. The
comment above that effect — "Measure once SYNCHRONOUSLY, before this frame is
painted" — is true of every pass except the first.

The guess is `inline`, and for an own message the answer is always `anchored`,
because `getMaxContentWidth` measures `(stackEl ?? bubbleEl).parentElement`,
which is a shrink-to-fit flex item and therefore reports the bubble's *current*
width. Measured on a real own message: `maxContentWidth` 146, last line 144,
footer 67 — `144 + 67 + 8 > 146`, so the meta never fits, for any single-line own
message. A received message escapes only because that same parent includes the
32px avatar lane, which happens to leave room for its narrower footer.

Two fixes were tried and rejected, both by measurement:

1. **Run the first measurement from `MessageBubble`, where the refs exist.**
   Implemented and measured. The measurement then runs with both refs populated
   and decides correctly — and React still does not paint it. The state update
   scheduled from that layout effect was not flushed before the frame, in the DEV
   preview harness *and* on the real chat: the same four steps, unchanged. Backed
   out rather than shipped as machinery that does nothing.
2. **Fix `getMaxContentWidth` to measure the row a message may occupy.** This
   would make the guess right, but it moves the timestamp of every own message in
   the product from its own row to beside the text. That is a design change, not
   a motion fix, and it was not asked for.

What is left is one 15px step, 8–14ms after the arrival step it belongs to —
measured at 144Hz, one to two composited frames, so the reader sees the 54px
arrival with a stutter rather than a separate event. Closing it needs either a
guess that uses what the component already knows (whether the meta carries a
delivery indicator), which trades a certain miss on every own message for an
occasional miss in the other direction on wrapped ones, or the layout change
above. Both want a decision, not a change made in passing.

## D-042 — the loading band shoves the reader 42px, with a spinner they cannot see

Found 2026-09-05 while re-measuring D-039, on the same rig. Not fixed: the
obvious fix is the one measured above, and it is worse.

Asking for older history sets `loadingOlder`, which mounts the
"Загружаем историю..." band at the top of the scrolled content — the
`data-message-history-status` block in `MessageList.tsx`. It is **42px tall and
inside the scroller, above every row**, so the moment it appears every message
moves down 42px. No React commit describes that as a scroll change, and the
prepend layout effect ignores it on purpose: it acts only once rows have
actually arrived.

Measured, painted, across 13 consecutive prepends:

| | |
|---|---|
| painted frames displaced | 465 |
| displacement | 42px, every time |
| how long the reader sees it | ~250ms per prepend |
| where it ends | back at 0 — the restore compensates when the band goes |

The load triggers at `scrollTop < 160`, so the band is usually above the
viewport when it mounts: the reader is pushed by a spinner they cannot see.

Not a violation of the prepend contract — the anchor itself is restored exactly,
final drift 0px on the anchor row — but it is 42px of painted movement the
reader did not ask for, larger than the 24px residual that D-037 was considered
worth fixing.

Two directions, neither taken here. Taking the band out of the flow — the
overlay pattern the bulk-error banner in the same file already uses — is a
design change to the loading affordance and needs an explicit decision.
Restoring the anchor on the commit that mounts the band is a change to the hold,
and this entry's own sibling is the evidence for measuring any such change over
many prepends before believing it.

## D-032 and D-041 closed — one ceiling that was never applied, one effect that undid the measurement

Fixed 2026-09-05. Two defects, two causes, and they meet in the same eight lines
of `MeasuredTextWithMeta`.

Measured the way D-040 was: a Vite dev server on a dedicated port against
production Supabase, signed in as the QA owner, the geometry of the arriving
bubble **and of a witness row already on screen** sampled every animation frame,
plus a CDP screencast. Chat 0 is the owner's own "Избранное", so the sends this
needed reached nobody.

### D-041 — the guess was written back over the answer

The measurement did run before the first paint. It could not see the bubble,
because `bubbleRef` and `stackRef` point at ancestors and React attaches a host
ref during the layout phase, which walks children before parents. That much the
entry already said. What it missed is what happened next: even once the elements
are found and the placement is measured synchronously, a **passive effect resets
it**. The `useEffect` on `[content, measureKey]` that returns the placement to
`getInitialMetaPlacement` also runs on mount, after the commit, and puts the
guess back over the value the layout effect had just measured. The measured
value then returned through the `requestAnimationFrame` pass — one frame late.
That is why moving the measurement into `MessageBubble` looked as if React "did
not flush before paint": it flushed, and this overwrote it.

Both halves are needed and both are proven by mutation. The elements are now
read from the DOM — `textFlow.closest('[data-message-bubble="true"]')`, which is
populated by then because React inserts the whole subtree before it runs any
layout effect — and the reset skips its first run, which restores nothing
because `useState` already initialises to the same two values.

### D-032 — the ceiling existed and was never asked

`getMaxContentWidth` measured the row. The row is a shrink-to-fit flex item
around this very bubble, so it can be far wider than the design cap the stack
declares. Measured on a real own message at 1440: row 1008px, so the answer was
984px, while the bubble could never exceed 560px — 534px of content. A last line
of 506.7px was told it had 984px, chose inline, and the spacer that reserves
room for the time then wrapped.

The cap is now read from the stack's computed `max-width` and applied as a
`Math.min`. That string is `min(1238.4px, 560px, max(256px, 100% - 104px))` —
every unit already absolute, so it needs evaluating, not `parseFloat`, which
returns 100 for `100%`. `artifacts/kub/src/lib/cssLength.ts` evaluates it.

**Only the terms that do not move are used.** The `100%` term resolves against
the row, which grows with the content, and using it made the limit move with the
placement: measured, that flipped two already-settled messages in an unrelated
chat from inline to anchored and made them 15px taller. Percentages are
therefore asked as unbounded and drop out of the `min()`, leaving the fixed
design ceiling. A ceiling can only ever tighten the answer, so this cannot
reopen D-027's feedback loop.

### Sending, measured frame by frame, three runs each

| | D-041 before | D-041 after | D-032 before | D-032 after |
|---|---|---|---|---|
| bubble at first paint | 36.8px | **48.8px** | 59.5px | **71.5px** |
| bubble once settled | 48.8px | 48.8px | 82.3px | **71.5px** |
| change after it was painted | +12px | **none** | +22.8px | **none** |
| when | +15…30ms | — | +39…46ms | — |
| gap between the two witness steps | 28–31ms | **4–7ms** | 39–46ms | **4–5ms** |

The second witness step that remains is `MessageList` catching the bottom up by
the row's height; it is a scroll, not a resize, and it lands in the same frame
group. The 24px step earlier in the D-032 runs is the composer growing under the
typed text and is unrelated.

### Chat entry, no sends, matched pair on one revision, two runs each

| | before | after |
|---|---|---|
| 1440×900 — rows that change height after their first painted frame | **13 of 73** | **0** |
| 1440×900 — total late growth | 199.2px | **0px** |
| 1440×900 — latest correction | 111ms after the row appeared | — |
| 390×844 — rows that change | **60 of 73** | **0** |
| 390×844 — total late growth | 1356.7px | **0px** |
| list-height steps after entry | 1 | **0** |
| scroll steps after entry | 1 | **0** |
| distance from the bottom once settled | 0px | 0px |

D-032 was endemic on the phone viewport, where the cap is `86vw` and the row's
max-content is several times it.

### What it changed in the product, and what it did not

Every message rendered in two real chats at three widths, compared before and
after: **47 of 392 changed, and every one of them was a bubble whose reserved
spacer was wrapping.** 345 are identical to the pixel.

- 1440×900 — 1 of 64 in chat 0 (82.3px → 71.5px), 0 of 100 in chat 1
- 1024×900 — 0 of 64, 0 of 100
- 390×900 — 46 of 64 (82.3px → 81.5px, one 105px → 104.3px)

`output/d032/d032-before.png` and `d032-after.png` are the same message: a blank
third line with the time hanging off it, against the time on its own compact
row, 10.8px shorter.

**The design was not touched.** `getMaxContentWidth` still measures the
shrink-to-fit row, so an own message's timestamp still takes its own row exactly
as it does today — the thing that was to be reported rather than changed. A
ceiling can only refuse a placement that was already going to overflow; it can
never make the meta fit where it did not before.

### Section 11, measured rather than argued

| | before | after |
|---|---|---|
| entry, no unread: distance from the bottom | 0px | 0px |
| prepend: anchor row displacement, worst frame | −80.5px | −80.5px |
| prepend: anchor row displacement once settled | −80.5px | −80.5px |
| fast upward scrolling: `scrollTop` range | 0…5871 | 0…5871 |
| fast upward scrolling: downward jumps over 200px | 2 | 2 |

Identical. The −80.5px prepend step is D-042's loading band and is unchanged by
this work. `tests/e2e/chat-entry-scroll.spec.ts` (3), `message-meta-placement.spec.ts`
(4) and `tests/unit/message-history-anchoring.test.mjs` all pass.

### Tests, and the mutations that prove them

`tests/unit/css-length.test.mts` and `tests/e2e/message-meta-first-paint.spec.ts`.
The e2e calibrates its own text against the running layout — the width that
triggers D-032 is a window about `time + 8px` wide at the very end of a line, and
where it sits depends on the viewport and on the font the machine has — and it
pins the font by refusing Google Fonts, for the reason in D-043.

Eight mutations, each verified as applied by grepping the pattern off disk
before running anything. All eight fail the suite:

| mutation | caught by |
|---|---|
| the cap clamp removed | the spacer wraps onto a blank line |
| the reset runs on mount again | a bubble painted at 36.8px becomes 54.8px 28ms later |
| ancestors only from React refs | the same |
| the cap keeps the bubble's padding and border | the crafted messages stop rendering at all — the two placements start arguing for each other and the bubble flips on every frame until React gives up |
| percentages resolve to zero instead of refusing | the unit suite |
| `min()` behaves as `max()` | the unit suite |
| an unresolved unit is taken as pixels | the unit suite |
| a partly parsed value is accepted | the unit suite |

### Left alone deliberately

`getMaxContentWidth` reads `--kub-action-lane` through `parsePixelValue`, which
refuses anything not ending in `px`. The custom property computes to `6.5rem`,
so **the lane has always been 0 there** and 104px is never subtracted. It is not
fixed here because subtracting it turns every single-line *received* message
anchored: the 32px avatar lane in the row is the only reason their time is
inline today, and 104px erases it. That is the same design decision, reached
from the other side.

## D-043 — the first load re-flows every message when Inter arrives

Found 2026-09-05 while building the regression test for D-032, and not fixed.

`artifacts/kub/index.html:34` loads Inter from Google Fonts with `display=swap`.
A cold page therefore paints in the fallback face and re-flows when the real one
lands, and every text metric changes with it. Measured on the DEV preview
fixture: a timestamp 23.7px wide became 28.6px, a last line 426.9px became 534px,
and the bubbles re-measured and changed height 55ms later — well after first
paint.

This is not D-032 or D-041, and no measurement taken before the font exists could
have predicted it: the metrics genuinely change. It is recorded because it is the
remaining source of late height changes in a chat, and because it makes a
frame-by-frame test of message geometry unreliable unless the face is pinned —
`tests/e2e/message-meta-first-paint.spec.ts` blocks the font for exactly that
reason and says so.

The directions are self-hosting the face with `font-display: optional`, or
measuring nothing until `document.fonts.ready`. Both are decisions about the
product's first paint, not motion fixes.

# Audit sweep, 2026-09-05 — the surfaces rebuilt on 3–4 September

Queue item 18, half A. Four surfaces changed in two days and none had been
swept: the profile card became a floating, draggable window with a media
sub-view and counted rows; the settings modal became one scrolling column of
44px rows with no tabs; the roles panel gained a ranked, coloured hierarchy; and
message bubbles were made to paint at their final height.

**Rig.** `scripts/interface-audit.mjs` against production `https://app.letscube.ru`,
signed in as the QA owner. Production was confirmed to be running the current
revision before anything was measured: `origin/main` is `321342f`, and the
deployed bundle contains that commit's own new selector,
`closest('[data-message-bubble="true"]')`, which nothing before it used.

**Matrix.** 7 surfaces x 5 viewports (`3840x2160`, `1920x1080`, `1440x900`,
`390x844`, `412x915`) x 2 themes = **70 cells**. 67 measured, 3 unreachable.
535 raw findings collapse to **36 distinct (surface, kind, selector) groups**,
which is the number worth reading: a defect in a message row is reported once
per message.

| surface | how it is reached |
| --- | --- |
| `messenger` | `/` |
| `chat` | first chat in the list |
| `profile-card` | chat, then `chat-header-info-button` |
| `profile-media` | as above, then the first counted media row |
| `settings` | Меню, then Настройки |
| `settings-expanded` | as above, with Оформление, Звук and Обновления opened |
| `admin-roles` | `/admin/roles` |

**Cells not reached: 3 of 70**, all `profile-media` — `1920x1080 dark`,
`412x915 dark`, `412x915 light`. The QA account holds exactly one shared-media
item across its three chats, and in those three runs the counted row had not
appeared before the 20s wait ran out. That is the fixture, not the surface: the
same surface measured cleanly in the other seven cells. Nothing here is reported
as a pass on the strength of a cell that was never measured.

**Every surface in this sweep needs a signed-in session** — `messenger`, `chat`,
`profile-card`, `profile-media`, `settings`, `settings-expanded` and
`admin-roles` are all behind authentication, and there is no unauthenticated
route to any of them. The two native shells are out of scope here; this is the
browser matrix only.

**The chat's late-height contract holds.** A `ResizeObserver` installed before
the app boots recorded the first painted height of every message row and every
later change to it: **750 row-observations across ten chat cells, 0 rows changed
height after their first painted frame.** D-032 and D-041 are closed and stay
closed at all five widths in both themes.

## D-044 `[x]` a message's monogram is white on every colour the palette has

**Severity:** high. Every message from a sender with no picture, in every chat,
at every viewport, in both themes.

**Surface:** `artifacts/kub/src/components/ui/ChatAvatar.tsx:329-338`
(`MessageActorAvatar`). Compare `:167` (`ChatAvatar`) and `:273` (`UserAvatar`).

**Reproduction:** sign in, open a chat with someone who has no avatar picture,
look at the circle beside their messages. `chat` / `profile-media`, any viewport.

**Defect:** the fallback hard-codes `font-medium text-white` at `:332` and then
sets `style={{ background: getAvatarColor(actorId) }}` at `:335`. The two
sibling components paint the same monogram with
`color: avatarInkFor(bgColor)` — `artifacts/kub/src/lib/avatarInk.ts:13-24`,
which measures the background and returns whichever of `#FFFFFF` and `#0B1220`
scores better. `MessageActorAvatar` never calls it.

**Measured in the product**, 1440x900 dark and 390x844 light, the same person on
the same screen:

| where | component | ink | background | ratio |
| --- | --- | --- | --- | --- |
| chat list, 48px | `ChatAvatar` | `#0B1220` | `#FFEAA7` | **15.67:1** |
| chat header, 32px | `UserAvatar` | `#0B1220` | `#FFEAA7` | **15.67:1** |
| message row, 32px, x8 | `MessageActorAvatar` | `#FFFFFF` | `#4ECDC4` | **1.93:1** |

The reading is identical in both themes, because both colours are inline literals
and neither is a theme token.

**All ten palette entries fail**, not the unlucky ones. `getAvatarColor` at
`:16-25` offers ten colours; white text scores 1.19:1 to 2.78:1 on them, and
`avatarInkFor` would score 6.75:1 to 15.67:1:

| colour | white | what `avatarInkFor` would pick |
| --- | --- | --- |
| `#FF6B6B` | 2.78:1 | `#0B1220`, 6.75:1 |
| `#4ECDC4` | 1.93:1 | `#0B1220`, 9.68:1 |
| `#45B7D1` | 2.35:1 | `#0B1220`, 7.98:1 |
| `#96CEB4` | 1.78:1 | `#0B1220`, 10.51:1 |
| `#FFEAA7` | 1.19:1 | `#0B1220`, 15.67:1 |
| `#DDA0DD` | 2.07:1 | `#0B1220`, 9.05:1 |
| `#98D8C8` | 1.62:1 | `#0B1220`, 11.58:1 |
| `#F7DC6F` | 1.36:1 | `#0B1220`, 13.75:1 |
| `#BB8FCE` | 2.65:1 | `#0B1220`, 7.07:1 |
| `#85C1E9` | 1.94:1 | `#0B1220`, 9.63:1 |

**Consequence:** the monogram is how a reader tells who wrote a message when
there is no picture, and it is the one place in the product where it is
illegible. 56 instances across the 7 measured `profile-media` cells; the count is
one per avatar-less incoming message on screen.

## D-045 `[x]` a history prepend fades in a hundred bubbles at once

**Severity:** medium. Every load of older history, in every chat with more than
one page of it.

**Surface:** `artifacts/kub/src/lib/messageEntrance.ts:78-101`
(`advanceMessageEntrance`), read by
`artifacts/kub/src/components/chat/MessageList.tsx:177-185` and applied at
`artifacts/kub/src/components/chat/MessageBubble.tsx:1370`
(`isEntering && "msg-appear"`).

**Reproduction:** open a chat with more than a page of history and scroll up
until older messages load. Measured at 1440x900 dark.

**Defect:** the module's own opening comment says why it exists — `msg-appear`
"was applied to every bubble unconditionally, so it played on every mount ...
Fifty bubbles fading and sliding at once is what «дёргано, без плавности» is
describing". The guard it added is `primed`, which suppresses the animation on
the **first** pass only. `advanceMessageEntrance` has no notion of *where* an id
appeared: after priming, every id not in `seen` is "entering", and a prepend adds
a hundred of them at the front.

**Measured**, one prepend, sampling every animation frame for 20s at 1440x900:

| | |
|---|---|
| rows before / after | 100 / 200 |
| rows carrying `.msg-appear` in one frame | **100** |
| of those, inside the viewport | **17** |
| lowest opacity sampled | **0** |
| frames with a faded row | 8, from t=1343ms to t=1468ms |

A wheel-driven run over three consecutive prepends reached the same peak of 100
and left 263 of 346 sampled frames with something animating.

**Consequence:** 17 bubbles on screen fade and slide simultaneously each time
older history arrives — the behaviour the entrance rule was written to remove,
in the one case it does not cover. `prefers-reduced-motion: reduce` still removes
the movement (`index.css:534-537`), so this is a defect for everyone else.

**Not the same as D-042**, which is the 42px loading band displacing the reader.
That entry is about the band; this one is about the rows.

## D-046 `[x]` the entrance class, and its compositing hint, are never taken off

**Severity:** low.

**Surface:** `artifacts/kub/src/index.css:527-531`, applied from
`artifacts/kub/src/components/chat/MessageBubble.tsx:1370`.

**Defect:** the rule carries `will-change: opacity, transform` under a comment
that reads "the hint is dropped the moment the animation ends so an idle chat is
not holding a layer per bubble". Nothing drops it. There is no `animationend`
listener and no `onAnimationEnd` anywhere in `MessageBubble.tsx` or
`MessageList.tsx`; the class comes off only when some later render recomputes
`enteringKeys`, and a chat that nothing else touches never has one.

**Measured**, same run as D-045, 1440x900: 18.5 seconds after the animation
finished, `document.querySelectorAll('.msg-appear').length` was **100**, and the
first of them still reported `will-change: opacity, transform`.

**Consequence:** up to one retained compositing layer per row of the last
prepend. No visible defect was observed and none is claimed. What is recorded is
that a comment in the stylesheet describes a mechanism the code does not have,
which is how the next person reading it will be misled.

## D-047 — the 44px touch rule is opt-in, and neither rebuilt surface opted in

**Severity:** medium. All four coarse-pointer cells (`390x844` and `412x915`,
both themes).

**Surface:** the rule is `artifacts/kub/src/index.css:803-855`. It reaches
`.kub-button`, `.kub-icon-action`, `.kub-field`, `.kub-switch`, `select` and
checkbox/radio inputs — and nothing else. Every control below is plain Tailwind
sizing carrying none of those classes.

**Reproduction:** open each surface at 390x844 with touch emulation and measure
the control's box.

| control | measured | file |
| --- | --- | --- |
| per-message actions, phone-only | **20x20** | `MessageBubble.tsx:1113-1122` (`h-5 w-5 sm:hidden`) |
| reaction chip | 37x22 | `MessageBubble.tsx`, reaction row |
| profile card «Закрыть» / «Назад» / «Редактировать» | 36x36 | `ChatInfoPanel.tsx:1097`, `:1106`, `:1119`, `:1129` |
| profile card action rows, incl. the counted media rows | 357x36 | `ChatInfoPanel.tsx:1058-1064` (`py-2`) |
| settings «Закрыть» | 28x28 | `KubModal.tsx:118-121` (`p-1.5`) |
| settings «Сменить фото» | 28x28 | `SettingsModal.tsx:455-471` |
| settings Имя / Никнейм / О себе | 232x36 | `SettingsModal.tsx:660` (`h-9`) |
| settings theme radios x3 | 36x32 | `SettingsModal.tsx:354` (`h-8 w-9`) |
| audio processing modes x3 | 288x36 | `AudioSettingsSection.tsx:654` (`min-h-9`) |
| «Сбросить настройки звука» | 162x**16** | `AudioSettingsSection.tsx:560` |
| chat «Назад» | 36x36 | `ChatHeader.tsx` (`p-2`) |

The settings **rows** are correct: `ROW_GRID` and `FIELD_ROW_GRID` both carry
`min-h-11`, and every row measured 44px or more (44, 44, 55, 60). The defect is
the controls sitting inside them, which the row's height does not give them.

**The worst of these is the 20x20 one.** Below the `sm` breakpoint it is the only
visible affordance for a message's actions, and it appears once per message —
298 instances across the four coarse `chat` cells, 75 per screen. A long press on
the bubble opens the same menu (`MessageBubble.tsx:935`, `:1375`), so it is not
the only route; it is a visible control at under a fifth of the required area.

**This is D-015's mechanism, not its scale.** Fix batch 4 raised the hit area for
a finger and deliberately left the pointer scale alone, and the register recorded
that as closed. It is closed for everything that carries the classes. Two
surfaces rebuilt three days later carry none of them, so the rule reaches nothing
on either. Whether the answer is more classes or a wider selector is a decision,
not a patch.

## D-048 `[x]` the required marker misses 4.5:1 in both themes

**Severity:** low. All ten `settings` cells and all ten `settings-expanded` cells.

**Surface:** `artifacts/kub/src/components/sidebar/SettingsModal.tsx:643` —
`{required && <span className="text-[color:var(--kub-danger)]"> *</span>}`.

**Measured:** `#ef4444` on `#0b213a` (dark `--kub-surface-2`) is **4.32:1**; the
light pair is **4.30:1**. 14px at normal weight needs 4.5:1. Reproduced
identically in all twenty cells and verified once by hand against the harness.

**Consequence:** the only mark that says «Имя» is required is the hardest thing
in the row to see. Small, but a WCAG 1.4.3 failure on a production form field
that costs one token to move.

## D-049 — the online colour is tuned for a dot and used as text

**Severity:** low. Light theme only; 3 cells (`3840x2160`, `1920x1080`,
`1440x900` light).

**Surface:** `artifacts/kub/src/components/chat/ChatHeader.tsx:243-244`, which
paints the subtitle `text-[color:var(--kub-online)]` when the other person is
online. The token is `artifacts/kub/src/index.css:339`.

**Measured:** «в сети» at 12px in `#3C8B3C` on the white header measures
**4.24:1**, under the 4.5:1 normal text needs. The dark theme's `#4DCD5E` on its
own surface passes and was not reported in any cell.

**Why it happened is written above the token itself:** "Darkened along the same
hue: at `#4FAE4E` the status dot measured 2.80:1 on white and 2.62:1 on the page,
under the 3:1 a non-text indicator needs." It was solved for the **dot**, which
needs 3:1, and the same value is then used for 12px **text**, which needs 4.5:1.
`#3C8B3C` clears the first bar by a margin and misses the second by 0.26.

## D-050 `[x]` opening the profile card on a phone re-lays the conversation at 24px

**Severity:** low — nothing visibly wrong, and the anchor is restored exactly.
Recorded for the work it does and the hazard it leaves.

**Surface:** `artifacts/kub/src/lib/profileWindow.ts:50-52` (`DOCKED_CLASS`) with
`artifacts/kub/src/lib/floatingWindow.ts:31` (`DOCK_BREAKPOINT = 640`).

**Reproduction:** at 390x844, open a chat, press the header, close the card.

**Defect:** below 640px the card docks as `w-full` **beside** the conversation in
the same flex row rather than replacing it. The chat is not unmounted: it is
compressed and pushed off the left edge.

**Measured** at 390x844, 75 rows:

| | before | card open | after closing |
|---|---|---|---|
| scroller width | 390 | **24** | 390 |
| `scrollHeight` | 6586 | **114731** | 6586 |
| `scrollTop` | 5868 | 114013 | 5868 |
| witness row top | 79 | — | **79** |

Individual rows are laid out at up to 2337px tall while the card is open, and
every one of the 75 is measured twice more on the way back.

**The section 11 contract is not violated**: scroll drift 0px, witness drift 0px,
height drift 0px. What is recorded is that the meta-placement machinery closed by
D-032 and D-041 — which decides a bubble's height from its measured available
width — is re-run at 24px and again at 390px on every open, and that the card
covers the conversation completely at that width anyway, so nothing is gained by
keeping it laid out.

## Measured, and not a defect

Four things this sweep was specifically asked to look at were measured and are
correct. They are recorded so the next pass does not spend the time again, and so
that nobody "fixes" them by eye.

**The counted media rows do not truncate.** Measured with the row's own computed
font (`14px Inter`) against its own available width. The floating card at
1440x900 gives the label **273px**; the docked card at 390x844 gives **284px**.
The widest label the product can build is `12345+ голосовых сообщений` at
**207.9px** — `voice` has the longest plural forms and the count is bounded by
nothing narrower. `619 голосовых сообщений` measures **181.5px** and
`1543 голосовых сообщений` **190.1px**. Nothing gets close to the edge, and the
observed row reported `scrollWidth - clientWidth = 0`. The harness could not have
answered this: the label carries `truncate`, and the clipping check skips
`text-overflow: ellipsis` as deliberate, so this had to be measured directly.

**The settings rows hold a long value without clipping it.** At 390x844,
«Push-уведомления» / «Заблокировано в настройках браузера» wraps onto a second
line — which is what `SettingsRow`'s `flex-wrap` is for — and the row grows from
44px to 55px. Every row at every width reported `scrollWidth - clientWidth = 0`
on its value. At 1440x900 the value stays on the label's line, 384px to the right
of it, beside the control it describes.

**No role colour lands on an unreadable text pairing, because no role colour is
ever text.** `roleSwatchColour` reaches exactly two places, both `aria-hidden`
dots: `RolesPermissionsTab.tsx:677-683` (12x12, bordered) and `:1065-1070` (6x6,
inside a `KubBadge`). The label beside it is `--kub-text` and `--kub-muted` in
every case. The 13 production roles use 6 distinct colours; measured against the
panel surface in dark theme they run **5.55:1 to 10.77:1**, and the three roles
with no colour get a neutral 35% muted mix. The panel reported **0 findings in
all 10 of its cells**, and its reorder buttons measure 44x44 on a coarse pointer
because they carry `kub-icon-action` — which is D-047's rule working where it was
applied.

**Message rows no longer change height after their first painted frame.** 750
row-observations, 10 cells, 0 changes. See the sweep header.

## Three harness corrections, and one thing it still cannot see

None of these are product defects; all three would have put invented findings in
this register, which is the failure mode the harness exists to avoid.

**1. A parked sub-view was reported as clipped content, in all ten profile-card
cells.** The card keeps its media gallery mounted beside the root view at
`opacity: 0`, `pointer-events: none` and `inert`, translated 12% to the right
(`index.css:762-785`). `opacity` is not inherited, so a child of that layer
reported `opacity: 1`, and the clipping check counted its text as "content a
person needs" being cut off by 45px. `isHiddenByAncestor` now walks the ancestors
for `display: none`, `visibility: hidden`, zero opacity and `inert`, and the
clipping check skips anything it hides. **10 findings removed, every one false.**

**2. Every screenshot was of the harness's scroll position, not the surface's.**
The evidence image was taken *after* `checkFocusVisibility` presses Tab forty
times, and each stop scrolls its control into view — so the settings dialog's
evidence showed it opened three rows down, with nothing on the image to say the
harness had put it there. The screenshot is now taken before the keyboard walk.

**3. Eighty-one controls nobody can see were reported at 390px.** With the
profile card docked (D-050), the conversation behind it is still laid out — at
24px, with its rows at negative x — and the harness measured all of it.
`isOccluded` now uses the browser's own hit test at an element's centre, and
treats an element whose box lies entirely past the left or right viewport edge as
gone: the document does not scroll sideways, so nothing brings it back.
Vertically off-screen is deliberately still measured — a person scrolls to it,
and the privacy page's 22 undersized entries were found below the fold.
`profile-card 390x844 dark` went from **87 findings to 6**, and the six are the
card's own.

**What it still cannot see:** two of the chat's controls straddle x=0 with a few
pixels inside the viewport and survive both tests, so `profile-card` at the two
coarse viewports still reports the reaction chip and one message-actions button
from the conversation behind the card. Both are listed under D-047 anyway, where
they belong to `chat`; they are not evidence about the card.

## D-051 `[x]` The sidebar's whole realtime path was dead, poisoned by one table

Found 2026-09-05 while building the two-device sync harness, and fixed.

**Severity:** high. Every account, every device, every chat that is not the one
currently open.

**Surface:** `artifacts/kub/src/hooks/useChats.ts:278-287` (before the fix) —
one channel, `chats:user:{userId}`, carrying four `postgres_changes` bindings:
`messages` INSERT, `messages` UPDATE, `chats` UPDATE, `chats` DELETE.

**Defect:** `public.chats` is not in the `supabase_realtime` publication, and a
channel that asks for an unpublished table silently stops delivering *every*
binding it carries — including the ones whose tables are published. Nothing in
the client says so: the channel reports `SUBSCRIBED`, reaches state `joined`, and
is assigned a server-side id for all four bindings.

**Reproduction.** One account signed in with no chat selected; a peer sends one
message. Instrumented on the live server:

| | before | after |
| --- | --- | --- |
| `kub:chats-refresh` events in 16s | 0 | 1, at ~0.9s |
| `unread_count` in the store | 0 for the full 16s | 1 within 1s |
| sidebar preview | a message from a previous session | the new message |
| `mark_chat_delivered` fired | no | yes |

**Isolation.** Built by construction against production, on the application's own
realtime client, all four subscribed successfully:

| channel | bindings | delivered |
| --- | --- | --- |
| one binding | `messages` INSERT | yes |
| three bindings | `messages` INSERT + UPDATE + DELETE | yes |
| four bindings | `messages` ×3 + `chat_members` INSERT | yes |
| two bindings | `messages` INSERT + `chats` UPDATE | **no** |
| two bindings | `chats` UPDATE + `messages` INSERT | **no** |
| two bindings | `messages` INSERT + `chats` DELETE | **no** |
| four bindings | the application's exact set | **no** |

So it is not the number of bindings and not their order: it is the presence of
one binding on a table the publication does not carry. Confirmed against
`pg_publication_tables`, which lists `messages`, `chat_members` and `profiles`
but not `chats`.

**Consequence:** the unread badge never appeared and the last-message preview
never moved for any chat that was not open. Clearing an unread count worked
(`chat-members:user:{id}` is single-table and healthy), so the badge could go
down but never up.

This was never a two-device defect — one device was hit exactly as hard. It only
*surfaced* under two devices because a single one hides it: you leave the tab and
come back, `refreshAfterBackground` fires on focus, and the sidebar catches up
before you notice anything was stale. Someone who stays on the app the whole time
sees no badge at all, on one device or five. Driving two focused devices of one
account simply removed the tab-switch that had been papering over it.

**Fixed** 2026-09-05, `artifacts/kub/src/lib/realtimeTableChannels.ts`: one
channel per table, so a binding can only ever take down bindings on its own
table. The rule is deliberately "group by table" rather than "isolate the tables
that are not published" — an allowlist of published tables would duplicate a fact
that lives in the database and would fail dangerously the day a table is dropped
from the publication.

The `chats` bindings are kept, on their own channel, rather than deleted: they
are inert today but correct, and they cost nothing where they cannot contaminate
anything. Live chat rename and delete therefore remain non-live. Making them work
needs `public.chats` added to the `supabase_realtime` publication, which is a
production DDL change and belongs to its own reviewed migration under the rules
in CLAUDE.md §10 — it was **not** done here.

Covered by `tests/unit/realtime-table-channels.test.mts` and
`tests/e2e/multi-device-sync.spec.ts`.

**Three more channels carry the same fault and were not fixed**, being outside a
chat-sync task. Each mixes a binding on an unpublished table with bindings that
would otherwise work, so all of them are inert:

- `artifacts/kub/src/components/chat/ChatInfoPanel.tsx:440` — `chat-info:{id}`,
  poisoned by `chats`; the info panel's member list and invites do not live-update.
- `artifacts/kub/src/hooks/useAdminDashboard.ts:136` — `admin-dashboard-v2`,
  poisoned by `chats` and `audit_logs`.
- `artifacts/kub/src/hooks/useDynamicRoles.ts:151` — `roles:*`, poisoned by
  `permissions`.

Separately, `artifacts/kub/src/components/sidebar/PhoneSection.tsx:64` subscribes
only to `profile_contacts`, which is also unpublished; it has nothing to poison
but never fires either.

Note that mixing tables is not wrong in itself —
`task-routing:{id}:locations` carries `locations` and `location_members` and
works, because both are published. What is wrong is mixing a published table with
an unpublished one, which is indistinguishable from working until you measure it.

## D-052 `[x]` A peer who is online reads as "был(а) N минут назад"

Found 2026-09-05 while measuring D-051, and fixed.

**Severity:** high. Any two people looking at a conversation without sending
anything.

**Surface:** `artifacts/kub/src/hooks/useMessages.ts:756-767` (before the fix) —
the `profiles:chat:{chatId}` handler spent each realtime `profiles` row on
`message.sender` and dropped the rest. The chat header and the sidebar read
presence from `chat.other_user` (`ChatHeader.tsx:167`, `ChatListItem.tsx:84`),
which nothing refreshed.

**Defect:** `fetchChats` is what puts a fresh `online_at` into the chat list, and
it runs on tab focus, reconnect, `pageshow` and message traffic. None of those
happen while two people are simply reading a conversation, so the peer's presence
value froze at whatever the last fetch returned and aged past the 90-second
`USER_ONLINE_THRESHOLD_MS`.

**Measured**, one account signed in and heartbeating correctly the whole time —
five `PATCH /profiles` writes, exactly 60s apart, all 204:

| elapsed | peer's view of `online_at` | staleness | label |
| --- | --- | --- | --- |
| 20s | fresh at start | 22s | в сети |
| 60s | unchanged | 62s | в сети |
| 100s | unchanged | 104s | **был(а) 1 мин назад** |
| 200s | unchanged | 204s | **был(а) 3 мин назад** |

After the fix, same 200-second window: staleness peaks at 43-50s, bounded by the
60s heartbeat, and the label stays `в сети` throughout. A second device changes
nothing either way — two devices do not fight over `online_at`, they both simply
write it, and the database value was fresh in every one of these runs.

This is the other half of `17a4b3d`, which fixed `sameChatList` so a refetch
carrying only fresh presence is no longer discarded. A comparison can only help a
refetch that happens; here none did.

**Fixed** 2026-09-05, `artifacts/kub/src/lib/chatProfilePatch.ts`. The row was
already arriving — `profiles:chat:{chatId}` subscribes to every `profiles`
UPDATE and receives each peer's heartbeat — so this adds no subscription, no
polling and no request volume. Covered by
`tests/unit/chat-profile-patch.test.mts` and
`tests/e2e/multi-device-sync.spec.ts`.

**Not fixed:** presence still only refreshes while some chat is open, because
that is where the subscription lives. A sidebar left open with no chat selected
still ages out. And the margin is thin by design — a 60s heartbeat against a 90s
threshold — so a single missed beat still shows someone as away. Worth revisiting
together; neither is a two-device problem.

## D-044 to D-050 revisited, five closed and two left standing

Re-measured and fixed 2026-09-05, on `31a0568`, in both themes at 1440x900 and
390x844. D-053 below was raised in the same pass and is older than any of them.

All seven were re-measured on the current tree before anything was changed,
because the material stage landed text variants of three colours in between and
one of the seven could have closed itself. One had. The measurements below are
the product's pixels in both themes: the fictional capture fixture at
`/__qa/public-preview` where the surface is reachable without signing in, and
the signed-in application where it is not. Every contrast number is photographed
— the glyphs are made transparent with an injected `!important` rule keyed off
an attribute, the element's own box is screenshotted, and the PNG is decoded —
so blur, alpha and ambient are all inside it.

| finding | still alive on 2026-09-05 | before | after |
| --- | --- | --- | --- |
| D-044 | yes | white on `#45B7D1`, **2.35:1** | `#0B1220`, **7.98:1** |
| D-045 | yes | 91 rows carrying `.msg-appear` in one frame, 11 on screen, lowest opacity **0** | **0** in every frame of a prepend |
| D-046 | yes | 91 nodes still classed, `will-change: opacity, transform`, 6s after | **0** nodes |
| D-047 | yes | profile card 4/4 controls under 44px, settings 24/48 | **0/4** and **0/48** |
| D-048 | **no — closed itself** | — | `#FF6B6B` **5.31:1**, `#C11B1B` **6.09:1** |
| D-049 | yes, light theme only | `#3C8B3C` on the photographed header, **4.08:1** | needs a token; see below |
| D-050 | yes | scroller 390 → **24** → 390, `scrollHeight` 6,586 → **114,731** | 390 → **390** → 390, `scrollHeight` unchanged |

### D-044 `[x]` — the monogram takes the ink the palette was chosen for

`MessageActorAvatar` now calls `avatarInkFor(bgColor)`, like the two components
beside it. Measured on the same person in the same conversation, both themes:
`#FFFFFF` on `#45B7D1` was **2.35:1**, and `#0B1220` on it is **7.98:1**. The
palette's worst case moves from 1.19:1 to 6.75:1.

**How it survived a test written for exactly this.**
`tests/unit/avatar-monogram-contrast.test.mts` did scan for hardcoded white ink,
and it was green the whole time: it matched the class string
`rounded-full flex items-center justify-center font-medium`, and the third
component wrote the same classes in a different order —
`flex items-center justify-center rounded-full font-medium text-white`. A
class-order-sensitive anchor is a test of one component pretending to be a test
of a rule. The scan is now anchored on the palette call itself, counts the call
sites, and requires the same number of `avatarInkFor` sites, so a fourth
monogram cannot be added without being covered.

### D-045 `[x]` — a prepend is history, not an arrival

`advanceMessageEntrance` gained a notion of *where* an id turned up. The anchor
is the last id that was already on screen: anything after it arrived at the end
of the conversation, which is the only arrival a reader watches happen;
anything before it is history that has just been fetched, or a gap a jump has
filled in.

Measured on one prepend at 1440x900 in both themes, sampling every animation
frame for 9 seconds:

| | before | after |
| --- | --- | --- |
| rows | 100 → 200 | 100 → 200 |
| peak `.msg-appear` in one frame | **91** | **0** |
| of those inside the viewport | **11** | **0** |
| lowest opacity sampled | **0** | **1** |
| frames with a faded row | 1 of 541 sampled | 0 of 550 |

**A second defect fell out of the same reading, and it was worse.** The entrance
state is a `useRef` inside `MessageList`, and `MessageList` is not remounted
between conversations — there is no `key`, only a `layoutKey` prop. So `seen`
carried over: every message of the chat you opened *second* was an id that had
never been seen, and the whole history animated. `primed` could not catch this,
because it only knows whether *a* first pass has happened, not whether this is
the first pass of this conversation. The state now carries a `scope`, the list
passes the open chat's id, and a scope change re-primes. The idempotency cache
is keyed on the scope too: two conversations can render the same ids — a
forwarded message, a fixture, a chat cleared and refilled — and answering the
second from the first's cache would carry its entering set across with it.

One exception is deliberate: a chat that held no messages at all animates its
first one, because there was nothing for it to be different from.

### D-046 `[x]` — the hint is dropped where the stylesheet said it was

`MessageBubble` listens for `animationend`, checks the animation is `msg-appear`
and that it is its own rather than a child's, and sets a flag that takes the
class off. The flag only ever goes from false to true for the life of the mount,
which is also strictly better than what was there: a later render can no longer
put the class back and replay the fade on a bubble that had already settled.

Measured six seconds after the last animation ended, both themes: **91 nodes
carrying `.msg-appear` and `will-change: opacity, transform` before, 0 after.**

Under `prefers-reduced-motion: reduce` the rule sets `animation: none`, so no
`animationend` fires and the class stays — but that branch also sets
`will-change: auto`, so nothing is retained and there is nothing to drop.

### D-047 — closed on both rebuilt surfaces, open inside a message bubble

The rule is opt-in and lives in `index.css`; the answer is therefore more
classes, not a wider selector, and the classes are the ones that already exist.
`kub-icon-action` for an icon-only control, `kub-button` for a row or a text
button, `kub-field` for a box whose whole area is the target.

Measured at 390x844 with a coarse pointer, both themes:

| surface | before | after |
| --- | --- | --- |
| profile card | 4 of 4 controls under 44px | **0 of 4** |
| settings, all disclosures open | 24 of 48 | **0 of 48** |

The settings count excludes two kinds that the rule already answers as written
and that are reported separately rather than as misses: the hidden file input
behind «Сменить фото», which is not a target, and the four tick boxes, which the
rule gives a 24px box inside a 44px label. Everything else was opted in:
the card's title-bar controls and its action rows, every dialog's close button,
the avatar's camera badge, the three theme radios, the name/nickname/bio fields,
the three audio processing modes, the audio reset, the two volume sliders, the
five icon-only help triggers — 13x13, the smallest control the product had — and
the chat's back control, which is the only way back to the list on a phone.

Two of them needed more than a class:

- The card's title bar was `grid-cols-[2.5rem_...]`. A 44px control simply
  overflows a 40px track, so the tracks now size to what they hold: 36px on a
  pointer, 44px on a finger, without a second copy of the breakpoint.
- The three audio modes were written `min-h-9`. `index.css` now lives in
  `@layer components` and Tailwind's utilities are a later layer, so a `min-h-*`
  utility **outranks** `.kub-button { min-height: 44px }` and the touch minimum
  never applies. Measured: `kub-button min-h-9` came out 36px tall on a coarse
  pointer, exactly as if the class were absent. `h-9` is safe — it sets
  `height`, and the used height is the larger of the two. This is rule 10 of the
  material notes pointing the other way now that the layer exists, and it is
  asserted rather than remembered:
  `tests/unit/touch-target-system.test.mjs` fails any class list that pairs a
  touch class with a smaller `min-h-*`.

**Two controls were deliberately not changed, and both are inside a message
bubble**: the per-message actions button (20x20) and the read-receipt chip
(39.7x16). D-015 already ruled out the pseudo-element overlay for this rule —
two adjacent controls would end up with overlapping hit areas and steal each
other's taps, and these two are adjacent, two pixels apart — so the only option
is the real box, and the real box moves the conversation. Measured on the
fixture at 390x844, raising the chip alone to 44x44:

| | before | with the chip at 44px |
| --- | --- | --- |
| mean row height | 74.8px | **98.8px** |
| every row grew by | — | **24px** |
| conversation height, 8 rows | 718px | **832px** (+16%) |

That is a change to the density of the product's main surface, which is a design
decision and not a defect patch, so it is left for the owner to take. The long
press on the bubble opens the same menu meanwhile.

**Three more near misses were measured and not fixed**, being outside this
entry's list: the composer's attach, emoji and voice buttons at 40x40, and the
chat header's title button at 278x40.5. Each is four pixels short and each would
be a one-class change; none is recorded as a defect yet, and polishing by eye is
what this stage is not for.

### D-048 `[x]` — closed by the text tokens, with no change here

The marker at `SettingsModal.tsx` already reads `--kub-danger-text`, which
landed with the material stage for exactly this reason. Re-measured in the
signed-in settings screen at 390x844, photographed:

| theme | ink | ground | ratio |
| --- | --- | --- | --- |
| dark | `#FF6B6B` | `rgb(16,41,69)` | **5.31:1** |
| light | `#C11B1B` | `rgb(254,255,255)` | **6.09:1** |

The clip's first pixel row is the settings row's own border at `rgb(49,71,94)`
and carries no glyph; the asterisk's ink is on the surface. Recorded because a
worst-pixel reading over the whole box reports 3.45:1 and would send the next
person after a defect that is a 1px line.

### D-049 — measured, and waiting on one token

Still alive, light theme only, exactly as recorded. Photographed on the chat
header's own subtitle, `#3C8B3C` measures **4.08:1** — slightly worse than the
4.24:1 the entry recorded against pure white, because the header composites to
`rgb(248,251,254)` rather than to white. The dark theme measures **7.62:1** on
the same surface and **6.27:1** against the limiting composite, so it passes and
needs nothing.

The remedy is the one D-048 and the two colours before it used: the dot keeps
`--kub-online`, which answers 3:1 and meets it, and the word gets a variant.
Measured across every ground the colour lands on — the photographed header, the
limiting composite of a panel over the field a blur cannot see past, all six
surface tokens, and the veil, which is denser than the surface under it and is
what caught both existing text tokens five thousandths short:

| candidate | photographed header | limit `rgb(240,240,240)` | veiled panel row | worst |
| --- | --- | --- | --- | --- |
| `#3C8B3C` (today) | 4.08 | 3.72 | 3.30 | **3.30** |
| `#367E36` | 4.82 | 4.39 | 3.89 | 3.89 |
| `#317431` | 5.50 | 5.02 | 4.44 | 4.44 |
| **`#2E6E2E`** | 5.97 | 5.44 | 4.82 | **4.82** |
| `#276027` | 7.25 | 6.61 | 5.85 | 5.85 |

`#2E6E2E` is the smallest step along the same hue that clears 4.5:1 on every
ground the existing text tokens are held to. `#276027` additionally clears the
harsher case of `kub-glass` — the header's own fill, not the stronger one — over
a solid black field, which is reachable when a black photograph scrolls under
the header: 4.69:1 against `#2E6E2E`'s 3.86:1 there.

`index.css` belongs to someone else this week, so nothing was changed. What it
needs is `--kub-online-text: #4DCD5E` in `.dark` — deliberately the same value,
as `--kub-pink-text` is in the light theme, so call sites can be uniform — and
`--kub-online-text: #2E6E2E` in `.light`. Then `ChatHeader.tsx:251` moves to it,
and so do the six other places that paint `--kub-online` as words rather than as
a shape: `RegisterForm.tsx:240` and `:277`, `ChatInfoPanel.tsx:1943`,
`StorageSection.tsx:307`, `KubFeedbackViewport.tsx:22`,
`TaskDetailModal.tsx:736`, and the two invite tones in
`notificationPresentation.ts`. `KubIcon`, `KubBadge`, the status dot and every
fill keep `--kub-online`.

### D-050 `[x]` — the sheet is laid over the conversation, not beside it

`DOCKED_CLASS` positions the card `absolute inset-0` inside the chat pane, which
is already `relative`, instead of making it a flex child of the row the
conversation is in. The comment above it always said "a sheet over the
conversation, not a column beside it"; now the layout says so too.

Measured at 390x844 with 75 rows, both themes:

| | before | after |
| --- | --- | --- |
| scroller width | 390 → **24** → 390 | 390 → **390** → 390 |
| `scrollHeight` | 6,586 → **114,731** → 6,586 | 6,586 → **6,586** → 6,586 |
| tallest row while open | **4,786px** | **236px** |
| `scrollTop` | 5,868 → 5,868 | 5,868 → 5,868 |
| witness row top | 79 → 79 | 79 → 79 |

The section 11 contract held before and holds now — the drift was zero in both
cases; what has gone is the work. The card also stops being able to compress the
conversation into something the audit harness has to be taught to ignore.

### D-053 `[x]` — the support window's own timestamp, at 4.44:1 and 4.30:1

Raised outside the seven on 2026-09-05, and older than all of them: it has been
there since the window was built.

**Severity:** low. Every message in the support window, both themes.

**Surface:** `artifacts/kub/src/components/support/SupportWindow.tsx`, the
`text-[10px]` line under each bubble.

**Measured**, photographed at 10px on the fill the product paints:

| theme | ground | `--kub-muted` |
| --- | --- | --- |
| dark | `rgb(29,63,100)` | **4.44:1** |
| light | `rgb(208,223,237)` | **4.30:1** |

**It is the ink that changed, and the reason is that the ground cannot be fixed.**
A chat bubble is opaque, so its meta line sits on a token value and the muted
grey is guaranteed there — 5.91:1 and 4.80:1 on `--kub-message-out`. The support
window's bubbles are a wash over a panel that floats above whatever the
messenger happens to be showing. Every fill that would have rescued the grey was
measured, one at a time and always in the same place, and each failed:

| fill | dark, photographed | light, photographed | dark, limit | light, limit |
| --- | --- | --- | --- | --- |
| `--kub-cyan` 22% (today) | 4.44 | 4.30 | 3.98 | 3.86 |
| `--kub-message-out` | 5.91 | 4.80 | 5.91 | 4.80 |
| `--kub-cyan` 22% over `--kub-message-out` | 4.35 | 3.66 | 4.35 | 3.66 |
| `--kub-cyan` 12% | 5.15 | 4.93 | 4.51 | **4.42** |
| the veil, as support's own bubble wears it | 4.93 | 5.10 | **4.31** | 4.54 |

`--kub-message-out` passes and is the only one that does, because it is a token
and cannot drift with what is behind the window — and it composites to within
**1.01** of the window itself in the dark theme, which is a bubble nobody can
see. Weakening the cyan far enough to pass the limit in both themes (about 8%)
puts the bubble at 1.20 against the window, which is the same defect wearing a
different number. And the veil — what the *incoming* bubble already uses, which
is why only the outgoing one was reported — is 4.31:1 on that same worst ground,
so the grey is not guaranteed anywhere in this window.

So the timestamp takes `--kub-text`: **10.06:1** and **13.94:1**, measured on
the same bubble. A quieter dedicated token would read better and is the token
owner's call; nothing here needs one.

### Where the evidence is

The probes are in the ignored `output/d044-d050/`: `probe-fixture.mjs` (the
capture fixture, no sign-in, invented data), `probe-auth.mjs`, `probe-online.mjs`
(D-049's candidate sweep), `probe-support-candidates.mjs`,
`probe-bubble-cost.mjs` (what raising the in-bubble controls would cost) and
`mutate.mjs`. Screenshots and the decoded backdrops are under
`output/d044-d050/shots/`. Nothing in any of them carries a real conversation:
the fixture surface is `tests/fixtures/public-home-demo.json`, and where the
signed-in application was needed the glyphs are transparent in every picture
that was kept.

`mutate.mjs` is the proof the contracts are load-bearing. It compares the file's
SHA-256 before and after each substitution — not the presence of an anchor,
which reports a false "applied" on an insertion — and refuses to judge when the
anchor is not unique. Nine mutations, all caught: the monogram back to white
ink; every new id counted as an arrival again; the entrance state unscoped from
the chat; nothing taking the entrance class off; the card's action rows and the
chat's back control losing their touch class; a mode button back to the utility
that outranks it; the docked card back in the conversation's row; and the
support timestamp back to the muted grey.

### One pre-existing failure found on the way, and not touched

`tests/e2e/unified-interface-chrome.spec.ts:122` fails on this branch with a
strict-mode violation: `getByRole("button", { name: "Чистый голос" })` matches
both the audio disclosure row, whose accessible name includes the mode it
summarises, and the mode button itself. Confirmed pre-existing by reverting
`AudioSettingsSection.tsx` to `HEAD` and re-running — it fails identically — and
the file was restored to the same SHA-256 afterwards. It is a locator that
needs narrowing, not a product defect, and it belongs to whoever owns that spec.

## The Windows shell, walked for the first time since the redesign

Found 2026-09-06. The interface stage was verified in a browser; the Tauri
WebView2 shell is the second of the three shells and had not been walked.
Everything below was measured inside the real shell — WebView2 Runtime
**152.0.4191.62**, the debug build of `letscube-windows-tauri 0.2.11`, driven
over the harness's own loopback CDP port — and not in a browser standing in for
it.

The startup window and the overlay that continues its scene on the production
page are two copies of one design with no build step between them, so the only
thing holding them together is a test. Four of these five findings are what that
test was not reading.

## D-054 `[x]` The scene drops two pixels at the handoff, and the headline shrinks with it

**Severity:** medium. Every cold start of the Windows client, every account.

**Reproduction:** `pnpm.cmd windows:tauri:qa`. The `baseline` scenario fails at
`tests/e2e/windows-tauri-shell.spec.ts:208` —
`expect(overlayGeometry.snapshot).toEqual(geometry.snapshot)`, the assertion that
the two halves of the scene are the same scene. It has been in the spec since
`85bec05`, long before the redesign, and the redesign broke it.

**Surface:** `windows-tauri/ui/startup-overlay.css:247` before the fix, against
`windows-tauri/ui/startup.css:509`.

**Defect:** `466c4b2` raised the startup window's status line — "the one place
the eye should land first" — from 14px to 19px and gave it weight 620. The
overlay's copy of that line stayed at 14px. The two rules are two hundred and
fifty lines apart in two files, and nothing compares them.

**Measured** at 1360x860, both sides photographed in the same window in one run:

| | startup window | overlay |
| --- | --- | --- |
| status `font-size` | **19px** | **14px** |
| status `font-weight` | **620** | **400** |
| status `line-height` | 24px | 18px |
| status `margin-bottom` | 12px | 14px |
| state row height | **132px** | **128px** |

Those four pixels are the whole mechanism. The scene is
`grid-template-rows: 44px minmax(0, 1fr) auto` in both files and the handshake is
centred in the `1fr` band, so a state row four pixels shorter hands the band four
more pixels and moves everything centred in it down by half of them:

| | startup window | overlay | drift |
| --- | --- | --- | --- |
| `computer.top` | 328.5 | 330.5 | **+2** |
| `server.top` | 328.5 | 330.5 | **+2** |
| `seal.top` | 381.5 | 383.5 | **+2** |
| `clientPort.top` | 384.5 | 386.5 | **+2** |
| `serverPort.top` | 384.5 | 386.5 | **+2** |

`left`, `width` and `height` are identical on all five, which is what says the
cause is the row underneath rather than the assembly itself.

At the 640px minimum height the `@media (max-height: 720px)` block already put
both margins at 12px, so there the delta is the line height alone — six pixels,
three of drift. Wrong in both cases, and one rule.

**Consequence:** the last thing the startup window shows and the first thing the
overlay shows are the same sentence at two different sizes and two different
weights, and the assembly above it steps down as the page changes.

**Fixed** by giving `.startup-overlay-status` the startup window's metrics,
letterspacing included. Re-measured in the same way afterwards: drift `0` on all
five boxes, state-row delta `0`, and both status lines `19px / 620 / 24px / 12px`.
Measured again at the 960x640 minimum, where the `max-height` block moves the
margins on both sides and so is a different sum: state row **122px** against
**122px**, drift `0` on all five, and nothing clipped on either side.

## D-055 `[x]` The pane the scene stands on does not exist on the other side

**Severity:** medium. Same reproduction and the same moment as D-054, and the
larger half of it to look at.

**Surface:** `windows-tauri/ui/startup.css:209`, `.handshake::before`. There was
no counterpart anywhere in `windows-tauri/ui/startup-overlay.css`.

**Defect:** the startup window draws the handshake on a glass pane, and its own
comment gives two reasons that are both load-bearing: the band between the title
bar and the divider is taller than the 277px the endpoint column needs, so
without a container the surplus reads as ninety pixels of nothing under the
labels; and a translucent surface with no edge is not a surface, it is a lighter
patch of background. The overlay drew the same scene on nothing at all.

**Measured**, the same element on both sides:

| | startup window | overlay, before | overlay, after |
| --- | --- | --- | --- |
| handshake box | 980 x **277** | 980 x **662** | 980 x **277** |
| handshake `top` | 234.5 | 44 | 234.5 |
| pane behind it | `--glass-fill`, 20px radius, lit edge, shadow | **none** | the same four values |

Look at `output/windows-shell-audit/shots/01-startup-pending.png` beside
`05-overlay.png`: a panel with a rounded lit edge in the first, and in the second
the same drawing floating on the page. `after-01` and `after-05` are the pair
after the fix.

The 662 is why the pseudo-element could not simply be added. The overlay's grid
item was stretching to the full band instead of standing at its content height,
so a pane at `inset: -34px -44px` around it would have covered the title bar and
the status line — which is exactly the mistake `startup.css` records beside its
own `align-self: center`. Those two lines had to be copied first, and the pane
after them.

## D-056 `[x]` Three copies of the material, three different answers

**Severity:** medium. Every surface of the Windows startup screen and of the
overlay, against the application they hand over to.

**Surface:** `artifacts/kub/src/index.css:404` (`.dark`),
`windows-tauri/ui/startup.css:75` and `windows-tauri/ui/startup-overlay.css:44`,
all before the fix.

**Defect:** `windows-tauri/ui` is served as-is with no build step, so it cannot
import the application's stylesheet and the tokens are copied by hand. Both files
say so at the top, and the overlay adds that its four values are "the same four
values as startup.css". Neither claim was true, and the application was a third
answer again.

**Measured** — read back from `getComputedStyle` in the running WebView2, not
only from the files:

| token | `index.css` `.dark` | `startup.css` | `startup-overlay.css` |
| --- | --- | --- | --- |
| `--glass-fill` | `rgba(17, 43, 71, 0.46)` | `rgba(11, 33, 58, .56)` | `rgba(17, 43, 71, .70)` |
| `--glass-fill-strong` | `rgba(17, 43, 71, 0.96)` | `rgba(8, 22, 41, .86)` | `rgba(17, 43, 71, .96)` |
| `--glass-line` | `rgba(255, 255, 255, 0.10)` | `rgba(255, 255, 255, .09)` | `rgba(255, 255, 255, .14)` |
| `--glass-blur` | `blur(20px) saturate(122%)` | `blur(18px) saturate(122%)` | `blur(18px) saturate(122%)` |

Three fills on two different base surfaces, a lit edge at three weights, and two
blur radii. `--glass-fill-strong` is the one the startup window had furthest
wrong: `--kub-surface` where the other two use `--kub-surface-3`, and in this
theme `--kub-surface` is the darker of the two, so a covering surface there read
as a recess in the panel it opened over. That is the failure the `@supports`
fallback note in `index.css` describes, arriving by a different road.

**Fixed** by copying the application's values verbatim into both files.
`--glass-shadow` came with them: it was spelled `rgb(0 0 0 / .9)` in the shell
and `rgba(0, 0, 0, 0.9)` in the application — one colour, two spellings — and a
copy checked by string comparison cannot afford either spelling to be a matter of
taste. Photographed afterwards at 1360x860: the startup window's pane is still
plainly a pane at the quieter fill, and the two scenes now show the same one.

## D-057 `[x]` The test that guards those copies never read the material

**Severity:** medium, and it is the reason D-056 could exist.

**Surface:** `tests/unit/tauri-shell.test.mjs:47`, the pattern inside
`collectTokens`:

```
/(--(?:kub|brand|app)-[a-z0-9-]+)\s*:\s*([^;]+);/g
```

**Defect:** the test is called "the startup scenes carry the application's
tokens" and it compares every token whose name it recognises. It recognised
`--kub-`, `--brand-` and `--app-`. The four values that decide what the surfaces
are made of are named `--glass-`, so the palette was guarded and the material was
not.

**Proved by mutation**, comparing the file's SHA-256 before and after each
substitution as rule 9 requires — `output/windows-shell-audit/mutate.mjs`, which
refuses to judge when the anchor is not unique and restores the file afterwards:

| mutation | sha before → after | suite, before | suite, after |
| --- | --- | --- | --- |
| `--kub-surface-2` in `startup.css`, one digit | `22b754baa583` → `05107a2eba3a` | **fail** | fail |
| `--glass-fill` in `startup.css` → opaque red | `22b754baa583` → `24b656f6a129` | **pass** | fail |
| `--glass-line` in `startup-overlay.css` → opaque green | `fd09076f7dd4` → `ae547025cbc2` | **pass** | fail |
| `--glass-blur` in `startup-overlay.css` → `blur(0px)` | `fd09076f7dd4` → `3cd09def6f80` | **pass** | fail |

Three of those four are changes a person would see from across the room, and the
suite reported success on all three.

**Fixed** by adding `glass` to the prefix alternation. One thing had to move with
it: `--glass-shadow` is three shadows on three lines, so the captured value now
has its whitespace collapsed before comparison — newlines and the indentation
after them are not part of a value, and without that the test would fail on
formatting instead of on drift.

## Measured in the Windows shell, and not a defect

Recorded because an absence of findings is only worth something if it says what
was actually looked at.

- **`backdrop-filter` is supported, and it really composites.** In WebView2
  152.0.4191.62 `CSS.supports("backdrop-filter: blur(1px)")` is `true` and
  `CSS.supports("not (backdrop-filter: blur(1px))")` is `false`, so the opaque
  fallback in `index.css` does not fire. It is not merely declared either: the
  pixels under the chat header change when the conversation scrolls beneath it,
  which a declared-but-inert filter could not do. Note that the **prefixed**
  property is *not* supported here — `-webkit-backdrop-filter` is `false` — so
  the `-webkit-` line in `.kub-glass` is inert in this engine and the unprefixed
  one is what carries the behaviour. Rule 9's trap about a bare property name
  also matching its vendor prefix therefore cannot be papered over by the prefix
  doing the work.
- **Chrome overlays content, and the compensation is exact.** Signed in, at
  1360x860: the scroller runs the full height of the pane (`top: 44`,
  `height: 816`) with the header's box at `top: 44, height: 56` over it,
  `listRunsBehindHeader: true`, and `padding-top: 64px` /
  `scroll-padding-top: 64px`, `padding-bottom: 94px` /
  `scroll-padding-bottom: 94px` — padding and scroll-padding equal on both sides,
  which is the half of rule 2 that breaks silently.
- **The conversation is visible through that chrome.** Photographed the header
  strip, 960x56, before and after a real wheel gesture, with every glyph in the
  document made transparent first: **16.1%** of the strip's pixels changed by
  more than 2/255. It is a faint effect in the light theme — worst channel delta
  **4**, mean **1** — but that is `--glass-fill` at `rgba(255, 255, 255, 0.80)`
  admitting a fifth of the backdrop, a property of the token in any engine and
  not something WebView2 does differently. The dark theme, at `0.46`, admits more
  than half.
- **Scrolling is not broken by the overlaying chrome.** A wheel gesture over the
  pane moved the list **1320px** upwards (`scrollTop` 4315 → 2995) and it stayed
  there, `scrollHeight` unchanged at 5131. An earlier measurement that assigned
  `scrollTop` directly saw no change in the pixels; that was the probe's fault,
  not the product's, and it is worth recording because the wrong method here
  manufactures a defect that is not there.
- **The focus ring reaches everything, the window controls included.** Fourteen
  Tab steps across the startup screen — version pill, the three window controls,
  both fingerprint blocks, both devices, the four stage labels — and every one
  matches `:focus-visible` and computes `2px solid rgb(77, 139, 208)`, which is
  `--kub-cyan`. The window controls carry `outline-offset: -2px` where the
  application uses `+2px`, and deliberately: they sit flush against the window
  edge, where an outset ring would be cut off by it.
- **Nothing on the startup screen clips.** Measured the width of every element's
  own text runs — a `Range` over its direct text nodes, so a hint tooltip inside
  an element is not mistaken for its overflow — against the element's content
  box, at 1360x860 and at the 960x640 minimum, in all four states the screen can
  reach: pending, verified, changed, failed. **Zero** offenders at either size,
  and the document never overflows its window. A cruder detector that read
  `scrollWidth` reported the override button in the `changed` state as four
  pixels over; that was its tooltip, and it is noted so the number is not
  rediscovered as a defect.
- **The type raise's premise is inverted on this screen, and it leaves slack
  rather than deficit.** The startup window cannot load Inter — its CSP is
  `default-src 'self'` and there is no font beside it — so it renders in the
  Windows stack while the application, and therefore the overlay, gets Inter from
  the network. Measured on the production page, where both faces are available,
  Segoe UI is **narrower** than Inter for this screen's Cyrillic, by 5% to 10%:

  | string | size | Inter | Segoe UI | ratio |
  | --- | --- | --- | --- | --- |
  | Продолжить — отпечаток не подтверждён | 11.5px | 199.66 | 183.88 | 0.921 |
  | Открываем рабочее пространство | 19px | 325.50 | 302.62 | 0.930 |
  | Оболочка LETSCUBE | 12px | 123.23 | 111.29 | **0.903** |
  | Сертификат узла изменился | 12.5px | 173.76 | 160.24 | 0.922 |

  So a label that fits in the browser cannot fail in this shell for want of room.
  If anything fails it is the other direction — the overlay is laid out with the
  startup window's constants and set in the wider face — and that was measured
  too: **zero** clipped labels in the overlay, at 1360x860 and at 960x640.

  The scene does therefore change typeface at the handoff, and that is a real
  discontinuity, but it is one the CSP decides and not one a stylesheet can fix.
  It is left standing, named here so it is not rediscovered as a mystery.
- **The 12px floor stops at `artifacts/kub`.** The startup screen still sets
  10px, 11px and 11.5px in fourteen places. It was outside the 203 that moved, it
  has its own scale, and nothing on it clips — so this is a scope boundary rather
  than a defect. Worth knowing that "the one 11px left in the product" in
  `index.css` is true of the application and not of the shell.

## One failure outside the interface, found on the way and not touched

`pnpm.cmd windows:tauri:qa:storage` passes all four of its phases and then its
own post-run check reports:

```
[FAIL] the second move did not carry 8 of 154 non-cache file(s):
EBWebView/Default/Extension State/LOCK,
EBWebView/Default/Local Storage/leveldb/LOCK,
EBWebView/Default/Network/Cookies,
EBWebView/Default/Session Storage/LOCK,
EBWebView/Default/shared_proto_db/LOCK
```

Seven of the eight are lock files and the eighth is the cookie store. The same
run's measurements line then says the second relocation carried all 154 non-cache
paths, so the two statements disagree and one of them is wrong. This is the
profile relocation path rather than the interface, it reproduces on a clean tree
before any change here, and it belongs to whoever owns
`scripts/windows-tauri-storage-suite.mjs`. Recorded because it was observed;
nothing about it was changed.

**Closed on 2026-09-06. Neither statement was a measurement of what it claimed,
and the files were never lost.** `inventory()` hashed every file it listed and
silently dropped the ones it could not open, so "not readable at this instant"
and "not on disk" were the same answer. WebView2 holds exactly eleven files
unshared for as long as it runs — nine leveldb `LOCK`s, `Network/Cookies` and
`Network/Cookies-journal` — and `verify` ran 500ms after a `taskkill` without
ever checking that the engine had let go, while `prepare` had always waited for
it. Measured against a live profile: 174 paths on disk, the old reading reports
`163 of 174 arrived and 11 did not` naming that family, every one of the eleven
present on disk, and all eleven readable again 264ms after the process dies. The
note beside it was unconditional prose — `all ${owed.length} … arrived` was
pushed whatever the check had just found, so it could not be false and said
nothing. Fixed in the harness: an inventory now records a file it can see but
cannot read and marks it, every phase settles the whole data root before it
measures, and each move is read once by `arrival()` which words both the failure
and the note. The suite passes 6/6 phases with `all 154 non-cache paths arrived`.

## Where this evidence is

The probes are in the ignored `output/windows-shell-audit/`: `launch.mjs`, which
owns a throwaway WebView2 profile and a loopback CDP port the way
`scripts/windows-tauri-qa.mjs` does; `probe-handoff.mjs`,
`probe-startup-frame.mjs`, `probe-type-fit.mjs` and
`probe-glass-over-content.mjs`, each writing its JSON beside it; and
`mutate.mjs`. The screenshots are under `shots/`.

No production conversation is in any of it. The startup screen and the overlay
carry no account data at all, and the certificate digests in those pictures are
invented — the probes generate their own and hand them to `window.renderStartup`,
because a real fingerprint has no business in a report. The one probe that needed
the signed-in application makes every glyph in the document transparent and hides
every raster before it photographs anything, so the strips it compares hold the
shape of surfaces and nothing readable.

## The Android shell, walked for the first time since the redesign

Walked 2026-09-06 on a Realme RMX3830, Android 15, API 35, WebView
Chrome/137.0.7151.72, screen 720x1600 at density 320 — a **360 x 748 CSS px**
viewport at `devicePixelRatio` 2. Debug APK built from `20feafc` by
`pnpm.cmd android:build:production:debug`, installed over `adb`, signed in on
the QA owner account so every conversation in this section is synthetic. Geometry
and computed styles were read over CDP against the live WebView
(`adb forward` to `webview_devtools_remote`); every screenshot is
`adb exec-out screencap`, so what is photographed includes the system bars and
the real IME.

**The viewport is the finding behind three of the five.** The release matrix
stops at `chromium-mobile-390`; this phone is 360, and 360 is the most common
Android width there is. Nothing below 390 has ever been looked at.

Two things measured clean and are recorded here so they are not re-checked:
`CSS.supports("backdrop-filter", "blur(1px)")` is **true** in this WebView, so
the `@supports not (backdrop-filter: blur(1px))` fallback of rule 6 stays dormant
and does not fire falsely — note that the *prefixed* property is the one that is
absent here, which is the opposite of the trap rule 9 records. And
`env(safe-area-inset-*)` resolves to `0px` on all four sides **correctly**:
Capacitor insets the WebView above the system bars rather than going
edge-to-edge, `innerHeight` is 748 against an 800px screen, and the app never
draws under the status or gesture bar. The absent `viewport-fit=cover` in
`artifacts/kub/index.html` therefore costs nothing on this shell.

## D-058 `[x]` The keyboard takes the newest 266px of the conversation, and nothing takes them back

Found 2026-09-06, first thing, on the most ordinary action a messenger has:
tapping the composer to reply.

**Severity:** high. Every chat, every Android device, every time the keyboard
opens.

**Surface:** `artifacts/kub/src/components/chat/MessageList.tsx:641-658` — the
`ResizeObserver` that keeps the conversation pinned to the bottom observes
`contentRef`, the message column. The other re-pin, the layout effect at
`:639`, is keyed on `bottomInset`, `topInset` and `layoutVersion`.

**Defect:** on Android the WebView **resizes** when the IME opens. Nothing the
existing mechanisms watch changes:

| | keyboard closed | keyboard open |
| --- | --- | --- |
| `window.innerHeight` | 748 | **482** |
| `visualViewport.height` | 748 | 482 |
| computed keyboard inset | 0 | **0** |
| `--kub-composer-height` | 70px | 70px |
| `--kub-chat-chrome-height` | 56px | 56px |
| content `scrollHeight` | 4467 | 4467 |
| scrollport `clientHeight` | 748 | **482** |

The keyboard inset in `ChatWindow.tsx:173-196` correctly stays at `0`, because
`innerHeight - visualViewport.height - visualViewport.offsetTop` is genuinely 0
when the layout viewport itself shrank — the composer is already above the
keyboard and needs no padding. The composer's height does not move, so
`layoutVersion` does not change. The content's height does not move, so the
`ResizeObserver` never fires. **The one box that changed is the scrollport, and
nothing observes it.**

What follows is arithmetic. `scrollTop` is left at 3719 while the maximum rises
from 3719 to 3985:

| | closed | open |
| --- | --- | --- |
| `scrollTop` | 3719 | 3719 |
| max `scrollTop` | 3719 | 3985 |
| distance from bottom | **0** | **266** |
| newest bubble, against the composer's top edge | −23.9 (clear) | **+242.1 (behind it)** |

266 is exactly `748 − 482`: the reader loses the keyboard's own height of the
newest conversation. Reproduced 2/2 on clean open/close cycles with identical
numbers, and it does not settle — re-read 40s later, unchanged.

**It closes correctly, and that is the whole mechanism.** Growing the viewport
back clamps `scrollTop` down to the new maximum, which happens to be the bottom,
so dismissing the keyboard looks right and hides the asymmetry: shrinking leaves
a still-valid `scrollTop` alone, growing is forced to move it.

**No affordance is offered.** `scrollTop` never changes, so no `scroll` event
fires, so `isAtBottomRef` is still `true` and the scroll-to-bottom button — which
does appear normally, confirmed by scrolling by hand in the same session — is not
rendered. Nine visible buttons in the chat at that moment, none of them a way
back down.

It also does not reliably self-correct. Typing a single character left it at 266
(draft length 1, textarea focused, distance from bottom still 266). Anything
that *does* resize the content afterwards re-pins it, and because
`isAtBottomRef` was never falsified the correction arrives as a 266px lurch
rather than as a restoration.

**Consequence:** the reader taps the composer to answer a message and that
message, with the two before it, goes behind the keyboard. Screenshots:
`04-keyboard-open.png` is the defect, `05-keyboard-alt.png` the same chat and the
same keyboard with the list where it should be.

**Fixed** in `MessageList.tsx` by observing the scrollport as well as the
content, on its **border box**, inside the observer that was already there. The
guard is deliberately the one that already existed — `isAtBottomRef.current ||
isInitialBottomLocked()` — because the whole distinction the fix has to keep is
already written down in it: a reader who was at the bottom is put back at the
bottom, a reader who was up in the history is left where they are.

Border-box rather than content-box: the scrollport's padding carries
`bottomInset`, which is the composer's measured height, and a layout effect keyed
on that already handles it. A content-box observation would fire a second time
for every composer resize and add nothing.

**Measured on the device with the real IME**, same phone, same chat, same tap on
the composer:

| | closed | open, before | open, after |
| --- | --- | --- | --- |
| `window.innerHeight` | 748 | 482 | 482 |
| `visualViewport.height` | 748 | 482 | 482 |
| computed keyboard inset | 0 | 0 | 0 |
| `--kub-composer-height` | 70px | 70px | 70px |
| content `scrollHeight` | 4467 | 4467 | 4467 |
| scrollport `clientHeight` | 748 | 482 | 482 |
| `scrollTop` | 3719 | 3719 | **3985** |
| max `scrollTop` | 3719 | 3985 | 3985 |
| distance from bottom | 0 | **266** | **0** |
| newest bubble against the composer's top edge | −23.9 | **+242.1** | **−23.9** |

The newest bubble keeps exactly the clearance it had with the keyboard closed.
Re-verified on the final build against a longer loaded history — 200 rows,
`scrollHeight` 11328 — where `scrollTop` moves 10580 to 10846, which is the same
266.

**And the other half, also on the device.** Parked in the history at `scrollTop`
206 with the scroll-to-bottom button offered, the keyboard was opened: `scrollTop`
206 afterwards. The reader who did not ask to move was not moved. (The button is
labelled `К последним сообщениям`; the first pass of this measurement looked for
the wrong label and reported it absent — it is present whenever the reader is
away from the bottom, which is exactly why its absence in the defect state was
the symptom worth recording.)

**Guarded** by `tests/e2e/chat-entry-scroll.spec.ts`, which shrinks the viewport
height with the width held fixed — nothing rewraps, the content keeps its height,
only the scrollport loses some, which is the mechanism — in two tests, one for
each side of the contract. Proven by mutation: deleting the single
`observer.observe(scrollport, ...)` line (SHA-256 `3ce4381…` to `cce2727…`) fails
it with `the reader was left 266px from the bottom after the viewport shrank`.
The source-level half is in `tests/unit/message-history-anchoring.test.mjs`.

**One thing the browser hid, and it is worth knowing.** Measured inside the
4200ms entry lock the defect looks self-correcting: sampled every frame, the list
really did sit 266px out and one of the lock's settle timers pulled it back 432ms
later. The e2e tests wait the lock out for that reason. On the device, where the
reader has been in the chat longer than four seconds, nothing corrects it — the
original report of "does not settle, re-read 40s later, unchanged" is what a real
reader gets.

## D-059 `[x]` The light theme cannot be shown on a phone that is in night mode

Found 2026-09-06 while photographing both themes on the device.

**Severity:** medium-high. Any account that prefers light while the phone is
dark, which is a combination the app's own theme control offers.

**Surface:** `android/app/src/main/res/values/styles.xml` — `AppTheme` descends
from `Theme.AppCompat.DayNight.DarkActionBar`, and nothing anywhere calls
`WebSettingsCompat.setAlgorithmicDarkeningAllowed(settings, false)`.

**Defect:** with `kub-theme` set to `light` the document is correct in every way
the page can be correct — and the pixels are not the light theme.

| | declared | photographed |
| --- | --- | --- |
| root class | `h-full light` | — |
| `data-theme` | `light` | — |
| `:root { color-scheme }` | **`light`** | — |
| `body` background | `rgb(233, 239, 246)` | **`rgb(21, 22, 23)`** |
| `meta[theme-color]` | `#E9EFF6` | — |

Measured from the photographed pixels the way rule 7 requires, sampled at three
separate points of bare page ground: `rgb(21,22,23)` at all three. The hue is
gone — R, G and B within 2 of each other — which is the signature of WebView
algorithmic darkening rather than of any fill this product defines. The dark
theme photographs `rgb(10,26,48)` against its `#050B18` token in the same
places, above its token because of `--kub-ambient` and still unmistakably blue.

**The page already does the standards-correct thing and is overridden.**
`themeRuntime.ts:38` and the `index.html` bootstrap both set
`root.style.colorScheme`, and the device confirms the computed value is `light`.
That is precisely the declaration that *invites* algorithmic darkening: a page
claiming support for light only, on a night-mode system, with the activity on a
DayNight theme, is the documented case WebView darkens. A page declaring
`light dark` is left alone — which is why the dark theme renders correctly and
only the light one is wrong.

The result is a third appearance belonging to neither theme, and it is not
uniform: avatar fills come through untouched (`rgb(187,143,206)` identical in
both themes at the same point) while the surfaces around them invert, so the
palette the register's contrast work is measured against is not what is on the
glass. **Every light-theme contrast figure in this document is unverified on
this shell.**

**Consequence:** the light theme is unreachable on a night-mode phone, and the
darkening is silent — nothing in the DOM says it happened.

**Fixed** in `MainActivity.java`. The call was not missing: it was there, passing
`true`, under a comment reasoning that "the platform only applies its own
darkening to content that has no dark styles of its own, and this app has them".
That is true of the app and false of one of its two themes — a page declaring
`color-scheme: light` is claiming support for light only, which is precisely the
case WebView darkens. It now passes `false`.

Nothing is lost by refusing. The flag does not decide what `prefers-color-scheme`
reports — that follows the activity theme's `isLightTheme`, and the theme is
still `DayNight` — and the page does not trust that query anyway: measured on
this phone, `matchMedia("(prefers-color-scheme: dark)")` is **false** while the
phone is in night mode, both before and after, which is why `publishNightMode`
exists and why the bootstrap reads `letscube:night` instead.

**Photographed on the device**, phone in night mode throughout (`cmd uimode
night` reported `yes` before and after and no Android setting was changed),
`kub-theme` set to `light`, six identical screen points:

| | declared | photographed, before | photographed, after |
| --- | --- | --- | --- |
| root class | `h-full light` | — | — |
| `:root { color-scheme }` | `light` | — | — |
| `body` background | `rgb(233, 239, 246)` | **`rgb(21, 22, 23)`** | **`rgb(250, 252, 254)`** |
| hue spread (max − min channel) | — | **2** | 4 |

**And the light theme's contrast, re-measured on this shell** the way rule 7
requires — text made transparent, the page's own composited pixels decoded,
worst of three points across each text box:

| | light | dark |
| --- | --- | --- |
| message text on its bubble | **18.94:1** | — |
| date separator, `--kub-muted` on the chat wallpaper | **4.86:1** | **7.86:1** |

The wallpaper composites to `rgb(233, 239, 246)` in the light theme and
`rgb(6, 12, 26)` in the dark one, which is the product's own palette rather than
the third appearance the darkening produced. The register's earlier note that
"every light-theme contrast figure in this document is unverified on this shell"
is lifted for these; the rest of the light-theme figures were taken in a browser
and are now measurable here, but were not all re-walked in this pass.

**A measurement trap found doing this, recorded so it is not paid for twice.**
`adb exec-out screencap` is the whole 720x1600 screen and includes the status
bar, so a CSS coordinate multiplied by the device pixel ratio lands about 72px
above where it belongs. The error is silent and it produced a full table of
identical readings — four different chip fills, an opaque one among them, all
returning the same wallpaper pixel — which is the only reason it was caught. For
sampling inside the page, capture the page's own viewport and read the scale back
from the image. A real screencap stays the right instrument for anything the
platform does to the page after it is composited, which is what this entry is.

## D-060 `[x]` Justified bubbles open 30px rivers at the width the phone actually has

**Severity:** medium. Every wrapped message, worse the narrower the device.

**Surface:** the bubble text carries `[text-align:justify]` with
`hyphens: manual`, so Russian prose is justified and never hyphenated.

**Defect:** justification distributes the slack into the word spaces, and a
283.6px column has little else to give. Measured on one message, per rendered
line, with a `Range` over the text node — the natural space in this font at this
size is **3.94px**:

| viewport | bubble width | worst word gap | ×natural |
| --- | --- | --- | --- |
| **360 (this phone)** | 283.6px | **30.54px** | **7.76** |
| 390 (narrowest tested) | 309.4px | 18.53px | 4.71 |
| 412 | 328.3px | 13.71px | 3.48 |

Same message, same engine, same fonts — only the width differs, using CDP metric
override so nothing else can account for it. The worst line is the one carrying
a long unbreakable token, but the natural-prose lines of the same message reach
**18.04px (4.58×)** at 360 on their own, so this is not an artefact of the QA
fixture's identifiers.

Visible in `07-state.png` and `08-search-jump.png` as the rivers running down
"QA-HISTORY 1085 — длинное сообщение…".

**Consequence:** the narrowest viewport ever tested understates the worst gap by
65%, and justification without hyphenation is doing the opposite of what it was
chosen for at the width most Android phones have.

**Fixed** by removing the justification. `shouldJustifyOrdinaryText` and the
`[text-align:justify] [text-align-last:start]` pair are gone; message text is
start-aligned. Not a breakpoint, because there is no width at which it behaves —
re-measured on the DEV preview fixture with a `Range` over every rendered word,
on one message chosen to be harsher than the one above:

| viewport | bubble | worst gap, before | × natural | after |
| --- | --- | --- | --- | --- |
| 360 | 275.9px | 63.58px | 16.15 | **3.92px (1.00)** |
| 390 | 305.9px | 52.00px | 13.21 | **3.94px (1.00)** |
| 412 | 327.9px | 47.55px | 12.08 | **3.92px (1.00)** |
| 640 | 481.9px | 22.78px | 5.79 | **3.94px (1.00)** |
| 768 | 249.9px | 39.94px | 10.14 | **3.94px (1.00)** |
| 1440 | 537.9px | 19.08px | 4.85 | **3.94px (1.00)** |

768 is narrower than 640 because the sidebar appears there and the bubble loses
the room. The widest bubble the product can draw still opened gaps nearly five
times a space, so a breakpoint would only have moved the defect to a viewport
nobody photographs.

**On the device, after:** the worst gap over the fourteen wrapped messages on
screen is **3.94px, 1.00×**, against **30.16px, 7.66×** on the same phone and the
same conversation before.

**Guarded** by `tests/unit/narrow-phone-typography.test.mjs`.

## D-061 `[x]` The six bottom tabs are closer together than the space in their own font

**Severity:** low. Every Android phone 360px wide or narrower; cosmetic, and it
reads as one run of words.

**Surface:** the bottom tab bar's six labels at 12px, `600` weight,
`letter-spacing: 0.3px`, uppercased.

**Defect:** the items are flex children that shrink to fit, so at 360 the labels
end up adjacent rather than clipped:

| viewport | narrowest gap between two labels | narrowest item |
| --- | --- | --- |
| **360 (this phone)** | **3.2px** | 44.6px |
| 390 | 9.0px | 48.0px |
| 412 | 13.2px | 50.5px |

A space character in that exact font at that exact size measures **3.02px**. The
gap between "ЗАДАЧИ" and "АДМИНКА" is **1.06 spaces** — narrower than the gap
between two words of one sentence, which is why `02-after-login.png` reads
"ПРОФИЛЬ ЗАДАЧИ АДМИНКА" as a single phrase.

The touch targets themselves still clear the floor — 44.6px is the narrowest,
against the 44px rule — but only by 0.6px.

**The mechanism is flex shrink, and it is worth naming.** The six buttons' base
sizes summed past the row, so they were compressed — and a compressed flex item
keeps its padding while its content box collapses, so the labels spilled out of
their own buttons and ended up nearer to each other than the padding should ever
have allowed. Measured at 360, in a 344px row: the labels total **314.1px** as
shipped, which leaves 29.9px for six buttons' worth of `px-2`, or 96px of
padding that cannot be paid.

**Fixed** by making them fit: `px-1` instead of `px-2`, `text-[11px]` instead of
`text-[12px]`, and no `tracking-wide`. The labels then total **278.5px** and the
padding survives, which is what puts a floor under the gap that free space cannot
take away. The uppercase tab voice, the icon size and the 44px minimum are
unchanged.

**Measured on the device**, and the same numbers in a browser at the same widths:

| viewport | narrowest label gap, before | after | in spaces | narrowest item |
| --- | --- | --- | --- | --- |
| **360** | **3.18px** | **10.27px** | 0.95 → **3.71** | 44.6px → 44.0px |
| 390 | 9.00px | 15.25px | 2.70 → 5.49 | 48.0px → 44.0px |
| 412 | 13.28px | 18.92px | 3.99 → 6.81 | 50.5px → 44.0px |

No label overflows its button at any of the three widths any more. The narrowest
touch target is 44.0 x 48.5px, still over the floor — the items are narrower
because the labels are, and `min-w-[44px]` is what they now rest on rather than
something they happened to clear.

**Guarded** by `tests/unit/narrow-phone-typography.test.mjs`, which holds the
padding, the size and the tracking, and also the label set itself: a seventh tab
or a longer word breaks the same fit from the other side, so the 34 characters
that were measured to fit are asserted too.

## D-062 `[x]` Four blurs ride inside the scrolling conversation

**Severity:** low, and a contract violation regardless of the number.

**Surface:** all four inside `<div ref={contentRef}>`, the scrolled content, in
`MessageList.tsx`: the system-message pill (`:104`), the history loading band
(`:822`), the date separator (`:887`) and the unread separator (`:894`). Each
writes `backdrop-blur-sm` or `backdrop-blur` as a Tailwind utility.

**Defect:** two rules at once. Rule 1 — the material is written by hand rather
than taken from `.kub-glass`. Rule 6 — "message bubbles, list rows, feed cards:
the chrome around them, yes; the content, no", and a date separator repeats once
per day of history.

**Measured**, on the device, with `dumpsys gfxinfo` across an identical set of
eight flings over the same conversation:

| | janky | 50th | 90th | 95th | 99th | slow draw cmds |
| --- | --- | --- | --- | --- | --- | --- |
| as shipped (7 blurs live) | 3.21% | 16ms | **21ms** | 25ms | 34ms | 28 |
| in-list blur off (6 live) | 2.46% | 15ms | 19ms | 22ms | 28ms | 22 |
| all blur off (0 live) | 0.88% | 11ms | **13ms** | 14ms | 20ms | 6 |

Only **one** in-list blur was on screen — this conversation spans a single day —
and removing it moved the 90th percentile 2ms of the 8ms the whole material
costs. So the rule-6 violation is real and small; what the table actually shows
is that **the chrome glass costs 6ms of the 8ms**, and that the 90th percentile
as shipped sits at 21ms against a 16.7ms frame budget while without the material
it sits at 13ms.

GPU time barely moves (90th: 6ms against 5ms). The cost is on the UI thread —
"slow issue draw commands" 28 against 6, "slow UI thread" 15 against 1 — which is
layer management, not fill rate.

**Not a first-order performance defect.** 3.21% janky is a smooth list, and
nothing in the flings dropped a visible frame. Recorded because the contract is
explicit, because the four sites are cheap to move onto the utilities, and
because the 21ms figure is the honest cost of the material on a mid-range phone
and should be known before anything is added to it.

**Fixed** by removing the four blurs. The hand-mixed fills went with them and
the chips are carried by their borders — `--kub-border-color`, and its pink form
on the unread separator, which is what carried them before as well: 75-82% of the
ground composited over the ground is the ground.

**`.kub-raise` was the obvious replacement and it is wrong here.** The veil is
the right idea — one step above whatever it is laid on, rule 5 — but on a light
ground it steps DOWN, and `--kub-muted` is not far enough from the page to pay
for that. Photographed on the device, text made transparent, worst of three
points across the separator's text box:

| fill under the date separator | light backdrop | light | dark backdrop | dark |
| --- | --- | --- | --- | --- |
| as shipped, `--kub-bg` at 75% | `rgb(233, 239, 246)` | 5.00:1 | `rgb(6, 11, 25)` | 8.05:1 |
| `.kub-raise` | `rgb(219, 226, 235)` | **4.30:1** | `rgb(24, 29, 42)` | 6.68:1 |
| none, the border alone | `rgb(233, 239, 246)` | **4.86:1** | `rgb(6, 12, 26)` | 7.86:1 |

Rule 10's lesson arriving in a new place — a fill that finally renders can still
be the wrong one — and its answer is the same one the ops-report callouts got:
drop the fill, keep the border, which costs nothing and carries the same signal.
The 0.14 between 5.00 and 4.86 is the wallpaper's dot grid showing through where
the old fill dimmed it; both clear the floor.

**Measured on the device again afterwards**, eight identical flings over the
same conversation, three runs each side, medians:

| | janky | 50th | 90th | 95th | 99th | slow UI thread | slow issue draw |
| --- | --- | --- | --- | --- | --- | --- | --- |
| before | 5.25% | 16ms | 21ms | 25ms | 36ms | 18 | 37 |
| after | **2.43%** | 17ms | **20ms** | **21ms** | **27ms** | **8** | **17** |

The absolute figures differ from the table above because the fling is a harder
one — same gesture on both sides, which is what makes them comparable. The
direction and the size agree with the original measurement: the in-list blur is
a small, real cost, the 90th percentile barely moves, and what actually improves
is the tail. Run-to-run spread is wide (4.03-5.26% before, 1.43-4.87% after), so
the medians are the honest number and a single run is not.

**Guarded** by `tests/unit/shell-glass.test.mjs`, per chip, found by the
landmark on its wrapper rather than by a line number.

## D-063 `[x]` Every action on the confirmation screen is under the fold at 360

**Severity:** medium. Every phone 360 CSS px wide or narrower, on the screen a
person reaches immediately after creating an account. Not cosmetic: the screen
offers three controls and shows none of them.

**Surface:** the registration confirmation card in `RegisterForm.tsx` — the
resend button, "Ко входу" and "Указать другой email".

**Defect:** the card is taller than the viewport and the page opens at its top,
so the controls are below the fold. Measured on entry, before any scrolling:

| viewport | card height | resend control | on screen |
| --- | --- | --- | --- |
| 1440x900 | 997 | 792..856 | yes |
| 1920x1080 | 1080 | 833..897 | yes |
| 412x915 | 1005 | 792..856 | yes |
| 390x844 | 1005 | 792..856 | 12px of it clipped |
| **360x800** | **1053** | **840..904** | **no — starts 40px past the fold** |

At 360 the fold falls just under the captcha plate, so the last thing the reader
sees is "Подтверждение защиты станет доступно после окончания таймера." and
nothing below it. The resend button, the way back to the login form and the way
back to the registration form are all off screen, and the card carries no
affordance saying there is more.

The 48px between 360 and 390 is one extra wrapped line in each of the two
explanatory paragraphs; the card is 1053px at 360 against 1005px at 390.

**Not fixed here.** Closing it is a layout decision about which of the three
paragraphs, the illustration, the masked address or the always-rendered captcha
plate gives up its height, and that belongs to the interface audit stage
(tracker queue item 18) rather than to the test work that found it.

**Pinned** by `tests/e2e/registration-confirmation.spec.ts`, which allows the
control to start below the fold only at `chromium-mobile-360` and only by 48px
against the 40 measured. Every other project's budget is zero, so the same defect
appearing at another width fails, this one growing fails, and closing it passes.
The same test also asserts that the control is reachable once the shell is
scrolled, which is the part that does hold today.

### The height budget, measured 2026-09-11

Measured at 360x800 with Inter loaded, so the layout decision can be taken from
numbers rather than from a screenshot. The card's content is 1053px:

| part | px |
| --- | --- |
| lockup | 137, plus a 32 gap |
| strip | 35 |
| icon | 56 |
| heading | 28 |
| the three paragraphs | 96, 120, 48 |
| masked address | 38 |
| captcha plate | 65 |
| empty feedback slot | 40 |

The resend control sits at 840..904 and «Ко входу» at 916..960. Putting the
resend control on screen at all needs 40px, the whole control 104px, «Ко входу»
160px. Tightening the vertical rhythm alone at 360 and below returns 60px; 104px
is reachable only by also setting the explanation at a 20px line height.

The options, none chosen — this is the owner's decision:

- the actions first on narrow screens;
- a smaller or hidden lockup and icon (257px between them);
- the second paragraph collapsed or shortened;
- a sticky action bar;
- the captcha plate moved after the timer (81px);
- a scroll cue.

### Production's captcha is taller than the one measured, so the defect is larger

The budget above was measured with a 65px captcha plate. Production loads
Yandex SmartCaptcha (`smartcaptcha.cloud.yandex.ru`), and its container is
136px tall at 360 — checked on the live register page as a guest, 2026-09-11.
Measured again at 360x800 with that provider on the DEV server, the card is,
top to bottom: 16px of shell padding, the lockup 137 plus a 32 gap, the strip
35, then inside the card body the icon 56, the heading and three paragraphs 316,
the masked address 38, the captcha 136, the empty feedback slot 40 and the three
buttons 180, with 16px between blocks. The resend control starts 110px past the
fold and ends 175px past it; «Ко входу» ends 231px past, «Указать другой email»
287px past.

Rendered for the owner on 2026-09-11, each option laid onto the real screen as a
prototype, counting the buttons that end on screen at 360x800:

| option | buttons on screen |
| --- | --- |
| as it is | 0 of 3 |
| actions straight after the address, the explanation below them | 3 of 3 |
| no lockup and no envelope icon | 2 of 3 (the last ends 46px past) |
| one paragraph and a «Письмо не пришло?» link | 0 of 3 (resend ends 23px past) |
| the actions pinned to the bottom of the screen | 3 of 3 |
| the captcha shown only once the timer ends | 0 of 3 (resend ends 23px past) |

Recommended to the owner: the actions after the address, which needs no
floating surface and keeps every paragraph. Decided by the owner on 2026-09-11:
that option, with the lockup and its «Защищённый мессенджер» caption kept.

### Fixed 2026-09-11

**Measured again before the change**, on entry, at every width the spec claims,
with the production captcha on the same mocked flow:

| viewport | resend | «Ко входу» | «Указать другой email» |
| --- | --- | --- | --- |
| 360x800 | 911..975, 175px past the fold | 987..1031, 231px past | 1043..1087, 287px past |
| 390x844 | 863..927, 83px past | 939..983, 139px past | 995..1039, 195px past |
| 412x915 | 863..927, 12px past | 939..983, 68px past | 995..1039, 124px past |
| 1440x900 | 863..927, 27px past | 939..979, 79px past | 991..1031, 131px past |
| 1920x1080 | 869..933 | 945..985 | 997..1037, on screen |

Only 1920 had all three on screen. The first table of this entry was taken on
the default provider, Turnstile, whose plate is 65px; by these numbers the old
budget of the spec (48px at 360, zero elsewhere) could not have held at 360 or
390 against production's captcha — computed from the measurements, not run.

**Fix** (`64a7436`, the owner's option): the card body is now the icon, the
heading alone, the masked address, the captcha with its timer cover, the message
slot, the three buttons, and then the three paragraphs, word for word. The
lockup, its caption and all copy are unchanged, and the screen matches the
render the owner chose from. The heading carries `aria-describedby` pointing at
the paragraphs, so the explanation is still announced with the heading rather
than only after the buttons; Chromium's accessibility tree reports the whole
314-character text as the heading's description. Tab order is unchanged: the
paragraphs hold nothing focusable.

**Measured after**, on entry, with the production captcha:

| viewport | resend | «Ко входу» | «Указать другой email» | spare below it |
| --- | --- | --- | --- | --- |
| 360x800 | 623..687 | 699..743 | 755..799 | 1px |
| 390x844 | 623..687 | 699..743 | 755..799 | 45px |
| 412x915 | 623..687 | 699..743 | 755..799 | 116px |
| 1440x900 | 623..687 | 699..739 | 751..791 | 109px |
| 1920x1080 | 625..689 | 701..741 | 753..793 | 287px |

With every web font request aborted, the three buttons measure at the same
offsets at all five widths.

**Cost, recorded rather than hidden:** the explanation is read after the actions
in linear order, and at 360 nothing on screen says it is there — the fold falls
directly under the last button; at 390 and wider its first line shows. The card
is 8px taller (1100 against 1092 at 360), because the paragraphs now sit 16px
under the buttons where they sat 8px under the heading. The reserved message
slot — 40px, about 76 with the spacing around it, kept so that a message does
not move the buttons — now shows as an empty band between the captcha and the
resend control. And 360x800 has one pixel to spare: a shorter screen, or a top
safe-area inset larger than the shell's 16px padding, still cuts «Указать другой
email». An iPhone SE's 375x667 is such a screen: nothing above the buttons
depends on the viewport's height, and their offsets are identical at 360, 390
and 412, so there they would run from about 623px down past a 667px fold —
inferred, not measured; of the six options only the pinned bar keeps them on a
screen that short. Not checked on a device or in WebKit, and `aria-describedby`
was read from Chromium's accessibility tree, not heard through a screen reader.

**Guarded** by `tests/e2e/registration-confirmation.spec.ts`. The per-project
budget is gone: at all five claimed projects the shell must be unscrolled on
entry, all three buttons must be whole on screen, and the heading's accessible
description must equal the three paragraphs. The test refuses a dev server that
is not on the Yandex provider. Before the change it failed at 360, 390, 412 and
1440 on the fold and at 1920 on the description. Two mutations, each restored
byte for byte by SHA-256: the paragraphs moved back above the address fail 360,
390, 412 and 1440 (1920, where the old order fits, stays green); the heading's
`aria-describedby` removed fails 360 and 1920.

## D-064 `[x]` The only way out of a conversation is unpaintable on the engine Safari uses

**Severity:** critical, and it was live. A person on an installed PWA could open
a chat and then had no way back to the chat list: no back control, no title, no
avatar. Reported by a real user, not found in a sweep.

**Surface:** the chat header in `ChatWindow.tsx`, and every desktop Safari too —
this was never only a phone problem.

**Defect:** the header, the conversation and the composer are three positioned
boxes with `z-index: auto`, so paint order is decided by document order. The
header came **first** in the markup and `order: -1` on the list was what put the
list underneath it.

`order` moves a flex item's paint position in Chromium. **WebKit does not apply
it to positioned boxes at all.** Layout is identical in both engines — only
paint differs — which is why no geometry measurement caught it.

| list is | Chromium | WebKit |
| --- | --- | --- |
| `relative; order:-1` (as shipped) | chrome on top | **list on top** |
| `relative; order:0` | list on top | list on top |
| `static; order:-1` | chrome on top | chrome on top |

Measured consequences on the real page in WebKit: the topmost element at the
centre of the header was a **message bubble**; the centre of the back control
hit-tested into that bubble; the header menu opened at neither 390 nor 1440.

**Fix:** document order — the list first, the chrome after it — and `order: -1`
removed. No stacking context, no `z-index`, no containing block touched.

Two alternatives were rejected by measurement, not taste. `z-index` on the
chrome or `isolation` on the column creates a stacking context and clamps every
`fixed` overlay in the subtree — the header's menus and modals, the composer's
camera and video recorder, a bubble's context menu — so a full-screen dialog
would be covered by whichever of the two lost. A negative `z-index` on the list
stops it being a hit-test target at all (`listHit=false` in both engines, both
widths).

**Cost, recorded rather than hidden:** the conversation now precedes its own
header in reading order.

**What it teaches:** this was a regression of the glass week, and the rule that
recommended the `order` trick was in our own material contract. It is corrected
there as rule 12. It also went unseen because the Playwright matrix had six
projects and all six were Chromium; `webkit-mobile-390` exists now, and it found
this on its first run.

## D-065 `[x]` A utility three surfaces depended on was never declared

**Severity:** high on every iPhone with a home indicator, and the owner reported
it as "the bottom bar sits too low".

**Surface:** the tab bar, the full-screen modal and the chat-list sheet, all of
which carry `pb-safe`.

**Defect:** `pb-safe` is not a Tailwind utility and nothing declared it. The
string appears **zero times** in 219 KB of production stylesheet. All three
surfaces therefore had no bottom inset and sat on the home indicator.

**Fix:** `@utility pb-safe`, plus the tab bar's own height: boxes are
`border-box`, so beside a flat `height: 56px` the new padding was subtracted
from the tabs rather than added beneath them — six labelled icons at 22px with a
34px indicator under them.

**What it teaches:** a class name that resolves to nothing fails silently and
looks deliberate in the source. The check that matters is the built stylesheet,
not the JSX — `padding-bottom:env(safe-area-inset-bottom,0px)` now appears in
the shipped CSS, and that is what was verified after deploying.

## D-066 `[x]` The channel between the machines is a tube, and its traffic has no direction

**Severity:** medium, cosmetic, and reported three times before it was read
correctly. The owner said "the bar between the PC and the node still looks old";
it was fixed twice on the wrong element first — the stage track at the bottom of
the same screen — because the words "between the PC and the node" were not taken
literally enough.

**Surface:** the connection channel on the Windows startup screen, and the
overlay that continues that scene on the production page.

**Defect, two halves.**

*Weight.* A 20px filled tube with a border and frosted material, a 20px filled
junction under a 4px glow ring, two 14px bordered sockets each carrying a 3px
ring of page colour — four dense objects in a row on a screen where everything
else had already come down to a hairline. The 3px ring made an 8px socket 14px
wide and read as a bead threaded onto a wire.

*Direction.* The traffic highlight was a **symmetric** gradient — transparent,
bright, transparent. A symmetric shape in motion cannot say which way it is
going. It was also drawn once per half, so two lights ran in two boxes in
different phases rather than one crossing the span.

**Fix:** the channel is a 4px line matching `--track-height`, flat, tinted from
the accent, no border and no `backdrop-filter` — a line has no behind to sample.
Sockets and junction come to 8px. The sockets lose their ring, which existed to
punch them out of a line they do not in fact sit on. The junction keeps a 1.5px
ring while the handshake is open and drops it when connected, because a sealed
handshake should read as one continuous run.

Traffic is one element spanning socket to socket carrying a comet — bright
leading edge, tail fading behind it. Verified by pausing the animation mid-span
and photographing the still frame, which is the only test that matters for
whether a direction is legible.

**What it teaches:** two indicators on one screen could be redrawn one at a
time, and were. `--conduit-height` and `--track-height` are now both 4px and a
test pins that they agree, so that particular mistake cannot repeat.

## D-067 Images do not render in Safari

**Severity:** high, live, and reported by a real user. Open, and now known not
to be what the first run of the suite suggested it was.

**Surface:** message media in a conversation. The owner's screenshot shows an
empty white rectangle of the correct size where a photograph should be — the box
is laid out, the pixels are absent.

**The reported symptom is not reproduced.** On `webkit-mobile-390` against a
signed-in production session, every picture in the QA conversation loads and
paints, and it paints the *same pixels* Chromium paints: element screenshots of
the three message pictures give per-channel means of 25.1/31.9/45.2 in WebKit
against 25.2/32.0/45.3 in Chromium, and standard deviations within 0.2 of each
other. A picture that decoded but was not painted would show as a flat field
here, and none did.

**The five failures were not five defects. None of them was a product defect.**
The first run was made against a dev server pointed at `VITE_SUPABASE_URL=
http://127.0.0.1:54321`, where nothing is listening, so four of the five never
reached an image assertion at all — they died at sign-in with the login form
reading "Сетевой сбой. Проверьте подключение и попробуйте ещё раз." Chromium was
never run against that same server; when it is, it fails identically, which is
what settles it. Re-measured one at a time against a server on
`https://core.letscube.ru`:

| case | verdict | evidence |
| --- | --- | --- |
| `avatar-preview-sizing:31` dense avatar surface | test | `browserContext.newCDPSession: CDP session is only available in Chromium` |
| `avatar-preview-sizing:65` someone else's variant | environment | passes once the server has a backend |
| `media-gallery-variants:21` counted media rows | environment | passes once the server has a backend; Chromium failed the same way on the same server |
| `message-image-recovery:88` variant falls back | test | fails in **both** engines: "no variant request was intercepted" |
| `message-image-recovery:135` first request recovers | test | fails in **both** engines: "no original request was intercepted" |

**Three test faults were found behind them, and all three are fixed.**

1. *Nothing was ever brought into the viewport.* `MediaImage` renders
   `loading="lazy"`, and the QA conversation opens at the bottom with its
   photographs measured at `top: -5138`. Both recovery cases therefore issued no
   image request at all and failed on their own "nothing was tested" guards, in
   both engines. `toBeVisible()` does not mean "in the viewport" and cannot
   stand in for it.
2. *A service worker hides requests from `page.route` in WebKit.* Measured on
   one page and one address: while `navigator.serviceWorker.controller` was
   still null the image was intercepted; after a reload made the worker the
   controller the same request was reported by `page.on("request")` and never
   handed to the route. Chromium intercepted both. Every interception-based
   case therefore has to run with `test.use({ serviceWorkers: "block" })`, which
   costs nothing because `sw.js` never answers a backend request — true, though
   not for the reason first written here: see D-074.
3. *`.first().or(...)` narrows the wrong side.* Written that way it only
   narrowed the left-hand locator, so the moment the user list had drawn more
   than one avatar the union resolved to eight elements and the case died of a
   strict mode violation. Chromium reached the assertion a beat earlier, with
   one badge on screen, which is why only WebKit showed it.

The suite now reports 6/6 on `webkit-mobile-390` and 6/6 on
`chromium-mobile-390`, against 1/6 before.

**Proved by mutation, each with the file hash read before and after so a
mutation that did not apply cannot look like a pass.** Removing the fallback to
the original from `MediaImage.handleError` turns both recovery cases red in both
engines; making `handleError` a no-op — which leaves exactly the reserved-but-
empty box the owner photographed — turns them red on the new
`unpaintedInViewport` assertion; resolving no avatar variant at all turns the
avatar case red in both engines, where the old network-shaped assertion could
not have failed in WebKit at all. Every hash was checked back to its original
afterwards. One weaker mutation survived and is recorded because it is
instructive: blanking only the avatar `src` left `srcset` carrying the variants,
so the picture still resolved to one — the contract lives in both attributes.

**Ruled out by measurement, so nobody re-checks them:** `aspect-ratio` on the
button with `height: 100%` on the image (both engines draw 270×152 identically);
`loading="lazy"` inside a nested scroller after a programmatic jump (three of
three in-viewport pictures loaded in both engines; WebKit is in fact the *less*
lazy of the two, loading 40 of 40 where Chromium loaded 25); the format — Safari
has read WebP since 14; `onerror` semantics for a failed `srcset` candidate,
whether 404, aborted, malformed by a comma, or with every candidate missing
(identical in both engines, and the error fires in all of them, so the product's
fallback runs); recovery after a failure by dropping `srcset` and repointing
`src` (identical); the service worker as a *product* path — it never touches a
media object, though not for the reason first given here (see D-074), and it is
now also measured with the worker active (below).

**What is still unexplained, and where to look next.** The owner's picture has
not been reproduced, and the QA conversation is too small to hunt in — five
pictures, all of which paint. Two things are worth measuring on the owner's own
message rather than guessed at:

- ~~The `srcset` descriptors in `MediaImage` are hardcoded `360w` and `1280w`
  whatever the variants actually are.~~ **Fixed, and closed by D-068.** It was
  never the reported symptom — a descriptor that lies produces a blurry picture,
  not an empty one — but it was a real fault found while measuring this one.
- A bubble only reserves its box when the variant row carries dimensions, so the
  reported symptom is specifically *variant row present, pixels absent*. The one
  state that produces it silently — no error box, no pixels — is a load that
  never starts or never finishes. Worth checking against a real iOS device
  rather than Playwright's WebKit, which does not carry iOS's decoded-image
  limits.

**2026-09-11: the service worker is excluded, measured with it active.** Until
then every picture case here ran with the worker blocked, so its own path had
never been exercised. On the QA conversation with a built bundle and the
production storage addresses, with the legacy worker and with the new one
(D-072), in Chromium and WebKit: 1 of 1 pictures painted, 0 unpainted in the
viewport, and Cache Storage held 0 cross-origin, 0 opaque and 0 partial (206)
responses. Against a synthetic storage origin, in three worker modes and both
engines: a normal or a slow answer loads; a 404, an abort, an HTML body and a
reset all reach the error path; identical in every mode. The one state that
leaves a reserved box with neither pixels nor an error is a request that never
answers, and it is the same with no worker at all — which leaves the two
device-side hypotheses above.

## D-068 `[x]` Width descriptors that were never measured

**Severity:** medium. Every photograph in every conversation, on every engine.
Found while measuring D-067; it is not D-067's symptom.

**Surface:** `MediaImage` in
`artifacts/kub/src/components/chat/MessageBubble.tsx`.

**Defect:** the candidate set was written `${thumbUrl} 360w, ${url} 1280w`.
Neither number came from anywhere — both were typed in, and neither variant is
normally either size. Measured against production, a thumb declared `360w` is
**166px** and a preview declared `1280w` is **591px**. A width descriptor is not
a hint the browser verifies; it is a promise it acts on and cannot check, so the
whole selection was decided by two invented numbers. Over-declaring makes the
browser draw a small file into a large box, or skip the variant for a full-size
original nobody needed; under-declaring makes it reach past a perfectly good
variant.

**The real widths were already in hand** — `thumbWidth` on the variant row, and
the preview's own `previewWidth` — and simply never reached the element.

**Fixed** by passing both as props and declaring each candidate at the width it
actually is; when either width is unknown the set and its `sizes` are dropped
rather than guessed, because `src` alone is correct and a wrong descriptor is
worse than an absent one.

**A second fault was found while writing the regression test, and is fixed with
it.** The main candidate's width was first taken from `dimensions`. That is
chosen on `previewWidth && previewHeight` while the *address* is chosen on
`previewUrl` — not the same condition, and `media_variants.width` is nullable.
A preview row carrying an address but no width therefore sent `dimensions` to
the ORIGINAL's metadata while the element went on showing the preview, so the
original's width was declared on the preview's address: the same lie, harder to
see, and invisible to the `thumbWidth < mainWidth` guard because the original
really is the larger number. The width is now keyed on `previewUrl`, so it can
never come from a different row than the address it describes.

**Regression test:** `tests/e2e/message-image-srcset.spec.ts`. It states the
contract rather than the repair — not "the descriptor is not 360w" but *every
declared descriptor equals the intrinsic width of the file it names*, checked by
loading each candidate and reading its `naturalWidth`. The second case strips
`width` from every `image_preview` row in the REST response and asserts that no
`srcset` and no `sizes` are emitted while `src` survives and the picture still
paints.

**Proved by mutation, hashing the file before and after each.** Restoring
`360w`/`1280w` fails it in both engines with `declared 1280w, actually 591px`;
understating every descriptor to a third fails it with `declared 55w, actually
166px`, so both directions are caught rather than only the one that was
repaired; and taking the width from `dimensions` again fails the second case
with three srcsets declared for variants whose width is unknown. 8/8 on
`webkit-mobile-390` and `chromium-mobile-390`.

## Measured on the device, and not a defect

**The scroll contracts hold, by finger rather than by wheel.** Chat entry with
no unread lands at the bottom with the newest bubble 23.9px clear of the
composer. Four fast upward flings in succession never snapped toward the bottom
and never jumped to the oldest history; the history prepend fired at the top and
the conversation carried on upward. A slow 464px drag tracked its witness row to
within 0.5px, and a 199px drag to within 0.0px.

**The search jump lands clear of chrome, and the scroll-padding tracks the
search bar.** Jumping to a result from 25,107px away put the target at 216.1px
from the top, fully visible, with `scroll-padding-top` and `padding-top` both at
**174px** — the header's 56 plus the search bar that had just appeared — which is
rule 2's "padding and scroll-padding move together" doing exactly its job while
the keyboard was also open. `08-search-jump.png`.

**D-039's withdrawal holds on this device.** A `requestAnimationFrame` sampler
across a prepend reported the witness row displaced **+1852.6px** for one sample
and back the next — the same shape, and a larger number, than the 1233px the
withdrawn entry reported. It is the same instrument error: rAF runs before style
and layout, so `getBoundingClientRect` there forces an early layout and reports a
frame that is never painted. Recorded so the next person who points a sampler at
this does not re-open it.

**D-042 reproduces at its recorded size.** The settled anchor drift across a
prepend measured **−39.4px** against the entry's 42px, and the loading band is
the 43px the scroll height grows by while `loadingOlder` is set. Unchanged, still
open, still the band.

## What could not be checked, and why

**Rotation.** `android/app/src/main/AndroidManifest.xml` pins the activity to
`android:screenOrientation="portrait"`, so there is no landscape on this shell
and no landscape keyboard. The rotation question has no answer to give here.

**A second keyboard height.** Switching layout inside the installed IME
(Russian to QWERTY, `05-keyboard-alt.png`) kept the height at exactly 266px, so
the language-change case produced no second data point. A second IME is
installed but making it current is a system setting and was left alone. The
mechanism in D-058 is `Δ = clientHeight before − after`, so any other height
displaces by exactly that height; a second measurement would illustrate it, not
determine it.

**Chat-list scrolling.** The QA owner account has three chats. There is nothing
to fling, so the sidebar's scroll cost is unmeasured; the eight-fling figures in
D-062 are the message list only.

**Push, and the notification jump behind it.** `android/app/google-services.json`
is absent from this worktree, so the debug build ships without the
google-services plugin and no notification could be delivered. The search jump
exercises the same `scrollIntoView` path and is recorded above.

## Where this evidence is

The device screenshots are in the session scratchpad, not in the repository:
`01-login.png`, `02-after-login.png` (D-061), `03-chat-open.png`,
`04-keyboard-open.png` and `05-keyboard-alt.png` (D-058), `06-message-actions.png`,
`07-state.png` (D-060), `08-search-jump.png` and `09-light.png` (D-059). Every
one is `adb exec-out screencap` from the device, so each includes the system bars
and, where relevant, the real IME.

Nothing in any of them carries a real conversation. The session was signed in on
the QA owner account through `KUB_QA_OWNER_*`, the way the e2e suite does; the
three chats it can see are `Избранное`, `Test test` and `LocationStaffTest`, and
their contents are the `QA-HISTORY nnnn` fixtures and `codex …` sync markers this
repository generates. No credential was typed on the device or passed on a
command line — the sign-in reads the QA env file inside Node and drives the form
over CDP. The app's stored theme was set to `light` for D-059 and the key removed
afterwards, returning it to `system`; no Android setting was changed at any point.

## The matrix now goes down to 360, and why that is the structural finding

Three of the five defects above — D-058, D-060, D-061 — arrived from below 390,
which is where the release matrix stopped. Not one of them needed a device to
find; every one of them reproduces in a browser at 360 with the same numbers to
two decimal places. They were invisible because nothing ever looked.

`360x800` is now in the matrix, in the three places it is written down:

- `playwright.config.ts` as `chromium-mobile-360`, at device scale 2, which is
  the phone: 720x1600 physical at density 320;
- `scripts/interface-audit.mjs` as `360x800`;
- queue item 18 of `docs/PRODUCTION_PRIORITY_TRACKER.md`, which now names six
  release viewports rather than five.

Two specs that enumerate their own mobile coverage were widened with it:
`tests/e2e/public-home.spec.ts`, because a public surface making availability
claims is the last place that should go unchecked at the narrowest width, and
`tests/e2e/registration-confirmation.spec.ts`.

### What adding it turned up straight away

**The entry spec's sampler was measuring frames that were never painted.** Run
at 360, `no painted frame shows the list away from the bottom on entry` failed
about one run in five with readings of 728px and 1092px. It is the instrument,
not the app, and it is the same instrument error this register already withdrew
an entry to: `requestAnimationFrame` runs BEFORE style, layout and
ResizeObserver delivery of its own frame, so a reading taken there is the state
before the correction that frame is about to make. Measured at 360 over twelve
entries, with a second ResizeObserver registered after the component's own so
its callback is delivered after `applyBottomNow` and still before the paint: the
rAF sampler produced three readings over 40px and the observer reported **zero**,
in 79 deliveries.

The sampler now records what each frame painted — the last reading taken during
that frame, whether from the rAF or from the observer, pushed at the start of the
next one. That makes it strictly stronger rather than more forgiving, and it is
proven by mutation: deferring `applyBottomNow` by a single frame, which is the
shape of D-037 and D-038, now fails it with `a frame was painted 4797px from the
bottom`. It did **not** fail the old sampler, at any viewport — the growth was
one frame long and the old filter dropped the frames around it.

A first attempt at this weakened the bound instead, by ignoring a reading the
next frame contradicted. That is wrong and was reverted: the mutation above paints
exactly one frame 4797px out, and a reader sees it.

**An intermittent worth knowing about — since found, and it was neither the
ResizeObserver loop limit nor the app.** `content that grows under a pinned list
is not painted out of place` failed once at `chromium-desktop-1920` with 180px in
one full six-project run, and passed 4/4 in isolation and 66/66 on the next.
Reproduced deliberately at eight concurrent lanes it fails **28 times in 64**, so
it was never rare, only load-dependent. The guess written here was that a
1920x1080 to 900x900 step reaches the ResizeObserver loop limit. It does not:
across 128 traced runs the page recorded **zero** "ResizeObserver loop completed
with undelivered notifications" errors. Two things were actually wrong.

*The test's stated mechanism did not exist.* The conversation column is capped,
so its content is 4505px tall at every scrollport width from 480 to 1520.
1920 and 900 both land inside that range and **nothing rewrapped**: content
height was 4505 before the resize and 4505 after it, measured on every run. The
only thing that changed was the scrollport's height, 1036 to 856, which is the
D-058 keyboard mechanism and already has its own test at a 4px bound. The 180px
this reported was that height change — 1036 − 856 = 180, exactly — and never the
reflow the test is named after.

*And the frames it counted were frames the page had not been told about.*
`page.setViewportSize` reaches the renderer as a device-metrics override, and
Chromium applies that override to layout before the document runs its resize
steps. Traced at 1920, with a timestamp on every reading:

```
3489 raf top=3469 h=4505 c=1036 inner=1080x1920
3524 raf top=3469 h=4505 c=856  inner=900x900    <- layout already resized
3536 raf top=3469 h=4505 c=856  inner=900x900    <- and again
3543 resize inner=900x900                        <- the page is told here
3548 ro-fire n=2
3548 ro  top=3649 h=4505 c=856  inner=900x900    <- corrected, same frame
```

Two frames were laid out at the new size with no resize event and no observer
notification delivered. No application can place a list in those two frames: it
has not been told, by any API, that anything moved. A real window resize does not
split this way — the size change, the resize steps and the observer broadcast
belong to one rendering lifecycle.

**Fixed by making the test measure its own mechanism.** It now narrows the width
and holds the height — 800 on the desktop projects, where the scrollport goes
1520 to 440 and the content 4505 to 5597, and 320 on the phones — and asserts
both halves of that premise rather than assuming them: the content must have
grown, and the scrollport must not have changed height. Frames are counted from
the page's own `resize` event onward. Under the identical eight-lane load that
produced 28 failures in 64, the new formulation is **0 in 64**, with about 75
frames still counted per run.

It is not more forgiving. Deferring `applyBottomNow` by a single frame inside the
observer — the shape of D-037 and D-038 — fails it at **all six projects** with
`a frame was painted 1092px from the bottom after the reflow`, where the old
formulation could only ever have seen 180.

**A second intermittent, in the neighbouring test, still open.** `no painted
frame shows the list away from the bottom on entry` fails at
`chromium-desktop-3840` with 1092px. It is not the same thing and it is not
caused by the change above: run alternately in the same eight lanes under the
same load, the pre-change spec failed **7 of 32** and the post-change spec **6 of
32**, and both report the identical value. Traced, it is the web font arriving
after the conversation has mounted:

```
4224 raf top=1297 h=3413 c=2116   <- at the bottom
4240 raf top=1297 h=4505 c=2116   <- content grew 1092px in one step
4258 raf top=1297 h=4505 c=2116
4272 fonts-loadingdone            <- the font is only reported done here
4272 raf top=1297 h=4505 c=2116
4300 ro-fire n=1
4300 ro  top=2389 h=4505 c=2116   <- corrected, three frames later
```

The whole history rewraps when the face swaps, which is 1092px at this fixture,
and the observer is delivered three frames behind it. Two things are unresolved
and both need their own measurement rather than a guess. Whether those three
frames were painted with the new layout at all, or whether the sampler's own
forced read in `requestAnimationFrame` is what pulled the relayout forward —
which is the D-039 error one level deeper, and would need a screencast to settle,
not another sampler. And whether the reflow should happen at all: a face that
swaps a second after the conversation opens moves the whole history under the
reader, and preloading it or holding the metrics would remove the event instead
of correcting it. Left open and written down rather than loosened; the rate is
about one run in five at 3840 under eight-way load and near zero without it.

**`registration-confirmation.spec.ts` could not run in this environment** at any
viewport, and the missing prerequisite is **`VITE_AUTH_CAPTCHA_SITE_KEY`**.
`authCaptcha.ts` resolves its configuration once, at module load, from
`import.meta.env`; with no site key there is no configuration, the register form
renders "Проверка защиты формы не настроена" where the widget belongs and refuses
to submit with "Защита регистрации временно недоступна". The captcha mock in the
spec stands in for a *rendered* widget and cannot help, so all three tests died
four steps later on `n***r@example.test is visible` — a message that says nothing
about the cause. The spec now refuses at the first step and names the variable,
the way `chat-entry-scroll.spec.ts` names `VITE_PUBLIC_PREVIEW_FIXTURE` and
`privacy-support-public.spec.ts` names this same one. Started with it set, the
spec passes 7/7 across the matrix and its 360 coverage is proven rather than
declared. The dev server the interface specs want, from PowerShell — Git Bash
rewrites `BASE_PATH` and every route then answers 302:

```powershell
$env:PORT = '5250'
$env:BASE_PATH = '/'
$env:VITE_PUBLIC_PREVIEW_FIXTURE = '1'
$env:VITE_SUPABASE_URL = 'http://127.0.0.1:54321'
$env:VITE_SUPABASE_ANON_KEY = 'playwright-public-fixture'
$env:VITE_AUTH_CAPTCHA_SITE_KEY = 'playwright-captcha-site-key'
pnpm.cmd --filter @workspace/kub run dev
```

None of those values is a credential: the Supabase pair points at a loopback
address that nothing is listening on, and the site key is read only as a
non-empty string. The provider defaults to Turnstile, whose loader returns
immediately when `window.turnstile` already exists, so the specs' own mock keeps
the network out of it.

Two things surfaced the moment it could run. At `chromium-desktop-1920` the
confirmation card is exactly 1080px tall in a 1080px port, so
`expect(shell.scrollTop).toBeGreaterThan(0)` could never hold there — the
assertion presumed an overflow that only exists at the other widths (1440
scrolls 97px of 997, 360 253px of 1053, 390 161px and 412 90px of 1005; 3840 is
2160 in 2160 and does not scroll either). It now asserts what that was a proxy
for: the shell is the scroller and the document never is, and the shell scrolls
whenever the card overflows it. The second is D-063.

## Evidence for the closures, and what was touched on the device

The measurements above were taken on the same 360-wide phone, through a debug
build installed over the release one. Both builds were driven the same way: the
web bundle built by `scripts/build-android-production.mjs`, the WebView reached
over `adb forward` and CDP, geometry and colour read from the page, and the real
IME opened by `adb shell input tap` on the composer rather than by focusing the
field from script — the emulated keyboard is what produced the wrong model the
first time this was looked at.

Nothing carrying real content was read or printed: only geometry, colours and
class strings. The session was signed in on the QA owner account through
`KUB_QA_OWNER_*`, read inside Node from the local env file and typed into the
form over CDP, so no credential reached a command line. The app's stored theme
was set to `light` and then to `dark` for the D-059 and D-062 measurements and
the key was removed afterwards, returning it to `system`. **No Android setting
was changed**: the phone was already in night mode, `cmd uimode night` reported
`yes` before and after, and it was only ever read.

The device was returned to the build it started on. The installed release APK was
pulled before anything else was done (SHA-256
`7704944572e7c97150e159f3326b65b936fee1d11c0b01d852132423dc509863`) and
reinstalled at the end; the copy pulled back afterwards has the same hash. A
debug build cannot be installed over a release one without an uninstall, so the
application's data was cleared going in and cleared again coming out — the owner
will need to sign in on the phone again.

## D-069 `[x]` The width the placement was compared against was the width the placement had produced

**Severity:** high on the phone. Every message that does not wrap, at 360 and
390, on both engines. Found 2026-09-06 while chasing a WebKit-only report that
the time stayed beside a last line it did not fit on.

**Surface:** `getMaxContentWidth` in
`artifacts/kub/src/components/chat/MessageBubble.tsx`.

**Defect:** the ceiling was `Math.min(fromRow, cap)`, and `fromRow` is measured
from the bubble's parent row. That row is shrink-to-fit around this very bubble,
so for a message that does not wrap it reports the width of the message. It is
the same feedback loop as D-027, running the other way round: the row answers
with the placement it was given.

Measured at 390 on the DEV preview fixture, both engines:

| | `Коротко` (one line) | the wrapped message |
|---|---|---|
| row reports | **100.4px** | 342px |
| declared cap | 309.4px | 309.4px |
| last line + time + 8 | 125.0px | 345.98px |
| answer it gave | **anchored** — wrong | anchored |

So a one-line message was told it had 100px when the design allows 309px, and
every short message on the phone grew a row for its timestamp. This is what
`message-meta-placement.spec.ts:126` had been failing on at 360 and 390 on
Chromium **and** WebKit, while passing at 1440 where the row happens to be wide
enough to hide it.

**Fix:** an exactly known cap is the answer and the row is not consulted at all.
`resolveCssLength` already returns `null` when it cannot resolve a percentage,
so asking it a second time with no basis says whether the cap contains one.

Where the cap does contain a percentage the row stays, because there the
percentage is guessed as `Infinity` and an `Infinity` inside a `max()` discards
the real term beside it: an own bubble at 1440 declares
`min(1238.4px, 560px, max(256px, 100% - 104px))`, whose true value is the 256px
the floor contributes and whose guessed value is 560px. Measured, trusting that
guess put the reserved spacer on a line of its own at 1440 and 1920. Both
directions are mutation-proven — removing the exact branch fails at 360/390,
treating every cap as exact fails at 1440/1920.

### Two things found alongside it, and not the same defect

1. **The spec was calibrating on one face and asserting on another.** The
   font-freezing in `message-meta-first-paint.spec.ts` was a `page.route`
   abort, and a route is per page: the second page of a context is served the
   Google Fonts stylesheet out of the cache with no request to intercept.
   Measured at 390 on WebKit, the same timestamp is **54.5px** wide on the page
   the text is built against and **60.4px** on the page it is rendered in, so a
   message crafted to overflow its line by 14px arrived wrapped a line further
   on with 139px of last line inside a 309px bubble. The link is now removed
   from the document as well, which no cache can undo. This is why the report
   read as WebKit-only.
2. **A measurement can still freeze on a layout that is passing through.** With
   the fonts diverging as above, one bubble re-wrapped twice after mount —
   content span 3 lines/301px, then 4 lines/270.8px, then 3 lines/305.1px — and
   its last measurement was the middle one, which read an 82.4px last line where
   the settled line is 277.6px. Nothing re-measured it afterwards: the stack and
   the bubble keep the **same box** across that change, because "four lines of
   text" and "three lines of text plus a wrapped reserve" are both four line
   boxes, and the content span is an inline box, which ResizeObserver reports
   nothing for. A single forced re-measure corrected it permanently and it did
   not oscillate. It was left alone pending a decision about the two-node limit
   in `tests/unit/message-bubble-measurement-cost.test.mjs`, because that limit
   was written down and not defended.

   **Resolved 2026-09-07 by measurement: the limit stays at two, and the freeze
   does not reproduce.** See the section below.

### The two-node limit, decided by measurement

The freeze above was observed while the two pages of a context were rendering
in different faces, which is finding 1 and is fixed. Whether it survives that
fix was measured rather than argued, on the DEV preview fixture against a dev
server with the real backend, at 390 and 1440, with 120 and 400 messages, three
repeats each.

**The freeze does not reproduce.** A `resize` event re-measures every bubble
without moving a single box, so any decision left standing on a layout that had
gone would change under it. Across every run — including a deliberately late
webfont that re-wrapped a settled conversation, moving 34 of 120 messages from
`inline` to `anchored` — the number of placements that changed was **0**.

**A third node could not have caught it anyway.** A second observer, registered
beside the component's own on all five candidate nodes of every message (600
watched nodes per viewport), counted the deliveries in which the paragraph's
box moved and neither node the component watches did:

| phase | deliveries | paragraph moved alone |
| --- | --- | --- |
| boot | 1 | 0 |
| settled, 800ms | 0 | 0 |
| late webfont swap | 10–11 | **0** |
| 21 600px of scrolling | 0 | 0 |
| 30 viewport width steps | 0–73 | **0** |
| text-size change and back | 7–10 | **0** |

Never once, at either viewport. The paragraph is a block box inside the stack's
shrink-to-fit chain, so a re-wrap that changes its box changes the stack's box
in the same layout pass and arrives in the same delivery. The content span
confirmed the other half of the mechanism: **one** delivery, the mandatory
first one every newly observed target gets, and nothing afterwards — an inline
box reports no resize.

**What the third node would cost.** Measured with the paragraph added to the
observed list, same fixture, 400 messages:

| | two nodes | three nodes |
| --- | --- | --- |
| live observation targets | 657 (390) / 578 (1440) | 1057 / 978 |
| `observe()` calls during mount | 910 / 886 | 1563 / 1527 |
| entries delivered during mount | ~1400 / ~1360 | ~2452 / ~2260 |
| `measure()` runs during mount | 1172 / 1148 | 1252 / ~1250 |
| placements it changed | — | **none, anywhere** |

So +61% live targets, +72% registrations, +75% delivered entries and +7% measure
runs, for no different answer at any viewport in any scenario.

**Scrolling is free either way, and that is why.** Over 240 frames and 21 600px
in both directions, the measurement observer delivered **0** callbacks and ran
**0** measures, in every run of both variants: nothing resizes while a list
scrolls. Frame gaps were identical — median 16ms, p95 17–18ms — with 657 targets
and with 1057. The handler itself costs about **0.05ms**: 400 forced
re-measures totalled 18–22ms of callback time at 390 and 16–28ms at 1440.

The average is below the ceiling in any case. On the mount that matters the
bubble and stack refs are still null, because React attaches host refs
child-first, so the first pass observes the footer alone; only a message whose
placement changes ever reaches two. Measured at rest: **1.62 nodes per message**
at 390 and **1.46** at 1440.

**The limit is now defended.** `tests/e2e/message-meta-observer-cost.spec.ts`
counts what the running chat registers, so the form the nodes are named in
cannot matter, and `tests/unit/message-bubble-measurement-cost.test.mjs` counts
every `observe()` in the effect rather than only the array entries. Six
mutations of `MessageBubble.tsx:635`, each with the file's SHA-256 checked before
and after:

| mutation | e2e spec | unit gate before | unit gate after |
| --- | --- | --- | --- |
| third node as its own `observe()` statement | red | **green** | red |
| third node inside the array | red | red | red |
| fourth node | red | red | red |
| observer removed entirely | red | red | red |
| footer observed, never the stack | red | **green** | green |
| stack observed, never the footer | red | **green** | green |

The three green cells are what "written down and not defended" meant.

---

## D-070 `[x]` The width the meta is measured against is one the bubble never reaches

**Severity:** medium. Measured at 390 only, on 6 of 120 and 14 of 400 messages
of the same fixture; none at 360, 412, 1440 or 1920. Found 2026-09-07 while
measuring the observed-node limit of D-069.

**Surface:** `artifacts/kub/src/components/chat/MessageBubble.tsx:571`, the
`canInline` comparison, against the ceiling `getDeclaredContentCap` returns at
`:421`.

**Defect:** the decision compares the last line and the meta against the width
the bubble is *allowed* to reach. A text bubble is shrink-to-fit, so it stops at
the width its longest line needs, which can be less. The spacer that reserves
room for the meta is an inline box in the same paragraph, so where the gap is
smaller than the spacer it wraps instead of widening the bubble — and the bubble
grows a line holding nothing but the timestamp, which is the symptom of D-008
and D-027 arriving from a third direction.

This is not the frozen measurement of D-069. A `resize` that re-measures all 400
bubbles reproduces the same answer, at both message counts, in every run: the
rule is wrong, not stale.

**Reproduction:** the DEV preview fixture at 390 with a message that wraps to
three lines and ends on a long one —

```
011. Средней длины сообщение, которое на телефоне переносится на две строки,
а на широком экране остаётся в одной
```

| | 390 (defect) | 412 (same message, correct) |
| --- | --- | --- |
| stack `max-width` | `min(335.4px, 560px, max(256px, 100% + 0px))` | `min(354.32px, …)` |
| ceiling the decision uses | 311.4px | 330.3px |
| last line | 238.3px | 238.3px |
| meta + 8px gap | 68.4px | 68.4px |
| the decision: 306.7px fits | **yes → inline** | yes → inline |
| bubble's actual content width | **304px** | 326px |
| reserved spacer | 69px, **wrapped** | 69px, on the line |
| paragraph height | **91px — four line boxes for three lines** | 68.3px — three |

**Consequence:** the message renders as three lines of text and a fourth line
that is empty except for `09:02` at the right edge. `data-message-meta-placement`
still reads `inline`, so a check on the attribute or on where the timestamp
finally sits reports the message as correct; the wasted line is only visible in
the paragraph's height, or on screen.

### Closed at phone widths, 2026-09-11 — `0279d71`

The ceiling was the width the design allows, and a received message never
reaches it: its row also holds the 32px avatar lane and a 6px gap. Measured on
the DEV preview fixture over 120 messages, wrapped spacers before and after:

| project | before | after | ceiling | reach |
| --- | --- | --- | --- | --- |
| `chromium-mobile-360` | 4 | 0 | 283.6px | 272px |
| `chromium-mobile-390` | 5 | 0 | 309.4px | 302px |
| `webkit-mobile-390` | 4 | 0 | 309.4px | 298px |
| 412, 1440, 1920, 3840 | 0 | 0 | | |

**Fix:** an inline answer is also checked against the width the bubble can
actually reach, in `artifacts/kub/src/lib/messageMetaReach.ts` — read from the
`[data-message-id]` row, the stack's anchored edge taken from the row's
`justify-content`, and the cap resolved at full reach — with the spacer at its
rendered width. None of those boxes moves with the placement, so the same number
comes back in both placements and the check can only turn inline into anchored.
Where the cap follows a row shrink-wrapped around the message (the action lane,
640px and up) no such number exists and the rule is unchanged; that remainder is
D-071. Placements diffed message by message at the seven matrix projects and at
640, 768 and 1024: 13 changes, every one a wrapped spacer, each message one line
box shorter. The observed-node count is unchanged.

**Regression tests:** `tests/e2e/message-meta-spacer-line.spec.ts` asserts line
boxes rather than the attribute over a 120-message conversation, and the reverse
as well — no wrapped message is refused room it has;
`tests/unit/message-meta-reach.test.mts`. Five mutations, each with the file's
SHA-256 checked before, after and on restore, all red: the reach check disabled,
the anchored side swapped, the footer used instead of the rendered spacer, the
free space ignored, and the shrink-wrap guard removed.

**Harness note:** WebKit reports Inter loaded from the first sample yet re-lays
the conversation about 1.3s after the ready signal (1317–1383ms over six runs),
so the spec waits for 2.5s of stable layout. Settled, a forced re-measure changes
0 of 120 messages in three runs: the D-069 freeze does not reproduce on WebKit
either.

## D-071 `[ ]` Where the action lane binds, the spacer still wraps

**Severity:** low. Tablet width with the sidebar open: 11 of 120 own messages at
768; none at 640 or 1024. Found 2026-09-11 while closing D-070.

**Surface:** the stack cap `ACTION_LANE` in
`artifacts/kub/src/components/chat/MessageBubble.tsx:182`, used by the `sm:` and
`md:` stack widths at `:122`–`:153`. `artifacts/kub/src/lib/messageMetaReach.ts:30`
records why the reach check of D-070 stays out of it.

**Defect:** `max(16rem, 100% - var(--kub-action-lane))` resolves against a row
that is shrink-wrapped around the message, spacer included, so how far a bubble
can reach depends on the placement it is given, and no constant predicts it. One
message measured at 768: row 376px, cap 272px, content 246px, while the decision
compared against 352px. The reserved spacer wraps onto a line of its own — the
symptom of D-070.

**Not fixed, on purpose.** Tightening the rule where the lane binds can flip a
message that ends on a long word between the two placements on every pass. It
needs the action lane itself decided — what the lane is at tablet width beside
the sidebar — rather than a sharper rule. That is an owner decision.

### Rendered for the owner, 2026-09-11

At 768x1024 beside the sidebar, on the 120-message fixture, the hover actions in
three arrangements laid onto the real page as prototypes, with the lines holding
nothing but a time counted the way `tests/e2e/message-meta-spacer-line.spec.ts`
counts them:

| arrangement | messages whose time sits on a line of its own |
| --- | --- |
| as it is: 104px kept beside every message | 11 of 120 |
| no lane; the actions over the message's top corner while it is hovered | 0 |
| no lane; the actions above the message while it is hovered | 0 |

Without the lane the cap no longer follows a shrink-wrapped row, and every
message settles with its time on its last line. The cost is what the actions
cover while a message is hovered: over the corner they sit on the time of the
message above; above the message they sit on the end of its last line. Either
needs the row to stop clipping — the row wrapper
`div.flex.w-full.min-w-0.items-center.gap-1.5.overflow-hidden` clips whatever
the actions put outside the row's box, and in the prototype it had to be opened
before they showed at all.

A fourth arrangement, a 40px lane holding only «Ещё», was dropped: at 768 it
sends the placement into an endless loop and takes the whole interface down —
D-080. Recommended to the owner: the actions over the top corner.

**Decided further than any option, by the owner on 2026-09-11:** no hover
actions at all, as in Telegram. Every action lives in the long-press and
right-click menu, which already opens with a row of quick reactions, and a micro
icon gives a quick reaction without the menu. With no cluster there is no lane
to reserve, so the wasted line this entry describes goes with it. A concept
render of that was sent to the owner the same day; the implementation waits for
the conversation work in `MessageBubble.tsx` to merge.

### The concept was wrong, and a parity assessment replaced it — 2026-09-11

The owner rejected the concept («С действиями в чате неверно») and sent six
screenshots of Telegram — Android after one tap, the full emoji panel, the
desktop hover button and its column, the desktop right-click menus for a photo
and for text — asking for a clear assessment against Telegram before any more
iterations. The concept had four things wrong: on a phone it opened the menu on
a long press, where Telegram opens reactions and the menu on one tap and uses
the long press to select; on a desktop a click on the smiley opened a horizontal
strip, where hovering Telegram's button opens a column and a click reacts at
once; one menu served every message, where Telegram's items depend on whether
it is text or a photo; and the menu had no header of who reacted, no row of
icons, no «Детали» and no «Копировать ссылку».

The assessment was published to the owner as a page (`Сверка действий с
Telegram`, https://claude.ai/code/artifact/d6574ef1-c1e9-4b8a-a856-f8cd8b4bb12f),
built from the owner's screenshots, Telegram's own posts and a read-only
inventory of the current code at `74d32c2`. Of 26 points, 2 match, 6 match in
part, 5 work differently, 12 are missing and 1 — the phone's «⋯» beside the
time — should go. Some findings from the inventory that the entry did not
carry: a single tap on a bubble does nothing; the long press is 650 ms and docks
the menu to the bottom of the screen; the quick reactions are a fixed six, not
the most used; nothing shows who reacted or which reactions are already yours;
a reaction appears only after the server answers; a photo's «Копировать» copies
the caption, and the browser's own menu is suppressed inside a message row;
a message link already works in the app (notifications open it) but no menu
copies it; a forwarded message carries no «Переслано» label; `myRole` reaches
the bubble and is never read.

Proposed order: one set of renders for the whole target — phone and desktop,
text and photo, menus, the reaction column, selection — approved at once, then
code in stages with no redesign in between: the phone, the desktop, reactions,
selection with forwarding several and one «Удалить» (complaints 10 and 9), then
«Детали» and saving. Four owner decisions are open: one reaction per person or
several, the quick reaction (👍 or ❤️), swipe to reply on a phone, and whether
this track absorbs complaints 10 and 9.

**Decided by the owner the same evening:** one reaction per person, as in
Telegram — several, and animated ones, belong to a paid subscription planned
for later (tracker queue 24), not to this work; ❤️ is the quick reaction, on a
double tap and on the hover button; swipe to reply on a phone is wanted; and
complaints 10 and 9 join this track. Next is the one set of renders for the
whole target.

## D-072 `[x]` The service worker was never replaced, so its cache was never cleared

**Severity:** high. Every browser and installed-PWA user; on iOS the dead assets
count against the origin's storage quota.

**Surface:** `artifacts/kub/public/sw.js`, and the web build that serves it.

**Defect:** the cache name was the constant `kub-app-shell-v2`, unchanged for 429
commits, and production served a byte-identical `sw.js` (SHA-256 `3e9303db…`)
through every deploy since July. A browser installs a new worker only when those
bytes change, so `activate` — the only code that deletes a cache — never ran
again, and every deploy's hashed assets stayed in Cache Storage beside the
previous ones.

**Fixed** in `7381bed` and `9321dcf`. `vite build` stamps a build record into the
emitted worker (`artifacts/kub/serviceWorkerBuildPlugin.ts`, read at `sw.js:19`):
a digest of every emitted file, the module entry and the files the offline shell
boots. The cache is named by that digest, so every deploy installs a new worker
whose `activate` deletes every other cache (`sw.js:65`), `kub-app-shell-v2`
included. With a new worker on every deploy, the page now asks a waiting worker
first (`artifacts/kub/src/lib/pwa/serviceWorkerHandoff.ts`, called from
`usePwa.ts`): the worker takes over at once only for a page already running its
build that is the origin's only window; any other page is offered the update as
before, and nothing reloads by itself. Replaying the rollout on real builds in
Chromium and WebKit: a first launch is taken over in 2.1s and 2.3s with no reload
and `v2` deleted; an open old tab reloads exactly once after accepting; a second
tab is neither prompted nor reloaded.

**Regression tests:** `tests/unit/pwa-service-worker-build.test.mts`,
`pwa-service-worker-cache.test.mjs`, `pwa-service-worker-handoff.test.mts` and
`pwa-service-worker-lifecycle.test.mjs`; `tests/e2e/pwa-service-worker.spec.ts`,
which builds the application itself, serves three deploys from it the way
`docs/deploy/nginx.conf` does, and keeps the legacy worker pinned byte for byte
as its control. Mutation-proved.

**After every web deploy:** `curl https://app.letscube.ru/sw.js` must show the
`@kub-sw-build` line with a 16-character id. Each client's first launch after
this one deletes `kub-app-shell-v2`.

## D-073 `[x]` A failed build-file request was answered with the offline page

**Severity:** medium. Offline or on a flaky network, every engine.

**Surface:** the cache-first path in `artifacts/kub/public/sw.js:168`.

**Defect:** on a network failure with a cache miss, `staleWhileRevalidate`
answered every request — scripts, stylesheets, images — with `offline.html`.
Measured: `fetch` of a dropped `/icons/…` or `/assets/…` returned
`200 text/html` in Chromium and in WebKit.

**Fixed** in `7381bed`: `offline.html` answers navigations only (`sw.js:164`); a
build file that cannot be fetched fails the way the network failed. Pinned in
both engines, beside a control that shows the legacy worker producing the HTML
answer.

## D-074 `[x]` The backend was kept out of the cache by a host production does not use

**Severity:** low, latent.

**Surface:** the request filter in `artifacts/kub/public/sw.js:138` and `:145`.

**Defect:** `isSupabaseUrl` matched `.supabase.co`, and production's backend is
`core.letscube.ru`, so only the origin check below it kept storage out of the
cache. Two statements in D-067 leaned on the host test and were right only
because of that check.

**Fixed** in `7381bed`, with no host list at all: the worker answers only this
origin's navigations and an explicit list of build files (`isBuildFile`,
`sw.js:205`), and everything else — another origin, or a backend path proxied
onto this one — reaches the network untouched. Only a complete 200 that is not
the SPA fallback page is stored; range and cache-bypassing requests pass
through.

## D-075 `[x]` The installed iPhone app had no documented placement, and nothing pinned to an edge read the insets

**Severity:** high on the installed iPhone app. Every screen, in both
orientations.

**Surface:** the viewport meta in `artifacts/kub/index.html`; the `--kub-safe-*`
tokens on `:root` in `artifacts/kub/src/index.css`;
`artifacts/kub/src/lib/safeArea.ts`; and every surface pinned to an edge, among
them `AppTopBar.tsx:64`, `KubHeader.tsx:27`, `AppUpdateBanner.tsx:93`,
`ChatHeader.tsx:284`, `BottomNav.tsx:64`, `SupportWindow.tsx:58`,
`ChatList.tsx:102`, `NotificationBell.tsx:110`, `ChatInfoPanel.tsx:198` and the
message menus in `MessageBubble.tsx:866` and `:1071`.

**Defect:** without `viewport-fit=cover` iOS placed the installed app by a
guess, so nothing could rely on where the page's edges were — and nothing tried
to: four places read the top inset, five the bottom and none the sides. The chat
header, the chat-list header and the top bar sat under the status bar and the
Dynamic Island; the update banner under the island; the chat header's phone menu
on the home indicator; held sideways, the sidebar and the composer under the
notch. A message's action menu sat at `bottom: 12` on a phone, over the home
indicator, and held sideways clamped 8px from the glass, under the notch.

**Fixed** in `ea89851`; the message menus in `2fda578`. `viewport-fit=cover`
makes the placement a documented contract. The four tokens read `env()` once and
everything else reads the tokens; a unit test fails on any other
`env(safe-area-inset-*)`, because Playwright's WebKit reports every inset as 0
and only a token can be given a value there. Headers, sheets and bars pad the
inset out of themselves, so the material runs under the hardware while the rows
start clear of it; shells pad the sides; the support window, the contact card,
the notification panel and the chat list's menu are placed in the safe viewport.
The message menus read the insets when they open — not during render, and not on
every scroll. Rule 13 of `docs/operations/interface-material.md` is the
contract.

**Regression tests:** `tests/e2e/ios-standalone-safe-area.spec.ts` on the new
`webkit-ios-standalone` project, insets through the tokens, portrait and
landscape (22/22), plus a Chromium half on `chromium-mobile-390` that overrides
the insets inside the engine; the opt-in signed-in half
`ios-standalone-safe-area.signed-in.spec.ts`, which switches screenshots, traces
and video off and submits nothing (11/11 once, on a QA account);
`tests/unit/safe-area-insets.test.mjs` and `safe-area-geometry.test.mts`. The
menu fix: three mutations, each red on exactly the orientation it belongs to.

**Not verified on a device.** Playwright's WebKit on Windows lays the page out
but neither reports insets nor paints `backdrop-filter`, so these are layout
proofs. The Android APK is unaffected for now: Capacitor 8.3.4 hands the insets
to the page only on a WebView of 140 or later and only with `cover`, and the
owner's phone runs WebView 137. An APK that meets a WebView of 140 or later
becomes edge to edge on the same tokens, and needs an on-device pass before it
ships.

## D-076 `[x]` The composer summed the keyboard and the home indicator

**Severity:** medium. The installed iPhone app, every conversation, whenever the
keyboard is open.

**Surface:** the composer's bottom padding in
`artifacts/kub/src/components/chat/ChatWindow.tsx:945`.

**Defect:** the composer padded the keyboard's inset plus the home indicator's,
but with the keyboard up the home indicator is behind the keys. The sum left a
34px strip of empty glass between the composer and the keyboard.

**Fixed** in `ea89851`: `max(var(--kub-keyboard-inset, 0px), var(--kub-safe-bottom))`
— the larger of the two, never both. **Regression test:**
`tests/unit/safe-area-insets.test.mjs:214`.

## D-077 `[x]` The docked support window put its close button under the island and its send button on the home indicator

**Severity:** medium. The support window on a phone: its close button, and, for
someone with no tickets, its only action.

**Surface:** `artifacts/kub/src/components/support/SupportWindow.tsx:318`, the
docked header, and `:511`, the new-request form.

**Defect:** the status-bar padding was applied to the floating shape, which is
never under the status bar, instead of the docked one, which is — so docked on a
phone the close button sat under the Dynamic Island. Separately, someone with no
tickets opens the window straight into the new-request form, which docked runs to
the bottom of the screen with 12px of padding and so put its send button on the
home indicator; the reply footer below it already cleared the inset. The second
half was found by the signed-in stand, which the fixture screens cannot reach.

**Fixed** in `ea89851` (the header) and `a76af25` (the form). **Regression
test:** `tests/unit/safe-area-insets.test.mjs:245` holds both of the docked
window's bottoms.

## D-078 `[x]` Held sideways, the sidebar menu was taller than the phone and could not scroll

**Severity:** medium. A phone in landscape: «Выйти», the menu's last item, was
cut off with no way to reach it.

**Surface:** the sidebar header's menu in
`artifacts/kub/src/components/sidebar/SidebarHeader.tsx:187`.

**Defect:** the menu was `overflow-hidden` with no height cap, so on a screen
393px tall it ran past the bottom edge and clipped its last items.

**Fixed** in `ea89851`: capped at
`calc(100dvh - var(--kub-safe-top) - var(--kub-safe-bottom) - 8.5rem)` and
scrollable. **Regression test:** the landscape scenario "the sidebar's own menu
and the notification panel" in `tests/e2e/ios-standalone-safe-area.spec.ts`.

## D-079 `[x]` Light theme: the status bar's glyphs vanished into the installed app's header

**Severity:** high on the installed iPhone app in the light theme — the clock,
the signal and the battery.

**Surface:** `apple-mobile-web-app-status-bar-style` in `artifacts/kub/index.html`,
and the band `html.light[data-ios-standalone] body::before` in
`artifacts/kub/src/index.css`.

**Defect:** `black-translucent` draws the status bar over the page, and with
`viewport-fit=cover` (D-075) the page is under it. In the light theme the
header's glass is nearly white, and the glyphs disappeared into it. The meta tag
cannot follow the theme: iOS reads it once, when the app is added to the home
screen.

**Fixed** first in `98b21ce` with a translucent veil — 0.6 of the dark ground
over the top inset, in the installed app only (`navigator.standalone`). Rendered
and shown to the owner before shipping, the grey it made over the light screen
was rejected. **Re-decided on 2026-09-11:** an opaque band of the brand's blue,
`#3D78B8` — of two rendered variants, a flat band and a soft-edged one, the
recommended flat one, applied on the owner's instruction to recolour the grey,
and confirmed by the owner once shipped ("красиво смотрелся ровный синий").
Opaque, so it no longer changes with what scrolls under it. Mid-toned,
because the glyphs' colour is iOS's to choose — the documentation for this style
says white, while screenshots from the owner's iPhone show dark glyphs over the
light theme — and this colour gives white 4.59:1 and black 4.58:1, within a
hundredth of the widest margin any colour can give both.

**Regression tests:** `tests/unit/ios-status-bar-legibility.test.mjs` holds the
premise, the installed-app gate, the band's geometry and both contrasts; the
WebKit stand photographs the band and measures white against its lightest pixel
and black against its darkest.

**Not verified on a device.** Which colour iOS gives the glyphs in the installed
app — in each theme — is the first thing to look at on the iPhone.

## D-080 `[x]` The time placement can loop until React gives up, and the whole interface falls over

**Severity:** high when it happens — every screen is replaced by «Произошла
ошибка интерфейса». Not seen with the layout as shipped; reproduced at once by
changing one length. Found 2026-09-11 while rendering the D-071 options.

**Surface:** the placement state in
`artifacts/kub/src/components/chat/MessageBubble.tsx:540`, decided at
`:613`–`:638` and re-measured from the layout effect at `:668`.

**Defect:** the decision measures boxes that the decision itself resizes, and
nothing bounds how often it may change its mind. At a 40px action lane at least
one message never settles: every commit sets a new placement, until React stops
with "Maximum update depth exceeded" and the error boundary takes the interface
down. The likely mechanism is the one D-071 describes — a cap that follows a row
shrink-wrapped around the message — turned from a wasted line into a loop.

**Reproduction:** the DEV preview fixture with the 120-message conversation of
`message-meta-spacer-line.spec.ts`, at 768x1024, then
`--kub-action-lane: 2.5rem` and nothing else. Within three seconds the console
reports "Maximum update depth exceeded" and the application renders its error
screen. Hiding two of the three hover buttons without touching the lane does not
do it; the lane width alone does.

**With the layout as shipped:** on the same fixture, every viewport width from
640px to 1280px in 5px steps — 129 widths, each with the whole conversation
rendered — settled with no error screen and no application error, as did 640px
to 1100px in 20px steps before it. That covers viewport widths on one fixture,
not every message text or every chat-pane width a resizable window can produce.

**Fix direction:** make the decision unable to oscillate — decide against widths
that do not move with the placement, as D-070 did for the reach, or keep the
first anchored answer for a given content and container width — and add a
regression test that applies the 40px lane and requires the conversation to
settle without an error.

### Closed 2026-09-11 — `9d78cd1`

**Measured** on the fixture's 120-message conversation at 768x1024 with a 40px
lane: two own messages changed placement 52 times each before React gave up.
Inline, the 92px spacer carried the bubble's row to its full 376px, the stack
cap resolved to 336px, the text sat on one 288.8px line, and 288.8 + 83.3 + 8 >
352 chose anchored. Anchored, the row shrank round the text to 314.8px, the cap
followed to 274.8px, the text wrapped to a 45.4px last line, and 45.4 + 83.3 + 8
≤ 290.8 chose inline. Before the fix 768px looped at 2rem and 2.5rem and 900px
at 2rem, 2.5rem and 4.375rem; 640, 1024, 1280 and the shipped lane settled.

**Fix:** `artifacts/kub/src/lib/messageMetaHold.ts`, applied in
`MessageBubble.tsx`. The inline layout is the one on the wider row, so the
anchored answer it gives stands, and an inline answer measured on the anchored
layout it produced cannot overturn it until something other than the placement
changes: the inputs (text and footer marks, the message row's width, the stack
cap, the box cap, the footer's width), or the text as the anchored layout set
it. That second condition is WebKit's: about 1.3s in it re-lays the
conversation — four lines to five in the same 309.4px paragraph — and holding on
the inputs alone turned the spacer-line spec red there. An inline layout whose
spacer has not yet reached its reserved width (84px on screen against a 92px
reserve when Inter arrived) is taken but not held.

**Regression tests:** `tests/e2e/message-meta-placement-settles.spec.ts` —
lanes of 2rem, 2.5rem, 4.375rem and 6.5rem from 640 to 1280, a different lane
per side, a lane from first paint, a resize, a lane removed — was 6/6 red before
and is 6/6 green after on chromium-desktop-1440 and chromium-mobile-390;
`tests/unit/message-meta-hold.test.mts` 11/11. At the shipped lanes no message
moved: 0 of 960 placements differ on Chromium from 360 to 1920, 0 of 600 on
WebKit from 360 to 1024. Seventeen mutations, SHA-256 checked each time, fifteen
red; leaving out the cap alone or the row alone stays green, because the
fixture's resize moves both, and together they are red. Taken onto the branch
from agent H's worktree (`b548e29`) unchanged.

**Found on the way, not changed:** `getMaxContentWidth` reads
`--kub-action-lane` with `parsePixelValue`, which accepts only `px`, and a
custom property comes back as its declared text — `6.5rem` — so wherever the
stack cap cannot be resolved the decision measures as if there were no lane
while CSS reserves 104px. That is where the 352 against 336 above came from.
D-071 removes the lane; any lane that stays must be declared in `px` or
resolved before it is read.

**Not verified:** selection mode, edits, pins and read counts on a held message;
a sidebar toggle without a resize; replies; the new spec on WebKit with a
non-zero lane; devices.

**After D-071, 2026-09-11.** The message actions removed the lane: a stack's cap
now follows the viewport, and the room for the hover ❤️ is padding on the row.
The settle spec drove `--kub-action-lane` and checked that the caps took it, so
on that layout it failed its own premise. It now injects the rule the product
used to ship. With that rule it passes — and it also passed with the hold
switched off in `MessageBubble.tsx`, because the new rows no longer shrink round
the message with its placement, so the loop cannot start. The spec is kept as a
guard that the placement settles under any cap that follows the row, and says
so; the hold's regression proof is `tests/unit/message-meta-hold.test.mts`.

## D-081 `[x]` Forwarding a message said nothing, whatever the server answered

**Severity:** high. Every forward in every shell: a refused forward and a
delivered one looked identical. Testers' complaint 5, 2026-09-11.

**Surface:** `forwardMessage` in `artifacts/kub/src/hooks/useMessages.ts:1163`,
the `ForwardModal` handler in `artifacts/kub/src/components/chat/ChatWindow.tsx`,
and the new `artifacts/kub/src/lib/messageForward.ts`.

**Defect:** choosing a chat closed the dialog and nothing else happened.
`forwardMessage` sent a refusal to the console and returned null, and its caller
closed the dialog without reading the answer. Against route mocks, delivered,
refused (42501) and unreachable produced the same screen.

**Fixed** in `68130ef`. `forwardMessage` answers `{ ok, error }` with the reason
mapped by `mapPgError`, as `togglePin` and `hideMessageForMe` already do. The
action-feedback viewport shows a status card naming the chat and closes the
dialog on delivery; a refusal or a network failure is an alert carrying its
reason, and the dialog stays open, because the choice is where the next attempt
starts. One feedback key, so a successful retry replaces the failure.

**Regression tests:** `tests/e2e/message-forward-feedback.spec.ts`, on route
mocks of the fixture host — it refuses any other configuration and aborts every
non-local request — was 3/3 red before the change and is 6/6 green on
`chromium-desktop-1440` and `chromium-mobile-390` after it.
`tests/unit/message-forward-feedback.test.mts` is 5/5. Seven mutations each
turned red on the assertion aimed at them and were restored byte for byte.

## D-082 `[x]` Emoji targets were 28px tall under a finger

**Severity:** medium. Every phone and tablet: the composer's emoji picker, the
reaction catalog, both quick-reaction rows, the folder and topic icon pickers.
Testers' complaint 7, 2026-09-11.

**Surface:** `artifacts/kub/src/components/ui/EmojiCategoryPicker.tsx`; the
quick row and the quick picker in
`artifacts/kub/src/components/chat/MessageBubble.tsx`;
`artifacts/kub/src/components/chat/TopicCreateModal.tsx`.

**Defect:** one dense size for every pointer. Under a finger on the DEV fixture:
a composer cell was 39.5x28 at 390 and 35.8x28 at 360, a catalog cell 40.5x28,
the category tabs 28 tall with 9px labels, the search field 32. The menu's quick
reactions were 42 wide at 360, and 30.6x40 wherever the 256px desktop menu opens
under a finger (a phone held sideways, a tablet); the hover quick picker was
32x32, the folder icon picker 40.3x36, the topic icons 32x32.

**Fixed** in `04258ee`, on the bargain D-015 made for buttons. Under
`(pointer: coarse)` every target is at least 44x44: `auto-fill` columns of 44px
instead of eight fixed ones, the glyph from 18 to 24px, the compact tab label
from 9 to 12px, the grid's window bounded by `min(10rem, 25dvh)` so a phone held
sideways keeps the picker on screen, the menu 336px wide and the quick picker
340px, lifted clear of its trigger by its taller height. They are written as
`pointer-coarse:` utilities beside the ones they replace, because a
component-layer rule would lose to them (rule 10 of
`docs/operations/interface-material.md`). A cursor keeps 28px cells in eight
columns, a 256px menu and 32px quick reactions, measured identical before and
after.

**Regression tests:** `tests/e2e/emoji-touch-targets.spec.ts` — a finger at
390x844, 360x800, 844x390 and 820x1180, a cursor at 1440x900 — was red on 13 of
its 17 checks before the change and is 17/17 on Chromium after it; on WebKit 15
pass and 2 skip, the two inset checks only Chromium can drive. Ten mutations each
turned red on their own assertion. The picker bounds in
`tests/e2e/visual-style-layout.spec.ts` now follow the pointer (336 and 318px
under a finger); that spec signs in and was not run with the change.

**Not verified on a device.** The folder and topic sizes were measured by a
scratch script on a mocked backend, not by a committed test.

## D-083 `[x]` Forwarded media lose their previews

**Severity:** medium. Every forwarded photo or video. Found 2026-09-11 while
fixing D-081; testers' complaint 10 names it beside forwarding several messages.

**Surface:** the insert in `forwardMessage`,
`artifacts/kub/src/hooks/useMessages.ts:1173`–`:1182`; the variant lookup in
`artifacts/kub/src/hooks/useMediaVariants.ts:193`.

**Defect:** the copy carries `media_url` only — not `media_bucket`, `media_path`
or `media_metadata` — and preview variants are keyed by the source message's id,
so the new message finds none. The storage read policy
(`20260506_secure_chat_media_access.sql:90`–`:98`) is scoped to the source
chat's folder, which may also deny the object itself to members of the target
chat; that was read from the migration, not checked against the database.

Since D-092 a forward loses more than the variants: an original's `uncompressed`
flag and its preview are in `media_metadata` too, so a forwarded original is
drawn from the full file and loses its «Оригинал» mark.

**Fixed** in `0f29b20`, not yet applied to production, and in `6556ba1`, from
agent L, together with the forwarding item. `forward_message` makes the copy on
the server from its own row of the source — `media_url`, `media_bucket`,
`media_path` and the whole `media_metadata` — after the checks a direct insert
gets, a member of the target who is neither banned nor muted, and two more: the
caller has to be able to see the source, and a topic has to be the target's. The
source's ready variants are copied onto the copy, scoped to the target chat and
pointing at the same files, so the previews appear at once and nothing is
generated twice; no policy is widened. Where the function is missing, the copy
the client makes now carries the media fields, so the worker renders its
previews.

**Regression tests:** `tests/e2e/message-forward-feedback.spec.ts`, whose answers
are now `forward_message`'s, with the fallback that keeps a photo's media; the
rehearsal of `20260911144000`, under D-100.

**Not verified:** a forward of an original between two real accounts. A copied
preview's path still names the source chat and message, which grants no read of
either.

## D-084 `[ ]` On a phone, a feedback card covers the top of a full-screen sheet

**Severity:** low. The card can be dismissed and leaves by itself after five
seconds. Found 2026-09-11 while fixing D-081.

**Surface:** the viewport's position in
`artifacts/kub/src/components/kub/KubFeedbackViewport.tsx:69`,
`fixed inset-x-0 top-[calc(var(--kub-safe-top)+6.75rem)] z-[70]`.

**Defect:** at 390 a refused forward's error card, about 131px tall, sits over
the forward sheet's preview and its chat search — exactly where the next attempt
starts.

## D-085 `[x]` A draft that wraps paints the composer over the newest message for two frames

**Severity:** medium. Every conversation at every width, on each line a draft
gains or loses. Half of testers' complaint 3, «текст прыгает, когда печатаю»,
2026-09-11; D-086 is the other half.

**Surface:** `artifacts/kub/src/hooks/useMeasuredHeight.ts`, lines 66–70 at
`0b69e38`.

**Defect:** the composer dock overlays the list, which pads itself by the dock's
measured height. The height came from a ResizeObserver that deferred the read to
`requestAnimationFrame`, and the state update made there was applied a task
after that frame. Measured on the DEV preview fixture, identically at 390x844
and 1440x900: the keystroke that wraps painted two frames with the composer 24px
over the newest message (its clearance 26px → 2px) before the conversation
jumped 24px; unwrapping opened a 50px gap for two frames.

**Fixed** in `d497c11`: the observer commits the height inside its own callback
with `flushSync`, after layout and before paint. After: the composer and the
newest message move −24/−24 and +24/+24 in the same frame on Chromium 390 and
1440 and on WebKit 390, with no "ResizeObserver loop" error, which monitoring
would report. The draft's own text does not jump at the 140px cap: its
`scrollTop` follows the caret in one step. `flushSync` inside a ResizeObserver
was checked on Chromium and WebKit, not on Firefox.

**Regression tests:** `tests/e2e/composer-typing-frames.spec.ts`, whose sampler
records what each painted frame holds; `tests/unit/composer-height-same-frame.test.mjs`.
Restoring the deferral fails both, on both engines.

## D-086 `[x]` Every message re-rendered whenever the list did, and on any store change

**Severity:** medium: jank that grows with the conversation, and the other half
of complaint 3.

**Surface:** the row props in `artifacts/kub/src/components/chat/MessageList.tsx`
(lines 915–926 and 1020–1072 at `0b69e38`) and the bubble's store read,
`artifacts/kub/src/components/chat/MessageBubble.tsx:811` at `0b69e38`.

**Defect:** rows were handed values that were new on every render — inline
callbacks, delivery and read-receipt objects rebuilt per call, the whole message
map — and each bubble subscribed to the whole store through `useAppStore()`
without a selector, which a `memo` above it cannot stop. A draft that wraps
changes the list's padding, a prop, so every bubble rendered again. Seven
keystrokes with one wrap and one unwrap rendered 96 bubbles, all 48 twice; two
store changes that touch no message rendered 96.

**Fixed** in `19aaba0`: each message is a memoised `MessageRow` around a
memoised bubble; one `rowActions` object, created once, reaches the current
handlers through a ref; optional handlers arrive as booleans; receipts are
memoised; the bubble gets only its reply target and reads the store through a
selector. Row markup, `key`, `data-message-id` and the scroll effects are
unchanged. After: 0 bubble renders in both cases on three projects, while
`ChatHeader` still renders on the store changes, so they do reach subscribers.

**Cost:** a bubble reads the window's size while rendering, for its context
menu's shape and height, and it now renders less often on a resize. A menu takes
the size when it opens and the time placement has its own ResizeObserver, but a
window resized while a menu is open keeps the old menu shape until the bubble
next renders. The render counter relies on React 19.1 internals, and the store
test imports `/src/store/app.store.ts` through Vite's URL, checking in the test
that it is the application's instance.

**Regression tests:** `tests/e2e/message-render-stability.spec.ts`;
`tests/unit/message-render-stability.test.mjs`. A fresh actions object per
render, or the store read without a selector, brings back 96. The fixture §11
contracts — chat entry, the glass layout and four message-meta specs — pass
48/48 at 390 and 1440. "Unread → first unread", the history-prepend anchor and
fast upward scrolling have no fixture e2e (the fixture forces no unread and
cannot load history); `message-history-anchoring` and `own-send-scroll` hold
them from the source, both green.

## D-087 `[x]` A photo could not be zoomed

**Severity:** medium. Every photo opened in the viewer, on every platform.
Testers' complaint 1, 2026-09-11.

**Surface:** `artifacts/kub/src/components/chat/MediaViewer.tsx:124` at
`0b69e38`. Page zoom is disabled on purpose in `artifacts/kub/index.html:15`,
which is unchanged.

**Defect:** the viewer drew a plain fitted `<img>` with no zoom, and the page
refuses page zoom, so a photo could only be seen fitted.

**Fixed** in `c1a1d2d`, with fixture support in `78c93d2` — a fixture message
may carry a `data:image/` picture, and the capture page opens the real viewer
from its bubble: pinch; double tap and double click, 2.5x at the point and back;
Ctrl+wheel through a non-passive listener, which is also how a trackpad pinch
arrives in Chromium, WebView2 and Firefox; drag to pan while zoomed. The
arithmetic is in `artifacts/kub/src/lib/mediaZoom.ts`: 1–4x, the point under the
finger or cursor kept, a picture that cannot leave the stage, an exact return to
rest. Zoom resets on close and per photo; a drag at rest is not claimed; the
stage clips only while zoomed, inside the safe-area frame of rule 13. At rest the
viewer is pixel-identical to the previous one at 390x844 and 1440x900.

**Not handled or not verified:** Safari's trackpad pinch on macOS and iPadOS
arrives as gesture events, which are not handled. A real finger pinch on an
iPhone or an Android phone, and `touch-action: none` in iOS Safari, are not
verified on a device.

**Regression tests:** `tests/unit/media-zoom.test.mts` (11);
`tests/e2e/media-viewer-zoom.spec.ts`, 8 tests, 24/24 on Chromium 390 and 1440
and WebKit 390 — the mouse as real input, touch as synthetic pointer events,
Ctrl+wheel on mobile WebKit as a synthetic wheel event, rule 13 with iPhone
insets. Mutations of the focus point, the pan limit, the double tap, a passive
wheel listener and the stage clip each fail.

## D-088 `[x]` The chat list refetched and rendered whole on every message, receipt and focus

**Severity:** medium. Every signed-in session, on every message in any chat.
Testers' complaint 12, 2026-09-11.

**Surface:** `artifacts/kub/src/hooks/useChats.ts` (lines 86–93, 255–309,
343–379 and 404–435 at `8341d1d`), `store/app.store.ts`,
`components/sidebar/ChatList.tsx` and `ChatListItem.tsx`,
`components/chat/ChatWindow.tsx`, `hooks/useTopics.ts`, and the receipts in
`components/chat/MessageList.tsx`.

**Defect:** every `messages` INSERT or UPDATE, and every UPDATE of the user's
own `chat_members` row, refetched the whole list — the memberships, the chats
with their members, and the summaries RPC — and focus and visibility changes
refetched it again. `setChats` took a changed list whole, rows were not memoised
and were handed fresh objects, the chat window read the whole list and
`useTopics` the whole store. Measured on the fixture backend at 1440 and 390:
one message in another chat made two full refetches, six requests, and rendered
all six rows twice and 28 message rows; a focus refetched the list and rendered
every row; a peer's receipt rendered all 14 of my messages. And an HTTP error on
the memberships read emptied the list and closed the open chat.

**Fixed** in `546341d`, with the conversation's receipts in `a5ff648`, both
from agent I's worktree. Each event is applied to its own chat in
`lib/chatListDelta.ts`; what an event cannot settle asks the summaries RPC for
that chat alone, and events that arrive during a fetch are replayed over its
result. The store keeps unchanged chats as the same objects, and rows are
memoised. Focus no longer refetches: coming back revalidates after 15 s hidden,
after a back-forward restore and on online, and a rejoined channel revalidates
once. After: the message makes no chat request and renders its own row twice —
the message, then its delivery mark; a focus or a 2 s absence makes no chat
request and renders nothing; a receipt renders one row and one message.

**Hardened after review** in `ae64273`. The chat tables keep the default
replica identity on production (read from `pg_class` on 2026-09-11), so a
Realtime UPDATE can leave out a column Postgres stored out of line and did not
change — a long last message's text when only its pin changes. The delta
applied a `null` there and would have blanked that preview until the next
revalidation; it now keeps the preview's value unless the message is being
deleted.

**Regression tests:** `tests/e2e/chat-list-event-cost.spec.ts` (`a3186a0`),
counting requests and renders per event on a mocked Realtime socket — 13 red on
the unfixed code, 17 passed and 1 skipped after, at 1440 and 390; unit tests
`chat-list-delta`, `chat-list-delta-partial-update`, `structural-sharing`,
`resume-revalidation`, `group-read-receipt-face`, `chat-list-event-wiring` and
`chat-list-change`. Fifteen mutations on the agent's side and one on the
hardening each turned red and were restored byte for byte.

**Not verified:** real Realtime — every event in the spec is mocked, a rejoin
and the shape of `chat_members` UPDATE rows included; the path without the RPC;
the 15 s threshold on a phone, the installed iPhone app, Tauri and Android;
back-forward restore; WebKit; typing indicators, mute and the notification
centre on their own. Focus still requests notifications (`useNotifications`).

## D-089 `[x]` Reopening a chat fetched its history twice and rendered it twice

**Severity:** medium. Every chat switch. Testers' complaint 13, 2026-09-11.

**Surface:** `artifacts/kub/src/hooks/useMessages.ts` (lines 87, 175–182, 252,
452–473, 487–495, 527, 625–639, 677–681, 737–752 and 1235–1242 at `8341d1d`)
and the deferred bottom pass in `components/chat/MessageList.tsx` (668–677,
782–789).

**Defect:** the history was fetched on mount and again when the channel joined;
`cleared_at` was read twice, the pins were refetched whenever the clear mark was
set, and visibility and online reconciled repeatedly. The hook subscribed to
every chat's messages and returned new arrays on every render. Leaving and
reopening a 40-message chat read `chat_members` three times, fetched the
history twice and rendered 96 message rows. Worse, against §11: a reopened chat
with unread messages was placed from a store that lacked them, and a deferred
bottom pass that nothing cancelled then moved the reader from the first unread
message to the bottom — placed at 209 ms, at the bottom at 288 ms.

**Fixed** in `a5ff648`, from agent I's worktree. A chat fetched this session
renders from the store and revalidates once, after its channel joins; a chat
with unread messages that arrived while it was closed is fetched before
placement; `cleared_at` is read once; a message that arrived whole is not
refetched; and the bottom pass applies only to a reader still at the bottom.
After: one read of each, 40 rows rendered once, and the chat with 24 unread
messages lands on the first of them.

**Regression tests:** the same spec — reopen, switch back, reopen with unread —
and `tests/unit/chat-list-event-wiring.test.mjs`. A mount fetch, a store that
takes the refetch whole, the unguarded bottom pass and placing an unread chat
from the store each fail it.

**Not verified:** the first opening of a chat with unread messages, search and
notification jumps, the history-prepend anchor and fast upward scrolling are
held by source-scan unit tests and `chat-entry-scroll`, not by this spec; a
clear of the history on another device within about 3 s of opening can leave
the reused `cleared_at` stale.

**A database proposal, not applied:** a revalidation that fetches only what
changed would need `messages.updated_at` kept by a trigger, touched by reactions
too, and a `chat_messages_changed_since` function. Agent I drafted it with its
caveats — the trigger function's owner must own `messages`, and every reaction
would add a Realtime UPDATE on `messages`. Nothing in this entry needs it.

## D-090 `[x]` A reopened chat kept the old copy of what changed while it was closed

**Severity:** medium. Every chat reopened after an edit, a deletion or a
reaction in it, and more visible since D-089 made reopening render from the
store. Found 2026-09-11 by agent I while fixing D-089.

**Surface:** `mergeMessagesById` and `chooseMergedMessage` in
`artifacts/kub/src/hooks/useMessages.ts`, lines 1475–1518 before the fix.

**Defect:** the revalidation merged the fetched page into the held messages
with the fetched copy offered first and a chooser that returned the second copy
it was given, so for every message both sides had, the held copy won. An edit, a
deletion or a reaction made while the chat was closed came back in the fetch and
was dropped; the old text stayed until a reload.

**Fixed** in `e0e64c1`. The merge is `artifacts/kub/src/lib/messageMerge.ts`
and knows which side each copy came from. Two server copies resolve to the
fetched one unless the held copy is provably newer — deleted where the fetched
one is not, or edited later — which is what a Realtime change that landed after
the fetch was taken looks like. A local send that is pending, checking or failed
gives way to its server copy and never replaces one. A reaction that lands
between the fetch and the merge has nothing to order it by, so the fetched
reactions stand until the next reaction event.

**Regression tests:** `tests/unit/message-merge.test.mts` 9/9; restoring "the
held copy wins" turns the edit, deletion and reaction cases red. The bot client
contract checks that `useMessages` delegates to the module and that the module
matches sends by actor.

## D-091 `[x]` In WebKit a desktop message menu finished opening invisible

**Severity:** high, never released. Wherever the message menu keeps its desktop
shape in Safari's engine — an iPad, a Mac, an iPhone held sideways — the
reaction bar and the action card ended their entrance at opacity 0 and stayed
there. Found 2026-09-11, when `emoji-touch-targets.spec.ts` failed on WebKit
alone after the D-071 message actions were integrated.

**Surface:** the desktop branch of
`artifacts/kub/src/components/chat/MessageActionLayer.tsx`: the column
`[data-message-menu="desktop"]` holding the bar and the card.

**Defect:** the column was hidden until placed — its own `visibility` flipped
from hidden to visible — and both surfaces inside it open with `kub-menu-in`. On
WebKit 26.4 at 844x390 under a finger the animation itself ran: its progress
read 0, .35, .57 and .79, and `animationend` fired at about 250 ms. The style
WebKit computed for both surfaces never left the first keyframe, opacity 0 and
`matrix(0.98, 0, 0, 0.98, 0, 4)`, and was still there 1.1 s later. The quick
reactions measured 43.12 px, which is 44 at .98, and that is how it surfaced.
A screenshot restyles the page: taken at that moment, it showed both surfaces
at rest, so a check by picture would have passed.

Overriding one property at a time in the running page left it stuck with the
backdrop filter taken off the bar or the card, the card's animation off, every
transition off, the bar's shadow off, the column as a block, absolutely
positioned or without its z-index, the full-screen click catcher gone,
`isolation` taken off both surfaces, or `will-change` or `isolation` put on the
column — thirteen runs in all. Forcing the column visible was
the only change after which both came to rest. Reductions to a blank page — a
surface with or without a backdrop filter or `will-change`, in a fixed wrapper
hidden for one or two frames and then placed — all animated normally, so what is
recorded is the product's shape, not a minimal case. In the same engine the
phone shape, where each surface is fixed and hides itself, came to rest by
325 ms; the hover column, which also hides itself, came late, at opacity .99
from 180 to 700 ms. Chromium 147 animated every shape smoothly.

The spec's own wait had waited for nothing: it finished the animations the
document listed, and WebKit listed none.

**Fixed** in `b6eb2e0`. The column keeps only its position, and the bar and the
card each carry their own visibility until it is placed (`shownOncePlaced`), as
a phone's surfaces already did. The rule is 14 in
`docs/operations/interface-material.md`.

**Regression tests:** `tests/e2e/emoji-touch-targets.spec.ts` now waits for
every `kub-menu-in` surface to reach opacity 1 with no transform, read from the
computed style, and fails naming any that does not: 49 passed and 2 skipped (the
two inset checks only Chromium drives) on webkit-mobile-390,
chromium-desktop-1440 and chromium-mobile-390. With the column flipping its own
visibility again, WebKit fails at 844x390 and 820x1180 with "an entrance did not
come to rest", naming «Реакции» and «Действия с сообщением» at opacity 0, while
both phone widths pass.

**Not verified on a device.** Whether Safari on an iPad or a Mac draws the menu
invisible is not known; the fix removes the shape either way.

## D-092 `[x]` A photo or a video could only be sent compressed

**Severity:** medium. Every photo from every shell, however it was picked.
Testers' complaint 2, 2026-09-11.

**Surface:** `stageFiles` in `artifacts/kub/src/components/chat/ChatWindow.tsx`,
281–364 at `65475f6`; `prepareChatImageAttachment` and `optimizeRasterImage` in
`artifacts/kub/src/lib/mediaUpload.ts`, 52–63 and 146–180; the attach menu in
`MessageInput.tsx`, 748–783; «Открыть оригинал» in `MediaViewer.tsx`, 71–73.

**Defect:** every JPEG, PNG and WebP was re-encoded on the canvas to a WebP of at
most 1920px at 0.84 before upload — picked, pasted or dropped — and nothing let a
person opt out. The original never left the device, so «Открыть оригинал» opened
the copy.

**Fixed** in `5f5a5b7`, `43419f0`, `b3efbc8` and `5e6989c`, taken onto the
integration branch from agent K's `8ea11bb`, `0ef5690`, `ba2f5f3` and `c657115`.
Its six conflicts with the D-071 message actions were each two additions in one
place; a script kept both sides and would have refused a block where one side
had removed a line the other kept.

- The decisions are in `lib/mediaCompression.ts`, and compressed stays the
  default.
- A phone offers «Без сжатия» under «Фото или видео». A desktop opens a send
  dialog for any batch with a photo or a video in it, «Сжать изображение»
  checked.
- An original is uploaded as picked, less the place it was taken (D-098), and
  refused above 50 MB before anything reads it.
- A 1280px WebP preview is stored at a path derived from the original's, and the
  metadata carries `uncompressed` and `preview`; a preview is read from that
  derived path and nowhere else.
- The bubble draws the preview and marks the photo «Оригинал». The viewer zooms
  the original, and an original video plays the original.

**Regression tests:** `tests/unit/media-compression.test.mts`, 8.
`tests/e2e/media-send-without-compression.spec.ts` was 6 red before the change,
and is 12 passed and 12 skipped by shape on chromium-desktop-1440,
chromium-mobile-390 and webkit-mobile-390 since `e3d0b93` let it run on
WebKit. There its own harness had failed the phone's three checks: it aborted the
`blob:` load that decodes a picked photo, and it read upload bytes WebKit does not
hand an intercepted request. The agent's 17 mutations were each caught, every
file hashed before, during and after. `video-transcode-frontend.spec.ts` kept
looking for the metadata key in `ChatWindow.tsx` after it moved, and follows it
now, in the same commit.

**Not verified:** devices, real storage and TUS, the worker on an original, a
whole video original, paste and drop into the dialog, the dark theme. For the
backend, in tracker queue 21: the bucket's `file_size_limit` and Storage's global
`FILE_SIZE_LIMIT` must admit 52 428 800 bytes, and 262 144 000 for the videos the
client already allows; `allowed_mime_types` must admit the originals' types and
`image/webp`; the worker can skip `video_720p` for an uncompressed video; it
decodes a source whole, so a 50 MB photo is a new load on its memory; and a
deleted message's `{stem}.preview.webp` is not in `media_variants`, so it would
be left behind.

## D-093 `[x]` A group of two to four members read «4 участников»

**Severity:** low. **Surface:** `artifacts/kub/src/lib/chatDisplay.ts:76`, and the
same count in `ChatHeader.tsx:166` and `ChatInfoPanel.tsx:1230`, found while
fixing it.

**Defect:** the count was always written in the form for many.
`selectRussianPluralForm` in `lib/messageMediaSections.ts` already answered the
question.

**Fixed** in `a048415`: `memberCountLabel` in `lib/chatDisplay.ts` takes the form
from the last two digits, and the chat list, the header and the info panel all
draw through it.

**Regression tests:** `tests/unit/chat-display.test.mts`, counts from 0 to 111 and
the list subtitle; with the helper writing the form for many again, both fail. On
the DEV preview the four-member group reads «4 участника» at 1440 and 390.

## D-094 `[x]` «Открыть оригинал» had no name on a phone

**Severity:** low. **Surface:** `MediaViewer.tsx`, 110–117 at `65475f6`.

**Defect:** the button's words are `hidden sm:inline`, so below 640px it was an
icon without a name.

**Fixed** in `b3efbc8` with an `aria-label`. **Regression tests:** taking it out
failed the D-092 spec in the agent's mutation run.

## D-095 `[ ]` A new photo's worker copies do not reach an open chat without videos

**Severity:** low. Read from the source, not reproduced.

**Surface:** `artifacts/kub/src/hooks/useMediaVariants.ts`, 68–96 and 136–151.

**Defect:** variants are queried when the chat's message ids change, and polled
only while the chat holds a video. A new photo is queried before the worker has
run, and nothing asks again until another message arrives or the chat is
reopened.

## D-096 `[x]` A photo picked through «Файл» is still compressed on a phone

**Severity:** low; a decision for the owner.

**Defect:** in Telegram «Файл» sends a file as it is. A desktop now asks in the
send dialog; a phone compresses a picture picked through «Файл».

**Fixed** 2026-09-11 by D-119 in `bce98f3`: a pick from «Файл» is staged as it is on every
device, and says so under its name. The attach sheet of D-122 keeps the rule.

## D-097 `[ ]` «Открыть оригинал» on a compressed photo opens the compressed copy

**Severity:** low; wording.

**Defect:** for a compressed photo no original exists on the server, so the label
promises something that is not there.

## D-098 `[x]` An original photo, and every video, left with the place it was taken

**Severity:** high, for privacy. Every video ever sent, because a video is always
uploaded as picked, and every original photo since D-092, which is not deployed.
Found 2026-09-11 while taking D-092 in: the agent's report kept EXIF «as in
Telegram» and held that it could not be removed without re-encoding.

**Surface:** `stageFiles` in `ChatWindow.tsx`. Nothing in the client or the
worker took EXIF, XMP or a movie's metadata out of a stored original.

**Defect:** what the camera wrote went into the public `media` bucket with the
file, and to everyone holding its link: a JPEG's GPS directory, an XMP packet's
address fields, and a QuickTime or MP4 file's location items — `©xyz`, `loci`
and `com.apple.quicktime.location.*`.

**Fixed** in `0c0d15e`, as the owner was offered on 2026-09-11 — take out the
place, keep the orientation — with their word on it still to come.
`lib/mediaLocation.ts` changes the file in place and keeps its length, so no
offset in it moves. A JPEG's GPS directory is emptied — entries, coordinates and
count — with its pointer left; the XMP fields that name a place are blanked with
spaces; a movie's location items become padding of the same size. EXIF that
cannot be walked is blanked whole, orientation with it. `stageFiles` runs it on
everything uploaded as picked — an original, a video, and a picture the canvas
could not make smaller — and the metadata's `optimized` is now set by the
compression alone.

**Regression tests:** `tests/unit/media-location.test.mts`, 11, on files built
byte by byte; ten mutations, each red. In `media-send-without-compression.spec.ts`
a phone and a desktop send a real JPEG carrying a GPS directory, and the upload
has to hash to that file with exactly the directory zeroed, worked out from the
layout; with the call taken out of `stageFiles`, all three runs fail.

**Not handled, and not verified on a device:** a HEIC keeps its location, as a
PNG and a WebP keep their metadata; the second image of an MPF JPEG and the video
appended to a motion photo are not read; an extended XMP packet split across
segments is checked a segment at a time.

## D-099 `[x]` The details showed when a reader last read the chat, not when they read the message

**Severity:** medium. Every «Прочитано» in a private chat's details and every
time in «Кто прочитал». The owner asked on 2026-09-11 for exact read times, with
better read sync, before production.

**Surface:** at `f4f0537`, `MessageList.tsx:607–614`; the private read line, the
details and the readers view of `MessageActionLayer.tsx`; and
`groupReadReceipts.ts:37–48`.

**Defect:** a reader has one pointer per chat, `chat_members.last_read_at`, and
every one of those surfaces showed it: the moment they last read anything in the
chat, the same for every message they had read.

**Fixed** in `563055f`, not yet applied to production, and in `156236d` and
`6556ba1`, from agent L. Every advance of a pointer is recorded as an event by a
trigger, so every path that reads — the new report and an old client's
`mark_chat_read` alike — produces one, and the database can go out before the
client. `message_read_times` answers the sender, and only the sender, with each
other member's time: that of the first event whose pointer reached the message.
Events are kept seven days, a time is given for the messages of the last seven
days, and the migration schedules an hourly cleanup with pg_cron, which
production has. A time is shown only when both the reader and the person asking
show their presence («Показывать, когда я в сети»), the way Telegram ties read
times to the last seen; otherwise the details say «Время не показывается», and
the check marks, which are the pointer, stay. Where the server does not have the
function, the pointer is shown as before.

**Regression tests:** `tests/unit/message-read-times.test.mts`;
`tests/e2e/message-read-times.spec.ts`, 7, red on the unwired client; the
rehearsal of `20260911141000`, under D-100.

**Not verified:** Realtime between two real devices — an open details view asking
again when a pointer moves is covered by a unit test — and production.

## D-100 `[x]` A late read report marked unseen messages read, and a read mark could move backwards, into the future or on another member's row

**Severity:** medium. Found by agent L while building D-099.

**Surface:** `mark_chat_read` (`20260714090000`), which stores the server's
`now()`; the policy `chat_members update`
(`20260504_chats_membership_hardening.sql:339`), which lets a chat administrator
update any member's row.

**Defect:** a report stored the moment it reached the server, so one that arrived
late marked read what was sent while it was in flight. A direct PATCH could move
a mark backwards, or into the future, which zeroes the writer's own unread
counts, and a chat administrator could write another member's marks and forge
their read receipt — with D-099, a forged read time.

**Fixed** in `563055f`, not yet applied to production, and in `156236d` and
`6556ba1`. `mark_chat_read_through` takes the `created_at` of the newest message
the device drew, and never moves the pointer backwards or past the present. A
trigger holds every write of both marks to the same rule and keeps them to the
member alone; a role change by an administrator still goes through. The client
reports through a scheduler that sends nothing at or behind what it already
reported, and falls back to `mark_chat_read` where the function is missing.

**Regression tests:** `tests/unit/receipt-scheduler.test.mts` and
`tests/unit/read-mark-watermark.test.mts`; `tests/server/message-actions-db.test.mjs`,
9, in PGlite, on a stub of the objects the migrations touch. On a throwaway copy
of the production schema, as `postgres`, the five migrations of D-099 to D-102 and
D-083 with their self-checks, their five rehearsal tests, the five rollbacks in
reverse order, the migrations again and the tests again all passed, once
`243dd3d` let the tests run there: their users no longer name
`email_confirmed_at`, which the rehearsal image's `auth.users` lacks, and a ban or
a mute is made by a session without a user, which production's
`enforce_sanction_matrix` lets through.

**Known limit, found in review:** the trigger clamps to the start of its
transaction. A report that waited on the row's lock behind another can bring the
mark back by that wait, a matter of milliseconds, and the event recorded after it
can then come out of order and make a read time that much later. Clamping to
`clock_timestamp()` in the trigger and in the recorder would close it.

## D-101 `[x]` One reaction per person was a rule of the client alone

**Severity:** low. The owner's decision of 2026-09-11, under D-071: one reaction
per person per message, as in Telegram.

**Surface:** `toggleReaction` in `useMessages.ts` — a lookup, a delete and an
insert — and `public.reactions`, unique on (message, person, emoji).

**Defect:** the database took a second emoji from the same person, and two devices
choosing at once could leave two. Read from production on 2026-09-11: 24 people
hold more than one reaction on a message.

**Fixed** in `0f29b20`, not yet applied to production, and in `6556ba1`. A BEFORE
INSERT trigger holds every path to the limit under a lock per message and person,
and `set_message_reaction` makes the toggle in one call and answers with every
reaction on the message. The limit is one function,
`private.reaction_limit_per_message`, where a subscription would raise it, and the
uniqueness on (message, person, emoji) stays for that. Existing duplicates are left
for their owner's next choice to clear.

**Not applied yet, on purpose:** the client production runs, `0b69e38`, adds a
second emoji with an insert of its own, which this trigger refuses; the migration
goes out with the client that replaces a reaction instead.

**Regression tests:** `tests/e2e/message-reaction-rpc.spec.ts`, 2;
`tests/unit/message-reactions.test.mts`; the rehearsal of `20260911142000`, under
D-100.

## D-102 `[x]` A private chat could not delete the other person's message for both

**Severity:** medium. Testers' complaint 9, approved by the owner on 2026-09-11 as
Telegram does it.

**Surface:** at `f4f0537`, the delete dialog (`messageActions.ts:174–187`) offered
deleting for both for your own messages only, soft-deleted one by one, and another
person's message could only be hidden (`ChatWindow.tsx:763–778`).

**Defect:** neither person of a private chat could remove a message from both
sides, and a deleted message left «Сообщение удалено» where Telegram leaves no
trace.

**Fixed** in `0f29b20`, not yet applied to production, and in `6556ba1`.
`delete_messages_for_everyone` takes up to 100 messages of one chat, all or
nothing: in a private chat any message but a system notice, in a group only the
caller's own. The deletion is soft — `deleted_at` — and each one is recorded in
`private.message_deletions`, which no API role reads, so a particular deletion can
be reversed exactly. A private chat draws no deleted message at all, on both
sides, including those deleted before; a group keeps its placeholder. Where the
function is missing the dialog does what it did, and stops offering someone else's
message for both.

**Regression tests:** `tests/e2e/message-delete-for-both.spec.ts`, 5, red on the
unwired client; `tests/unit/deleted-messages.test.mts`; the rehearsal of
`20260911143000`, under D-100.

## D-103 `[ ]` A message deleted for everyone leaves its content, its media and its notification preview behind

**Severity:** low; recorded so that nobody assumes otherwise. Found with D-102.

**Defect:** the row keeps its content, which a member of the chat can still select
through the API, as with the older group soft delete; its media stay in storage,
since the deletion is reversible; a notification already written keeps its
160-character preview in `public.notifications`, and a push already delivered stays
on the device.

## D-104 `[x]` Every signed-in person can read every reaction, and add one to any message id

**Severity:** medium, for privacy. Found by agent L in the migrations; checked on
production, read-only, on 2026-09-11.

**Surface:** the policies on `public.reactions`: «Anyone in chat can view
reactions» is `using (true)`, and «Users can add reactions» checks
`uid() = user_id` alone. Both apply to every role.

**Defect:** a signed-in person who is a member of no chat reads the reactions of
every chat — who reacted to which message, with what, and when — and can put a
reaction on a message of a chat they are not in if they know its id.
`set_message_reaction` checks the membership; a direct insert does not. The table
is published to Realtime under the same policy. Without signing in the read is
refused, but only because the restrictive ban check calls `is_banned`, which
`anon` may not execute: an accident, not a rule.

**Fixed** in `6e2f5ed`, not yet applied to production, on the owner's approval of
2026-09-11. `20260911150000_reactions_visible_to_chat_members` replaces the open
read with «Chat members can view reactions» — the members of the message's chat,
through `is_chat_member`, as for the message itself — and the insert check with
«Chat members can add reactions»: the caller's own reaction, on a live message of a
chat they are in that is not a notice, which is what `set_message_reaction` checks.
`anon` loses its privileges on the table. Of the 149 reactions on production none
was put from outside the message's chat, and the client production runs reads and
writes reactions only in the reader's own chats, so this may go out before the new
client.

**Regression tests:** the rehearsal
`.migration-backup/supabase/rehearsal/20260911150000_reactions_visible_to_chat_members.test.sql`
— a member reads and adds; a stranger to the chat neither reads nor adds; no one
reacts in another's name, on a deleted message or on a notice; anon is refused; the
one-call toggle still works — run in PGlite by
`tests/server/message-actions-db.test.mjs` and on a copy of production's schema.

## D-105 `[ ]` A global administrator deleting the other person's message in their own private chat is audited as staff

**Severity:** low. Found with D-102.

**Defect:** `trg_audit_messages_admin_delete` records `message_deleted_by_staff`
whenever a global administrator or manager deletes a message that is not theirs,
and with D-102 that includes the other person's message in the administrator's
own private chat.

## D-106 `[ ]` The chat list event-cost spec runs without the flag its count depends on

**Severity:** low; a test defect. Found by agent L.

**Surface:** `tests/e2e/chat-list-event-cost.spec.ts`.

**Defect:** the spec needs `VITE_CHAT_LIST_SUMMARIES_RPC_ENABLED=1`, as production
has it, and says so in its header, but does not refuse to run without it. On a
server without the flag the list falls back to separate requests, and its
"comes back once" check fails on seven fetches of the list.

## D-107 `[x]` The achievements people have earned can be read without signing in

**Severity:** low, for privacy. Found on 2026-09-11 while checking D-104 on
production, read-only.

**Surface:** `public.user_achievements`: `anon` holds SELECT, and a permissive
read policy is `using (true)`.

**Defect:** with the public key the application ships and no account, all 58 rows
on production are readable — whose achievement each one is. Only the count was
read. `achievements`, `cosmetics` and `product_milestones` are readable the same
way and hold catalogue rows, which may well be meant to be public.

**Fixed** in `6e2f5ed`, not yet applied to production, on the owner's approval of
2026-09-11. `20260911151000_user_achievements_signed_in_only` replaces the open
read with «Signed-in people can view earned achievements», for `authenticated`
only, and takes `anon`'s privileges on the table away. `achievement_recipients` and
`achievement_stats` read the table as their caller, so they no longer answer anon
either; the client reads the second only on signed-in screens. The catalogues stay
public, and every SECURITY DEFINER path that grants or checks a badge is unchanged.

**Regression tests:** the rehearsal
`.migration-backup/supabase/rehearsal/20260911151000_user_achievements_signed_in_only.test.sql`
— a signed-in person reads another's badge and the views; nobody writes a badge by
hand; anon is refused the table and `achievement_recipients`; the catalogue stays
readable — run in PGlite and on a copy of production's schema.

## D-108 `[x]` A private chat whose latest messages were deleted drew almost none of them, and never loaded older history

**Severity:** high. Found on 2026-09-11, when the signed-in history-prepend
contract of `visual-style-layout` failed on the tree with D-102 taken in.

**Surface:** `useMessages.ts`, the first page and every older page: a hundred rows
by `created_at`, deleted ones included. Since D-102 a private chat draws none of
the deleted ones (`visibleConversation`).

**Defect:** a page was a hundred rows, not a hundred messages to show. Measured on
production with a probe that read numbers only: the latest page of a private chat
held 100 rows, 98 of them deleted, so the conversation drew 2 messages in a list
856px tall that could not scroll — `scrollHeight` equal to `clientHeight` — while
it reported more history. Older history is asked for by a scroll to the top, and a
list that cannot scroll never sends one, so the rest of the chat was out of reach.
Before D-102 the same rows were drawn as «Сообщение удалено» and the list scrolled.

**Fixed** in `9601f8c`. A private chat asks for its pages with
`deleted_at is null`, the first page and every older one, so a page is a hundred
messages it draws; a group still asks for its deleted rows and draws their
placeholders. The kind of chat is read from the store; before the chat list has
loaded it is unknown, and the page comes as it always did. The DEV fixture's
message route now honours `created_at=lt.` and `deleted_at=is.null`, so a spec can
page through history on it.

**Regression tests:** `tests/e2e/message-history-deleted.spec.ts`, 2, on the
fixture with the measured shape — 300 messages, the latest hundred all deleted but
two. Red before the fix on "a private chat asked for the deleted messages it does
not draw" and "the first page drew 2 messages and did not fill the view"; green
after, with an older page loaded by a scroll to the top and every page filtered.
The group keeps its placeholders.

## D-109 `[x]` Loading older history moved the conversation 43px, and a scroll during the load kept it there

**Severity:** medium. A critical contract of `CLAUDE.md` section 11: a history
prepend preserves the reader's anchor. Found on 2026-09-11 — with D-108 fixed, the
signed-in contract reached the load and failed at 42.8px.

**Surface:** `MessageList.tsx`, the band «Загружаем историю...»: a row in the flow
above the oldest message, drawn while a page loads or after one failed.

**Defect:** the band's arrival moved every message down by its height and its
departure moved them back, both on painted frames. The prepend restore puts the
anchor back where it was taken, which would have hidden the second; but
`handleScroll` takes the anchor again on every scroll event during a load, so that
a reader who keeps scrolling is followed, and the first scroll event after the band
arrived took it in the moved position. The prepend then restored the moved position,
and the reader was left the band's height off. Measured on the DEV fixture with a
probe that logged every write to `scrollTop` and every scroll event, taking the
steps the signed-in contract takes: the anchor at −44.00px; the band in 4ms after
the load began, the anchor at −0.67px; 5ms later the scroll event of the contract's
own `scrollTop = 120`, taking the anchor there; the prepend restoring −0.67px —
43.73px from where the reader had been. The same in a group and in a private chat,
with deleted messages and without. On production the contract measured 42.82px,
and the "worst painted displacement 42px" recorded under D-039 was this band.

**Fixed** in `80e7674`. The band pays for its room: a layout effect gives
whatever height it adds or removes back to `scrollTop` in the same layout pass, so
no frame is painted with the messages moved and no scroll event can see them
there. It is declared before the prepend restore, which is absolute, so a commit
that prepends and removes the band still lands on the anchor. At the bottom, and
while the entry holds the reader there, it does nothing: the list follows its
bottom. The band looks as it did and stays a chip in the flow, as D-062 decided.

**Regression tests:** `tests/e2e/message-history-prepend-anchor.spec.ts`, "the
message being read does not move on any painted frame of the load, a scroll during
it included", measured after every paint from the scroll to the top until the
prepend has settled: red at 43.73px before the fix, green in three runs of three
after on Chromium, and on WebKit. With it the signed-in contract passed on
production data again. The source half is in
`tests/unit/message-history-anchoring.test.mjs`.

## D-110 `[x]` A settle pass of the chat entry could take a reader who had started scrolling up back to the bottom

**Severity:** medium. A critical contract of `CLAUDE.md` section 11: fast upward
scrolling must not snap to the bottom. Found on 2026-09-11 by the probe of D-109,
in the first seconds after a chat opened.

**Surface:** `MessageList.tsx`. For 4.2 seconds after a chat opens with nothing
unread, the entry holds the reader at the bottom, and eight settle passes put them
back there while it holds; a wheel, a touch, a pointer or a scrolling key lets go.

**Defect:** a settle pass checked the hold when its timer fired, then scrolled a
frame later through `scrollToBottom` without checking again. A wheel in that frame
let go of the hold, and the frame took the reader to the bottom all the same. The
deferred pass after a layout change had the same shape, with its check a frame
before its scroll. Measured on the DEV fixture: a reader at 120px was put at
4238px while older history was loading; with the frame held until the reader had
scrolled up to 2098px, they were put at 4195px.

**Fixed** in `80e7674`. `scrollToBottom` takes what its caller decided on and
reads it again in the frame that scrolls: for a settle pass, whether the entry
still holds; for the deferred pass, whether the reader is still at the bottom. The
button «К последним сообщениям» still asks outright.

**Regression tests:** `tests/e2e/message-history-prepend-anchor.spec.ts`, "a settle
pass of the entry does not take a reader to the bottom after their wheel let go":
frames are held until a settle pass has asked for one, the reader's wheel lets go
and they scroll up, then the frames run. Red before the fix, the reader at 2098px
put at 4195px; green in three runs of three after. The source half is in
`tests/unit/message-history-anchoring.test.mjs`.

## D-111 `[ ]` The installed iPhone app leaves an empty band under the composer, and it stays when the keyboard opens

**Severity:** high. Reported by the owner on 2026-09-11 with a tester's screenshots,
on the web build production has run since 07:03 Moscow time that day (`45971c6`);
nothing was deployed after it.

**Surface:** the conversation in the app installed on an iPhone. `MainLayout` sizes
the shell `h-[100dvh]`; the composer dock in `ChatWindow` pads
`max(keyboard inset, --kub-safe-bottom)`, and the keyboard inset is
`innerHeight − visualViewport.height − visualViewport.offsetTop`.

**Defect:** measured off the screenshots — a phone as wide as a Pro Max, going by
the Dynamic Island against the screen — the composer's field ends about 108pt above
the bottom edge, over a flat band of about 93pt; with the keyboard open about 44pt
stays between the composer and the keyboard's bar, and the chat header has gone off
the top. The same component in Chromium at 430×932, with a 34pt inset for the home
indicator, puts the field 46pt above the edge: for a viewport as tall as the screen
the arithmetic holds, and the missing ~60pt is the viewport the app is given.

**Cause, not confirmed on a device.** Two behaviours of Home Screen web apps are
reported: `100dvh` wrong on a cold start while `100vh` is right; and `innerHeight`,
`visualViewport.height` and `100dvh` shrinking once the keyboard has been used —
932 to 873 on a Pro Max, with a dead band at the bottom — and staying so until the
app is quit. A WebKit report of that shrink in a web view reproduces on iOS 26.0.1
and is marked fixed in 26.1 (bugs.webkit.org 301857). The shell's `100dvh` and an
inset read from `innerHeight` are exposed to both. Telling them apart needs the
tester's iOS version, and whether the band is there before anything has been typed.

**The tester's answers**, the same night through the owner: an iPhone 15 Pro Max on
the current iOS, the one with Liquid Glass; the app opened from its Home Screen
icon. In Safari it looks a little better, the tester says, since there it sits
above Safari's own bar. The band is there straight after launch, before anything
has been typed, and it stays after the app is closed and opened again.

That rules out the shrink after the keyboard, which is reported to last only until
the app is quit, and leaves the height the installed app is given from its first
frame: the shell's `100dvh`, reported wrong in a Home Screen web app on a cold
start while `100vh` is right.

**Fix** in `12f4393`, not deployed, and not confirmed until the tester's phone says so.
The shell's height is one token, `--kub-app-height`: `100dvh`, and `100vh` where
`data-ios-standalone` marks the installed iPhone app; the chat, tasks, bots and
capture shells read it through `h-app`, the sign-in shell directly. In the
installed app, while the composer has focus and the keys cover part of the screen,
the shell is fitted to the visible height, iOS's pan is taken back, and the
conversation stops padding for the home indicator the keys cover; all of it is
given back when the keys go. Phones and browsers that resize for their keyboard
keep the lift they had.

**Regression tests:** `tests/e2e/installed-ios-viewport.spec.ts`, 2 on Chromium and
WebKit, with the installed app's flag and a `visualViewport` that shrinks only what
is visible, as iOS's does — the shell as tall as the screen, fitted to the keys and
given back, the header on screen, the composer on the keys; and a browser that is
not the installed app still lifting the composer. The source half is
`tests/unit/installed-ios-viewport.test.mjs`.

## D-112 `[ ]` In the Windows app the window's own buttons sit over the page's top-right controls, and take most of their clicks

**Severity:** high for the Windows app. Reported by the owner on 2026-09-11 with a
screenshot, recorded for later; not yet investigated.

**Surface:** the window buttons the Windows shell draws itself — minimise, maximise,
close — at the top right, and the controls a page puts in that corner. On the
owner's screenshot of «Задачи» the page's «+ Новая» sits under the window buttons,
and pointing at it brings up the maximise button's «Развернуть» tooltip.

**Defect:** the window buttons share a plane with the page's header, so an
invisible rectangle of theirs covers the upper part of the page's buttons: about
80% of «+ Новая» does not take a click, and only its lower edge, which the
rectangle does not reach, does.

**Cleared on the chat screen** 2026-09-11 with option C, merged in `f1adbbe`: the chat
pane starts under the Windows app's own 44px top bar, which carries the window
buttons, so none of its capsules reaches them. Measured at 1360×860 with the desktop
bridge stubbed: no capsule's box meets the buttons' boxes, 7px lie between them, and
a click at the centre of every capsule and of every window button reaches its target.
The page the owner photographed, «Задачи», and any other page with controls in that
corner are not yet checked; they are the navigation work's part of this entry, which
stays open until they are.

**Re-measured on 2026-09-12, after the application's top bar was removed**, because
that bar was the 44px the paragraph above credits. It is gone; the buttons are
`DesktopWindowChrome`, a 2rem overlay strip that takes no height from the page, and
the panes reserve it themselves — `--kub-window-caption` under
`data-desktop-shell="windows"`, padded out of each pane's own top by `pt-window-top`,
so the folder rail's sheet reaches the window's top edge while its first control does
not. The mechanism changed; the corner did not get worse.

Measured with the desktop bridge stubbed, at both widths, in the messenger:

| frame | buttons' zone | page controls inside it |
| --- | --- | --- |
| 1440×900, at rest | 132×32 at 1308,0 | none |
| 1440×900, chat open | 132×32 at 1308,0 | none |
| 1440×900, side list open | 132×32 at 1308,0 | none |
| 1024×720, at rest | 132×32 at 892,0 | none |
| 1024×720, chat open | 132×32 at 892,0 | none |
| 1024×720, side list open | 132×32 at 892,0 | none |
| 1440×900, «Задачи» | 132×32 at 1308,0 | «Новая» 64% |

The chat-open rows are the ones that were at risk: the chat header's «⋯» is at the
right of its row and that row is the top of the pane now that nothing stands above
it. The rail starts at 0 and the chat's control row at exactly 32 — the reservation,
not a gap.

**«Задачи» is unchanged at 64%**, deliberately. This stage owns the messenger's
shell; the page's own «+ Новая» sat under the buttons before this branch and still
does, because the reservation is applied by the messenger's panes and not by the
pages. Applying `pt-window-top` to the page shells is the navigation work's part of
this entry, and the mechanism it needs now exists. `tests/e2e/desktop-shell.spec.ts`
asserts the messenger's corner as an empty set and «Задачи» as the named set
`["Новая"]`, so it stays a ratchet in both directions.

## D-113 `[ ]` A video does not send

**Severity:** high. Reported by a tester of the production build (`45971c6`) on
2026-09-11 through the owner, recorded for later; not yet reproduced.

**Defect:** in the tester's words, «видео не отправляется». The platform, the video
(size, length, codec) and the step at which it stops are not known yet.

**Investigated** 2026-09-11, from the code at the deployed build `45971c6` and from WebKit's and
Apple's sources, not on a device: the cause is not yet known, and the candidates are narrowed. On an iPhone
WebKit converts a picked video to H.264 before the page gets it, most likely making it larger, so it can meet
the client's 250 MB limit or a lower server limit whose current value is unknown. A long upload in the
installed app likely stops when the app goes to the background, and nothing survives a reload. One failed
attachment silently stops every attachment after it in the same send. None of it has been visible, because
the client discards the upload's HTTP status and the build has no telemetry. The send path's fixes are in
progress on `fix/media-send-path`; the server's size limit and bucket rules are still to be read, read-only;
and the tester has been asked what the tile showed and at which step it stopped. Report:
`output/audits/2026-09-11-media-reports/report.md`.

**Measured** 2026-09-11 on production, read-only and in aggregate: the `media` bucket carries no size
limit of its own and accepts any type, so the storage service's global limit decides. Of the 67 videos ever
stored, the largest is 51,215,994 bytes, under 50 MiB (52,428,800), while the client allows 250 MB; none over
50 MiB has ever been stored. A server cap at the stock 50 MiB is the likeliest reason a longer video from a
phone fails, and the client reports it only as «Не удалось загрузить файл». In the last 30 days the bucket took
3 videos, all MP4, and no QuickTime. The worker is not the bottleneck: 30 of 32 720p copies and 34 of 36 posters
are ready, the failures are sources deleted since, and no image or video message of the last 30 days lacks its
variants. Whether the server's limit rises to the client's 250 MB is the owner's decision; until then the send
path is to name the real limit.

**Fixed on the branch, in part,** 2026-09-12 in the merge `584a38f` of `fix/media-send-path`, not deployed:
an upload keeps its HTTP status and the server's stated limit, and the notice names the file and the reason, so a
refused video says it is larger than the server accepts instead of a guessed «250 МБ»; and one failed attachment
no longer strands the ones after it. Still open: the server's own limit, which is the owner's decision — raise it
to the client's 250 MB or cap the client at 50 MB — and uploads while the installed app is in the background,
which need an iPhone.

**The owner's choice, what the server already does, and the tester's answers** (2026-09-12): the owner chose the
client's 250 MB, and the storage service already runs at it — the running container's `FILE_SIZE_LIMIT` is
262,144,000 bytes and the resumable endpoint advertises `Tus-Max-Size: 262144000`, while the base compose file
still reads 52,428,800 and is overridden by an overlay. Nothing was changed on the server, and the 50 MiB ceiling
among stored videos is what people happened to send, not a cap. The tester picked the video from the gallery; it
failed while it was uploading, with the app in front the whole time, on iOS 26.6.1, and he read no file name on
the tile. So the reason is still unknown. What will name it is the send path's new message, which carries the
server's own status and the file's name, once a build with it reaches him — which is an argument for deploying
this batch before hunting further.

## D-114 `[ ]` A 300 KB photo takes a very long time to upload

**Severity:** medium. The same report; not yet reproduced.

**Defect:** «фото 300кб миллион лет грузилось». A file of that size takes seconds on
a mobile connection, so the time goes somewhere other than the bytes — the
preparation on the device, the upload's handshake, or waiting for the worker's
copies — and which one is still to be measured.

**Investigated** 2026-09-11: most likely the send queue, not the photo. Attachments upload and insert strictly
one after another, so a photo picked with a video waits for the whole video under «Готово к отправке», and
its own upload of 6 MiB or less then shows 0% until it ends. Preparing a photo measured 78–430 ms on Chromium
and on Playwright's WebKit. Found alongside: an iPhone most likely hands the page HEIC photos, which the client
does not compress, and Safari most likely cannot encode WebP, so a PNG can go up under a `.webp` name. Both
are being fixed on `fix/media-send-path`; the tester has been asked about the pick order and the tile's file
name.

**Measured** 2026-09-11 on production, read-only and in aggregate: of the 45 picture messages of the last 30
days, 33 were PNG made WebP, 5 JPEG made WebP, 1 WebP and 1 JPEG left as picked (2.3 MB), and 5 carry no
metadata; no HEIC was picked at all in that time, so the HEIC path did not occur in production. Whether an
iPhone encodes WebP stays open, since storage records the type the client declared. Image variants: 165 ready,
3 failed as unreadable sources, the last on 2026-09-04.

**Fixed on the branch** 2026-09-12 in the merge `584a38f`, not deployed. Attachments upload up to three at a
time and are inserted strictly in pick order, so a photo no longer waits for a video picked before it; a small
upload shows a moving bar instead of a frozen «0%»; and a send no longer waits on the chat's `updated_at`.
On the photo path the canvas's real encoder decides: JPEG at 0.85 where WebP cannot be written, the file named
and typed from what was written, HEIC converted where the engine decodes it, and a small JPEG that needs no
resize sent as picked. Measured on the fixture, the first photo behind a video lands 1.5 s sooner, and a 12 MP
camera JPEG through a Safari-style encoder goes as a 0.93–0.98 MB JPEG instead of 4.19 MB whole. Safari's
encoder, the HEIC conversion's memory on large photos and the JPEG sizes need a real iPhone.

**The tester's answers** (2026-09-12): the pick order did not matter to him, and he did not read the tile's file
name, so what an iPhone hands the page is still unconfirmed from a device. The production measurement found no
HEIC picked in 30 days.

## D-115 `[ ]` Photos sent together arrive as separate messages, not as one album

**Severity:** medium. The same report; not yet reproduced.

**Defect:** «отправились не паком, а отдельно»: photos picked and sent together went
out one message each, where Telegram sends them as one album.

**Investigated** 2026-09-11: confirmed by design. One picked file becomes one message, and nothing in the
schema, the send path, the notifications or the bubble groups them. Telegram's model is separate messages
sharing a group id, sent in one call, with one notification. The scoping — a nullable `media_group_id`, one
RPC inserting the group in a transaction, a grid, actions on one item or the whole album — is phased at 8–12
days, with renders for the owner before it is built. Its first phase, the send path, is in progress with D-113
and D-114.

## D-116 `[ ]` A received photo is a WebP that the tester cannot zoom, and it looks poor

**Severity:** to be assessed. The same report; not yet reproduced.

**Defect:** in the tester's words, the photo is WebP, so it does not zoom and its
quality is poor. Two claims to check apart. Zooming a photo was fixed as D-087 —
on the build the tester runs, or only since, is to be checked. WebP is the format
the preview copies are made in to keep storage small, which by itself neither
stops a zoom nor lowers quality; what the tester sees may be a preview copy where
the original was expected (compare D-097). The owner's view: the quality should be
fine, and WebP was chosen for its small size.

**Investigated** 2026-09-11: zoom is not the format. The deployed viewer has no zoom at all, for any picture;
the zoom of D-087 (`c1a1d2d`) is on this branch and needs a real iPhone before it ships. The poor look is
most likely size and cropping: a tall screenshot is stored at 886×1920 and previewed at 591×1280, then stretched
and cropped on a 3× phone, with WebP's 4:2:0 colour a smaller factor. Keeping at least 1080 px on the short side
is in progress on `fix/media-send-path`; how a tall picture sits in its bubble is a visible change for the
owner to choose from renders.

**In part on the branch** 2026-09-12 in the merge `584a38f`: a tall picture keeps 1080 px across, so a
1290×2796 screenshot is stored at 1080×2341 instead of 886×1920. Still open: the worker's 1280 px preview needs
the same short-side rule; how a tall picture sits in its bubble waits on the owner's choice between four
rendered crops; and the zoom of D-087 needs a real iPhone before it ships.

**The owner's choice** (2026-09-12): of the four rendered crops he chose B — a taller bubble showing about 82% of
a tall picture, instead of today's centre crop that hides about 42%. The previews take a short-side floor to
match it, in the client and in the worker, so a tall picture is no longer drawn from a 591 px-wide copy. The
tester confirmed the photo he could not zoom came from an iPhone, and that it did not zoom in the viewer.

**Done on the branch** 2026-09-12 in the merge of `fix/tall-pictures`, not deployed. The owner's option B is
in: the aspect clamp falls from 0.72 to 0.5 and the bubble is capped at 480 px, the decision moved out of
`MessageBubble.tsx` into `artifacts/kub/src/lib/mediaBubbleLayout.ts`, which imports nothing and so can be tested
directly. Previews take a short-side floor of 720 in both places that size them - `originalPreviewDimensions` in
the client and `imagePreviewSize` in the worker, which now reads the original's size once and respects EXIF
orientation, without which the floor would land on the wrong axis.

**The cap was 480 px first, and the share visible turned out to depend on the phone's width.** At 480 a
1290x2796 screenshot showed 71% of its height on a 430 px phone (bubble 310x480, was 51%), 82% on a 390 px one
(270x480, was 58%) and 92% on a 360 px one. The owner had approved "about 82%", but that was the 390 px figure
and the tester's iPhone 15 Pro Max is 430 px, so he would have seen 71%. Shown the frames and told this, the
owner asked for the cap to be raised, and it is 550 px as of `e6a36c4`.

**What 550 px gives**: 82% on the 430 px phone — the number he approved, now on the phone the tester holds — and
60% on a desktop, up from 53%. On the narrower phones it is the 0.5 clamp that stops the box rather than the cap,
which never reaches them, so 390 px and 360 px both settle at 92%. A normal 4:3 photograph and a wide picture ask
for a shorter box at every width and are drawn exactly as before; video was deliberately left on the old 0.72 and
320, since the choice was about pictures.

**The preview floor moved with the cap**, and an assertion is what made it. The floor exists so a preview is not
drawn stretched; it was 720, derived from the narrowest phone, and `media-compression.test.mts` tied it to the
bubble's height so that neither could be tuned alone. Raising the cap to 550 turned that assertion red at once.
The box on the phone the tester holds is 310x550 CSS, which is 930x1650 device pixels, so the floor is now 930 —
and a tall preview was in fact being stretched there even while the cap was 480, which nobody had noticed.

**It is also applied only to a picture taller than it is wide.** That is the axis which fills the bubble: a
landscape picture fills it with its long side, which the 1280 cap already carries well past 930, so flooring its
short side only bought height the bubble never draws. Had the floor simply been raised to 930 for everything, an
ordinary 4:3 photograph would have gone from a 1280x960 preview to 1440x1080 and every 16:9 picture would have
grown by two thirds, for nothing. As it stands 4:3, 16:9 and a panorama are sized exactly as they were, and
1080x2341 goes to 930x2016 instead of 720x1561. The client and the worker carry the same rule, or a picture would
change size under the reader when the worker catches up.

**A rewritten preview could not have reached anyone who had already seen it.** Message variants keep their path
when they are rewritten and the worker writes them `max-age=31536000, immutable`, and their URLs carried no version
token — avatars have carried one for exactly this reason since they became cacheable. So the backfill below would
have been invisible to the very people who complained. `useMediaVariants.ts` now reads `updated_at` and passes every
message variant URL through `withVersionToken`, as the avatar paths already did.

**The pictures already sent are being regenerated** (the owner, 2026-09-12: «Старые картинки тоже по возможности
перегенерируй чтобы не было расхождений»). Measured read-only on production: 165 `image_preview` rows are ready, 40
of them need regenerating, and the originals of all 40 are still in storage — none is lost. 30 of the 40 are about
2.25:1, which is to say phone screenshots, exactly the complaint. It costs 11.3 MB of downloads and takes the
previews from 1.3 MB to about 2.0 MB in all. The 191 live media messages sit inside the worker's 1200-row scan, so
it already reaches every affected row.

The method is deliberately narrow: mark those rows `stale` and let the worker regenerate them with its own rule,
so that a backfilled picture cannot differ from a normally uploaded one — one writer of variant bytes is the whole
point. The only write is a status flip, which makes it idempotent and safe to stop half way. A `failed` row is never
revived: that is the worker's only memory of a dead end, and reviving one would restore D-034.

**It cannot run yet.** `letscube-worker` has to be deployed with the D-116 rule first, or regeneration would faithfully
reproduce the old size. Also worth knowing: no production message carries a sender's preview in its metadata, so
the worker's `image_preview` is the only preview a reader ever gets, and the client's own rule reaches new uploads
only.

**One consequence worth knowing before it ships.** The worker deploys separately from the web application, and it
does not regenerate variants that already exist, so larger previews would otherwise arrive only for new uploads
and only after `letscube-worker` is deployed; until then the taller bubble stretches the existing 591x1280
preview harder than before. The owner asked on 2026-09-12 for the pictures already sent to be regenerated too, so
that old and new do not differ, and that backfill is being designed. Measured cost of the larger preview, not
estimated: a UI screenshot goes from 10.9 to 13.0 KiB, an original 1290x2796 from 10.7 to 13.1 KiB, and pure
noise as an upper bound 205 to 358 KiB; 4:3 and 16:9 are byte for byte the same.

## D-117 `[x]` In the light theme the time in your own message is under the contrast floor

**Severity:** low, for legibility. Found on 2026-09-11 by the assessment of the
iPhone chat screen against Telegram, photographed on the DEV capture route.

**Defect:** in the light theme the time in an own bubble measures 4.31:1 against the
bubble at its worst pixel, under the 4.5:1 floor for text; in the dark theme it is
5.51:1. Options B and C of that assessment, which repaint own bubbles, put it at
4.75:1 in both themes.

**Fixed** 2026-09-11 by option C of the chat screen, built on `design/chat-chrome-c`
and merged in `f1adbbe`, not yet deployed. The own bubble is #3B5CCF in both themes,
with its meta line in white, and the time in it measures 4.75:1 at its worst pixel
in both themes, photographed on the iPhone, Android and desktop frames of the DEV
capture route. The light theme's accent text went darker than the rendered option,
#213A94 against #2B45A3, so that a sender's name clears the floor on a desktop as
well: 5.15:1 where the option held 4.35:1.

## D-118 `[x]` A volume slider on phones, where the phone's own volume governs

**Severity:** medium, for clarity. Reported by testers through the owner on
2026-09-11.

**Defect:** a volume slider is drawn wherever media plays, phones included, where
Telegram draws none and the system mixer is how a person sets the volume. It is a
control nobody expects there, and it makes the player busier than Telegram's.

**Decision** (the owner, 2026-09-11): no volume slider where the device's own volume
governs; Telegram's players are the reference.

**Fixed** 2026-09-11 in `bce98f3` on `integration/message-actions`, not yet deployed.
Under a finger — `(pointer: coarse)`, a phone or a tablet — nothing draws a
playback volume any more. The playback bar's slider is hidden there, and the sound
settings drop «Голосовые сообщения» and «Громкость прослушивания», keeping only the
microphone's, which no system control sets. A volume lowered earlier cannot stay
lowered with nothing on screen to raise it: under a finger the playback bar and
voice messages play at full volume, and the device's own keys do the rest. A
desktop keeps its slider. The bar's control also carried its tooltip and its
accessible name as mojibake, Cyrillic read as Windows-1251; they read «Громкость»
and «Громкость воспроизведения» again. Pinned by
`tests/unit/send-quality-and-phone-volume.test.mts`, with `coarsePointer()` from
`lib/pointer.ts` tested for a finger, a mouse, a page without `matchMedia` and no
window. The signed-in `video-message.spec.ts` and `unified-interface-chrome.spec.ts`
now expect the sliders only where the pointer is not a finger; they read
production and were not run for this change.

## D-119 `[x]` Sending a photo or a video asks for a quality, and people do not want to be asked

**Severity:** medium. Reported by testers through the owner on 2026-09-11.

**Surface:** the composer tray's quality selector «Экономно / Стандарт / Исходное»,
and the five-stop slider rendered for the owner on 2026-09-11, which never shipped.

**Defect:** what testers object to is not how many choices there are but that there
is a choice at all. A photo sent from a stock app is compressed without anyone
thinking about it, and a person who wants the original presses the function for
it, as in Telegram.

**Decision** (the owner, 2026-09-11): no quality choice when sending. Photos and
videos go at the standard quality without a question; «без сжатия» is a separate,
explicitly named function, as in Telegram — «Файл», marked as sending without
compression, which D-096 makes true on a phone. The slider of 2026-09-11 is
withdrawn.

**Fixed** 2026-09-11 in `bce98f3` on `integration/message-actions`, not yet deployed.
The tray's video quality selector is gone, and so is the quality it remembered:
every video goes at the standard quality. The phone's separate «Без сжатия» item is
gone too. «Файл» is the function, on every device, and says so under its name —
«Без сжатия» is the item's accessible description, so its name stays «Файл». A
pick from it is staged as it is, straight into the composer; on a desktop it no
longer opens the send dialog, which would only ask again what the item answered.
On a desktop «Фото или видео», a paste and a drop still open that dialog with
«Сжать изображение», Telegram Desktop's own checkbox.

Two rules followed from «Файл» taking any file. Only a photo or a video is refused
as an original over 50 MB; a document meets the limit every attachment meets, in
that check's words, where it would have been told to send "this photo"
compressed. And a refusal names the way out on the screen in front of the person —
after «Файл» the menu's «Фото или видео», in the dialog its box — where it used to
follow the device, which would have sent a desktop's «Файл» to a box that never
opened. `originalLimitMessage` takes that surface now.

Verified on the fixture server: `media-send-without-compression.spec.ts` 13 of 13
on Chromium at 1440, Chromium at 390 and WebKit at 390, 14 skipped by shape, with a
new desktop test for «Файл» and the phone tests moved to it; the unit tests that
read these files 155 of 155; typecheck clean. The first run failed one desktop test
because the dev server had missed two of the files written in one burst and served
them stale — and the new desktop test passed that run for the wrong reason — so
every changed module was checked against the disk before the run that counts.
Before-and-after renders of the menu, a phone in both themes and a desktop, went to
the owner.

## D-120 `[ ]` A «Папки» tab duplicates the folder tabs above the chat list

**Severity:** low, for clutter. Named by the owner on 2026-09-11.

**Defect:** on a phone the bottom bar carries «Папки» beside the folder tabs already
at the top of the chat list, and the tab does nothing those do not. Telegram shows
folders at the top only.

**Decision:** remove the duplicate, inside the navigation work of item 30.

## D-121 `[ ]` Sound settings are large stretched modules left from the old interface

**Severity:** medium, for the look. Named by the owner on 2026-09-11.

**Defect:** the notification sound settings are drawn as large, stretched panels
where Telegram has compact grouped rows.

**Decision:** rebuilt in Telegram's settings idiom inside the parity work of item 30.

## D-122 `[ ]` The attach menu is a list of buttons that open other things, where Telegram's attach sheet does the thing in place

**Severity:** high, for how the product reads. Named by the owner on 2026-09-11, after
the D-119 renders, with two screenshots of Telegram's attach sheet on Android shown for
its functions, not its look.

**Surface:** the composer's «Прикрепить» menu — «Фото или видео», «Файл», «Сделать фото»,
«Голосовое», «Записать видео», «Местоположение» — and what each item opens.

**Defect:** every item is a button that opens something else: a system picker, a camera
dialog, a recorder dialog, or an immediate send of the location. Telegram's paperclip
opens a sheet whose tabs work where they are. The gallery grid is the first thing on
screen, with a camera button, selection circles and an HD badge on every photo; «Файл»
lists where a file can come from, «Галерея — для отправки изображений без сжатия» among
them; «Геопозиция» shows a map before anything is sent; a poll or a list is filled in
inside the sheet. Voice and round video are recorded from the composer's microphone
button. The D-119 render kept the old list and relabelled one item, and the owner found
the menu as strange as before.

**Decision** (the owner, 2026-09-11): the functions must be understandable to look at and
to use exactly as in Telegram, without holding on to the old idea of them; the look stays
iOS with Liquid Glass on every shell. The attach flow is rebuilt as Telegram's attach
sheet the D-071 way: an assessment and option renders on real code for the owner's choice
before it ships. D-119's rules stand inside it — no quality is asked for, and sending
without compression is a named function. A web page cannot show the phone's photo library
inside itself, so how close the gallery tab can come in the browser and the installed
iPhone app, and whether the Android app draws a real grid, are part of the assessment.

**The owner's answers** (2026-09-11): the further functions Telegram's sheet carries — a poll, a checklist, a
contact, music — are wanted. For now they are placeholder tabs, so that the scrolling row of attach functions
can be judged without waiting for them; each is built for real later, in its turn.

**The owner's answers** (2026-09-12), after the three option renders on real code: the look is **B,
«Стеклянная капсула»** — a sheet inset from every edge, its tabs a floating glass capsule that becomes the
caption and send capsule once something is selected, and the count said in the title. Options A and C and the
DEV switch are gone: the sheet is the composer's attach flow on every shell, with no flag in front of it. The
placeholder tabs are «Опрос», «Список» and «Контакт», in that order; **«Музыка» is not wanted at all** and was
removed. «Без сжатия» stays a photo marked «Оригинал», not a document, so D-096 and D-119 are unchanged. And
the **desktop send dialog is retired**: a pick, a paste and a drop all land in the sheet's picked state, with
its caption field, its send button and «Отправить без сжатия» under «…».

**The map for «Геопозиция» is to be our own server** (the owner, 2026-09-12): static previews rendered from
OpenStreetMap data on LETSCUBE's own infrastructure, so that nothing about a person — not a coordinate, not a
referer — reaches a third party. That service does not exist yet, so the neutral field with the coordinates
stays and **no third-party map is called**. The seam is one component, `AttachLocationPreview` in
`artifacts/kub/src/components/chat/attach/AttachLocationPanel.tsx`: when the renderer exists, it is given a URL
built from the position and the field becomes an image, and nothing outside that component changes.

**Android's photo permission is native work, outside this task** (the owner, 2026-09-12): on first use the
person should be asked whether to give access to all media or only to selected items — the Android
photo-permission dialog. That is Capacitor work in the shell, not the web gallery. No Android code was touched
and the web gallery is as it was; recorded here so the decision is not lost.

**Implemented 2026-09-12** on `feat/attach-sheet`, not deployed. The composer's attach menu, the DEV option
module and its hook, and `MediaSendDialog` are deleted; `useIncomingMediaFiles` no longer asks about a shape,
and `originalLimitMessage` no longer takes a surface — the refusal always comes from the sheet and names
«Галерею» as the compressed way. Every D-119 rule stands inside it: nothing asks for a quality, the gallery
sends compressed, «Файл» sends the picked bytes on every device and says so under its name, and an original
over 50 MB is refused before any upload with the way out on the screen in front of the person.

**One thing the menu carried and the sheet does not: recording a rectangular video.** «Записать видео» was the
only entry to `VideoMessageRecorderModal`'s `regular` variant. Telegram's attach sheet has no such item, so the
owner's tab list has none either. Voice and round video are on the composer's recorder button, as this defect
says they should be, and on a phone the gallery's «Камера» still offers video through the system camera; on a
desktop a rectangular recording has no way in until the recording work (slide to cancel, release to send)
decides where it belongs. `video-message.spec.ts` keeps both of its cases and skips them with that reason
rather than deleting them, so the gap is visible in a run instead of silent.

**The recording follow-ups of D-130 come next**, after the sheet — the owner's order of 2026-09-12: slide to
cancel, release to send, and a lock with a pause and a preview. The rectangular recording the menu lost, above,
is to be decided inside that work.

## D-123 `[ ]` A location administrator holds management grants for their location but has no screen to use them

**Severity:** high, for the location administrator role. Found by the work-surfaces audit
from the code and a fixture render; production membership was not checked.

**Surface:** `artifacts/kub/src/hooks/useRole.ts:55-73`, where `useRoleAccess()` decides
`isStaff` and `isAdmin` from global roles and permissions only;
`artifacts/kub/src/pages/admin/AdminLayout.tsx:69` (the redirect) and `:164-166` (the
locations route); `artifacts/kub/src/components/layout/BottomNav.tsx:33` (the «Админка»
tab); `artifacts/kub/src/pages/admin/LocationsTab.tsx` (owner and technical administrator
only). Frames `admin-locadmin-phone-01-admin-route.png` and
`admin-locadmin-desktop-01-admin-route.png`.

**Defect:** the location role `location_admin` grants `location_members.manage`,
`tasks.manage`, `tasks.assign` and more for its location
(`20260514_dynamic_roles_permissions.sql:196-203`), but no screen reads those grants. The
«Админка» tab is hidden, `/admin` sends the person to the chat list without a word, and
the location page opens only for the owner and the technical administrator. A location
administrator cannot add a staff member, create an invitation or change a primary
administrator for their own location.

**Proposed:** a location page for the people who administer that location, with
«Сотрудники», «Приглашения» and «Задачи», limited to the rows their grants allow and built
as grouped rows (work-surfaces section 5). Where it is entered from waits on the owner
(owner summary, question 18). Verify that each server function the page calls accepts a
location administrator before exposing it.

**Audit rows:** work-surfaces E-10, A-32; top-10 item 2; the audit's owner questions 1
and 2.

## D-124 `[ ]` Task actions check global staff status, so a location administrator cannot confirm, reject, assign or cancel their location's tasks

**Severity:** high, for location administrators and the staff whose work waits on them.
Found by the work-surfaces audit from the code; rendered on the fixture.

**Surface:** `artifacts/kub/src/pages/tasks/TaskDetailModal.tsx:62, 150-181`: confirm,
reject, cancel, assign and edit gate on `useIsManagerOrAdmin()`, which reads global roles
and permissions; delete and claim already check location grants. The assign dialog,
`artifacts/kub/src/pages/tasks/TaskAssignModal.tsx:60-155`, is for global staff only.
Frames `tasks-locadmin-phone-02-detail-waiting-b.png` and
`tasks-locadmin-desktop-02-detail-waiting-a.png`.

**Defect:** a location administrator holding location `tasks.manage` and `tasks.assign`
sees only «Редактировать», and only on tasks they created. On a task «На подтверждении»
there is no «Подтвердить», «Отклонить», «Назначить исполнителя» or «Отменить задачу», so
in the interface only global staff can move it on.

**Proposed:** gate these actions on `has_location_permission(task.location_id,
'tasks.manage')` and `'tasks.assign'`, the grants the server functions check, after
verifying that each server function accepts a location administrator. Independent of
D-123; it can land first.

**Audit rows:** work-surfaces T-D13 (section 1.2 of the audit calls it T-D14; the table
row is T-D13); section 4, «Location administrator»; top-10 item 2.

## D-125 `[ ]` A bot's inline keyboard is never drawn, so its question cannot be answered

**Severity:** high, for every chat with a bot. Found by the chat-functions audit from the
client and the Bot API; rendered on the fixture (frame 32).

**Surface:** `artifacts/kub/src/components/chat/MessageBubble.tsx` (nothing reads
`bot_reply_markup`); `artifacts/kub/src/types/database.ts:662`;
`artifacts/api-server/src/bot/schemas.ts:19-29, 81, 142`;
`artifacts/api-server/src/bot/methods/messages.ts:39-46, 173-175, 195-202`;
`artifacts/kub/src/pages/public/BotDocsPage.tsx:175`.

**Defect:** a bot can send `reply_markup.inline_keyboard` and answer callbacks through the
Bot API, the public bot documentation promises callback buttons, and messages store
`bot_reply_markup`, but the client never renders it. The person sees the question, in the
fixture «Смена на завтра: 10:00–19:00, точка на Лесной. Подтвердите выход.», and nothing
to press.

**Proposed:** rows of buttons under the bubble. Pressing shows progress on the button,
then the bot's answer as a toast, or as an alert when the bot asks for one; URL buttons
open their link (Telegram: core.telegram.org/bots/features, audit source T61).

**Audit rows:** chat-functions K1; top-10 item 8.

## D-126 `[ ]` A bot's commands are stored but never offered in its chat

**Severity:** medium. Found by the chat-functions audit from the code; not rendered.

**Surface:** `artifacts/api-server/src/bot/methods/commands.ts:10-20` stores the commands
a bot sets with `setMyCommands`; nothing in `artifacts/kub/src/components/chat/` lists
them.

**Defect:** a bot registers its commands and nobody can discover them: a bot chat has no
menu button and no suggestions after «/».

**Proposed:** a «Меню» button by the field in a bot chat, and «/» suggestions with
descriptions from the bot's stored commands (Telegram: core.telegram.org/bots/features,
audit source T62).

**Audit rows:** chat-functions K2; top-10 item 8.

## D-127 `[ ]` A bot found in search cannot be opened

**Severity:** high, for bots: search is where people find one, and the result leads
nowhere. Found by the chat-functions audit; rendered on the fixture (frame 33).

**Surface:** `artifacts/kub/src/components/search/SearchShared.tsx:376-379`.

**Defect:** tapping a bot in the search results opens the modal «Запуск чата с ботом пока
недоступен.»

**Proposed:** open or create the chat with the bot, with «Запустить» in place of the
composer until the person starts it, as Telegram's «Start» (audit source T62). Until that
exists, leave bots out of the results.

**Audit rows:** chat-functions A11, K4; top-10 item 8.

## D-128 `[ ]` A group's member actions appear only under a mouse pointer

**Severity:** high on phones and tablets, where owners and administrators cannot promote,
demote or remove a member. Found by the chat-functions audit; rendered on the fixture
(frame 07, with the pointer over one row).

**Surface:** `artifacts/kub/src/components/chat/ChatInfoPanel.tsx:1550-1623`: the promote
(chevron-up), demote (shield-off) and remove (×) buttons carry
`opacity-0 group-hover:opacity-100`.

**Defect:** a touchscreen has no hover, so the three buttons are never shown there.
Removal asks «Удалить участника из чата?» once pressed. Not checked by the audit: whether
the invisible buttons still take a tap at their position.

**Proposed:** a muted «владелец» or «админ» on the right of the row; a tap opens the
member's profile; long press, swipe or ⋯ offers «Назначить администратором» and «Удалить
из группы» (Telegram: iOS swipe actions, Desktop context menu; audit sources T46 to T48).

**Audit rows:** chat-functions B15; top-10 item 7.

## D-129 `[ ]` A round video scrolled under the chrome paints over the header, the pinned bar, the search results and the composer

**Severity:** medium: broken rendering in every chat that holds a round video. Found by
the chat-functions audit from the code; visible in fixture frames 13, 20 and 28.

**Surface:** `artifacts/kub/src/components/chat/MessageBubble.tsx:1864-1917` (the circle's
play button `z-10`, its corner button `z-20`);
`artifacts/kub/src/components/chat/ChatWindow.tsx:1084-1197` (the header, pinned bar and
search bar above the list and the composer below it, positioned with `z-index: auto`);
the stacking is explained at
`artifacts/kub/src/pages/public/PublicPreviewCapturePage.tsx:249-252`. `ChatWindow.tsx`
changed in `bce98f3`; its lines may have moved.

**Defect:** the circle's own z-indexes lift it above the chrome it scrolls under, so the
circle and its ↗ button are drawn over the header, the pinned bar, the search results and
the composer.

**Proposed:** give the chrome stack and the composer dock a stacking level above the
list, or drop the circle's inner z-indexes. Check option C of the chat screen
(`design/chat-chrome-c`), which rebuilt that chrome, for the same overlap.

**Audit rows:** chat-functions M8; top-10 item 5.

## D-130 `[ ]` A held recording cannot be cancelled, and releasing parks it in the tray instead of sending

**Severity:** medium, for everyone who records voice or round video. Found by the
chat-functions audit from the code; the hold state is in frame 22.

**Surface:** `artifacts/kub/src/components/chat/MessageInput.tsx:505-572` (only the upward
drag is read); `artifacts/kub/src/components/chat/ChatWindow.tsx:803-825, 483-511`
(release stages the recording); modal alerts at `MessageInput.tsx:356-360, 378-382,
402-414, 803-807` and `ChatWindow.tsx:808-822`. Both files changed in `bce98f3`; lines may
have moved.

**Defect:** while the microphone is held, a sideways slide is ignored, so an accidental
recording cannot be abandoned. Every release either stages the recording in the tray
(«Готово к отправке»), where it needs «Отправить» or ×, or raises the modal «Запись
слишком короткая или пустая.». A second recording is refused with another modal until the
first is sent or removed.

**Proposed:** Telegram's recording line: slide left to cancel on touch, release outside
the composer to cancel with a mouse; release sends; a lock for hands-free recording with
pause, listen, delete and send; a short press shows a hint by the button instead of a
modal (audit sources T19 to T21). Sequenced with the attach sheet (D-122), which leaves
voice and round video to the microphone button.

**Audit rows:** chat-functions R4, R6, R7 (R5, R9 and R10 follow from them); top-10
item 2.

### The gap, stated before anything was edited (2026-09-12)

Telegram's mechanics, from the audit's own sources — T19 (the recording hints,
«Slide to cancel» among them), T20 («Video messages and Telescope»: hold, release
sends, swipe up to lock) and T21 (Telegram Desktop's record bar: release outside
the field cancels, and a locked recording plays back) — against what we had:

| Telegram | Ours, before | Gap |
| --- | --- | --- |
| Hold to record | Hold to record | none |
| Slide left cancels | the sideways slide was not read at all | the whole gesture |
| Release sends | release staged it in the tray behind «Отправить» | the point of releasing |
| Swipe up locks | swipe up locked | none |
| Locked: pause, listen, delete, send | «Остановить», which staged it | no preview, no delete |
| A short press hints by the button | three modal alerts | the interruption |

Only two of the six matched. The three the owner named — slide to cancel,
release to send, and a lock with a pause and a preview — were the three missing.

### Implemented on the working branch, not deployed

Corrected after the fact, because the distinction matters to whoever reads this
next: `feat/recording-gesture` is only a label on the same commit as
`integration/message-actions`. The work was committed straight onto the shared
working branch, not onto a side branch that could be dropped in one move, and
two of its commits reached `origin/codex/bot-platform` in pushes made for other
work before that was noticed. Nothing of it is in production: every one of its
commits was checked against the deployed `17a1c47` and none is an ancestor —
the deployed commit predates the first of them by six minutes. The deploy hold
the original note claimed to be respecting had in fact been lifted by the owner
earlier that night; what kept this out of production was the ordering, and the
decision not to push `main` again while its visuals are unsettled.

- `artifacts/kub/src/lib/recordingGesture.ts` holds the rules as pure functions
  that import nothing, so `tests/unit/recording-gesture.test.mts` reads them
  without a browser, a microphone or a pointer. Eight mutations of those rules
  each turn the suite red.
- `ComposerRecordingRow.tsx` is the composer's row while recording, in the chat
  screen's own glass capsule: held, locked and paused.
- Releasing sends. `ChatWindow`'s two handlers stage and send in one step, the
  way the attach sheet sends what it picked, so the tray carries a recording only
  while it is on its way.
- Crossing the cancel threshold discards at once rather than waiting for the
  release, which is Telegram's mechanic and makes the slide something a person
  feels their way through.
- The three modal alerts are gone: a press too short to be a recording leaves a
  hint beside the button, and the «one recording at a time» rules went with the
  tray they existed for.

**One defect found in our own new code, by the renders rather than by reading.**
The gesture was tracked through `setPointerCapture` on the record button, and the
button is re-parented the moment the recording row replaces the field beside it —
the capture goes with it. Measured on the DEV preview route: the lock rail filled
to 0.28, the last move still over the button's own 44 points, and then did not
move again across a 96-point drag, so the recording never locked and the release
sent it. The gesture is now tracked on the window, which sees the whole drag
whatever the composer does to its children.

### Rendered for the owner, 2026-09-12 — his choice, not settled

`scripts/render-recording-frames.mjs`, twenty frames in
`output/renders/2026-09-12-recording-gesture/`: five states — held, slid part of
the way to the cancel, locked, stopped for a listen, and the short-press hint —
on an iPhone 430×932 and a desktop 1440×900, in both themes, over the checked-in
fictional conversation, with Chromium's fake microphone. Each frame measures what
it shows before it is photographed and refuses itself if a camera was opened, if
more than one microphone was, or if anything was left waiting in the tray.

Three things are for the owner to judge, and none of them is decided here:

1. **The lock rail is very quiet** — a small glyph and a hairline above the
   microphone. It is the weakest thing on the sheet, and Telegram's is a clear
   pill with a chevron.
2. **The row follows the finger left and the timer goes with it.** That is what
   makes the slide readable, and on the sheet the half-slid state looks clipped.
   Telegram keeps the timer still and moves only the hint.
3. **On a desktop the row follows the mouse left as well**, although sliding is
   not the desktop's cancel — releasing outside the field is. It may be that the
   desktop row should not move at all.

### The owner ruled on all three, 2026-09-12: the slide goes

He answered with two screenshots of Telegram itself and one sentence — «Запись
голосового переделай также под современный стиль telegram, без сдвига вбок, у
них просто кнопка посередине - отмена» — plus «Рейка фиксации и на пк версии
тоже». The rest of the sheet he passed. Done on `design/recording-telegram-row`,
not deployed, and not settled until he has seen the new sheets.

**The sideways slide is gone on every shell.** `RECORDING_CANCEL_SLIDE_PX`,
`slideCancelProgress`, `slideFollowX`, the `cancelling` hold and the diagonal
rule that arbitrated between the two axes are all deleted; `readRecordingHold`
takes one number, `dy`. Nothing translates, so the third defect on the list above
went with it rather than being fixed: the timer was clipped **by** the movement —
`04` for `00:04` on the phone, `:03` on the desktop — and there is no movement
left to clip it.

**«Отмена» is a button in the middle of the row**, in all three states, on the
phone and on the desktop. The row is a `1fr auto 1fr` grid, so the middle column
is centred by the grid rather than by a number. A held recording is thrown away
by letting go **on** that button — `overCancelButton`, the button's box inflated
12 points on every side — and a locked one by clicking it. Two consequences worth
stating:

- **The desktop's hidden rule is gone.** «Release outside the composer cancels»
  existed because the desktop had no visible cancel; it does now, and a hidden
  destructive gesture over a 44-point row is worse than no gesture. One rule for
  both pointers.
- **Crossing onto the cancel no longer discards on the spot.** The threshold used
  to fire mid-drag; the button only arms — it turns from accent to danger — and
  the release is what acts. A person can now change their mind after arriving.

**The lock rail is a capsule**, 40 points wide and **62 tall**, of the panel
material through `KubGlassLayer` (rule 1), with a padlock above a chevron that
rises and fades as the finger comes up. It was a 15-point glyph over a
one-pixel line. It is drawn **on the desktop too**, which he asked for by name,
and it is placed over the record button's centre rather than the row's — measured
at 0px off on all eight frames that have one.

**Locking with a mouse is the same gesture as with a thumb**: press the button,
pull the pointer up onto the capsule, release. Nothing new was invented for it.
A plain **left** click with a mouse still switches nothing and starts nothing — the mouse's way into the other
mode is the **right** button, which `handleRecorderContextMenu` carries and `video-message.spec.ts` covers
by name; under a finger it is a tap shorter than 320ms with no travel. Neither sentence used to say which device
it meant, and read side by side they looked like a contradiction (D-158). Here it means the mouse —
Telegram Desktop's click-to-start-a-locked-recording was **not** copied, because
it collides with our tap-to-switch-mode and the short-press hint.

**The timer carries tenths, `00:05,2`**, as Telegram Desktop writes it, comma
included: it is the one clock in the product a person watches while it runs, and
a seconds-only readout stands still for exactly as long as it takes to wonder
whether the recording started. The tick went from 250ms to 100ms. The **paused**
row keeps whole seconds — that is a recorded length, not a clock.

**What was compared against Telegram and deliberately left alone:** the red
pulsing dot and its position; the blue circular send at the right edge; hold to
record, release to send, swipe up to lock; the locked row's pause / listen /
delete / send; the hint beside the button instead of a modal. One thing was
removed rather than kept: the separate trash in the locked row, because «Отмена»
is now that control and Telegram's own bar has one way out, not two.

Measured on the new frames, twenty of twenty passing their own verdicts, with
mic 1, camera 0 and an empty tray on every one:

| | held | locked / paused |
| --- | --- | --- |
| «Отмена» off the composer's centre | −22px | +4px |
| Lock rail off the record button's centre | 0px | — |
| Row transform | `none` | `none` |

The −22 is the one asymmetry and it is deliberate: while the finger is down the
record button stays under it as a sibling, so the row is 52 points narrower than
the composer (a 44-point button and its 8-point gap) and its middle column is
half of that to the left. Moving the button inside the row would centre it
exactly and would re-parent the button mid-gesture, which is precisely how the
lock broke last time. The verdict function allows 28px held and 8px locked, so a
regression either way fails the render rather than being noticed on a sheet.

Still not proven: everything here is Chromium at 430×932 and 1440×900. No finger
has touched it. The touch thresholds, the forgiveness of the inflated cancel box
and whether the rail is reachable with a thumb on a real iPhone are all device
questions, and `video-message.spec.ts` — updated for the new testids and the new
wording — cannot run on this workstation, because `loadQaEnvValues()` makes it
attempt a real sign-in against a fixture backend.

### The rectangular video, decided here as D-122 asked

Removed rather than rehoused. Telegram has no rectangular recorder anywhere: its
attach sheet has no such item, its composer button records voice and round video,
and Telegram Desktop has no in-app video recorder at all. `videoRecorderVariant`
is set to `"round"` at every call site, so `VideoMessageRecorderModal`'s `regular`
branch has been unreachable since D-122 retired «Записать видео» — it is dead
code, not a missing entry point. On a phone the gallery's «Камера» still reaches
video through the system camera; on a desktop a video is attached as a file. The
two permanently skipped cases in `video-message.spec.ts` are deleted, because a
test that can never run is a reminder rather than coverage. The modal's own
`regular` branch is left in place for now and should be removed with its status
copy in a separate change, so the glass counts in
`tests/unit/product-overlay-glass.test.mjs` and `shell-glass.test.mjs` move in a
commit that is about exactly that.

### The stopped recording, corrected on the owner's second screenshot (2026-09-12)

He sent Telegram Desktop's **stopped** state — a recording that has been ended
and is waiting to be sent — and it corrects a decision made two paragraphs above
this one. What it shows, left to right: **a bin at the left edge**, an outline
icon and its own control; a **bar across the rest of the width** with a playhead
part of the way along it; on that bar, roughly centred, **a small inline play
control reading `▶ 0:03`** — the triangle and the elapsed time as one thing,
sitting on the bar rather than beside it; and the **blue circular send at the
right edge**. There is **no «Отмена» anywhere** in that state.

So the sentence above — «One thing was removed rather than kept: the separate
trash in the locked row, because «Отмена» is now that control and Telegram's own
bar has one way out, not two» — was right about the count and wrong about which
control it is. There is one way out per state. It is «Отмена» while the
recording is still running, held or locked, and it is the bin once the recording
has stopped. Removing the bin everywhere removed it from the one state Telegram
keeps it in.

What changed:

- **`recordingRowControls(phase)`** in `lib/recordingGesture.ts` now answers
  which controls the row carries, so this is a rule with a test rather than a
  condition spread through the markup. `cancelButton` and `trash` are never both
  true and never both false, which is the invariant the mistake broke, and
  `tests/unit/recording-gesture.test.mts` holds it for all three phases.
- **The stopped row is `auto 1fr auto`** — bin, bar, send — where the running
  row stays the `1fr auto 1fr` the owner approved: the red dot and the running
  time at the left, «Отмена» centred, pause and send at the right. Nothing about
  the held and locked states moved.
- **The play control and the length are one control, on the bar.** They were a
  separate round button at the left and a separate duration at the far right,
  with a hairline track between them. The pill stands on a `KubGlassLayer`
  capsule of the panel material, as the lock rail does, because it crosses the
  track it sits on and rule 1 says a fill comes from the material.
- **`formatRecordingLength`** writes `0:03`, not `00:03`: minutes unpadded, no
  tenths. A stopped recording has a length, and the running clock's tenths are
  for a number a person is watching move.
- One defect fixed in passing, in the code being replaced: the preview's effect
  added four listeners and removed two, so `play` and `pause` went on setting
  state after the row had gone.

Measured on the twenty re-rendered frames, the four stopped ones among them:

| | held | locked | stopped |
| --- | --- | --- | --- |
| «Отмена» | centred, −22px | centred, +4px | **absent** |
| Bin | absent | absent | **present, 4px from the left edge** |
| Send | absent (button under the thumb) | present | present, 4px from the right edge |
| Bar's share of the row | — | — | **76% (iPhone), 90% (desktop)** |
| Play control off the row's centre | — | — | **0px**, and on the bar |

Still a progress bar rather than a waveform. Telegram draws the real envelope of
the clip; ours draws how far through it the playhead is. Drawing the envelope
means decoding the recorded blob, which is a change of a different size, and a
waveform invented rather than measured would be a picture of an audio file that
is not this one.

### Not built: Telegram's play-once voice message

Recorded here because the owner's screenshot contains it and we have no
equivalent, **not** because anything was implemented. Above and to the right of
Telegram Desktop's stopped row, outside the row itself, there is a circular «1»
button beside the microphone, and its tooltip reads «Нажмите, чтобы сообщение
исчезло после прослушивания». It arms the recording about to be sent so that it
can be played once and then disappears for the listener.

Worth considering later, and worth thinking about properly before it is:
it is not a drawing job. It needs a per-message flag that survives delivery, a
server-side rule that stops the media being fetched a second time, a decision
about what the sender sees afterwards, and an answer for the Windows and Android
shells. None of that exists today. No estimate, no place in the queue, and no
part of the current change.

## D-131 `[ ]` «Местоположение» sends exact coordinates on one tap, with no map and no confirmation

**Severity:** high, for privacy: a mistaken tap tells the chat where a person is. Found by
the chat-functions audit from the code; the resulting bubble is in frames 12 and 32.

**Surface:** `artifacts/kub/src/components/chat/MessageInput.tsx:574-591` (changed in
`bce98f3`; lines may have moved); `artifacts/kub/src/lib/formatText.tsx:112-206`.

**Defect:** the item reads the position and at once sends the text «📍 Местоположение:
https://maps.google.com/?q=…», drawn as «📍 55.75124, 37.61842» with a link to Google
Maps. Nothing shows what will be sent, and nothing asks.

**Proposed:** now, a confirmation that shows what will be sent. Then Telegram's location
tab inside the attach sheet (D-122): a map preview with «Отправить моё местоположение»,
and a bubble with a small map and the address. The map provider is the owner's choice
(owner summary, question 7).

**Audit rows:** chat-functions S6; the audit's owner question 7.

## D-132 `[ ]` Errors and unavailable features show server, database and build internals

**Severity:** medium. Found by all three audits from the code; most of these states need a
failing server and were not rendered.

**Surface:**

- Starting a chat: `artifacts/kub/src/hooks/useCreateChat.ts:18, 39-44` and
  `artifacts/kub/src/components/sidebar/NewChatModal.tsx:61-66`: «Not logged in», the
  server's English message, or a JSON dump (chat-functions A3).
- Saving a username: `artifacts/kub/src/lib/profileValidation.ts` and
  `artifacts/kub/src/lib/errors.ts`, shown by
  `artifacts/kub/src/components/sidebar/SettingsModal.tsx`: a taken name reads «Такая
  запись уже существует.», only after «Сохранить», in a box under the header
  (settings-profile C4, B5).
- Phone verification: `artifacts/kub/src/components/sidebar/PhoneSection.tsx`: «Сервис
  доставки кода не настроен. Обратитесь к администратору.» (settings-profile D5).
- Android push: `artifacts/kub/src/hooks/usePush.ts`,
  `artifacts/kub/src/lib/platform/nativePush.ts` and
  `artifacts/kub/src/lib/platform/capabilities.ts`: «…нужны локальный
  google-services.json, применённая migration user_push_devices и backend FCM
  credentials.» (settings-profile F2).
- Search: `artifacts/kub/src/components/chat/ChatSearchBar.tsx:207-209` and
  `artifacts/kub/src/components/search/SidebarSearchResults.tsx:96-106` (a third citation,
  `GlobalSearchPalette.tsx:213-237`, carried the same two messages and was deleted with that file on
  2026-09-12; the messages themselves are unaffected): «Поиск сейчас
  выполняется по загруженным сообщениям.», «Поиск по всей истории требует обновления базы
  данных…» (chat-functions P3, O1).
- Tasks: `artifacts/kub/src/pages/tasks/TaskFormModal.tsx:625-629, 751-755`,
  `artifacts/kub/src/lib/recurringTasks.ts:4` and
  `artifacts/kub/src/lib/locationRouting.ts:4`: «Повторяемые задачи требуют обновления
  базы данных…» (work-surfaces T-F7).
- Administration: `artifacts/kub/src/pages/admin/LocationsTab.tsx:237-279` (A-31);
  `artifacts/kub/src/pages/admin/InvitesTab.tsx:232-236` with
  `artifacts/kub/src/lib/registrationInvite.ts:6, 8`: «Примените SQL-предложение
  20260622_registration_invite_codes.sql.» (A-34);
  `artifacts/kub/src/pages/admin/RolesPermissionsTab.tsx:472-496` (A-47);
  `artifacts/kub/src/pages/admin/OpsReportTab.tsx:142-162`, which names the function
  `admin_ops_security_report` (A-54).

**Defect:** when a call fails or a database object is missing, the cause reaches the
screen as it is: English server text, a JSON dump, migration file names, function names
and build prerequisites. Nobody reading them can act on them, and the chat and settings
ones reach every signed-in person.

**Proposed:** one plain Russian sentence per failure, beside the control that failed
(«Не удалось открыть чат. Попробуйте ещё раз.», «Это имя пользователя уже занято», «Не
удалось отправить код. Попробуйте позже.», «Приглашения временно недоступны»); the cause
goes to the log. A feature whose database object is missing is hidden and reported to
operators, not explained on screen.

**Audit rows:** chat-functions A3, P3, O1; settings-profile B5, C4, D5, F2; work-surfaces
T-F7, A-31, A-34, A-47, A-54.

## D-133 `[ ]` Destructive and far-reaching actions run on one tap, with no confirmation

**Severity:** high in administration, where three of these are P1 in the audit; medium
elsewhere. Found by the work-surfaces and settings audits from the code; a missing
confirmation cannot be pictured.

**Surface:**

- `artifacts/kub/src/pages/admin/UsersTab.tsx:880-916, 200-210`: «Снять блокировку» and
  «Снять мьют» (work-surfaces A-18; see D-134).
- `artifacts/kub/src/pages/admin/RolesPermissionsTab.tsx:988-1090, 439-450`: «Снять» on a
  global role assignment (A-45).
- `artifacts/kub/src/pages/admin/BansMutesTab.tsx:132-188, 340-381`: «Снять», offered on
  expired rows too (A-49).
- `artifacts/kub/src/pages/admin/UsersTab.tsx:666-745`: bulk «Назначить роль» and
  «Назначить локацию»; «Снять роль» already asks (A-16).
- `artifacts/kub/src/pages/admin/LocationsTab.tsx:384-439`: «Архивировать» (A-28); and
  `:511-557`: «Убрать» a member (A-30).
- `artifacts/kub/src/pages/admin/InvitesTab.tsx:200-242`: the registration-mode switch,
  which can open registration to everyone (A-33); and `:427-536`: «Отозвать», still
  enabled on expired links (A-38).
- `artifacts/kub/src/pages/admin/RolesPermissionsTab.tsx:872-977`: «Сохранить права»
  replaces the role's whole set (A-44).
- `artifacts/kub/src/pages/admin/SupportTab.tsx:604-738`: turning support intake off
  (A-69).
- `artifacts/kub/src/components/bots/BotSettingsPanel.tsx:90-106, 120-163`: «Убрать» the
  bot's picture (B-08); `:201-211`: «Удалить webhook» (B-12); `:236-244`: removing a
  developer (B-15).
- `artifacts/kub/src/components/sidebar/SettingsModal.tsx`: «Удалить фото» in the settings
  header (settings-profile C2).
- `artifacts/kub/src/components/sidebar/PhoneSection.tsx`: «Удалить» a verified number,
  through the gateway (settings-profile D4).

**Defect:** each acts the moment it is pressed. Several change what other people can do:
registration, support intake, a role's permissions, a person's access.

**Proposed:** Telegram's alert: a title, one line saying what will stop working, a red
confirm, and focus on «Отмена». Make it one shared component for tasks, administration,
bots and settings (work-surfaces B-18). Where the audit moves an action into a row menu
or a profile page, the alert moves with it.

**Audit rows:** work-surfaces A-16, A-18, A-28, A-30, A-33, A-38, A-44, A-45, A-49, A-69,
B-08, B-12, B-15 (top-10 item 10); settings-profile C2, D4.

## D-134 `[ ]` Lifting a ban or a mute deletes the person's whole sanction history

**Severity:** high, for moderation records. Found by the work-surfaces audit from the
code; not reproduced.

**Surface:** `artifacts/kub/src/pages/admin/UsersTab.tsx:880-916, 200-210`: the row menu
«Действия», items «Снять блокировку» and «Снять мьют». Frame
`admin-owner-desktop-04-users-row-menu.png` shows the menu.

**Defect:** both items act at once and delete every ban or mute row for that person,
expired history included, instead of ending the current restriction. The audit did not
check whether the separate action log keeps a trace.

**Proposed:** lift only the active restriction, after an alert (D-133), and keep past
restrictions for a «История» section and the action log (work-surfaces A-48). Check that
«Снять» in «Блокировки» (A-49), which the audit does not describe as deleting history,
does not delete it either.

**Audit rows:** work-surfaces A-18.

## D-135 `[ ]` Sign-out ends the session on one tap

**Severity:** medium. Found by the settings audit from the code; not rendered, because
signing out would have ended the fixture session.

**Surface:** the avatar menu in `artifacts/kub/src/components/sidebar/SidebarHeader.tsx`,
calling `auth.signOut()` through `artifacts/kub/src/hooks/useUser.ts`. The menu is in
frames `settings-profile-frame-p02.png` and `settings-profile-frame-d01.png`.

**Defect:** «Выйти», the last item of the menu that opens from a person's own avatar,
signs out immediately.

**Proposed:** «Выйти» at the end of Настройки, always followed by «Вы действительно хотите
выйти?» (Telegram Desktop's `lng_sure_logout`; iOS and Android confirm as well; audit
sources [Desk-main], [TR], [iOS-logout], [And-logout]).

**Audit rows:** settings-profile A5; top-10 item 7.

## D-136 `[ ]` Closing settings throws away a typed name, username or bio without asking

**Severity:** medium. Found by the settings audit from the code; the footer is in every
settings frame.

**Surface:** the footer of `artifacts/kub/src/components/sidebar/SettingsModal.tsx`,
inside `artifacts/kub/src/components/kub/KubModal.tsx`.

**Defect:** «Сохранить» saves only «Имя», «Никнейм» and «О себе»; every other control on
the same screen saves at once. ✕, «Закрыть», Escape and a click on the backdrop all close
the window and drop unsaved text without a word, so a person who flipped a switch and then
typed a bio can reasonably believe both were kept.

**Proposed:** Telegram's model: switches apply at once, and profile text is edited on its
own «Изменить профиль» screen with «Готово» and «Отмена». Until that screen exists,
closing with unsaved text asks whether to discard it.

**Audit rows:** settings-profile B4; top-10 items 1 and 5.

## D-137 `[ ]` Notification category switches look on and do nothing until device push is enabled

**Severity:** medium. Found by the settings audit; rendered (frames p05, l01, a01).

**Surface:** `artifacts/kub/src/components/kub/KubSwitch.tsx` (the disabled state);
`artifacts/kub/src/components/sidebar/SettingsModal.tsx` and
`artifacts/kub/src/hooks/usePush.ts` (the switches «Сообщения», «Задачи» and
«Приглашения», stored in `notification_preferences`).

**Defect:** until «Push-уведомления» is on, the three switches are disabled, but their
track and thumb keep the enabled look on a dark 44 px square (pale blue in the light
theme). They read as on and tappable, and a tap does nothing. A person cannot choose which
notifications they want before granting the device permission.

**Proposed:** let the categories be set before the device switch is on, since they are
stored preferences, and draw a disabled switch dimmed, with no box. Part of the
«Уведомления и звуки» screen in the parity work.

**Audit rows:** settings-profile B6, F3; top-10 item 6.

## D-138 `[ ]` The phone code step looks already filled in, and calls the number confirmed while it is being changed

**Severity:** medium. Found by the settings audit; rendered (frame p09).

**Surface:** `artifacts/kub/src/components/sidebar/PhoneSection.tsx`, the code step after
«Изменить номер».

**Defect:** the code field's placeholder is «1234», as long as a real code, so it reads as
a code already entered; the old number's badge «Подтверждён» stays on screen; and
«Удалить» sits among «Подтвердить», «Отмена» and «Повторно через 2:00». The screen does
not say which number is confirmed, or whether a code went in.

**Proposed:** a code screen with four digit cells and auto-submit, no placeholder digits,
«Отправить код повторно через 1:59» as text, and the old badge and «Удалить» hidden during
the step.

**Audit rows:** settings-profile D3 (with D2); top-10 item 8.

## D-139 `[ ]` A location found in search, and a ban notification, lead to a refusal or a bounce

**Severity:** medium. Found by the work-surfaces audit from the code.

**Surface:** `artifacts/kub/src/components/search/SearchShared.tsx:407-420` and
`artifacts/kub/src/hooks/useGlobalSearch.ts:639-681` (location results);
`artifacts/kub/src/components/sidebar/NotificationBell.tsx:213-243, 1008-1051`
(notification routing).

**Defect:** search returns locations to anyone the database lets read them, but a
location result opens `/admin/locations`, so everyone except global staff gets «Нет
доступа» and «Локация недоступна для вашего профиля.». A `ban_issued` notification opens
`/admin`, which sends anyone who is not staff, including the person the notice is about,
back to `/`.

**Proposed:** show location results only to people who can open a location, and open the
location's own page (D-123) instead of the admin tab. Stop routing a ban notice to
`/admin`.

**Audit rows:** work-surfaces E-08, E-09.

## D-140 `[ ]` In «Блокировки» a failed load reads as "no bans", and every realtime reload blanks the tab

**Severity:** medium, for moderation: an administrator can conclude that nobody is
restricted. Found by the work-surfaces audit from the code.

**Surface:** `artifacts/kub/src/pages/admin/BansMutesTab.tsx:50-113, 64-68, 219-222`.

**Defect:** a failed fetch renders the empty states «Активных банов нет» and «История
санкций пока пуста», and every realtime reload replaces the whole tab with a spinner.

**Proposed:** keep the content during reloads, and show a real error state with
«Повторить».

**Audit rows:** work-surfaces A-50.

## D-141 `[ ]` The users search invites «@username», and a leading «@» finds nobody

**Severity:** low. Found by the work-surfaces audit from the code.

**Surface:** `artifacts/kub/src/pages/admin/UsersTab.tsx:562-578, 104-130, 266-281`.

**Defect:** the placeholder «Поиск по имени, @никнейму или ID» suggests typing «@olga»,
but the «@» is never stripped, so that query matches nobody. Queries also match raw IDs.

**Proposed:** strip a leading «@», and make the placeholder «Имя или @имя пользователя».

**Audit rows:** work-surfaces A-13.

## D-142 `[ ]` Administration forms offer what they then refuse, and drop what was entered

**Severity:** medium. Found by the work-surfaces audit from the code; the invitation form
is rendered (frames `admin-owner-*-10-invites-*`).

**Surface:** `artifacts/kub/src/pages/admin/InvitesTab.tsx:87-90, 574` (A-37) and
`:281-423` (A-36); `artifacts/kub/src/pages/admin/LocationsTab.tsx:442-504` (A-29).

**Defect:**

- The invitation form offers «Владелец» and «Тех. администратор» in «Глобальная роль» to
  every administrator, and only after submit refuses with «Критические роли может выдавать
  только тех. администратор.»
- In the same form, «Автоматически» in «Роль в локации» snaps back to a role the moment it
  is chosen, so it cannot stay selected.
- Location assignment clears its selects when «Назначить» is pressed, even when the call
  fails, so a failed assignment has to be entered again.

**Proposed:** offer only the roles the person can grant; make «Автоматически» a real
choice or remove it; keep the form's values when the call fails.

**Audit rows:** work-surfaces A-29, A-36, A-37.

## D-143 `[ ]` On a phone the support workspace can leave the screen and the address disagreeing, and a failed ticket load has no way back

**Severity:** medium, for support operators on phones. Found by the work-surfaces audit;
the stacked headers are rendered (frame `admin-owner-phone-17-support-ticket-a.png`), the
back behaviour is inferred from the code.

**Surface:** `artifacts/kub/src/pages/admin/SupportTab.tsx:68-70, 346, 407-453`;
`artifacts/kub/src/pages/admin/support/SupportTicketDetails.tsx:96-103, 130-140`.

**Defect:** the selected ticket is read from the URL only on mount, so browser or Android
back can leave the URL and the screen disagreeing (inferred, not reproduced). A failed
ticket load shows «Выберите обращение» with no way back to the queue. Five header bands
stack above an open ticket, and the conversation and the details share one column that
scroll separately.

**Proposed:** route `/admin/support/:ticket` as a pushed page with a back arrow in its
header; the details become that ticket's info page.

**Audit rows:** work-surfaces A-70.

## D-144 `[ ]` Support ticket actions hide their rules and misstate the ticket

**Severity:** low to medium, for support operators. Found by the work-surfaces audit from
the code; the action grid is rendered (frames `admin-owner-*-17-support-ticket-*`).

**Surface:** `artifacts/kub/src/pages/admin/support/SupportTicketDetails.tsx:167-289`
(A-65) and `:343-425` (A-67);
`artifacts/kub/src/pages/admin/support/SupportConversation.tsx:41-141` (A-63);
`artifacts/kub/src/pages/admin/support/SupportQueue.tsx:139-175` (A-60);
`artifacts/kub/src/pages/admin/SupportTab.tsx:604-738` (A-69).

**Defect:**

- «Подтвердить» in the inline transfer and resolve editor stays disabled until three
  characters are typed, with no hint (A-65); «Сохранить» in «Настройки поддержки» is
  disabled without saying why (A-69).
- The composer notice «Сначала примите обращение или откройте назначенное вам
  обращение.» also appears on closed tickets, and «Для ответа требуется право «Ответы
  поддержки».» names a permission that is labelled «Отвечать в обращениях» (A-63).
- The ticket history lists events without who acted (A-67), and a queue row says
  «Назначено оператору» without naming the operator (A-60).

**Proposed:** show the minimum beside the field and say why a save is unavailable; on a
closed ticket, say that it is closed; use the permission's real name; put the actor on
every event and the operator's name on the row.

**Audit rows:** work-surfaces A-60, A-63, A-65, A-67, A-69.

## D-145 `[ ]` Bot settings save silently, need the secret retyped to save the webhook, and the list ignores the bot's picture

**Severity:** low, for bot owners and developers. Found by the work-surfaces audit from
the code; the pages are rendered (frames `bots-owner-*`).

**Surface:** `artifacts/kub/src/components/bots/BotSettingsPanel.tsx:44-52, 108` (B-19)
and `:201-211` (B-12); `artifacts/kub/src/pages/bots/BotsPage.tsx:127-130` (B-03).

**Defect:** no save shows a success message, and errors appear in one banner above the
tabs, far from the section that failed. In «Webhook» the signing secret, which is not
shown after saving, must be typed again before anything in that section saves. The list
draws a robot tile for every bot and ignores its `avatar_url`.

**Proposed:** a toast «Сохранено», and errors beside their section; decide whether a
stored secret can be kept when other webhook fields change; draw the bot's own picture in
the list.

**Audit rows:** work-surfaces B-03, B-12, B-19.

## D-146 `[ ]` Administration shows a legacy role that contradicts a person's real role

**Severity:** medium, for administrators reading who may do what. Found by the
work-surfaces audit from the code and the 2026-09-04 migration notes; the profile dialog
is rendered (frames `admin-owner-*-05-users-profile-a.png`).

**Surface:** `artifacts/kub/src/pages/admin/UsersTab.tsx:996-1234` with
`artifacts/kub/src/components/profile/ProfileRoleSummary.tsx:114-216` (the profile
dialog); `artifacts/kub/src/pages/admin/dashboard/RecentActivity.tsx:15-35` (the
dashboard's «Новые пользователи»).

**Defect:** the profile dialog shows «Базовая роль: Пользователь», from the legacy
`profiles.role`, beside «Глобальные роли: Владелец» for the same person, and the dashboard
labels new people from the same legacy field. The migration notes name two accounts that
are owners by assignment. A global manager sees only the legacy labels (A-17).

**Proposed:** label people from their global roles everywhere, and drop «Базовая роль».

**Audit rows:** work-surfaces A-09, A-21 (A-17 for the manager's view).

## D-147 `[ ]` «Открыть оригинал» opens the raw file address in a browser tab, which takes a person out of the Windows and Android apps

**Severity:** medium, for the installed apps. Found by the chat-functions audit from the
code; the button is in frame 16.

**Surface:** `artifacts/kub/src/components/chat/MediaViewer.tsx:121-131, 159-166`.

**Defect:** the viewer's «Открыть оригинал» opens the stored file's address in a new
browser tab; in the Windows and Android shells that leaves the app. For a compressed photo
it also opens the compressed copy, which is D-097.

**Proposed:** «Сохранить» in the viewer's ⋯ menu, downloading the stored file inside the
app, as Telegram Desktop's «Save As…» and Android's «Save to Gallery» (audit sources T27
and T14); no raw address.

**Audit rows:** chat-functions M5; top-10 item 6.

## D-148 `[ ]` «На весь экран» in the video viewer wears the external-link icon and has no name on a phone

**Severity:** low, for accessibility. Found by the chat-functions audit; rendered (frame
17, where a phone shows two identical icons side by side).

**Surface:** `artifacts/kub/src/components/chat/MediaViewer.tsx:132-141`.

**Defect:** the fullscreen button is drawn with the same external-link icon as «Открыть
оригинал» beside it; below 640 px its word is hidden and the button has no accessible
name. D-094 fixed the same gap on «Открыть оригинал».

**Proposed:** a fullscreen icon inside drawn video controls, with an accessible name.

**Audit rows:** chat-functions M6 (with V4).

## D-149 `[ ]` Two stored playback volumes override each other

**Severity:** low. Found by the chat-functions audit from the code at `f979ec9`, before
D-118.

**Surface:** `artifacts/kub/src/components/chat/AudioMessage.tsx:108-112, 132, 161`;
`artifacts/kub/src/components/chat/ChatMediaPlayback.tsx:249-265, 312-316`. Both files
changed in `bce98f3`; lines may have moved.

**Defect:** the sound settings' `voicePlaybackVolume` is written to a voice bubble's
`<audio>`, and the player's own saved volume (`kub.mediaPlayback.v1`) overwrites it on
`activate` or `play`, so the volume that applies depends on how playback started. D-118
plays both at full volume under a finger; on a desktop, where both controls remain, this
is to be checked against `bce98f3`.

**Proposed:** one source of volume: none under a finger, the player's own on a desktop;
delete the other.

**Audit rows:** chat-functions V6 (V2 for the settings slider).

## D-150 `[ ]` A group's owner cannot leave it, only delete it for everyone

**Severity:** low. Found by the chat-functions audit from the code; the delete
confirmation is in frame 11.

**Surface:** `artifacts/kub/src/components/chat/ChatInfoPanel.tsx:1504, 1517-1531,
1902-1942`.

**Defect:** the owner gets no «Покинуть группу», only «Удалить групповой чат», and
ownership cannot be transferred. The confirmation says the same thing twice («Чат и
история исчезнут у всех участников.», «После удаления группа исчезнет у всех
участников.»). An owner who wants out can only end the group for everyone.

**Proposed:** Telegram's model since February 2026: an owner can leave, choosing a new
owner in the confirmation, otherwise an administrator inherits after a week; ownership
can be transferred at any time; «Удалить группу» moves into «Управление группой» with one
sentence (audit source T50). The audit put this to the owner; the owner summary states it
as the default under the standing rule.

**Audit rows:** chat-functions B14; top-10 item 7.

**Addendum, 2026-09-13.** Ownership transfer is possible in the database and impossible from the interface. The
trigger `enforce_chat_member_update` admits an owner promoting another member to owner
(`20260504_chats_membership_hardening.sql:417-418`), with last-owner protection on both update and delete
(`:438-450`, `:461-488`). But `setMemberRole` in `ChatInfoPanel.tsx:897` is typed
`(userId, role: "admin" | "member")` — `owner` is not expressible from the UI at all. So the half of
this entry's proposal that needs no migration is already permitted by the server and only missing a control.

## D-151 `[ ]` «Управление» does not fit the proposed bottom capsule, and «Настройки» does not fit it either below 375

**Severity:** medium, and on unbuilt work. It lands in the product the moment the
approved A+ capsule is built as drawn, at 360 and 390 — the two phone widths the
release matrix actually covers.

**Surface:** the proposal, on `design/navigation-ios`:
`artifacts/kub/src/components/layout/FloatingTabBar.tsx:98` (the tab button,
`flex-1 min-w-[44px] px-1`) and `:120` (the label, `text-[11px] font-semibold
leading-[13px]`, sentence case, no `truncate` and no `whitespace-nowrap`), with
the geometry in `artifacts/kub/src/styles/navigationOptions.css:26-27` (gutter
`0.75rem`, height `3.625rem`), `:209-217` (the bar, `gap: 0.5rem`), `:239-241`
(the strip, `padding: 0.25rem`) and `:260-263` (the round search button, the
bar's height square). Not in `integration/message-actions`, where
`components/layout/BottomNav.tsx` is still the docked six-tab bar.

**Defect:** the width one tab gives its label is `(viewport − 98) ÷ 4 − 8`. The
owner's two accepted answers together put «Чаты», «Задачи», «Управление»,
«Настройки» in that capsule, and two of the four words are wider than the box:

| Viewport | Label box | «Управление» 66.22 | «Настройки» 59.78 | Narrowest gap between two labels |
| --- | --- | --- | --- | --- |
| 320 | 47.50 | over by 18.72 | over by 12.28 | **−7.50** — the words overlap |
| 360 | 57.50 | over by 8.72 | over by 2.28 | **2.50** = 0.90 of a space |
| 375 | 61.25 | over by 4.97 | fits by 1.47 | 6.25 = 2.25 spaces |
| 390 | 65.00 | over by 1.22 | fits by 5.22 | 10.00 = 3.60 spaces |
| 430 | 75.00 | fits by 8.78 | fits by 15.22 | 20.00 = 7.19 spaces |

Widths measured with a `Range` over the rendered glyphs in the product's own
font, at 600 weight and 11px, on a dev server with Inter confirmed loaded — not
estimated from character counts. A space in that font at that size is 2.78px,
measured by difference («Чаты Чаты» less «ЧатыЧаты»); the same method gives
3.02px at 12px, which is the figure D-061 recorded for this font.

**It neither truncates nor wraps.** The label declares no `truncate` and no
`whitespace-nowrap`, «Управление» is one word with no break opportunity, and the
button does not clip — so the word paints past its own padding into its
neighbour. At 360 the two labels sit 2.50px apart in a font whose space is
2.78px, which is D-061 exactly: the register's figure there was 3.18px against a
3.02px space, and the words read as one phrase.

**The administration word is not the whole of it.** With «Админка» kept (49.91)
the binding label becomes **«Настройки»**, which still overflows at 320 by 12.28
and at 360 by 2.28. The four-tab capsule with a round search button beside it
does not fit the low end whatever the third tab is called — the round button and
the gutters take 90px, a quarter of a 360px row. The other accepted decision,
that the fourth tab is «Настройки» rather than «Профиль», costs 10.15px of label
by itself.

**Measured alternatives**, same method, ✗ = at least one label overflows:

| Option | 320 | 360 | 375 | 390 | 430 |
| --- | --- | --- | --- | --- | --- |
| As proposed, 11px, 4 tabs + round button | ✗ | ✗ | ✗ | ✗ | ok |
| **Round search button dropped, strip full width** | ✗ by 2.22 | **ok by 7.78** | ok | ok | ok |
| 10px labels, round button kept | ✗ | ✗ by 2.69 | ok by 1.06 | ok | ok |
| 9px labels, round button kept | ✗ | ok by 3.33 | ok | ok | ok |
| Short admin word («Панель», «Доступ», «Админ») | ✗ | ✗ | ok | ok | ok |
| Search as a fifth tab, no round button | ✗ | ✗ | ✗ | ✗ by 2.62 | ok |
| Icon-only tabs | ok | ok | ok | ok | ok |

320 is below the narrowest width we test — the matrix's narrowest is
`chromium-mobile-360` and `scripts/interface-audit.mjs` carries `360×800` — so
360 is the width that has to hold.

**Proposed:** drop the round search button and give the tab strip the full
width, keeping «Управление» unshortened everywhere. That is 7.78px of slack and
a 15.78px gap at 360, and it removes a control that duplicates the search field
the list column already has. If the round button is kept, the honest second
choice is an icon-only tab below 430, not a smaller type: 11px is the floor
D-061 set after measuring on a device. A short word on the tab with the full
word elsewhere is the one option to avoid — it costs answer 21's plainness and
does not fix 360 anyway, because «Настройки» overflows there regardless.

**Evidence:** `output/audits/2026-09-12-capsule-and-glass/` — the rebuild is
validated against the option's own photographed geometry at 430 (strip 340×58 at
x=12, round button 58×58 at x=360, as
`output/renders/2026-09-12-navigation-ios/measurements.md` recorded) and refuses
to report if it does not reproduce it. `frames/capsule-360.png` is the picture.

---

## D-152 `[x]` The preview capture page has no folder rail, so from `md` it has no side-menu button

**Severity:** medium. It breaks no shipped surface — the page is DEV-only and behind both
`import.meta.env.DEV` and `VITE_PUBLIC_PREVIEW_FIXTURE=1` — but it is the page the product's own
screenshots and several safe-area contracts are measured on, and it no longer matches the shell it stands in for.

**Reproduction:** run `tests/e2e/ios-standalone-safe-area.spec.ts` on project `webkit-ios-standalone`. The
**landscape** case at `tests/e2e/ios-standalone-safe-area.spec.ts:394` fails at `:398` with
`TimeoutError: locator.click: Timeout 10000ms exceeded` and the call log
`waiting for getByRole('button', { name: 'Меню' })`. The portrait case of the same describe block passes.

**Surface:** `artifacts/kub/src/pages/public/PublicPreviewCapturePage.tsx:244` mounts `<SidebarHeader />` and
`:245` mounts `<FolderTabs`, and the comment at `:229` says the page «stands in for the `Sidebar` root,
which this page does not» render — so there is no `FolderRail` on it at any width.

**Defect:** the shell rework of 2026-09-12 moved the side-menu button out of the list header and onto the folder
rail. In `artifacts/kub/src/components/sidebar/SidebarHeader.tsx:143` that button now sits inside
`<div className="relative shrink-0 md:hidden">` with its label at `:160`, and the rail carries the same
`aria-label="Меню"` at `artifacts/kub/src/components/sidebar/FolderRail.tsx:94`. The Playwright project's
viewport is 393x852 (`playwright.config.ts:105`), so **landscape is 852 wide — above `md`**: the header's copy
is `display: none` and therefore out of the accessibility tree, and the rail that owns the button does not exist
on this page. There is no «Меню» button at all. Portrait passes only because below `md` the header still shows
its own.

**Consequence:** any contract measured on the capture page at a desktop width is measured against a shell the
product no longer has. Today that is one landscape safe-area case; tomorrow it is whatever else is added to that
page's eleven checks. The page's own stated contract — «every surface here is a shipping component» — is the thing
that has been broken, so relaxing the spec would hide the drift rather than close it.

**Fixed on 2026-09-12.** `PublicPreviewCapturePage` now mounts `FolderRail` from `md` exactly as
`Sidebar` does, with one folder set handed to both the rail and the strip so the two cannot disagree about
what folders exist, and `SideMenuLayer` behind the rail's button so it is not a dead control. The column
became a row, as `Sidebar`'s body is.

**What the fix then revealed, which is the part worth keeping.** With the button present, the landscape case
advanced exactly one line and failed on `getByRole("menu")`: that role belongs to the header's dropdown,
which is `md:hidden`, while from `md` the shell opens `SideMenuLayer` — a `role="dialog"` layer. The
assertion had been describing the product as it stood before the shell rework and had matched nothing since. It
was repointed at `data-testid="side-menu-layer"`, knowingly and without weakening: the check still asserts the
thing the button opens is on screen and clear of the hardware.

That let the test reach `expectClearOfHardware` for the first time, where it reported **D-153** immediately. A
guard that fails early hides everything behind it, and this one had been failing early for long enough to hide a
real defect.

**Regression test:** `tests/e2e/ios-standalone-safe-area.spec.ts:394`, landscape, on `webkit-ios-standalone`.
Green afterwards: `1 passed (6.8s)`.

**Closed on 2026-09-12, and the published imagery settles it.** The owner's answer to the question was «подумай
относительно telegram исполнения», and Telegram Desktop's answer is unambiguous: the rail alone, no horizontal
strip beside it. `FolderTabs` on this page is gated in a `md:hidden` wrapper exactly as `Sidebar` gates
its own, so above `md` the rail is the only folder surface and below it the strip is. Verified on the
pixels rather than on the class: `windows-messenger-light.webp` shows the rail at the left edge — avatar,
«Все», «+ Папка» — and no strip anywhere in the column.

---

## D-153 `[x]` The side list's rows sit under the notch when a phone is held sideways

**Severity:** high while it lasted. Every row of the side list on an installed iPhone in landscape, including the
first one — the way into a person's own profile.

**Reproduction:** `tests/e2e/ios-standalone-safe-area.spec.ts:394` on `webkit-ios-standalone`, landscape,
after the assertion at `:399` was repointed at the layer the shell actually opens (see D-152). The checker
reported, in its own words:

```
landscape, side list: under the hardware
  left   control button[data-testid="side-menu-row"] "Мой профиль" inside [data-testid="side-menu-layer"] (59x40 at 0,85)
```

59 points wide at x=0, inside a landscape left inset of 59: the row was entirely under the hardware.

**Surface:** `artifacts/kub/src/components/sidebar/SideMenuLayer.tsx:142` — the layer's root, which read
`fixed inset-y-0 left-0 z-50 flex w-[19rem] …` with `pt-window-top` and `pb-safe` on its body and no
horizontal inset anywhere.

**Defect, and it is the general case rather than a detail of this layer:** `MainLayout` wraps the whole
application in `px-safe` precisely for the notch held sideways, and a `position: fixed` box escapes an
ancestor's padding entirely. So every fixed surface has to take the inset itself. This layer's own comment
reasoned carefully about the top edge — the iPad's status bar, the Windows caption buttons, rule 13 — and never
about the sides.

**Fix:** `px-safe` on the layer's root. Not a left-only utility: `index.css` declares `pt-safe`,
`pb-safe` and `px-safe` and nothing else, and `safe-area-insets.test.mjs` fails on «index.css declares an
inset utility this test does not know about», so inventing `pl-safe` would trip that guard for a real reason.
The right-hand inset costs nothing: it is zero on the edge the notch is not on.

**Regression test:** the same landscape case, which now passes — `1 passed (5.5s)` — and which fails again if
the inset is removed, because the checker measures the rows rather than the class.

---

## D-154 `[x]` A published product image printed a message's time against its last word

**Severity:** high. Not a defect in the product but in what the product was shown as: a marketing image on the
public home, which is the first thing a stranger sees.

**Reproduction:** `artifacts/kub/public/product/android-messenger-dark.webp` as re-captured on 2026-09-12 read
«Принято, добавил15:02» — the timestamp hard against the last letter, with no gap, while its own eight siblings in
the same image were spaced correctly. The three other images of the same run were clean.

**What it was not.** The product was suspected first and cleared by measurement, not by argument: the five
`message-meta-*` specs were run on `chromium-mobile-390` and returned **18 passed**, among them «the
decision is the same one the settled layout keeps» and both spacer-line cases. Those specs drive the same capture
route, but with their own 120-message fixture; the published image uses the nine-message demo fixture. Same route,
different scene — which is exactly why green gates and a broken picture could coexist.

**Cause, in the instrument.** `scripts/capture-public-home-previews.mjs` shot the page after
`document.fonts.ready` and a `document.fonts.check` guard. Neither covers the re-wrap: Inter arrives after
the page reports ready and the conversation is laid out again — the sibling spec measured 28 of 120 placements
moving after `loadingdone`, which is why it waits for the layout to hold still for 2.5s. The capture did not
wait, so one scene in four was photographed mid-settle.

**And a second fault in the same guard, of a kind already met today.** `document.fonts.check` answers true for
a family that never loaded. It reported Inter present in the sibling frame renderer this morning with both font
hosts blocked, while the frames were being measured in Segoe UI. So the capture could have published pixels in the
wrong face and called the run a success.

**Fix — on the instrument, not on the image.** Three changes to the capture script:

1. the face is proved by measuring it, not by asking: the same string is laid out with the page's stack and again
   with Inter struck out of the stack, and the run throws when the widths agree;
2. the shot waits until placements and paragraph boxes have been unchanged for 2.5 seconds, and throws if the
   conversation never settles;
3. before the shutter, every inline time is measured against the last line of its own text, and the run **refuses
   to write the image** if any gap is under 4px — the reserved room is the footer plus 8px, so 4 passes a close
   call and nothing passes a collision. It also refuses a scene where no inline time could be measured at all, so
   the check cannot pass by finding nothing.

**Proof:** the re-capture reported «8 inline times, all clear of their text» for each of the four scenes and wrote
all four; the dark Android image was then read as pixels and the gap is there. The guard itself was mutation-
tested both ways — see the QA entry of the same date.

**The general rule this leaves:** a published artefact needs its guard in the tool that publishes it. A test can
only prove the product is capable of being right; it cannot prove that the particular frame someone shipped was.

---

## D-155 `[x]` The last search result sits under the floating capsule and cannot be pulled out

**Severity:** medium, and mine. The capsule was introduced on 2026-09-12 and the room for it was reserved in
`ChatList` — but the sidebar has a **second** scroller, `SidebarSearchResults`, which never got the same
end padding. On a phone the last row of search results therefore lay under the capsule with no way to scroll it
clear.

**Reproduction:** type a query on a phone, scroll the results to the end. Found by looking at a rendered frame,
not by reading the source; the source reads fine.

**Fix:** the same reservation `ChatList` uses, inside the scroller —
`pb-[calc(var(--kub-bottom-nav)+var(--kub-bottom-nav-gap)*2)] md:pb-3` — because shrinking the container
instead leaves a band of ground in the shape of the old bar, which is the mistake already made once this day.

**A trap worth recording.** The scroller already carried `py-3`. Two single-class utilities have equal
specificity, so which wins is decided by the order the rules land in the generated stylesheet, not by the order
they appear in the class string — a fix that reviews perfectly and does nothing. Measured in the built sheet
rather than assumed: `.py-3` at byte 103492, the arbitrary `padding-bottom` at 106679, the `md` override
at 184827. Later wins, so all three land as intended.

**Regression evidence:** rendered and measured at 390 in both themes — reserve 72px, last row ending at y=772,
capsule top at y=780, **8px of clear ground between them**, with the row and its chevron wholly above the glass.

---

## D-156 `[x]` The type-filter row is clipped at both ends with nothing to say so, and «Все» becomes unreachable

**Severity:** medium. Two faults of one cause, both seen in rendered frames.

1. Nine pills do not fit the sidebar column — 360px on a computer, 390 on a phone. The row is
`overflow-x-auto no-scrollbar`: no bar, no fade, no arrow. At 1440 the reader sees «Все, Люди, Боты, Чаты,
   Со…» and the remaining four types do not exist as far as the interface is concerned. With a mouse and no
   horizontal wheel there is nothing to grab.
2. Choosing a pill scrolls the row to it, so after picking «Сообщения» the row reads «…юди, Боты, Чаты,
   [Сообщения], Задачи, Л…» — and **«Все» is off-screen left**, which is to say the way back to the unfiltered
   list disappears at exactly the moment it is first wanted.

**Not a matter of inventing a solution:** `FolderTabs` already solves this in this product — a scroll ref,
`canScrollLeft`/`canScrollRight` kept by a scroll listener and a `ResizeObserver`, a step of
`max(120, clientWidth * 0.6)`, vertical wheel mapped to horizontal, and chevron buttons rendered only on the
side that has somewhere to go. The right move is to lift that into a shared hook both rows use rather than to
write a second copy of it.

**Fixed on 2026-09-12.** The mechanism was lifted out of `FolderTabs` into
`artifacts/kub/src/hooks/useEdgeScroll.ts` — the scroll listener, the `ResizeObserver`, the
`max(120, clientWidth * 0.6)` step, the vertical-to-horizontal wheel mapping, the edge thresholds and the
arrow's two class strings — and both rows consume it. Neither keeps a copy, and that is enforced rather than
trusted: the guard fingerprints the mechanism (listener, observer, room-left arithmetic, step floor, programmatic
scroll) and requires all five in the hook and none in either consumer.

`FolderTabs` is shipped, so «unchanged» had to be shown, not asserted: `desktop-shell.spec.ts` before and
after the lift is **16 passed / 1 skipped** on `chromium-desktop-1440` and **3 passed / 14 skipped** on
`chromium-mobile-390` — identical in count and in identity, so no skip stands in for a pass.

**The arrows are a wide-screen affordance, and that is the second half of the fix.** With them on at 390 the
chevron was drawn over the pill text — «Соо⟩» at rest, «⟨юди» once «Сообщения» was chosen, in both themes.
The arrow box is about 26px, so the `from-60%` fade never reaches transparency, and `--glass-fill` is
translucent: over a **filled** pill it conceals nothing. A phone drags the row instead, which is what Telegram
offers there, so they are hidden below `md` — in the consumer, not in the hook, because `FolderTabs` shipped
with its arrows at every width and curing this row by changing that one would be a second fault.

**The second half of the defect — «Все» out of reach — answered by measurement rather than by pinning it.** On a
computer the row rests at `scrollLeft 0` with «Все» fully on screen and only the right arrow lit; choosing
«Сообщения» leaves it at **103** against a step of **202**, and one press of the left arrow returns it to **0**
with «Все» fully on screen, in both themes. So «Все» was not pinned outside the scroller: Telegram lets its own
folder row scroll away too, and a single gesture is a way back.

**My own diagnosis was wrong on one cause and is corrected here:** nothing in the code scrolls the row. Clicking a
partially visible button makes the **browser** scroll it into view, which is why the cure is an affordance and not
the removal of a scroll call — suppressing it would mean fighting focus and costing keyboard users the thing that
keeps the focused pill visible.

**Regression test:** `tests/unit/edge-scroll-affordance.test.mjs`, 21 cases, every source-scan checker among
them proved by a mutation inside the file. Two of the 21 are the width gate: the filter row must carry it on both
arrows and the folder strip must carry it on neither, with a mutation that strips one gate and requires the
checker to notice.

---

## D-157 `[ ]` Three things the arrows left behind: a collision in the shipped strip, no focus indicator, no e2e

Found while closing D-156, each deliberately not acted on, and each for a reason.

**1. The same chevron-over-text collision exists in `FolderTabs`.** It is the same markup — the arrow box is
about 26px, the `from-60%` fade has no room, `--glass-fill` is translucent — and it simply reads softer
over flat tabs than over filled pills. Not fixed here because changing a shipped component to cure another
component's fault is a second fault. The cure is the same either way: give the fade room, or give the arrow an
opaque backing, and prove it on both rows' pixels.

**2. Neither row's arrows have a visible focus indicator.** They carry none of `kub-button`,
`kub-icon-action` or `kub-interactive`, so `control-vocabulary`'s «everything pressable declares a
focus indicator» sweep never reaches them: they are focusable buttons that show nothing when focused. Pre-existing
in `FolderTabs` and preserved rather than quietly changed. Note that the guard's silence here is itself the
finding — a sweep that selects by class cannot see a control that wears none.

**3. No end-to-end spec references the type-filter row at all.** Its only automated coverage is the unit file
above, which reads source rather than a rendered page. The row ships with its behaviour proved by rendered frames
and measurements taken by hand; that is evidence, but it is not a guard that runs again tomorrow.

---

## D-158 `[ ]` Five things the casual hints left behind, each deliberately not acted on

Found while adding the search-syntax and recorder-mode hints. None is a defect in what shipped; each is a place
where the next hint, or the next reader, will pay for something not done.

**1. The hint store does not enforce «one at a time»; the interface does.** `getSnapshot()` returns every
eligible offer, and nothing stops two plates being visible together. Today they cannot be: the recorder hint is
gated to a coarse pointer **and** below `md`, where `MainLayout` shows a single pane, and the search hint
withdraws when its column is hidden. That is structural, not enforced. Centralising it in `hints.ts` was
considered and refused for a stated reason: a single-visible rule breaks the existing test «a rebuild that changes
nothing keeps the snapshot and wakes nobody», and would need `spend` fixed in the same breath, or a
suppressed hint burns its two hours unseen.

**2. `useHint` charges the budget while the store says «visible», and the store is never told whether the
anchor is still mounted.** When the composer swaps the microphone for the send button the plate vanishes and the
budget would keep draining. Worked around by passing `buttonOnScreen` and `paneOnScreen` into each
caller's predicate — which means every future hint must remember to do the same. The fix belongs in the hook; it
is not made here because the hook also feeds the shipped administration hint.

**3. The mouse's way into the recorder's second mode stays undiscoverable.** The hint names the finger's gesture,
because it is offered only where that gesture works. The right-click switch has no announcement anywhere, and
giving it one needs a second anchor on a screen where the search hint can also be — which is the very thing
finding 1 says nothing prevents.

**4. The same syntax is live in `ChatSearchBar` with no pill row at all**, so there it is the only way to
narrow — and there is deliberately no plate there. The same sentence twice is noise, and on a computer that bar
and the sidebar can be on screen together.

**5. The recorder button's markup is written twice.** `MessageInput.tsx` holds an extracted
`recorderButton` const for the held-recording branch and an inline copy for the resting branch, the latter
wrapped in the hint. They are mutually exclusive, so no screen ever shows both and no test id is ambiguous — but
they have **already drifted**: one takes its accessible name from `recordingButtonLabel(recorderMode)`, the
other from an inline ternary. Identical output today. That is how two copies begin.

---

## D-159 `[x]` In-chat search was a phone overlay dropped on the conversation at desktop widths

**Found by the web audit of 2026-09-12**, which the owner asked for in his own words: the web client «выглядит как
помесь телефона и десктопа».

**Measured before:** the panel was 969x214 at 1440 and 1449x214 at 1920 — it grew sideways, never downward. Its
results well was `max-h-36` (144px) holding about 320px of content, and it rendered `results.slice(0, 6)`,
so one match was never drawn at all and five more sat behind a scroll inside a 144px window. Two rows were whole;
the third was sliced through its own text. The card covered **23.0%** of the conversation at 1440 and 19.4% at
1920, while the list column beside it — 360x900 — showed fourteen chats irrelevant to the search.

**Fixed for `md` and up on 2026-09-13.** In-chat search is now a state of the list column, following
`SidebarSearchResults` as the precedent rather than inventing a second pattern. The engine moved to
`lib/chatMessageSearch.ts` — verbatim, filter for filter — and `hooks/useChatMessageSearch.ts` holds the
stateful half, so the counter, the match order and the loaded-message fallback cannot drift between the two
forms. Only one form is ever **mounted**, by a JS breakpoint rather than a CSS `hidden`: two mounted copies
would each run the query and each jump the conversation.

**Measured after:** panel 360x843 at 1440 and 360x1023 at 1920, the well 680px showing 680px, every match drawn
whole, no row sliced, and **0%** of the conversation covered.

**Left open, and it is the phone half:** below `md` there is no column to move into, so the overlay survives
there byte for byte — `max-h-36` and `slice(0, 6)` are still in `ChatSearchBar.tsx`. Measured on the
phone after the change: 6 of 7 rendered, **2 whole**, one sliced. Its own defect, not a regression of this one.

**A caution about the evidence, because the tables in the agent's report do not compare like with like.** Its
«before» frames were shot with `смет` in the field and its «after» frames with `смета`, so the counters
read 1/13 and 1/7 for arithmetic reasons and not because anything was lost: of the fourteen seeded lines, thirteen
contain the stem and seven contain the exact query. Both numbers are correct for their own query. The geometry —
144px well showing 320px against 680 showing 680, and 23.0% coverage against 0% — is the comparison that holds.

---

## D-160 `[x]` Settings is a fixed 896px dialog that blurs the whole application

`SettingsModal.tsx` opens at `KubModal`'s `xl` size — `sm:max-w-4xl`, 896px — on every screen,
with `backdrop-blur-sm` over everything behind it. That is **62.2%** of a 1440 screen and **46.7%** of a
1920 one, leaving 272px and then 512px of dead margin each side, while about 332px of content stays below the
fold at 1440. Rows are 822px wide and 44px tall, so a value is stranded up to 550px from its label («Оформление»
against «Без оформления»). There is no search over the settings at all.

A desktop client puts this in a column with its own search. `lib/settingsRows.ts` is already an ordered data
structure, so the column has something to render and something to search.

**Not a sheet, and the audit corrected me on that:** `mobileSheet` only applies below 640px. At 1440 this is
a genuine centred desktop dialog. The phone pattern here is the **row list stretched to 822px**, not the container.

**Fixed on 2026-09-13.** Settings is the list column's body from `md`, following the two precedents in the
repository rather than a third shape: `SidebarSearchResults` and the `ChatSearchPanel` shipped hours
earlier. `SettingsScreen.tsx` holds the rows and handlers for **both** forms, `SettingsPanel.tsx` is the
column, and `SettingsModal.tsx` is reduced to the below-`md` wrapper. `settingsRows.ts` grew the row
catalogue, the section titles and a pure matcher, and imports nothing, so the unit runner reaches every branch.

**Measured, same fixture and same entry path on both sides, nothing typed in either:**

| | 1440 before → after | 1920 before → after | 390 |
| --- | --- | --- | --- |
| surface width | 896 → **360** | 896 → **360** | 390, unchanged |
| share of the viewport | 62.2% → **25.0%** | 46.7% → **18.8%** | 100% |
| dead margin each side | 272 → **72** | 512 → **72** | 0 |
| worst label-to-value gap | 570 → **76** | 570 → **76** | 122 |
| below the fold | 248 → **204** | 95 → **24** | 285 |
| application blurred | yes → **no** | yes → **no** | yes |

The phone frames are **md5-identical** before and after in both themes, checked rather than claimed.

**Three of the audit's numbers were wrong and are corrected here:** the worst label-to-value gap is 570px and it
is «Статус «в сети»» → «Виден», not 550px on «Оформление»; below-the-fold at 1440 is 248px on a non-staff account
rather than 332, which is probably a staff account's fifth section. Everything else reproduced exactly.

**Two existing contracts were changed rather than bent, and both are named here.** `desktop-shell.spec.ts`
asserted that settings opens a `role="dialog"` at desktop width; it now asserts the column **and** that no
dialog exists, which is stricter. `settings-profile-layout.spec.ts` required an input at least **403px**
wide inside that dialog — a premise a 360px column cannot satisfy and should not. It was replaced by a floor of
**150px** on the field plus the username sitting under the name at the same left edge, and the phone row reachable
through the search rather than by being 896px wide. A softer number, but still a number; the phone half of that
file is untouched.

**Seven unit guards were repointed at `SettingsScreen.tsx` and none was weakened** — test counts identical
either side (12, 14, 17, 4, 7). `shell-glass` kept `SettingsModal.tsx` in its table at **zero** rather
than dropping it, so the file's other checks keep running.

**Left for its own entry:** the identity banner's `kub-grid-subtle` texture tiles visibly at 360px, clearest
in the light theme. Untouched because that class is pinned by `edge-vocabulary` and the banner is shared
with the phone sheet, where the frames are byte-identical by design.

---

## D-161 `[x]` The contact card is a draggable window sitting on the messages

`ChatInfoPanel.tsx` renders `position: fixed` at `PROFILE_WINDOW_DEFAULT_SIZE` — 380x620 — with a
`cursor: grab` header, because `floatingWindow.ts` only docks below its `DOCK_BREAKPOINT` of 640.
It covers **26.2%** of the conversation at 1440 (four bubbles) and 14.7% at 1920, overlaps the composer, and
scrolls inside itself (639px of content in 562px) while carrying its own tabs.

There is 1007px of chat pane at 1440 and 1487px at 1920; a docked 380px column would leave 621px and 1101px of
conversation, both far above the product's own 260px column minimum. One component that re-dresses itself — docked
third column at these widths, the existing floating and sheet forms below — is the shape to aim for.

**The audit corrected me here too:** at 1440 this is one card with internal tabs, not «several stacked sheets».
The stacking is real but elsewhere — confirmations and `GroupInviteModal` open as separate modals over it —
and the same person-profile content lives in three unrelated components (`ChatInfoPanel`,
`SearchShared.tsx`'s «Мини-профиль», `UsersTab.tsx`).

**Fixed 2026-09-13.** The card wears one of three shapes and a rule picks it: the phone's sheet below the dock
breakpoint, a third column when the pane can hold one, the floating window otherwise. `paneFitsProfileColumn`
asks whether `paneWidth - 380` still clears `CHAT_LIST_MIN_WIDTH` — the product's own column floor, which
is Telegram's `columnMinimalWidthLeft`, so the threshold moves with that decision instead of restating it.

**Measured against the pane, never the viewport, and that correction came from an agent.** The chat list is
dragged by hand: at 1440 the pane is 1007px with the list at its default and 787px at its maximum, and no
viewport width can tell those apart. At 768 the pane is 335px, which is why the sheet stays the sheet there.

The **pane** is observed rather than the card — the pane's width is the same number whether the card floats over
it or takes a column out of it, so the observer cannot feed itself — and the answer is read in
`useLayoutEffect`, so the card never lays out as a window for one frame and becomes a column in the next. An
unmeasured pane is not a wide one: it falls back to the window. A column takes no drag, because a drag would
write a placement that only appears later on a narrower pane, and the card would seem to have moved on its own.

`data-surface` carries the shape; `data-docked` goes on meaning the phone's sheet alone, which is what every
existing reader already assumed it meant.

**Proof:** `tests/e2e/profile-column.spec.ts` — 4 passed, 4 skipped, each project skipping the shape that
belongs to the other; `tests/unit/profile-window.test.mts`; and the signed-in production run of
`visual-style-layout.spec.ts`, whose profile contract now branches on the shape the card actually took rather
than assuming the window: 11 passed, 9 skipped, 0 failed.

---

## D-162 `[x]` A casual hint swallowed every tap that landed on it, in production, for staff on phones

**Severity: high, and it was live.** Shipped in `8629549` and on `origin/main` from that deploy
until 2026-09-13. While the administration hint was showing, a member of staff on a phone **could not open a
chat**: every tap that landed on the plate's rectangle was taken by it and never reached the row beneath.

**Found by running something, not by reading.** A signed-in run of `visual-style-layout.spec.ts` at 390
against production failed two contracts that are on the critical list — «fast upward scroll after opening a read
chat is not pulled back to bottom» and «loading older messages preserves the visible history anchor». Neither
failed on its own assertion. Both timed out on `locator.click` in their shared setup, and Playwright named
the culprit in its own words:

```
<span …>Управление сообществом живёт здесь: пользователи,…</span>
  from <div data-radix-popper-content-wrapper=""> subtree intercepts pointer events
```

Twenty-odd retries, then the timeout. The owner had asked for hints that do not do this, in these words: «не
такое которое перехватывает всё управление».

**Cause, and which half actually carries the fix.** `KubHint` renders through a Radix popover, and a
popover is a dismissable layer that holds the pointer. It also refuses to close on an outside interaction — which
is deliberate and stays, since a hint is governed by its budget rather than dismissed by a stray tap. Two elements
were changed, and only one of them turns out to be load-bearing:

1. the content itself — `pointer-events-none` on `PopoverContent`, with `pointer-events-auto` put back
   on the close button so «Понятно» still answers. **Defence in depth, not the contract** — see the mutation
   below;
2. **Radix's positioning wrapper**, which the component cannot style. A scoped rule in `index.css` —
   `[data-radix-popper-content-wrapper]:has(> [data-testid="kub-hint"])` — narrow by the hint's own test id,
   because seven other surfaces here use the same popper and every one of them must keep receiving the pointer.

The order matters as evidence: after fix 1 alone the same run still failed, and Playwright's message **changed
from naming the plate's `<span>` to naming the wrapper**. That proved the class alone is not enough.

**What the class alone is worth was settled by mutation on 2026-09-13, and it is less than this entry first
claimed.** Against `tests/e2e/hint-pointer.spec.ts`: neutering the stylesheet rule (`none` to `auto`) turns
the guard **red**, four times naming «intercepts pointer events», with the precondition still holding — so the
red is the interception and not a plate that moved. Stripping `pointer-events-none` from the component leaves
the guard **green**, and the browser says why: `pointer-events` is an inherited property, so with the wrapper
at `none` the plate computes `none` regardless, and the close button takes the pointer back for itself.
**The rule in `index.css` is necessary and sufficient; the class on `PopoverContent` is kept deliberately
but carries nothing.** The sentence «two elements had to give the pointer up» was wrong, and only pressing on it
found that out.

A fourth measurement nearly hid the correction: counting `pointer-events-none` in the module the dev server
served returned **1 with the class removed**, because the file's own comment names it. The DOM's `className` was
the only honest witness. Prose read as code, for the third time inside this one defect.

**Proof:** the same signed-in run afterwards — **11 passed, 0 failed**, and **zero** occurrences of «intercepts
pointer events» against six before. Typecheck clean, production build clean (the CSS parses), unit suite
1916 to 1921 — the two added here pin the stylesheet rule.

**What is proved and what is merely unblocked, stated apart.** «Fast upward scroll» now passes on both projects.
«History anchor» passes on the computer and **skips** on the phone: with the tap landing, the helper walks up to
twenty-four read chats looking for one with a second page of history, finds none on this account, and skips
honestly. That contract is unblocked but not covered on the phone, for want of data rather than for want of code.

**Three measurements of mine said this was fine, and each failed differently.** They belong here because the
defect outlived them:

- a patch script verified its own change by counting occurrences of the class name, counted **its own explanatory
  comment** as one, and reported failure over a file it had just written correctly;
- the generated guard did not compile — doubled quotes from a string-building slip — so the whole file reported
  «1 test, 1 failed» and looked like a failing assertion rather than a parse error;
- and the guard itself, once compiling, was **green while the defect was alive**: it asserted the class was
  present in the source, which it was. A source-text check cannot see a tap that does not arrive.

**Regression tests, and which of them would have caught this.**

- `tests/e2e/hint-pointer.spec.ts` — the one that presses. At 390 it seeds a staff account (the store reads
  `profiles.role`, so `role: "manager"` is the whole of what the administration hint needs), waits for the
  plate, **proves the point it is about to press lies under the plate**, presses the chat row, and requires the
  chat to open. Both halves of the fix are mutation-tested against it; the result is recorded above.
- `tests/unit/interface-hints.test.mts` — the source scan. It now pins the stylesheet rule that carries the
  contract as well as the class that does not, and refuses to be satisfied by a mention in a comment.

Two earlier shapes of the e2e guard were wrong, and both are worth keeping on the record because each would have
gone green while the defect stood. The first reproduced the **search** hint, on the belief that the fixture could
not make an account staff; its plate covers six pixels of a row's top edge against the administration plate's 52
of 68. The second asked only whether the two rectangles **overlapped** — but Playwright presses an element's
centre, and a six-pixel overlap leaves that centre in the clear. A guard has to cover **the point that gets
pressed**, not merely touch the element.

---


**How this batch was measured.** The surface was rendered on the message-actions fixture at 1440 and 390, in
both themes, with four members holding three different roles: `output/group-info/` carries the frames. Three
read-only inventories were taken of the panel, of members/roles/permissions, and of the photo send path. The
reference for what a person expects here is the owner's own pack of a competing client's group screens, sent
2026-09-13; it is treated as a design decision about mechanics, and none of its content is reproduced anywhere.

**Two of my own readings in this pass were wrong, both because the fixture lied, and both are written down so
that nothing gets 'fixed' that is not broken:**

- I reported that shared media does not exist on this surface. It does — counted rows over eight kinds that
  push into a grid (`ChatInfoPanel.tsx:1473-1498`). The fixture simply carries no media.
- I reported the invite-policy card as permanently «Недоступно». In production it is live: `chats.invite_policy`
  exists (`types/database.generated.ts:239`, generated against the live project). The badge appears because
  `messageActionsFixture.ts:52` seeds `"admins_only"`, which is neither accepted value, so
  `readChatInvitePolicy` (`ChatInfoPanel.tsx:2031-2035`) returns null. **The badge in those frames is the
  harness, not the product.**

## D-163 `[x]` On a phone nobody can be promoted, demoted or removed: the controls are hover-only

**Severity: high.** Every per-member action in a group is reachable on a computer and reachable on no phone at
all — and the phone is where this product is used.

**Surface:** `artifacts/kub/src/components/chat/ChatInfoPanel.tsx:1618` — the container holding the three
member buttons carries `opacity-0 group-hover:opacity-100`. The buttons themselves are
«Сделать администратором» (`:1619-1628`), «Снять администратора» (`:1629-1638`) and «Удалить из
чата» (`:1639-1657`).

**Measured, and measured twice because the first measurement was wrong.** Reading the *button* reports
`opacity: 1` while its parent stands at 0 — which is how this was first reported as working. Measured on the
element that actually fades, walking up from the button:

- 1440, at rest: `depth 1: opacity=0` — no icons drawn.
- 1440, pointer on the member row: `depth 1: opacity=1` — two 26x26 icons appear at the right of the row.
- 390 with touch, at rest **and after a tap on the row**: `depth 1: opacity=0` both times.

**Frames:** `output/group-info/1440-members-row-hovered.png` (icons present) and
`output/group-info/390-members-tapped.png` (row highlighted by the tap, no icons).

The controls stay focusable, so a keyboard reaches them; a finger does not. There is no long-press, no context
menu and no overflow anywhere on a member row.

**Proposed:** the actions belong to the member, not to the pointer. A press on the row opens them — which is
also what the reference pack does, and it carries five items rather than three.

**Two constraints the fix has to obey, both measured rather than reasoned, and both invisible until measured.**

*1. The overlay must be portalled out of the panel, in every shape.* The product's existing row-action pair —
`ChatDesktopContextMenu` and `ChatMobileActionSheet` in `components/sidebar/ChatList.tsx:583, :635` —
is `position: fixed`, and the information panel carries `kub-glass-strong`, whose `backdrop-filter`
(`index.css:984-988`) makes it the containing block for every fixed descendant. Measured by inserting a
`fixed; inset: 0` element into the member list and comparing its rect with the same element on `document.body`:

| shape | fixed inside the panel | fixed on the body | trapped |
| --- | --- | --- | --- |
| column, 1440 | 379x900 | 1440x900 | **yes** |
| floating, 1000 | 378x618 | 1000x800 | **yes** |
| docked, 390 | 390x844 | 390x844 | no |

**The phone's «no» is the dangerous reading.** The culprit is present in all three — `backdrop-filter` at
depth 0 — and on a phone the panel simply *is* the viewport, so the trap has nothing to show. A fix validated
only on a phone would ship an action sheet confined to a 380px card on every computer. So the portal is
unconditional, and the layer is a parameter: the panel is `z-[60]` (`lib/profileWindow.ts:74, :87`) while
the existing menu and sheet are `z-50`, so reused unchanged they would also render *underneath* it.

*2. The lifted gesture must hold no state.* `tests/e2e/chat-list-event-cost.spec.ts` pins the chat row at one
render for an event and two where a delivery mark follows (`:101`, `:132`, `:154`, `:172`), and
`tests/e2e/helpers/render-counter.ts:13` counts renders, with a mount counted as one. The gesture in
`ChatListItem.tsx:109-167` is deliberately built on refs alone; lifting it into a hook that sets state would
break a contract on the critical list rather than a cosmetic one.

*What is being reused, and what is deliberately not.* `ChatAction` (`ChatList.tsx:37`) is already generic;
`ChatActionButton` reads nothing but the action. Only `ChatActionHeader` is chat-specific, so the shared
components take a header slot. The gesture carries three guards that would be lost in a re-derivation and are
therefore lifted whole: it refuses a context menu within a second of a touch, refuses one on a coarse pointer,
and suppresses the click that follows a long press (`ChatListItem.tsx:128-167`). Radix's
`components/ui/context-menu.tsx` is **not** adopted: it has no users today, and the product's own menu carries
safe-area clamping (`ChatList.tsx:122-142`) that swapping primitives would have to reproduce — a rewrite of a
shipped surface rather than a fix for this entry.

*Left alone on purpose:* `MessageList.tsx:1529-1584` carries a third long-press implementation. Folding it in
would put this batch inside the conversation's own gesture handling, where the critical scroll contracts live.
It is recorded here so that it is a known third copy rather than a forgotten one.

**Fixed 2026-09-13.** The actions belong to the member now, not to the pointer. Every row that has any action
draws a «ещё» control at rest — and only such a row: there is nothing to do to yourself, so your own row carries
none. A finger gets the sheet the chat list has always used; a pointer gets the menu; a long press and a right
click open the same thing from the row itself. A plain tap still does nothing, deliberately, because that gesture
belongs to opening the person (D-168).

**What moved, and why none of it is new machinery.**

- `hooks/useRowPressActions.ts` — the gesture, lifted whole out of `ChatListItem.tsx` with its three
  guards intact: a context menu refused within a second of a touch, refused on a coarse pointer, and the click
  after a long press swallowed. It holds no state, only refs, because `chat-list-event-cost.spec.ts` pins the
  chat row at one render per event. It also returns `suppressNextClick`, which the pinned-row drag needs: that
  drag sets the same flag (`ChatListItem.tsx:190`), and a hook owning the ref privately would have broken it
  silently.
- `components/kub/RowActions.tsx` — the menu and the sheet, lifted out of `ChatList.tsx` with the header
  turned into a slot and the layer into a parameter, and **portalled unconditionally**.
- `lib/chatMemberRules.ts` — the permission matrix, which had lived inside `members.map()` with a comment
  naming the SQL trigger and **no test at all**. This change needed the same answers a second time, and two
  copies of a mirror drift until the interface offers what the server refuses (D-142). Now covered by
  `tests/unit/chat-member-rules.test.mts`, eleven tests written from
  `enforce_chat_member_update` rather than from the old client code — which is how it came out that an owner
  may hand the chat over and the interface cannot express it (the addendum to D-150).

**Proof, by mutation, each half separately and each red for its own named reason:**

| mutation | result | what the failure said |
| --- | --- | --- |
| put `opacity-0 group-hover` back on the control | 1 of 3 red | «not drawn» — the opacity assertion |
| disable the touch branch of the gesture | 1 of 3 red | the menu never appears |
| render the menu inside the panel instead of portalling | 1 of 3 red | «render inside the information panel» |

All three restored byte-identical, verified by hash. **A fourth mutation was thrown away rather than counted:**
replacing `return createPortal(` with `return (` left the trailing `document.body,` as a comma
expression, so the component returned a DOM node and every test died on a timeout. It broke the file, not the
contract, and a red with the wrong cause proves nothing.

**Regression test:** `tests/e2e/member-actions-reachable.spec.ts`. It measures **computed opacity up the
ancestor chain** rather than asking `toBeVisible()`, because Playwright's visibility check does not read
`opacity` — a test written the obvious way would have gone green against the broken build, which is exactly how
this defect survived. The portal contract is asked of the DOM (`panel.contains(menu)`) rather than of a
rectangle, because on a phone the panel is the whole screen and a rectangle proves nothing there.

**One thing the tests could not catch, and the pixels did.** The first version of the «ещё» button called the
menu whatever was pressing it, so a phone got a 272px menu anchored at the fingertip while a long press on the
same row got the sheet — two idioms for one action on one screen. Every test stayed green, because both carry
the same test id and the contract is reachability, not shape. It was caught by looking at the frame before
sending it.

**Still duplicated, deliberately, and recorded so it is not forgotten:** `ChatList.tsx` keeps its own copy of
the menu and the sheet. Converting it is a separate batch with its own gates — it carries the render-count
contract and the pinned-row drag — and mixing a proven fix with an unproven refactor in one commit is a bad
trade for whoever reads it.

---

## D-164 `[ ]` A group has no settings screen: the pencil swaps two fields and there is no way to cancel

**Severity: medium**, rising with every group setting the product gains, because there is nowhere to put one.

**Surface:** `ChatInfoPanel.tsx:1182-1200` (the pencil), `:1238-1253` (what it opens),
`:698-716` (save).

**Defect:** the pencil does not open a screen, a sheet or a dialog. It sets `editing = true`, which replaces the
summary's title and subtitle with a single-line name input and a two-row «Описание…» textarea. That is the whole
of it. The check button saves; **there is no cancel control**, so the only way out of edit mode is to commit.
Every other group setting lives outside it, on the «Сведения» tab, visible to people who cannot change it.

**Frame:** `output/group-info/1440-edit.png`.

The reference pack's equivalent screen carries fifteen rows — name, photo, description, group type, chat
history, appearance, topics, reactions, greeting, permissions, invite links, administrators, members,
statistics, recent actions — each with its **current value on the right**, and one destructive row at the foot.
Ours has one such row in the entire panel (see D-165).

**Proposed:** a group settings view inside the same card, entered by the pencil and left by a back arrow, the
way the media sub-view already works here (`:1084-1092`). Not a second window.

---

## D-165 `[ ]` The invite card states a policy it never read, and silently takes the invite button away

**Severity: medium.** It tells people something untrue about who may invite.

**Surface:** `ChatInfoPanel.tsx:1358-1414`, `:2031-2035`, `:374-376`, `:388`.

**Defect, three parts:**

1. When the chat object carries an unrecognised `invite_policy`, the card still prints «Только
   администраторы» — the fallback `DEFAULT_INVITE_POLICY` (`:123, :375`) — beside a «Недоступно» badge.
   It asserts a policy it has not read.
2. `canSendInvites` (`:388`) requires `invitePolicySupported` before honouring
   `members_can_invite`, so an unrecognised value **silently strips ordinary members of the invite button**
   with nothing said.
3. The value line reads «Только администраторы» while the button for that same state reads «Администраторы»
   (`:1364` against `:1386`).

**Not a defect, and recorded so it is not 'fixed':** the «Недоступно» badge visible in this batch's frames is the
fixture's doing — `messageActionsFixture.ts:52` seeds `"admins_only"`. In production the column
exists and the control works.

**Proposed:** say «неизвестно» rather than a default when nothing was read, and never let an unread value
change what a member may do.

---

## D-166 `[ ]` Every membership change is already recorded per chat, and no chat can show it

**Severity: medium**, and unusually cheap to fix.

**What exists:** `.migration-backup/supabase/migrations/20260505_audit_logs.sql` — table
`audit_logs(actor_id, action, target_kind, target_id, diff, created_at)` (`:18-26`) with triggers
`trg_audit_chat_members_insert/update/delete` (`:273-286`) writing `chat_member_added`,
`chat_member_role_changed` (with `from`/`to`, `:240-250`) and `chat_member_removed`,
all with `target_kind='chat'` and `target_id = chat_id`. The Russian labels already exist in
`pages/admin/AuditTab.tsx:26-28`.

**Defect:** nothing reads it per chat. `hooks/useAuditLogs.ts:63` filters by actor, action and date — never
by `target_id` — and the only surface is the global administration panel. A group's owner cannot see who
removed whom from their own group.

**What it would take:** a read by `target_id`, and an RLS policy. Today the policy is «admins read
audit_logs» using `is_admin(auth.uid())` (`:44-47`), so a chat owner who is not a global
administrator cannot read their own group's history. That policy change is a database change and needs the
owner's approval and a backup, per section 10 of the handoff.

---

## D-167 `[ ]` Muting a chat is all-or-nothing and kept in the browser, while the table for it exists

**Severity: medium.**

**Surface:** `ChatInfoPanel.tsx:1340-1348` — one row, «Отключить уведомления» / «Включить уведомления»,
writing a chat id into `localStorage['ng_muted']` plus a push preference (`store/app.store.ts:361-373`).

**Defect:** there are no durations, no snooze and no per-chat sound settings, and the state lives in one browser
rather than with the account — so a chat muted on a phone is unmuted on a computer.

**What exists already:** `chat_notification_preferences(user_id, chat_id, push_enabled, muted_until)` is live
(`types/database.generated.ts:190-214`). `muted_until` is exactly the column a «выключить на время»
needs, and nothing in the chat panel writes it.

**Reference:** the pack shows this as a menu on the sound tile with four items — off, off for a while, configure,
and notifications off — rather than one binary row.

---

## D-168 `[ ]` A member row shows a role and nothing else, and cannot be opened

**Severity: medium.**

**Surface:** `ChatInfoPanel.tsx:1604-1616`, role word from `roleLabel` (`:970-971`).

**Defect:** the row is a `<div>` — not pressable, with no way to reach the person. It draws an avatar, a
crown or shield glyph, the name, and for owners and administrators a second line reading «Владелец» or
«Администратор» in accent-coloured plain text. **An ordinary member's row carries nothing at all** — no
username, no last seen, no join date. There is no presence dot: `showOnline` exists on the avatar
(`components/ui/ChatAvatar.tsx:249-263`) and is not passed (`:1605`). The list has no order
(`:395-403` has no `.order()`), no search and no sections.

**On the customisable tag the reference pack shows, and what it would cost.** That tag is per person **in one
chat**, with its own text and colour, and the holder can change their own. `chat_members` has exactly eleven
columns (`types/database.generated.ts:133-172`) — no free text, no colour — so it needs a migration. The
colour primitive is already here and unused: `roles.colour` is validated
`^#[0-9a-fA-F]{6}$` (`20260904080000_roles_priority_and_colour.sql:42-49`, live at
`database.generated.ts:1082`) and is never read as data anywhere in the client. But it belongs to a global
role definition — one colour shared by everyone holding that role — so it cannot express one person's tag in one
group. **Do not reach for it as if it could:** that would be the relabelling of an existing function the owner has
ruled out.

Also seeded and unassignable: chat-scope roles `chat_owner` / `chat_admin` / `chat_member` and the
permissions `chats.invite`, `chats.manage_invites`, `chats.moderate`, `chats.manage_roles`
(`20260514_dynamic_roles_permissions.sql:104-106, 136-140, 212-219`) — with no table assigning a chat-scope
role to a (chat, person) pair.

**The owner, 2026-09-13, on tags and roles.** Asked whether to build the per-member tag, he answered with a
shape rather than a yes. Three parts, and a direction. Each is set here against what the product actually has,
which was searched for rather than assumed — and the search moved one of them from «to build» to «to surface».

1. **Tags inside a group, as Discord has roles** — «в своей группе у пользователя свои теги». Per chat, per
   person, set by that chat. **Nothing for this exists.** `chat_members` has eleven columns and no place for
   a name or a colour, and the chat-scope roles seeded in 2026-05-14 have no table assigning them to a person.
   This is the migration this entry already describes.

2. **Global roles as badges carrying a reason** — «по типу лычек … в которых написано кто такой, за что получил
   медальку (достижения, покупка подписки и статус условно премиум)». This splits in three, and only one third
   is missing:

   - **Achievements exist, and are further along than the question assumed.** `public.achievements` and
     `public.user_achievements` (`20260903210000_profile_achievements_cosmetics.sql:18, :31`), granted
     `auto` by `achievements_sync` or `manual` by a person holding the right; criteria
     (`20260903220000`), version binding (`20260903230000`), a pre-alpha tester award
     (`20260904050000`), and reads narrowed to signed-in accounts on 2026-09-11 (`20260911151000`).
     They already unlock profile decorations through `required_achievement` (`:47`). There is even a
     surface: `components/settings/ProfileDecorationSection.tsx:109-147` draws each achievement with its
     icon, title, description, whether it is held, the progress toward it, and the share of people who have it.
     **What is missing is not the system but the audience.** All of that is visible only to yourself, inside your
     own settings, as a way to unlock cosmetics. Discord shows badges on anyone card it opens. So this part is a
     rendering on another person profile, not a subsystem to build.
   - **A paid subscription does not exist.** Every `subscription` in this repository is a Web Push one
     (`20260427_push_subscriptions.sql:4`, `lib/browserPushSubscription.ts`).
   - **Premium does not exist** — zero occurrences of `premium` or «премиум» in the client, the API server or
     the migrations. A badge saying so would have nothing behind it, so that third is a product decision before
     it is an interface one.

3. **«Squad» repurposed as the display of the global role** — «свой значок красивый в зависимости от локации
   работника и отношения человека к админскому составу, чем выше статус тем красивее иконка». The word
   `squad` appears nowhere in this product; what it maps onto is the global role, which exists. The
   ordering such a mapping needs also exists and is **already unread by the client**: `roles.priority` and
   `roles.colour` (`20260904080000_roles_priority_and_colour.sql:42-49`), with `lib/roleHierarchy.ts` as
   the whole of the logic that reads them — and its own header warns that priority is presentation and grants
   nothing at all. An icon ladder keyed to it is honest only while it keeps saying so.

**The direction, which changes how other entries should be answered.** «мы и так планировали делать это скорее
как каналы в дискорде с войсами и т.п, чем просто группами как изначально в телеге». The target for this surface
is the shape Discord has. Recorded rather than acted on, because three entries opened the same day assume the
shape Telegram has: **D-164** proposes a group settings screen of that kind, **D-169** would label a channel the
way Telegram labels one, and **D-170** measures the absence of a Telegram-style invite link. The gaps they
measure are real; what a fix should look like is now an open question, and copying Telegram would be answering
against the wrong reference.

---

## D-169 `[ ]` A channel is shown as a group, with a «Участники» tab and a group's title

**Severity: low**, until channels are used in earnest.

**Surface:** `ChatInfoPanel.tsx:147` — `isGroup = !isSaved && (type === "group" || type === "channel")`.

**Defect:** a channel therefore renders the group panel, titled «Информация о группе» (`:223`), with the
«Участники» tab and «Удалить групповой чат». `getChatDisplayInfo` already has a «Канал» label
(`lib/chatDisplay.ts:70-77`) that this panel never uses. The «Топики» row is the one place that excludes
channels (`:1415`), so the distinction is known here and applied once.

---

## D-170 `[ ]` There is no way to invite anyone who is not already findable by name

**Severity: medium.**

**Surface:** `components/chat/GroupInviteModal.tsx:70-102` — a search over usernames and names.

**Defect:** `group_invites` is one row per named invitee
(`20260509_group_invites.sql:20`). There is **no shareable link or join code for a chat anywhere in the
product**. The invite codes that do exist (`registration_invites`, `20260622_registration_invite_codes.sql`)
are for signing up to the product, not for joining a conversation — the link on
`pages/admin/InvitesTab.tsx:192` is one of those and must not be mistaken for this.

**Also unsurfaced:** `group_invites.expires_at` is fetched (`ChatInfoPanel.tsx:414`) and never shown;
only the status is (`:1719`).

---

## D-171 `[ ]` Shared media has no dates, and the viewer shows one item with no sense of place

**Severity: low to medium**, and it is the difference between browsing and hunting.

**Surface:** `ChatInfoPanel.tsx:1796-1863` (the grid and lists), `components/chat/MediaViewer.tsx:45-48`.

**Defect:** the media sub-view has **no date grouping, no floating month marker and no fast scroll**; paging is an
observer sentinel doubling as a «Загрузить ещё» button (`:1882-1895`), 24 items at a time. The viewer
takes a single item — `media: MediaViewerItem | null` — so there is no next, no previous, no index and no
count: opening the third photo of eight hundred tells you nothing about where you are, and leaves you no way to
move.

The counts that do exist are good and are on the rows themselves («1543 фотографии»), from
`chat_media_counts` (`:631-642`), hedged as `24+` when the function is unavailable.

---

## D-172 `[ ]` The invitations block explains its own implementation to the reader

**Severity: low.**

**Surface:** `ChatInfoPanel.tsx:1662-1680`.

**Defect:** under the heading «ПРИГЛАШЕНИЯ» stands the sentence «Статусы обновляются без перезагрузки панели.»
beside a manual «Обновить» button. The sentence is a note about how the code works, and the button contradicts
it. Neither belongs to the person reading.

**Frames:** `output/group-info/1440-members.png`, `output/group-info/light-1440-members.png`.

Related and separate: `public.chats` is not in the `supabase_realtime` publication, so the panel's
binding on that table reports SUBSCRIBED and delivers nothing (`ChatInfoPanel.tsx:483-487`). Member and
invite bindings do work, which is why a manual refresh looks unnecessary and mostly is.

---

## D-173 `[ ]` Coming back to the tab refetches the open conversation seven times

**Severity: medium**, and it is a cost every person pays on every return to the tab, on every device.

**Surface:** the revalidation that runs when the document becomes visible again. Pinned by
`tests/e2e/chat-list-event-cost.spec.ts:215`: «coming back revalidates the open chat, once», expecting
`GET messages:list` at most once.

**Measured:** hidden for 16.5s, then visible — **7** requests for the open chat's history against the one the
contract allows. The list itself behaves: `GET chats` is 1, and `renders` are zero across
`ChatListItem`, `MessageRow` and everything else, so nothing re-renders. It is purely network cost,
which is why no screenshot shows it and why only a counting gate could find it. The same round also recorded
`GET message_hidden_for_users` 7 and `GET messages:count` 6, in step with the history fetches.

**It is not from the D-163 batch, and that was proved rather than argued.** Found while checking whether the
member-actions work had disturbed the chat list's cost contract. Every source change of that batch was removed —
the two tracked files reverted to `HEAD`, the three new modules moved out of the tree, with
`git status` showing no source modifications remaining — and the same test failed identically, `Received: 7`.
Everything was then restored and both files verified byte-identical by hash. So this predates that work.

**Why it was not already open:** this spec is one of the counting gates, and a run of the whole e2e set stops at
load on `resumable-media-upload.spec.ts`, so the suite is usually run by named file. Nothing was hiding it;
nobody had run it lately.

**Proposed:** find what subscribes to visibility and fans out — seven is close to the six-to-eight of a
per-something loop rather than a double-fire — and give the revalidation one owner, the way the profile fetch
got one after it was found running three times concurrently during session recovery.

---

## D-174 `[x]` Photos go at SD by default and there is no way to send one at full quality

**This is a design decision, not a defect report**, and it **supersedes the photo half of D-119** rather than
refining it. D-119 records «no quality choice when sending». The owner's instruction of 2026-09-13 is a quality
choice when sending, and the register must not hold both sentences as current.

**The owner, 2026-09-13:** «сделай по стоку загрузку в sd качестве, но чтобы пользователь мог выбрать hd
(именно фото …)».

**What changed from D-119 and what did not.** D-119's objection was never to the existence of a control — it was
to being *asked on every send*, through a five-stop slider whose choice was remembered and applied to everything
afterwards. That stays gone: the default needs no thought, nothing is remembered between sends, and the composer
still asks nothing. What returns is a two-state control on the sheet that already holds the send button, off by
default.

**Present state, measured:** every compressed photo goes through `prepareChatImageAttachment(file, DEFAULT_MEDIA_QUALITY)`
(`ChatWindow.tsx:379`), and `DEFAULT_MEDIA_QUALITY` is `balanced` — 1920px at quality 0.84
(`lib/mediaQuality.ts:29-33`). The other two profiles exist and are unreachable: nothing passes anything but
the default. So the whole of this change is a value travelling from the sheet to that one call.

**A naming trap to keep out of the code.** In this repository «original» already means two different things: the
image profile `mediaQuality: "original"` (2560px at 0.90, still a re-encode) and a genuinely untouched
upload (`uncompressed: true`, the «Отправить без сжатия» path). HD is the first; «без сжатия» remains the
second and is not renamed, merged or replaced.

**Proposed:** SD is `compact` (1280px, 0.76) and becomes the default; HD is `original` (2560px, 0.90) and
is chosen per send on the attach sheet, beside the send button, offered only where there is a photo that would
be compressed at all. Nothing is stored between sends. `media_metadata.media_quality` already carries the
value, so what was sent stays readable afterwards without a migration.

**Fixed 2026-09-13.** Built as proposed. The control is a two-state «HD» beside the send button, drawn only when
the selection holds a photograph that would be re-encoded — not on the file tab, where the bytes go untouched,
and not before anything is picked. Off for every send, and not remembered between them.

**The numbers turned out to be Telegram own, which was not known when they were chosen.** A study of its open
clients afterwards found the same pair on every platform: Android `getPhotoSize(highQuality)` returns 2560
or 1280; iOS `LegacyMediaPickers` uses `item.forceHd ? 2560 : 1280`; tdesktop
`PhotoSideLimit(large)` returns 2560 or 1280. Encoding quality differs — mozjpeg q72 on iOS, JPEG q80/q99 on
Android, q87 on desktop — but the two sizes are identical everywhere. Ours are 0.76 and 0.90 on WebP.

**What travels, and what does not.** The chosen value goes from the sheet into `AttachSendRequest.photoQuality`,
through `stageFiles`, into the one call that encodes (`prepareChatImageAttachment`), and into
`media_metadata.media_quality`. Nothing is written to storage and nothing is read back on the next send. The
recorder constant `DEFAULT_MEDIA_QUALITY` is deliberately untouched: it feeds `getVideoRecordingProfile`,
and answering a question about photographs with it would have re-tuned video recording as a side effect. A unit
test fails if the two constants are ever collapsed into one.

**Proof, and it measures the bytes rather than the button.** `tests/e2e/attach-sheet.spec.ts` sends the same
2400x1800 photograph twice, once untouched and once with HD, reads both uploaded objects back out of the
browser and compares them with sharp: the HD encode must be the wider one, and the two inserts must record
`compact` and `original`. A test that only asserted the button state would pass against a control wired
to nothing, and the wiring here runs through four files.

Mutation-proven, each half separately: making the choice always return SD turns the byte test red on «HD did not
reach the encoder»; making the offer rule always true turns the file-tab test red on «would mean nothing». Both
restored byte-identical.

**One thing the tests could not judge and the frames did.** The first version drew «HD» as bare grey text, which
reads as a label rather than a control. Telegram draws it boxed even when off — visible in the reference the
owner sent — so the off state now carries a border. Every test passed both before and after; only looking
settled it.

**Not done here, and not pretended to be:** the video half of the owner instruction, which is D-175. A video is
not re-encoded on the way out at all, so a ladder of 480p to 4K with a size beside each has nothing to attach to
yet.

---

## D-175 `[ ]` A video is never compressed on the way out, so there is nothing for a quality to choose between

**Severity: medium**, and larger in effort than it looks from the outside.

**The owner, 2026-09-13:** «у видно должен быть ползунок с корректным счётчиком веса в мегабайтах или ГБ в
разном качестве 480p/720p/1080p/2k/4k».

**Measured before estimating it:** `planAttachmentPreparation` (`lib/mediaCompression.ts:108-115`) returns
`"compress"` only for `isCanvasPhotoCandidate` — a photo. **A picked video returns `"as-is"` whether or
not the send was asked to compress**, so it is uploaded byte-for-byte as it sits on the phone. The
`VIDEO_PROFILES` with their bitrates (`lib/mediaQuality.ts:35-71`) are read only by
`getVideoRecordingProfile`, which the camera recorder uses. Nothing on the send path has ever re-encoded a
video.

**So this is not wiring up something that exists.** A ladder of 480p/720p/1080p/2k/4k with a truthful size beside
each needs client-side transcoding built from nothing — WebCodecs where it is available, a MediaRecorder
re-encode where it is not — with the decode time on a phone, the browser matrix and the memory ceiling that come
with it. The size counter is the easy half and is worthless without the other: a number no upload can be made to
match is a lie told precisely.

**The one thing that does exist:** the worker already produces a `video_720p` variant server-side
(`artifacts/api-server/src/workers/mediaVariantRules.ts:107`), and `selectVideoPlaybackUrl` already prefers it
for playback. That is a delivery ladder, not a send ladder, and it cannot make an upload smaller.

**Proposed, in the order that keeps each step honest:** first the photo control (D-174), which is a value
travelling to an existing call; then a measurement pass on client-side video transcoding — what a 1080p minute
costs in seconds and megabytes on the phones this product is installed on — and only then the ladder, with the
counter fed by the encoder's own settings rather than by an estimate. Recorded now so the gap between «the
counter is easy» and «the ladder is not» is on the record before anyone promises a date.

---

## D-176 `[ ]` The server re-does work the device already did, and hunts for it by scanning every minute

**Severity: medium for a person, high for the bill.** Nothing on screen is wrong; the cost is entirely in what
the server is made to do, and it grows with every upload.

**The owner, 2026-09-13:** «давай больше возьмём от функционала telegram чтобы какие-то действия выполнялись на
его устройстве и не грузили сервер лишний раз». This entry is the measurement that request deserves.

**What the server does that the device had already done, or could:**

1. **Every image variant.** `image_thumb` (360px, q76) and `image_preview` (1280px, q82) are sharp
   re-encodes (`workers/mediaVariantsWorker.ts:396-419`, rules at `mediaVariantRules.ts:19-22`) of bytes
   the browser held in a canvas moments earlier (`lib/mediaUpload.ts:114`). For an **original** the device
   already uploads a preview of the same geometry on purpose — `lib/mediaCompression.ts:211` and
   `mediaVariantRules.ts:61` are the same arithmetic in two copies, kept in step by a test so the bubble does
   not resize when the worker catches up. The server then produces it a second time.
2. **The video poster.** ffmpeg is spawned over a temp copy of the whole file to take one frame at 00:00:01
   (`mediaVariantsWorker.ts:496-529`). The device already opens that video to read its dimensions
   (`readVideoDimensions`, `lib/mediaUpload.ts:219`) and could draw the frame then.
3. **A full libx264 transcode per video** (`mediaVariantsWorkerHelpers.ts:33-73`: veryfast, crf 24, maxrate
   3M, AAC 128k) — while the device uploads the untouched original, because `planAttachmentPreparation` has no
   video branch at all (`lib/mediaCompression.ts:114`). That absence is D-175.
4. **Finding the work.** There is no queue and no webhook: `tick()` scans the newest 1200 image and video
   messages plus 240 avatar rows **every 60 seconds, forever, whether or not anything was uploaded**
   (`mediaVariantsWorker.ts:136-146, :196-206`). The code says so itself: «it has no queue — the candidate
   set is a fresh scan every minute» (`mediaVariantRules.ts:196-198`). The client knows the exact moment an
   upload finishes and tells nobody.
5. **Pulling the whole source into memory.** `downloadStorageObject` (`:625-636`) buffers the entire
   object — a 250 MB video is a 250 MB Node buffer — then writes it to a temp file for ffmpeg to read back.

**And three round-trips for answers the client already holds:**

- **In-chat search.** `search_chat_messages` on a 250ms debounce (`hooks/useChatMessageSearch.ts:100`),
  while a complete local implementation runs in the same render and is used only as a fallback (`:73-78`).
- **Permissions, one key at a time.** `has_permission` and `has_location_permission` fire per key and per
  location (`hooks/useRole.ts:144, :153, :279`) while one snapshot answers all of them locally three lines
  earlier (`:120`, `:255`).
- **Unread counts and previews** for chats whose Realtime events the client is already applying
  (`chat_list_summaries`, `hooks/useChats.ts:612`; the local deltas are `lib/chatListDelta.ts:4-22`,
  whose own header says it works out what one event changes without asking the server).

**The precedent is already in this codebase**, which is why this is a correction rather than a redesign: photo
compression, encoder selection, the skip-the-encode rule, GPS and QuickTime location stripping, the preview file
uploaded beside an original, chat-list deltas, message merging, receipt batching and permission evaluation from
a snapshot are all on the device today, and several of them were moved there deliberately.

**Proposed, first draft:** the device produces the poster and the preview it already has the bytes for, and says
so in the message it inserts; the worker stops scanning and drains a queue of what was not produced; the
transcode stays server-side until D-175 measures what a browser can do.

**Corrected 2026-09-13 by the evidence, and the correction matters more than the draft.** A study of what
Telegram actually does — read in its open clients, with the server inferred from its published API — says the
first half of that proposal is wrong and the second half is right.

- **Photographs: their server does exactly what ours does, and deliberately.** The client re-encodes to one size
  and uploads that one file; the whole ladder of thumbnails is generated server-side. Telegram own documentation
  names them so: type `s` is «Server-side resized image, bounded by 100x100 pixels», and `m` / `x` /
  `y` / `w` are 320, 800, 1280 and 2560; `a`–`d` are «Server-side cropped image». The uploaded
  photo is also **validated** — `PHOTO_INVALID_DIMENSIONS`, `PHOTO_SAVE_FILE_INVALID` are documented
  errors of `messages.sendMedia`. So `image_thumb` and `image_preview` being made on our server is
  **not** the defect this entry took them for. Moving them to the device would be moving away from the reference
  the owner named, not toward it.
- **Video: their client transcodes and their server does not** — except when sending to a big channel, where
  Telegram converts server-side and says so by **delaying publication**: such messages «will be added to the
  schedule queue … with schedule date equal to the approximated server-side conversion date». Ours is the
  opposite of both: the device uploads the file untouched and the server transcodes every one of them, silently.
  That half of this entry stands, and it is the same gap as D-175 seen from the server side.
- **Finding the work.** Telegram never scans for it: the upload is addressed by a client-chosen file id and the
  send itself carries the media, so the server learns of a file at the moment it is referenced. Our 60-second
  scan of 1200 rows has no counterpart there. That half stands too.

**So what this entry is really about, after the correction:** not that the server does image work, but that it
does **video** work the device should do, and that it **hunts** for work it should be told about. The photo
variants are the one piece to leave exactly where it is.

**One thing worth copying outright:** Telegram uploads the file in parts *while the encoder is still producing
them* — the documentation describes it («each part is uploaded immediately as soon as it is produced by the
encoder») and both native clients implement it. It is the reason transcoding on the device does not feel like
waiting twice. A browser cannot do this today with WebCodecs the way a native client does, which is recorded in
D-175.

---

## D-177 `[ ]` Eleven things the client decides that the server never re-checks

**Severity: high.** Not a defect anyone can see, and the reason it is here rather than in a performance note is
that three rules of exactly this shape had to be added in the week before this audit, each migration header
naming the hole it closed: one reaction per person (`20260911142000`), read marks that only move forward
(`20260911140000`), and forwarding that copies media from the server own row rather than from the client
(`20260911144000`). The list below is the same shape, still open.

Each item is something the client decides, where no trigger, constraint, RLS policy or bucket setting re-checks
it.

1. **`media_metadata` entirely.** The only server rule is that it is a JSON object
   (`20260523_message_media_metadata.sql:20-21`). Width, height, size, mime type, `optimized`,
   `uncompressed`, `media_quality`, duration and the whole `preview` block are the sender word
   (`lib/mediaCompression.ts:333-391`) and are inserted verbatim.
2. **`media_bucket` / `media_path` / `media_url`.** The insert policy checks membership and
   authorship and nothing about media (`20260831100000_bot_platform_foundation.sql:759-767`). The `media`
   bucket is public, so a member can post a message pointing at another person object path. The **write** policy
   does confine uploads to `{auth.uid()}/` (`20260505_media_storage_path_policies.sql:47-49`), so this is
   a mislabelling hole rather than an upload hole — but a message can still claim someone else file as its own.
3. **Size limits.** 50 MiB general, 250 MiB video, 50 MiB original are client constants
   (`lib/stagedAttachments.ts:93-97`, `lib/mediaCompression.ts:36`). The `media` bucket has **no**
   `file_size_limit`; the only bucket with one is `chat-media`, which the forward migration records as
   unused (`20260911144000:47-48`).
4. **MIME type.** No `allowed_mime_types` on `media` either. The `type` column and
   `getAttachmentKind` (`lib/stagedAttachments.ts:234`) are both the client word.
5. **Ten attachments per send** — `MAX_STAGED_ATTACHMENTS`, client-only.
6. **Location stripping.** `removeLocation` runs in the browser only (`ChatWindow.tsx:395`). A client
   that skips it uploads GPS-bearing EXIF and QuickTime location boxes, and nothing on the server inspects the
   bytes it later hands to sharp and ffmpeg. **This is a privacy guarantee with no server enforcement anywhere**,
   and it is the one on this list that would embarrass us rather than cost us.
7. **`client_sent_at`** is a free-form client timestamp (`hooks/useMessages.ts:973`) with no trigger
   clamping it to `now()` — the contrast being read marks, which got exactly that clamp
   (`20260911140000:33-36`). `created_at` is a database default and is safe.
8. **`edited_at`** is set by the client in the same PATCH as the content (`useMessages.ts:1220-1223`).
   Nothing requires it, so an edit can be made without stamping one, or with any value. There is no edit-window
   rule at all.
9. **Whether an image is uncompressed.** That flag and the `preview` block decide whether a reader downloads
   an original or a preview (`readOriginalPreview`, `lib/mediaCompression.ts:296`). The server never
   verifies that the file is the untouched original, nor that the declared preview dimensions match the object.
10. **`optimized`, `original_size_bytes`, `original_mime_type`** — sender assertions with no
    counterpart.
11. **A resumable upload reports its own destination.** `lib/resumableStorageUpload.ts:183-187` resolves with
    the name the client intended rather than anything the tus server confirmed, and that value becomes
    `messages.media_path`. The plain branch does use the path the server returned (`ChatWindow.tsx:562`).

**One mitigation worth naming, because it shows the shape of the fix:** `readOriginalPreview` refuses any
preview path that is not exactly `originalPreviewPath(media_path)` and rejects traversal
(`lib/mediaCompression.ts:288-306`, reasoning at `:236-245`). That is the right instinct applied on the
wrong side of the wire: it protects a reader from a bad row, and does nothing to stop the row being written.

**Proposed:** close these where the database can, in the order of what a bad actor gets for free — the bucket
limits and the mime allowlist first, because they are configuration rather than code; then a trigger that
constrains `media_path` to the sender own prefix, matching the storage policy that already exists; then the
timestamps. Server-side location stripping is the one that needs a decision rather than a patch, because it
means the server reading every uploaded byte.

**Not a finding, and stated so nobody re-opens it:** this list is about what the server would accept from a
modified client, not about anything the shipped client does wrong. Each item costs nothing today and costs
everything on the day someone points a script at the API.
