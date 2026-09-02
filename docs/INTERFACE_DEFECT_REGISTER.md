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
