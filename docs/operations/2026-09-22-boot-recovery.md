# Boot Recovery, 2026-09-22

Owner: Codex coordinator, main checkout `D:\CodexProjects\LetsCube-Chat`.
Baseline: `0813bd05`. Scope: D-298, the owner's approved UI-stability continuation.
Preserve the existing liquid-glass material and all authenticated state. No SQL,
push dispatch changes, native signing/publication, installation or identity changes.

## Checkpoint

- [x] Reproduce missing recovery with an aborted entry: four Chromium failures,
  each after a successful login-surface control, without signing in.
- [x] Implement dependency-free initial/failure surface and explicit same-URL retry.
  No session, drafts, cache or service-worker deletion, and no automatic reload.
- [x] Signal readiness only after React commits a surface, including its own
  ErrorBoundary recovery. A module/document load does not imply this signal.
- [x] Development Chromium/WebKit matrix: 14/14, themes and 1440/390 widths,
  stalled/late entry, runtime exception and missing stylesheet at 360x320.
- [x] Built-artifact Chromium/WebKit matrix: 14/14. Independent controller review:
  33/33, including 15 in-memory mutations; real scripts also passed a four-case
  native-before-HTML event-order probe after a receipt-order correction.
- [x] Windows current-document guard and overlay recovery: JS 50/50, offline Rust
  82 pass/four existing ignored tests; three guard mutations detected. Coordinator
  reran both suites after the agent completed. No installed native-client run.
- [x] Full validation: typecheck, 4068 passing unit tests/one existing skip,
  production-mode build, focused lint, settings/chat/Escape 42/42.
- [x] Final independent native review: no actionable findings within the bounded
  contract. Reviewer reran 17 browser cases, nine actual Rust-model cases and four
  real-script late-commit/retry scenarios; final six file fingerprints matched.
- [ ] Web publication and actual image/content proof (post-push gate).

Two agents have non-overlapping scopes: Windows native source/tests; independent
inline-controller unit tests/review. Coordinator owns HTML, React acknowledgement,
browser regressions, integration and documentation. Next action: web publication
with exact-image and content proof. No external
blocker for this source batch; actual native lifecycle remains a separate step.

Current gates: typecheck exit 0; settings/chat-glass/Escape regression 42/42;
full unit 4068 pass, no failures, one existing jq-1.7.1 skip. Production-mode
build (dummy localhost connection values, no preview flag): `3fb8dcc84de14632`,
10.04s. Existing chunk-size/source-map/mixed-import warnings remain. The local
build is not a distributable native artifact.

The first full run found raw safe-area reads in the fallback (replaced with the
canonical four tokens), and a capture-flag marker in the test build (the fixture
flag must be **absent**, not `0`, from production env). Both guards pass against
the rebuilt artifact; no test assertion relaxed. One intermediate asset check ran
before the rebuild completed and correctly rejected the incomplete build; the
completed-build rerun passed 20/20. Final full-suite and built matrix are green.

## Contract

The pre-module HTML controller owns `data-kub-boot-state` on `html`:
`loading`, `failed`, `ready`. Script failure offers retry immediately; an entry
that never finishes offers it after 12 seconds. A late successful commit removes
the recovery surface and all its global listeners/timer.

After the first React commit, `#root[data-kub-app-ready="true"]` plus the window
event `letscube:app-rendered` acknowledge a rendered surface, not authentication,
database availability or a TLS/certificate result. A caught React error remains
a usable recovery surface. `letscube:boot-failed` carries no error payload.

The fallback is intentionally independent of the CSS/JS being rescued, following
the existing ErrorBoundary's dependency/compositing exception. Its unframed screen
uses the existing logo and theme tones; no new glass, gradient or blur treatment.
Normal application material is unchanged. Its CSS is removed after readiness.
The fallback reads the shared safe-area tokens and uses conservative 64px
padding when those tokens' stylesheet is unavailable. Retry does not automatically
reload on error, following the explicit-action recovery approach recorded for
Discord web in `reference-clients.md`; this is not a claim about mobile Discord.

Windows reads an ephemeral per-document receipt without new IPC or permissions.
Its native observation is bounded at 30 seconds; on expiry it records
`workspace_unconfirmed` and stops polling, not a fabricated connected/app-failed
state. A 35-second or later web commit remains usable without navigation or data
deletion. A new document must earn a new receipt. The overlay retains the existing
appearance/success pacing, but yields immediately to web failure/retry.
[Native source contract and repeat commands](../../windows-tauri/tests/D-298-readiness.md).

## Publication Proof

Before publication, the live guest HTML/entry returned HTTP200 with all three new
markers absent (controller, recovery surface, committed-root acknowledgement).
After pushing the reviewed source: require one healthy web container with the
exact commit image, retirement of the previous replica, the three markers present,
and a public guest healthy -> blocked entry -> retry -> ready check at 1440/390
in both themes. No login, captured production pixels, or private writes.
Sanitized working evidence is under `output/pre-react-recovery/`; do not infer a
successful deployment from this plan or from the webhook alone.

## Evidence Boundaries

Browser plugin is unavailable in this session; installed Playwright drives isolated
Chromium/WebKit. Tests permit localhost assets only, intercept external traffic,
use no accounts and set `KUB_QA_ALLOW_MUTATIONS=0`. Captures contain only the guest
recovery surface and live under the Windows temporary directory.

Android embeds its bundle; a web publication cannot update an installed APK.
Windows native-source changes likewise require a separately authorized native
release. Do not claim physical lifecycle/device proof from browser or source tests.
