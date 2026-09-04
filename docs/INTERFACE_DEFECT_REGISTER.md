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

Found 2026-09-04 while closing D-004, and deliberately not fixed.

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

## D-036 — the decorative grid restarts in every element that draws it

Reported by the owner on 2026-09-04 from a screenshot crop: near the edit
pencil, rules that should form a corner do not converge — "не сходятся
корректно линии, некрасиво".

**Cause, and it is structural rather than a stray pixel.** `.kub-grid-subtle`
(`artifacts/kub/src/index.css:564`) paints a 56×56 lattice with two
`linear-gradient` background images and `background-size: 56px 56px`, and sets
no `background-position` anchor. A background's origin is each element's own
padding box, so **every element carrying the class starts its lattice at its own
top-left corner**. Two such elements can only line up by coincidence — when
their padding-box origins happen to sit a whole 56px apart. Wherever they do
not, the vertical rules step sideways across the boundary, which is exactly the
"intersection that does not meet" being reported.

Four surfaces carry it today, and three of them sit directly against another
surface:

| surface | file |
|---|---|
| profile/summary block of the chat info panel | `components/chat/ChatInfoPanel.tsx:610` |
| profile header in settings (avatar + edit pencil) | `components/sidebar/SettingsModal.tsx:216` |
| admin content area | `pages/admin/AdminLayout.tsx:126` |
| app background | `index.css` |

The settings profile header is the likeliest match for the crop — it is the one
that puts an avatar and a pencil side by side inside a `kub-grid-subtle` block
that then meets the rest of the modal — but which surface the owner was looking
at is not yet confirmed, and confirming it decides how wide the fix has to be.

**The fix is to give the lattice one origin instead of one per element**, not to
nudge a border. Either move the grid to a single common ancestor and let the
blocks that currently draw it be transparent, or anchor it so every element
shares a lattice. `background-attachment: fixed` would do the latter in one
line, but it anchors to the viewport rather than the document and behaves badly
inside scroll containers — of which three of the four surfaces are one — so the
ancestor route is the more likely correct answer.

Do not "fix" this by aligning one pair of blocks: any such adjustment holds only
at the viewport width where it was measured.
