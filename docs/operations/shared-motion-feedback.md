# Shared motion and action feedback

Last updated: 2026-09-03 (Europe/Moscow).

This records the contract that `docs/superpowers/plans/2026-08-30-shared-motion-feedback.md`
shipped, so the Apple track and any later work adopt it rather than building a
second one beside it.

## Tokens

Defined once in `:root` in `artifacts/kub/src/index.css`, mirrored in
`artifacts/kub/src/lib/motion.ts` as `MOTION_MS`. A contract test asserts the two
agree, so a component that writes its own `duration-150` is outside the system
and drifts from it silently.

| Token | Value | Used for |
| --- | --- | --- |
| `--kub-motion-instant` | 90ms | A press, a hover, anything that must feel immediate |
| `--kub-motion-fast` | 140ms | A small state change on one control |
| `--kub-motion-standard` | 220ms | The default: panels, overlays, list changes |
| `--kub-motion-emphasis` | 320ms | A dialog arriving, something that should be noticed |
| `--kub-motion-feedback` | 2400ms | How long a transient confirmation stays readable |

Easing: `--kub-ease-standard` and `--kub-ease-emphasis`, both cubic-bezier.

## Reduced motion

Under `prefers-reduced-motion: reduce` the four movement durations collapse to
`1ms` and `.kub-interactive`'s press transform is removed.

`--kub-motion-feedback` deliberately does **not** collapse. The preference
removes movement, not feedback: collapsing it would delete a message the person
still has to read. `feedbackDuration()` shortens it to 1600ms instead, and an
error is not shortened at all.

## Action feedback

`showActionFeedback({ kind, title, detail?, key? })` from
`artifacts/kub/src/lib/actionFeedback.ts`. `copyWithFeedback(text, options)`
wraps the clipboard, including the failure branch.

- At most **three** visible at once, oldest dropped first. An unbounded queue
  covers the thing it is confirming.
- A `key` groups repeats: pressing copy twice is one result, not two.
- `success` and `info` last 2400ms; **`error` lasts 5000ms** and is announced
  with `role="alert"` rather than `role="status"`.
- `detail` is cut to 160 characters, because it may carry a message from
  somewhere else. Only already-sanitized UI text belongs there — never a raw
  error payload.
- One `KubFeedbackViewport` is mounted in `App.tsx`, above the router so a
  confirmation survives the route change that often produced it.

### Safe area

The viewport sits at `calc(env(safe-area-inset-top) + 6.75rem)`, which clears
the tallest chrome in the product: the staff area stacks a 56px header on a 45px
navigation strip. The first attempt used 52px and covered the last tab. What the
e2e pins is the **overlap with the navigation**, not the offset — the number
will change the moment the chrome does.

The container is `pointer-events: none` so it never swallows a click meant for
the interface underneath; the cards themselves take pointer events so they stay
dismissible.

## Async state

`createAsyncAction(timers, options)` from `artifacts/kub/src/lib/asyncAction.ts`
gives `idle → loading → success → idle`, or `→ error` which stays until the next
attempt. It refuses to overlap: a double-click on save sends one save.

`KubButton` overlays its spinner on the content instead of swapping icons.
Replacing `leftIcon` added an icon to a button that had none and dropping
`rightIcon` took one away — both change the width, and every control beside it
moves at the moment someone is reaching for one of them.

`KubStableSkeleton` requires an explicit width and height. A placeholder sized by
the text "Загрузка…" is what makes a page jump when the real content arrives.

## Modal transitions

Overlay opacity, and the panel from `translateY(8px) scale(.99)` to identity.
**Height and padding are never animated** — that would resize the dialog while it
is being read, and it would make the panel's box unmeasurable mid-entry.

The layout contract is measured with `offsetWidth`/`offsetHeight`, not
`getBoundingClientRect`: the latter reports the transformed rectangle, so the
entry's own `scale(.99)` shows up there as a 2px "failure". A transform reflows
nothing; an animated height would.

## What a section may not do while it is loading

`ProfileRoleSummary` printed "Локации не назначены" while its data was in
flight. That is not a layout problem — it is a claim the component had no basis
for. A section that does not yet know must show a placeholder, not an assertion.

## Apple handoff

The macOS/iOS track consumes this contract after pulling `main`. Do not fork a
second feedback protocol.

- The token names above are the interface. Native substitutions should map to
  the same five semantic durations rather than inventing their own.
- Reduced motion maps to `UIAccessibility.isReduceMotionEnabled`; keep the same
  rule — shorten feedback, never remove it, and never shorten an error.
- The feedback viewport's safe-area rule is `env(safe-area-inset-top)` plus the
  app chrome; on iOS that is the status bar plus whatever navigation the screen
  carries.
- `role="status"` / `role="alert"` map to `UIAccessibility.post(notification:)`
  with `.announcement` for success and `.screenChanged` for an error a person
  must act on.

## Verification

- `node --test tests/unit/motion-contract.test.mts`
- `node --test tests/unit/action-feedback.test.mts`
- `node --test tests/unit/async-feedback-state.test.mts`
- `pnpm.cmd exec playwright test tests/e2e/action-feedback.spec.ts tests/e2e/motion-layout-stability.spec.ts`

Every contract above has been mutation-tested: reverting it turns the suite red.
