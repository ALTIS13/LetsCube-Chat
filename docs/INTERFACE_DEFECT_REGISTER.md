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

## D-004 `[ ]` The read count reads as a bare fraction with no unit or affordance

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

## D-005 `[ ]` The message meta row packs up to six elements without a hierarchy

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

## D-008 `[ ]` A wrapped message always pushes its time onto a separate line

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
