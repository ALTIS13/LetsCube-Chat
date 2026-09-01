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
