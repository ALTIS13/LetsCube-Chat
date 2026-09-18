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

## D-095 `[x]` A new photo's worker copies do not reach an open chat without videos

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

## D-097 `[x]` «Открыть оригинал» on a compressed photo opens the compressed copy

**Severity:** low; wording.

**Defect:** for a compressed photo no original exists on the server, so the label
promises something that is not there.

**Measured, not assumed** (2026-09-14). The control acts on `media.url`, which
every caller sets to `message.media_url`; `window.fetch` was recorded in the page
and the press reached for exactly that address and nothing else. And
`message.media_url` is the only file there is: `stageFiles` in `ChatWindow.tsx`
uploads `prepareChatImageAttachment`'s output, so for an ordinary photo send the
picked file never leaves the sender's device. **The control was already opening
the best file that exists** — what was wrong was the claim, and it survived
D-147's rename: the header marked an uncompressed send «Оригинал» and said
nothing at all about a copy, so «Сохранить» on a 4 MB photograph quietly handed
over a 380 KB WebP.

**Fixed** 2026-09-14 by saying it. `lib/mediaOriginality.ts` reads
`media_metadata` into three states, and the third is the point: `uncompressed`
is the sender's own answer and wins; a copy is only called one where the
metadata proves a re-encode — `optimized`, a picked size larger than the stored
one, or a stored type that is not the picked one; everything else is **unknown**
and the interface claims nothing. A legacy row, a round message (whose metadata
carries none of those fields), a photograph the canvas could not make smaller
and anything opened from a surface that does not read a message row all land
there, and the viewer is silent for all of them — which is why
`media-viewer-actions.spec.ts` still reads «Сохранить» unchanged.

In the viewer the badge is now the state's own word — «Оригинал» or «Сжатая
копия» — with the sentence «Оригинал остался у отправителя: в чат отправлена
сжатая копия.» as its `title`, and the file control's accessible name gains what
the press will hand over: «Сохранить сжатую копию», «Открыть сжатую копию в
браузере». D-147's own answer is untouched — which shell this is, whether the
press leaves the app, and the visible label — and an unknown message keeps
D-147's wording exactly.

**Measured cost, and the second spelling it bought.** The badge is drawn at
every width, for the reason D-147 gives about a warning hidden below `sm`, and
it is paid for out of the title. In the worst header the viewer draws — a video,
the one kind with a fourth control — the full phrase left the picture's own name
**75px at 390** and **51px at 360**, and 51px is four characters and an
ellipsis. So below `sm` the word is «Копия», which is 47px narrower and is the
exact opposite of «Оригинал», so the narrow pair still reads as a pair; why it
is a copy is in the `title` and in the control's accessible name, neither of
which depends on width. «Оригинал» is short enough for 360 as it is and has one
spelling. Measured again after the change, in that same video header: **98px**
of title at 360, **128px** at 390 and **210px** at 1440 (where the badge is the
full 85px phrase). A photo and every desktop width were never tight. The e2e
fails below 60px and asserts that exactly one spelling is drawn, so neither a
longer word nor a hidden one can slip back in — both were proved red.

**Deliberately not done.** No original is invented. Keeping one for a compressed
send means uploading the picked file beside the copy — a second upload on every
phone, a second object per photo in the public `media` bucket, and a retention
decision — which is a product change, not a wording fix, and needs the owner.
**No server or worker change was needed for this entry, and none was made.** The
conversation's own bubbles are also left alone: the corner chip still marks an
original, and stamping «Сжатая копия» on every other photo in a chat would put a
chip on nearly all of them.

**Regression tests:** `tests/unit/media-originality.test.mts` (5, on the metadata
shapes `buildAttachmentMediaMetadata` actually writes) and
`tests/e2e/media-original-claim.spec.ts` (3 cases across all six Chromium
viewports and WebKit 390), which records what `fetch` reached for rather than
trusting the label. Seven mutations, each red: unknown collapsing into
«compressed»; `uncompressed` no longer winning; the size proof widened out of
reach; the control's name never speaking; the badge drawn for an original only;
the badge hidden below `sm`; the compact spelling put back to the full phrase.

On WebKit the video case holds the clip's bytes rather than serving them, for
the codec reason recorded under D-129; the header is drawn from the message row,
not from the video, so it is the same header either way.

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

**Applied to production on 2026-09-14**, three days after it was written and
approved, having sat unapplied while the register said «fixed». Reading the live
policies is what found that: `Anyone in chat can view reactions` was still there
with `using (true)`, and `anon` still held SELECT, INSERT, UPDATE and DELETE. A
fix in a commit is not a fix in a database.

Both migrations of `6e2f5ed` went in, in order — `20260911142000` first, because
`150000`'s insert policy is written to mirror what `set_message_reaction`
checks, and that function did not exist on production either.

*How.* A `pg_dump` of `public.reactions`, verified restorable with `pg_restore -l`
and hashed, at
`/srv/letscube/backups/pre-migrations/20260913-223914-before-reactions-members-only.dump`.
Then a throwaway database loaded from a schema-only dump of production, both
migrations applied there, and **both rehearsal files run there and green** —
rather than running data-creating SQL against production and trusting ROLLBACK.
Then applied to production as `postgres`, which owns both tables.

*Measured after, as `authenticated` with real claims rather than as the table's
owner — a policy measured as its own table's owner is not measured at all:*

| | before | after |
| --- | --- | --- |
| `SELECT` policies with `using (true)` | 1 | 0 |
| `anon` may SELECT | yes | no |
| reactions an outsider can read | 149 of 149 | **0 of 149** |
| an outsider may react to a message in a chat they are not in | yes | refused |
| `set_message_reaction` exists | no | yes |
| reaction rows | 149 | 149 (none touched) |

The deployed client is unaffected: it prefers `set_message_reaction` and falls
back to a direct insert where the function is absent, and that insert is made
only in a chat the reader is in, which is exactly what the new policy allows.
The function now exists, so the fallback stops being used.

**Regression tests:** the rehearsal
`.migration-backup/supabase/rehearsal/20260911150000_reactions_visible_to_chat_members.test.sql`
— a member reads and adds; a stranger to the chat neither reads nor adds; no one
reacts in another's name, on a deleted message or on a notice; anon is refused; the
one-call toggle still works — run in PGlite by
`tests/server/message-actions-db.test.mjs` and on a copy of production's schema.

## D-105 `[ ]` A global administrator deleting the other person's message in their own private chat is audited as staff

**Severity:** low, and the entry asked whether the row is wrong or merely terse.
Measured on production 2026-09-15: **wrong, in every case it can fire.** Found
with D-102.

**Surface:** `public._audit_messages_admin_delete()`, the AFTER UPDATE OF
`deleted_at` trigger `trg_audit_messages_admin_delete` on `public.messages`.

**Defect:** the trigger records `message_deleted_by_staff` whenever the caller
`is_manager_or_admin` and is not the author. It never asks *why* the delete was
permitted, and that turns out to be the whole question — because only one path
can reach it, and on that path the caller was not acting as staff.

**Measured.** Exactly two functions assign `messages.deleted_at`:
`bot_message_command_internal`, granted to `service_role` only, so `auth.uid()`
is null and the trigger's own `caller is not null` guard skips it; and
`delete_messages_for_everyone`, granted to `authenticated`. A direct
`UPDATE public.messages` cannot be a third — the only permissive UPDATE policy
is `Users can edit own messages` (`user_id = auth.uid()`), so the caller is
always the author and `caller is distinct from new.user_id` skips it. And
`delete_messages_for_everyone` splits on the chat: in a **private** chat every
member may delete anybody's message, while in a group it refuses any message
that is not your own. So the trigger's two guards admit one situation only — a
private chat, where the caller acted as an ordinary participant.

**Consequence:** the row names an action that was not taken in a staff capacity;
the identical act by a non-staff participant produces no row at all, so the
table audits the person rather than the act; and the payload carries `chat_id`
and the other party's id from a private conversation into a table
`audit_logs select by permission` opens to anybody holding `audit.view` — 5 of
18 accounts, against 27 private chats.

**Nothing is lost by removing it, and that is the part worth keeping.**
`delete_messages_for_everyone` already writes `private.message_deletions`
(`message_id, chat_id, deleted_by, author_id, chat_type, deleted_at`) for every
delete. That table lives in the `private` schema, which `authenticated` cannot
even USAGE, and only `postgres` holds privileges on it. The complete, closed
record already exists; the `audit_logs` row is a second copy that is both
mislabelled and readable by five people. It was found by the rehearsal dying on
`message_deletions_pkey`, not by reading the source.

**Nothing to backfill:** `message_deleted_by_staff` has **0** rows against 392
audit rows in total, and `private.message_deletions` has 0 rows, so nobody has
ever used delete-for-everyone here. The label has never actually been written.

**Proposed, written and rehearsed, NOT applied and NOT in the repository.** The
fix narrows rather than widens: skip the audit when the chat is private, and add
`chat_type` to the payload so the rows that can still be produced say what they
are. The trigger is kept rather than dropped, for the day a moderator can remove
a message from a group. Files were written to the session scratchpad as
`20260915160000_a_private_delete_is_not_a_staff_action.{sql,rollback.sql,rehearsal.sql}`
and still need to be moved under `.migration-backup/supabase/`, which another
agent held at the time.

**Rehearsed on production inside one rolled-back transaction**, both phases with
a control:

| step | measured |
| --- | --- |
| BEFORE: private delete by staff wrote audit rows | 1 |
| AFTER: private delete by staff wrote audit rows | 0 |
| CONTROL: group delete still audited | 1 |
| CONTROL: the row now names the chat kind | `group` |

The BEFORE phase is what makes the rest mean anything — it reproduces the defect
against the body that is live today, so an AFTER of 0 cannot be a trigger that
never fires. Afterwards production measured 392 audit rows, 0
`message_deleted_by_staff`, 0 `message_deletions`, and a trigger body with no
`chat_kind` in it — unchanged.

## D-106 `[x]` The chat list event-cost spec runs without the flag its count depends on

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

## D-112 `[x]` In the Windows app the window's own buttons sit over the page's top-right controls, and take most of their clicks

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

## D-113 `[x]` A video does not send

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

## D-114 `[x]` A 300 KB photo takes a very long time to upload

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

## D-120 `[x]` A «Папки» tab duplicates the folder tabs above the chat list

**Severity:** low, for clutter. Named by the owner on 2026-09-11.

**Defect:** on a phone the bottom bar carries «Папки» beside the folder tabs already
at the top of the chat list, and the tab does nothing those do not. Telegram shows
folders at the top only.

**Decision:** remove the duplicate, inside the navigation work of item 30.

**Confirmed against the shipped code on 2026-09-17**, and it was worse than «a tab
that does nothing those do not»: the tab set `mobileSection = "folders"`, `Sidebar`
watched for it and opened `FolderListModal` — a **second, full-screen folder
surface**, drawn in the old material with a perimeter around every row and the page
ground inside its icon squares. Photographed at 390 in both themes before the fix:
`output/folders/folders-before-390-{dark,light}-tab.png`.

**Fixed on 2026-09-17.** The capsule is «Чаты», «Профиль» and «Задачи» where the
right allows it; `FolderTabs` at the top of the list is the phone's folder surface,
and it already chose, created with «+» and edited on a second press of the chosen
tab. `FolderListModal.tsx` is deleted — nothing else reached it — and `mobileSection`
no longer carries `'folders'`.

The list of destinations moved to `artifacts/kub/src/lib/bottomNavDestinations.ts`,
which imports nothing, so *which surfaces are destinations of their own* is now a
decision `node --test` can reach instead of one only a screenshot could check. All
three removals — «Поиск» and «Админка» on 2026-09-12, «Папки» here — are recorded in
that module, because the cheapest way to reintroduce one is not to know it was ever
taken out.

**Tests:** `tests/unit/bottom-nav-destinations.test.mts` (7, two of them in-file
mutations) and the phone half of the folder-surface pair in
`tests/e2e/desktop-shell.spec.ts`, whose title has claimed «its only folder surface»
since 2026-09-12 while checking nothing of the sort. Proved by restoring the
destination in the module and the store: 4 unit tests red (3 in the new file, 1 in
`narrow-phone-typography`), the e2e red on `toHaveCount` expected 0 received 1 for
the «Папки» button; reverted to the same SHA-256 and 9/9 plus the e2e green again.

**Renders:** `output/folders/folders-{after,tab-restored}-390-{dark,light}-list.png`,
with the pair taken minutes apart on one tree so the concurrent work in this
worktree could not leak into it. Pixel-differenced rather than eyeballed: the only
region that changes at 390 is the capsule, `(189, 2058)-(823, 2184)`, and at 1440
**no pixel changes at all** — the capsule is `md:hidden` and the folder rail is the
computer's folder surface. `tab-restored` is byte-identical to the `before` frames.

**Two things worth keeping:** on an account without the tasks right the capsule is
now two entries, which is thin but symmetric and reads fine — say so if that is not
wanted, it is one line in the module. And this closes the 2026-09-12 «four labels»
number: the owner set four when «Папки» was still one of them.

## D-121 `[x]` Sound settings are large stretched modules left from the old interface

**Severity:** medium, for the look. Named by the owner on 2026-09-11.

**Defect:** the notification sound settings are drawn as large, stretched panels
where Telegram has compact grouped rows.

**Decision:** rebuilt in Telegram's settings idiom inside the parity work of item 30.

**Already fixed when this entry was re-checked on 2026-09-17; the register was
stale.** `e9c2790` (2026-09-14, «the sound settings stop being a different
application») rebuilt the surface: three boxes filled from the page ground inside a
panel became three captioned groups of hairline-divided rows drawn by `AudioGroup`,
whose container is the same string `SettingsGroup` uses for the four groups outside
the panel; two bare checkboxes became `KubSwitch`; three stacked full-width pills
became the segmented track the theme picker and «Лимит кэша» already are; and the
162x16 «Сбросить настройки звука» text link became a 44px row.

There is one wrinkle in the entry's own words: the product has **no notification
sound settings**. `SETTINGS_ROWS` carries a single «Звук» row, under «Приложение»,
with the keywords микрофон/аудио/голос/громкость/усиление, and that panel is what
was rebuilt. If a notification tone picker is wanted it is a new feature, not this
defect.

**Verified on rendered pixels, not on the commit message.** Before,
`output/audio/audio-before-390-dark-0.png`: three outlined near-black panels, each
holding another outlined box holding the control. Now,
`output/audio/audio-current-390-{dark,light}-*.png` and the 1440 pair, taken
2026-09-17 from the shipping component: muted uppercase caption, one veiled group
per caption, rows parted by `--kub-rule`, switches on the right, one segmented
track. That is the «compact grouped rows» this entry asked for.

**One gap closed rather than a second surface built.** `audio-settings-capture.spec.ts`
photographs and asserts nothing by design, and `audio-settings-vocabulary.spec.ts`
pins the ground, the nesting, the switches, the picker, the single mode readout, the
reset row and the clipping — but nothing tied the group's shape to the screen around
it, so `SettingsScreen.tsx` could move to a different group and this panel would
quietly become a dialect again, which *is* the defect. «a group here is the same
object the settings screen draws» in `tests/unit/audio-settings-surface.test.mts`
compares the two strings instead of describing either. Proved both ways in-file, and
on disk: changing `rounded-xl` to `rounded-2xl` in the section turned 4 tests red
(the new one, its own mutation check, and two older ones that read the same string);
`git checkout` restored the file to SHA-256 `5015bb98…` and 20/20 went green.
`SettingsScreen.tsx` was read and never written — it belongs to another track.

## D-122 `[x]` The attach menu is a list of buttons that open other things, where Telegram's attach sheet does the thing in place

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

**Measured on production, 2026-09-15, and the last sentence of the proposal is
the one that settles it: the screen has nothing to call.** That verification was
done before building, and it came back negative on every write.

The population is real, which the entry could not confirm — it says «production
membership was not checked». 4 locations, 16 memberships, 10 distinct people,
and two of them hold management grants with **no global role at all**:

| person | location role | locations | global rank | `is_manager_or_admin` |
| --- | --- | --- | --- | --- |
| `3e7836d4` | `location_admin` | 2 | 10 (`user`) | false |
| `f31ebd8e` | `location_manager` | 3 | 10 (`user`) | false |

The grants are real too: impersonated inside a rolled-back transaction,
`3e7836d4` measures `has_location_permission(…, 'location_members.manage') =
true`, `tasks.manage = true`, `is_location_admin = true`.

**But every write a location page would need is gated on the global predicate,
and the grant is honoured by nothing.** Read off production:

- `location_member_assign` → `if not public.is_admin(v_caller)`
- `location_member_remove` → `if not public.is_admin(v_caller)`
- `location_member_set_primary_admin` → `if not public.is_admin(v_caller)`
- `location_member_assign_role` → `_require_permission('location_members.manage')`,
  and `_require_permission` calls `has_permission`, which is **global only** —
  it folds in `owner`/`tech_admin`, global role permissions and the legacy
  column, and never looks at `location_members`.

`public.location_members` additionally carries `insert blocked`,
`update blocked` and `delete blocked` (`with check false` / `using false`), so
there is no direct-table route around the RPCs either. Behaviourally, as
`3e7836d4`:

    location_member_assign_role(...) : REFUSED -> insufficient_permission

The one consumer that *does* honour the location grant is `is_location_admin`,
and it grants **visibility**, not management: the SELECT policy
`location_members select scoped` admits `is_location_admin(location_id,
auth.uid())`, and the same impersonated session reads 11 rows. So the
`location_members.manage` grant on `location_admin` is decorative — it opens a
list and authorises nothing on it.

**Scaled down rather than built,** on the measurement. A location page is not a
client defect and cannot be fixed on the client: the missing half is four server
functions that never learned the location dimension, the way `task_claim`,
`task_soft_delete` and `task_update_v3` did. Building the screen first would
produce «Сотрудники» whose every control returns `insufficient_permission` —
D-202's defect at the scale of a whole page. **What this needs first is an
owner decision** (is `location_admin` meant to manage its own location's
members, or is the grant a mistake in the role catalogue?) and then a migration,
not a screen. D-124 was independent of this and did land first, as the entry
predicted.

## D-124 `[x]` Task actions check global staff status, so a location administrator cannot confirm, reject, assign or cancel their location's tasks

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

---

### How it was closed, 2026-09-15 — and the proposal above is wrong

**The server functions check no such thing.** That clause — «the grants the
server functions check» — was the one part of this entry nobody had measured,
and it is false. `public.tasks` carries `insert/update/delete blocked` at RLS,
so the SECURITY DEFINER functions are the only authority there is, and three of
the four ask the *global* predicate:

| action | server gate, read off production | location-aware? |
| --- | --- | --- |
| `task_confirm` | `is_manager_or_admin(caller)`, `status = waiting_confirmation`, `assignee <> caller` | no |
| `task_reject` | identical to confirm | no |
| `task_assign` | `is_manager_or_admin(caller)`, `status in (new, assigned)` | no |
| `task_cancel` | `created_by = caller` **or** `is_manager_or_admin(caller)` | no |
| `task_update_v3` | creator, **or** `is_manager_or_admin`, **or** `location_id is not null and is_location_admin(location_id, caller)` | **yes** |

Measured behaviourally, impersonating the one account holding `location_admin`
on two locations with no global role, inside a rolled-back transaction, with a
control that had to succeed:

    loc_perm(tasks.manage)=true   is_manager_or_admin=false   is_location_admin=true
    task_confirm : REFUSED -> Подтверждать может только администратор или менеджер
    task_assign  : REFUSED -> Только администратор или менеджер может назначать задачи
    task_cancel  : SUCCEEDED (creator branch)
    CONTROL, an account the server does call staff:
    task_confirm : SUCCEEDED

So building the proposal would have drawn «Подтвердить», «Отклонить» and
«Назначить исполнителя» for somebody the database refuses — **D-202's defect
pointing the other way**, which is precisely the mistake that entry was closed
to stop. The person would have got a refusal after filling in a form instead of
a control that was never offered. That is worse, not better.

**What was actually wrong, and it is two gates drawn too narrow, not four too
narrow.** The same measurement found the client refusing two things the server
accepts:

- **cancel forgot the creator.** `canCancel` read `isStaff && …`, so whoever
  created a task is not offered «Отменить задачу» on it unless they are also
  staff — while `task_cancel` accepts them, as the probe above shows.
  `canEdit` already carried the creator branch; cancel never did.
- **edit forgot the location.** `canEdit` read `(isCreator || isStaff)`, so a
  location administrator gets «Редактировать» only on tasks they created —
  while `task_update_v3` has always accepted them for any task at their
  location. This is the «sees only «Редактировать», and only on tasks they
  created» in the defect text above: the second half of that sentence was the
  bug, not the first.

**And a third mismatch, latent.** The gate was `useIsManagerOrAdmin()`, which is
the client's wide `isStaff` — a strict superset of `is_manager_or_admin`,
because it also admits a holder of one of `STAFF_ACCESS_PERMISSIONS`. Measured
across all 18 profiles the two agree today (5 staff, 13 not), so nothing was
visibly wrong; it is the same disagreement D-202 recorded, on another screen.

**Fixed** in `artifacts/kub/src/lib/taskActionAccess.ts` — one copy per RPC of
the gate that RPC applies, with the five production function bodies quoted in
its header — wired into `pages/tasks/TaskDetailModal.tsx`. The global predicate
is **not** respelled: the module takes it as a boolean and the modal gets it
from `useMatchesIsManagerOrAdmin()`, the existing `lib/serverRoleAccess.ts`.

`is_location_admin` is **not** copied either, and that is deliberate. It ORs a
global permission, a location permission **and** the legacy
`location_members.role` text column, and on this deployment the account holding
`location_manager` satisfies it through the legacy branch alone —
`location_members.manage` and `tasks.manage` both measure false for them while
`is_location_admin` measures true. A client copy built on permission keys would
therefore be *narrower* than the database and would hide the control from them.
The function is `security definer` and granted to `authenticated`, so
`hooks/useLocationAdmin.ts` asks the database instead, gated on the task
actually having a location.

**Verified:** `tests/unit/task-action-access.test.mts`, 12 tests, **proved by 9
mutations, all caught**, baseline green before and after. Seven restore or
invert the module (drop cancel's creator branch; drop edit's location branch;
widen confirm and widen assign to a location admin — the proposal above, which
must go red; drop the own-task guard; and swap the two lock-status lists, which
differ by `rejected`). **Two mutate the component, and both were green on the
first pass** — a perfect module while the screen computes its own answer is
exactly the «a declaration is not a surface» hole, so a bounded wiring section
was added and both now go red.

**Left open deliberately, as D-205.** A location administrator still cannot
confirm, reject or assign — which is now *correct*, because the database refuses
them, and the interface no longer promises otherwise. Whether it *should* refuse
them is a product question about the role catalogue rather than a defect in a
screen, it is the same question D-123 raises one table over, and both need an
owner decision before any migration. Closing this entry `[x]` means the
interface no longer disagrees with the server; it does not mean the role does
everything its grants suggest.

**Not covered, and not faked:** nothing renders this modal in a browser. There
is no live task on this deployment to render it against — all 40 `tasks` rows
are soft-deleted, the last on 2026-07-13 — and no DEV task fixture exists, so
the wiring is held by a source guard, which is the weakest kind of test here and
is scoped to four exact expressions for that reason. **No pixels were captured
and none could be.** Nothing visible changed on this deployment either: with no
live task the modal is unreachable, and all 18 accounts measure the same under
the old wide predicate and the new one (5 staff, 13 not), so the swap moves
nobody today.

## D-125 `[x]` A bot's inline keyboard is never drawn, so its question cannot be answered

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

**Done on 2026-09-14, and why this stays open.** The client half is built: a bot's
`bot_reply_markup` is parsed by `artifacts/kub/src/lib/botChatSurfaces.ts` and drawn under
the bubble by `artifacts/kub/src/components/chat/BotInlineKeyboard.tsx`, in the bot's own
rows, with a press saying so on that button alone and a failure putting the button back.

What it cannot do is deliver the press, and the reason is not in the client.
`public.bot_update_enqueue_internal` is the only writer of `private.bot_updates`; its
`callback_query` branch is already written and already checks that the actor is a member
of the chat, and it is `revoke all … from authenticated` / `grant execute … to
service_role`. It also takes the actor's id **as an argument** rather than reading
`auth.uid()`, so opening that grant as it stands would let one member of a chat forge a
press as another. What is needed is a thin wrapper — `public.bot_callback_press(p_message_id
uuid, p_data text)`, `security definer`, granted to `authenticated`, passing `auth.uid()`
as the actor — and a way to read the bot's `answerCallbackQuery` back, which today lands in
`private.bot_callback_answers` and is revoked from every role. The client already calls
that name and already says «Кнопки этого бота пока не работают.» while nothing answers to
it, so the surface comes back on its own the moment the wrapper exists.

**Two corrections to this entry, both measured.** «URL buttons open their link» cannot
happen: `private.bot_inline_keyboard_valid` counts the keys of each button and requires
exactly two, named `text` and `callback_data`, so a `{text, url}` button cannot be stored.
The parser refuses one, and `artifacts/kub/src/pages/public/BotDocsPage.tsx` promises
callback buttons only — the Bot API's `callbackButtonSchema` agrees. And the bot's answer
cannot be shown «as a toast» until the second half above exists.

## D-126 `[x]` A bot's commands are stored but never offered in its chat

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

**Closed on 2026-09-14.** A button inside the field's capsule opens the list; «/» in the
field filters the same list, by the name's prefix and in the order the bot registered them
(`bot_commands.sort_order`). Choosing a row fills the field with «/команда » and does not
send — a command that takes an argument would be unusable from a menu that sent on the
choice. `artifacts/kub/src/components/chat/BotCommandMenu.tsx`,
`artifacts/kub/src/hooks/useBotChat.ts`, decisions in
`artifacts/kub/src/lib/botChatSurfaces.ts`.

This one needed nothing new from the server: `public.bot_commands` carries `grant select …
to authenticated` under the policy «members and owners read bot commands», so a chat member
can already read them. Two consequences worth recording. A bot's commands are only readable
**once you share a chat with it**, so there is no way to preview them from search — which is
correct, and is the reason this depends on D-127. And no bot table is in the
`supabase_realtime` publication, so a bot that replaces its commands is seen the next time
the chat is opened, not at once; a poll would cost every chat in the product a request for a
fact that changes perhaps once in a bot's life.

## D-127 `[x]` A bot found in search cannot be opened

**Severity:** high, for bots: search is where people find one, and the result leads
nowhere. Found by the chat-functions audit; rendered on the fixture (frame 33).

**Surface:** `artifacts/kub/src/components/search/SearchShared.tsx:376-379`.

**Defect:** tapping a bot in the search results opens the modal «Запуск чата с ботом пока
недоступен.»

**Proposed:** open or create the chat with the bot, with «Запустить» in place of the
composer until the person starts it, as Telegram's «Start» (audit source T62). Until that
exists, leave bots out of the results.

**Audit rows:** chat-functions A11, K4; top-10 item 8.

**Half done on 2026-09-14.** Tapping a bot now opens the chat with it when one exists:
`chat_bot_members` is readable by an ordinary account, so the chats shared with that bot are
found, intersected with the reader's own memberships — a bot's owner sees chats they are not
in — and a private one is preferred over a group. Before this, even an existing bot chat
could not be reached from search at all. «Запустить» is in place too: in a chat holding a
bot that the reader has never written in, the whole composer is one button, and it sends
`/start`. Both in `artifacts/kub/src/components/search/SearchShared.tsx`,
`artifacts/kub/src/components/chat/MessageInput.tsx` and
`artifacts/kub/src/lib/botCallback.ts`.

**What is left is creating a chat that does not exist yet, and it is a server gap.**
`public.chat_bot_members` carries `grant select … to authenticated` and nothing else — no
INSERT grant, no INSERT policy, and no RPC anywhere that inserts into it. The only
`insert into public.chat_bot_members` in the repository is in the rollout smoke SQL, run as
`service_role`. What is needed is `public.open_or_create_bot_chat(p_bot_id uuid) returns
uuid`, `security definer`, granted to `authenticated` — the bot's counterpart of
`open_or_create_private_chat`. The client already calls that name and says «Чат с ботом пока
недоступен.» while nothing answers to it.

**One thing to settle when that RPC is written:** a private chat with a bot has no second
human, and `getChatDisplayInfo` takes a private chat's title from the other member, falling
back to `chats.name`. So such a chat will show whatever `name` the RPC writes, with the
subtitle «Личный чат», rather than the bot's display name. Noted rather than fixed here —
it cannot be reproduced until a bot chat can be created.

## D-128 `[x]` A group's member actions appear only under a mouse pointer — the same defect as D-163

**Severity:** high on phones and tablets, where owners and administrators cannot promote,
demote or remove a member. Found by the chat-functions audit; rendered on the fixture
(frame 07, with the pointer over one row).

**Surface:** `artifacts/kub/src/components/chat/ChatInfoPanel.tsx:1550-1623`: the promote
(chevron-up), demote (shield-off) and remove (×) buttons carry
`opacity-0 group-hover:opacity-100`.

**Defect:** a touchscreen has no hover, so the three buttons are never shown there.
Removal asks «Удалить участника из чата?» once pressed. Not checked by the audit: whether
the invisible buttons still take a tap at their position.

**Closed on 2026-09-14 as a duplicate**, not by a fix of its own. **D-163** is
the same three controls, the same class list and the same surface, found again
later and fixed in `14854cc` — the container carrying
`opacity-0 group-hover:opacity-100` is gone, and the only occurrence of that
class list left in `ChatInfoPanel.tsx` is inside the comment that explains the
fix. Verified by grep on the day this was closed.

Worth noting rather than deleting: the register carried the same defect twice
for three days and the open count was wrong by one the whole time. An entry
whose fix arrives under another number is not closed by anybody, because the
person fixing it is reading the other number.

**Proposed:** a muted «владелец» or «админ» on the right of the row; a tap opens the
member's profile; long press, swipe or ⋯ offers «Назначить администратором» and «Удалить
из группы» (Telegram: iOS swipe actions, Desktop context menu; audit sources T46 to T48).

**Audit rows:** chat-functions B15; top-10 item 7.

## D-129 `[x]` A round video scrolled under the chrome paints over the header, the pinned bar, the search results and the composer

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

**Reproduced** 2026-09-14 on the mocked message-actions fixture, with a round
video the spec records in a canvas. The instrument is `elementFromPoint`, which
names the box the engine actually painted on top — the same one rule 12 used
when the chat header turned out not to exist on WebKit. Scrolled half under the
header stack, twelve probe points inside that stack returned the circle's own
overlay at 1440 and at 390, in both themes; the pinned capsule read «ЗА…» with an
orange circle over the rest of it, and the same happened against the composer
dock from below. That first reproduction was Chromium only — the WebKit clip
problem below was not solved yet — and WebKit is covered by the first mutation
listed further down, where the engine fails the same nine checks.

**Fixed** 2026-09-14 by **dropping the circle's inner z-indexes**, which is the
second of the two options the entry offered. The first — a stacking level for
the chrome stack and the composer dock — was rejected on evidence already in the
repository rather than on taste:

- `ChatWindow.tsx` and rule 12 of `docs/operations/interface-material.md` both
  record that a `z-index` on either chrome box makes it a stacking context and
  clamps every `fixed` overlay hosted in that subtree — this header's phone
  menu, its modals, the composer's camera and video recorder, a bubble's context
  menu. On a phone the header's menu opens exactly where the composer is, so
  whichever of the two boxes lost would have its full-screen dialog covered by
  the other. That is D-062 arriving by another road, and it cost the iPhone its
  only way out of a conversation for a whole stage.
- The product's vocabulary has no level for chrome: 45 the bubble's portalled
  reaction overflow, 60 a docked panel, 70 the support window, 80 the update
  banner, 90 the media viewer, 95 a modal, 100 the ban screen. A chrome level
  would also have to be argued against `PinnedMessage`'s own `z-30` dropdown and
  `ChatHeader`'s `z-40`/`z-50` menu, which live **inside** the chrome and would
  be re-based inside the new context — three more numbers to defend for one
  circle.
- The two numbers bought nothing that tree order does not already give. All
  three of the circle's children are positioned — the ring `absolute`, the
  playback button `relative`, the corner button `absolute` — inside a wrapper at
  `z-index: auto`, so the engine paints them in markup order: ring under the
  video, corner button over it. Removing `z-10` and `z-20` is a deletion, and
  the layering is unchanged.

`lib/conversationStacking.ts` is the rule, with the two class strings the
component now imports, so the markup and the rule cannot drift. It states the
half nobody had written down: while the chrome sits at `auto`, **any** positive
z-index inside the scrolling list beats all of it, so content that scrolls
carries none and a surface that must stand above the chrome leaves the list
first — which is what the reaction overflow, the menus and the viewer already do.

Option C of the chat screen (`design/chat-chrome-c`) needed no separate check:
it is the shipping chrome, and it is what the frames above photograph.

**Regression tests:** `tests/unit/conversation-stacking.test.mts` (7, including a
source scan of `RoundVideoMessage` that blanks comments first — rule 9, and the
note explaining the fix turned the scan red on its first run) and
`tests/e2e/round-video-stacking.spec.ts` (3 × 1440, 390, 360 and WebKit 390).
Six mutations, each red: `z-10` back on the playback button (9 e2e runs red,
WebKit among them, and the corner button stops being reachable — the two numbers
only ever worked as a pair); `z-20` back on the corner button; the parser
ignoring variants; the raise check allowing a negative level; the corner button
made `static`.

**Not covered:** the frames on `webkit-mobile-390` are a black circle rather
than a clip. Playwright's WebKit on this workstation decodes neither the VP8
WebM nor an H.264 MP4 that Chromium's MediaRecorder can produce — both answer
`MEDIA_ERR_SRC_NOT_SUPPORTED`, while `canPlayType` says «probably» for each — so
the spec holds the response there instead of letting the source error into the
bubble's «Не удалось загрузить видео» panel. The boxes hit-tested are the same
ones a decoded clip gives, and the mutation above proves that engine sees the
defect too. `media-viewer-actions.spec.ts` has the same WebKit limitation today
and fails there for the same reason; that is not this entry's to fix.

## D-130 `[x]` A held recording cannot be cancelled, and releasing parks it in the tray instead of sending

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

## D-131 `[x]` «Местоположение» sends exact coordinates on one tap, with no map and no confirmation — closed by D-122's attach sheet

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

**Closed on 2026-09-14, and it was fixed two days earlier under another number.**
`faa32bc` — the attach-sheet merge, filed as D-122 — replaced the one-tap item
with `AttachLocationPanel`. The place is shown first, and the only thing that
sends is one row reading «Отправить геопозицию» over «С точностью до N м»; it is
disabled until a position has actually been read, says «Определяем…» while it is
being read and «Не удалось определить» with a «Повторить» when it cannot be.
`tests/e2e/attach-sheet.spec.ts:114` pins the accuracy in the subtitle. Verified
by reading the shipped component, not by trusting the commit message.

The map itself is still not there, and that half is the owner's to answer — the
provider is question 7 of the owner summary. What the entry was raised for, a
tap that sent an exact position with nothing shown and nothing asked, is gone.

## D-132 `[x]` Errors and unavailable features show server, database and build internals

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

**Administration half fixed 2026-09-14; the other six surfaces closed the same
day, and the entry closes with them.**

- `LocationsTab.tsx` (A-31) — «Локации требуют обновления базы данных» became
  «Локации сейчас недоступны. Попробуйте позже.», with one line about what still
  works. The retry button said «Проверить обновление базы»; it says «Проверить
  ещё раз».
- `InvitesTab.tsx` with `lib/registrationInvite.ts` (A-34) — the two constants
  that named `20260622_registration_invite_codes.sql` and
  `20260622_registration_invite_mode_settings.sql` are now «Приглашения временно
  недоступны» and «Режим регистрации временно недоступен». The second is the one
  that mattered most and the entry did not say so: it is what
  `mapRegistrationInviteError` answers for `invite_not_configured`, which the
  **public registration form** shows — a stranger trying to create an account was
  being handed the name of a migration file in this project. The file names are
  kept in a comment in `registrationInvite.ts`, where the person who can act on
  them reads them.
- `RolesPermissionsTab.tsx` (A-47) — the panel no longer names the migration or
  the legacy role keys the product falls back to.
- `OpsReportTab.tsx` (A-54) — the callout named `admin_ops_security_report` and
  the path of the SQL file to apply by hand; it now says «Живые метрики сейчас
  недоступны». Two more sentences on the same tab said the same thing about the
  invite metrics and the registration-mode status, and went with it.

Three more instances in the same tabs, not named by this entry but the same
sentence in files this change already had open:
`UsersTab.tsx` — the location filter note and the admin-profile failure;
`RolesPermissionsTab.tsx` — «После применения migration её можно удалить
полностью» under an unused role.

**The mappers were not changed, and that is deliberate.**
`mapRolesPermissionsError` and `mapLocationRoutingError` live in modules other
tracks own — the same sentinels are compared against inside hooks, and T-F7 is a
separate fix — so the administration screens refuse their answer instead of
rewriting them: `plainAdminMessage` in `lib/adminPrompts.ts` replaces anything
carrying an internal with the section's plain sentence and the original goes to
`console.error`. It is a pattern rather than a list of the exact strings removed,
so a mapper that learns a new internal tomorrow is caught by the same call; and
it passes through everything a person can act on, because replacing «Недостаточно
прав» with «недоступно» would lose the one failure an administrator can fix.

`tests/unit/admin-prompts.test.mts` pins every sentence against that pattern,
pins the filter in both directions, and scans the five tabs for string literals
naming a migration, a table or a `.sql` file. Two Playwright specs asserted the
old text and were corrected rather than relaxed: `admin-ops-report.spec.ts` used
to require that the callout **contain** `admin_ops_security_report` and now
requires that it does not, and `roles-visibility.spec.ts` matched the old invites
sentence.

**The other six surfaces fixed 2026-09-14, on the administration's pattern rather
than a second one.** `ADMIN_INTERNALS_PATTERN` and `plainAdminMessage` moved to
`lib/plainMessages.ts`, which imports nothing; `adminPrompts.ts` now aliases them,
the expression is byte-identical, and `tests/unit/admin-prompts.test.mts` passes
unedited. The unit test asserts *identity*, not equality — two regular expressions
that merely look alike are exactly the drift the move was for.

- **Starting a chat** (A3) — «Not logged in» is «Сессия не найдена. Войдите снова.»,
  the mapper's answer is filtered, and `JSON.stringify(err)` is gone from the screen
  entirely. `plainFailure` is `plainMessage` plus one thing: when `mapPgError`
  recognised nothing it answers «…выполнить операцию», and a surface that knows it
  was opening a chat can say so. The administration deliberately keeps the old
  behaviour there, which is why this is a second function and not a change to the
  first.
- **Saving a никнейм** (B5, C4) — `profileSaveFailure` in `profileValidation.ts`
  refuses «Такая запись уже существует.» for a 23505 the save can attribute, and
  returns the field along with the sentence, so «Это имя пользователя уже занято.»
  lands under the никнейм instead of in the banner under the header. The claim is
  narrowed twice: the save must have sent a никнейм, and where Postgres named a
  column or a constraint it must be that one.

  **C4 asked for it to be caught where it is typed, and it now is — both halves.**
  `validateUsername` was only ever consulted inside `handleSave`; it runs as the
  field is typed now, so length, the allowed characters and the reserved list answer
  immediately.

  **Taken-ness answers too, and the first pass was wrong to say it could not.**
  That pass declined it on this reasoning: «`profiles` carries the restrictive
  policy «block banned reads (self only on profiles)», so a name held by a banned
  account is invisible to everybody else, the probe would report it free, and the
  save would fail anyway.» Read again on production on 2026-09-14, that policy is
  `(NOT is_banned(uid())) OR (id = uid())` — it restricts what a **banned caller**
  may read, not the visibility of a banned account's row. An ordinary caller reads
  every profile, so the lookup answers correctly. The wrong reading is left here on
  purpose: a justification for not doing something is exactly the kind of claim
  that is never checked again.

  A debounced lookup now says «Проверяем…», «Свободно» or «Это имя пользователя
  уже занято» under the input. Nothing is asked about the name you already hold,
  about a name that breaks its own rules, or about an empty field; an answer is
  attached to the value it was asked about, so `an`, `ann`, `anna` cannot leave
  `anna` wearing the verdict on `ann`; and a refused or failed lookup says nothing
  at all, because an empty result means "I do not know" and must not read as
  «Свободно». Case is not folded, because `profiles_username_key` is
  `btree(username)` on plain `text` — measured, not assumed, and worth knowing on
  its own: «Olga» and «olga» really are two different никнеймы in this product.
- **Phone** (D5) — «Сервис доставки кода не настроен. Обратитесь к администратору.»
  is «Не удалось отправить код. Попробуйте позже.». It described a deployment state
  to somebody who cannot change one, then sent them to an administrator who cannot
  change it from any screen this product has either.
- **Push** (F2) — the sentence naming `google-services.json`, a migration and
  «backend FCM credentials» is «Push-уведомления на этом устройстве пока
  недоступны.», with no «позже», because an Android build with no delivery
  configuration will not start working by waiting. The VAPID key and the preference
  store lost their names too, in `usePush.ts` and in the settings row's summary
  (`lib/settingsRows.ts`, which the entry did not cite but which printed «Android
  push через Firebase/FCM» in the one line that row has for its value). The
  `PushStatus` values are untouched: only the words were the defect.
- **Search** (P3, O1) — «требует обновления базы данных» is «Поиск по всей истории
  сейчас недоступен.», keeping the half a person can act on: which kinds of thing
  the search still covers. `ChatSearchPanel.tsx` carried the same sentence as
  `ChatSearchBar.tsx` and now shares the constant, so the list column and the chat
  cannot describe one limitation two ways.
- **Tasks** (T-F7) — the two sentinels keep their names, because `useRecurringTasks`
  and `useTaskRouting` compare against them; only the words moved, into
  `plainMessages.ts` where a `node --test` process can read them (both modules reach
  `mapPgError` through the `@/` alias, which nothing outside Vite resolves). The form
  runs the mappers' answers through `plainMessage` rather than rewriting a mapper
  another track owns.

`LOCATION_ROUTING_REQUIRED_MESSAGE` is deliberately the same sentence as
`ADMIN_LOCATIONS_UNAVAILABLE`, and a test pins them equal. While it named the
database, `plainAdminMessage` replaced it on the administration screen; now that it
does not, the filter passes it through — so a different wording here would quietly
have changed that screen too. The mutation that gives the task form its own wording
is red for exactly that reason.

Two instances of the same sentence survive elsewhere in the product. Neither is an
audit row of this entry, and both are in files this change was told not to open:
`hooks/useTaskSoftDelete.ts` («Удаление задач требует обновления базы данных.») and
`lib/groupInvites.ts` through `components/chat/ChatInfoPanel.tsx`, which this file
already records under the group-information audit. A third,
`ROLES_PERMISSIONS_REQUIRED_MESSAGE`, is compared against but never rendered: its
only reader is `RolesPermissionsTab`, which refuses it, while `ProfileRoleSummary`
and `UsersTab` read `available` and never `error`.

Gates: kub typecheck clean, unit 2276/2276, four Playwright tests on the mocked
fixture at 1440 and again at 390. Seven mutations red, among them copying the
pattern back into `adminPrompts.ts`, giving the task form its own wording for the
failure the administration also shows, and dropping the field from the profile
save's answer. Not photographed: the phone row and the push row need a signed-in
production session, so what is proved for those two is the words and the wiring.

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

**Administration and bot halves fixed 2026-09-14, in two separate passes. The
entry stays open: the two settings rows are untouched.**

Every administration action this entry names now asks first, through the
`requestAppConfirm` that `components/AppDialogs.tsx` already renders — no second
dialog was built. Telegram's shape throughout: the title is the question, one
line says what stops working or whom it reaches, the confirming button names the
action, and «Отмена» is the way out.

- `RolesPermissionsTab.tsx` — «Снять» on a global role assignment (A-45), and
  «Сохранить права» (A-44). The second is the one worth reading twice:
  `role_set_permissions` **replaces** the set, so one stray checkbox took access
  away from everybody holding the role, and the button said «Сохранить». The
  question now says «Отмеченный набор полностью заменит текущие права, а не
  дополнит их», with the number of assignments affected — or, when the
  location-role usage read has failed, without a number rather than with a
  guess.
- `BansMutesTab.tsx` — «Снять» asks (A-49), and no longer appears on a row that
  has already expired. The expiry is decided once, in `canLiftSanctionRow`, and
  the list filter now calls it too: written separately, the chip saying «истёк»
  and the button offering to end the restriction could disagree about one row.
- `UsersTab.tsx` — bulk «Назначить роль» and «Назначить локацию» (A-16), in the
  shape «Снять роль» beside them already used. `unban` / `unmute` /
  `liftSanction` were left exactly as D-134 left them.
- `LocationsTab.tsx` — «Архивировать» (A-28) and «Убрать» a member (A-30).
- `InvitesTab.tsx` — the registration-mode switch (A-33) and «Отозвать» (A-38),
  which is also no longer offered on a link whose date has passed. A link at its
  use limit is deliberately still revocable: that is a state this entry does not
  name, and its row reads «Использован», not «Истёк».
- `SupportTab.tsx` — closing intake, or its public half (A-69). The switch only
  edits a draft, so the question hangs off «Сохранить», which is the press that
  reaches people; a save that withdraws nothing asks nothing, or the dialog
  stops being read by the third rate limit.

**The words live in `artifacts/kub/src/lib/adminPrompts.ts`, which imports
nothing.** That is the point: a confirmation written inline in a `.tsx` cannot be
reached by `node --test`, and a rule that cannot be reached from a test is a gap
in the module boundary rather than a gap in the suite. The tone stays two string
values rather than `AppDialogTone`, because importing that type pulls in the icon
vocabulary and then React. `tests/unit/admin-prompts.test.mts` pins the words and
the two predicates directly, and reads the five tabs for the wiring; eleven
mutations turn it red, among them deleting `if (!confirmed) return;` from
«Сохранить права», putting «Снять» back on an expired row, and renaming a confirm
button to «Подтвердить».

**The three bot rows are done as of 2026-09-14** — `BotSettingsPanel.tsx`:
«Убрать» the bot's picture (B-08), «Удалить webhook» (B-12) and removing a
developer (B-15). Each went through `requestAppConfirm` with `tone: "danger"`,
so all three are the same dialog the administration rows now use rather than a
second one grown beside it, and their words live in
`artifacts/kub/src/lib/botSettingsCopy.ts` for the same reason
`adminPrompts.ts` exists.

Three things the entry's shape decided, and worth repeating:

- **The line follows the control above it.** «Удалить webhook» sits under a
  «Удалить ожидающие обновления» checkbox, and the two outcomes differ in the
  thing a person would mind — read off
  `bot_management_webhook_delete_internal`, unacknowledged `bot_updates` are
  deleted only when `p_drop_pending_updates` is true. So the question says
  «Обновления останутся в очереди…» or «…будут удалены без доставки» depending
  on the box, rather than one sentence that is half wrong either way.
- **The one that reaches somebody else names them.** Removing a developer prints
  the person's name and what *they* lose, not what the owner is doing; a
  developer the server named with nothing printable becomes «Разработчик» rather
  than a gap.
- **Reversible is still worth asking about.** «Убрать» the picture can be undone
  by another upload, and it sat one tap from «Заменить картинку», which is
  exactly how it was reached by accident. The line says where the bot changes
  and that the picture can be loaded again.

`tests/unit/bot-settings-copy.test.mts` pins the words; the three questions and
both «Отмена» paths are proved on the screen in `tests/e2e/bot-management.spec.ts`
at 1440 and 390. Three of the pass's eight mutations belong to these rows and
turn that pair red: deleting the `requestAppConfirm` guard from the developer
row, renaming a confirm button to «Подтвердить», and making the webhook question
stop reading the checkbox above it. The other five are under D-145.

Still open, and in neither this pass nor the administration one:
`components/sidebar/SettingsModal.tsx` — «Удалить фото» (settings-profile C2);
`components/sidebar/PhoneSection.tsx` — «Удалить» a verified number
(settings-profile D4). Both are settings surfaces, owned elsewhere. A-18 in
`UsersTab.tsx` was closed earlier by D-134.

## D-134 `[x]` Lifting a ban or a mute deletes the person's whole sanction history

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

**Fixed 2026-09-14, and the two open questions answered by looking at
production rather than by reasoning.**

*Does the action log keep a trace?* **Yes.** `public.bans` and `public.mutes`
each carry an after-insert and an after-delete trigger
(`_audit_bans_after_insert`, `_audit_bans_after_delete`, and the two for mutes),
so both issuing and lifting already reach `audit_logs`; four `ban_issued` /
`ban_lifted` rows are there. The history the delete destroyed was the sanctions
list itself, which is what «История санкций» shows and what somebody deciding a
second sanction reads.

*Does «Снять» in «Блокировки» (A-49) delete history too?* **No.** It deletes by
`id`, so it has always ended one restriction and left the rest.

The fix is in `UsersTab`: both menu items now go through `liftSanction`, which
asks first — «Действующая блокировка … будет снята сразу. Истёкшие блокировки
останутся в истории санкций.», so the question states both halves — and then
deletes only rows matching `activeSanctionFilter(now)`.

**The predicate moved to `artifacts/kub/src/lib/sanctions.ts` because two places
need it.** The query that decides whether «Снять блокировку» appears at all
already used exactly this filter inline; the delete used none. Had they been
written separately they could drift, and a button shown for a restriction the
delete does not match is a button that does nothing while looking like it
worked. One definition, both callers, and the instant is an argument so a single
interaction can give the read and the delete the same one.

**No migration.** Ending rather than deleting — `expires_at = now()` — would
keep even the lifted row, but `bans` and `mutes` have no UPDATE policy at all
(the grant exists, the policy does not, so RLS refuses every UPDATE), and that
is a database change with its own rehearsal. Deleting only what is in force
keeps every expired row and the audit trail, which is what this entry asked for.
Production holds 0 bans and 0 mutes today, so nothing was at risk while this
stood open.

`tests/unit/sanctions.test.mts` pins it; four mutations turn it red — dropping
the null branch (which would make every permanent ban unliftable), moving the
boundary at exactly `now`, reading an unparsable date as expired, and collapsing
the two questions into one.

Still to do from this entry's family: D-133 covers the rest of the one-tap
destructive actions.

## D-135 `[x]` Sign-out ends the session on one tap

**Severity:** medium. Found by the settings audit from the code; not rendered, because
signing out would have ended the fixture session.

**Surface, corrected 2026-09-13:** *two* menus, not one. The phone's avatar menu in
`artifacts/kub/src/components/sidebar/SidebarHeader.tsx:152-165` — which is `md:hidden` and
does not exist on a computer at all — and the computer's side list in
`artifacts/kub/src/components/sidebar/SideMenuLayer.tsx:105-118`, which carries the same
row. Both call `auth.signOut()` through `useSignOut()` in
`artifacts/kub/src/hooks/useUser.ts:13`. This entry named only the first, so a fix
written from it would have left every computer unprotected. The menu is in frames
`settings-profile-frame-p02.png` and `settings-profile-frame-d01.png`.

**Defect:** «Выйти», the last item of the menu that opens from a person's own avatar,
signs out immediately.

**Proposed:** «Выйти» at the end of Настройки, always followed by «Вы действительно хотите
выйти?» (Telegram Desktop's `lng_sure_logout`; iOS and Android confirm as well; audit
sources [Desk-main], [TR], [iOS-logout], [And-logout]).

**Audit rows:** settings-profile A5; top-10 item 7.

**Fixed** 2026-09-13. Both menus ask first, through `requestAppConfirm`, and both ask
the same question: `artifacts/kub/src/lib/signOutConfirm.ts` holds it as data, because
a confirmation worded one way on a phone and another way on a computer reads as two
different actions. The menu closes before the question is raised — the side list has
its own Escape handler on the window, and one press would otherwise dismiss the dialog
and the layer together.

**What the question says, and why it is not what this entry proposed.** The wording
proposed here was «Вы действительно хотите выйти?», Telegram Desktop's `lng_sure_logout`.
Measured at 390: `KubModal` truncates its title to one line, and beside the icon and the
✕ that sentence rendered as «Вы действительно хотите в…». A question cut off mid-word
asks nothing, so the title is «Выйти из аккаунта?» — still a question, still naming what
is being left, 18 characters instead of 30. The consequence a person actually needs goes
in the body: «Сеанс @maks на этом устройстве завершится. Чтобы вернуться, нужно будет
войти снова.»

The никнейм is printed and a name never is. On a shared device two people can both be
«Максим» and only one can be `@maks`; and «Сеанс @maks завершится» needs no declension,
while the same sentence with a name in the nominative is not Russian. Where there is no
никнейм the clause is dropped rather than filled, because the menu the question was
raised from has the person's name and picture at its top either way.

**What this did not do:** move the row. The proposal also put «Выйти» at the foot of
«Настройки», which is where Telegram keeps it; here it stays the last row of each
account menu, where the audit found it. That is a placement decision about a screen
which has had two forms since D-160, and it belongs with the settings parity work — the
one-tap defect this entry records is closed either way, and the placement is not being
dropped quietly.

**Tests:** `tests/unit/sign-out-confirm.test.mts` pins the wording, the tone, the icon
and the handle rule; six mutations red, one control green.
`tests/e2e/settings-exit-confirmations.spec.ts` proves both menus on their own shells —
the side list at 1440, the avatar menu at 390 — that «Отмена» leaves the session alone,
that «Выйти» really ends it, and that the confirming button is what `elementFromPoint`
answers at its own centre. Frames: `output/settings-defects/sign-out-{light,dark}-*.png`.

## D-136 `[x]` Closing settings throws away a typed name, username or bio without asking

**Severity:** medium. Found by the settings audit from the code; the footer is in every
settings frame.

**Surface, corrected 2026-09-13:** that describes the screen as it was before D-160,
when a dialog was its only form. The screen is `useSettingsScreen` in
`artifacts/kub/src/components/settings/SettingsScreen.tsx` now, and it has **two** forms
with doors of their own: the list column's panel from `md`
(`artifacts/kub/src/components/settings/SettingsPanel.tsx` — the ✕ at `:69`, and a
second Escape in the search field at `:96`), and below `md` the full-screen sheet
(`artifacts/kub/src/components/sidebar/SettingsModal.tsx` — its footer «Закрыть», plus
`KubModal`'s ✕, Escape and backdrop, which are one `onClose`). Five doors between them.
The three fields are held back by `handleSave` at `SettingsScreen.tsx:151`.

**Defect:** «Сохранить» saves only «Имя», «Никнейм» and «О себе»; every other control on
the same screen saves at once. ✕, «Закрыть», Escape and a click on the backdrop all close
the window and drop unsaved text without a word, so a person who flipped a switch and then
typed a bio can reasonably believe both were kept.

**Proposed:** Telegram's model: switches apply at once, and profile text is edited on its
own «Изменить профиль» screen with «Готово» and «Отмена». Until that screen exists,
closing with unsaved text asks whether to discard it.

**Audit rows:** settings-profile B4; top-10 items 1 and 5.

**Fixed** 2026-09-13, by the second half of what this entry proposed: a separate
«Изменить профиль» screen is not built, and until it is, leaving with unsaved text asks.
Every door of both forms goes through one `requestClose` on the screen itself rather
than through each container's own `onClose` — the defect is the screen's, and a guard
written into the dialog would have left the column exactly as it was.

**What is at risk is exactly three fields**, established from the code rather than
assumed: «Имя», «Никнейм» and «О себе» are what `handleSave` writes. Everything else on
the screen — тема, «Статус «в сети»», the three push categories, the microphone,
«Оформление» — writes as it is flipped, and the phone number has its own verified flow.
That asymmetry is the other half of the defect, so the question says it: «Имя, никнейм и
«О себе» останутся прежними. Остальные настройки уже сохранены.»

**The rule is shared, not copied.** `chatProfileDirty` (D-164) and the profile's
`profileDraftDirty` are both calls into `artifacts/kub/src/lib/unsavedEdits.ts`. It
compares **what the save would write**, not what is on screen: each field carries the
normaliser its own save uses, so a name retyped with a double space, a никнейм typed
with «@», or a trailing space are not changes and raise nothing. Normalising only the
edited side — the obvious way to write it — asks about changes the save itself would
erase, and that mutation is one of the four the unit test refuses.

A question that is always asked is one people learn to dismiss, so nothing typed means
nothing asked and the screen closes as it always did.

**Tests:** `tests/unit/unsaved-edits.test.mts` (four mutations red, one control green)
and `tests/e2e/settings-exit-confirmations.spec.ts`, which walks every door each shell
offers in turn, answers «Продолжить», and requires the text to still be in hand for the
next one. Frames: `output/settings-defects/discard-{light,dark}-*.png`.

**Found while wiring it:** D-181 and D-182, below. Two of those five doors are key
presses, and a dialog raised from a key press was being dismissed by that same press;
and on a computer the settings screen can be taken off the column by something that is
not a door at all.

**One door that turned out not to exist**, measured rather than assumed: below `md` the
bottom navigation cannot be reached while the sheet is open — the sheet is a full-screen
`KubModal` and its own footer intercepts the press — so switching from «Профиль» to
«Чаты» is not a way out of a screen with text in it. The same measurement says a
backdrop click is unreachable there too, the panel covering the overlay edge to edge;
below `md` the doors are three, not four.

## D-137 `[x]` Notification category switches look on and do nothing until device push is enabled

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

**Fixed on 2026-09-14, and the box was worse than «a dark 44px square» reads.**
Photographed on the settings screen at 390 in the dark theme: each of the three
switches sat inside a hard near-black rectangle while «Статус «в сети»» two
groups below — the same component, enabled — had none. The paint was on the
**button**, which `.kub-switch` sizes to the 44px a finger needs; the button is
a hit area, not a surface, and painting it draws a box around a switch that is
24 tall.

Both halves are done, and they are the two the entry proposed.

*The categories are settable.* `disabled={loadingPreferences || pushStatus !== "active"}`
became `disabled={loadingPreferences}` on all three. They are stored preferences
in `notification_preferences`, `_notification_push_allowed` reads them whenever a
push is made, and the row directly above already says the permission is missing —
so nothing here has to repeat it. Telegram lets the categories be set the same
way for the same reason.

*The disabled look moved from the box to the switch.* The inset and the sink
veil are now on the track, with the thumb losing its brightness and keeping its
position — the stored value is still worth reading while the switch is
unavailable. **Deliberately not `disabled:opacity-*`**: `control-vocabulary.test.mjs`
refuses a faded disabled control by name, and it is right to — fading says
«loading» where the inset says «not yours to press».

Five mutations turn `tests/unit/switch-disabled-state.test.mts` red, including
restoring the box, removing the track's inset, fading instead, and gating a
category on the device permission again.

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

**Verified against the shipped code on 2026-09-15 and still open — three of its
four complaints stand, the fourth is overstated.** Left for its own batch: the
fix is a redesign of the code step on a different surface from the administration
work this batch covers, and it needs its own frames.

Standing, read off `PhoneSection.tsx`:

- `placeholder="1234"` is still on the code field, still exactly as long as a
  real code.
- The badge is `{storedPhone && (verified ? «Подтверждён» : «Не подтверждён»)}`
  with no reference to `stage` or to `dirty`. While a different number is being
  entered, «Подтверждён» is on screen, and the line that would have said which
  number it refers to — «Сохранённый номер: …» — is hidden precisely then, by
  `{storedPhone && !dirty && …}`. So the badge floats free and reads as a claim
  about the number in the field.
- «Удалить» is `{storedPhone && …}` and sits in the same flex row as
  «Подтвердить», «Отмена» and the resend button, during the code step.

Overstated: «whether a code went in» *is* said — `sendCode` sets «Код отправлен
на номер +7…». What is true is narrower and still worth fixing: `verifyCode`
calls `reset()` first, so a wrong code replaces that line with an error and the
number the code went to is gone from the screen.

One thing to settle before building the proposal's four digit cells with
auto-submit: the gateway limits attempts, so an auto-submitted typo spends one.
Telegram's behaviour is the proposal; the cost of it here has not been measured.

## D-139 `[x]` A location found in search, and a ban notification, lead to a refusal or a bounce

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

**Fixed 2026-09-15. Both halves were real, and the first one was worse than the
entry knew.**

*The location result.* `public.locations` carries one read policy, measured
read-only on production that day:

    is_admin(auth.uid())
    or exists (select 1 from location_members lm
                where lm.location_id = locations.id and lm.user_id = auth.uid())

— so every member of a location finds their own location by name, and the rows
really are offered outside the administration. The entry describes the refusal an
ordinary account got. It does not describe what a **manager** got, which is
worse: the gate in `SearchShared` was `isStaff`, and `/admin/locations` is mounted
behind `isAdmin` (`AdminLayout`, the `adminOnly` tab flag and the route's own
`{isAdmin ? <LocationsTab /> : <Redirect to="/admin" />}`). A manager is `isStaff`
and not `isAdmin`, so the press navigated, redirected to the dashboard, and said
nothing at all.

The rule is therefore a copy of the *route's* gate rather than of a neighbouring
idea of «staff» — the same lesson `lib/serverRoleAccess.ts` records for the RLS
predicates, one layer up. `lib/searchResultAccess.ts` carries it, and the row is
dropped where the list is assembled rather than only refused where it is pressed:
a row nobody can open should not be taking up a place and a keyboard stop.
`activateResult` keeps the same check as the second half, so a list built before
the role read finished cannot act for a frame.

The proposal's other suggestion — open the location's own page instead — is D-123,
still open and measured on 2026-09-15 to have nothing to call. Until it exists,
the honest answer is not to offer a row that leads nowhere.

*The ban notice.* `ban_issued` opened `/admin`, which its recipient cannot reach.
And it is not a near miss for a staff member either: measured on production,
`public._notify_bans_after_insert` posts the notice to `new.user_id` and to
nobody else, so the only person who ever receives one is the banned person. Two
such rows exist today.

The server had already decided this. Its push payload builds a `url` for
`chat_added`, `mute_issued` and the task kinds, and for `ban_issued` leaves it
null — «Вы заблокированы» is the whole message, and the person is already looking
at the «Вы заблокированы» overlay. The client had invented a destination the
server never claimed. `sanctionNoticeTarget` in `lib/sanctions.ts` now answers for
both sanction kinds: a mute keeps the chat it was issued in, a ban leads nowhere,
and neither leads somewhere arbitrary when the payload has no chat. The
`{ kind: "admin" }` target and its handler are deleted rather than left unused.

**Proof.** Seven mutations turn `tests/unit/search-result-access.test.mts` and
`tests/unit/sanctions.test.mts` red: gating the row on `isStaff` as it shipped (3
failures), acting while the roles are being read (1), drawing the row and refusing
it on the press (1), and letting a ban notice lead into the administration again
(1). Each file restored byte-identically, verified by SHA-256, and green
afterwards.

**Not verified in a browser.** Both halves are pinned as rules and wired, and
neither is photographed: reaching the location row needs a signed-in account that
is a member of a location and not an administrator, and reaching the ban notice
needs an account that is banned. This track does not photograph production
screens, and no fixture for either exists yet. What is proved is the rule and the
wiring, not the rendered pixels.

## D-140 `[x]` In «Блокировки» a failed load reads as "no bans", and every realtime reload blanks the tab

**Severity:** medium, for moderation: an administrator can conclude that nobody is
restricted. Found by the work-surfaces audit from the code.

**Surface:** `artifacts/kub/src/pages/admin/BansMutesTab.tsx:50-113, 64-68, 219-222`.

**Defect:** a failed fetch renders the empty states «Активных банов нет» and «История
санкций пока пуста», and every realtime reload replaces the whole tab with a spinner.

**Proposed:** keep the content during reloads, and show a real error state with
«Повторить».

**Audit rows:** work-surfaces A-50.

**Fixed 2026-09-14.** The tab now reads `error` as well as `data`, and the
decision moved out of the component into `artifacts/kub/src/lib/listReadState.ts`
so a test can reach it: `listReadView({ loading, error, loadedOnce })` answers one
of four, not two. «Не загрузилось» and «ничего нет» are different screens, and
«загружено, но последнее чтение не прошло» is a third — the rows stay, with
«Список мог устареть: …» and «Повторить» above them, because rows older than the
database are still true and blanking them would put something false on screen.
`readReplacesScreen` is the other half: a realtime notification re-reads in the
background and leaves the tab alone; only the first read and a pressed
«Повторить» show the spinner.

`tests/unit/list-read-state.test.mts` pins all four answers. Three mutations turn
it red: dropping the error branch (2), swapping «stale» and «unavailable» (2),
and letting every read blank the screen (1).

Not verified in a browser: the administration screens need a signed-in
production session, and this track does not photograph those. What is proved is
the rule and the wiring, not the rendered pixels.

## D-141 `[x]` The users search invites «@username», and a leading «@» finds nobody

**Severity:** low. Found by the work-surfaces audit from the code.

**Surface:** `artifacts/kub/src/pages/admin/UsersTab.tsx:562-578, 104-130, 266-281`.

**Defect:** the placeholder «Поиск по имени, @никнейму или ID» suggests typing «@olga»,
but the «@» is never stripped, so that query matches nobody. Queries also match raw IDs.

**Proposed:** strip a leading «@», and make the placeholder «Имя или @имя пользователя».

**Audit rows:** work-surfaces A-13.

**Fixed 2026-09-14**, with one deliberate departure from the proposal above.

The «@» is stripped in `artifacts/kub/src/lib/adminUserSearch.ts` — every leading
one, because «@@olga» is a typo and not a different person — and a «@» inside a
name is kept, because that is a character in the name. The same module decides
what is an id and escapes the characters PostgREST would otherwise read rather
than match: `,` ends a filter inside `or=(…)`, `(` and `)` delimit it, and `%`
and `*` are both `ilike` wildcards, so somebody typing one of those meant the
character.

**The placeholder is «Имя, @никнейм или ID», not the proposed «Имя или @имя
пользователя».** The proposal dropped «ID» because the field's three claims were
not all true; stripping the «@» makes all three true, and removing a working
capability from the label would hide it rather than fix it.

`tests/unit/admin-user-search.test.mts` pins it. Three mutations turn it red:
dropping the strip (4 failures), dropping the name filters (1), and narrowing
the escaped set to `%` alone (2). A fourth mutation — removing the "nothing
typed" early return — stayed green, and the answer was to delete that line
rather than write a test that pretends to reach it: both branches below it
already decline, so it was a guard no test could turn red.

## D-142 `[x]` Administration forms offer what they then refuse, and drop what was entered

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

**Fixed 2026-09-15**, and the entry's own account of the server was wrong on the
part that mattered most.

*A-37, and the measurement that changed the fix.* The entry says «Критические
роли может выдавать только тех. администратор», which is also the sentence the
screen has been showing on the refusal. `public.registration_invite_create`,
read off production read-only that day, says something else:

    if v_global_role.key in ('owner', 'tech_admin')
       and not public.has_permission(auth.uid(), 'system.manage') then
      raise exception 'invite_critical_role_forbidden' using errcode = '42501';

A **permission**, not a role. `public.has_permission` (read the same day) admits
`owner` and `tech_admin` unconditionally, **and** anybody holding a global role
whose `role_permissions` carry the key, **and** the legacy `profiles.role`
column through `_legacy_role_has_permission`. A gate built from the entry's
sentence would have hidden the two roles from a global «Администратор» granted
`system.manage`, whom the database accepts. The rule, the function body and this
reasoning are in `artifacts/kub/src/lib/inviteRoleGrants.ts`; the screen already
asked for exactly that permission for the switch above the form, so nothing new
is fetched. The refusal message now names the permission as the catalogue names
it, and so does the note under the select: «Роли «Владелец» и «Тех.
администратор» может выдать только тот, кому разрешено «Менять технические
настройки».» Nothing critical is offered while the permission read is in flight,
and a role withheld while the form is open is cleared from the select rather
than left selected.

*One more of the same defect, found while fixing this one and fixed with it.*
The note under the registration switch read «…с правом «Управление системой»».
No such right exists under that name: `PERMISSION_LABEL` calls it «Менять
технические настройки», and `rolePermissions.ts` records that the old
noun-phrase labels were replaced deliberately. An administrator looking that
name up in «Роли и права» would not find it. Exactly D-144's A-63, one screen
over.

*A-36, and why «Автоматически» was removed rather than repaired.* The effect
listed `locationRoleId` among its own dependencies and refilled every empty
value, so the option snapped back the instant it was chosen. But the option
never named a different outcome: `registration_invite_create` resolves an absent
`p_location_role_id` to `location_staff` itself — the same role the preselect was
already showing. What it did cost was «Основной администратор», which is enabled
only while the chosen role is `location_staff`: with the empty value chosen, the
screen also stopped sending `p_primary_admin_id`, although the server under that
same branch calls `_location_assert_admin_member` and would have accepted one.
An option that changes nothing, cannot be kept and switches off a working field
is not a choice. The decision moved to `resolveLocationRoleId`, so it cannot go
back to fighting a deliberate one.

Removing it opened a small hole that had to be closed with it: with the roles
feature unavailable, `locationRoles` is empty and the select would have rendered
with no options at all, which reads as broken. It now carries one disabled
option, «По умолчанию — сотрудник локации», which is what the function does.

*A-29.* `assignMember` cleared its three selects after `runAction` whatever came
back. `createLocation`, twenty lines above it in the same file, already kept its
fields on a failure; this is that rule, not a new one.

**Proof.** Five mutations turn `tests/unit/invite-role-grants.test.mts` red:
offering the critical roles to everybody (4 failures), taking the register at
its word and gating on `tech_admin` alone (4), offering them while the
permission read is in flight (1), the old refill behaviour (1), and taking the
first location role instead of `location_staff` (1). Five more turn the browser
tests red — `tests/e2e/admin-invite-form-rules.spec.ts` and
`tests/e2e/admin-location-assignment.spec.ts` — including putting
«Автоматически» back, leaving the select empty when there are no location roles,
and clearing the assignment form whatever the server said. Each file restored
byte-identically, verified by SHA-256, and green again afterwards.

**One mutation stayed green, and it is recorded rather than papered over.**
Restoring the *old effect* — `if (locationRoleId) return;` with the value among
its own dependencies — leaves every test passing, because with «Автоматически»
gone the empty value is unreachable from the interface. The load-bearing half is
the option's removal, which is red. The effect rewrite is defence, and the one
input that would tell the two apart — a location role archived while the form is
open — cannot be produced through this fixture, so it is untested by anything but
the unit test on the rule itself.

**Frames** (fictional data, mocked backend, no production screen):
`output/admin-invites/withheld-roles-{dark,light}-chromium-{desktop-1440,mobile-390}.png`
and `output/admin-locations/refused-assignment-{dark,light}-chromium-{desktop-1440,mobile-390}.png`.
The note's grammar was fixed from the frame rather than from a test: it first
read «"Владелец" и "Тех. администратор" может выдать…», where the roles parse as
the subject.

## D-143 `[~]` On a phone the support workspace can leave the screen and the address disagreeing, and a failed ticket load has no way back

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

**Two of the three halves fixed 2026-09-15; the stacked headers are not, and the
entry stays open for them.**

*The address.* The back arrow the proposal asks for already existed — `md:hidden`
in the ticket's own header, «Назад к очереди» — so what was left was the part the
entry marked «inferred, not reproduced». It reproduces. `selectedTicketId` was
state seeded once from `window.location.search` by a `useState` initialiser, and
nothing read the address again, so a browser or Android back press moved the URL
and left the ticket on screen. The address is the only copy now:
`useSearch()` from wouter 3.9 subscribes to `location.search`, which
`useLocation` does not — it reports the path. `selectTicket` and `closeDetails`
are navigations and nothing else.

Whatever belonged to the ticket that was open is now dropped when the open ticket
changes, by any of the three routes rather than only the two that went through
the component. The candidate list matters most of the three: it is another
person's name, telephone and address, looked up for one ticket, and a back press
used to carry it to the next.

That rearrangement paid for a wart it did not create. The reopen path lands on a
*different* ticket, and its receipt — «Обращение снова открыто.» — was written and
then wiped in the same tick by the navigation that followed, so nobody had ever
seen it. It survives the move it caused now.

*The failed load.* `loadDetails` failing left `details` null, and the pane fell
through to «Выберите обращение» — an invitation to choose, after a choice had
been made and failed. On a phone the queue is hidden the moment a ticket is
selected, so there was nothing on the screen to press. There is now a real
failure state with «Повторить» and «Назад к очереди».

*Still open:* five header bands above an open ticket on a phone. Measured on the
390 frame below: the administration's title row, its tab strip, the «Поддержка»
row, the notice band and the ticket's own header. The proposal's answer —
`/admin/support/:ticket` as a genuinely pushed page — is a routing change with
its own contracts and is not this batch.

**Proof.** Two mutations turn `tests/e2e/support-workspace-rules.spec.ts` red:
reading the address once at mount (1 failure — back leaves the ticket on screen
with the URL changed), and letting a failed load fall back to «Выберите
обращение» (1). Both restored byte-identically, verified by SHA-256, and green
again afterwards. The forward button is asserted as well as the back one,
because a rule read in one direction is half a rule.

**Frames:** `output/support-workspace/unavailable-{dark,light}-chromium-{desktop-1440,mobile-390}.png`.
Fictional data, mocked backend, injected session; no production screen was
opened.

## D-144 `[x]` Support ticket actions hide their rules and misstate the ticket

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

**Fixed 2026-09-15, and a sixth defect came out of measuring the fifth.**

Every bound was read off the function the press actually calls rather than
copied from the component, and that is how this turned up: the editor's textarea
carried `maxLength={4_000}` for all five actions, and only two of the five
functions accept that much.

    support_ticket_transfer        length(v_comment) not between 3 and 1000
    support_ticket_return_to_pool  length(v_reason)  not between 3 and 1000
    support_ticket_escalate        length(v_reason)  not between 3 and 1000
    support_ticket_resolve         length(v_summary) not between 3 and 4000
    support_ticket_close           length(v_summary) not between 3 and 4000

So 1500 characters of reason for a transfer could be typed in full and came back
as `invalid_support_transfer`. Not in the entry; it exists because one number was
written once for a screen that calls five different functions. The ceiling is per
action now.

*A-65.* The minimum was right and silent. Both bounds are on screen before
anything is typed — «От 3 до 1000 символов. Текст попадёт в историю обращения.» —
and «Подтвердить» carries the reason it cannot be pressed, in the order the
editor is filled: the colleague first, because the select is above the text.

*A-69.* Checked against `support_settings_update_v2` on production before being
copied, and the predicate turned out to be **right**: closed message 3..500,
tickets 1..50 and 1..500 with the day not below the quarter-hour, messages 1..200
and 1..5000 with the same relation. Silence was the whole defect. Worth recording
that the older `support_settings_update`, still present on the deployment, takes
no message limits at all — a mirror built from that one would have refused two
fields the product really does save. The client calls the `_v2`, which is why the
function was read by the name in `operatorApi.ts` rather than by the obvious one.
One extra branch was added rather than mirrored: `Number("")` from an emptied
number input is `NaN`, and `NaN < 1` is false, so a bare comparison let it
through to `invalid_support_settings`.

*A-63.* Two booleans answered four situations, so a **closed** ticket — closed by
this very operator, holding every permission — was told «Сначала примите
обращение или откройте назначенное вам обращение». It says it is closed now, with
«Открыть заново» beside it, and spam says spam. The permission is named as the
catalogue names it: «Отвечать в обращениях», not «Ответы поддержки», which exists
nowhere an administrator could look it up.

*A-67 and A-60.* `actor_user_id` was read off every event row all along and never
drawn, on the one surface whose whole point is that it is a record. It now says
«Вы», the colleague's name, «Клиент» for the requester, or nothing at all for a
`ticket_created` from the guest form — a name is not invented for an event nobody
caused. A queue row says «Назначено вам» or «Назначено: Мария Соколова».

The fallback in both is «Назначено оператору» / «Оператор», and it is the
ordinary case rather than an edge: `support_operator_directory` refuses anybody
without `support.transfer` or `support.manage` (production, 2026-09-15), and
`SupportTab` turns that refusal into an empty list — so a plain operator holding
only `support.view` and `support.reply` cannot resolve a colleague's name at all.
That is the one thing the browser test could only reach because the fixture takes
the permission set as an argument; no QA account on this deployment is shaped
like that operator.

The rules are in `artifacts/kub/src/lib/support/operatorRules.ts` — a plain
module with no React, so `node --test` reaches every branch. The same boundary
lesson as `lib/listReadState.ts`: a rule that can only be exercised by mounting a
page is not tested, and moving it is cheaper than building a harness around it.

**Proof.** `tests/unit/support-operator-rules.test.mts` is turned red by eight
mutations: one ceiling for five functions (3 failures), no reason for the
disabled button (3), the closed branch removed (1), the permission under its old
name (2), the settings blocker silenced (2), a bare numeric comparison (1), the
queue row unnamed (2), the history actor unnamed (2). Six more turn
`tests/e2e/support-workspace-rules.spec.ts` red, each for its own named reason.
Every file restored byte-identically, verified by SHA-256, and green afterwards.

One test failure was a finding rather than a harness fault and is kept here
because it would recur: the first version of the blocker built «Опишите
причина» by lower-casing the field's label. `toLocaleLowerCase` is not a
declension, and a sentence assembled by folding case is only right by accident.
The accusative is written out.

**Frames:** `output/support-workspace/{queue-assignees,transfer-editor,closed-ticket,settings-blocker}-{dark,light}-chromium-{desktop-1440,mobile-390}.png`.
Fictional data, mocked backend, injected session; no production screen was
opened.

**Noticed from the frames and deliberately not fixed here:** pressing «Передать»
opens the editor below the fold of its own column, and nothing scrolls it into
view, so on a 1440×900 desktop «Подтвердить» is off screen at the moment it
appears. The frame is taken with it scrolled to. It belongs to its own entry.

## D-145 `[x]` Bot settings save silently, need the secret retyped to save the webhook, and the list ignores the bot's picture

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

**Fixed 2026-09-14.** Three separate things, and the middle one was a decision
rather than a change.

**A save says so, in the product's own confirmation.** Every one of the panel's
actions went through a `run()` that caught failures and did nothing at all on
success — nine buttons that changed the server and told nobody, which leaves
pressing the button again as the only way to find out whether the first press
landed. `run()` now takes the action's name and hands `showActionFeedback` the
line for it: «Сохранено» with what was saved on the second line for the three
save buttons, and what actually happened for the rest, because «Сохранено» after
«Убрать» would confirm the wrong thing. Nothing new was built for this — the
toast queue and `KubFeedbackViewport` were already mounted at the root and
already used by `copyWithFeedback`. The one action that stays silent is a token
rotation: it ends by putting the new token in a dialog shown exactly once, and a
toast over the top of it would cover the only copy.

**A failure is printed inside the box whose button produced it.** One banner
above the tabs carried every error, so a save pressed at the foot of «Webhook»
reported itself at the top of the screen — and, because the banner sat outside
the tabs, an error from «Основное» stayed on the screen while a person read
«API». `Section` takes an `error` now and draws it after its own controls, which
is where the buttons are; the panel keeps one message per section rather than
one for the panel. The e2e test measures the box rather than the wording, because
the defect was a position: the message really did exist before, just nowhere near
the press.

**The stored signing secret cannot be kept, and the field now says so.** This is
the decision the entry asked for, and it was taken by reading the two ends rather
than the panel. The gateway's `PUT /bots/:botId/webhook` parses
`webhookInputSchema`, where `secret` is required on a `.strict()` object, so an
absent secret is `validation_failed` before anything else is looked at; and
`bot_management_webhook_set_internal` raises `bot_webhook_input_invalid` on a
null `p_secret_ciphertext` before reaching an upsert that writes
`secret_ciphertext = excluded.secret_ciphertext` unconditionally. The browser
could not resend it either: the value is sealed with `BOT_WEBHOOK_ENCRYPTION_KEY`,
which only the gateway process holds, and the detail route returns
`webhook: { configured, url }` with no ciphertext in it — so the client has never
had the secret to keep. Keeping it would take a nullable ciphertext parameter and
a branch in that function, which is a production migration with its own
rehearsal, and it would buy an address-only edit at the cost of a function that
can now be called in a way that leaves a webhook's secret unspecified.

So the interface stops pretending the field is optional and explains itself
instead, under the field, in `BOT_WEBHOOK_SECRET_HINT`: the server does not
return the saved secret, so enter it again on every save — *even if only the
address is changing*. That last clause is the half that made this read as a bug:
a person who has only moved the URL sees a filled address, an empty secret and a
dead «Сохранить webhook», with nothing connecting the three.

**The list draws the bot's own picture.** `BotRow` drew `KubIcon name="bot"` for
every bot and never read `avatar_url` — while the settings header one pane to the
right drew the picture, so an owner could see their own upload and its absence at
once. Both now go through `components/bots/BotAvatar.tsx`, a wrapper over
`MessageActorAvatar`, which is what chat already uses for a bot. Two things came
with it that a local `<img>` would not have: a picture that 404s falls back to
the robot instead of leaving an empty square (a bot avatar lives in Storage
behind a policy, so that is a real state), and a bot looks the same in the list,
in its settings and in a conversation. The settings header's bare `<img>` is gone
for the same reason.

**Not fixed, and found while looking at the pixels:** on a computer the
confirmation card overlaps the panel's tab strip. Measured at 1440: the card
occupies y 108–169, the tabs y 147–191, and `document.elementFromPoint` at the
centre of «Диагностика» returns `div.kub-feedback-card` — so for the 2400 ms a
success is shown, a click on that tab lands on the toast. The cause is in
`components/kub/KubFeedbackViewport.tsx`, whose offset was measured against the
staff area's 56px header over a 45px navigation strip; this page stacks a 56px
header over a taller tab strip, which that measurement did not cover. At 390 the
strip sits lower and there is no overlap. It is a defect of the shared viewport
rather than of this panel, so it is recorded here and left for its own entry.

Also seen at 390 and left alone as out of scope: the bots page header truncates
«Мои боты» to a single glyph. The `h1` measures 6 CSS px, because «Документация»
and «Создать бота» take the whole trailing row and the title column has no
minimum. Pre-existing — this pass did not touch `KubHeader` or the header
composition.

`tests/unit/bot-settings-copy.test.mts` pins the words, the section each action
reports into, and both halves of the secret hint;
`tests/e2e/bot-management.spec.ts` proves the screen at 1440 and 390. Five of the
pass's eight mutations belong to this entry and turn that pair red: dropping the
success toast, moving the error back into a banner above the tabs, giving the
list a bot with its `avatar_url` blanked, sending «Запросить удаление» to report
into «Состояние», and cutting the «даже если меняется только адрес» clause out of
the hint. The other three are under D-133.

## D-146 `[x]` Administration shows a legacy role that contradicts a person's real role

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

**Fixed 2026-09-14.** Two contradictions removed; one thing deliberately left
alone.

The profile dialog's «Базовая роль» field is gone. It printed `profiles.role`
eighteen lines above `ProfileRoleSummary`, which prints the global roles for the
same person — «Пользователь» over «Владелец». Nothing is lost by removing it:
that summary already falls back to the same legacy value where the roles system
has nothing to say, so the legacy label still appears exactly where it is the
only thing known.

The dashboard's «Новые пользователи» no longer labels a registration with that
field either. It is «Пользователь» for all but two accounts here, so it
distinguished nobody while being wrong about two. `formatNewUserLine` puts the
handle and the time there instead — the two facts a registration list is about —
and prints the handle only when the title is not already showing it, because the
title falls back to «@ник» when there is no name.

**Left alone on purpose:** the users list row and `ProfileRoleSummary` both
already prefer the dynamic roles and fall back to the legacy label only when
there are none. That is not the defect; that is the fallback working.

The proposal said "label people from their global roles everywhere". The
dashboard has `Profile[]` and no role assignments, and fetching them for a
five-row list would be a query for a line that is not about roles — so there it
is satisfied by not labelling rather than by labelling.

`tests/unit/admin-dashboard-model.test.mts` pins the line; two mutations turn it
red — printing the handle when the title already carries it, and dropping the
time.

## D-147 `[x]` «Открыть оригинал» opens the raw file address in a browser tab, which takes a person out of the Windows and Android apps

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

**Fixed** 2026-09-13. The control is decided per shell in
`artifacts/kub/src/lib/mediaFileAction.ts`, a pure module with the four shells'
behaviour read off their own sources rather than assumed: Tauri answers a new
window with `NewWindowResponse::Deny` and hands an http(s) address to
`opener().open_url()` (`windows-tauri/src-tauri/src/lib.rs`), and Capacitor's
`Bridge.launchIntent` fires `Intent.ACTION_VIEW` for every host that is not the
app's own. Everywhere the file can be kept, the control is «Сохранить» with the
download glyph and saves through `saveMediaAs`, which fetches the bytes and
hands them to the shell — no address, no tab. The one shell that cannot keep a
download is Android: neither `@capacitor/android` nor this project's
`MainActivity` installs a `DownloadListener`, so a WebView drops it silently.
There the control says «В браузере», wears the external-link glyph, and reports
«Файл открыт в браузере» after the press. Its word is drawn at every width in
that shell — a warning hidden below `sm` is a warning nobody on a phone reads —
and the short label is measured rather than chosen: with the full sentence, a
video at 390 left the picture's own title 37px wide. Pinned by
`tests/unit/media-file-action.test.mts` (every target enumerated, so a new shell
must be decided) and `tests/e2e/media-viewer-actions.spec.ts`, which records what
the page does with the file and fails if a tab is opened. The Windows and iPhone
shells are **unverified as shells**: both are on the saving branch by rule, and
only a Windows build and a device can show that WebView2 and Safari really keep
the download.

## D-148 `[x]` «На весь экран» in the video viewer wears the external-link icon and has no name on a phone

**Severity:** low, for accessibility. Found by the chat-functions audit; rendered (frame
17, where a phone shows two identical icons side by side).

**Surface:** `artifacts/kub/src/components/chat/MediaViewer.tsx:132-141`.

**Defect:** the fullscreen button is drawn with the same external-link icon as «Открыть
оригинал» beside it; below 640 px its word is hidden and the button has no accessible
name. D-094 fixed the same gap on «Открыть оригинал».

**Proposed:** a fullscreen icon inside drawn video controls, with an accessible name.

**Audit rows:** chat-functions M6 (with V4).

**Fixed** 2026-09-13. The button has `aria-label="На весь экран"`
and a glyph of its own: the icon vocabulary had no fullscreen drawing at all, so
`fullscreen: { Icon: ArrowsOut }` was added to `components/kub/icons.ts` — every
existing name would have lied in a different way. Pinned by
`tests/e2e/media-viewer-actions.spec.ts`, where the two glyphs are compared **in
the Android shell**, whose file control is the external-link one: that is the
pair the register recorded, and the first draft of the assertion — comparing the
fullscreen glyph with whatever stood beside it — passed with the lying icon
restored, because in a browser the neighbour is a download glyph.

## D-149 `[x]` Two stored playback volumes override each other

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

**Fixed** 2026-09-13. The player owns the volume; the sound
settings' «Голосовые сообщения» slider is gone, and nothing writes
`voicePlaybackVolume` any more. A voice bubble takes `mediaPlayback.volume`, so
one thing writes the element and the finger check (D-118) lives in that one
place. `artifacts/kub/src/lib/playbackVolume.ts` holds the rules, including the
inheritance: a volume somebody had set in the settings before this becomes the
player's once, so the change takes nobody's choice away. Pinned by
`tests/unit/playback-volume.test.mts` — where zero is the case a truthiness check
gets wrong, and it is the case that matters — and by
`tests/e2e/media-viewer-actions.spec.ts`, which reads `audio.volume` off the
bubble with the two keys deliberately disagreeing: 30% stored by the player, 90%
by the settings. Restoring the second writer turns three of those red, and the
mobile one shows why it was worth doing — the settings' 0.9 reached the element
under a finger, which D-118 forbids.

## D-150 `[x]` A group's owner cannot leave it, only delete it for everyone

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

**Fixed 2026-09-14, the half that needs no migration — which is the half that
matters.** An owner's member menu now offers «Передать права владельца». The rule
`canTransferOwnership` had been in `chatMemberRules.ts` since 2026-09-13, tested,
with nothing calling it; this is the control the addendum said was the only thing
missing.

It is two writes, in the one order the trigger accepts: the new owner is made
first, because `enforce_chat_member_update` refuses to demote the **last** owner
— read off production again on 2026-09-14, where `caller_role = 'owner'` takes
the full-control branch. They are not one transaction, and the failure is
reported rather than hidden: if the second write fails the chat has two owners,
which the trigger allows, nothing is lost, and either of them can finish it. The
message says exactly that.

Once the handover lands, `myRole` is `admin` and «Покинуть группу» appears on its
own — the row was always `isGroup && !isOwner`.

**The confirmation stopped saying the same thing twice.** `deleteAftermath` read
«После удаления группа исчезнет у всех участников» directly under
«Чат и история исчезнут у всех участников». It now says the thing an owner who
only wants out actually needs: that handing the group over leaves it standing.

**Found and fixed while photographing it:** the member menu marked the row
«Выполняем…» *before* raising its question, so every confirmation in that menu —
the handover and «Удалить из чата» — sat over a row claiming to be doing
something nobody had agreed to. `RowAction` takes a `confirm` now, and
`runMemberAction` asks before it sets the busy state.

`tests/e2e/member-actions-reachable.spec.ts` proves the whole path on the mocked
fixture: the control appears for an owner and not for an administrator, nothing
is written before the question is answered, the two writes arrive in the right
order with the right bodies, and «Выполняем…» is absent while the question is up.
Four unit mutations turn the words red, among them an administrator being allowed
to create an owner.

**Not done, and deliberately:** the rest of the entry's proposal — an
administrator inheriting after a week, and «Удалить группу» moving into
«Управление группой» — is a scheduled job and a navigation change, neither of
which this control needs.

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

## D-164 `[x]` A group has no settings screen: the pencil swaps two fields and there is no way to cancel

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

**Closed 2026-09-13.** The pencil opens a third layer of the same card, beside the root and the gallery, and
the arrow leaves it — which is what the register proposed and what the reference does.

- **One row per setting, with its current value on the right.** That is the half that makes such a screen
  readable at a glance rather than a list of doors, and it is why `chatSettingsRows` is a pure function with a
  test: which rows exist, for whom, and what each says can be argued about without a browser.
- **Only rows that exist.** Who may invite, topics, administrators, members, shared media, and the destructive
  row at the foot. No «Статистика», no «Недавние действия», no «Приветствие»: a row for a feature nobody has
  built teaches a person that the screen is decorative. When one is built it arrives here with its value beside
  it like the rest.
- **A member reads it too.** Every value is shown to people who cannot change it, because a rule about the
  group they are in is a fact they are entitled to. What they do not get is the pencil.
- **Leaving asks.** A name or a description typed and not saved raises «Отменить изменения?» rather than being
  dropped — the answer D-136 wants one surface over. The check appears only once something has really been
  typed: a control that is always there and usually does nothing teaches people to press it out of habit.
- The topics handler was lifted out of the middle of the button's markup so it could be called from the new
  row; the invite-policy card moved wholesale.

**What this did not do:** the reference's fifteen rows include several this product has no feature for, and one
— «Тип группы» — that it has no column for. Nothing was invented to fill them.

## D-165 `[x]` The invite card states a policy it never read, and silently takes the invite button away

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

**Two of the three closed 2026-09-13**, with the card that carried them.

- **It no longer asserts a policy it has not read.** `invitePolicyLabel(null)` is «Неизвестно», and the row on
  the settings screen shows that rather than the default. Part 1 closed.
- **The value and the control now use the same words.** «Только администраторы» in both places; the button used
  to say «Администраторы», which reads as a third setting. Part 3 closed.
- **Part 2 is left open deliberately.** `canSendInvites` still requires the policy to have been read before it
  honours `members_can_invite`, so an unread value still leaves an ordinary member without the invite button.
  Being unable to read the policy and defaulting to «administrators only» is the *safe* direction, and the card
  now says so instead of claiming to know; changing who may invite on the strength of a value we could not read
  would be the unsafe one. What is left is a product decision, not a defect.

**And a cause found while closing it.** The «Недоступно» badge the earlier pass recorded as a fixture artefact
had a cause worth its own line: `messageActionsFixture.chat()` seeded `invite_policy: "admins_only"`, a value
**production would refuse** — its CHECK allows `owner_admin_only` and `members_can_invite` and nothing else, and
all 40 chats carry the first. Six specs seeded it. Every fixture-based render of the information card was
therefore showing a state the product cannot be in. Corrected in five of the six; the sixth
(`chat-list-event-cost.spec.ts`) was being edited by another agent at the time and is noted here so it is not
forgotten.


---

**Part 2 closed 2026-09-18, and the measurement changed the answer.**

The note above left it open as «a product decision, not a defect», on the
reasoning that defaulting to «administrators only» when the policy could not be
read is the *safe* direction. Reading the server settled it the other way, in
two steps.

First, an unread policy is not a policy the server is unsure about.
`chats.invite_policy` is `not null` with a default of `owner_admin_only`, its
CHECK admits only that and `members_can_invite`, and `group_invite_create` reads
the column itself. So `null` on the client never means «the chat has no policy»
— it means **this client could not read the column**, a stale schema cache,
PGRST204. Refusing on that is not caution about the chat, it is our plumbing
silently removing somebody's action. The honest answer is to offer it and let
the function judge, which is what it is for.

Second, and this is the part the entry never named: the card's two-branch rule
was **wrong in the permissive direction too**, for a case that exists on this
deployment. `group_invite_create` has four branches, not two — `system.manage`,
which needs no membership at all, and `chats.invite_any`, which needs membership
and then ignores the policy. Measured on 2026-09-17, four arms inside
`begin; … rollback;`, each with a control that had to succeed first: a
legacy-`admin` who is a plain member of a group whose policy is
`owner_admin_only` **was admitted by the server**, while `ChatInfoPanel.tsx:388`
computed false and took the row away with nothing said. That is this entry's own
complaint — «silently takes the invite button away» — in the direction nobody
had looked.

**Fixed by having one rule instead of three.** `lib/chatInviteAccess.ts` mirrors
the function body in the server's own order (type before permissions, so
`system.manage` does not open invitations on a private chat; `invite_any` before
the policy, so it ignores it). `GroupInviteModal` asks it, and now the card
does too. While the permission snapshot is in flight the three answers are
false, which reduces the mirror to exactly the old rule, so nobody who had the
row watches it appear; it appears for the arm-D case once the check lands.

**One guard was needed that the lib cannot carry.** «Избранное» is created by
`newGroupRow`, so its row really is `type: 'group'` and you are its owner — the
mirror admits it on type alone and would have offered to invite somebody into
your own saved messages. `canSendInvites` is `!isSaved && …`, and the test reads
`savedMessages.ts` for the `newGroupRow` call so the guard stops being
load-bearing quietly if that ever changes.

**Verified by mutation, which is the only way a source guard earns anything.**
Four, each red: the card back on the two-branch rule, the card without the
«Избранное» guard, a fourth permission key the server never reads, and the modal
no longer asking the mirror. The keys are pinned to exactly the three
`group_invite_create` consults — a fourth here would be a key somebody is about
to gate on that the server does not look at, which is how three entries in one
day proposed fixes the database refuses.

## D-166 `[x]` Every membership change is already recorded per chat, and no chat can show it

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

### Measured on production, read-only, 2026-09-15 — and it still cannot ship

Every figure below was read with `select` / `pg_policies` / `information_schema` only; the one behavioural
probe ran inside `begin; … rollback;`. Nothing was written.

**The record is richer than the entry says, and thinner in one place that matters.** 69 `chat_member_added`,
103 `chat_member_removed` and 12 `chat_member_role_changed`, all `target_kind = 'chat'` with
`target_id = chat_id`, the diff carrying `user_id` and `role` (and `from`/`to` for a role change). But
`actor_id` is nullable and **32 of the 103 removals have no actor at all** (67 of 69 additions do). So a
service line built on this must be able to say «Борис вышел» without naming who did it — the record does not
always know.

**The entry's cited policy is stale, though its conclusion holds.** `20260505_audit_logs.sql:42-47` really does
create «admins read audit_logs» with `is_admin(auth.uid())`, but that is not what is live. The one policy on
the table today is `audit_logs select by permission`: `has_permission(auth.uid(), 'audit.view')`, held by
**5 of 18 profiles**. A fix aimed at the migration's policy name would miss.

**Proved rather than reasoned.** Inside a rolled-back transaction, as `authenticated` with
`request.jwt.claims.sub` set to a real ordinary member of a chat that has a membership row — `auth.uid()`
confirmed to be that person, `is_chat_member` true — the read returned **0 of the 1 row that exists for that
chat, and 0 of the whole table**. An ordinary member cannot see their own group's history. 29 (chat, member)
pairs are in that position today.

**A second channel exists, is already rendered, and is the one worth using.** `messages.type` allows
`'system'`, and `messages_sender_shape_check` requires such a row to have `user_id IS NULL` and
`bot_id IS NULL` — a first-class service-message shape. It is readable by everyone who can read the chat
(`Chat members can view messages` is `is_chat_member(chat_id)`), and the client **already draws it exactly as
this entry describes a service line**: `SystemMessageNotice` in `components/chat/MessageList.tsx:169-178`,
centred, a quiet pill on `--kub-chat-chip`, no bubble and no avatar. Three such messages exist in production,
all from May 2026; nothing has written one since.

**But no client can ever write one.** The only permissive INSERT policy on `messages` is
`auth.uid() = user_id AND bot_id IS NULL AND is_chat_member(chat_id)`, and a system message must have
`user_id IS NULL`. `auth.uid() = NULL` is never true. A membership service line therefore has to be written by
a trigger on `chat_members` (SECURITY DEFINER, beside the audit triggers that already fire there) or by the
service role.

**So both routes are database changes and this entry cannot be closed from the client.** Loosening
`audit_logs` would also be the weaker of the two: it would hand a group's members a slice of a *global* audit
table, and Telegram and Discord both show these lines to everyone in the room rather than to owners. The
trigger writing a `system` message is the one that matches the mechanic, needs no new read path, and lands in
a surface that is already built. Left for the owner's approval and a backup, per section 10 of the handoff.

The client-side half the entry names is confirmed as described: `hooks/useAuditLogs.ts:62-72` filters by
`actor_id`, `action` and `created_at` and never by `target_id`, and the only surface is the administration
panel.

---

## D-167 `[x]` Muting a chat is all-or-nothing and kept in the browser, while the table for it exists

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

## D-168 `[x]` A member row shows a role and nothing else, and cannot be opened

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

**Closed on 2026-09-15.** All four complaints are answered, and none of it needed the migration the entry's
second half describes: **every fact the row was missing was already on the wire.** `loadMembers` asked for
`profiles(*)`, so `username` and `online_at` arrived on every row and were discarded; `chat_members.joined_at`
is `not null` in production and was simply never selected.

- *«the row is a `<div>` — not pressable, with no way to reach the person».* The person's area is a real
  `<button>` now, so a keyboard reaches it and Enter works, and a plain press opens the person — the gesture
  `useRowPressActions` has carried an unused `onActivate` for all along. It opens a fourth layer of the same
  card, riding the machinery the gallery and the settings screen already use: the header's back arrow and
  Escape needed no change to carry it. From there «Открыть чат» calls `useCreateChat`'s RPC, which is the flow
  the global search already established for «a person was activated».
- *«an ordinary member's row carries nothing at all».* Every row now has a second line: the chat role where
  there is one, otherwise `@username`, plus the presence sentence when presence can be read. At most two
  facts — a role, a nickname and a presence sentence together is longer than the strip `d424f96` photographed
  and rejected at 390. The join date is on the card rather than the row, for the same reason: a row is
  scanned, a card is read.
- *«there is no presence dot».* `showOnline` is passed, from `lib/presence.ts` against the product's own
  30-second tick (`usePresenceNow`), the one the chat list and the chat header already read. It is passed
  **only when presence could be read**: `usePrivacyPreferences` writes `online_at = null` when somebody turns
  the setting off, and an unlit dot beside them would say «не в сети», which is a claim nobody made.
- *«the list has no order».* Owner, administrator, then everybody else, then name by
  `localeCompare("ru-RU", { sensitivity: "base" })`, then id. **Discord's order rather than Telegram's, and
  the reason is measurable:** `useHeartbeat` rewrites `online_at` every 60 seconds and the panel re-reads on
  every membership change, so a presence-first list would reorder under a finger already travelling toward a
  row. Role order is also total and stable; presence order gives a different list every minute from unchanged
  data.

**And a defect found while closing it, in the read itself.** `loadMembers` destructured `{ data }` and dropped
`error` on the floor, so a refused member read left the list at its previous value — on a first open, empty —
and drew the same nothing a group with nobody in it draws. That is D-140 and D-193 in a surface neither of them
named. The two facts now say different things, and the refusal keeps whatever rows are already on screen.

**What this reverses, deliberately.** D-180's `member-badges.spec.ts` required an ordinary member's row to have
*no* second line and proved it by the row being shorter. That test recorded the state this entry is about; its
assertion is updated and the rule underneath it is kept — the line is never *empty*. Measured at 1440: an
undecorated row goes 52 to 70 points, and a decorated one is still the taller of the two.

Evidence: `lib/chatMemberList.ts` (the decisions, importing nothing but `plainMessages.ts`),
`tests/unit/chat-member-list.test.mts` (18 cases, 11 mutations each proved applied and each turning it red),
`tests/e2e/group-member-list.spec.ts` (19 cases on `chromium-desktop-1440` and `chromium-mobile-390`, five
browser mutations, each hashed on what the dev server actually served). Screenshots in `output/group-members/`.

**An observation left for somebody else.** The presence dot is `bottom-0 right-0` on the avatar's square
wrapper (`components/ui/ChatAvatar.tsx:301-310`), which for a circle is outside the rim. At `sm` the offset is
invisible; at `xl`, on the person's card, the dot reads as floating beside the avatar rather than on it. Not
touched here: that component is pinned at one dot size by `tests/unit/edge-vocabulary.test.mjs` and belongs to
nobody's current task.

---

## D-169 `[x]` A channel is shown as a group, with a «Участники» tab and a group's title

**Severity: low**, until channels are used in earnest.

**Surface:** `ChatInfoPanel.tsx:147` — `isGroup = !isSaved && (type === "group" || type === "channel")`.

**Defect:** a channel therefore renders the group panel, titled «Информация о группе» (`:223`), with the
«Участники» tab and «Удалить групповой чат». `getChatDisplayInfo` already has a «Канал» label
(`lib/chatDisplay.ts:70-77`) that this panel never uses. The «Топики» row is the one place that excludes
channels (`:1415`), so the distinction is known here and applied once.

**Closed 2026-09-13.** Two corrections to the account above first, both worth more than the fix.

**«Applied once» was already «applied three times» when this was read.** The settings screen that landed the
same morning (D-164, `e91bee2`) had added two more channel-aware places on its own — the card's title over the
settings layer, and the destructive row's label in `lib/chatSettings.ts`. So the card was not ignorant of
channels; it knew, in three places, and disagreed with itself: «Настройки канала» over a row saying «Удалить
канал» reached from a card titled «Информация о группе» with a «Участники» tab. Three other surfaces had
learned it separately too — the chat list's context menu (`ChatList.tsx:294`), its leave and delete
confirmations (`:423-453`), and the conversation header's «N подписчиков» (`ChatHeader.tsx:167`). Six
independent answers to one question.

**What actually differs between the two, established from the code rather than assumed.** `chats.type` allows
`private`, `group` and `channel` (`schema.sql:53`), and that is the whole of it.

- Membership is one table: `chat_members` holds `owner | admin | member` for a channel exactly as for a group.
  There is no subscriber table and no subscriber role.
- Posting is one policy: «Chat members can send messages» has no type condition and no role condition, so a
  channel's members write into it like a group's.
- Every rule that names a channel names it beside a group — `group_invites`' functions accept
  `type in ('group','channel')`, and so does the media-variant queue.
- **Nothing in the product creates one.** `NewGroupModal.tsx:49` inserts `type: "group"`, and no other code
  path in `artifacts`, `supabase` or the migration backups writes `channel` at all. A channel exists only if
  somebody put one in the database by hand, which is why «low, until channels are used in earnest» was right.

So the word changes and nothing else does, exactly as the brief anticipated. The words are
`artifacts/kub/src/lib/chatVocabulary.ts` — one function, no capability invented, because the product has none
to invent — and `tests/unit/chat-vocabulary.test.mts` holds every phrase in both nouns. The card takes its
title, its tab, its counted line, its two destructive rows and both of their confirmations, its settings title
and its description placeholder from there; `chatSettings.ts` takes the members row and the delete row.
«Удалить групповой чат» on the card root and «Удалить группу» on the settings screen were one button named
twice, and are one name now.

Proved by `tests/e2e/channel-card.spec.ts`, 24/24 across `chromium-desktop-1440` and `chromium-mobile-390`,
which asserts a channel's card **beside a group's** so that a rename cannot pass. Mutation: making the
vocabulary answer «group» for everything turns 5 of 7 unit tests and 2 of the settings tests red; restoring
the card's literal title turns two rendered tests red.

**This does not answer against the wrong reference.** D-168 warns that this entry «would label a channel the
way Telegram labels one», and that the target for the surface is Discord's shape rather than Telegram's. What
was built is not a channel feature of either shape: it is the removal of a card that called the thing in front
of it by the wrong name. «Подписчики» counts the same `chat_members` rows, and when a channel gains something
a group has not — a restriction on who may post, a subscriber who is not a member — that is a product decision
with a migration behind it, and it arrives here on top of the words rather than instead of them.

**Frames:** `output/channel-card/channel-root-light-*.png`, `channel-root-dark-*.png`,
`channel-settings-dark-*.png`, with `group-root-light-*.png` as the control.

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

**The search half is done; the entry stays open for the link.** Closed
2026-09-17/18: the screen opened as a blank box behind «Введите минимум 2
символа», so the only people reachable were the ones you could already spell.
It opens with people now — everybody you already share a chat with, from the
chat list the store holds, ordered before strangers — and the filter is built
by `lib/adminUserSearch.ts` instead of a third inline spelling of the same two
`ilike` clauses.

That third spelling was itself a defect: it replaced «_» with a space, and
`'anna_s' ILIKE '%anna s%'` is false, so **4 of this deployment's 11 usernames
could not be found by typing them out in full**. `NewGroupModal` had a fourth
spelling that escaped nothing at all, where a «,» ends a filter inside `or=(…)`
and «(» delimits one — a comma in a name turned one search into two and a
bracket into a parse error, with an empty list and no explanation. Both ask the
module now, pinned by a consumer guard whose mutation goes red; five further
inline spellings remain (`useGlobalSearch.ts`, `useCreateChat.ts`,
`TaskFormModal.tsx`, `TaskAssignModal.tsx`, `AuditTab.tsx`) and are listed in
that module's own comment.

**What keeps this entry open** is the sentence it opens with: there is still no
shareable link or join code for a chat. Reaching somebody you cannot spell at
all — a stranger with no shared chat — needs that, or a phone lookup, and
`search_profiles_by_phone` refuses every caller without `users.view`. Nothing in
this batch offers or implies either.

---

## D-171 `[x]` Shared media has no dates, and the viewer shows one item with no sense of place

**Severity: low to medium**, and it is the difference between browsing and hunting.

**Surface:** `ChatInfoPanel.tsx:1796-1863` (the grid and lists), `components/chat/MediaViewer.tsx:45-48`.

**Defect:** the media sub-view has **no date grouping, no floating month marker and no fast scroll**; paging is an
observer sentinel doubling as a «Загрузить ещё» button (`:1882-1895`), 24 items at a time. The viewer
takes a single item — `media: MediaViewerItem | null` — so there is no next, no previous, no index and no
count: opening the third photo of eight hundred tells you nothing about where you are, and leaves you no way to
move.

The counts that do exist are good and are on the rows themselves («1543 фотографии»), from
`chat_media_counts` (`:631-642`), hedged as `24+` when the function is unavailable.

**Closed 2026-09-14.** The counts stayed exactly as they were; the three mechanics around them are
new, and each is a mechanic rather than a relabelling of what was there.

- **The viewer is a place in a sequence.** It took `media: MediaViewerItem | null` — a detached copy
  of one row, which cannot answer «which of how many» even in principle. The panel holds an **index**
  now and hands the viewer a `sequence`, so the header carries «12 из 1543 · 27 сентября», the stage
  carries an arrow at each edge, and ArrowLeft/ArrowRight and a swipe do exactly what the arrows do —
  one `step()` behind all three. A step past the last loaded picture asks for the next page and lands
  on it when it arrives, rather than stopping. Hedged «12 из 24+» when nobody counted, which is the
  same hedge the row that opened it printed. Nothing changed for the two callers that open a single
  picture: without a `sequence` the header is the same 48px row it always was.
- **The grid is divided by month**, newest first, «Сентябрь» inside this year and «Сентябрь 2025»
  outside it, with an undated row kept under «Без даты» rather than dropped — dropping it would make
  the grid disagree with the count on the row that opened it. The headings are static and a floating
  pill names the month the reader is **inside**, which is the question a heading that has scrolled
  past the top can no longer answer; it appears with the scroll and fades 900ms after it stops.
- **Paging is not a button pretending to be a sentinel.** One element was both the observer's target
  and a «Загрузить ещё» button. The end of the list has five answers now — complete, more, loading,
  failed, exhausted — and only the two a person can act on draw a control.

**Three defects fell out of it, none of them in the entry:**

- **A refused page was drawn as the end of the list.** `loadMedia` and `loadLinks` both discarded
  their `error`. A refusal produced an empty page, the automatic loader marked the section stalled
  and the control at the end vanished — so an expired session and a complete gallery of 24 photos out
  of 1543 were the same picture. This is D-140 and D-193 on a third surface.
- **A section with a total and no rows drew nothing at all.** With the server's counts in hand a
  section exists because the chat holds ninety-six files; pressing that row with the query refused
  left a non-null section with empty `items`, and the markup rendered an empty grid under a title,
  with no sentence anywhere. Found in the rendered pixels by the spec, not by reading the code.
- **The list loaded itself to the end with nobody scrolling.** The automatic loader sat in an effect
  keyed on `[sentinelVisible, loadMoreActiveSection]`, and the callback is rebuilt on every page — so
  each page re-fired the effect while the flag still held the value the observer had not yet had a
  frame to correct. Measured on the fixture: sixty pictures, three pages, no scroll, and the count
  landing on 48 or 60 depending on how the race went. The observer drives the load directly now and
  is rebuilt whenever the answer could have changed, so every trigger is a fresh measurement instead
  of a remembered boolean.

The decisions and the words are `artifacts/kub/src/lib/sharedMediaBrowsing.ts`, which imports nothing
but `plainMessages.ts`, with `tests/unit/shared-media-browsing.test.mts` beside it (28 tests).
Rendered proof in `tests/e2e/shared-media-browsing.spec.ts` (14/14 at 1440 and at 390), on the
message-actions fixture — invented people, generated pictures, no production media anywhere near it.
Twenty-two mutations, one per guarantee, each proved applied by hashing the file: all twenty-two turn
something red. Two of them were green first and both were gaps rather than redundancy — the swipe
rule had no test, and the «stepping past the end loads» test was not isolating what it claimed,
because `click()` scrolls its target into view and a click on the last tile fetched the next page
underneath the assertion.

**Left open, and adjacent:** there is still no fast scroll, which this entry names. The month marker
is the navigation the grid has; a draggable scrubber is a separate mechanic and was not built.

**Frames:** `output/shared-media/{dark,light}-{grid,marker,viewer,tail-failed}-chromium-{desktop-1440,mobile-390}.png`.

---

## D-172 `[x]` The invitations block explains its own implementation to the reader

**Severity: low.**

**Surface:** `ChatInfoPanel.tsx:1662-1680`.

**Defect:** under the heading «ПРИГЛАШЕНИЯ» stands the sentence «Статусы обновляются без перезагрузки панели.»
beside a manual «Обновить» button. The sentence is a note about how the code works, and the button contradicts
it. Neither belongs to the person reading.

**Frames:** `output/group-info/1440-members.png`, `output/group-info/light-1440-members.png`.

Related and separate: `public.chats` is not in the `supabase_realtime` publication, so the panel's
binding on that table reports SUBSCRIBED and delivers nothing (`ChatInfoPanel.tsx:483-487`). Member and
invite bindings do work, which is why a manual refresh looks unnecessary and mostly is.

**Closed 2026-09-13**, and the entry was right about all three of the things it named — plus two more that
only showed up once the block was read as a whole rather than at that one heading.

- **The sentence and the button both went.** In their place stands the one thing on this list a person can act
  on: «2 приглашения ждут ответа», and nothing at all when nobody is waiting, because a line announcing that
  there is nothing to see beside a list showing that there is nothing to see is the same thing said twice.
- **The empty state named the block's own filter.** «Активных или отклонённых приглашений пока нет» is a
  description of `visibleInvites`. There are two different facts underneath it, and they are told apart now:
  «В группу ещё никого не приглашали.» against «Все приглашённые уже в группе.» — the second being what should
  always have been said to somebody who invited five people and watched all five arrive, since an accepted
  invitation from a current member is hidden from this list.
- **The unavailable state named the database.** `GROUP_INVITES_MIGRATION_REQUIRED` read «Приглашения требуют
  обновления базы данных» — a repair nobody reading it can make, in the one moment they wanted to invite
  somebody. It reads «Приглашения сейчас недоступны. Попробуйте позже.» now, in all three places that show it
  (this block, `GroupInviteModal`, and the alert `NewGroupModal` raises when a new group's invites fail).
- **Found in the rendered pixels, not in the source: an unreadable list was drawn as an empty one.** With the
  table missing, the block painted its unavailable banner and «В группу ещё никого не приглашали.» directly
  under it — a fact it had no way of knowing, having read nothing. That is this entry's own defect pointing
  the other way, and `invitesEmptyText` now refuses to answer when the read failed.
- **Two chips agreed with the invitee's gender.** «Отказался» and «Принял» are past tenses, so each was wrong
  for half the people it named; «Пригласил: Анна» likewise. The states are «Ждёт ответа», «В группе», «Уже не
  в группе», «Отклонено», «Отменено», «Истекло», and the line under a name reads «Кто пригласил: …», which
  agrees with «кто». Every one of the six states the block really has is kept.
- One real defect fell out of the rewrite: the chip's colour was chosen from the status alone while its label
  was chosen from the status **and** the membership, so somebody who accepted and has since left wore the same
  green as somebody sitting in the chat. Both come from one answer now.

The copy is `artifacts/kub/src/lib/groupInviteCopy.ts` — which words, which tone, and which of the two actions
each state offers — with `tests/unit/group-invite-copy.test.mts` beside it. The two action rules are unchanged
from the inline ones they replaced; they are merely testable now. Rendered proof in
`tests/e2e/channel-card.spec.ts` (24/24 across both viewports). Mutation: restoring the sentence about panel
reloads, or making the empty text ignore a failed read, each turns a rendered test red.

**Left open, and adjacent:** `INVITE_POLICY_MIGRATION_REQUIRED` («Настройка режима приглашений станет доступна
после обновления базы данных») is the same defect on the settings screen's invite row rather than in this
block, and it belongs to D-165's open third part. `expires_at` is still fetched and never shown, which is
D-170's.

**Frames:** `output/channel-card/invites-light-*.png`, `invites-dark-*.png`,
`invites-unavailable-light-*.png`.

---

## D-173 `[x]` The cost gate counts the chat list's previews as revalidations of the open chat

**Filed as** «Coming back to the tab refetches the open conversation seven times», which the
measurement below records faithfully and the diagnosis below gets wrong. The seven were real; only
one of them was the conversation.

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

**Re-measured 2026-09-13, and the fan-out was in the gate, not in the product.** The proposal above
would have found nothing to give an owner to: the revalidation already has exactly one.
`fetchMessages` was made to record a stack every time it ran, and over the same phase that counted
`GET messages:list` 7 it recorded **one**. The other six came from
`useChats.fetchFallbackChatSummary` (`artifacts/kub/src/hooks/useChats.ts:564`), which asks
`GET /rest/v1/messages` once per chat for the sidebar's preview line — six chats, six requests, and
one `GET message_hidden_for_users` and one `GET messages:count` with each, which is the whole of the
7 / 7 / 6 recorded above. A second probe counted it directly: six calls, one per chat id.

The spec's request classifier put both in one bucket, because both are a GET on `messages`
(`chat-list-event-cost.spec.ts`, the old `labelOf`). So one allowed revalidation of a six-chat list
was reported as the conversation revalidating seven times — and the number depended on which summary
path the server under test was built for. Proved in the other direction on a second dev server with
`VITE_CHAT_LIST_SUMMARIES_RPC_ENABLED=1`, the flag production builds carry: the same phase counted
`GET messages:list` **1**, `GET messages:count` **0**, `fetchFallbackChatSummary` **0**, the six
previews replaced by one `POST rpc/chat_list_summaries` — and the test passed. The gate was red for a
configuration, not for a regression.

**Fixed 2026-09-13** by making the gate measure what its failure text claims. The rule moved to
`tests/e2e/helpers/request-labels.ts`, where the two are separate labels — `GET messages:list` for
the conversation's history, `GET messages:preview` for one chat's sidebar line — told apart by the
only thing about them a server sees differ: the conversation's projection asks for reactions and the
replied-to row, the preview's asks for neither. The previews did not lose their bound in the split;
they gained their own, at one per chat and zero where the RPC answers, so a list that genuinely fans
out still turns the phase red.

Both halves were mutation-proven against a real defect rather than assumed: making the conversation
revalidate twice on the way back counted `messages:list` 2 and failed on «coming back revalidates the
open chat, once»; making the list revalidate twice counted `messages:preview` 12 and failed on
«asked the list for more previews than it has chats». Both source files were restored and verified
byte-identical by hash. The pure rule is pinned by `tests/unit/request-labels.test.mts`, which
imports the product's own two projection constants, so collapsing them back into one shape fails
there — four mutations turn it red, including the one that puts the single bucket back.

**Nothing in the product changed, and the compatibility path was left alone deliberately.** Asking
one query per chat is an N+1, but it is the documented fallback for a deployment without the
`chat_list_summaries` RPC, it costs the same as the first load rather than more, and production does
not take it. Replacing it is not this defect.

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

## D-175 `[x]` A video is never compressed on the way out, so there is nothing for a quality to choose between

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

**The plan, and the first slice of it that has shipped.** The owner confirmed on 2026-09-13 that the
transcoding is to be built rather than deferred: «Если функционала перекодирования нет, то требуется
реализовать».

*Slice 1, shipped in `2456a42`:* `lib/videoSendLadder.ts` — the ladder, the target frame, the bitrate
and the estimate, with thirteen tests and no encoder behind any of it. Counted on the short side; 0.07 bits per
pixel per frame clamped to [600 kbit/s, 6.8 Mbit/s]; never more than the source already spends; the container
modelled rather than ignored; frames aligned to 16 because Chromium on Android **crops** rather than refusing.
The tests caught a real inversion — portrait and landscape had their short sides swapped, so 1920x1080 at 720p
came out a 720x720 square — which is the argument for keeping this layer free of the browser.

*What that slice deliberately does not claim:* the estimate is an estimate. Android computes its own from a
bitrate it asks the hardware for (`extractRealEncoderBitrate`); a browser has no such call, because
`VideoEncoder.isConfigSupported` answers yes or no and nothing else. `estimateIsApproximate` exists so a
surface cannot present the number as a promise without deleting a constant that says otherwise.

*Slice 2, next: the encoder — and the owner has settled how to get one.* Asked whether to take a dependency for
the container writing, he answered: «Если это хорошая зависимость и слой то почему бы и нет, это применимо к
остальным функциям тоже, нам незачем всё писать с нуля если уже придумано хорошее решение». So the path is
**WebCodecs with an existing muxer**, not a hand-rolled container and not a re-recording through
`MediaRecorder` chosen merely to avoid a package. That is also the path Telegram Web took.

The two candidates remain worth stating, because the comparison is what justifies the choice rather than the
choice justifying itself:

- `MediaRecorder` — this product already encodes video with it (the round-video recorder feeds it the
  bitrates from `getVideoRecordingProfile`). Cheap and dependency-free, but it re-records through playback:
  bounded by realtime, with the output container decided by the browser rather than by us.
- **WebCodecs plus a muxer** — control over frame size, bitrate and keyframes, and an mp4 out the other end.
  WebCodecs hands back encoded chunks rather than a file, so the container writer is the part that comes from a
  package.

**The dependency, assessed against that bar rather than assumed to clear it.** The candidate is
`mediabunny` — the package Telegram Web itself depends on, and the one this comparison kept arriving at.

*What makes it a good one:*

- **No runtime dependencies at all.** Its manifest lists only type packages, so nothing else arrives behind it.
  For a media library that is unusual and is the single strongest point in its favour.
- **About 17 kB** when only the mp4 muxer is used, and tree-shakable by design.
- **It is the consolidation, not another entrant.** The same author earlier `mp4-muxer` and `webm-muxer`
  packages are now marked deprecated in its favour, so choosing it removes a future migration rather than
  adding one. Remotion retired its own `@remotion/media-parser` and `@remotion/webcodecs` for it.
- **The API answers the problem rather than a part of it.** `Conversion.init({ input, output, video: { width,`
  `height, fit, quality } })` with `onProgress`, `cancel()`, and — the part worth the package on
  its own — a **remux that happens automatically** where the configuration allows it («will try to perform a copy
  conversion by default»), plus `conversion.isValid` and `discardedTracks` to ask **before** starting
  whether this file can be converted at all. Writing that feasibility check by hand is most of the work.

*What is honestly against it, recorded rather than glossed:*

- **It is young** — under a year old at the time of this decision, on its 56th release. A library of this kind
  earns trust by surviving browsers changing under it, and it has not had long to.
- **MPL-2.0, not MIT.** Using it unmodified as a dependency is unencumbered; **modifying its files obliges us to
  publish those modifications**. So the rule is: use it, do not fork it into the tree. If a change is needed, it
  goes upstream or the file stays untouched and the behaviour is wrapped.
- **It documents no behaviour when WebCodecs is absent.** That is our problem to solve, not its bug, and the
  feature detection above is not optional because of it.

*Three things are fixed by the evidence and not open to preference:*

1. **Feature detection is mandatory and the fallback is a full path, not an error.** `VideoEncoder` is absent
   from Firefox on Android in every version. Telegram Web gates on `isConfigSupported` and falls back to
   sending the file as it is. So must we.
2. **A remux fast path comes before any transcode.** An H.264 video with AAC audio, unchanged in size, only
   needs repackaging — «remuxing is I/O-bound, so even a huge H.264 file converts in moments», against a
   transcode that runs «at roughly realtime». `canRemux` in the shipped slice already answers the question;
   nothing yet acts on the answer.
3. **A hard size ceiling.** Telegram Web caps its editor at 100 MB, which is their measured answer to how much a
   browser may be given. Memory binds as much as time: their own note records that an in-memory finalisation
   holds the media twice.

*Slice 3:* the control itself — a ladder with the estimate beside each rung, marked as an estimate, offered only
where an encoder exists and only for rungs below the source.

*What would make this dishonest, and so will not be done:* shipping the counter without the encoder. A number
beside a rung that no upload can be made to match is a lie told precisely, and it is the reason this entry was
opened rather than folded into D-174.

---

**Closed 2026-09-13, in five slices, each with its own commit.**

1. `videoSendLadder.ts` — the arithmetic, taken from tdesktop with its reasoning rather than only its
   constants: the short side names the rung, 0.07 bits per pixel per frame clamped between 600 kbit/s and
   6.8 Mbit/s, never more than the source already spends, and the container modelled rather than ignored.
   A unit test caught a real inversion here: portrait and landscape short sides were swapped, so 1920x1080 at
   720p asked for a 720x720 square. No amount of looking at a slider would have found that.
2. `videoSource.ts` — reading what a picked file actually is. Before it, the client could measure two of the
   six numbers the ladder needs; `fps`, `bitrate` and the codec string had no source in this codebase at all,
   so the ladder was arithmetic that could not be fed and its most important rule could never fire.
   `mediabunny` closed that gap and the encoder gap with one dependency, which is the standing rule the owner
   set the same day: a good existing solution beats writing one.
3. `videoTranscodeSupport.ts` and `videoTranscode.ts` — the capability probe and the plan. Every path that
   ends in «send the picked bytes» is named — `chose-source`, `no-encoder`, `rung-not-encodable`,
   `not-smaller` — because to a person all four look identical: the video simply arrives large.
4. `videoSendSelection.ts`, `AttachVideoQuality.tsx`, `useVideoSendLadder.ts` — one slider over a batch. A
   stop takes the files bigger than it and leaves the rest as they were picked; the counter is the sum of
   both halves and marks itself with «≈» exactly when some of it is an estimate.
5. The server half, below.

**What the number is worth, measured rather than asserted.** The spec records a real 1920x1080 clip in the
browser and sends it through the shipping components. Asked for 1 940 794 bit/s, the encoder produced
1 913 362, and 1 898 279 bytes against an estimate of «1,8 МБ» — inside one per cent. Constant and variable
rate differed by 289 bytes on the same file, so the code names no mode; claiming constant rate was the reason
would be a claim the measurement does not make. The exception is incompressible footage: the same encoder over
pure noise produced six times the estimate, which is why `estimateIsApproximate` exists and why the slider
marks its number. **A browser cannot ask its encoder what it will really spend.** Android can, and Telegram
there is exact for that reason; that difference is the whole justification for the «≈».

**The server half, and why it is part of this defect rather than of D-176.** A client that transcodes and a
server that transcodes anyway is not a saving, it is one extra minute of somebody battery. So
`ensureVideoMessageVariants` now probes the upload with ffprobe and, when the bytes that arrived are already
the rendition, writes a ready `video_720p` row pointing at the source object instead of making a copy of it.
Every condition is measured on the server — codecs and frame from ffprobe, metadata position from the file own
top-level boxes — and nothing reads `media_metadata`. A claim in the sender metadata would have been the easy
way and would have let any caller skip the pipeline by asserting it had already done the work.

**One thing changed that nobody asked for, and it is the best part of this defect.** The server rendition was
a single 1280x720 box applied to the picture whichever way round it was, so a portrait clip — most of what a
phone takes — was fitted inside it and came out **405 points wide**. «720p» has always named the short side;
tdesktop counts it that way and the new client ladder counts it that way. Both halves now agree, a portrait
video comes out 720x1280, and the reuse above is possible at all because they agree. The frame is computed by
a pure function from a probe rather than by an expression inside a `-vf` string, for the same reason the
client computes its own: the rule is the part that can be quietly wrong, and an ffmpeg expression cannot be
unit-tested.

**Also fixed in passing:** the poster and the rendition each wrote the same source buffer to disk on their
own, so a 300 MB upload cost 600 MB of writes to answer two questions about one file. One temp file now.

**Still open, and deliberately not done here:** the client does not upload a poster, so the worker still has
to download the whole video to cut one frame out of it. That is the dominant cost of the pipeline and it
belongs with D-176, because it needs the same thing D-176 needs — the client telling the server what it
uploaded, and the server checking rather than believing it.

## D-176 `[x]` The server re-does work the device already did, and hunts for it by scanning every minute

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

**Closed 2026-09-13, in three pieces, all of them the half the correction above says stands.**

*The video work is on the device now.* That is D-175: the client transcodes down a ladder the person chooses
from, and the worker probes what arrived and reuses it when it is already the rendition. The photo variants
were deliberately left exactly where they are — Telegram's server makes its own thumbnail ladder, and moving
ours to the device would be moving away from the reference the owner named.

*The hunting stopped.* `private.media_variant_jobs`, three triggers, and claim/finish/retry functions reached
the way `registration_cleanup_claim` reaches its own private table. The worker drains that queue every five
seconds and keeps the scan as a half-hourly safety net for rows that predate the queue and for anything a
trigger ever misses. Applied to production after a verified backup and a rehearsal that was rolled back, and
that rehearsal earned its keep: `pg_catalog.coalesce` does not exist — COALESCE is parser syntax — so four
calls written that way would have failed inside the triggers on somebody's next upload rather than at creation.

*The client stopped asking too.* `configureMessageVariantPolling` started a 60-second interval for any chat
holding a video and never stopped it: about 1440 queries from a conversation left open all day, for rows that
all landed in the first few seconds. It now stops when nothing is outstanding, backs off from a minute to five
while something still is, and gives up after eight answers that say nothing new — 24 minutes of patience for 8
queries, a bound taken from the worker's own ten-minute transcode timeout rather than from taste. A terminal
failure counts as settled; a retryable one does not, and making that distinction reachable is why the query now
reads failed rows too, gating them out before any URL is built.

**What the measurement says it was worth.** The scan found nothing on every one of its runs: 244 media
messages, 10 profile pictures and 3 chat pictures on production, none missing anything. The cost it was really
imposing was the wait — up to a minute before the server so much as looked at a new video — and that is now a
few seconds.

**Still open, and recorded here rather than left as folklore:** the worker downloads the whole video to cut one
poster frame out of it, which is the dominant cost of the pipeline. Closing it means the client producing the
poster it already has the bytes for and the server checking rather than believing — the same shape as the
reuse above, and the right next slice.

## D-177 `[~]` Eleven things the client decides that the server never re-checks

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

**Four of the eleven closed on production, 2026-09-13**, each after a verified schema backup, a full rehearsal
inside a transaction that was rolled back, and a functional probe that also ran and rolled back. The proposal
they were taken from is `docs/proposals/2026-09-13-media-upload-hardening.md`; the applied SQL and its rollback
are recorded byte-identical in `.migration-backup/supabase/migrations/2026091313*`.

- **The bucket has a size ceiling of its own** (item 3): `media.file_size_limit` is 262,144,000, exactly
  `MAX_VIDEO_ATTACHMENT_BYTES` and exactly the Storage container's own global limit, so it refuses nothing the
  product accepts today. What it buys is that the number is a property of the bucket rather than an environment
  variable on a container, where an overlay lost in a redeploy silently drops it to 52,428,800. The largest
  object the bucket has ever accepted is 51,215,994 bytes, measured, so the ceiling has four times the room it
  needs.
- **A message's `media_path` must be the sender's own upload** (item 2), with the two exemptions that are not
  optional: a forward carries the source's path, and a session with no `auth.uid()` is the worker. Both were
  probed against real rows. The forgery — a member posting a message that points at another person's object —
  is refused by name, and so is a forgery dressed as a forward: a row naming a `forwarded_from_id` whose
  message does not carry that same bucket and path.
- **`media_metadata` has a shape** (items 9 and 10, in part): types for every flag the readers act on, and the
  one real rule — a preview's address is derived from `media_path`, never chosen. `readOriginalPreview` has
  demanded exactly that of a *reader* since it was written; now the row cannot be written. Left NOT VALID
  deliberately: one row sent 2026-07-17 carries `media_quality: "high"`, a value from a vocabulary the product
  no longer has, and validating would either fail on it or force `high` into the allowed list for ever.
- **`client_sent_at` may not be far in the future** (item 7). The proposal said one minute; the pre-flight it
  demanded says 1877 rows are ahead of their own `created_at`, the worst by 1 minute 15 seconds. One minute
  would have clamped writes this product really makes, in about a fifth of every message ever sent. Five
  minutes now, with the measured worst case asserted in the migration's own self-check so nobody lowers it
  back. That spread is ordinary phone clock skew, not the millisecond batch offset `nextClientSentAt` produces.

**What the pre-flight corrected in the entry above.** The two buckets are one: `chat-media` is the bucket with
a size limit and a MIME allowlist, and it is unused — `CHAT_MEDIA_BUCKET` is a constant whose value is
`"media"`. Everything goes to `media`, which had neither.

**The MIME allowlist is deliberately not applied, and this is a decision rather than a postponement.** «Файл»
takes any type by design (D-119), and production has already stored
`application/vnd.android.package-archive`, `application/x-msdownload`, `application/octet-stream` and eleven
others. An allowlist that refuses those refuses a function the owner asked for. The upload path is confined by
`_kub_media_path_allowed` and now by the row guard, which is where the protection belongs.

**Still open:** items 1 and 4-6 (the sender's own claims about width, height and compression), item 8
(`edited_at` has no edit-window rule), item 11 (a resumable upload reporting its own destination — a client
fix no SQL reaches), and server-side location stripping, which is the one that needs a decision rather than a
patch because it means the server reading every uploaded byte.

## D-178 `[x]` A hint stood over the attach sheet and swallowed its taps

**Severity: medium**, and the third defect of this exact shape in the register — after D-162, where a hint
took the press meant for the administration plate, and D-163, where the member actions were unreachable by a
finger. A plate that explains a control is not supposed to be able to stop a different control working.

**How it was found.** Not by reading, and not by looking. The D-175 ladder spec pressed «Отмена» on the
attach sheet at 390 points and Playwright named the interceptor outright: `aria-label="Понятно"` inside a
`data-radix-popper-content-wrapper`, «intercepts pointer events». On the desktop project the same test passed,
because there the sheet is a panel on the left and the hint sits at the composer right edge.

**The cause is a deliberate property, not a mistake.** `KubHint` does not close because a person touched
something else — that is what a menu does, and an explanation should survive being read past. The cost of
that choice is that the plate stays exactly where it is while a sheet opens over the composer, and on a phone
the sheet own capsule lands underneath it.

**Fixed** by `overlayOpen`, one more condition in `shouldOfferRecorderModeHint`, which already holds every
other rule about when this plate belongs on screen — including two device gates whose whole purpose is to keep
it from sharing a screen with the sidebar search hint. The composer passes the five overlays it owns: the
attach sheet, the camera, the video-message recorder, the voice recorder and the emoji panel.

**What made the fix safe** was a test written for another reason: `interface-hints.test.mts` asserts the exact
set of condition names the composer hands the predicate, so adding one to the type turned the wiring test red
until the composer passed it. A gate of that shape is worth copying — it is the only kind that catches a
caller quietly dropping a condition, since a missing field is `undefined`, which is falsy, which is silent.

**Where the same shape may still be open:** every other `KubHint` caller has the same non-closing property.
`SidebarSearchResults` and `SidebarHeader` are gated to a pane that is not on screen with a sheet up, so
neither can overlap one today, but nothing in `KubHint` itself prevents it. If a third hint is ever added
beside a surface that can be covered, it needs the same gate.

## D-179 `[x]` Every confirmation raised from the information card was unreachable on a phone

**Severity: high.** Not cosmetic: the button was there, at full opacity, with pointer events on, and the press
landed on something else entirely.

**How it was found.** By a new test failing for the wrong reason. The D-164 settings screen asks «Отменить
изменения?» when it is left with a typed name, and on a 390-point viewport Playwright resolved the dialog's
«Продолжить» nineteen times in ten seconds without ever being able to click it. `elementFromPoint` at the
centre of that button answered a `<span>` belonging to a settings row underneath.

**Two defects, one cause, both measured:**

1. **Painted behind the card.** `KubModal`'s overlay stood at `z-50`; the information card stands at `z-[60]`.
   On a phone the card is the whole screen, so every confirmation it raised was drawn underneath it.
2. **Confined to the card.** The card carries `kub-glass-strong`, whose `backdrop-filter` makes it the
   containing block for any `position: fixed` descendant, so a modal rendered as its child was trapped inside a
   380-point column on a computer — measured left edge 19 points *inside* the card rather than centred on the
   window.

**This is D-163's trap arriving at the dialog.** That entry recorded exactly these two mechanisms for the
member-row menu and fixed them by portalling it and raising it above the panel. `KubModal` had neither.

**Fixed** by `createPortal` to the body and `z-[95]` — above the media viewer's `z-[90]`, because a
confirmation raised from a full-screen photograph has to be reachable too, and below the ban screen's
`z-[100]`, which is the one thing that outranks everything. Every `KubModal` in the product gains both, which
closes the same hole in the group-delete and leave-group dialogs the card already had.

**Proved both ways**, at 390 and at 1440: the confirmation's own button is the element under its centre, and a
dialog opened from the card starts to the left of the card rather than inside it. Both assertions fail against
the old build.

## D-180 `[~]` Nobody could see who anybody was: a contact card said «Пользователь» to everyone

**Severity: medium**, and it is the whole of what the owner asked for when he asked for лычки — the rest of
that request turned out to be already built.

**The owner, 2026-09-13:** «есть роли также глобальные которые у нас отвечают за работников, админов
приложения и т.п, их мы можем немного видоизменить и сделать по типу лычек как опять же в дискорде, в которых
написано кто такой, за что получил медальку (достижения, покупка подписки и статус условно премиум) … чем выше
статус тем красивее иконка».

**What already existed, which is nearly all of it.** `roles` has carried `priority` and `colour` since
2026-09-04, added at the owner's request to make the ladder Discord-shaped; `lib/roleHierarchy.ts` orders it
and is tested; the administration panel edits it with swatches and arrows; 27 permission keys hang off it
through three tiers of `has_permission`. Seven achievements exist with their catalogue, their criteria, their
granting, their evidence and a settings screen that draws them. Reading `user_achievements` was opened to every
signed-in account on 2026-09-11. **None of that needed building, and saying otherwise would have been the
relabelling the owner has twice refused.**

**What was actually missing was one read path.** Measured on production on 2026-09-13, acting as
`authenticated` with real claims: an ordinary account reads **1 of 13** role rows — its own — and the three
accounts holding `roles.view` read all 13; the assignments split the same way, 10 accounts seeing only their
own of 19. So an ordinary account can read its own standing and nobody else's — and `ProfileRoleSummary`, a
component that has drawn roles as chips for months, was gated on `access.isAdmin` and showed everybody else the
word «Пользователь», whoever they were looking at.

**One of my own measurements was wrong on the way to that, and the correction is the useful part.** Two probes
set `request.jwt.claims` and stayed `supabase_admin`, which owns those tables and is not subject to their
policies. They reported that every account reads every role row and every assignment — a security finding that
was not one. Both `role` and the claims have to move; with `set_config('role','authenticated')` the answer is
the one above. A policy measured as its own table's owner is not measured at all.

**Closed for global roles and medals on a contact card (slice 1 of 8).**

- `roles.badge_icon` and `roles.badge_public`, the second defaulting to **false** — a role is private until it
  is deliberately worn, and `user`, which everybody holds, stays off the strip exactly as Discord does not
  badge `@everyone`.
- `public.profile_badges(uuid[])`, a SECURITY DEFINER function returning **presentation fields only**. It can
  never hand back a permission, an `assigned_by` or an `assigned_at`, which is why this is an RPC rather than a
  widened policy: `roles.view` keeps meaning what it means, no view is added, and one round trip answers for a
  whole member list. Its guards are named in the migration, including the 200-id cap without which a
  definer-rights function is an enumeration tool.
- «Чем выше статус тем красивее иконка» is the icon's **weight** — filled at 100, bold at 80, regular below —
  inside the icon set the product already has. No second asset pipeline, and it degrades to a legible glyph if
  the rule is ever removed.

**Two things the design got wrong, both caught by looking at the rendered strip rather than at the plan.**

1. *The order.* The proposal said one descending sort of `rank` would put roles first and keep the catalogue's
   order inside the medals. It cannot: a role's rank is its priority (100, 80, 60) and a medal's is
   `100000 - sort_order` (99 990, 99 985, …), so every medal outranks every role. Rendered, «Ветеран» stood in
   front of «Владелец». Two sort keys now — kind, then rank. The unit test had pinned the wrong order because
   it was written from the implementation; the screenshot is what disagreed.
2. *Two markers.* `KubBadge` draws a dot on every coloured tone, so a chip with an icon wore both. The dot is
   suppressed where an icon stands.

**The colour stays off the words**, and that is measured rather than preferred: the role tones read 4.05, 4.18
and 3.82 against the surfaces they sit on, under the 4.5 a body of text needs, and
`tests/unit/status-badge-contrast.test.mjs` already refuses it. Tone on the dot and the border; the name in
the text colour.

**Still open, in the order the proposal slices them:** the medals section in the card's full form and the
`achievements_sync()` call site (slice 2), the badge in the group member list (3), the badge on a message's
author line (4), per-group roles (5–7, blocked on nothing now that D-164 has landed), and the subscription and
premium medals (8), which stay undesigned on purpose — a medal with no data behind it is the one thing in that
document that would be a relabelling.

**Slice 3 re-scoped on 2026-09-18, and the accounting corrected.** The member
list was shipped by `5960115` and `d424f96`, deployed as `e6006f5` on
2026-09-13, while this list went on calling it open — and the register's own
audit table credited `e6006f5` to D-182. Worth naming as an accounting fault
rather than quietly fixing: a slice list that disagrees with the deployed
product is how the owner ends up reporting a defect in something we believe is
unbuilt.

What shipped there was also the wrong thing, which the owner reported on
2026-09-18 and which is now D-213: the strip in that list was LETSCUBE-wide
standing beside the group's own. The badge in a member row is therefore **not**
an open slice and never becomes one — a row carries this group's standing, and
the whole strip lives on the person's card. Slice 3 is closed with that
correction.

**Slice 4 is affected the same way.** «The badge on a message's author line»
cannot be the global strip either, for exactly D-213's reason: a message is read
inside one conversation. Discord colours the author's name by their highest role
*in that server* and Telegram prints the group title beside it; neither shows a
site-wide rank there. So slice 4 waits on per-group roles rather than being
buildable from what exists — it is part of D-215 now, not a separate small
piece.

**Slices 5 to 7 are D-215**, with the production measurements that bound them:
`chat_members.role` is an enum of three values, the three chat-scope rows in
`roles` are dead by construction, and nothing in the schema can name a tag for
one person in one group.

---

## D-181 `[x]` A confirmation raised by a key press was answered by that same press

**Severity: high** wherever it happened: the question appeared and vanished inside one
keydown, so the person saw nothing and had no chance to answer. Worse than not asking,
because the guard looks as though it ran.

**Found** 2026-09-13 while closing D-136, and only because that fix gave Escape
something to raise — two of the settings screen's five doors are key presses.

**Surface:** `artifacts/kub/src/components/kub/KubModal.tsx:56-83`, the window `keydown`
listener every dialog in the product installs.

**Defect, and how it was measured.** Escape in the settings column called
`requestClose`, which raised «Отменить изменения?» — and the screen simply closed with
the text dropped, exactly as before the fix. A `MutationObserver` on `document.body`
counted the dialog **inserted and removed inside the one key press**: one dialog request
dispatched, one insertion seen, nothing on screen afterwards. React flushes a discrete
event's update synchronously, so the new dialog's effect runs while that keydown is
still travelling up to `window`; the listener it installs sits on an ancestor the event
has not reached yet, and the DOM duly delivers it. `onClose` fires and the promise
resolves `false`.

It hid behind a working ✕ for as long as it existed: the click path cannot reproduce it,
and until D-136 every confirmation in the product was raised by a pointer.

**Fixed** the same day. The listener records `performance.now()` when it is installed
and ignores any press whose `timeStamp` is older — the two share a clock, so a press
that predates the dialog is not that dialog's to answer. Two lines, in the one component
every dialog in the product goes through.

**Test:** `tests/e2e/settings-exit-confirmations.spec.ts` — «every door this shell offers
asks before dropping the text» walks the Escape doors on both shells and goes red on both
projects when the timestamp check is removed.

---

## D-182 `[ ]` A global search takes the settings screen off the column and drops what was typed

**Severity: medium**, and the same defect D-136 records reaching the same screen by a
road that is not a door.

**Found** 2026-09-13, measured while closing D-136 on the message-actions fixture at
1440.

**Surface:** `artifacts/kub/src/components/sidebar/Sidebar.tsx:203-206`, the chain that
decides what the list column's body is — `hasSearchQuery ? <SidebarSearchResults/> :
settingsColumnOpen ? <SettingsPanel/> : …`. The field that feeds it is the list header's
own search (`SidebarHeader.tsx:329`), which stays on screen above the settings panel.

**Defect, as measured.** With «Настройки» open on the column and «Максим Орлов-Тестов»
typed into «Имя», one character into the header's search field replaces the panel with
the search results: `field 0, panel 0, dialogs 0`. Clearing the query brings the screen
back — `settingsOpen` was never false — showing the stored «Максим Орлов». The typed
name is gone, with nothing said. D-136's guard cannot see this: nothing calls
`requestClose`, the component is simply unmounted under it.

**Proposed — preserve, do not ask.** Searching the chat list is not a decision to
abandon the profile, so a confirmation here would be a question raised by the first
keystroke in an unrelated field, which is worse than the defect. The screen should keep
its state across the swap instead: either the column keeps `SettingsPanel` mounted and
hidden while a query is showing, or the three fields are lifted out of the component
that the swap unmounts. That is a decision about how the column swaps its body, so it
belongs with the settings parity work rather than with a confirmation.

## D-183 `[x]` Voice calls one thing by two names on the same card

**Severity:** low, and the kind that reads as two features rather than one.
Found on 2026-09-14 by looking at the rendered panel, not by a scan.

**Surface:** `artifacts/kub/src/components/chat/VoiceChannelRow.tsx:97`,
`artifacts/kub/src/lib/voiceChannel.ts:371, 401`,
`artifacts/kub/src/lib/voiceGateway.ts:181-193`.

**Defect:** the section header read «ГОЛОСОВОЙ КАНАЛ» and the action directly
under it «Начать голосовой чат». Five gateway refusals said «канал» too —
«Голосовой канал больше не существует.», «В канале уже максимум участников.» —
while eleven newer sentences said «чат». Somebody reading the card has no way to
know the two words mean one thing.

**Fixed 2026-09-14:** «голосовой чат» everywhere a person can read it. The
shipped mechanic is Telegram's — an administrator starts it, it exists until
somebody ends it — so the visible word is Telegram's. Three other sentences
moved with it: «Вы в другом голосовом канале» → «…чате», «Канал заполнен» →
«Мест больше нет» (a channel that is full is a phrase about the row; what the
person needs to know is that there is no seat), and the five gateway refusals.
The table, the component, the hook and every `data-testid` stay `voice_channel`:
nobody using the product reads those, and renaming them would touch the
migration, the gateway and the reconciler for no visible gain. Six assertions in
`voice-call.spec.ts` and `voice-channel.test.mts` moved with the copy.

**The glyph moved too.** «Завершить голосовой чат» wore `close` — the «×» every
dismissable thing in this product wears — where what the row does is hang up on
everybody in the call. `phoneOff` (phosphor's `PhoneDisconnect`) is the vocabulary
entry for that and for nothing else.

## D-184 `[x]` Every destructive dialog shows a red glyph on an accent-coloured square

**Severity:** low. Found on 2026-09-14 by looking at «Завершить голосовой чат?»,
and it turned out to predate that dialog by every other one.

**Surface:** `artifacts/kub/src/components/kub/KubModal.tsx:153`.

**Defect:** the header badge was `bg-[color-mix(var(--kub-cyan) 15%)]` with
`text-[var(--kub-cyan)]` whatever it held. A caller can tint the icon and not
the square behind it, so «Покинуть группу?», «Удалить группу?», «Удалить
сообщение?» and the chat header's own removal dialog all painted a danger-red
glyph sitting on the accent colour — the one place on the screen that is
supposed to say "this is destructive" said "this is the accent".

**Fixed 2026-09-14:** `KubModal` takes `tone`, default `"default"`, and
`"danger"` tints the square with `--kub-danger` and the glyph with
`--kub-danger-text`. Five dialogs pass it — the three on the group card,
`ChatHeader`'s, `MessageDeleteDialog`'s — and `AppDialogs` passes through the
tone it already had, so every confirmation raised by `requestAppConfirm` follows
without a change at its call site. Nothing that did not already carry
`tone="danger"` on its icon changed at all.

## D-185 `[x]` The deployed push function was seven weeks old and had no Windows delivery in it at all

**Severity:** high, for a delivery channel that was believed to work. Found on
2026-09-14 by hashing every Edge Function in the repository against the copy the
server serves, after the same question about migrations found six unapplied.

**Surface:** `supabase/functions/send-push-notifications/` against
`/srv/letscube/platform/supabase-docker/volumes/functions/send-push-notifications/`.

**Defect:** the served copy was dated **2026-07-14**; the repository's is
2026-08-31. `index.ts` 19 325 bytes against 25 631, `fcm.ts` 4 080 against 5 840,
and **`wns.ts` was not there at all** — the whole Windows Notification Service
sender, with `deliverWns`, `getWnsAccessToken`, `readWnsConfig`, and the two
helpers that keep a toast from carrying an external or signed avatar URL. Those
have unit tests in this repository, all passing, against code production was not
running. Section 13 of `CLAUDE.md` lists «killed-process WNS delivery» as an open
Windows gate; part of the reason it was open is that the sender had never been
deployed.

Three other function directories were serving stale copies of themselves as
well: `auth-send-sms` carried `p1sms.mjs.bak-20260824-182823` and
`p1sms.mjs.pre-contract-cleanup`, `auth-yandex-gateway` three
`index.ts.bak.20260622*`, and `recurring-tasks-run-due` a `supabase/.temp/`
directory. Not routable by themselves, but old gateway code inside a directory
the runtime serves is a trap for whoever reads it next.

**Fixed 2026-09-14.** The served directory was backed up to
`/srv/letscube/backups/edge-functions/20260913T225025Z/`, the repository's four
files copied in, and all four verified byte-identical afterwards. The stale
copies were **moved** into that backup rather than deleted — they are somebody's
safety net, and a safety net does not belong in a served directory.

No restart: the edge runtime serves each function from disk per request, which
was proved rather than assumed — the new code answered `401` to an unauthorised
call immediately after the copy, so it compiled and ran.

**Nothing that worked stopped working.** The new version reads the same
environment as the old one plus three optional `WNS_*` names, and
`readWnsConfig()` answers null without them, after which a WNS device is skipped
with a recorded reason rather than crashing the batch. FCM and web push are
untouched. Windows delivery stays off until those three values exist, which is
the owner's to supply.

**What found it is now a check:** `scripts/migration-inventory.*` asks the same
question of migrations, and `docs/operations/deployment-inventory.md` records the
procedure. The functions have no equivalent script yet — the comparison here was
a hash of each directory, and it is worth writing down as one.

## D-186 `[x]` A confirmation takes the presses meant for what is behind it

**Severity:** medium while a toast is up, which is 2.4 seconds after every
action that confirms itself. Found on 2026-09-14 by looking at the 1440 frames
taken for D-145, not by a test.

**Surface:** `artifacts/kub/src/components/kub/KubFeedbackViewport.tsx:69` (the
offset) and `:87` (the card's `pointer-events-auto`).

**Defect:** on the bots page the card sat at y 108–169 and the tab strip at
147–191, and `document.elementFromPoint` at the centre of «Диагностика» returned
`div.kub-feedback-card`. So for as long as a confirmation was up, a press on the
tab went into the toast.

The offset was not careless — it was measured, and its comment says so: the
staff area stacks a 56px header on a 45px strip, «so anything above 101px sits
on top of the tabs», and 108px clears it. The bots page stacks its tabs lower,
at 147. **A number tuned against one layout is a promise about every other
layout, and this one could not keep it.**

**Fixed 2026-09-14, by removing the need for the number rather than changing
it.** The card is `pointer-events-none` and its close button is
`pointer-events-auto`, so a press over the card body reaches whatever is
underneath and a press on the ✕ still dismisses it. Nothing moved, so the
placement is unchanged everywhere it was already right.

`tests/e2e/bot-management.spec.ts` asks the browser rather than comparing two
rectangles: with a confirmation up, `elementFromPoint` at the centre of the card
must not be inside the viewport, and the close button must still work. Putting
`pointer-events-auto` back turns it red.

**Found by the same frames and not fixed:** on a 390 phone the bots page's `h1`
is 6 CSS px wide, so «Мои боты» renders as «М». That is the page header, not the
feedback viewport, and it predates all of this.

## D-187 `[x]` Nobody could refuse anybody, and nothing could be reported

**Severity:** high, and it was invisible until a form asked. Raised on
2026-09-14 while filling in the Microsoft Store age-rating questionnaire, which
asks in plain words whether the application lets people block users and report
users or content. Both answers were «no», and neither had ever been written down
as a gap.

**Defect:** moderation in this product was entirely administrative. `bans` and
`mutes` are issued by staff and enforced by restrictive policies on
`public.messages`; an ordinary person had nothing at all — no way to stop
somebody writing to them, and no way to bring a message to anybody's attention.
The support workflow is a mailbox, not a report: it does not know what message
you mean.

**The database half is applied to production (2026-09-14),** migration
`20260914120000_personal_blocks_and_reports.sql`.

- `public.user_blocks` — one row per «I do not want to hear from this person».
  One-directional and **invisible to the person blocked**, which is why the
  guard behind it is SECURITY DEFINER: the policy has to see a row the sender
  may not read.
- A restrictive INSERT policy on `public.messages`, in the same vocabulary as
  «block muted/banned from sending», refusing a write into a **private** chat
  whose other member has blocked the sender. Groups are deliberately outside it:
  a group is somebody else's room, and silencing a member of one is the
  administrator's decision, which `mutes` already is.
- `public.content_reports` — a report about one message or one person, written
  by anybody and **readable only by staff**. A queue its reporters can read is a
  queue that says who else complained about whom.

**What the rehearsal caught, which is the point of having one.** Four defects
before anything reached production:

1. **`anon` held SELECT on both new tables the moment they were created.** This
   deployment's default privileges grant `anon` and `authenticated` `arwd` on
   every new table in `public` — read off `pg_default_acl`. A `create table`
   publishes it, and a narrower `grant` afterwards adds nothing. Both tables now
   `revoke all … from anon, authenticated` first. The same default privilege
   would have given every account table-wide UPDATE on a report — somebody
   else's testimony, rewritable.
2. The fixture promoted its own reporter: `trg_bootstrap_first_admin` makes the
   first profile in an empty database an administrator, so on a throwaway copy
   the reporter *was* staff and the queue check proved nothing. The rehearsal
   now creates the duty officer first, deliberately, and asserts the fixture's
   own assumption before testing anything.
3. The same on production, for the same reason in a different disguise: the
   first private chat's member is one of this deployment's two administrators.
   The probe now picks a chat with an ordinary member and says why.
4. **`insert … returning` is refused for the reporter**, because RETURNING needs
   the SELECT policy. Postgres reports it as «new row violates row-level
   security policy», which reads like a failing WITH CHECK and is not one. The
   contract is a bare insert with no `.select()` chained, and the rehearsal pins
   it so a client cannot break it quietly.

**Measured on production afterwards**, as `authenticated` with real claims and
inside a transaction that rolled back: the block is invisible to the person
blocked and stops their message; the person who blocked can still write; a
report goes in and does not come back out; staff read the queue. Thirteen rules
green in the rehearsal, four on production, nothing written.

**The interface shipped the same day.** «Заблокировать» in the header menu of a
private chat and on the contact card, both behind a question that describes what
the row actually does and no more; «Заблокированные» in «Конфиденциальность»,
which also answers a search for «заблокирован» and «чёрный список», because a
block nobody can find again is a trap rather than a setting; «Пожаловаться» as
the last item of the message menu and beside the block on a person, with one
reason picker for both; and the refused send saying «Пользователь ограничил
переписку.» beside the composer while the message stays in the conversation with
its words and a «Повторить».

The staff side is «Жалобы» in the administration, gated on
`canReadModerationQueue` rather than on `isStaff` — see D-188 for why those are
not the same rule, and `lib/moderationAccess.ts` for the rule itself.

**Not done, deliberately:** blocking does not hide the other person's profile,
name or existing messages — Telegram does not either, and rewriting a
conversation somebody may need is a bigger harm than the one being fixed. It
does not reach groups. And nobody is told they were blocked or reported.

---

## D-188 `[x]` «Блокировки» is offered to people the database will answer with a shorter list

**Severity:** medium. Found on 2026-09-14 while gating the new «Жалобы» tab,
which is the same job for the same people; recorded rather than fixed, because
taking a tab away from somebody who can open it today is a decision about people
and not about a new screen.

**Surface:** `artifacts/kub/src/pages/admin/AdminLayout.tsx` — the tab strip
filter and `<Route path="/admin/bans" component={BansMutesTab} />`, which is
mounted bare. The tab carries no `adminOnly`, so it is shown to everybody the
client calls `isStaff`.

**Defect:** `isStaff` and the policy that actually reads these rows are two
different rules, and the client's is the wider one. Measured on production on
2026-09-14:

- `public.is_manager_or_admin(uid)` is `profiles.role in ('admin','manager')`
  **or** `has_global_role(uid, 'owner' | 'tech_admin' | 'admin' | 'manager')`.
- `useRoleAccess().isStaff` is that, **plus** anybody holding one of
  `STAFF_ACCESS_PERMISSIONS` — `users.view`, `location_members.view`,
  `tasks.create`, `tasks.assign`, `tasks.manage`, `chats.moderate` — which a
  location role can carry with no global role at all.

**Observable consequence, and it is not an empty screen.** `bans` and `mutes`
each carry two read policies, read off `pg_policies` the same day:
`managers read all bans` (`is_manager_or_admin`) and `user reads own bans`.
Somebody in the gap therefore opens «Блокировки» and is shown **their own
sanctions, if any, presented as the whole list** — a list that is complete in
appearance and wrong in fact. That is worse than the empty queue the new
«Жалобы» tab would have shown, because nothing about it looks unusual.

**Evidence, and the first measurement was the wrong one.** The global role keys
in use are `owner`×3, `tech_admin`×2 and `user`×14, and reading only those said
«nobody is standing in the gap today» — which is why this entry was first
recorded as something to decide later. But `isStaff` admits **permissions**, not
only role keys, and permissions arrive through location roles as well as global
ones. Counting those, on the same deployment and the same day:

| | |
| --- | --- |
| accounts | 18 |
| staff to the database (`is_manager_or_admin`) | 5 |
| holding one of `STAFF_ACCESS_PERMISSIONS` | 7 |
| **in the gap** | **2** |

So this was happening to two real people, not waiting to happen. The lesson is
the register's own: a count taken over the wrong column answers confidently and
wrongly, and «nobody is affected» is exactly the claim worth re-measuring before
deferring something on it.

**Fixed** the same day: `moderationQueue: true` on the tab and `canReadReports`
on the route, the same rule «Жалобы» uses —
`artifacts/kub/src/lib/moderationAccess.ts`, which mirrors
`public.is_manager_or_admin` exactly. Three mutations turn
`tests/unit/content-report-queue.test.mts` red: mounting the route bare again,
dropping the flag from the tab, and re-gating on `isStaff`.

It was recorded as needing the owner because taking a tab away is a decision
about people. It stopped being one once the screen was measured: what those two
saw was not a screen with less on it, it was a screen stating something false.
Removing that needs no permission. The two accounts are named to the owner so
they can be given a real role if they are meant to have this.

**Related:** D-187 (the queue this rule was written for) and D-140 (a failed
read must not render as nothing — this is the same rule one step earlier, at the
point where the screen is offered rather than where it fails).

---

## D-189 `[x]` A reported message could not be deleted, and neither could the chat holding it

**Severity:** high, and it was shipped by this project six hours earlier. Found
on 2026-09-14 by reading the constraint list back off production instead of off
the migration that wrote it.

**Surface:** `public.content_reports`, created by
`20260914120000_personal_blocks_and_reports.sql`. Two of its own objects
contradict each other:

```
content_reports_message_id_fkey  FOREIGN KEY (message_id)
  REFERENCES messages(id) ON DELETE SET NULL
content_reports_message_present  CHECK ((kind = 'message') = (message_id IS NOT NULL))
```

**Defect:** `ON DELETE SET NULL` performs an UPDATE on the referencing row, and
an UPDATE re-checks every CHECK. The moment a reported message is deleted,
Postgres sets `message_id` to null and the CHECK refuses the new row — and the
refusal propagates outwards, so **the delete itself fails**.

**Evidence**, measured on production inside a transaction that rolled back, on a
temporary pair carrying those two definitions verbatim:

```
MECHANISM: the delete was REFUSED -> new row for relation "probe_rep"
           violates check constraint "probe_message_present"
```

**Observable consequence, and not for an administrator.**
`messages_chat_id_fkey` is `ON DELETE CASCADE`, and «Удалить группу» is an
ordinary control — `ChatHeader.tsx:96`, `ChatInfoPanel.tsx:1010` and
`ChatList.tsx:461` all run `from("chats").delete()`. So an owner whose group held
one reported message could no longer delete their own group, and the sentence
they would have got names a table they have never heard of. Nobody had reported
anything yet (0 rows), so it was never reachable in the wild.

**Fixed** by `20260914130000_a_reported_message_may_be_deleted.sql`, applied to
production the same day after a verified schema backup
(`/srv/letscube/backups/pre-migrations/20260914-034240-before-reported-message-may-be-deleted.schema.dump`,
1318216 bytes, sha256 `9c7b8377…cc28f9cc`; migration sha256 `067d0edb…`). Only
one half of the CHECK was ever a rule:

- a report that is **not** about a message must not carry a message id — real,
  and rehearsal rule 11 pins it;
- a report about a message must carry one — true when it is filed, and not
  something the row can promise for ever.

So the constraint is now `check (kind = 'message' or message_id is null)`. The
complaint deliberately outlives the evidence: `SET NULL` rather than `CASCADE`,
because «somebody complained and the message is gone» is exactly the case staff
need to be able to see.

**Proved afterwards on production**, as four rules in one rolled-back
transaction against the real table and a real message: a report goes in; the
message id may now be cleared, which is the exact UPDATE the referential action
performs; a report about a *person* still may not carry a message id; and
deleting the reported message succeeds with the complaint still standing. Row
counts unchanged afterwards — 0 reports, 0 blocks, 3358 messages.

**The client half is part of the same defect.** `reportedMessageView` had four
answers, and a report whose message id is gone would have fallen into
`unreadable` — «Текст сообщения недоступен: его видят только участники чата» —
which blames the reader for an absence that is not theirs. It now has a fifth,
`gone`, with its own sentence, and the tab asks `reportedMessageNotice` for the
words instead of choosing between them with nested ternaries, so a sixth state
cannot inherit the fifth one's sentence. Five mutations turn
`tests/unit/content-report-queue.test.mts` red, including deleting the new
branch and giving `gone` the reader-blaming sentence.

**The general lesson,** which is worth more than the fix: a referential action
is a write, and a write meets every constraint on the table it writes. A CHECK
that spans the same column a foreign key nulls is a contradiction the schema
will only report at the moment somebody deletes something.

---

## D-190 `[x]` The hint about the microphone covered the sentence saying why the message did not send

**Severity:** medium, and it was found by looking at the pixels rather than by
any test. Raised on 2026-09-14 while reviewing the block-and-report screens on a
390-point viewport, both themes.

**Surface:** `artifacts/kub/src/components/chat/MessageInput.tsx` — the refusal
banner (`data-testid="composer-refusal"`) and the recorder-mode hint, which is
anchored to the round button with `side="top"`.

**Defect:** both occupy the strip directly above the capsules, and the hint is
drawn over it. Measured on a 390-point viewport, with the rule below removed:

| | x | y | w | h |
| --- | --- | --- | --- | --- |
| the refusal banner | 12 | 718 | 366 | 62 |
| the recorder hint | 54 | 696 | 320 | 80 |

The hint covers the banner almost exactly. On screen everything survived but the
icon and the first letter of «Пользователь».

**Consequence:** the one sentence explaining why a message did not arrive was
unreadable at the moment it was written. The information was not lost — the
bubble itself also carries it, beside «Повторить» — but the banner is where a
person looks, and a red pill with one letter in it reads as a glitch.

**Fixed** in `lib/recordingGesture.ts`: `RecorderModeHintInput` gained
`refusalVisible`, and `shouldOfferRecorderModeHint` refuses while it is set —
the same rule `feedbackVisible` already carried, one case wider. The banner
wins, and not because it is newer: a hint about a gesture is worth reading
whenever, a sentence about a message that did not arrive is worth reading now.
`useHint` withdraws on `enabled: false`, so the plate leaves rather than merely
not appearing.

**Three mutations turn `tests/unit/interface-hints.test.mts` red**: dropping the
guard, not passing the key from the composer, and — the one that needed its own
assertion — passing the key with `false` wired into it, which satisfies the
existing «these are the inputs» list while restoring the defect exactly.

**Two things this cost, both worth writing down.**

1. **`document.elementFromPoint` is not a test for «is this covered».** The
   first version of the e2e check asked what was at the middle of the banner and
   got «the banner» while the hint sat over the whole of it — because the hint
   stopped taking presses when D-186 was fixed, so hit-testing walks straight
   through it. The instrument answered a different question than the one asked.
   Overlap of the two boxes is the right measure, and
   `tests/e2e/blocks-and-reports.spec.ts` now takes it.
2. **The assertion was green against the defect for a second reason first**: it
   ran the instant the refusal appeared, and the hint is offered a beat later.
   The capture script that produced the screenshots waited 700ms, which is why
   its pixels showed what four test runs did not. Both directions are now
   proved: green with the rule, red without it.

---

## D-191 `[x]` A group could have as many rooms as it liked, and the interface read one

**Severity:** high, and it is the shape of the feature rather than a slip in it.
Raised by the owner on 2026-09-14: «это должен быть не один канал голосовой куда
все подключаются, а как в discord … его систему каналов на серверах с настройкой
прав».

**Surface:** `artifacts/kub/src/hooks/useVoiceChannel.ts:100` — `.limit(1)`.

**Defect:** the database has carried the server shape since the voice work and
the interface used a fraction of it. Measured on production the same day:

- `public.voice_channels` carries `chat_id`, `name`, `position`,
  `max_participants`, `speak_role` and `archived`, with
  «admins manage voice channels» = `is_chat_admin(chat_id)` FOR ALL — so an
  owner or an administrator could always have made a second room, a third, and
  a room only administrators may speak in. There has never been a control that
  makes one.
- `public.topics` is the same shape for text, with the same two policies, and is
  drawn as a horizontal strip of capsules under the header — a forum's shape,
  where one conversation has threads beside it.

So the product had one room everybody piles into, which is the mechanic the
owner objected to, and a permission column nothing reads.

**What a server does differently, and it is mechanics rather than wording:**

1. a voice channel is a **place, not a call** — it exists when empty, it is
   named, joining is one click with nothing to ring and nobody to accept;
2. **who is inside is public to the group**, listed under the channel's own
   name, so the rail answers «где все» without anybody being asked;
3. **switching rooms is one click on another room**, not leave then join;
4. **headings group the rooms** and collapse, which is what keeps a list
   readable past about six of them.

**The database half shipped first**, migration
`20260914140000_channel_categories.sql`, applied to production after a verified
schema backup
(`pre-migrations/20260914-043011-before-channel-categories.schema.dump`, sha256
`bec5ea79…5ed3c77`). It adds `public.chat_channel_categories` and a
`category_id` on both channel tables.

**Two things about it are worth reading before changing it.**

*The composite foreign key.* A category belongs to one chat and a channel in
another chat must not point at it. That is not a CHECK — it spans two tables —
and a trigger would be a rule living where nobody looks. A unique key on
`(chat_id, id)` makes it a schema fact: `foreign key (chat_id, category_id)
references chat_channel_categories (chat_id, id)`, and under the default MATCH
SIMPLE a null `category_id` satisfies it outright, which is what an
uncategorised channel needs.

*The delete action names its column.* `on delete set null (category_id)`, not a
bare `set null`, which would try to null the NOT NULL `chat_id` and fail the
delete — D-189 exactly, six hours later, in a file written by somebody who had
just fixed it. Deleting a heading therefore leaves its rooms alive and
uncategorised, which is also the right product answer: losing a heading is an
inconvenience, losing a room full of history is not.

**Proved on production** in a transaction that rolled back, seven rules: an
administrator makes a heading and reads it back; an ordinary member reads it and
may not make one; somebody outside the group reads nothing; a channel of the
chat goes under it; a channel of **another** chat is refused by the foreign key;
deleting the heading keeps the channel and only uncategorises it; and `anon`
holds nothing on the new table. Kept as
`.migration-backup/supabase/rehearsal/20260914140000_channel_categories.test.sql`,
which picks its people out of what is there rather than making them — creating
an account on this deployment needs an invitation, so a fixture that inserts
into `auth.users` cannot run here at all.

**The arrangement and the rules** are `artifacts/kub/src/lib/serverChannels.ts`,
pinned by `tests/unit/server-channels.test.mts`; fourteen mutations turn it red,
among them putting uncategorised channels last, dropping a channel whose heading
has gone, interleaving text and voice by position, collapsing «полно» and
«слушать можно, говорить нельзя» into one refusal, and cutting a name in code
units rather than characters.

**The interface shipped the same day.** A **channel rail**: a vertical list of
the group's channels beside the conversation, with the headings collapsing,
`#` for text and a speaker for voice, the seat count where a room has a limit,
and — under each voice room — **who is inside it, live, with their faces**. That
last one is the part a server is recognisable by and the rail would be wrong
without it. Clicking a text channel reads it; clicking a voice room joins it;
clicking another room moves you, without leaving first. On a pane too narrow for
a column it is a sheet behind a capsule under the header, decided by the
measured pane width rather than by a breakpoint — at 768 a breakpoint would put
a 224px column into a 336px pane.

Rooms and headings are made, renamed, reordered and removed in «Каналы» on the
group's settings screen, which draws nothing for anybody who is not an owner or
an administrator. A room's two settings are its seat count and **who may
speak** — `speak_role`, which was never decorative: the gateway computes
`canPublish` from the member's role against it and mints the token with that
claim. Somebody below the bar joins, hears everything and cannot be heard, and
the dialog says exactly that rather than «нельзя войти».

**Removing a room archives it rather than deleting it**, which is what lets the
question promise that nothing is lost, and removing a heading keeps its rooms —
the foreign key only ever nulled the heading.

**Two hazards that only existed once there was more than one room**, both found
by the people building it rather than by the brief:

1. `voiceCallLostItsChannel` reads «this chat's room is not the one I am in» as
   «an administrator ended it». With one room that question had no content; with
   several it would have hung up on a live call the moment somebody else joined
   a second room. The rule now names the **call's** room.
2. The capsule under the header named `rooms[0]`. Beside a rail listing three
   rooms, «Курилка · Никого нет · Присоединиться» is naming whichever came
   first, which is not a fact about the group. It names a room when a call is
   running in one, or when the group has exactly one, and otherwise says
   nothing. The group card's row follows the same rule.

**And the one-room mechanic was retired rather than left beside the new one.**
«Начать голосовой чат» and «Завершить голосовой чат» on the group card, and the
confirmation behind the second, are gone: a group had a voice chat or it did
not, and two creators that differ in what they can make is worse than one. Six
e2e tests that drove them went with them, replaced by three that assert they are
gone — including one that watches the network and fails if the card ever writes
`voice_channels` again at all.

---

## D-192 `[x]` Cutting a name to its limit could send bytes the database cannot store

**Severity:** medium, and it reaches four user-facing fields. Found on
2026-09-14 while wiring the channel surfaces: the agent building them noticed
that `useTopics.createTopic` cut a name with `limitText`, which slices UTF-16
code units, while the constraint behind it counts characters. Following it back
found something worse than a short name.

**Surface:** `artifacts/kub/src/lib/entityLimits.ts` — `limitText` was
`value.slice(0, maxLength)`. Its callers are a group's name
(`NewGroupModal.tsx:163`), a chat's name (`ChatInfoPanel.tsx:2431`), a folder's
name (`FolderEditModal.tsx:246`) and a text channel's name
(`useTopics.ts:99` and `:114`).

**Defect, in two parts, both measured in node rather than argued:**

1. **It can cut a surrogate pair in half.** `limitText("a" + "🧊".repeat(70), 64)`
   ends in the lone high surrogate `d83e`. That string does not round-trip
   through UTF-8 — `Buffer.from(cut, "utf8").toString("utf8") !== cut` — so what
   leaves the client is a JSON body holding bytes Postgres cannot store as
   written. The single leading letter is what puts the code-unit boundary in the
   middle of a pair; a name of emoji alone happens to survive, which is why it
   had not been noticed.
2. **It gives fewer characters than the limit promises.** `char_length` counts
   characters and `String.length` counts code units, so forty emoji were cut to
   32 characters against a limit of 64 while the counter beside the field said
   64.

**Fixed** by cutting on `Array.from`, which iterates code points, so a pair is
never split — the same cut `normalizeChannelName` and `normalizeReportNote`
already make, and the reason is the same in all three: **agree with the
database, which is the thing the number has to agree with.** Grapheme clusters
are still counted as their code points, because that is also what
`char_length` does.

`tests/unit/entity-limits.test.mts` pins both halves, and the surrogate test
asserts the **old** behaviour still reproduces before checking the new one — a
test for a case that has quietly stopped occurring is a test that proves
nothing. Three mutations turn it red, including the exact `slice` it replaced.

---

## D-193 `[x]` A failed read of the rooms took the rail away, and hung up a live call

**Severity:** high. Found on 2026-09-14 in the interface audit, hours after the
rail shipped, by reading the new hook's error handling rather than by any test.

**Surface:** `artifacts/kub/src/hooks/useServerChannels.ts` — the two reads it
owns turned an error into an empty list:

```ts
const voice = channelRead.error ? [] : (channelRead.data ?? []).map(...)
// ...
setRead({ supported, chatId, categories, voice, participants });
// and, for every read that came back at all:
ready: true
```

**Defect:** an empty list and a failed read were the same answer. Two
consequences, and the second is far worse than the first.

1. **The rail vanishes.** `railIsOffered` sees nothing but the conversation, so
   a group whose extra channels are all rooms loses its whole channel list on a
   network blip — and nothing anywhere says why. That is D-140 one surface
   further on.
2. **A live call is hung up.** `voiceCallLostItsChannel` fires on «this chat has
   no such room», guarded by `ready` and `supported` and by the read's own
   `chatId` matching the call's chat. After a failed read all three guards pass:
   `ready` is true, the error is not «table absent» so `supported` stays true,
   and `chatId` is set. The room is simply missing, so the call ends.

**And the reader this replaced was safe only by accident.** The single-channel
`useVoiceChannel` returned `{ ...EMPTY, ready: true, supported }` on an error,
and `EMPTY.chatId` is null — so the hang-up rule's third guard caught it. The
rewrite carried `chatId` through on every path, which is more correct in every
other way and removed the accident that was holding this up. **A guard nothing
states is a guard nothing protects.**

**Fixed** by making the failure an answer of its own: `ServerChannelsView.failed`
is true when the rooms read errored and the table exists. `ChatWindow` passes
`ready: voice.ready && !voice.failed` to the hang-up rule, so a read that could
not be made is not evidence that the room is gone. `railIsOffered` keeps the
rail while `failed`, and the rail draws «Не удалось загрузить каналы.» above the
list with «Повторить» beside it — above rather than instead of, because a failed
read says nothing about the channels already on screen.

**The sentence is an admission, not a claim.** «Каналов нет» would be the
product asserting something it does not know; the test refuses any wording that
says so.

**Five mutations, five red**, four in `server-channel-rail.test.mts` and the
fifth in the spec: dropping the `failed` short-circuit from `railIsOffered`,
restoring `ready: voice.ready`, not drawing the sentence, wording it as «Каналов
нет», and — the one that needed an end-to-end test because no unit reaches a
React hook — `const failed = false` in the hook itself. The spec's fixture
answers the rooms read with a 500 for that one.

---

## D-194 `[x]` Escape does not close the conversation in a one-pane window

**Severity:** low for a phone, which has no Escape key and a back control in the
header; real for a desktop window narrowed below `md`, where the same one-pane
shell is what a person gets and the keyboard is the only pointerless way out.

**Reproduction:** `tests/e2e/chat-list-event-cost.spec.ts` at
`chromium-mobile-390`, the test at `:243`. Its `leaveChat` helper blurs the
active element, presses Escape and asserts the composer dock is gone. It fails —
and passes at `chromium-desktop-1440` with the same code. Two of that spec's
tests are red on 390 for this one reason, and were red before the day's work:
proved by swapping the changed files for their `HEAD` versions and re-running.

**Surface:** `artifacts/kub/src/components/layout/MainLayout.tsx:40-65` — one
`keydown` listener on `window`, not width-gated:

```ts
if (event.key === "Escape" && !isEditable && !hasBlockingOverlay && selectedChatId) {
  event.preventDefault();
  setSelectedChatId(null);
}
```

**What has been measured, so the next person does not repeat it.** At the moment
of the press, on 390, with the conversation open:

| | |
| --- | --- |
| `document.activeElement` | `BODY` — so `isEditable` is false |
| `[role="dialog"], [role="menu"], [data-kub-popover="true"], [data-kub-menu="true"]` | **`[]`** — so `hasBlockingOverlay` is false |
| after the press | the conversation is **still open** — photographed, not inferred |

So the two guards that could refuse are both false, `selectedChatId` is
obviously set, and the handler still does not close the chat. What is left is
`event.defaultPrevented` set by an earlier listener, or `updateBlocking`, or the
listener not being attached in this shell at all. **None of those has been
measured yet**, and the entry is open rather than guessed at.

**A false trail worth recording**, because it cost two probes: a first reading
said the chat list had six rows and no `[data-testid="chat-window"]`, which read
as «the chat closed but its composer dock stayed behind, painted over the
list» — a much worse defect than the real one. Both halves were wrong.
`data-testid="chat-window"` **does not exist anywhere in the product**, so
counting zero of them measured nothing; and on a phone both panes live in the
DOM with one hidden, so the list's rows are always there. The screenshot
Playwright had already written settled it in one look. *Count only what you have
confirmed exists, and look at the picture before building a theory from
`querySelectorAll`.*

**Also noticed while measuring, and not part of this:** the same spec's test at
`:305` skips itself on mobile with «a phone has one pane: leaving a chat is the
test above», so the author knew the shells differ here. The test at `:243` does
not skip, which is why this surfaced at all.

---

**Found and fixed the same day.** A trace of the event answered it in one run:

```
capture on window   prevented=false
bubble on document  prevented=true
bubble on window    prevented=true
```

Something between window-capture and document-bubble was calling
`preventDefault()`. It is **the composer's recorder-mode hint**: measured at the
moment of the press, one `[data-testid="kub-hint"]` and one
`[data-radix-popper-content-wrapper]` were mounted. Radix's `DismissableLayer`
listens on `document` in the capture phase and prevents the keydown for any
layer it has mounted, and `KubHint`'s `onEscapeKeyDown` dismisses the hint. So
one Escape was spent on a `role="status"` notice nobody opened, which expires on
its own — and the conversation could not be closed from the keyboard at all,
because on a phone that hint is up on arrival. It is the third defect this one
hint has caused today; D-190 is the second.

Trying to make the hint give the key back does not work: setting its
`onEscapeKeyDown` to `event.preventDefault()` — Radix's way of saying «I handled
it, do not dismiss» — left `prevented` true just the same. The layer prevents
the DOM event whatever its consumer decides.

**So the listener moved to the capture phase**, where it runs before Radix and
the decision returns to `hasBlockingOverlay` — which is what that check was
written to be: the one arbiter of whether something else wants this key. Its
list gained `[role="alertdialog"]` and `[role="listbox"]` on the way, because
those own Escape too and nothing else was going to refuse for them any more.
`role="status"` is deliberately **not** on the list.

`tests/e2e/shell-escape.spec.ts` pins both directions: with the hint up Escape
closes the conversation, and with a confirmation open Escape closes the
confirmation and leaves the conversation standing. The first test asserts the
hint actually appeared before pressing, so a run where it never showed cannot
pass for the wrong reason. Two mutations turn it red — the listener back on the
bubble phase, and the overlay guard dropped.

---

## D-167, closed on 2026-09-14 — what was actually wrong

The entry said the mute is «kept in the browser». Measured on production before
the fix, the truth was worse and the whole server half was already built:

- `public.chat_notification_preferences (chat_id, user_id, push_enabled, muted_until)`
  exists with four own-row policies. **It held 0 rows.**
- The upsert the client already performed **goes in**, and the same person
  **reads it back** — measured as `authenticated` with real claims inside a
  rolled-back transaction.
- `public._notification_push_allowed`, the gate every push passes, already reads
  it: refusing on `push_enabled is not true` **and** on
  `muted_until > now()`. **Timed mutes were honoured by the server and nothing
  wrote them.**

**So the defect was not «the mute is local», it was «the screen and the server
disagree, and the screen is the one that is wrong».** Muting on a phone really
did suppress push everywhere, while a second device read `localStorage` and
displayed «Отключить уведомления» — telling the person the chat was *not* muted.
Clearing the browser's data removed every mute from the interface and none from
the server. And `persistChatPushPreference` ended in a bare `catch {}`, so a
refused write left a mute that worked on one device and nowhere else with
nothing anywhere saying so.

**Fixed** by making the account the source: the interface reads the table, the
cache is refused once an answer has come back and refused outright when it
carries another account's id, four durations write the column the gate already
honours, every surface names when the mute ends, and a refused write puts the
previous state back and says one plain sentence. Twenty mutations, twenty red.

**One decision worth keeping:** the old `ng_muted` key is not read, not migrated
and not deleted. It is a bare array of chat ids with nobody's name on it, so
pushing it to the server on boot would be writing unverified data from a
possibly shared browser. Reading it was the defect.

**And one defect found in the fix's own pixels**, before it shipped: on the group
card the four durations and «Пригласить пользователя» stood in one undivided run
of rows, so the invitation read as a fifth way to mute the chat. Photographed at
1440 and 390. The choice is closed off by the card's own `--kub-rule` divider
while it is open, and only while it is open — a divider under a settled list
would be a section boundary the card does not have. The e2e measures the
computed border width in both states, and removing the rule turns it red.

---

## D-195 `[x]` The attach sheet stopped growing with what is picked, and its test has been red since

**Severity:** medium. Found on 2026-09-14 while checking that the D-194 fix broke
nothing: two tests of `tests/e2e/attach-sheet.spec.ts` are red, at
`chromium-mobile-390` **and** `chromium-desktop-1440`, and they are red without
that fix too — proved by reverting it and re-running.

**Reproduction:** `tests/e2e/attach-sheet.spec.ts:403`, «the sheet is as tall as
what it holds, grows with picks, and still closes by its handle and its dim».

```
Error: three picks did not grow the sheet
Expected: > 377
Received:   374
```

**Defect, and the first reading of it here was wrong.** This entry originally
said the sheet was «barely more than empty». It is not: 317 empty, 374 with
three picks, so it grows by **57px** and the test wants more than 60. Correcting
that is the point of re-reading a measurement before acting on it — «it stopped
growing» and «it grows three pixels less than a threshold» call for completely
different work.

What is measured so far, on `chromium-mobile-390`: the picks sit in a
**three-column** grid, `112.66px` per column with a `6px` gap, each pick
`113×113`, and the container holds five cells — two entry buttons and the three
picks — measuring 307px. Two entries and three picks in three columns is two
rows, and two rows of 113 with a gap between them is 232, which does not
reconcile with a 57px growth on its own. **So the arithmetic is not understood
yet**, and neither the product nor the threshold should be touched until it is.

Three things it could be, none of them confirmed: the entry row shrinking when
picks join it, a maximum height the sheet reaches before the second row is
fully drawn, or a threshold written against a grid that had a different column
count. The last one would make this a stale test rather than a defect.

**Why it matters beyond the number.** The test's name lists three claims and the
height is the first of them, so «still closes by its handle and its dim» — two
ways out of a sheet on a phone — **has not been checked since this went red**.
That is the register's own lesson about a guard failing early: what a long-red
test stopped checking is worth more than the failure itself.

**Not measured yet:** when it went red, and whether the two closing gestures
still work. Both need the same run, once the height is understood.

---

## D-196 `[x]` The handle between the panes was a black strip, and it dragged 73 pixels behind the pointer

**Severity:** high, and reported by the owner on 2026-09-14 with a screenshot:
«она чёрная и её видно явно в отличии от telegram где полосочка … "вшита" в
грань и работает плавно, у нас она почему-то теперь не позволяет плавно менять
размер в группах, пользователи сразу становятся аватарками без возможности
вытянуть обратно».

Two defects in one control, and the second one is why it felt broken.

**One: it was a column, not a grip.** `ChatListResizer` was a flex sibling
between the left region and the conversation, `w-1.5` — six pixels of layout
between the two panes, showing the application's own ground through the gap. In
the dark theme that is a black strip down the seam. Telegram's grip is not a
column between the panes; it sits **on** the edge and takes no width. This one
does now: absolute, nine pixels wide, centred on the region's right border by
repeating the region's own width expression in `left`. The border stays the
region's.

**Two: the arithmetic wrote the region's width into the column's variable.**
`.kub-left-region` is `calc(72px + var(--kub-chat-list-width) + 1px)` — the
folder rail, the column, and a hairline. The handle measured the pointer's
distance from the **region's** left edge and wrote that straight into
`--kub-chat-list-width`, under a comment saying the rail «is already in it and
the arithmetic does not have to know the rail exists». It is in it, which is
exactly why the arithmetic had to take it out.

The cost was 73 pixels of lag on every frame: grabbing the handle and moving
three pixels jumped the list 73px wider, and dragging left crossed
`CHAT_LIST_COLLAPSE_BELOW` while the pointer was still deep inside the list —
so the column dropped to the strip of avatars long before the handle reached the
point where that is meant to happen, and pulling back out needed the pointer
73px further right than the grip. That is exactly «сразу становятся аватарками
без возможности вытянуть обратно».

**And the test agreed with the defect, which is why nothing caught it.**
`dragListTo` in `tests/e2e/desktop-shell.spec.ts` moved the pointer to
`region.x + width` — the same off-by-the-rail as the product — so the two errors
cancelled and sixteen tests passed over a control that did not work. The helper
now aims at `region.x + REGION_CHROME + width`, which is where the column's edge
actually is.

*A test written against the same misunderstanding as the code cannot find it.
The number to aim a drag at is the thing being measured, not the box it is
inside.*

**Pinned by two mutations, each red:** restoring the origin to the region's own
edge breaks two width tests, and turning the handle back into a flex column
breaks the new «the handle sits on the seam and takes no width of its own»,
which measures that the panes are not pushed apart and that the grip is centred
on the edge it drags.

---

## D-125, D-126 and D-127, closed on 2026-09-14 — one gap seen three ways

These were filed as three interface defects. They are one: **the bot platform
was built entirely from the bot's side.** A bot can send an inline keyboard,
register its commands and be put into a chat, and every one of those paths is
`service_role`. Nothing let the person act, which is why a keyboard could not be
pressed, a command list could not be seen and a bot could not be opened.

Measured on production rather than off the migration files:

- `public.bot_update_enqueue_internal` is the only writer of
  `private.bot_updates`. Its `callback_query` branch is complete and already
  checks membership, the bot's presence and the history window — but it takes
  the actor **inside `p_context`** and trusts its caller. That is exactly why it
  could only be `service_role`: opening it would let one member of a chat press
  a button in another member's name.
- `public.chat_bot_members` grants `authenticated` SELECT and nothing else.
- `private.bot_callback_answers` is revoked from **every** role, `service_role`
  included.

`20260914150000_bot_press_and_bot_chat.sql` adds the two wrappers that were
missing and nothing else. Neither takes an actor: both read `auth.uid()` and
refuse without one, which is the whole reason they exist rather than a grant on
the internal function. `bot_callback_press` also checks that the data belongs to
a button actually on that message — the internal branch bounds the length and
nothing else, so without it a member could send a bot any string at all.

**What is still not there, and is not pretended away:** the bot's *answer* to a
press cannot be read by anyone, so a successful press says «Готово» rather than
what the bot replied. `readCallbackAnswer` already returns that for anything
that is not an object, so the day `bot_callback_answers` becomes readable the
sentence improves with no client change. That gap is recorded here rather than
filed as a fourth entry, because it is the same gap: the answer, like the press,
was only ever built for the service.

**And D-125's own proposal was wrong.** It said a URL button opens its link.
`private.bot_inline_keyboard_valid` requires each button to carry exactly `text`
and `callback_data`, so a URL button cannot exist in this database, and the
public `BotDocsPage` never promised one. The parser refuses it rather than
drawing a shape the schema forbids.

---

## Audit note, 2026-09-14 — entries fixed under another number

D-128 and D-131 were both closed today after being found fixed days earlier by
work filed under a different entry: D-128 by D-163's commit `14854cc`, D-131 by
D-122's attach-sheet merge `faa32bc`. Twice in one day is a pattern rather than
a coincidence, and the reason is worth stating once: **an entry whose fix arrives
under another number is closed by nobody, because whoever fixed it was reading
the other number.**

So the register's open count has been wrong, and the way to find the rest is
mechanical. Of the 34 entries open before these two closed, **18 are named by at
least one commit**. Most of those are the docs commits that filed them, but
seven are named by a `fix` or a `feat`:

| entry | commit that names it |
| --- | --- |
| D-111 | `f91eed3 feat(chat): option C …` |
| D-130 | `ed6648d Merge the recording work … (D-130)`, `cde8635 fix(chat): …` |
| D-133 | `a99a5c7 fix(admin): ask before the far-reaching press …` |
| D-157 | `84963d1 feat(search): the filter row says it continues …` |
| D-158 | `05fc53f feat(hints): two things the interface could do and never said` |
| D-168 | `d424f96 feat(chat): a member list says who its people are …` |
| D-182 | `e6006f5 feat(voice): slice 1 …` |

**None of those seven has been verified**, and a commit naming an entry is not
evidence that it closed it — D-133 is explicitly partial, and several of these
may have fixed one half of a two-part entry. The next audit pass reads each
entry's stated defect against the shipped source, the way D-128 and D-131 were
read, and closes only what it can see is gone.

---

## D-130, closed on 2026-09-14 — the third entry fixed under another number

Read against the shipped source rather than against the commit that names it,
which is the method the audit note above sets out. All three of its complaints
are gone, and the first was answered by the owner choosing a different mechanic
rather than the one the entry proposed.

*«a sideways slide is ignored, so an accidental recording cannot be abandoned».*
`lib/recordingGesture.ts` records the owner's own words — «них просто кнопка
посередине - отмена» — and says plainly what follows: «there is no cancel
threshold … cancelling is no longer a distance, it is a button». A centred
«Отмена» catches the release, with 12px of padding outside its own box for a
finger that lands just off it. `RecordingRelease` carries `cancel` as one of its
five outcomes.

*«every release … raises the modal «Запись слишком короткая или пустая.»».* That
modal is gone; `recordingGesture.ts:309` names it as the thing the short-press
hint replaced, and the sentence survives only as an inline `setLocalError` in
`VoiceRecorder.tsx`, which is a line under the control rather than a box over
the conversation.

*«a second recording is refused with another modal».* One `showAppAlert` is left
on this path and it is for the three device failures — permission refused, no
microphone, a browser without recording. Those are worth a modal: a person
cannot act on them from the composer, and the alternative is a control that
silently does nothing.

**Not closed by this:** nothing about the tray's «Готово к отправке» is claimed
here, because `RecordingRelease` has a `send` outcome and a `lock` outcome and
the entry's own wording conflates staging with failing. If parking is still
wrong for some release, that is a new entry with its own reproduction.

---

## D-197 `[x]` Three of the five staff accounts could not ban or mute anybody, and two of them are the owners

**Severity:** highest. Moderation was unavailable to the majority of the people
who are supposed to do it, and unrecoverable from inside the product.

**Surface:** `public.enforce_sanction_matrix()` (trigger
`trg_enforce_sanction_matrix_bans` / `_mutes`) and
`public.enforce_role_change_matrix()` on production; the client side is
`artifacts/kub/src/pages/admin/UsersTab.tsx:367` and
`artifacts/kub/src/pages/admin/BanModal.tsx:61`.

**Defect:** two layers guarded the write and did not agree about who staff is.
RLS (`managers insert bans`) asks `is_manager_or_admin`, which knows the legacy
`profiles.role` column **and** the four global role keys. The BEFORE INSERT
trigger, which runs after RLS has admitted the row, knew only
`profiles.role in ('admin','manager')` and never consulted `has_global_role`.
The trigger runs last, so it decided.

**Evidence:** the population, read off production —

    rls_says_staff | trigger_says_staff | people
    f              | f                  | 13
    t              | f                  |  3     <-- the gap
    t              | t                  |  2

and the behaviour, measured with impersonated claims inside a rolled-back
transaction: the ban insert was refused with «Только администратор или менеджер
может применять санкции» for a gap account and succeeded for a
`profiles.role='admin'` control.

**Consequence:** a moderator opens «Пользователи», fills in a reason and a
duration, presses the red button, and is told they are not an administrator
while holding «Владелец». `enforce_role_change_matrix` has the identical shape,
so the control that would grant the legacy column is behind the same wall. The
only way out was SQL.

**Fix:** `20260915120000_sanctions_see_the_whole_role_system.sql`. Both triggers
now rank people through `public.roles.priority` via `has_global_role`, so the
legacy column keeps working and the global roles participate. The **target**
side is ranked too — widening only the caller would newly let a manager sanction
an owner. DELETE is guarded as well; it carried no matrix at all, so a person
who could not issue a sanction could still lift one.

**Verified:** rehearsed on production with the defect reproduced first and every
control measured in both phases, then applied after a verified schema backup.
Afterwards RLS and the matrix agree for all 18 accounts and four triggers exist.

**Left open deliberately:** the client's `canSanction` still reads the legacy
column for the target, so a manager would see an enabled button for an owner and
get a refusal rather than a disabled control. Every staff account measures rank
100 today, so that branch is unreachable on this deployment — recorded as
D-200 rather than built.

---

## D-198 `[x]` A refused read told a banned person they were not banned

**Severity:** high. Structural rather than currently firing — `bans` and `mutes`
both hold 0 rows today.

**Surface:** `artifacts/kub/src/hooks/useBanState.ts` and
`artifacts/kub/src/hooks/useMuteState.ts`.

**Defect:** both read with `const { data } = await …` and never destructured
`error`, so a refused read produced `data = null`, an empty row list, and
`banned: false` / `muted: false` — the same answer as a successful read that
found nothing.

**Consequence:** fifteen tables carry restrictive «block banned» policies, and
those answer with **emptiness rather than an error**. So a banned person whose
read fails is handed the whole product with every list empty and every write
rejected, the «Вы заблокированы» overlay never appears, and no screen anywhere
says why.

**Fix:** a refusal now keeps the last known verdict, reports itself through the
`listReadView` vocabulary that already existed for this defect class (D-140),
and is retried with backoff instead of being settled as an answer. The decision
moved to `artifacts/kub/src/lib/sanctionRead.ts` because a choice made inside a
hook that needs Supabase and Realtime cannot be reached by `node --test`.

**Verified:** `tests/unit/sanction-read.test.mts`, proved by three mutations — a
refusal reporting «ready», a refusal blanking the verdict, and the expiry
comparison written so an unreadable date becomes a sanction that never ends.

---

## D-199 `[x]` The repository could not reproduce the published Android release

**Severity:** high for release operations; invisible in the product.

**Surface:** `android/version.properties`.

**Defect:** the catalogue has served android **0.1.4 build 5** since
2026-09-04. `main` carried `VERSION_NAME=0.1.2 / VERSION_CODE=3` and the
integration branch `0.1.3 / 4`. The bump that made the published build lives on
`codex/android-release-0.1.4`, which was never merged.

**Evidence:** the published APK embeds `VITE_APP_COMMIT`; reading it out of the
artifact downloaded from the catalogue gives `ff5892d39ca9`, whose subject is
«release(android): cut 0.1.4 build 5 to restore push» and which
`git merge-base --is-ancestor` puts on neither `main` nor the integration
branch.

**Consequence:** a build from `main` produced `versionCode 3`, and Android
refuses to install a lower versionCode over build 5. The update path was broken
at the repository, not at the device.

**Fix:** bumped to `0.1.5 / 6`, cut, published and verified; the three unit
assertions that pin the canonical version were updated with it. That the version
is hardcoded in three separate test files is part of why it drifted.

---

## D-200 `[ ]` The users tab offers a manager a button the database will refuse

**Severity:** low while it is unreachable; it becomes real the moment anybody is
given `manager` without `admin`.

**Surface:** `artifacts/kub/src/pages/admin/UsersTab.tsx:367` —

    const canSanction = (target: Profile) =>
      target.id !== currentUser?.id && (isAdmin || target.role !== "admin");

**Defect:** the target test reads the legacy `profiles.role` column, while the
database (after D-197) ranks the target through `public.roles.priority`. A
manager therefore sees «Заблокировать…» enabled for somebody who is an owner by
global role only, and gets «Менеджер не может применять санкции к
администратору» after filling in the form.

**Why it is not urgent:** every one of the five staff accounts measures
`effective_global_role_priority = 100` today, so no account takes the manager
branch. Measured, not assumed.

**What a fix needs:** the tab already loads `dynamicRolesByUser` and has
`dynamicRoleRank`, so the data is present; the missing piece is ranking the
target the way the database now does, rather than reading one column.

---

## D-201 `[x]` The presence dot floats beside the avatar instead of sitting on it

**Severity:** low and cosmetic, but on every avatar the product draws at `md`
and above, in both themes.

**Surface:** `artifacts/kub/src/components/ui/ChatAvatar.tsx` — both the chat
avatar and `UserAvatar`, each drawing
`absolute bottom-0 right-0 h-2 w-2 rounded-full`.

**Defect:** the dot is anchored to the corner of the **square** the avatar is
drawn in, while the avatar is a **circle** inscribed in that square. An 8px dot
at `bottom-0 right-0` has its centre at `(W-4, W-4)`, which is `sqrt(2)·(W/2-4)`
from the middle — so how far outside the rim it lands grows with the avatar:

| size | width | centre distance | rim radius | outside by |
| --- | --- | --- | --- | --- |
| `sm` | 32 | 16.97 | 16 | 0.97px |
| `md` | 48 | 28.28 | 24 | 4.3px |
| `lg` | 64 | 39.60 | 32 | 7.6px |
| `xl` | 80 | 50.91 | 40 | 10.9px |

**Consequence:** at `sm` the dot's own radius hides the error and it reads as a
badge. At `xl` — the size the person's card uses — it sits nearly eleven pixels
clear of the rim and reads as a stray green mark floating beside the avatar
rather than anything attached to it. Seen in the card capture taken for D-168.

**Fix:** the inset is now `calc(14.645% - 4px)` on both axes, `14.645%` being
`(1 - sqrt(2)/2)/2`, which puts the dot's **centre** on the circle at every
size. Measured on the rendered list afterwards rather than trusted: the dot's
centre is 14.87px from a 16px-radius avatar's centre, at 42.3° — on the rim,
lower right.

**Not changed:** `ChatListItem.tsx` draws its own dot the same way on a 32px
avatar, where the error is under a pixel, and `edge-vocabulary.test.mjs` embeds
that exact class string inside a mutation it needs to find. Left as it is
rather than break a guard for an invisible difference.

---

## D-202 `[x]` Three meanings of «staff» meet on the folders screen

**Severity:** low today and latent — all 8 folders on this deployment are
`personal`, so nobody is currently losing a control. The disagreement is real
and was proved against production.

**Surfaces:**

- `artifacts/kub/src/hooks/useFolders.ts:91` — `role === "admin" || role ===
  "manager"`, the **legacy column only**, used by `canManageFolder` to decide
  whether a `shared` folder shows edit and delete.
- `artifacts/kub/src/components/sidebar/FolderEditModal.tsx:39` — the **wide**
  client `isStaff`, which decides whether the scope selector offers «shared» at
  all.
- The database: `folders insert/update/delete scope-aware` all ask
  `is_manager_or_admin(auth.uid())`.

**Consequence:** one of the three accounts from D-197 is offered the shared
scope by the modal, the database accepts the insert, and then the folder has no
edit and no delete control because `useFolders` says they are not staff. Proved
by an insert inside a rolled-back transaction: `SHARED FOLDER INSERT SUCCEEDED`
where the interface hides both operations.

**The obvious fix is wrong, and this is the part worth keeping.** Reaching for
`useIsManagerOrAdmin()` swaps one mismatch for its mirror image: that predicate
is **wider** than `is_manager_or_admin`, because it also admits anybody holding
one of `STAFF_ACCESS_PERMISSIONS`, which a *location* role can carry with no
global role at all. `lib/moderationAccess.ts` exists for exactly this gap and
says so in its own header. Using `isStaff` here would start showing controls the
database then refuses — the same defect pointing the other way.

**What a fix needs:** the predicate that already mirrors the database is
`canReadModerationQueue` in `lib/moderationAccess.ts`; it is named for the queue
but it is really «matches `is_manager_or_admin`», and folders want the same
rule. So the fix is to generalise that name rather than write a fourth spelling
of one predicate — and then give `useFolders` the caller's global role keys,
which it does not read today. That last part is the actual cost, and it has to
respect the anti-storm rule the comment at `useFolders.ts:80` records: the hook
subscribes to primitives only, so a new dependency must be a primitive or a
stable reference, or it will re-fetch on every heartbeat echo.

**Not fixed now** because it costs nothing today and the careless version of the
fix is worse than the defect.

---

## D-166 — how it was closed, 2026-09-15

Closed by `20260915140000_a_group_says_who_came_and_went.sql`, and **not** by
the route the entry proposed. Loosening `audit_logs` would hand a group's
members a slice of a global audit table; Telegram and Discord both show these
lines to everybody in the room instead.

The channel used was already built and never used: `messages.type` accepts
`'system'`, `messages_sender_shape_check` *requires* such a row to carry
`user_id IS NULL` and `bot_id IS NULL`, `enqueue_message_notifications` returns
null on its first line for one so nothing is pushed, and the client already
draws it — `resolveMessageActor` answers `{ kind: "system" }`, `MessageList`
routes on `type` before touching a sender, and `SystemMessageNotice` renders a
centred pill. No client can write one, so it is a trigger.

Six lines, measured in a rolled-back rehearsal on production:

| event | line |
| --- | --- |
| somebody else adds them | «АКТЁР добавил(а) в группу: УЧАСТНИК» |
| removed by that person | «АКТЁР исключил(а) из группы: УЧАСТНИК» |
| they join themselves | «УЧАСТНИК присоединился(ась) к группе» |
| they leave themselves | «УЧАСТНИК вышел(а) из группы» |
| the service adds them | «УЧАСТНИК присоединился(ась) к группе» |
| the service removes them | «УЧАСТНИК больше не в группе» |

The first rehearsal read «АКТЁР добавил(а) УЧАСТНИК», which is ungrammatical —
Russian wants the accusative for a direct object and SQL has no declension. A
colon now introduces a name that would otherwise be an object, which licenses
the nominative for every name.

**Four silences, each deliberate:** role changes (both products keep those in an
admin log, and one ownership handover moves two rows), private chats and
therefore every bot chat, a group's own creation, and a chat being deleted.

**Left open by this:** a group's members still cannot read the *history* of who
came and went before today — the service lines start now. The record in
`audit_logs` remains unreadable to them, and deliberately so.

---

## D-202 — how it was closed, 2026-09-15

Not with `useIsManagerOrAdmin()`, for the reason the entry gave. Two new pure
modules instead:

- `lib/serverRoleAccess.ts` — `matchesIsManagerOrAdmin` and `matchesIsAdmin`,
  copies of the two database functions with both production bodies quoted in
  the header. `lib/moderationAccess.ts` keeps its name and all three exports and
  now delegates, so the queue's own meaning and its test are untouched.
- `lib/folderAccess.ts` — a copy of the three `folders` policies.

`useFolders` and `FolderEditModal` now ask the same predicate, so the sidebar
and the modal can no longer tell one person two different things.

**A fourth narrow spelling was found while fixing the third.** `canManageFolder`
gated the `system` scope on `role === "admin"`, while the policy uses
`is_admin` — a different function from `is_manager_or_admin` (it excludes
`manager`). Mirrored too. Zero `system` folders exist.

**Deliberately not copied:** the older permissive `Users can manage own folders`
(`ALL USING auth.uid() = user_id`), which ORs with the scope-aware policies. It
can only widen the answer where `created_by <> user_id`, a shape the insert
policy cannot produce and production does not have.

**F-8 closed with it.** `legacyRoleHasPermission` was untestable rather than
untested — it sat inline in `useRole.ts`, which imports React, the store and
supabase-js, so no `node --test` process could reach it. It is now
`lib/legacyRolePermissions.ts`, and the missing `folders.manage_shared` is back:
23 keys for legacy `admin`, matching the database exactly.

**Anti-storm rule respected, and proved structurally rather than by scan:**
`fetchFolders`'s dependency array is byte-identical (`[userId, supabase]`), and
the new inputs are destructured booleans, which have no identity to rotate a
`useCallback`. Verified independently.

---

## D-203 `[x]` Three list surfaces drew a refused read as «ничего нет»

**Severity:** medium, and the defect class this project already named D-140,
fixed twice per-surface and never generalised.

**Surfaces:** `hooks/useTasks.ts`, `hooks/useChats.ts`, `hooks/useTopics.ts` —
and `hooks/useMessages.ts` for pinned messages, closed alongside. `useChats` did
not even destructure `error`; `useMessages` went further and *asserted* the
empty answer was final.

**Consequence:** «Чаты не найдены» is a claim about an account, made out of a
question that never got an answer — while the memberships read immediately above
it had just proved the person has chats. For a banned person every list is empty
anyway, because the fifteen restrictive «block banned» policies filter rather
than raise, so there is no error to catch and nothing on screen to explain it.

**Fix:** `lib/listReadState.ts` — the module that already existed for this class
— gained one fact a hook needs and an admin tab does not: **whose answer this
is**. A refusal keeps the rows only when they answer the *same* question;
rows read for another conversation are not a stale answer to this one, they are
its absence. Without that, a forum with a refused read would draw the previous
chat's channels.

**Verified:** 19 unit tests for the transitions, 30 mutations across 9 files,
**five of which were green at first and exposed real holes in the tests** — a
short source pattern that matched a second occurrence lower in the file, a lazy
`[\s\S]*?` that ran into the next block and found the same words there, and a
notice left behind `{false && (` that still satisfied a `data-testid` check.
Then `tests/e2e/chat-list-refusal.spec.ts`, because none of the new states had
ever been drawn in a browser: it renders the refusal in both themes and, more
importantly, **measures that the wrapper added around `ChatList`
(`flex min-h-0 flex-1 flex-col`) did not break its scroller** — the one claim in
the change that had been reasoned from class names. 4/4 at 1440 and at 390.

**Not covered, and not faked:** the `stale` rendering. Reaching it needs a second
read refused after a first succeeded, and nothing a test can trigger from the
page does that. An `.or(...)` assertion covering both outcomes was drafted and
thrown away — it would have passed whatever the product did.

---

## D-204 `[x]` The one refusal reactions can produce was unreachable, after the screen had already changed

**Severity:** medium-low. An unusually clean specimen: the product built the
sentence and then made it unreachable.

**Surface:** `hooks/useMessages.ts` and `lib/messageReactions.ts`.
`lib/errors.ts:78` has carried «На это сообщение больше реакций поставить
нельзя.» all along; nothing could raise it. Both writes sent their errors to
`console.error`, there was no rollback of the optimistic paint, and the client
held the per-message limit as a **hardcoded constant** while the database holds
it as a **per-user function** already parameterised for an entitlement.

**Corrected from the audit, measured:** production *has* `set_message_reaction`,
so the DELETE-then-INSERT race the audit called live is not live here — the RPC
is tried first. What was live: on the RPC path the refusal reached only the
console, and the guess stood until a fall-through refetch repaired it. The
person saw their reaction change and silently revert, with no explanation.

**Fix:** the refusal rolls back to exactly the reactions that were on screen and
says why, in the composer's existing refusal line rather than a second channel.
The limit is now asked of `public.reaction_limit_per_message()` once per
account, defaulting to 1 and never blocking the paint.

**One mutation stayed green and was worth more than the rest:** removing the
rollback changed nothing observable, because the chat revalidates itself after
2.5 seconds when Realtime never answers — a patient assertion passes over a
missing rollback. The assertion is now bounded to 1200 ms from the banner, and
goes red.

**Renamed afterwards:** the state is `actionRefusal`, not `sendRefusal` — it now
carries refusals that are not sends. `blockedSendRefusal` in
`lib/personalModeration.ts` keeps its name, because that one really is about
sending.

---

## D-205 `[ ]` Half the task RPCs learned about locations and half did not, so a location role's task grants are partly decorative

**Severity:** low while the feature is dormant — 0 live tasks, all 40 rows
soft-deleted, the last on 2026-07-13. It becomes real the moment tasks are used
again at a location. Split out of D-124 the way D-200 was split out of D-197:
the client half of D-124 is fixed and closed, and this is the half that cannot
be fixed on the client.

**Surface:** `public.task_confirm`, `task_reject`, `task_assign`, `task_cancel`
against `public.task_claim`, `task_soft_delete`, `task_update_v3`.

**Defect:** `public.roles` grants `location_admin` the keys
`tasks.manage`, `tasks.assign`, `tasks.create`, `tasks.claim`,
`tasks.view_admin_tasks` and `location_members.manage` for its location, and
`location_manager` a smaller set. Three task RPCs honour that —
`task_claim` asks `has_location_permission(…, 'tasks.claim' | 'tasks.manage' |
'tasks.assign' | 'tasks.create')`, `task_soft_delete` goes through
`_task_can_soft_delete`, and `task_update_v3` carries an
`is_location_admin(coalesce(p_location_id, v_task.location_id), v_caller)`
branch. The other four never learned the dimension and ask
`is_manager_or_admin(caller)`, which knows global roles and the legacy
`profiles.role` column and nothing about locations.

**Consequence:** somebody holding `tasks.manage` for a location may claim a task
there, edit it and delete it, but may not confirm, reject or assign it, and may
cancel only what they created. Measured behaviourally on production inside a
rolled-back transaction, with a control that succeeded — see the D-124 closure
note for the four lines. There is no interface bug left to fix: the client now
mirrors each RPC exactly, so the person sees precisely the controls the database
will accept.

**Why this is not simply «widen the four».** It is a product question, not a
repair. Either the role catalogue means what it says — in which case four
functions need a location branch, and `tasks.manage` for a location has to be
defined against `created_for_admin`, `target_role` and `route_admin_id` routing,
which `_task_assert_location_routing` already guards — or the grants on
`location_admin` are wrong and should be trimmed. **Both are owner decisions**,
and the same question is open one table over in D-123, where all four
`location_members` write RPCs require global `is_admin` while `location_admin`
holds `location_members.manage`. The two should be decided together.

**Do not widen only the caller side.** D-197 is the precedent: the sanction
matrix was widened on both the caller and the target because ranking one alone
would have opened a worse hole than it closed.

---

## The media cluster, verified and closed on 2026-09-15

A survey of the six media entries, measured against the shipped code rather than
taken from the entries' own words. **The register's «fixed on the branch, not
deployed» caveats were stale**: `584a38f`, `e6a36c4`, `faa32bc` and `c1a1d2d`
are all ancestors of `origin/main`, and the tester's report was against
`45971c6`.

| Entry | Verdict |
| --- | --- |
| D-113 a video does not send | **already fixed and deployed.** Verified *wired*, not merely present: the failure description and per-attachment isolation are reached from `ChatWindow`. Residual — an upload while the installed iPhone app is backgrounded — needs a device. |
| D-114 a 300 KB photo is slow | **already fixed and deployed.** Three-way upload concurrency with strict pick-order insertion. Residual needs a device. |
| D-122 the attach sheet | **already fixed.** All seven acceptance points shipped. Bookkeeping only. |
| D-116 WebP and zoom | **complete, 2026-09-15.** The worker *is* deployed with the rule — `fkd10qwlo4qod9e6gtyzzuwk` runs `9049376`, which carries both the short-side floor and the backfill module. And the backfill was not forty previews but **one**: measured, not remembered. It is done, and `image_preview` rows went 172 ready to 173 with none stale. |
| D-095 a photo's worker copy never arrives | **was still real. Fixed.** |
| D-195 the attach sheet stopped growing | **was still real. Fixed, and finally diagnosed.** |
| D-115 albums | **still real, not started.** |

### D-195, the arithmetic the entry said nobody understood

Measured in a browser at both viewports. At 390: the empty sheet is 317 points,
a sheet with picks is 374. The panel grows **+134**, while the tab capsule
(60px plus padding, **−78**) leaves the flow for the send capsule, which floats
and reserves 76px *inside* the scroller. Net **+57** against a threshold of 60;
at 1440 it is +59.

It went red on 2026-09-13 in `e8af325` — the video quality ladder — which
**correctly** replaced the gallery's fixed 96px reserve with a measured 76px
one. Those 20 points are the whole deficit: the threshold had been calibrated
against an over-reserve. The product was right and the number was wrong. The
magic number is replaced by the claim it stood in for — every pick drawn clear
of the floating capsule, and the picks wrapping onto a second row — proved by a
mutation that shrinks the reserve while still growing the sheet, which goes red
at exactly −39px.

A correction to the entry itself: the two closing gestures it worried about run
*before* the failing line. What actually went unchecked for a day is the
confirm-before-discard path after it.

### D-095, and the comment that was wrong twice

The gate was `!entry.hasVideoMessages`, standing in front of the D-176 rule, and
its justifying comment was wrong twice for a *received* photograph: the single
entry query runs before the worker has written anything, and the sender-side
preview exists only for an «Оригинал» send. Removing the gate alone would have
left a photograph waiting the full video minute, so pictures got their own pace
— five seconds, chosen by what is outstanding, so a chat still waiting on a
transcode keeps the minute untouched. D-176's bound and backoff are unchanged.

---

## D-206 `[x]` Five media e2e specs were already red, three of them from one day's wave

**Severity:** medium for the suite's honesty; no product defect is claimed for
three of the five.

**Found** while verifying the media cluster, and proved to predate that work by
reverting it and re-running: identical 5 failed / 13 passed.

- `media-cache-reuse`, `media-gallery-variants` — sign-in specs needing
  production QA credentials rather than the fixture server. Not product defects;
  they should say so rather than fail.
- `media-send-path` «a photo goes as a JPEG» — expects 1600×1200 and gets
  1440×1080, which is D-174's «a photograph goes at SD unless the sheet is told
  otherwise» (`ab69dfe`, 2026-09-13). A stale test, not a defect.
- `media-send-without-compression` ×2 — a strict-mode violation: «Оригинал»
  resolves to two elements because `mediaOriginality.ts` defines both `badge`
  and `compactBadge` with that word. **Almost certainly a loose locator rather
  than a duplicated visible label — but that was not confirmed**, and until
  somebody checks which of the two is visible it stays a suspicion.

**Why it is one entry:** three of the five broke in the same 2026-09-13
quality-ladder wave that broke D-195. A day's work moved four measured numbers
and the tests calibrated against the old ones were never re-read.

---

## D-207 `[ ]` The preview backfill marks rows for a worker that stopped looking for them

**Severity:** medium, and latent until somebody runs the script — which is
exactly when it will not be noticed.

**Surface:** `scripts/media-preview-backfill.mjs`, and
`artifacts/api-server/src/workers/mediaVariantsWorker.ts`.

**Defect:** the script's whole mechanism is to flip an `image_preview` row from
`ready` to `stale`, on the stated grounds that this «puts a message back into
the worker's candidate set». That was true when it was written. `6a26bc8` —
«the pipeline is told about work instead of hunting for it every minute» — made
the worker consume `private.media_variant_jobs` and nothing else. **It does not
look for `stale` rows any more.** So the script marks rows and nothing ever
regenerates them.

**Consequence:** `useMediaVariants` skips any row that is not `ready`
(`useMediaVariants.ts:285`), so each marked picture silently falls back to its
full-size original — the very thing D-116 was about — and stays that way.
Nothing reports it: the script prints `marked_stale N` and exits successfully.

**Measured, 2026-09-15, not reasoned.** Running it with `--apply` on production
flipped one row. A minute later `private.media_variant_jobs` held **0 rows** and
the variant was still `stale`. A job inserted by hand was consumed at once and
the row returned to `ready` — 172 ready before, 173 after, none stale.

**Two things the fix has to deal with.** The queue is owned by `supabase_admin`
and `postgres` is not a member, so a plain `psql -U postgres` insert is refused;
and the script reaches the database through PostgREST with the service role,
which cannot see the `private` schema at all. So the script cannot enqueue
directly — it needs either an RPC of its own, or to touch `messages.media_path`
so that `trg_enqueue_media_variant_job_on_update` fires, which is the product's
own path and therefore the one that cannot drift.

**Not fixed now**, deliberately: there is nothing left to back-fill, so any fix
would ship untested end to end. A warning naming this entry is in the script's
header instead, where the next person to run it will actually read it.

---

## D-208 `[ ]` Every photograph, voice message, video and avatar is readable by anyone with the address

**Severity:** highest of anything open. Real user media, live, no credentials
needed.

**Surface:** the `media` bucket. `storage.buckets` says `public = true`, and it
holds **all 771 objects** — every photograph, voice message, video and avatar in
the product. `chat-media`, the private bucket with a size cap and a MIME
allowlist, holds **zero**, because `stagedAttachments.ts:92` sets
`CHAT_MEDIA_BUCKET = "media"`.

**Measured, and calibrated in both directions:** an anonymous request with no
token for one real object returned **200 and 5,666 bytes of `image/webp`**; an
invented path in the same bucket returned **400**. So the probe distinguishes,
and the bytes really do come out.

**The ten RLS policies on `storage.objects` are correct** — the audit proves
them so, measured as `authenticated` rather than as the table's owner. They
govern the authenticated route. The bytes leave by the public one.

**Why it is worse than «somebody needs the URL».** Preview paths are
*derivable*: `variants/messages/{chat_id}/{message_id}/{kind}` is four leaf
names from two ids any member of the chat already holds. The original's path
carries a random UUID, and its own previews undo that. There is also no
revocation of any kind — leaving a chat, deleting the message and being banned
all change nothing.

**What is NOT the defect:** the missing MIME allowlist. Sending an arbitrary
file is a shipped feature (`attachSheet.ts:179` sets `accept: null`,
`messages.type` carries `'file'`), and `chat-media`'s allowlist is itself
missing `video/quicktime` — what an iPhone sends — and `audio/wav`. Copying it
across would refuse iPhone video and every file attachment. See the audit's
appendix; F-5 collapses into this entry.

**The fix, in an order that cannot be reversed**, with the counts measured:
the client stops using `getPublicUrl` at its seven call sites and resolves from
the path columns (293 of 313 media messages already have one); signed URLs get a
lifetime and a refresh, which is the real work; the 20 legacy `media_url`-only
messages and the 16 avatar URLs are back-filled; **and only then** the bucket
becomes private. Any other order takes every image in the product off the screen
until the client catches up.

Signed URLs are proved to work here: a signature returns 200 and a tampered
token returns 400.

**Waiting on the owner**, because the last step is outward-facing and breaks
things until the first has shipped. The first three steps are safe to build at
any time.

---

## D-106 — closed 2026-09-15, and it was closed by somebody else's work

Not fixed here: **already fixed by D-173**, and the entry had gone stale.

The entry says the spec «does not refuse to run without [the flag]» and that on
such a server «its "comes back once" check fails on seven fetches of the list».
D-173 split that bucket in two — the conversation's history and the list's
per-chat previews had shared one label because both are a `GET` on `messages` —
and gave the previews their own bound:

```ts
const previewBudget = backend.requests.includes("POST rpc/chat_list_summaries")
  ? 0
  : Object.keys(CHAT).length;
```

So the spec now counts either path and says which it saw, exactly as its header
claims.

**Measured rather than read.** A dev server was started deliberately *without*
`VITE_CHAT_LIST_SUMMARIES_RPC_ENABLED`, and the whole spec ran **9 of 9** at
1440, logging `list summaries: compatibility queries` on every measurement — the
fallback path the entry said it breaks on.

**The lesson is the entry, not the spec.** This is the fourth register entry
today found already closed, after D-113, D-114 and D-122. A commit that fixes one
defect often closes a neighbouring entry nobody thought to re-read, and the
register says so itself: a commit naming an entry is not evidence it closed it —
and the converse holds too.

---

## D-206 — closed 2026-09-15, and one of its two suspicions was wrong

All five triaged against the shipped code. **57 passed / 6 skipped / 0 failed**
across three projects, where 1440 alone had been 5 failed / 13 passed.

The «Оригинал» strict-mode violation was a **test** defect, and the entry was
right to record it as unconfirmed — because confirming it took a measurement.
With the word temporarily changed, the page reports `display` and box for both
spans: at 1440 one is `display:none` width 0 and the other `inline` width 38,
and at 360 they swap. Exactly one spelling is drawn at any width; `getByText`
matched both only because it does not filter by visibility.

**Behind that violation sat an older breakage the entry did not suspect.**
Further down the same helper the spec clicked «Открыть оригинал» and waited for
a new tab. D-147 removed both, and D-097 then made the control name the file.
The spec has therefore been red since **D-147**, not since D-097 — the second
span only moved where it fell over. A strict-mode failure is a poor diagnosis
precisely because it stops the test before the real disagreement.

---

## D-209 `[ ]` «SD» does not reach the photograph: the 1280 cap never binds

**Severity:** a product question rather than a defect, and it is open. Recorded
because the composition had never been written down.

**Measured from the shipped constants**, 2026-09-15:

| source | SD as shipped | what a 1280 long side would give | `balanced`, the old default |
| --- | --- | --- | --- |
| 4:3 | **1440×1080** | 1280×960 | 1920×1440 |
| 3:2 | 1620×1080 | 1280×853 | 1920×1280 |
| 16:9 | **1920×1080** | 1280×720 | **1920×1080 — identical** |
| square | 1280×1280 | 1280×1280 | 1920×1920 |

The long-side cap binds only below an aspect ratio of 1280/1080 = 1.185, which
is narrower than 4:3. So for every ordinary photograph the D-116 floor of 1080
decides, SD carries between 1.27× and 2.25× the pixels it would at 1280, and a
16:9 photograph goes at pixel-for-pixel what the old default gave it.

**Why nobody saw it:** 1280 and 1080 had never appeared in one call.
`photo-send-quality.test.mts` pins the profile, `photo-encoding.test.mts` pins
the floor and passes 1920 everywhere, and D-174's byte proof compares HD to SD
relatively rather than against a number.

The composition is now written down in `tests/unit/photo-send-size.test.mts`,
**as a record rather than an endorsement**, naming the two places that change if
the answer is «SD means 1280 on the long side». The product was not touched.

---

## D-210 `[ ]` Three more specs that cannot run and do not say so

**Severity:** low individually; the pattern is the point. Same class as the two
sign-in specs D-206 fixed.

- `media-viewer-actions.spec.ts:441` looks for `getByText("Громкость", { exact: true })`
  and no such exact text exists any more — the audio rework left «Громкость
  прослушивания» and a `title="Громкость"` on a control. Probably another stale
  test after that rework, **but it was not run down**, because settling it needs
  the audio-settings entries.
- `media-viewer-zoom.spec.ts` needs `VITE_PUBLIC_PREVIEW_FIXTURE=1`
  (`App.tsx:496`). Without it `/__qa/public-preview` answers `index.html` and the
  spec fails eight times without ever saying the flag is missing.
- **`pnpm run format:check` does not pass on HEAD**, on roughly twenty files
  nobody in this session touched. So biome is not currently a gate, and any
  report that claims it as one is wrong.

**The shape worth fixing once:** a spec whose prerequisite is absent should
refuse loudly, naming the prerequisite. `tests/e2e/helpers/backend-identity.ts`
now does that for the backend a spec is pointed at; the same is needed for a
missing feature flag, and `public-home-routing.spec.ts` already contains a
working example of failing loudly rather than skipping.

---

## D-112 — closed 2026-09-18, the half the messenger's shell did not own

The 2026-09-12 assessment cleared the messenger and left «Задачи» at 64%
deliberately: the reservation was applied by the messenger's *panes*, and the
pages are not panes. It named the remedy exactly — «applying `pt-window-top` to
the page shells is the navigation work's part of this entry, and the mechanism
it needs now exists» — and that is what this is.

The fix is one place rather than one per page. `KubHeader` is the header of the
only two surfaces that are not the messenger, «Задачи» and «Мои боты», and it
reserved the hardware inset only:

    h-[calc(3.5rem+var(--kub-safe-top))] pt-safe
    → h-[calc(3.5rem+var(--kub-safe-top)+var(--kub-window-caption))] pt-window-top

`--kub-window-caption` is `0px` everywhere but `data-desktop-shell="windows"`,
so nothing outside the Windows shell moves by a pixel. The material still runs
under the strip — the header's box starts at the window's top edge and its
*content* is padded below the caption, which is what `pt-window-top` does and
what `ChatHeader`, `FolderRail` and `SidebarHeader` have always done.

**«Мои боты» had it too**, and was not in the entry: it puts a «Документация»
link in the same corner. Found by reading the other consumer of the shared
header rather than by assuming the entry's list was complete.

**The ratchet flipped rather than being deleted.** `desktop-shell.spec.ts`
asserted the corner as the named set `["Новая"]`; it is now `[]` for both pages,
plus a measurement that the header's row really starts at the window's top edge
while the caption has height — the reservation rather than a coincidence of
layout. 17 passed at 1440, and the mutation that restores `pt-safe` fails with
`["Новая"]`.

**One thing this cannot catch, recorded in the spec itself:** both pages take
that corner from `KubHeader`, so a regression there fails the «Задачи» check
first and the «Мои боты» one never runs — an early guard hiding the rest. What
the second check does catch alone is that page growing a control of its own
outside the shared header.

**Nothing needs reinstalling.** The Windows client is a shell around
`https://app.letscube.ru/` (`windows-tauri/src-tauri/src/lib.rs:31`), so this
reaches an installed client through the ordinary web deploy.

---

## D-211 `[x]` Nobody could create a group, because the insert asked for its own row back

**Severity:** highest. A core function, broken for every account including the
owner's, for at least three days.

**Reported** by the owner twice — on 2026-09-15 («я сейчас не могу создать
группу как тех админ, чего уж говорить об обычных пользователях») and again on
2026-09-18 («даже админ типа Никиты не может создать группу, что-то явно
сломалось»). **The first report was answered with a different fix and declared
closed. It was not.**

**Surface:** `components/sidebar/NewGroupModal.tsx` and `lib/savedMessages.ts` —
both did `.insert({...}).select("id").single()` on `public.chats`.

**The evidence that settled it**, from the gateway log rather than from
reasoning:

    5 × POST /rest/v1/chats?select=id HTTP/1.1" 403

and, from the database, **zero chats created in three days** while the newest
group dates from 2026-05-17. So the request reached the server and was refused;
nothing was silently swallowed on the client.

**Defect.** `.insert(row).select("id")` becomes `INSERT ... RETURNING` through
PostgREST, and **PostgreSQL applies the SELECT policy to a returned row as
well**. `chats` has exactly one SELECT policy — `Chat members can view chats`,
`EXISTS(chat_members WHERE chat_id = chats.id AND user_id = auth.uid())` — and
the creator's membership row is written by `trg_add_chat_creator_as_owner`, an
**AFTER INSERT** trigger, whose effect does not exist when RETURNING is
evaluated. The row goes in, is refused on the way out, and the statement rolls
back with it.

Measured on production, rolled back, the same account both ways:

| statement | result |
| --- | --- |
| `insert into public.chats (...) values (...)` | **OK** |
| `insert into public.chats (...) values (...) returning id` | **new row violates row-level security policy for "chats"** |

**Fix:** the client chooses the id and does not read the row back
(`lib/chatCreation.ts`). Proved on production, rolled back, for a plain user and
for an admin alike: the new shape is accepted and the trigger makes the owner
row. **Not fixed in the database on purpose** — a SELECT policy of
`created_by = auth.uid()` would make RETURNING work for everybody and would also
let somebody removed from a group they once created go on reading its row.

**The rest of the class was measured, not assumed.** `topics`, `voice_channels`
and `chat_channel_categories` all accept an insert WITH RETURNING for a real
group owner, because their policies ask `is_chat_admin(chat_id)` — a row that
already exists. So channel creation is not affected by this.

### Why it took two reports, which is the part worth keeping

On 2026-09-15 the same probe was run and **gave the right answer**: a `DO` block
that did `insert ... returning id into v_chat` reported the insert refused. That
was dismissed as a faulty harness, because the same insert written as a bare
statement — **without RETURNING** — succeeded, and the difference was read as
«`set_config('role')` inside plpgsql does not really change the role». It does.
The difference was the RETURNING clause all along, and the refusal was the
product telling the truth.

Two rules come out of it. A probe that disagrees with another probe is a
**finding**, not noise: the two differ in some way that matters, and the way
they differ is the answer. And a probe has to be **the shape of the real
request** — `.insert().select()` is not `insert`, and PostgREST's translation is
part of the system under test.

The guard in `tests/unit/chat-creation.test.mts` is a source read, and that is
deliberate: this defect typechecks, passes every mocked test because a fixture
answers the read-back happily, and is invisible until somebody meets a real
policy. Four mutations turn it red — either call site reading its row back, and
either spelling the row out inline.

---

## D-212 `[x]` «Добавить канал» did nothing in a group that had no channels yet

**Severity:** high. The channel feature was unreachable in the ordinary case —
which is nearly every group on this deployment.

**Reported** by the owner on 2026-09-18: «в группе не вижу создания голосового
конала и как-то странно работает создание канала (нажимаю что хочу сделать
канал и ничего не происходит)».

**Surface:** `components/chat/ChannelManageModal.tsx`.

**Defect:** the create-channel form was rendered **inside** `tree.map(...)`,
gated on `draft.categoryId === (group.category?.id ?? null)`. A group with no
channels and no headings has `tree.length === 0`, so there is no section for the
form to render in: pressing «Добавить канал» set the draft and **nothing
appeared**. The create-*category* form never had the fault because it was always
outside the map — which is why categories were makeable and channels were not.

**Why nobody saw it.** Every test in `server-channels-admin.spec.ts` seeded a
group that already had a heading, two rooms and topics. Measured on production
on 2026-09-18: **thirteen groups, zero categories, one voice room, eleven
topics between them** — so the seeded shape is the shape almost no real group
has, and the empty one was never rendered.

**Not the database.** Checked first, and it is worth recording that it was:
`topics`, `voice_channels` and `chat_channel_categories` all accept an insert
WITH RETURNING for a real group owner (`is_chat_admin` true), so nothing was
being refused. The same day's group-creation defect (D-211) *was* a policy
problem, and assuming this one was too would have wasted the search.

**Fix:** the form is one renderer used in two places — inside the heading it is
adding to when there is one, and after the list when there is not. Both
conditions are mutually exclusive, so only one instance ever mounts and the
`revealDraft` / `draftFoot` refs still belong to it.

**Verified:** a new test walks the path a person actually takes — the rail's own
control rather than the settings screen three taps away — on a group with
nothing in it, and asserts the create control is present **and enabled** (it is
`disabled={admin.busy || drafting}`, so a read that never settled would leave it
inert and look identical), then that the form appears, then that a voice room is
reachable from it. 13/13 at 1440, and removing the out-of-map render fails
exactly that one test while the other twelve stay green.

**«Не вижу создания голосового канала» has the same cause.** The form opens on
«Текстовый» and the voice choice is a control inside it, so somebody who never
got the form open never got to the choice. Photographed:
`output/empty-group-channel/voice-form-{dark,light}-chromium-desktop-1440.png`.

**One more thing the 390 run found, and it was my test rather than the
product.** The first mobile run failed all three new tests on
`channel-rail-manage` while the other twelve passed. On a phone the rail is not
a column of the conversation: it is a drawer behind the capsule where the topic
strip used to be (`ChannelRail.tsx:555` `channel-rail-trigger` →
`channel-rail-sheet`, which renders the same `ChannelRailList`). So the control
exists and works there, it simply cannot be pressed before the capsule is. The
tests now go through `openRailManage`, which asserts the capsule and the drawer
by name so that if the phone ever stops offering them the failure says *that*
rather than pointing at the manage button. 15/15 at 390, photographed:
`output/empty-group-channel/voice-form-{dark,light}-chromium-mobile-390.png`.

---

## D-213 `[x]` A group's member list showed LETSCUBE-wide rank, in words, beside that group's own

**Severity:** medium, and it is the one the owner reported rather than one found
by looking.

**Reported** by the owner on 2026-09-18: «проверку прав и корректировку вида
лычек, потому-что сейчас оно до сих пор отображается как роли глобальные с
надписями вместо значков».

**Surfaces:** `ChatInfoPanel.tsx` — the member row and the member card;
`lib/profileBadges.ts`; `components/kub/icons.ts`;
`components/profile/ProfileRoleSummary.tsx`.

**Defect.** Both halves of the sentence are true, and the second one hid the
first. `profile_badges` joins `user_global_roles` to `roles` filtered to
`scope = 'global'`; it takes no `chat_id`, never reads `chat_members`, and the
client type says so outright — `ProfileBadgeKind` is
`"global_role" | "achievement"`. So the chips beside a name in a group's member
list were LETSCUBE-wide standing **by construction**, sitting one line below
that group's own standing. On the owner's own row the word «Владелец» appeared
twice, meaning two different facts.

**This was seen five days earlier and lost.** It is written down in
`docs/PRODUCTION_PRIORITY_TRACKER.md` as the third of three defects found while
building the strip — the member row that read «Владелец [crown Владелец]», this
chat's owner beside LETSCUBE's, one word meaning two things a line apart. The
first two got numbers, D-181 and D-182. This one did not, so it was in no batch
and nobody read it again. A defect with no number is a defect nobody owns.

**What both references actually do.** In a Discord server's member list a
person carries their standing *in that server* — the name's colour, at most one
role icon, a crown for the owner — and Discord's own account badges (Nitro,
HypeSquad, staff) never appear there; they are on the profile popout. Telegram
prints a short grey word for the group role, «админ» or a custom title the owner
typed, and shows no site-wide rank at all; Premium and verification are profile
properties. Neither puts a site-wide rank in a list about one group. The product
had the right shape for the right scope and the wrong shape for the wrong scope
two centimetres apart: the per-chat marker was already a crown or a shield at
12px with the words only in the accessible name.

**Fixed as a rule about scope, not about room.** `MEMBER_ROW_BADGE_LIMITS` —
one standing and one medal — answered "how many fit beside a name".
`PROFILE_CARD_BADGE_LIMITS` answers a different question and is uncapped:

- **a member row** carries this group's standing and nothing else: the glyph on
  the name line, whose accessible name is the scoped sentence, and a second line
  that names the scope in Telegram's manner («Владелец группы»);
- **a person's card** carries who they are on LETSCUBE — every badge, words
  included, nothing counted away, so there is no plus-N left to press.

The note that used to stand where the limits were had already reached this
conclusion — "the whole strip belongs where the whole strip has room, which is
the person's own card" — and kept the row's chips only because the card did not
exist. D-168 built it on 2026-09-15.

**Two of the four standings were the same picture.** `roles.badge_icon` names
`admin` for «Тех. администратор» and `shield` for «Администратор»; the build
drew `ShieldCheck` and `Shield`, which at the 11px a chip uses is one object.
Three medals borrow `shield` as well, which `MEDAL_ICON_OVERRIDES` already had
to correct. «Тех. администратор» now draws a gear — not a new idea:
`ProfileRoleSummary` has drawn the `settings` glyph beside that role in the
administration panel since it was written, so two surfaces now agree instead of
three answers existing.

**The test for that was wrong before it was right, and the mutation said so.**
The first version compared component names, found `ShieldCheck` different from
`Shield`, and **stayed green** when the mutation put the two shields back side
by side. It was not a weak check, it was measuring something other than the
sentence above it. It now compares *silhouettes* from a written-down table of
phosphor components that read as one object at badge size — and the first glyph
chosen for «Тех. администратор», a person-with-a-gear, was refused by it,
because «Менеджер» wears `IdentificationBadge` and a person and a
person-with-something are one shape at that size. Four mutations red.

**«Пользователь» on almost every contact card, which is D-180's own opening
sentence.** `ProfileRoleSummary`'s compact form fell back to
`LEGACY_APP_ROLE_LABEL[user.role]`, and `profiles.role` is an enum whose default
`user` is carried by **16 of this deployment's 18 accounts**. «Администратор»
and «Менеджер» from that same column *are* facts — every authoritative predicate
still honours it, `is_admin` reads `profiles.role = 'admin'` **or**
`has_global_role(...)` — so the label survives for those two and is gone for the
default. Two e2e tests pinned «Пользователь» as expected and now require its
absence.

**And the fallback fired while the answer was still in flight.** `badges.ready`
was read nowhere, and an unanswered id is simply absent from `rows`, so "asked
and got nothing" and "has not answered yet" were the same state: every card
opened by printing «Пользователь» and then replacing it. Waiting for `ready`
turned out to be its own trap — a refused `profile_badges` never becomes ready,
and the placeholder would have been permanent. The hook has a third state now:
`settled` is "answered or failed", which is the one a surface should wait on,
and `failed` says which. This was caught by the spec's own "an answer that never
came" test within a minute of the first fix, not by reasoning.

**Verified:** 14/14 across `member-badges.spec.ts` (rewritten — its job changed
from "chips in the row" to the split) and `profile-badges.spec.ts`;
`badge-vocabulary.test.mts` 13/13 with four mutations red;
`profile-badges.test.mts` 17/17. Photographed at 1440 in both themes:
`output/member-badges/{light,dark,card-light,card-dark}-*.png`.

**What is deliberately left open:** per-group roles. Those are slices 5 to 7 of
D-180 and they need a migration — see D-215. The role colour that never reaches
a pixel is D-214.

---

## D-214 `[ ]` The colour an administrator picks for a role never reaches a pixel, and cannot

**Severity:** low as a defect, medium as dead configuration: the administration
panel offers a colour picker whose value changes nothing.

**Surface:** `roles.colour` in the database, `lib/profileBadges.ts` (which
carries it), `ProfileBadgeChip.tsx` (which never reads it),
`lib/badgeVocabulary.ts` and its `badgeTone`.

**Defect.** `profile_badges` returns `r.colour` and `projectProfileBadges`
carries it into `ProfileBadge.colour`; `ProfileBadgeChip` reads `icon`, `kind`,
`key`, `weight`, `title` and `detail`, and never `colour`. The tone comes from
`badgeTone()`, which collapses everything into three values: `pink` for `owner`
and `tech_admin`, `cyan` for the rest, `muted` for every medal. So the four
colours configured in the catalogue — and colour is the whole mechanic Discord
uses for this — are fetched over the wire and thrown away.

**Why it was not simply wired up, measured rather than argued.** The obvious fix
is to put `colour` on the chip's border and glyph, where the threshold for
non-text interface is 3:1 rather than the 4.5:1 a word needs. Measured against
the three surfaces a chip sits on, in both themes, with the same arithmetic
`tests/unit/status-badge-contrast.test.mjs` uses — dark surface / surface-2 /
surface-3, then light surface / surface-2 / surface-3:

- **owner** `#F5B50A` — dark 9.94, 8.89, 7.87; light **1.83, 1.63, 1.50**
- **tech_admin** `#4d8bd0` — dark 5.12, 4.58, 4.05; light 3.55, **3.16, 2.92**
- **admin** `#f04a92` — dark 5.27, 4.72, 4.18; light 3.44, **3.07, 2.83**
- **manager** `#4DCD5E` — dark 8.82, 7.90, 6.99; light **2.06, 1.83, 1.69**

In the dark theme every one of them clears 3:1 comfortably. **In the light theme
the gold and the green are invisible** — 1.50 to 2.06, which is not a marginal
miss — and the blue and the pink fail on `--kub-surface-3`, which is the surface
a chip on a card actually sits on. Wiring the colour through would have shipped
a light theme where the owner's badge has no visible edge.

The cause is visible in the numbers: the catalogue's colours were taken from the
**dark** theme's palette. `#4d8bd0` and `#f04a92` are the `--kub-cyan` and
`--kub-pink` dark values exactly — the same 4.05 and 4.18 the contrast test
quotes for those tones. The existing tone tokens are theme-aware; the
catalogue's hexes are not.

**Also worth saying: the mapping disagrees with the catalogue.** `badgeTone`
gives `owner` pink, while the catalogue asks for gold; and `admin`, whose
catalogue colour *is* that pink, gets cyan. So even the three tones in use are
assigned in a different pairing than the database describes.

**Two honest ways forward, neither of them "read `colour` in the chip":**

1. **Theme-aware role tokens.** Four pairs — `--kub-role-owner` and the rest —
   defined in both theme blocks, derived from the catalogue colour but adjusted
   until each clears 3:1 in the light theme too, and pinned by the contrast
   test. The colour picker then becomes a choice from a palette rather than a
   free hex, which is what the measurement above says it has to be.
2. **Per-theme columns** on `roles`, so an administrator sets both. More honest
   about what is really needed and more to maintain.

**Not a decision to take without the owner**, because either way the free colour
picker in the administration panel stops being free, and that is a product
choice rather than a defect.

---

## D-215 `[ ]` Per-group roles: the badge system has no way to express standing inside a group

**Severity:** medium. It is the other half of what the owner asked for on
2026-09-18, and it needs a migration rather than a client change.

**Measured on production, 2026-09-18, read-only.**

- `chat_members.role` is an enum `chat_member_role = owner | admin | member`,
  NOT NULL, default `member`. No CHECK constraint — the type is the constraint.
  Distribution across 61 memberships: **owner 34, member 26, admin 1**. The
  thirty-four owners are the artefact the 2026-09-11 private-chat repair
  describes (whoever opened a private chat became its owner); the single `admin`
  row is the whole of the per-chat administrator tier on this deployment.
- The `roles` catalogue holds three **chat-scope** rows — `chat_owner`,
  `chat_admin`, `chat_member` — and all three are `is_active = false`,
  `badge_public = false`, with zero holders. They are dead by construction, and
  `20260904060000_roles_retire_dead_tiers_and_club_naming.sql` says why: chat
  scope roles are never evaluated anywhere, and chat access comes from
  `chat_members.role` via `is_chat_admin` and `chat_role_of`.
- So there is no table anywhere that assigns a named, coloured tag to a
  (chat, person) pair. Group standing is exactly three values and nothing else.

**Do not reach for the dead rows.** Recorded twice already — D-168 above and
`docs/proposals/2026-09-13-roles-and-badges.md` — and it is worth a third time
because it is the cheap-looking move: `roles.colour` is one colour shared by
everyone holding that role, so it cannot express one person's tag in one group.
Reviving those rows would be the relabelling of an existing function the owner
has ruled out, not an implementation of this.

**The design exists**, in that proposal: `public.chat_roles` with `chat_id`,
`name`, `colour`, `icon` and `priority`, and `public.chat_member_roles` with a
composite foreign key onto `chat_members (chat_id, user_id)`, so leaving a group
drops the tags with the membership — no trigger and no sweeper. Screen copy is
drafted there too.

**Two things found today that this work has to settle.**

- `admin` and `manager` are both `badge_public = true` with **zero holders**, so
  two of the four intended standings cannot appear on anybody. Either the
  catalogue was seeded for a future that has not arrived, or it is a
  configuration mistake; the owner's call.
- `profile_badges` joins `user_global_roles` directly and never calls
  `has_global_role`, which is the only predicate that also honours the legacy
  `profiles.role` column. An account made an administrator by that column alone
  would therefore be an administrator everywhere **except** on its badge.
  Measured: of the 2 accounts with a `profiles.role` other than `user`, neither
  lacks a public global role, so nobody is in that state today — but the two
  sources of truth are one `update` apart.

---

## D-216 `[x]` The label on an icon button was clipped to a six-pixel sliver

**Severity:** medium. Three controls in the chat column had a name nobody could
read, and the sliver that did reach the screen looked like a rendering fault.

**Reported** by the owner on 2026-09-18: «сообщения при наведении на иконки с
функциями, сейчас их описания появляются под списком чатов».

**Surface:** `components/kub/KubTooltip.tsx`, and its three call sites —
`NotificationBell.tsx` («Уведомления»), `SidebarHeader.tsx` («Новый чат»),
`FolderRail.tsx` («Меню»).

**Defect.** `KubTooltip` drew its bubble as a `position: absolute` span inside
the trigger's own wrapper, revealed by `.group:hover > .kub-tooltip`. Absolute
positioning is clipped by any ancestor with `overflow: hidden`, and every one of
those three call sites lives inside two of them — the chat list's header block
and `.kub-chat-list-column`.

**Measured at 1440 before the fix**, by reading the DOM rather than by looking:
the bell occupies y 10–46, its `side="bottom"` bubble is laid out at y 52–80 and
94px wide, correctly centred — and everything below the header's edge is cut
away. What reached the screen was a six-pixel sliver of a border sitting on the
first row of the chat list. That is the notch in the owner's screenshot, and it
is why the report says the descriptions appear «под списком чатов»: the only
part that survives the clip is the part that overlaps the list.

**This exact defect had already been found and fixed once, in the other tooltip.**
`components/ui/tooltip.tsx` carries the note: «Portalled, which this was not…
It also inherited any ancestor's `overflow: hidden`, which clips a tooltip near
the edge of a scrolling panel.» Two tooltip systems existed and only one had
been repaired. So the fix is not a third: `KubTooltip` is now a named shape of
the Radix one — the short label on an icon button, as opposed to the popover
`InfoHint` builds — and there is one positioning implementation in the product.

**What changed for a reader**, beyond not being clipped: the label appears on
keyboard focus as well as hover, it flips side rather than running off the
window, and it waits 250ms so crossing a row of icons does not flash three
labels. The glass, the border, the 12px type and each call site's requested side
are unchanged.

**Observed and accepted, not a defect:** the bubble contains the word twice —
once to look at and once in a visually hidden span that `aria-describedby`
points at. Every one of these buttons also carries an `aria-label` with the same
word, so a screen reader hears it as a name and then as a description. That is
Radix's ordinary behaviour and the redundancy is harmless; it is written down
here so it is not rediscovered as a bug.

**The test asks the question a person asks.** A clipped tooltip is in the DOM,
carries the right text and reports a sensible bounding box — every cheap
assertion passes straight over the defect. So `icon-tooltip-reach.spec.ts` asks
whether the middle of the label is what is actually on screen at that point,
with `elementFromPoint`, which answers wrongly if the bubble is clipped, covered
or off the window. It covers all three call sites rather than a sample: a spec
that checked only the header would have left the rail's «Меню» clipped and
looked complete.

Two things the first run of that spec got wrong, both mine rather than the
product's: it opened a conversation before looking, which on a phone pushes the
header off screen, and it read the bubble with `textContent` and then
`innerText`, both of which return the word twice because the hidden copy is
hidden by clipping rather than by `display`. It reads the content element's own
text nodes now.

**Verified:** 9/9 at 1440 and 390, with three tests skipped at 390 for a stated
reason — a hover bubble is a pointer's affordance, and on a phone the spec
instead asserts the function is still named and reachable, by accessible name
rather than by test id, because at 390 the folder rail is not on screen and the
header carries «Меню» instead. Reverting `KubTooltip` to the CSS bubble turns
all five pointer tests red. Photographed:
`output/icon-tooltip/bell-{dark,light}-chromium-desktop-1440.png`.

---

**D-215 — the server half applied 2026-09-18.**
`20260918120000_chat_roles_and_member_tags.sql`, with its rollback and its
rehearsal beside it. Verified schema backup taken first
(`/srv/letscube/backups/schema/schema-20260917T232230Z.sql`, 1 032 945 bytes,
135 `CREATE TABLE`, sha256 `6ebc13af…`). One transaction, `lock_timeout 5s`, a
self-check that raises rather than committing a half-applied state.

**What the rehearsal measured before it was applied**, seventeen cases as real
`authenticated` sessions inside `begin; … rollback;`: four controls ALLOWED
(group owner creates, a second group's owner creates, chat admin assigns, owner
tags a member), and a read pair that had to *disagree* — a member sees 1 role,
a non-member sees 0 — which is what proves the impersonation took at all rather
than everything running as `postgres`. Then the refusals, each naming the thing
that produced it: a plain member refused by the policy, a chat admin refused by
the policy (the owner-only gate, see below), a tag borrowed from another group
refused by `chat_member_roles_role_fkey`, a role in a private chat refused by
`chat_role_private_chat`, a blank name by `chat_roles_name_length`, a free hex
colour by `chat_roles_colour_palette_key`, the same name in another case by
`chat_roles_chat_name_idx`, and twenty-six roles **in one statement** by
`chat_roles_limit`. After the rollback: both tables gone, 61 memberships
unchanged, no audit rows, the three dead chat-scope roles still dead.

**Verified after applying:** both tables with RLS on; six policies each, two
permissive and four restrictive, the same set `topics` and `voice_channels`
carry; both composite foreign keys present as written —
`(chat_id, user_id) → chat_members` and `(chat_id, role_id) → chat_roles` — so
leaving a group drops the tags with the membership and a tag can never name
another group's role; `anon` reaches neither table; `authenticated` holds none
of TRUNCATE, TRIGGER or REFERENCES; the dead chat-scope rows untouched.

**Three things the written design got wrong about this database**, found by
measuring it rather than by reading the proposal:

1. `chat_member_roles.role_id` as a plain reference lets an administrator of
   chat A pin a role belonging to chat B on somebody, and chat A's list would
   draw chat B's name and colour. Fixed with a `unique (chat_id, id)` on
   `chat_roles` and a composite key — the same repair `voice_channels_category_fkey`
   had four days earlier.
2. «Inside a group» is not what the schema would have enforced: 24 of 27
   private chats carry an `owner` row from the 2026-09-11 artefact, so one side
   of most private conversations passes `is_chat_admin`. A trigger refuses a
   role in a `private` chat outright.
3. The bounds «25 per chat, 5 per member» were specified as BEFORE triggers,
   which cannot see the rows their own command is inserting — so a single
   26-row INSERT, which PostgREST will happily send, walks straight past them.
   They are AFTER INSERT row triggers, and the rehearsal sends 26 rows in one
   statement to prove it.

**Two decisions for the owner, both reversible in one line.**

- **`colour` holds a palette key, not a hex** (`^[a-z][a-z0-9_]{1,31}$`), on
  D-214's evidence: a free hex column would reproduce per group the defect that
  entry measured globally, with nobody to audit it. The interface owns the
  palette and its two theme values.
- **The write gate is split**: inventing or renaming a group's tags needs
  `is_chat_owner`, handing an existing tag to somebody needs `is_chat_admin`.
  Copied from `enforce_chat_member_update`, which already lets an administrator
  promote a member and refuses them the owner. It costs one person one power
  today — there is exactly one non-owner `admin` row across all 13 groups — and
  widening it later is one policy while narrowing it after groups have built
  vocabularies is not.

**Still open on D-215:** the interface. The tables hold nothing yet, and nothing
reads them. The screen that defines a group's tags, the assignment control on a
member, and the row and author-line rendering are the next block.

**Two unrelated findings this measurement turned up.** The first was real and is
D-226; the second was wrong, and the correction is worth more than the claim
was.

`chat_channel_categories` is subscribed to by `useServerChannels.ts` and was not
in the `supabase_realtime` publication, so that binding had never fired — closed
on 2026-09-18 as **D-226**.

`voice_channels` granting `authenticated` no UPDATE was **not a defect**, and
the sentence that stood here was wrong in the confident direction. The
measurement was right: `relacl` reads `authenticated=ard`, no `w`, and
`has_table_privilege('authenticated', …, 'UPDATE')` really is false. The
inference was wrong, because UPDATE on this table is granted **per column**, on
exactly the seven `useChannelAdmin` writes — `name`, `position`,
`max_participants`, `speak_role`, `archived`, `updated_at`, `category_id` —
while `participant_count` and `active_since` are withheld because the SFU owns
them. Seven needed, seven granted. Nothing was broken and there was nothing to
harden: `anon` holds no column on the table at all, and the server paths run as
`service_role`, which does hold table-level UPDATE.

**This is the fourth time this project has drawn that conclusion from that
measurement.** D-191 read it off the policy alone; the self-check in
`20260918120000_chat_roles_and_member_tags.sql:125` asked
`has_table_privilege(…, 'UPDATE')` and concluded renames were refused;
`20260918160000` corrected that and found the one gap that was real
(`category_id`); and this note made it again. The rule, stated so the fifth time
does not happen: **on a table with column-level grants, `has_table_privilege`
answers false by design, and only `has_column_privilege`, asked one column at a
time, answers the question.**

---

**D-215 — the interface, first slice, 2026-09-18.**

The tables were applied earlier the same day and held nothing. This is what
reads and writes them.

**The row: Telegram's mechanic, read literally.** A group's own word takes the
tier's place on the second line — «Основатель · был(а) недавно» where the row
used to say «Владелец группы · был(а) недавно». Telegram prints a custom admin
title instead of «админ» for exactly this reason: the group chose the word and
the word says more than the tier. The highest tag only, because
`orderChatRoles` has already decided what highest means and because a row
carrying both would put three facts on a 280px line, which neither reference
does.

**What it does not replace is the glyph's accessible name.** The crown and the
shield are still «Владелец группы» and «Администратор группы» to a screen
reader even when the visible word is the group's, so nobody loses the fact
about who can do what. That was the first thing this change nearly broke:
passing the tag in as `roleLabel` is one line shorter and renames the glyph
with it. There is a test for it, and a second test that had to be scoped to the
second line rather than the row, because `toContainText` on the row reads the
aria-label too and the two assertions contradicted each other on the first run.

**The card stacks both, group first** — Discord's popout order, and the two
answer different questions. The group's tags carry a control to take one off,
and the roles this person does not wear are offered as dashed chips to give.
Asserted by measured position rather than by reading the source, because the
order of a flex column is a fact about the rendered box.

**Who may do what is the server's answer, asked once.** `lib/chatRoles.ts`
mirrors the applied policies: defining the vocabulary is `is_chat_owner`,
handing a tag out is `is_chat_admin`. A member sees the list and is offered
nothing to press — hiding it from them would be wrong in one direction and
offering «Новая роль» wrong in the other, and only the second produces a 403
nobody can explain. The chat's type is checked **before** the standing, because
the private-chat refusal is a trigger and fires whatever the policy decided.

**The palette is the part that could quietly have repeated D-214.** Eight
entries, theme-aware tokens, every one pinned at **4.5:1 as text** on all three
surfaces in both themes — the threshold a word needs, not the 3:1 a mark needs,
because colouring the name is Discord's actual mechanic and D-214 exists
because nobody checked the harder threshold. `--kub-surface-3` binds in every
case, which is the same surface the global catalogue failed on. Distinctness is
pinned too, at ΔE*ab 20 in CIELAB; the measured minimums are 28.0 and 24.1.
Five mutations red, including one that still cleared the 3:1 mark floor and
missed only the text floor — the exact shape of D-214.

**Two hues could not stay the colour they are named.** A yellow readable on
white is a brown: the dark theme's amber measures 1.94:1 against the light
surfaces and the catalogue's original `#F5B50A` measures 1.50:1, so «Янтарный»
and «Оранжевый» land as dark golds in the light theme. The picker shows the
theme's real value, so it is honest rather than hidden, but it is a thing to
look at rather than to read about.

**Two source-scanning guards read prose as code**, in one session: the theme
token contract saw a `var()` example inside a doc comment and the control
vocabulary saw the forbidden opacity class named in a comment explaining why it
was not used. Both guards are right and both comments were the thing to change.
Worth recording because the instinct is to weaken the guard, and the guard is
the only thing standing between «this token resolves to nothing» and a pixel
nobody looks at.

**Still open on D-215:** the author line of a message, which is slice 4 of
D-180 re-scoped — it has to carry the group's standing rather than LETSCUBE's,
for the same reason the member row does. And reordering a group's roles, which
the table supports (`priority`, not unique, ties broken by name) and the screen
does not yet offer.

---

**D-215 — the author line, 2026-09-18.** Slice 4 of D-180, re-scoped: in a
group, the name above the first bubble of a run is drawn in the author's
highest role colour for this group. Colour only — no role word, no icon.

**The word was built and photographed before it was rejected.** In eight
messages from three people it printed five times; in a real conversation it
prints once per run of messages, for ever. At the rendered size the second word
is the same hue as the name, so «Анна Смирнова Наставник» reads as one phrase
and the name loses its edge, which is the line's whole job. The crown at 10px
is a blob — D-213's own finding about 11px chips, arriving one size smaller.
The word already lives on the member row and on the person's card, which is
exactly where D-213 put it, and Discord colours the name only in the message
list.

**One measurement nobody had taken, and it is D-214's shape one surface
further along.** The palette is pinned at 4.5:1 against `--kub-surface`, `-2`
and `-3`. An author's name sits on none of them: it sits on the chat ground
under the wallpaper, and **in the light theme that composite is darker than all
three panel surfaces, darkest at the bottom left — which is exactly where
author names are**. Measured off the rendered pixels at 1440: 4.57 at the top
of the window falling to **3.65** at the bottom (blue 3.77, teal 3.74, green
3.65, amber 3.72). The accent already there reads 6.03 at that same point, so
shipping the raw token would have been a regression.

Resolved by composing the palette colour 80/20 toward `--kub-text` for this one
surface — near-black in light so it darkens, near-white in dark so it lightens.
Measured after: light 4.71–6.59, dark 7.42–8.48.

**The cost, written down rather than waved through.** Pulling every entry
toward one neutral compresses them: the closest light pair, slate and teal,
falls from ΔE\*ab 24.1 to 19.9, a hair under the 20 the palette test holds
member-row chips to. That floor was set for two short words side by side in a
280px row; two author names are multi-word and a message apart, and the
photographed pixels read as three distinct colours. Kept, and reversible in one
constant. The cleaner fix is a `--kub-role-*` set inside `.kub-chat-screen`,
beside the `--kub-cyan`, `--kub-muted` and `--kub-accent-text` that block
already re-points for this exact reason — worth doing when somebody is next in
that file with the wallpaper's gradient in front of them, because the darkest
point of a gradient is what any such token has to clear.

**One request pair per conversation, measured rather than reasoned about.**
The hook is mounted in `ChatWindow`, the one component that renders both the
message list and the information panel; the panel no longer mounts its own.
With the fixture's request recorder: a group with one message costs 1 + 1, a
group with sixty messages from three authors costs 1 + 1, with the card open
1 + 1, and **a private chat costs 0 + 0**. Mounting it per row instead takes
the private chat to 6 and the card-open case to 7.

**Two mutation findings worth keeping.** The first render guard was *green*
under the mutation it was written for: it typed a short word, and the draft
lives in the composer's own state, so the component under test never rendered
at all. It provokes a composer wrap now and asserts the parent rendered before
counting bubbles, so a zero can never mean «nothing happened». And the
«hands back the very objects» mutation is invisible in renders on its own,
because the memo pins the map — the end-to-end guard only goes red with copies
*and* the memo removed. That is reported rather than claimed as a stronger
guard than exists.

---

## D-217 `[x]` A call could not say how it was doing, because nothing ever asked

**Severity:** medium as a gap, and it is the owner's own example of what the
voice channels are missing.

**Asked for** by the owner on 2026-09-18, with a screenshot of Discord's
connection monitor: a latency graph over the last few minutes, the media
server's name, average and latest round trip, outbound packet loss, and two
sentences saying what the numbers mean.

**What the audit found, and it reframes the whole voice list.** The stack is
self-hosted LiveKit v1.8.4 with `livekit-client 2.22.3`, and the SDK already
carries `ConnectionQuality`, `connectionQualityChanged`, `getRTCStatsReport`,
`activeSpeakers`, `switchActiveDevice` and `serverInfo`. What it does not carry
is a caller: **`getStats` appears zero times in this product and so does
`ConnectionQuality`.** The whole SDK sits behind a three-method interface in
`hooks/voiceRoom.ts` — `join`, `setMuted`, `leave` — and four events. The
numbers were never missing; they were never asked for.

That is why a latency graph turned out to be a small feature wearing a large
disguise, and why three Discord affordances landed together once the seam was
widened by four things: `sampleHealth()`, `setOutputDevice()`, `serverName()`
and `onSpeakers()`.

**Three decisions in the arithmetic, each producing reassuring numbers if taken
the obvious way.** The panel is read almost only when something is broken,
which is the trap it sets.

- **Loss is a rate over a window, not a lifetime total.** WebRTC's counters are
  cumulative. An hour of clean audio followed by ten bad seconds reports about
  0.1% for the call — which is what somebody would read at the exact moment
  their voice broke up. The test computes both figures from the same numbers:
  0.083% against 30%.
- **A missing reading is a gap, not a zero.** `getStats` can fail, a metric can
  be absent before the first RTCP report, a connection can be re-establishing.
  A zero draws a line on the graph's floor, which reads as a perfect connection
  at the moment there is none — and the graph breaks the line rather than
  bridging it, because a bridge invents a measurement across the failure.
- **The thresholds are Discord's**, 250ms and 10%, because they are the numbers
  in the owner's screenshot and ours differing would need explaining. The
  sentences quote the constants rather than repeating them, so the panel cannot
  explain a rule it does not apply.

**Sampling runs only while the panel is open.** A call lasts hours and the panel
is read for seconds; a timer on every call means a `getStats` round trip a
second on every device for a graph nobody asked to see. The cost is stated: the
graph starts empty and fills over four minutes, so opening it the moment a call
breaks shows the break and not what led to it.

**One token was wrong and the contract caught it before the pixels did.**
`--kub-warn-text` does not exist: `--kub-warn` is a tone for a dot, and
`--kub-online` had to be split into `--kub-online-text` for exactly that
reason. Painting a sentence in a tone tuned for a mark is the pairing D-214
measured at 1.50:1. The two problem states use `--kub-danger-text`, which is
measured for text.

---

## D-218 `[x]` Three hooks below an early return, one of them shipped

**Severity:** high. React throws and an error boundary replaces the subtree.

**Found** on 2026-09-18, in two steps, and the second step is the finding.

**Mine first.** `VoiceCallCapsule` was written with `useState` **below**
`if (!view.visible || !channel) return null`. That renders fewer hooks while
hidden than while visible, so React throws «Rendered fewer hooks than expected»
the instant the state changes. Typecheck cannot see it. **The e2e suite could
not reach it either, and the reason is worth keeping:** every path in those
specs that hides the capsule also remounts its whole subtree — `openChat`
reloads and `switchChat` clicks the list — so the component is never rendered
twice with its visibility moving. In production a group whose `voice_channels`
read lands after the conversation is on screen does exactly that.

**Then the rule was run over the whole client and found two more, in shipped
code.** `MessageInput.tsx` called `useIsMobile()` and `useHint(...)` below
**both** of its early returns — `if (muteState.muted) return (…)` and
`if (showVoice) return (…)` — so opening and closing the voice recorder, or
being muted in a chat, crashed the composer. Moving them above only the second
return fixed half of it and the rule said so, which is how they ended up above
the first.

**Guarded by a linter rather than by a test, because a test cannot see this.**
`tests/unit/rules-of-hooks.test.mjs` runs exactly one biome rule —
`correctness/useHookAtTopLevel` — over `artifacts/kub/src` with its own
configuration in `tests/unit/helpers/hook-lint/`. The project's own
`biome.json` has `linter.enabled: false` and a `files` list that does not
include the client at all, so turning the linter on globally is a separate and
much larger decision; this changes nothing about it. Zero findings across 501
files, and putting the conditional hook back turns it red.

Two things the test had to learn about its own harness, both recorded in it: on
Windows `execFileSync("pnpm.cmd", …)` needs a shell and without one threw with
both streams empty, which reads as «biome produced no output» rather than «the
command never ran»; and biome answers «no files were processed» rather than
failing when a path is ignored by configuration. So the test asserts the file
count it was given — «Checked 501 files» — before it trusts a clean result.

---

## D-219 `[x]` There was no way to stop hearing the room

**Severity:** medium. Discord has it, Telegram's calls have it, and the absence
is felt in exactly the situation voice channels are for — somebody leaves a room
open while they do something else.

**Measured 2026-09-18:** zero occurrences of `deafen` anywhere in the client.

**Built as the local half of a pair, and the distinction matters.** Self-mute is
propagated by the SFU because a silent microphone is a fact about the
conversation; deafening is local and nobody is told, because it is a decision
about one person's own ears. That is why `setDeafened` touches only remote
volumes and never the room.

**Deafening also mutes.** Every product with the control does it, and the
alternative is worse than inconsistent: somebody who cannot hear the room cannot
hear themselves being asked to stop talking. **Undeafening does not unmute** —
somebody who muted themselves first stays muted, which needed the previous state
to be remembered rather than inferred, and is the case a naive implementation
gets wrong by putting the person back on air without their asking.

**It is not gated on `canPublish`.** The mute control is, because a control over
a microphone the SFU will not carry has nothing behind it. Not hearing the room
needs no permission to speak, so a listener the gateway refused publication to
still gets this.

**`setVolume(0)` rather than `setEnabled(false)`**, which would unsubscribe and
save the bandwidth. Undeafening would then cost a round trip to resubscribe, and
a control that is instant one way and laggy the other is the one people press
twice.

**The value is held and re-applied rather than set once**, because `setVolume`
is per participant and the SDK has nowhere to say «everybody who joins from now
on». Somebody arriving while it is on has to arrive silent.

**Five mutations red, and the sixth is why there is a second test file.**
Deafening no longer muting, the remembered mute forgotten, the control gated on
`canPublish`, the transport never told — all red. But **taking the
re-application off `TrackSubscribed` left all three end-to-end tests green**,
because `voice-call.spec.ts` replaces the whole transport with a stand-in, so
every rule inside `createLiveKitRoom` is invisible to it. That is the price of a
seam that lets a call be tested without an SFU, and it had not been paid
attention to.

`tests/unit/voice-room-seam.test.mjs` reads that file as source instead. It is
the weaker instrument and says so: it proves a call site exists, not that the
SDK does what the call site asks. It catches the change that actually happens —
somebody simplifying an event handler and dropping a re-application nothing
else notices. Five mutations red there too, and **two of them were green on the
first attempt** because a slice ran to `async setDeafened`, which comes *before*
`sampleHealth` in the returned object: `indexOf` answered −1, `slice(0, −1)`
kept almost the whole file, and the assertion matched a different method's
`try`. Both slices are bounded by the method that really follows, and assert
that it does.

---

## D-220 `[ ]` A locked screen ends a call on Android

**Severity:** high on a phone, which is where calls happen.

**MEASURED 2026-09-18:** `android/app/src/main/AndroidManifest.xml` declares
`android.permission.RECORD_AUDIO` at line 49 and **nothing else** — no
`FOREGROUND_SERVICE` permission, no `FOREGROUND_SERVICE_MICROPHONE`, no
`<service>` element, no `foregroundServiceType="microphone"` anywhere. Android
stops a background process from holding the microphone, so the call ends when
the screen locks.

**Deliberately not built blind.** A call that survives a locked screen needs a
real foreground service — a `Service` class, a notification channel, a
persistent notification a person can return to the call from, and start/stop
plumbing from the web layer through a Capacitor plugin — and none of it can be
verified without a device. Shipping an unverified foreground service risks the
opposite failure, a notification that cannot be dismissed and a microphone held
after the call ends, which is worse than the defect.

Recorded with the measurement so the next person with a phone in their hand
starts from a fact rather than from a search.

---

## D-221 `[x]` Nobody could be silenced or removed from a voice room they were already in

**Severity:** high for a product with voice channels. Somebody being
disruptive right now could not be stopped until they reconnected, which they
had no reason to do.

**Measured 2026-09-18:** `voice-gateway/index.ts` forces `canPublish: false`
when `is_muted(user, chat)` — **only at token mint**. Zero `UpdateParticipant`,
`RemoveParticipant` or `MutePublishedTrack` calls existed anywhere in the
product.

**Closed 2026-09-18.** The gateway half shipped in `0b5d62df`; the client half
is the moderation menu on a voice occupant, and it is what closes this. The
entry stood at `[~]` until then, because a deployed route nothing calls is not a
feature.

**`MuteRoomTrack` does not exist, and finding that out mattered.** It is the
name of the *request message* for `MutePublishedTrack`, not a method. Probed
against the deployed v1.8.4 over SSH, each probe with a negative control
(`NoSuchMethodZZZ`): `MuteRoomTrack` answers **404 `bad_route`**, byte for byte
like the fake, while `UpdateParticipant`, `RemoveParticipant`,
`MutePublishedTrack` and eight others answer **401 `unauthenticated`** — the
route exists and authorisation refused.

**`UpdateParticipant` was chosen over `MutePublishedTrack` for a reason in the
configuration, not a preference.** `room.enable_remote_unmute` is absent from
`/srv/letscube/voice/livekit.yaml` and therefore `false`, and the binary carries
the string «cannot unmute track, remote unmute is disabled» — so a force-mute
through `MutePublishedTrack` could mute and **never unmute**. It also needs a
track SID, which somebody with their microphone off does not have.

**The server silently drops unknown fields**, which would have made a typo a
200 that changed nothing: `permissionZZZ` and `permission` answered identically.
So every field name was proved *positively* — send a string where a bool is
expected and a known field answers 400 `malformed` while an unknown one is
dropped and the request proceeds. All seven permission fields answered 400;
three invented controls answered 503.

**`is_chat_admin(chat_id)` cannot be used here, and the reason is worth
recording.** It takes no user — it reads `auth.uid()` internally — and on a
service-role connection `auth.uid()` is null, so the predicate reduces to
`user_id = null` and refuses **everybody**. Safe, and useless. The caller is
established the way the `token` route does it (verify the JWT, then read that
`sub`'s row as service-role) and the same `role in ('owner','admin')` comparison
is applied to that row.

**Nothing writes to `public.mutes`, and three separate reasons each suffice.**
That table is staff sanctions, not chat moderation. Writing a voice mute there
would (1) **also gag the person in text**, because `messages` carries a
RESTRICTIVE `not is_muted(auth.uid(), chat_id)`; (2) **bypass the sanction
matrix**, because `enforce_sanction_matrix()` early-returns when `auth.uid()` is
null, which is exactly the service-role case, so a chat administrator who is not
staff would issue an unranked penalty; and (3) **put a row in the staff panel**
beside real bans with a non-staff `issued_by`. So the action is deliberately
live-only, and the cost is stated: a rejoin rebuilds the token from role,
`speak_role` and `is_muted`, so a force-mute is undone by leaving and
re-entering. Discord's «disconnect» behaves the same way; a persistent server
mute would need its own table and is a product decision with a client half.

**The matrix's order is part of the contract.** The caller's standing is decided
before anything is said about the target, so the route cannot be used to find
out who owns a chat. Nobody may mute or remove the owner — not an
administrator, not another owner, not themselves — which is one step stricter
than `enforce_chat_member_update`, where an owner may change a co-owner's role.
Unmuting restores **the policy's answer** rather than an unconditional yes, by
asking `is_muted` and then `canPublishInVoiceChannel`, so an administrator below
a channel's `speak_role` cannot grant themselves publication in a listen-only
room.

**Two mutations came back green and both were findings.** Adding `owner` to the
moderatable set was *redundant* — the matrix refuses the owner by name earlier,
so the answer carries its own code; removing that earlier line reddens two
tests, and the code now says which line is load-bearing. And the rate limiter
recording **its own refusals** was a real gap: `retryAfterSeconds` reads the
oldest entry, so a limiter that counted refusals reported the same number while
silently holding somebody past the window. Only a timeline where a refusal lands
inside the window and the question is asked after the original entry has aged
can tell the difference; that test exists now and the mutation is red.

**The code-coverage guard was blind to all six new refusals, and it is the guard
written to catch exactly that.** `voice-gateway-client.test.mts` asserts «every
refusal the function can send is known to this client» by scanning both files —
but its wire scan only matched `jsonResponse(request, { ok: false, error: … })`,
while the matrix returns `{ error, status }` from `moderation.mjs`; and its
client scan required the mapped category to be one of the nine that existed when
it was written, so a code mapped onto a *new* category counted as unmapped too.
The two halves cancelled and the test passed over six new codes. Both halves are
widened, with a control that fails if the moderation file stops being read, and
four mutations red.

**Deployed and verified by a calibrated probe.** The function's files were
backed up first (`/srv/letscube/backups/functions/voice-gateway-…tgz`), and four
of the seven were confirmed byte-identical to what was already running before
anything was copied. After the restart: `token`, `force-mute` and `remove` all
answer **400** to an empty body — the route exists and rejects the request —
while `NoSuchRouteZZZ` answers **404**. A route that exists rejects the body; one
that does not rejects the path.

**Not verified, and it needs a live SFU:** whether `UpdateParticipant` with
`canPublish: false` stops a microphone that is *already publishing* or only
refuses a new publication. If it is the latter, the follow-on is
`MutePublishedTrack(muted: true)` per audio track — which this build can do in
the muting direction and, as above, not in the other.

---

## D-222 `[~]` A viewport breakpoint deciding a layout that lives in a column the owner drags

**Severity:** medium, and cosmetic in the sense that nothing breaks — but it is
the first thing the owner saw when they opened «Обновления», and what they saw
was text wrapped four lines deep inside a `rounded-full` pill, which renders as
an ellipse with the words crammed into it. Recorded at the owner's request on
2026-09-18 as a class rather than as one card: «добавь на потом исправление
подобных "особенностей" интерфейса».

**Reproduction:** settings → «Обновления», with the chat-list column at its
default width, on a desktop window. The card's title breaks after one word, its
description becomes a ribbon two or three words wide, and both info chips
(«Версия установки: …», «Режим: …») wrap to three or four lines inside a pill
whose radius is half its height.

### The mechanism, corrected once before it was written down

My first reading blamed `SideMenuLayer`'s 304px drawer. **That was wrong and the
correction is the useful part.** `ReleaseDistributionSection` has exactly one
mount — `components/settings/SettingsScreen.tsx:777` — and `SideMenuLayer`'s
whole render tree carries **zero** viewport breakpoints. The 304px drawer is
clean.

The container is the **resizable chat-list column**, and it is resized by hand:

- `artifacts/kub/src/index.css:234` — `--kub-chat-list-width: 360px`
- `artifacts/kub/src/lib/desktopChatList.ts:57,60,67` — min **260**, max **540**
- `components/sidebar/Sidebar.tsx:202` renders `<SettingsPanel />` as that
  column's body, which is where D-160 moved the settings screen when it came out
  of an 896px dialog
- `components/sidebar/ChatListResizer.tsx:41-50` persists the dragged width to
  `localStorage` and writes it onto `document.documentElement`

So **no viewport width predicts this container's width.** At a 1440px window the
card is 328px wide, or 228px, or 508px, depending on where the owner last left
the handle. Tailwind's `sm:` is a `@media` query on the viewport, so inside that
column every `sm:` reads «wide»: the header grid takes its three-column form
(`ReleaseDistributionSection.tsx:93`), the download button moves into the third
column at its intrinsic ~95px (`:261`, `:274`, `:286`), and the content column
collapses to roughly **161px at the default and 61px at the 260px minimum** —
absent entirely at the maximum, which is why this is easy to miss.

**The codebase had already written this lesson down**, at
`artifacts/kub/src/lib/channelRail.ts:385-390`: measure against the pane, «never
the viewport … the chat list is dragged by hand, so at one window width the pane
has many». The rail obeys it. The settings screen predates it.

### Why a threshold tweak cannot fix it

All three tier-1 components render in **both** containers through one
`SettingsScreen`: `SettingsPanel` (the narrow column, from `md` upward) and
`SettingsModal` (a viewport sheet, below `md`).

- At a 700px viewport the card is ~640px wide, `sm:` is true, and the
  three-column form is **correct**.
- At a 1440px viewport the card is ~328px wide, `sm:` is equally true, and the
  three-column form is **wrong**.

One component, one breakpoint, the same breakpoint state, two required answers.
That is the proof this needs a container query rather than a different number.

### The bounded scope, measured rather than grepped

Two independent halves. Counts are after classifying every match by hand — a
raw grep over-states this by more than an order of magnitude, and an over-stated
defect class is worse than none.

**Half A — a viewport breakpoint inside a narrow container.**

| | count |
|---|---|
| Raw occurrences of `sm:`/`md:`/`lg:`/`xl:`/`2xl:` | **521** in 86 files |
| Dead shadcn leftovers (zero importers) | −30 |
| Live | **491** |
| Inside a narrow-container render set | ~90 |
| **Actually bites** | **19 occurrences · 11 lines · 5 components** |

**19 of 491 is 3.9%.** This is not a codebase-wide sweep; it is essentially one
screen. Most of the rest is the shell's legitimate question «is this the phone's
single pane», where below `md` the container *is* the viewport.

Tier 1 — wrong at the default column width, today. All reached through
`SettingsScreen`, all authored for the retired 896px dialog:

1. `settings/ReleaseDistributionSection.tsx:93` — `sm:grid-cols-[auto_minmax(0,1fr)_auto]`, the owner's screenshot
2. `settings/ReleaseDistributionSection.tsx:261, :274, :286` — `sm:col-span-1 sm:w-auto` on three buttons
3. `settings/StorageSection.tsx:152` — `sm:col-start-3 sm:justify-end`; and `:113` is a three-column grid with **no `sm:` gate at all**, so its third column always exists. Windows-only, and its labels («Вернуть по умолчанию») are longer than the release card's, so the squeeze is worse
4. `settings/ProfileDecorationSection.tsx:108` — `sm:grid-cols-2` → ~142px cells

Tier 2 — bites in a particular viewport window rather than at the default:
`bots/BotSettingsPanel.tsx:169` (four Russian tabs at ~100px each), `:243`
(a ~148px description field), `:223`, `:250`, `:266`, `:278`, `:287`; and
`pages/admin/support/SupportTicketDetails.tsx:150`, where `lg:` splits a 672px
column into 352+320 at a 1024px viewport. **Worth one screenshot each at 768 and
1024 before anybody edits them** — tier 2 is arithmetic, not observed pixels.

Tier 3 — cramped but not broken, so candidates and not defects:
`sidebar/SidebarHeader.tsx:190, :319, :321` (11 occurrences) force one row from
`md:` inside a 260–540px column, but `min-w-0`/`flex-1` let the field shrink.
Same component at 288px in `pages/public/PublicPreviewCapturePage.tsx:252`,
which is what product imagery is captured from.

**Half B — `rounded-full` on a box whose text can wrap.** A pill is only a pill
while it is one line high; above that the radius clamps to half the height and
eats the corners. 266 `rounded-full` in total, 236 of them correctly round
(avatars, icon-only buttons, dots, numeric badges, progress tracks, slider
thumbs, pills already carrying `whitespace-nowrap` or `truncate`). **~15 real
sites plus 2 primitives**, and unlike half A this one does **not** need a narrow
container — several of these wrap by construction at any width.

Already broken on screen: `ReleaseDistributionSection.tsx:108` and `:118` (both
widened further by an `InfoHint` child); `StorageSection.tsx:133`, `:139`;
`sidebar/NotificationBell.tsx:547`, `:566`, `:695` (the last two a duplicated
block) in a panel whose floor is 280px; `chat/ChatInfoPanel.tsx:3004`, an
absolutely positioned month marker with neither `max-width` nor `nowrap`.

The two that multiply, because one line serves many call sites:

- `components/kub/KubBadge.tsx:65` — `pill ? "rounded-full" : "rounded-md"` over
  a base of `inline-flex items-center gap-1.5 border px-2 py-0.5`: no height, no
  `nowrap`, no `max-width`, ~50 call sites. Mostly latent, but
  `ProfileRoleSummary` and `LocationsTab` feed it an administrator-typed
  `role.name`, which is unbounded.
- `components/kub/KubFilterChip.tsx:32` — the same absence, fed template strings
  that include free text (`Поиск: ${search.trim()}` at
  `pages/tasks/TasksPage.tsx:280`) into a `flex flex-wrap` row.

Wrapping by construction, wide container: `chat/MessageList.tsx:186` is
`max-w-[min(82vw,32rem)] rounded-full … text-center leading-snug` around
arbitrary server text — a pill explicitly built to be multi-line. Also
`auth/RegisterForm.tsx:358` («Регистрация только по приглашению», 33 characters,
the longest fixed label on a pill in the product), `MessageList.tsx:1223`,
`:1813`, and `sidebar/NewGroupModal.tsx:178`, which puts an un-truncated user
name on a pill while its own sibling `ChatRoleChip.tsx:43` truncates — that
sibling is the cheap fix pattern.

`components/ui/badge.tsx:12` is the same unsafe pill with zero call sites: not a
live defect, and it should be deleted rather than fixed.

### The vocabulary a fix would use, so the sweep does not invent a second system

**Container queries are native here and were verified by compiling them, not by
reading the version number.** Tailwind **4.2.1**, CSS-first
(`artifacts/kub/src/index.css:1` is `@import "tailwindcss"`, there is no
`tailwind.config.*`). The installed compiler emits:

```
.@container               { container-type: inline-size }
.@sm\:w-auto              { @container (width >= 24rem) { width: auto } }
.@min-\[20rem\]\:flex-row { @container (width >= 20rem) { … } }
.@max-\[24rem\]\:flex-col { @container (width < 24rem)  { … } }
.sm\:w-auto               { @media (width >= 40rem) { width: auto } }   ← control
```

**One trap, and it would be silent: the two scales are different.** `sm:` reads
`--breakpoint-sm: 40rem` = 640px; `@sm:` reads `--container-sm: 24rem` = **384px**.
A blind `sm:` → `@sm:` rewrite changes the threshold. For the release card it
happens to land well — 328px is false and stacks, 476px at the maximum column is
true and takes three columns — but that is luck, not equivalence. `@min-[…]` with
a measured number is the honest spelling.

**Where the decision has consequences in JavaScript, the project already has a
pattern, used twice, with tests and a written rationale** — follow it rather than
reaching for CSS:

- `lib/profileWindow.ts:157` `paneFitsProfileColumn(paneWidth)` →
  `chat/ChatInfoPanel.tsx:384-399`
- `lib/channelRail.ts:391` `paneFitsChannelRail(paneWidth)` →
  `chat/ChatWindow.tsx:508-524`

Both are a pure predicate in `lib/`, a `useLayoutEffect` with a `ResizeObserver`
on `[data-kub-conversation-pane]`, **only the answer in state** (the render-cost
contract in `tests/e2e/chat-list-event-cost.spec.ts`), and a unit test at the
boundary — `tests/unit/profile-window.test.mts:133-139`,
`tests/unit/server-channel-rail.test.mts:291-304`. Worth noting as evidence the
pattern works: `ChatInfoPanel` is over 2,000 lines at 320–380px wide and carries
**zero** breakpoints.

Today the only `@container` in the product is `components/ui/field.tsx:49`, a
shadcn leftover with no `@sm:` consumer, so container variants are effectively
new here — which is the reason this entry names the exact spellings.

### Scope note

Recorded open on purpose. The owner asked for it «на потом», the counts above
bound it, and the ordering is tier 1 → the two primitives in half B → tier 2.
A fix is not a polish pass: every tier-1 line needs pixels at both column
extremes (260px and 540px) **and** in the `SettingsModal` form below `md`, because
that dual case is the whole reason a threshold change is not the answer.

### Seen again on 2026-09-18, with evidence that sharpens the order

The owner sent two screenshots of the settings column and said the interface
work was not successful. Both are this entry, and both are still live — the fix
is recorded for later at the owner's own instruction and stays there, but the
new evidence changes which line the sweep should start on.

**The release card, unchanged.** «Версия установки: Windows EXE» and «Режим:
Браузер» are still ellipses with their text crammed inside. Second sighting,
same two lines (`ReleaseDistributionSection.tsx:108`, `:118`).

**The achievements grid, which is worse than this entry's tier 1 had it.**
`settings/ProfileDecorationSection.tsx:108` is `grid gap-1.5 sm:grid-cols-2`.
At a 1440 viewport `sm:` is true, so a ~330px column becomes two ~160px cards,
and after the 18px icon and the gaps each card has roughly 120px for its text.

The measurement that matters is **which way the two halves of the card fail**,
because they fail differently and only one of them is recoverable by the reader:

- the title carries `truncate`, so it does not wrap — it **clips**. Five of the
  seven achievements on screen were unreadable: «Тестиро…», «Альфа-т…»,
  «Бета-тес…», «Собесед…», «Рассказ…». A clipped title is not a cramped title;
  the word is simply gone;
- the description below it wraps instead, eight lines deep — «Был с LETSCUBE
  ещё до первых приложений для Android и Windows» down a 120px ribbon.

So the same container produces a clip and a ribbon in one card, which is why
this line should be **first** in the sweep rather than fourth: the release
card's pills are ugly and readable, and these titles are not readable at all.

Nothing else about this entry changes. The mechanism is the one measured above —
a viewport breakpoint deciding a layout inside a column the owner drags — the
count stands, and the fix vocabulary stands.

### Fixed on 2026-09-18: tier 1 and half B, with five corrections to this entry

**What is done:** every tier-1 line, both pill primitives, and every half-B site
except the two the tier-1 work owned. **What is not:** tier 2 (which the entry
says needs a screenshot each at 768 and 1024 before anybody edits it — still
true, still unscreenshotted), tier 3, and `SidebarHeader`. The status is `[~]`
rather than `[x]` for that reason.

#### The vocabulary, established once

`@container` on the measured box, `@min-[Nrem]:` on the utilities. **No `@sm:`
or `@md:` anywhere** — the trap this entry names is real and the compiled output
confirms it (`--container-sm: 24rem`, not `sm`'s 40rem), so every threshold is a
measured number written out. Three:

| Line | Threshold | The measurement behind it |
|---|---|---|
| `ProfileDecorationSection.tsx` (the grid's wrapper) | **26rem / 416px** | widest title «Альфа-тестер» is 95.06px; a two-column cell is `list/2 − 57`, so clipping stops at a 304px list and the longest description stops being a ribbon (7 lines → 3) at 414px |
| `ReleaseDistributionSection.tsx` (the card) | **27rem / 432px** | the third column costs the content 109px (button 97 + gap 12); the widest chip needs 247.64px, so the three-column form becomes honest at a 420px card |
| `StorageSection.tsx` (the card) | **38rem / 608px** | the row form is honest only while «Хранилище приложения» keeps its ⓘ on one line (205.27px) beside both buttons unwrapped (327.23px) |

A fourth, for the chip shape, is below.

#### Five things this entry got wrong, which is the useful part

1. **The defect is invisible without the shipped font.** `openFixture` aborts
   every off-machine request, which kills Inter; Windows falls back to Segoe UI,
   where «Альфа-тестер» is 86.6px against a 91px cell and **does not clip**. With
   Inter it is 95.06px and clips — the owner's screenshot. So a capture spec
   without the shipped font is a picture of a different product, while a
   *contract* with it is flaky. The two were split: the capture spec lets the
   font hosts through, the contract spec asserts only font-independent things
   (track counts and track widths).
2. **«at a 700px viewport the card is ~640px wide» — it is 562px.** At 767, the
   widest viewport below `md`, it is 629px.
3. **«at a 700px viewport the three-column form is correct» is true of the
   release card and false of the storage card.** Measured at 700 before any
   change: tracks of `16px 161px 327px`, the heading broken over two lines with
   its ⓘ alone on a third, and the path wrapping mid-word.
4. **`StorageSection` was not «cramped», it was gone.** At the 360 default the
   path column measured **0px** and the heading text *overlapped* «Вернуть по
   умолчанию»; at 260 the path rendered one character per line. The grid had no
   `sm:` gate at all, so the actions held a third column at `max-content` at
   every width.
5. **`ReleaseDistributionSection.tsx:286` is «Повторить»**, drawn when the
   catalogue is unreachable — it is what holds the outer grid's third column in
   the common browser case, which is why that column was never empty.

And four on half B:

1. `sidebar/ChatRoleChip.tsx` is **`chat/ChatRoleChip.tsx`**.
2. **`NotificationBell.tsx:547, :566, :695` are latent, not «already broken on
   screen».** Measured at the panel's own 280px floor — which needs a viewport
   under 296px, narrower than anything in the release matrix — the row is 190px
   and the widest pill is 124.27px. Patched and unpatched are geometrically
   identical at 296, 320, 360 and 390, and a pixel diff of the panel is **2
   differing pixels of 223,600**, max channel delta 19.
3. **`ChatInfoPanel.tsx:3004` is latent too, and for a different reason than
   this entry implies.** The marker is `absolute left-1/2` with no width, so it
   is laid out in the **half of the card to the right of that line** — 190px of
   a 379px panel — and then centred by `-translate-x-1/2`. The widest label
   `mediaMonthLabel` can build is ~115px, so it never wrapped: before and after
   are byte-identical. The fix makes the preferred width the text's own.
4. **`NewGroupModal:178` is live**, and nearly was not tested: the first attempt
   used a 44-character name, which fitted. Nothing caps `full_name`, and a
   57-character name is 428px against a 342–358px row.

Net: of the ~15 half-B sites called «already broken», **two are live** (the two
primitives' unbounded feeds, and the group-modal name) and four are latent.

#### The primitives: one line, and the recovery at the call site

`KubBadge` takes `pill ? "max-w-full min-w-0 whitespace-nowrap rounded-full"`,
and a new `pillTextChildren` wraps **runs of text** in `min-w-0 truncate`. Three
things were measured rather than assumed:

- **the contract is gated on `pill`**, because `rounded-md` is 6px and a square
  badge on two lines is cramped rather than broken — so the ~20 `pill={false}`
  call sites render byte-identically;
- **the obvious spelling breaks call sites that were already correct.** One
  wrapper around `children` makes `RolesPermissionsTab`'s `h-1.5 w-1.5` swatch
  an inline box that collapses to 0, and costs `ProfileBadgeChip`/`TaskCard`
  their 6px gap. Runs matter too: `+{n}` arrives as two children and wrapping
  them apart puts a gap between the plus and its digit;
- **nothing else moved.** Measured before and after at fixed widths, in both
  themes: every already-correct case identical to 0.01px, and only the three
  that wrapped changed height (42→24, 42→24, 40.66→38).

**A truncated pill takes the word away, which is the failure this entry opens
with**, so the two feeds that carry an administrator's own text — `getRoleLabel`
in `ProfileRoleSummary` and `LocationsTab` — now pass `title`. Deliberately at
the call site and not on `KubBadge`: about fifty call sites pass fixed copy that
fits, and a native tooltip repeating text already on screen is noise. It is the
reason `ChatRoleChip` carries its own.

`components/ui/badge.tsx` is **deleted**. Zero importers proved three ways:
`<Badge` matches nowhere in the repository, `badgeVariants` only in the two
badge files themselves, and there is no `components/ui` barrel.

#### The chip shape, and a cheaper fix that does not work

The two release-card chips were left unowned by the split above and are the
owner's literal complaint, so they were done last: `rounded-lg` with
`@min-[20rem]:rounded-full`. 310px measured — «Версия установки: Windows EXE»
needs 248px and the chips get `card − 62` in the two-column form; the
three-column form above 27rem gives `card − 171`, which is 261px at its own
threshold, so one number covers both.

**The measurement worth keeping is the fix that failed.** A border radius is
clamped — when two radii on one side exceed that side, all of them scale — so
`rounded-3xl` promised a stadium on one line and a rectangle on two, with no
threshold at all. In the paint it is byte-identical on one line (42px, because
the `InfoHint` inside carries the 32px touch target) **and byte-identical on two
as well**: two lines are 46px, and 24px still clamps to 23. The clamp cannot
tell 42 from 46, and 42-versus-46 is the whole of this defect at the width the
owner photographed. Only a radius under 21px separates them, and 21px is what
one line already paints — so no single radius is a stadium at 42 and a rectangle
at 46.

Two instrument notes from the same hour:
**`getComputedStyle().borderTopLeftRadius` cannot see the clamp** — it reports
the specified 24px whatever the box does, because the overlap rule of CSS
Backgrounds 3 §5.5 is applied at paint time. The instrument that answered was
`Buffer.compare` on two element screenshots. And the assertion that shipped asks
**«is this a stadium»** — radius ≥ its own height — rather than which class is
present, so it survives a change of token.

`StorageSection`'s two chips were reverted to `rounded-full`: they are one line
at every width the handle allows, so a shape switch there would have been a
class nobody could reach.

#### Two rulings

**The storage card's row form at a 700pt sheet was changed on purpose**, against
the instruction «if your change breaks that form you have written the wrong
fix». The instruction assumed the form was right there; correction 3 above is
the measurement that it was not. A threshold of ~35rem would have kept 700 in
the row form at the cost of a 161px path column. The measured number wins, and
the pixels for both are in the set.

**`NotificationBell`'s three utilities are kept although two mutations of them
stay green.** A green mutation is redundancy or unreachability and never «fine»
— here it is unreachability, and the reason is written in the component rather
than left to be rediscovered: every label there is fixed copy, the widest is
124px in a 190px row, and the day one grows is the day it matters. An unchecked
claim is only dangerous while it is silent.

#### Still open, and one new candidate

Tier 2 and tier 3 stand exactly as written above, screenshots at 768 and 1024
still owed before anybody edits them. One thing found while measuring and left
alone: **`StorageSection`'s heading drops its ⓘ to a line of its own at the 260
column** (`flex flex-wrap`, 205px wanted against 136px). Pre-existing in the
stacked form, the same class as the defect `WindowsStartupSection`'s own comment
already records at its heading, and not a grid problem — so it is a tier-3
candidate rather than part of this fix.

#### Coverage

`tests/e2e/settings-container-queries.spec.ts` (8 contracts) and
`tests/e2e/pill-one-line.spec.ts` (14), each **a pair of widths at one
viewport**, which is the instrument the mechanism demands: a `@media` query
cannot tell two column widths apart at 1440, so putting `sm:` back turns the
narrow half of every pair red while the wide half keeps passing for the wrong
reason. Pixels in `output/d222/png/{before,after}` (30 files each, same names; the grid fix
alone, before the chip shape, is kept beside them as `after-grid-only`)
and `output/d222-half-b/` (46).

**Twenty-four mutations, twenty-two red.** The two green ones are the
`NotificationBell` pair ruled on above. Three taught something and changed the
patch: a `whitespace-nowrap` on `KubBadge` was unreached because `truncate`
already implies it, so the case that reaches it — an element child carrying
text — was added rather than the guard deleted; `shrink-0` on
`KubFilterChip`'s «×» was genuinely redundant (`.kub-icon-action` sets a 32px
minimum) and was removed; and removing it from `NewGroupModal`'s «×» on the same
reasoning went **red at 8px instead of 10** — a bare `<svg>` carries no
intrinsic width the flex algorithm respects. It is back, with the number.


---

## D-223 `[x]` Every person in a call was drawn with their microphone off, and deafening did nothing at all

**Severity:** high, and it had been live since the call shipped. Two features
that were tested, reviewed and deployed did not work in a browser at all.

Found on 2026-09-18 by an agent reading `livekit-client` 2.22.3's own bundle
while binding the events D-221's client half needed — not by a test, and no test
in this repository could have found it: `tests/e2e/voice-call.spec.ts` replaces
the whole transport with a stand-in, which is the only reason the call can be
tested without an SFU and also the reason everything inside `createLiveKitRoom`
is invisible to it.

**One cause, two symptoms.** `hooks/voiceRoom.ts` published the captured
microphone as

    published = new LocalAudioTrack(microphone, undefined, true);
    await room.localParticipant.publishTrack(published);

A `LocalAudioTrack` built by hand carries `source = Track.Source.Unknown`, and
`publishOrRepublishTrack` overwrites it **only** from `opts.source` — which was
not passed. So every LETSCUBE client published its microphone to the SFU as
`UNKNOWN`, and both of the SDK's microphone lookups key on
`Track.Source.Microphone`. Read out of the installed bundle rather than from the
documentation:

- `get isMicrophoneEnabled()` is
  `!(this.getTrackPublication(Track.Source.Microphone)?.isMuted ?? true)`. No
  such publication exists, so the `?? true` branch runs and it answers
  **`false`** — for the local participant and for every remote one, for the
  whole call. `report()` builds `muted: !isMicrophoneEnabled`, so **everybody
  was reported as muted, always**: the microphone-off glyph beside every name in
  the rail and in the capsule, whatever anybody did.
- `RemoteParticipant.setVolume(volume, source = Track.Source.Microphone)` does
  `this.volumeMap.set(source, volume)` and then
  `getTrackPublication(source)` — finds nothing, and returns having changed no
  volume. **Deafening was a complete no-op**, and the re-application on
  `TrackSubscribed` — added the same day after a mutation proved it was
  needed — could never match either, because it reads
  `volumeMap.get(publication.source)` and the publication's source is `UNKNOWN`.

So D-219's «stop hearing the room», shipped in `3bb80399` hours earlier, did
nothing; and the mute glyph told everybody the opposite of the truth.

**The fix is one option object:**
`publishTrack(published, { source: Track.Source.Microphone })`. `stopOnMute` is
false and `isUserProvided` is true, so naming the source changes nothing about
the capture's lifetime — it only tells the SFU and the SDK which of the
participant's tracks this is.

**Why the tests stayed green, stated rather than excused.** The stand-in's
`setMuted` sets `mediaStreamTrack.enabled = false` on the real captured track
and then publishes its own roster, so every mute assertion read a real track and
a fixture's own list. Both halves were right. Neither touched
`isMicrophoneEnabled`, which is the one thing the product reads.
`tests/unit/voice-room-seam.test.mjs` now asserts the source is named, and a
mutation removing it turns it red — a source read, with the weakness that
implies, and the only instrument that reaches inside that function.

---

## D-224 `[x]` A force-mute would have ended the microphone capture, and the light would have gone out

**Severity:** high, and it was latent rather than live — the route that triggers
it shipped on 2026-09-18 and nothing called it until the same day's client half.
Recorded because it was found by reading the SDK rather than by watching it
happen, and because the file's own comment already claimed the opposite.

**What the SDK does.** `LocalParticipant.unpublishTrack(track, stopOnUnpublish)`
resolves
`stopOnUnpublish ?? roomOptions.stopLocalTrackOnUnpublish ?? true` and, when
that is true, calls `track.stop()` — through `LocalTrack.stop` to
`Track.stop` to `_mediaStreamTrack.stop()` — with **no `isUserProvided`
guard**. A server-side unpublish, which is exactly what revoking `canPublish`
produces, therefore ends the `MediaStreamTrack` the hook captured and owns.

**What that would have looked like.** A moderator silences somebody. That
person's browser microphone indicator goes out mid-call. Lifting the silence
gives them permission to publish a track that no longer exists, so speaking
again would need a second `getUserMedia` and a second permission prompt — and on
a phone, possibly a refusal.

**The comment in the file said this could not happen.** `voiceRoom.ts` carried,
and still carries, «`userProvidedTrack` is true: this track came from our own
capture, and the SDK must not stop it behind our back — the hook owns its
lifetime and ends it on leave, which is what turns the microphone light off.»
The flag does what it says on the `mute()` path; `unpublishTrack` does not
consult it. A true sentence about one path, believed about all of them.

Fixed with `new Room({ stopLocalTrackOnUnpublish: false })`, which makes the
same code path call `stopMonitor()` instead. `leave()` stays the one thing that
ends the capture, and `room.disconnect(false)` was already explicit, so nothing
else about the lifetime moves.

**The general lesson, which is the reason this is written down.** Both this and
D-223 are defaults in a dependency contradicting a comment in our own source,
and neither was reachable by any test in this repository. The instrument that
found them was reading the installed bundle — not the typings, which state the
shape and not the behaviour, and not the documentation. When a claim about an
SDK matters, read the code that ships.

---

## D-225 `[x]` A call kept running with nothing on screen about it, and no way to touch it

**Severity:** high. The microphone stayed open, and in the common case there was
no control anywhere to close it.

**Measured 2026-09-18** by reading `voiceCapsuleState` rather than by guessing.
A call survives leaving the conversation it started in — `useVoiceCall` holds it
as module state precisely so it does, and that is right. What did not exist was
any way to see it or act on it from anywhere else:

- in a chat that **owns** a voice channel, the capsule said «Вы в другом
  голосовом чате» and offered **nothing at all** — no mute, no deafen, no
  leave, no way back;
- in a chat that owns **none** — a private conversation, or any group made
  before channels existed — `if (!channel) return HIDDEN` fires first, so the
  running call was **completely invisible**.

The only way back to it was to remember which conversation it was in. This is
the state Discord's voice panel and Telegram's call bar both exist to prevent.

### What was built

`components/chat/VoiceCallBar.tsx` over a pure rule in `lib/voiceCallBar.ts`.
Four decisions, each with a reason that is not taste:

**Two placements, because the two shells have different shapes.** On a computer
both panes are on screen, so the bar docks at the foot of the chat list column —
Discord's position, and it costs the conversation nothing. On a phone there is
one pane and that column is not on screen while a chat is open, so it is a band
across the top — Telegram's position. One component; only the edge it carries
and how it narrows differ. Exactly one of the two is ever visible, and the e2e
pins that with a count rather than a visibility check, because a mistake in the
gating produces **two** bars rather than none.

**In the flow, never over it.** A bar floating above the list would cover the
last rows, and reserving room by padding the pane leaves a band of the
application's own ground in the bar's shape once the call ends — the failure the
owner saw on 2026-09-12, which `MainLayout` already carries a comment about. A
docked bar shortens the list instead.

**It stands down in the conversation that owns the call.** The capsule is
already there with the same three controls over the same module state; two
identical control sets on one screen is the relabelled duplicate this project
refuses, and on a phone they would be one band under another. On a computer the
handover is visible rather than a loss — both panes are on screen, so the
controls move from the column to the capsule in plain sight.

**No faces.** The capsule draws a stack and this deliberately does not: the
names the SDK carries are baked into each token at mint time, and outside the
conversation that owns the call there is no member list to correct them against.
A row of half-stale names is worse than none.

### The defect the pixels found, in this very component

The first capture read «Общий голос» over «Команда проекта · Вы в разг…». The
two facts were one string, and at the chat list column's default 360 points the
line ran out **inside the state** — the one thing somebody reads to know the
call is still up.

Fixed by making them two boxes rather than one string: the group's name
truncates and the state never does. The fact that survives being cut short is
the one that gets cut.

**And it is now a test rather than a screenshot.** `toHaveText` reads
`textContent`, which is the same string whether or not its box can show it —
which is exactly why the assertion passed while the pixels were wrong. The e2e
now measures `scrollWidth` against `clientWidth` on the state's own span, and a
mutation giving it `truncate` turns that red.

Ten mutations against the rule and six against the browser, all red. Pixels in
both themes, both placements, 1440 and 390.

**One flake, stated rather than buried:** the dark capture went red once on the
first cold run of these new modules with «element(s) not found», and has passed
twenty times since. It now asserts the call is still running *before* it looks
for the bar, so any recurrence says which half failed instead of leaving the two
indistinguishable.

---

## D-226 `[x]` A renamed channel heading reached nobody else, and nothing said so

**Severity:** medium, and it had been live since the headings shipped on
2026-09-14. Not an outage — a feature that silently did not work.

**Measured 2026-09-18 on production, read-only, and confirmed from both sides.**

The database side:

    tablename               | in supabase_realtime | replica identity
    chat_channel_categories | f                    | d
    voice_channels          | t                    | d
    voice_participants      | t                    | f
    topics                  | t                    | d

`20260914140000_channel_categories.sql` created the table, granted it, gave it
six policies and two foreign keys, and never added it to the publication — while
`20260913150000_voice_channels.sql`, written the day before, had a `do $publish$`
block for exactly this and a self-check counting the membership.

The client side, read out of the bundle live at `app.letscube.ru` rather than
out of the source, because what matters is what is deployed:

    yf(r.realtime, `server-channels:${e}`, [
      {event:"*", schema:"public", table:"voice_channels",          filter:`chat_id=eq.${e}`, …},
      {event:"*", schema:"public", table:"chat_channel_categories", filter:`chat_id=eq.${e}`, …},
      …
    ])

So the deployed client subscribes and the database has nothing to send. **This
was production behaviour today, not a gap waiting on a deploy.**

**What a person experienced.** An administrator renames a heading in «Каналы».
Their own screen changes, because `useChannelAdmin` updates its own held list.
On every other member's screen the old heading stays until they reload or reopen
the group. Same for a heading added, deleted, or dragged into a new order.

**Why it was easy to miss:** moving a *room* between headings already worked,
because that write lands on `voice_channels.category_id` and that table is
published. A tester dragging a room sees the other device update and concludes
the rail is live. It is the headings themselves that were not.

**Why it was contained, and why that is not luck.** On 2026-09-05 one
unpublished table killed every other binding on its channel while still
reporting SUBSCRIBED. `lib/realtimeTableChannels.ts` answered that with one
channel per table, and `useServerChannels` uses it — so this binding sat alone
on `server-channels:<chatId>:chat_channel_categories` and took nothing down with
it. That rule is the only reason this was a missing feature rather than a second
outage.

**Nothing warned anybody.** `realtime.subscription_check_filters` validates that
the filter's column exists and is SELECTable by the claims role; it never looks
at the publication. The subscribe succeeds, the channel reports SUBSCRIBED, and
the silence is indistinguishable from a group nobody has touched.

### Publishing the table was only half of it

The binding filters `chat_id=eq.<chatId>`, and `removeCategory` issues a real
DELETE — the only one of `useChannelAdmin`'s ten mutators that is not an INSERT
or an UPDATE. Under REPLICA IDENTITY DEFAULT the old tuple carries only the
primary key, so a DELETE reaches the filter with no `chat_id` in it.

That was not taken from documentation. `realtime.is_visible_through_filters`
lives in this database, is IMMUTABLE and pure, so it was asked directly:

    old tuple [chat_id, id] vs filter chat_id=eq.<that chat>   -> t
    old tuple [id]          vs filter chat_id=eq.<that chat>   -> NULL
    old tuple [chat_id, id] vs filter chat_id=eq.<other chat>  -> f

The middle row was the state before this migration: the function inner-joins
filters against the columns it is handed, a filter naming an absent column
aggregates over no rows, `bool_and` returns NULL, and `apply_rls` uses the
result in a `where`, where NULL is not visible. The third row is the control —
with the whole old tuple present the filter still refuses another group's
heading, so FULL widened the payload without widening the audience. All three
are assertions in the migration's own self-check, so it cannot stay green on a
Realtime that changes how it filters; a `relreplident` source scan could.

`replica identity using index` on the existing `(chat_id, id)` unique key was
considered and rejected: PostgreSQL treats a dropped replica-identity index as
REPLICA IDENTITY NOTHING **silently**, which is a rule living where nobody would
look for it, and all seven tables in this deployment with a non-default identity
use plain FULL.

### Applied

`.migration-backup/supabase/migrations/20260918180000_a_renamed_heading_reaches_the_other_rails.sql`,
as **`postgres`** — verified rather than assumed, because the two migrations
immediately before it had to run as `supabase_admin` and the schema is no guide:
`postgres` owns the publication and this table, `supabase_admin` owns
`voice_channels` and `voice_participants`.

Backup first: `/srv/letscube/backups/db-schema/pre-20260918180000-categories-realtime-20260918T052408Z.sql`,
1,352,382 bytes, sha256 `9ff7198a…36534a95`, 137 `CREATE TABLE` statements.
Then the whole file rehearsed on production inside a transaction that ended in
ROLLBACK — every notice fired, no exception — and production re-measured
unchanged after it.

Before → after: published `false` → `true`, replica identity `d` → `f`,
published tables in `public` 32 → 33, and **filenode 144372 → 144372**, which
the migration asserts itself rather than claiming: it reads
`pg_relation_filenode` either side of the DDL and raises if it moved. RLS still
on, six policies intact, `anon` still unable to read, the FULL-identity count in
`public` 7 → 8.

**No Realtime restart and no slot work**, and that is measured too:
`realtime.list_changes` rebuilds its `add-tables` argument from
`pg_publication_tables` on every poll, so the publication is a parameter of the
read rather than state baked into the `wal2json` slot. Both statements are also
guarded on the state they establish, so a second application does no DDL and
takes no lock.

**The client needed no change and no deploy.** The binding was already in the
bundle that was live.

### Found on the way, deliberately not folded in

`chat_members` measures the same way — published with replica identity `d`,
while `docs/SUPABASE_CURRENT_STATE.md:117` and `docs/SUPABASE_SCHEMA_MAP.md:314`
both claim FULL and `docs/proposals/2026-09-13-voice-channels.md:802` reasoned
from that stale line. `useChats.ts` binds its DELETE with
`filter: user_id=eq.<userId>`, so by the mechanism above that DELETE cannot
match either. **Not verified as user-visible** — `scheduleRefetch` may already
be reached another way — so it gets its own measurement and its own file rather
than a line in this one. Also recorded: the comment at `useChats.ts:451` says
`public.chats` is not published, and it is.

---

## D-227 `[x]` A listener could not turn one person down, and the control that would do it had been silently inert

**Severity:** medium as a missing feature, and worth an entry mostly for what
building it uncovered.

Discord's per-participant volume: a listener turns one other person down, for
themselves only, and nobody else learns about it. It is not moderation, so it is
offered to **everybody** — a different gate from «Заглушить в канале», which is
owner and administrator only, and deliberately not folded into those rules.

**It could not have worked before the same day's D-223.** `RemoteParticipant.setVolume(volume, source = Track.Source.Microphone)`
does `volumeMap.set(source, volume)` and then `getTrackPublication(source)`,
and every build before `91718323` published its capture as
`Track.Source.Unknown`, so the lookup never matched. Read out of the installed
`livekit-client` 2.22.3 rather than the documentation.

### Three things measured rather than chosen

**You cannot turn anybody up.** `createLiveKitRoom` builds its `Room` without
`webAudioMix`, whose default is `false`, so there is no `AudioContext` and
`RemoteAudioTrack.setVolume` falls through to `el.volume = volume` — which
throws `IndexSizeError` outside 0..1, a fact `lib/playbackVolume.ts:50` already
records in this codebase. Discord's 200% would need `webAudioMix: true`, which
routes the whole call through an `AudioContext` (a suspended context with no
gesture is a call with no sound) and changes the `switchActiveDevice("audiooutput")`
branch the output-device control depends on. That is a change to how calls are
heard, not a slider's maximum, so the range is 0..100%.

**The old build problem, and what the interface does about it.** The `source`
fix covers what *this* client publishes; a remote's publication source is
whatever *their* build declared. Anyone on the previous web build or the Android
0.1.7 APK publishes `UNKNOWN`, and `setVolume` finds no publication for them and
changes nothing at all. So the seam reports a reading per participant —
`audioSource`, `"microphone" | "unnamed" | "none" | null` — computed by **the
same lookup `setVolume` makes**, so it answers exactly «will a chosen loudness
land». For `"unnamed"` no slider is drawn at all, and a sentence takes its
place: «Изменить нельзя: участник подключился из старой версии приложения.» A
sunk slider is still a slider and a reader would still drag it.

**Deafen and per-person volume are one knob, so they meet in one function.**
`volumeFor(userId)` inside the seam returns `deafened ? 0 : chosen ?? default`,
and the applier runs on `ParticipantConnected` and `TrackSubscribed` as before —
so somebody joining while you are deafened still arrives silent, and undeafening
restores each person's *chosen* value rather than 1. Choosing a volume while
deafened holds it and pushes `volumeFor`, never the new value, so it cannot make
one person audible; and because dragging a slider then would otherwise look like
a control doing nothing, the band says «Вы не слушаете канал — громкость
применится, когда включите звук.»

Stored per person, not per person per room (`kub:voice-volume:v1`): the reason
you turn somebody down is their microphone, their room or their headset, and
those follow them between channels. A value back at the default **removes** its
entry, so the record is only the people actually turned down. Seeded inside
`createLiveKitRoom` rather than pushed in by a screen, because no component is
guaranteed mounted while a call runs.

### A green mutation that changed the design

`voiceVolumeOffer` originally took `inThisRoom`, and forcing it `true` left the
e2e green. It was redundant **and** the weaker question: `ChatWindow.occupantsOf`
hands the rail SDK rows only for `call.channelId` while the phase is connected or
reconnecting, so `audioSource !== null` already means «audio I am actually
receiving», where a channel-id comparison also says yes during a join that has
not connected. The parameter is gone and the mutation is recorded in the code.

### The pixels found a defect, then found the fix's own defect

The slider was `accent-[var(--kub-cyan)]` alone, matching the sound settings'
slider. `accent-color` paints the filled half and the thumb and leaves the rest
of the track to the browser: measured in the dark theme, the empty track came
back **`rgb(59, 59, 59)`** — a pure neutral grey, no hue — on a panel ground of
`rgb(17, 42, 71)`. On this navy it reads as a foreign part.

The first fix reached for `--kub-surface-3`, the token `AudioMessage` uses. The
pixels refused that too: on dark it is `#112B47`, which is this glass panel to
within a rounding error, measured at **1.01:1** — the empty half did not fade
into the panel, it vanished, leaving a cyan bar that stops with no groove saying
how much range is left. Worse than the grey, which was at least visible.

So `--kub-range-track`, declared per theme beside `--kub-rule` and for the same
reason — a tone whose value is a measurement: `#081629` on dark (**1.25:1**
against the rendered panel, and the inset well's own value, which is what a
recessed groove should be) and `#DCEBF7` on light (**1.20:1**, where
`--kub-surface-3` was already right). Fill against empty stands at **5.12:1**
dark and **4.34:1** light, so the boundary between them is the clearest thing in
the control — which is the one thing it has to say.

**A bounded finding to go with it.** Three sliders in the product leave their
empty track to the browser: `chat/ChatMediaPlayback.tsx` (two) and
`settings/AudioSettingsSection.tsx` (one). `chat/AudioMessage.tsx` and
`chat/attach/AttachVideoQuality.tsx` paint both halves at their call sites. The
new `.kub-range` class is that, in tokens, once — so the sweep is one class per
slider rather than a paragraph of per-engine rules each. Recorded under D-222's
tier ordering rather than opened as a separate entry: same shape, same screen
family, and the measurement above is the evidence.

Twenty-eight mutations, all red — nineteen against the rules, nine against the
browser, each of the latter verified as **served by Vite** before the run,
because a scripted write landing between watcher events gives a green run that
proves nothing. One mutation was refused by its own harness for a non-unique
anchor and re-run with a unique needle.

---

## D-228 `[x]` Nothing told anybody that a call was happening in a group they were not looking at

**Severity:** medium, and the kind that makes a whole feature look unused. A
voice channel nobody happens to be watching is a voice channel nobody joins.

Slice 3 of `docs/proposals/2026-09-13-voice-channels.md:1141` calls this «the
chat-list indicator». Of that slice's four items, three were done — the call
survives navigation (module state), and the desktop bar docked in the left
region shipped the same day as D-225 — and this was the one left: **a call in
progress was visible only from inside the group it was in.** The bar tells a
person about *their own* call from anywhere; nothing told them about anybody
else's.

### What was built

A mark on the chat row: a headset glyph and a number, in `--kub-online-text`,
at the head of the second line's meta cluster. The specifics — which room, and
whether there is more than one — go in the hover sentence, where there is room
to be specific: «5 человек в «Планёрка» и ещё в 1 канале».

Four decisions worth stating:

**The count is everybody in the conversation, not the busiest room's.** A group
with two in «Общая» and three in «Планёрка» has five people talking in it, and
the row is answering «is anything happening here» rather than «which room». The
fullest room is the one the sentence names, because it is the one somebody
looking for company would join; ties break by name so two reads that say the
same thing cannot print different sentences.

**Leftmost of the meta cluster**, ahead of the pin, the mute and the unread
counter, because it is the only one of the four about something happening right
now — the other three are states of the row.

**It fades with the column, on purpose.** The mark sits inside
`data-chat-row-body`, which closes as the chat list is dragged down to a
66-point strip of avatars. That is the same rule the unread counter already
follows, and following it is the point: at 66 points the row *is* the avatar,
and an exception here would be a second answer to a question the column has
already settled.

**The counter is all there is, and the cost is named.**
`voice_channels.participant_count` is denormalised — written by the SFU's
webhooks, reconciled twice a minute — so for a few seconds after the last person
leaves a row can still say somebody is there. The rail does better by preferring
the listed people, but listing people means reading `voice_participants` for
every room of every chat in the list: a request per room, for a mark the width of
a glyph. The opposite error — a call in progress the list does not mention — is
the one this exists to fix, and it is the worse of the two.

### The render cost, measured by the project's own instrument

The chat list is the most render-sensitive surface here and already has a
contract in `tests/e2e/chat-list-event-cost.spec.ts`. A map of chats handed to
every row through a prop or a context renders **every** row whenever anybody
anywhere joins or leaves a call — which is the measurement that turned
`useVoiceSpeaking` into a boolean per person (190 face renders for 10 speaker
changes).

So the map is module state and each row subscribes to **its own entry** through
`useSyncExternalStore`. That only works if an unchanged entry stays the *same
object*, because the read rebuilds every entry from rows: hence
`mergeVoicePresence`, which hands back **the held map itself** when nothing
changed and reuses each unchanged entry when something did. It is in the pure
module rather than in the hook precisely so it has a test — a rule inside a
`"use client"` module is a rule with no test.

The proof is not my own assertion. `chat-list-event-cost.spec.ts`'s own counter,
run with this in place, reports for a return to the tab:

    requests={… "GET voice_channels":1 …} renders={"ChatListItem":0, "rows":{}}

One read, and **zero rows re-rendered**.

### Two stale comments corrected on the way, and one open question

Both said `public.chats` is not in the `supabase_realtime` publication —
`hooks/useChats.ts:456` and the header of `lib/realtimeTableChannels.ts`, which
offered it as the *explanation* for the 2026-09-05 outage where a channel
carrying `messages` and `chats` bindings delivered nothing while reporting
SUBSCRIBED.

Measured read-only on production on 2026-09-18: **it is published**, one of 33
tables in `public`, and no migration in `.migration-backup` adds it. So either it
was added outside a tracked migration at some point after that outage, or it was
published all along and **the cause of that outage is still unknown.**

The rule those comments protect is untouched and does not depend on the
explanation: the contamination was proven by construction against the live
server — the same channel minus the `chats` bindings delivered, and two orderings
of the pair did not — and `realtimeTableChannels.ts` was deliberately written as
«one channel per table» rather than as an allowlist of published tables, so that
nobody has to reason from the publication at all. Both comments now say what was
measured and when.

Fourteen mutations, all red, including the three that break the render-cost rule
specifically: a merge that always builds a new map, one that ignores a shrinking
map (an ended call would stay on the list for ever), and one that replaces an
unchanged entry anyway.

---

## D-229 `[x]` A call left no trace in the conversation it happened in

**Severity:** medium. Slice 3's last named item after D-228, and the one that
makes a call part of the group's record rather than a thing that was briefly
true in a rail.

A voice chat started, ran and ended, and the conversation said nothing. Somebody
scrolling tomorrow could not tell it had happened; somebody in the chat now
learned a call was running only by watching the rail.

### «Once per call, not once per join» is the whole difficulty

The proposal's own gate. Three measured facts stood in the way, and the answer
dissolved all three rather than working around them:

1. **Asking for a token creates the room**, so `room_started` fires for somebody
   who pressed join and never connected. `docs/operations/voice.md` records
   `active_since` being set for a minute after any press.
2. **`room_finished` can be lost to a restart.** `20260918160000` cleaned up one
   row whose `active_since` had been set with nobody in the room since
   2026-09-13.
3. **A webhook can be delivered twice.** `voice_webhook_event_seen`
   de-duplicates a *delivery* — by `event.id`, or a SHA-256 of the body when
   LiveKit sends none — but not the *fact*: a room recreated a minute later
   sends a second `room_started` under a new id. (My brief said «nothing in the
   current path is idempotent»; that was wrong, and the correction is the useful
   part — the delivery is covered, the fact was not.)

**So the fact is not a webhook at all: it is the transition of
`voice_channels.participant_count` through zero.** A `BEFORE UPDATE OF
participant_count` trigger, latched by one new nullable column
`call_announced_at`, over a pure rule:

    voice_call_transition(before, after, announced)
      0 → >0, not announced  → 'start'
      >0 → 0,  announced     → 'end'
      anything else          → nothing

Asked directly on production after applying: `start / nothing / end / nothing`
for 0→1 unannounced, 1→2 announced, 2→0 announced, 0→1 already announced. The
second, third and tenth joiner write nothing, which is the gate.

Each fact falls out rather than being handled: a press that connects nobody
never moves the count off zero, so (1) cannot produce a line. Every occupancy
path funnels through `private.voice_channel_recount` — the join and leave
webhooks, the reconciler's `voice_participants_replace`, the reaper's
`voice_participants_reap` — so «ended» is driven by whichever layer notices
first and needs no webhook at all, which answers (2). And a redelivered
`participant_joined` is an upsert that moves no count, so it never reaches the
trigger, which with the latch answers (3).

### Two appended rows, not one edited

A single row updated when the call ends has a different failure mode: a row
claiming a call is **running** has to be corrected, and a correction that never
lands leaves the scrollback asserting a call in progress for ever. Appended rows
state a past event at the point it happened, so a lost end line leaves a start
with no end — incomplete rather than false. «Is a call running now» is the
rail's question and it answers it from `participant_count`.

### The copy, and what it says about a room that no longer exists

    Начался разговор в канале «Общая»
    Разговор в канале «Общая» закончился

«разговор» and «канал» are the product's own words — `VoiceCallBar` says «Выйти
из разговора», `ChannelRail` says «Отключить от голосового канала?». «в канале
«Имя»» rather than «в «Имя»» because a quoted proper name can only stay
nominative when a generic noun carries the prepositional case; D-166 solved the
same problem with a colon.

The name is **snapshotted into the content**, with no foreign key to the
channel. A rename after the call leaves both lines untouched; deleting the room
leaves both standing; a rename *during* a call gives the start line the old name
and the end line the new one, because each line records the moment it was
written. All three are tests.

### What was checked before it was applied

Four facts read independently off production rather than taken on trust, because
this INSERT runs **inside the transaction that joins or leaves a room** — a
failed write here would break joining, which is far worse than a missing line:

- `messages_sender_shape_check` requires a `type = 'system'` row to carry
  `user_id IS NULL AND bot_id IS NULL`, which is exactly what the writer
  inserts — and, with the INSERT policy wanting `auth.uid() = user_id`, is why
  **no client can forge one**;
- `messages` is owned by `postgres`, `voice_channels` by `supabase_admin` — so
  the file runs as `supabase_admin` and re-owns its functions to whoever owns
  `messages`, derived from `pg_class` rather than named;
- `enqueue_message_notifications` returns early for a system row, so **nothing
  is pushed**. A notification when a call starts is a separate product decision
  and is deliberately not taken here;
- `call_announced_at` did not already exist.

The migration also **enforces its role rather than describing it**: its first
statement asks `pg_has_role(current_user, <voice_channels' owner>, 'USAGE')` and
raises naming the owner. The three migrations before it put the role in a
comment and two of them failed on «must be owner of …».

Applied 2026-09-18 as `supabase_admin` after a verified backup
(`pre-20260918200000-call-service-message-20260918T064858Z.sql`, 1,353,004
bytes, sha256 `ac9eeee7…`, 137 `CREATE TABLE`) and a rehearsal of the whole file
on production that ended in ROLLBACK. The column was added without a rewrite,
proved by comparing `pg_relation_filenode` across the statement, and the
self-check drives a synthetic group and room through a whole call and then
abandons it by raising a sentinel inside a subtransaction — so the end-to-end
path is exercised at apply time and the migration refuses rather than committing
half. **No client change and no deploy**: the line renders through the system
message the product already has.

### Three green mutations, each one a finding rather than a pass

`security definer` dropped, the `WHEN` clause deleted alone, and `update of
participant_count` widened to `update` all stayed green — and each is
redundant-by-design rather than untested: every path today arrives inside one of
the existing SECURITY DEFINER RPCs and `authenticated` holds no UPDATE on
`participant_count`, so the two trigger clauses are pre-filters rather than
gates. They stay, and the file now says why. The mutation the gate actually
rests on — the rule firing per arrival with the `WHEN` clause deleted — turns
**five** cases red, including «one start and one end, not one per join».

Two weak guards were found and tightened on the way: the filenode guard passed
for `if false then`, and a self-check mutation passed because the migration is
idempotent and restored the function before the check ran.

### The one residual, stated rather than buried

If the participant mirror wrongly dips to zero — the reaper firing on a live
participant after minutes of failed reconciliation — the conversation gets a
spurious end/start pair. That is a mirror-accuracy defect which shows identically
in the rail, is bounded by the reconciler's 30-second period, and cannot flap,
because `voice_participants_replace` is atomic. A genuine last-person-leaves
**is** an ended call, and rejoining **is** a new one.

---

## D-230 `[x]` Voice had no off switch, no real rate limit and no ceiling

**Severity:** medium as a live risk, high as an operational one. The feature
could not be turned off without a code change, the rate limit bounded one
isolate rather than the deployment, and nothing capped how many people the SFU
could be asked to carry.

Slice 5's remaining half (`docs/proposals/2026-09-13-voice-channels.md:1162`).
Moderation shipped earlier the same day; these three are what was left.

### The kill switch, and the two qualifications the proposal's gate needs

`VOICE_ENABLED`, on the `BOT_CREATION_ENABLED` pattern verbatim in shape
(`artifacts/api-server/src/bot/managementRoutes.ts:74-83`): one pure function,
the environment passed in as an object, `"false"` closes it, absent or `""` or
`"true"` leave it open, and **anything else is a configuration error rather than
an implicit «on»**. Read per request, never captured in a constant.

The proposal says «the kill switch turns the feature off for everyone without a
deploy». Two qualifications, both measured rather than assumed:

1. **It needs no function deploy, but it does need a container restart.**
   `Deno.env.get` reads the container's process environment, which Docker fixes
   at container start. `BOT_CREATION_ENABLED` has the identical requirement.
2. **It does not hang up calls already in progress.** LiveKit keeps a room alive
   while anybody is in it and a minted token is good for ten minutes, so `false`
   means «no new or re-joined calls»; a live twenty-person call drains as people
   leave. Closing that needs `DeleteRoom` from the reconciler — a worker change
   and a second deployable — and is **deliberately not built**.

**What the switch reaches is as important as that it exists.** `/token` only. It
does **not** gate `/webhook`: refusing those would strand `participant_left` and
`room_finished` and leave every chat list showing calls that had ended — the
interface lying rather than saying it is off. Nor `/force-mute` and `/remove`, so
a moderator keeps their levers while a call drains. Both are asserted.

One venue difference from the bot gateway, of mechanism rather than policy: a
long-lived Node process can refuse to boot on an unrecognised value, and an
Edge Function has no boot to fail — so an unrecognised value refuses the request
with `not_configured`, which this gateway already sends for an unusable
environment and which the client already reads as «Голосовые чаты сейчас
отключены.»

### The rate limit that binds the deployment

`moderationRateLimit.mjs` was honest in its own header about being per-isolate
and about what the real thing needs: «a table and an RPC, which is the
`support_rate_limit_signals` pattern and a migration». That is now built:
`private.voice_rate_limit_signals`, `public.voice_rate_limit_consume(...)` which
counts the window and records the attempt in one transaction under a
per-(action, caller) advisory `xact` lock, and
`public.voice_rate_limit_prune(...)` shaped like `voice_webhook_events_purge`.

**And the old claim was worse than «per isolate» suggested**, which is now
explicit in the source: the deployment limit was (isolates times 20) with no
bound on the first factor, and the limiter *forgets* a caller when its isolate
is recycled.

**The refusal writes nothing, and that is the design.** Per caller per window
the row cost is the *limit* — twenty rows — independent of how hard anyone
hammers. Recording refusals would push the window forward on every rejected
attempt and make the cost proportional to the attack rate. Proved on production
inside a rolled-back transaction: the 21st attempt is refused with
`retry_after_seconds: 60`, and three refusals later the table still holds
exactly **20** rows.

The token route and the moderation routes keep **separate** allowances, also
proved: a moderator clearing a raid must not spend the allowance they need to
rejoin. The per-isolate map stays in front of both, so a held-down button still
costs no round trip.

**Fail-open, deliberately.** An error, a missing function or an unrecognised
answer allows the call. Every check that decides whether somebody may be in a
call at all — `is_banned`, the membership row, the per-channel cap — already
fails closed in the same function, so a broken limiter cannot let an
unauthorised person in; it can only let an authorised member mint faster than
intended, and the per-isolate layer still bounds that. Failing closed would turn
a slow table or an unapplied migration into a total voice outage. The
degradation is therefore not «no limit» but «the limit this gateway had
yesterday» — which is also why the function and the migration can ship or roll
back in either order.

Pruned by the voice reconciler in the same tick as `purgeWebhookEvents`,
retention ten minutes.

### The concurrency cap, and why it can only be advisory here

`VOICE_MAX_TOTAL_PARTICIPANTS`, read per request. Absent or empty is no cap —
today's behaviour; a plain positive integer up to 10 000 is the cap; and `0`,
`-1`, a leading space, `1e3` and `forty` all refuse with `not_configured` rather
than being read as unlimited.

`public.voice_active_participants(p_in_flight_seconds)` counts
`voice_participants` **plus** the mints of the last thirty seconds with no
participant row yet, and that second half is not optional: the mirror lags a
join by a webhook round trip, so counting it alone would let a rush of
simultaneous joins all read the same pre-rush number and all pass.
`count(distinct user_id)`, so one flaky client retrying cannot eat the cap. Both
halves proved on production: with two in-flight mints and no connected rows,
`voice_active_participants(30)` answers **2** and `voice_active_participants(0)`
answers **0** — the isolation the agent added after finding its own self-check
could not tell the two terms apart.

Checked **before** the allowance is spent, so a full deployment writes nothing
and keeps answering the truthful reason however often it is asked. New wire code
`voice_at_capacity` (503) becomes the category `at_capacity` and the sentence
«Сейчас слишком много активных звонков, попробуйте позже.» Not `channel_full`,
which would be false about a half-empty room and would send somebody looking for
a person to remove. An older client falls back on the 503 to `disabled`, so the
gateway may ship ahead of the app.

**Two things this layer cannot do, stated rather than implied.** LiveKit
enforces `max_participants` per room and has no server-wide equivalent, so the
gateway can refuse to mint but cannot evict, and a token minted a moment before
the cap was reached still joins. And **the number cannot be derived from this
repository**: section 1.6 records no `nproc`, no `free -h` and no traffic
allowance for this host, so the mechanism enforces whatever the deployment sets
and defaults to unset. The only measured input is the egress table of section
2.3 — 18.2 Mbps worst case for one room of twenty, 117.6 for one of fifty,
per-room and quadratic. **Left empty pending the owner's number.**

### Four green mutations, each one a finding

Two in the gateway: a `typeof data === "boolean"` guard that was **redundant**
because the conversion already excluded booleans — it claimed to prevent a
hazard it could not reach, and was removed with the reasoning moved onto the
conversion; and a **genuine coverage gap**, a `deploymentLimit` fixture option
added for the moderation route and never asserted against, closed with «a
moderation action the deployment refuses is a 429, not a silent success».

Two more in the migration's own self-check, and they are the instructive ones:
`v_active >= 1` over a **sum of two terms** is satisfied by either term, so
deleting the in-flight subquery, zeroing the connected count and counting the
wrong action all passed. Isolated by the window — `voice_active_participants(0)`
can see no in-flight signal at all — and by moving the measurement ahead of the
row it was meant to count.

The advisory lock, which no single-session check can see, is proved
deterministically with two `psql` sessions rather than by racing: A holds its
transaction open after one consume, B with a two-second `lock_timeout` is
cancelled naming the `perform` line, C — a different caller — returns
immediately, and with the lock removed B returns immediately too. That last is
the control.

Twenty-nine gateway and client mutations plus eleven on the migration, all red
after the four findings above were fixed.

### Applied

`20260918190000_voice_limits_bind_the_deployment.sql` as `supabase_admin`, after
a verified backup (`pre-20260918190000-voice-limits-20260918T070048Z.sql`,
1,359,780 bytes, sha256 `f5413a57…`, 137 `CREATE TABLE`).

**Rehearsed twice, and the second time was not optional.** The agent rehearsed
on a throwaway PostgreSQL **18.4** cluster because Docker's daemon was down on
its machine; production is **17.6**, read off `version()`. So the whole file was
rehearsed again on production inside a transaction that ended in ROLLBACK before
it was applied.

The role was verified rather than taken from the file:
`private.voice_webhook_events` is owned by `supabase_admin`, `postgres` is
**not** superuser on this deployment, and `20260913150000`'s own header says
«apply as postgres» while the objects it produced belong to `supabase_admin` —
**a migration's own sentence about its role is not evidence.** The file carries a
precondition that refuses if `current_user` cannot create in `private`, and a
check that refuses to commit if the new table's owner differs from its sibling's.

Verified after: the table is owned by `supabase_admin`, lives in `private` where
PostgREST cannot reach it, and `service_role` alone may execute the three
functions — `authenticated` and `anon` may not. **No `alter table` on an
existing relation anywhere in the file**, so nothing existing was locked and
nothing was rewritten.

One probe of mine was refused by the table's own CHECK constraint because I
spent an action named `probe`, which is not one of the two the constraint
allows. That is the constraint doing its job, and it is the same rule a mutation
covers — worth recording as the cheapest possible confirmation that the action
vocabulary is closed.

### One thing deliberately not done

The first draft warned once per isolate when the limiter could not be reached,
because failing open silently is the version of that decision nobody can
operate. `voice-gateway-token.test.mjs` bans **any** `console.*` in this gateway
— a blanket rule rather than a judgement about which strings are safe — so the
logging was removed rather than the guard narrowed, and the two queries that
answer the same question are documented instead. Changing that guard is a
deliberate decision, not a side effect.

---

## D-231 `[!]` A pre-call connection test cannot honestly be built here, and the measurement says why

**Severity:** none as a defect. This entry exists so that nobody builds the
dialogue later, because the version of it that is easy to build **lies to every
user, every time**, and the lie looks like reassurance.

The voice audit listed «a connection test — the ten-second pre-call check,
distinct from the live monitor» as absent. It was measured on 2026-09-18 before
anything was built, and the honest answer is «almost nothing». Nothing was
built.

### The decisive finding, with a positive control

The one fact worth knowing before a call is **whether this browser can reach
`7882/udp`**, because that is the difference between a good call and a call
dragged over TCP.

`157.22.206.43:7882/udp` is **silent to an unauthenticated STUN binding
request**, and the control in the same run proves the instrument and the
machine's outbound UDP were both fine:

| target | answer |
|---|---|
| `stun.l.google.com:19302` (control) | **reply**, 32 bytes, STUN type `0x0101`, transaction id matches |
| `157.22.206.43:7882` — the ICE mux | **silence** |
| `157.22.206.43:3478` — slice 1's TURN port | **silence**; TURN is gone, matching `turn.enabled: false` |
| `157.22.206.43:7881/tcp` | connected, 19 ms |
| `157.22.206.43:7880/tcp` — twirp | timeout, confirming it is unpublished |

The reason is structural rather than configurational: the UDP mux demultiplexes
by the ICE ufrag in the STUN `USERNAME` attribute, and a packet carrying an
unknown ufrag is dropped rather than answered. No token, no ufrag, no answer.

**So the obvious probe inverts.** Run in a real Chromium, twice, three arms:

| arm | ordinary browser | with non-proxied UDP disabled |
|---|---|---|
| no `iceServers` | 1 × `host/udp`, complete | 0 candidates |
| `stun:157.22.206.43:7882` | 1 × `host/udp`, **no srflx, gathering never completes** | 0 candidates |
| `stun:stun.l.google.com:19302` (control) | `host/udp` + **`srflx/udp`** | 0 candidates |

Read the first column. **A probe that uses the mux as its STUN server reports
«no UDP» on a network where the control proves UDP works perfectly.** That is a
false negative for everybody — the «plausible number measuring nothing» in its
purest form, and it would tell every user their network cannot carry a good
call.

### Three more reasons, each measured

**The client does not know the signalling URL at all.** `LIVEKIT`, `livekitUrl`
and `VITE_VOICE` return **zero** matches across `artifacts/kub/src`. The URL
arrives only inside the token response, and `lib/voiceGateway.ts` states the
invariant on purpose: «Chosen by the gateway, never by the client.» A token-free
probe therefore has nothing to aim at unless it hardcodes a path the gateway
owns — which is the exact class of mistake `docs/operations/voice.md`'s «Two
URLs, which are not the same URL» section records as the first draft's bug.

**Signalling measures the path the app is already using.** Media is not proxied:
`rtc.tcp_port: 7881`, `udp_port: 7882`, `node_ip: 157.22.206.43`. Signalling is
TCP/443 through Traefik; media is UDP/7882 or TCP/7881 straight to the box.
`api`, `app` and `core` all resolve to that one address, and the person pressing
the button is already talking to it over HTTPS and a Realtime WebSocket. A good
number is compatible with a terrible call; a bad one means the application is
down.

There is one real measurement available — `GET /voice/rtc/validate` answers
**401** with CORS, so a browser can read the status, measured at
`[17, 63, 16, 17, 15]` ms — and it **is not free**: every such request writes a
`WARN … "status": 401 … "error": "no permissions to access the room"` into the
SFU log, which `docs/operations/voice.md` calls «the best account of what
happened in a call». Five samples per press is five lines of 401 noise per user
per press.

**And the browser cannot reach the media ports any other way.** From
`https://app.letscube.ru`: `fetch("http://157.22.206.43:7881")` is refused in
**1 ms** as mixed content and never leaves the browser;
`new WebSocket("wss://157.22.206.43:7881")` fails in 83 ms and **JavaScript sees
no status at all** — only the timing differs from a filtered port, and timing is
not an instrument.

**This deployment offers a client neither STUN nor TURN.** `turn.enabled: false`,
no `stun_servers` key, one voice container. So candidate gathering can only use
a third party such as Google's — which measures UDP to Google rather than UDP to
this host, adds an external dependency to every user's pre-call flow in a
deployment whose audience partly arrives through a tunnel, and puts a
third-party network call somewhere the privacy policy would then have to
describe. A different measurement wearing the right label.

One aside worth keeping: `navigator.connection` on the live page reported
`effectiveType: "4g"`, `downlink: 9.2` and **`rtt: 0`** on a working wired
connection. That is D-217's own defect handed over by the platform — a confident
zero where the truth is unknown.

### What to do instead, and it is better than the test would have been

**Report the transport the live call actually chose.** `sampleHealth()` in
`hooks/voiceRoom.ts` already walks `candidate-pair` entries and reads
`currentRoundTripTime`; it discards `localCandidateId`, so `protocol` — `udp`
against `tcp` — is one lookup away in the same `RTCStatsReport`. That is the
good-call-versus-TCP-call fact **measured rather than predicted**, at no extra
cost, needing one nullable field on `VoiceHealthSample` and one line of
vocabulary in the connection panel.

It also closes a real gap: **it is nowhere recorded which transport a production
call takes.** Since `turn.enabled: false`, no production client is handed a STUN
server at all — slice 1's srflx measurements were taken on a probe that *had*
TURN on 3478 — so production clients rely on peer-reflexive candidates from the
SFU's own connectivity checks, and nothing has ever confirmed which path they
end up on.

A genuine pre-call test is possible but needs a server change: a gateway route
minting a short-lived token for one dedicated probe room, the client connecting
with `autoSubscribe: false` and publishing nothing, reading the selected
candidate pair's protocol and round trip, then disconnecting. It costs one
rate-limit allowance under its own action, one probe room, and one notional seat
for thirty seconds — and it needs a probe channel **no chat's rail reads**, or
the phantom-participant problem arrives with it.

### One probe recorded as inconclusive rather than as a verdict

Both `7882/udp` and a definitely-unbound `7883/udp` stay silent on a connected
socket, so the host drops ICMP unreachable and silence alone cannot tell «bound
but deliberately quiet» from «closed». The mux conclusion above rests on the ICE
arms and the Google control, not on that probe.

## D-232 `[x]` A call's microphone had two states, and a shared room heard everything between them

**Severity:** high. Not a control that looked wrong — a control that was
missing, in the one feature where its absence is heard by other people. A
person in a voice channel published continuously from the moment they joined:
their keyboard, their room-mate, the television in the next room, everything
said to somebody who walked in. The only remedy the product offered was mute,
and a mute has to be remembered twice — pressed before the noise and released
before the next sentence, which is the failure everybody who has used a
conference call knows.

**Scope note, stated first because it matters more than the fix.** This is
**not** in `docs/proposals/2026-09-13-voice-channels.md`. That document names
push-to-talk and the noise gate twice as explicitly out of scope — in slice 2's
exclusion list and again in section 7 — and both lines are now struck through
with an addendum pointing here. It was built during continuous work under the
owner's standing instruction, and it is scope beyond an approved design rather
than a slice that was quietly skipped. What it does not touch: the LiveKit
contract of section 3, the migration, the Edge Function, the caps, the
moderation model.

### What was there, measured rather than recalled

`hooks/voiceRoom.ts` published one microphone track and offered `setMuted`.
`buildAudioTrackConstraints` asks the browser for `echoCancellation`,
`noiseSuppression` and `autoGainControl` (`hooks/useAudioSettings.ts:172-186`),
which is genuine processing and is not a gate: it cleans the signal it is given
and publishes all of it. Discord and Telegram both answer this with a gate and
a hold key. This product answered it with nothing, and «mute when you are not
speaking» is not an answer — it is the work the gate exists to do, handed to
the person, in the middle of a conversation.

### Three modes, and why the third is not a relabel of the first two

`lib/micGate.ts`. `MicActivation` is `"open" | "voice" | "ptt"`, drawn as
«Всегда» / «По голосу» / «Рация» — Discord's own two words in the vocabulary a
Russian Discord user already has, plus the state this product has always been
in.

`open` is the **default**, and that is the load-bearing decision of this entry.
A stored `kub:audio-settings:v1` written before today has to go on meaning what
it meant, and somebody who never opens this section must not find a noise gate
in front of their voice tomorrow. Calling `open` «voice activity with the
threshold at zero» was the other option — it is what Discord's own slider does
at its bottom end — and it is refused because the interface would then name a
gate that never closes, which is a label disagreeing with its mechanism. The
owner's rule against relabelled functions applies to a mode as much as to a
screen.

### The arithmetic, and the two things a bare threshold gets wrong

The control is a **position** from 0 to 1, not a number of decibels, because
the live level is drawn on the same axis directly beneath it: a person setting
a threshold is comparing two quantities, and two axes for one comparison is how
a threshold control becomes guesswork. `MIC_GATE_FLOOR_DB = -70` is what
position 0.01 means; position 0 means «never closes». −70 rather than −100
because below about −70 sit the quantisation noise of a 16-bit capture and the
browser's own suppression, so the bottom third of the slider would be a region
where nothing ever happens.

`MIC_GATE_THRESHOLD_DEFAULT = 0.35` is −45.5 dBFS, and it is stated in the
source as a **starting point rather than a measurement of anybody's room**:
conversational speech peaks near −25 dBFS into a laptop capture and a quiet room
under «Чистый голос» sits below −60, so −45 has about 15 dB of margin either
way. A rough default is defensible here only because the surface draws the live
level against it — the control exists to be calibrated by the person, in the one
place their own microphone and their own room are available.

Two mechanisms, not one, because a bare threshold fails in two different ways:

1. **`micGateCloseAt` is half `micGateOpenAt`** — 6 dB of hysteresis. A voice
   crossing a single threshold chatters on the consonants.
2. **`MIC_GATE_HOLD_MS = 400`** — the gate stays open for 400 ms after the level
   drops. Speech has gaps at that scale; without the hold the gate closes inside
   a sentence and clips the word after the pause.

And the hold is **`voice` only**. In «Рация» letting go stops it, immediately —
a hold-open of even 200 ms turns «open only while I hold it» into a promise the
mechanism does not keep, which is the whole point of the mode.

### The mechanism under it, and the obvious implementation that is wrong

The gate drives `MediaStreamTrack.enabled` on the published track
(`voiceRoom.ts`, behind `setMicrophoneOpen`). It does **not** call `setMuted`,
and that is a measurement rather than a preference: a mute draws a crossed
microphone beside everybody's name, so a gate built on it would blink that glyph
on and off through every sentence, for every other person in the room. Measured
against a loopback `RTCPeerConnection` on 2026-09-18: **4902 bytes in two
seconds with the track enabled, 482 with it disabled**, `media-source.audioLevel`
at 0 — so disabling sends silence while the publication, the permission and the
participant list are all untouched. Nobody is told, because «not talking at this
instant» is not a fact about the conversation. A self-mute is, and it still
propagates.

Three seams that were found by reading the SDK rather than by guessing:

- **`LocalTrack.setTrackMuted` writes `enabled = !muted` unconditionally**
  (livekit-client 2.22.3: `unmute()` → `setTrackMuted(false)` →
  `this._mediaStreamTrack.enabled = !muted`). So every unmute puts the track
  back on the air whatever the gate had decided. The gate's value is held in the
  room object and re-applied, or somebody in «Рация» who muted and unmuted would
  be transmitting with nothing held.
- **`setMicrophoneOpen` is accepted before the join and remembered.** A call
  joined in «Рация» must not be audible for the length of one event loop between
  publishing and the first press, and the only way to guarantee that is for the
  state to exist before there is a track to apply it to. `setDeafened` and
  `setParticipantVolume` already work this way.
- **A mute wins.** `enabled = open && !published.isMuted`. Without the second
  half a syllable arriving while somebody is muted re-enables a track the SDK
  still believes is muted — audible to the room, with this client's interface,
  the participant list and the SFU all saying «выключен».

### Measuring the level, and the trap in it

`lib/micLevel.ts` opens one `AudioContext` per call and reads the level off a
**clone** of the local track. Not the track itself: a disabled track's analyser
reads 0, so a gate measuring the track it controls can open once and never
again — it would jam shut the first time it closed. The clone shares the
hardware source and its own `enabled` is never touched. A browser that cannot
measure — no `AudioContext`, or a graph that threw — returns `null`, and the
mode degrades to the on-screen control rather than to a microphone that never
opens.

### The key, and the one honest sentence about it

`MIC_TALK_KEY_DEFAULT` is `Backquote`. Eight codes are refused with a reason
each: `Escape` belongs to whatever a person opened (D-194 is in this register
about exactly that), `Tab` and both `Enter`s move focus and send, `Space`
scrolls and types, `F5`/`F11`/`F12` never reach the page usably. A bare modifier
is refused too. A refusal is a **sentence**, not a silent no-op: a control that
swallows a press and changes nothing reads as broken.

The default prints a character, and the settings row says so rather than leaving
somebody to discover it mid-sentence: «пока курсор в поле ввода, она не включит
микрофон — держите кнопку «Говорить»». In a messenger the cursor is in the
composer most of the time, so this is not a corner case. It is a sentence rather
than a refusal because the key works everywhere except in a field, and the
on-screen control covers the field.

Release is by window-level listeners on `blur`, `pointerup`, `pointercancel` and
`visibilitychange` — the same shape the composer's recorder uses, and for the
same reason: a button re-parented mid-gesture loses pointer capture, after which
the release is delivered somewhere else and the gesture never ends. One listener
on the window cannot be re-parented.

### The control on the phone, and the two trades it forced

A phone has no key, and the owner refuses a function that exists on one shell
and silently not on another — so «Говорить» is a control in the capsule and in
the call bar, and the key and the button are one mechanism: both call
`holdVoiceTalk`, both are released by the same window listeners. Two trades came
out of it at 390, and they were ruled differently:

- **The room's name truncates** («Общий го…») because of the fourth control.
  **Accepted.** The label on the control you must hold beats the name of the room
  you are already in, and the call bar drops the group name in this mode for the
  same pressure (`voiceCallBarState`, `talkControl: true`).
- **The control was a 32px hold target.** **Fixed.** 32 is the capsule's own
  deliberate size for a strip of chrome where a tap has the whole pill to land
  on; a press held through a sentence is the one interaction there that the
  product's 44px floor was written for, and sliding off it does not misfire — it
  stops publishing, silently, while the person is still speaking. Raising the
  control would push the row and cost the room's name what is left of it, so
  `.kub-hold-target::after` grows the hit area and not the paint:
  `inset-block: -6px` over 32px is 44 exactly, and 6px is ground both surfaces
  already hold in their own padding (`py-1.5` on the capsule's row, `py-2` on
  the bar's). Coarse pointers only. Four mutations turn
  `tests/unit/touch-target-system.test.mjs` red, including the one that paints.

### One defect of my own, found during the work

`.kub-range` — the per-theme slider track added for the threshold control, after
`--kub-surface-3` measured **1.01:1** against the panel and the empty half of the
track simply vanished — was written **inside `@media (min-width: 48rem)`**. It
therefore did nothing below 768px, which is every phone, which is the viewport
the control most needed it in. Found by reading the sheet at 390 rather than by
a test. The general shape is worth more than the fix: a rule placed in a file
that is mostly media queries inherits the nearest one silently, and nothing about
the declaration looks wrong.

### Coverage

`tests/unit/mic-gate.test.mts` (477 lines) holds the rules — modes, clamping,
the open/close pair, the hold, the key refusals, the vocabulary — none of which
needs a browser, because the decisions were deliberately put where
`node --test` can reach them. `tests/unit/voice-room-seam.test.mjs` gained 156
lines for the transport seam. Eight new tests in `tests/e2e/voice-call.spec.ts`,
including the ones that would catch the seams above: a call joining closed in
«Рация» without saying «выключен», a mute winning over a held key and unmuting
not leaving it open, a lost window letting go, the composer typing rather than
talking, the gate holding across a gap in «По голосу», «Всегда» costing nothing
new, and the bar's control on a phone — the only surface there. Photographed in
both themes.

### Deliberately not built

Noise **suppression** beyond the browser's (an RNNoise-class model is a
different proposal with its own weight budget); a per-person gate for what you
hear; a gate on voice **messages**, which are recorded by holding a button and
are not in a call at all — said in the settings screen rather than left to be
wondered about (`MIC_ACTIVATION_SCOPE_NOTE`); and any of it on the SFU, which
sees a participant publishing silence and nothing new.
