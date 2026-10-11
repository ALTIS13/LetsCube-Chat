# Sidebar Search Focus Lifecycle

## Cause And Scope

Coordinator,2026-10-11; tracker item93 remains OPEN / PARTIAL. The phone search
magnifier scheduled a focus callback without cancellation or current-state
validation. If the list re-tucked search before that callback ran, focusing the
clipped input set the focused state and reopened the row. This concrete race is
reproduced in the actual full application in Chromium and WebKit. It does not
establish the cause of every tester report of animation lag.

The patch cancels pending focus at the committed close/navigation boundary and
on unmount. A callback must still own its exact handle and a revealed, connected,
laid-out input before focusing with preventScroll. Independent review identified
the successor-handle case: cancelled A must not focus or erase a newly queued B.
Two literal assertions failed before the additional identity guard.

Search semantics, query/results, scroll thresholds, layout, material and motion
tokens are unchanged. The existing accepted reduced-motion patch14a2b8bf is
retained, not reimplemented. No native-preview feature branch is promoted.

## Verification

- Original compiled-component regression:3 PASS /1 FAIL; the closed search
  received focus and reopened. This RED is distinct from the later review RED.
- Review RED on the intermediate patch:15 PASS /2 FAIL /1 SKIP. Stale A focused
  B's opening and removed B's cancellation handle. The skip was the not-yet-
  implemented identity mutant, not product acceptance.
- Final focused unit:18/18, no skips. Four actual-source mutants calibrate focus,
  cancellation, committed-open authority and exact-handle identity independently.
  It compiles the actual component, with controlled hook/host/RAF ports; this is
  not browser, keyboard or frame-rate proof. The test has no dependency on
  another owner's untracked e2e files.
- Actual fictional full-app browser baseline:8 cases, both engines,390/1440,
  both themes. Phone races reproduced; wide-screen, typing,24 rendered search
  results and two-stage Escape controls passed.
- Actual candidate:8/8 for the same engine/width/theme matrix. Re-tucked search
  stays closed and unfocused; normal opening, typing, results and Escape pass.
  Page/console errors, external request attempts and overflow are all zero.
- All20 exact-element candidate crops inspected, including initial, re-tucked
  and query states. No incoherent overlap or displaced search controls observed.
- Actual kub typecheck passed after the final identity guard. Full finite Vite
  candidate build ran with the real source graph; loaded-source hashes were
  checked before and after browser cases, and protected dirty inputs unchanged.
- Portable18/18 unit and typecheck also pass in the main-based publication
  worktree, without the untracked fixture files. Its actual production-mode build
  reports `sw.js build 92a316feba8f1e35`, `built in14.31s`; configuration is
  fictional, so this local digest is not the expected live production digest.
  Existing sourcemap/chunk warnings are nonfatal and are not a new acceptance
  claim about bundle size or performance.

The fixture uses fictional people/chats, mocked Auth/backend routes and public
loopback configuration. Service workers and WebSockets are blocked. No listener,
production session, mutation, personal capture or device installation is used.
Private retained evidence:search-focus-20261011/candidate.

## Retained Harness Refusals

R1 failed source-graph calibration: Windows path normalization missed the actual
component load. Its image/result is not an accepted RED or baseline. R2 corrected
the graph and accepted four Chromium cases, then WebKit refused navigation in an
offline context before any WebKit case. R3 removed that harness-only offline flag,
retained strict request interception, reused the exact baseline bundle and ran
only the four missing WebKit cases. No accepted Chromium case was replayed.
The candidate was built once against the final changed component.

## Publication And Limits

Publish only the main-based focus patch, portable unit and this report, together
with previously accepted Enter release documentation. The live pre-publication
web container is healthy at6d8f2a55988bce9bb46b2606222485b04c740249.
Verify the new full image SHA, old/new bundle markers, public/container byte
parity and retained previous assets after publication; a webhook is not proof.

Browser WebKit is not an installed iPhone PWA. This slice does not claim physical
Android/Windows/iPhone acceptance, overall native animation performance, native
preview activation or a new APK release. Keep item93 open for those boundaries.

## Actual Runtime Readback

At14:31 Moscow, the only running web replica is healthy at the exact reviewed
revision `2ad69fc24bdb33822891a46d1b00048d1f477e30`. The old queued-focus marker
is absent and the guarded exact-handle/connected-input marker is present once.
Public entry `/assets/index-CUHdWYWg.js` SHA256
`4267ff91114df01ab9e89878ec9aa436f006ace0053413c8e8e1df90244e9c4e`
and service-worker SHA256
`3c574310aca6692241f3a3a528f28edd9605952380bbb1f99f46f34636b0d3c8`
match the container's files. The previous entry is still available byte-identical,
and the previous image is retained. Git main and the narrow source branch read
back the same full revision. No docs-only main push is used to record acceptance.
No SQL, provider configuration, native activation or Android release changed.
