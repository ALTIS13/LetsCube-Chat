# Interface audit and polish

Stage plan for queue item 18 of `docs/PRODUCTION_PRIORITY_TRACKER.md`, written at
the point the stage starts, as that entry requires. The approved scope and
ordering live there; this file is the task-by-task execution plan and nothing in
it may widen that scope.

## Standing rules for this stage

These are not restatements of the tracker for their own sake. Each one has
already been broken once in this project, which is why it is written down.

1. **A change needs a recorded defect or an explicit design decision.** Polishing
   by eye is out of scope. The register entry comes first, the fix second.
2. **A finding is not a finding without evidence.** Surface, viewport, theme,
   shell, reproduction, screenshot, severity. "Looks cramped" is not a finding.
3. **Mechanical before visual.** Anything a machine can measure — overflow,
   clipping, touch-target size, contrast, focus visibility, layout shift — is
   measured, not judged. Human judgement is spent only on what cannot be
   measured.
4. **A test that cannot fail is not coverage.** Every fix carries a regression
   test proportional to risk, and each one is mutation-checked: break the fix,
   watch the test go red. This stage inherits a suite that spent weeks passing
   without signing in; the bar is proof, not green.
5. **The critical regression list is binding.** Chat entry anchoring, search and
   notification jumps, history prepend, fast upward scrolling, notification
   grouping and read sync are contracts, not preferences.
6. **Never animate layout dimensions for decorative feedback**, and never let an
   essential action wait on an animation.
7. **`prefers-reduced-motion: reduce` removes movement, not feedback.** Text,
   icon and colour feedback stay.
8. **iPhone/iPad PWA behaviour is externally owned.** Shared tokens and handoff
   notes only.

## Matrix

Viewports: `3840x2160`, `1920x1080`, `1440x900`, `390x844`, `412x915`.
Themes: dark, light. Shells: browser, Windows Tauri WebView2, Android APK
WebView.

The Windows shell loads `https://app.letscube.ru` directly, so it shares the
browser's web code and differs only in chrome, window sizing and the desktop
bridge. The Android shell bundles its assets at build time, so it needs a build
of the branch under test to be worth capturing at all — that was established
while closing Task 5 and is not re-litigated here.

## Half A — audit first, then fix

### Task A1: build the audit harness

**Files:** create `scripts/interface-audit.mjs`, create
`tests/unit/interface-audit-harness.test.mjs`.

The harness signs in, walks a list of surfaces across the matrix, and emits two
things per cell: a screenshot, and a machine-checked finding list. It must fail
loudly when it cannot reach a surface rather than silently recording nothing —
the failure mode this project has hit repeatedly.

Mechanical checks, each one a defect class the tracker predicted:

- horizontal overflow of the scroll root and of every scroll container
- text clipped by its box (`scrollWidth > clientWidth` on a non-scrollable node)
- interactive controls below the 44px touch target on the two mobile viewports
- contrast of text against its computed background, both themes
- focus visibility: every tabbable control must have a visible focus indicator
- layout shift caused by loading placeholders, measured across the load
- elements overlapping the safe-area insets

**Steps**

- [ ] Step 1: surface list and sign-in, reusing the repaired auth helper.
- [ ] Step 2: the mechanical checks above, each emitting a structured finding.
- [ ] Step 3: screenshot capture, named by surface, viewport, theme and shell.
- [ ] Step 4: a self-test that seeds a page with each defect class and asserts
      the harness reports it. A harness that cannot detect a planted defect is
      worth nothing, and this is the mutation check for A1.

### Task A2: run the audit on the browser shell and triage

**Files:** modify `docs/INTERFACE_DEFECT_REGISTER.md`.

Run the full matrix, then triage. Each finding gets an entry continuing from
D-009. Severity is about the user, not the effort: P1 breaks a task or states
something untrue, P2 makes a task harder, P3 is inconsistency the user would
notice if it were pointed out.

Findings already open from 2026-09-01 are folded into this pass rather than
re-discovered: **D-004** (a "3/3" label with no unit or affordance), **D-005**
(a six-element meta row) and **D-008** (`singleLineText` in
`MeasuredTextWithMeta` forcing a wrapped message's time onto its own line).

- [ ] Step 1: run the matrix and collect raw findings.
- [ ] Step 2: deduplicate — the same defect at five viewports is one entry with
      five reproductions, not five entries.
- [ ] Step 3: write register entries with evidence and severity.
- [ ] Step 4: sort into fix batches by surface, so each batch is reviewable.

### Task A3: shell-specific audit

**Files:** modify `docs/INTERFACE_DEFECT_REGISTER.md`.

Only what the browser cannot show: window chrome and resizing on Windows,
keyboard insets and safe areas on Android, and any difference between the
bundled and live web code.

- [ ] Step 1: Windows shell — window chrome, resize behaviour, tray and updater
      surfaces.
- [ ] Step 2: Android shell — keyboard insets, safe areas, back gesture,
      rotation, on both connected phones.
- [ ] Step 3: register the shell-only findings.

### Task A4: fix in scoped batches

**Files:** per batch, decided by the register.

One batch per surface. Each batch: the fix, a regression test, a mutation check
that the test fails without the fix, and the register entry updated to
"fixed" with the evidence.

- [ ] Step 1: batch by surface and order by severity.
- [ ] Step 2: fix, test, mutation-check, commit — repeated per batch.
- [ ] Step 3: re-run the harness and confirm the finding is gone and nothing
      else moved.

## Half B — execute the approved motion plan

`docs/superpowers/plans/2026-08-30-shared-motion-feedback.md`, 5 tasks and 33
steps, none started. Execute it as written; do not build a second animation
system beside it. Its tokens are the vocabulary the Half A fixes should already
be using wherever they touch transitions, so Half A must not invent its own
timings.

- [ ] Task B1-B5: the motion plan's own tasks, closed in its own file.

## Deliverables

A defect register with evidence, scoped fix commits with mutation-checked tests,
the motion plan closed task by task, and a visual QA record across the viewport
and shell matrix in `docs/QA_RESULTS.md`.
