# Android Call Receipt: Source And Debug Verification

Owner: Codex, `D:\CodexProjects\LetsCube-Chat`, shared main from
`7e0a9bcc9f58b77ea24ea0b695964ac685eb8d5f`. Tracker 32-D1, Task 4.

## Scope And Checkpoint

Native receipt and session-bound client registration are implemented. This is
source/debug verification, **not a signed release or production activation**.
Task 5 still owns schema/Edge rollout, operational capacity/recovery/retention,
the separately authorized signed candidate, physical delivery and activation.
No production SQL, Edge deployment, provider send, release signing, version bump,
release catalog or personal-device installation occurs in this batch.

The approved payload/schema/dispatcher work in Tasks 1-3 is unchanged. Their
real PostgreSQL/PostgREST/Edge rehearsals remain valid for the unchanged inputs.
The Task 4 title in the original plan included the signed candidate; source work
is deliberately separated from Task 5's explicit release gate.

## Implementation

- `VoiceCallMessagingService` owns data-only voice events; reserved malformed
  events are dropped. Ordinary messages and token refresh use the installed
  Capacitor service implementation unchanged. The merged manifest removes the
  old Capacitor service, resolves the app service at priority 0 and retains the
  SDK's default service at priority -500. Both are non-exported.
- Strict Java and TypeScript validators implement the existing 12-string-field
  protocol. Canonical UUIDs, route, ring generation, recipient user/session and
  an absolute lifetime of at most 45 seconds are checked. There are no payload
  names, media URLs or network lookups in native receipt.
- `VoiceCallState` persists binding, seen generations, cancellation tombstones
  and one-shot opaque tap handles. Full generation keys isolate an older cancel
  from a newer ring. Epoch/candidate compare-and-set rejects late registrations.
  Monotonic elapsed time prevents a wall-clock rollback extending the lifetime.
- `VoiceCallRuntime` uses an atomic private file in `noBackupFilesDir`, bounded
  state, scoped notification cleanup and a high-importance `calls` channel.
  OS notification timeout owns expiry after process death; in-process cleanup
  also runs. Private tombstones expire logically and are lazily pruned after
  process death. API 24-25 do not advertise protocol 1. No full-screen, exact
  alarm or foreground-service permission was introduced.
- Cold/warm intents resolve only an admitted opaque handle and do not fall
  through generic Capacitor routing. Same-session re-verification preserves a
  pending action. Logout, account/session replacement, cancellation, expiry or
  disabled calls invalidate it. Tapping never accepts a call or opens a microphone.
  An exact consumed-action marker permits native revalidation after same-session
  refresh, without treating a cached JavaScript DTO as authority after cancel.
- One Android registration controller is mounted above public/auth/messenger
  routes. Settings use this same owner. It refreshes on authenticated resume
  without requesting permission automatically, uses the eight-argument RPC and
  commits only the verified returned user/session pair. Only the specifically
  missing overload permits legacy seven-argument registration, with voice off.
  Older APKs without the plugin retain ordinary native push behavior.
- The actual rendered incoming ring owns only its exact foreground generation.
  Public routes without that ring do not suppress OS cards. Local/current-session
  call preferences are synchronized with native state and fenced against late
  reads. Registration handles clean up even when listener installation or RPCs
  finish after timeout. Raw tokens remain memory-only; provider errors are not logged.
- Integration exposed an existing `safeOpenChat` race: an access/hydration result
  could mutate the store after changing accounts. Current-user checks and an
  optional generation guard now fence each asynchronous boundary. Normal cached,
  hydrated and denied access behavior remains covered.

No browser/PWA service worker, Windows package, iOS surface, database schema or
dependency lockfile changed. Firebase messaging 25.0.1 is now pinned in the shared
Android variables and explicitly visible to the app compiler: it is the same
version already used by Capacitor, not an SDK upgrade. Java/JDK/PATH are unchanged.

## Verification

All commands use PowerShell and `pnpm.cmd`. Focused tests fail before fixes;
mutations execute changed code rather than checking identifier presence.

| Check | Result |
|---|---|
| `pnpm.cmd --filter @workspace/kub run typecheck` | exit 0 |
| Web build with process-local `PORT=5173`, `BASE_PATH=/` | exit 0; `sw.js eb115acc102a060e`, built in 10.13s |
| Full `node --test "tests/unit/**/*.test.{mjs,mts,js,ts}"`, pinned `KUB_JQ_BIN` | exit 0; 4021 pass, 0 fail, 0 skipped |
| Pinned-jq `tests/unit/release-catalog-deploy.test.mjs` | 16/16, also covered without skips by final full suite |
| `tests/unit/native-voice-*.test.mjs` | 86/86, including 16 behavioral mutations; expanded focused regression 116/116 |
| `tests/unit/safe-open-chat-session.test.mjs` | 9/9 after six meaningful RED cases; 5 guard-removal mutations killed |
| `node --test tests/android/voice-wire.test.mts` | exit 0; actual Edge builder to compiled Java parser, 27 cases including valid round trips |
| Standalone Java state/mutation suites | 39/39; 16/16 mutants killed |
| Gradle `:app:testDebugUnitTest` | exit 0; 38 voice state tests and 1 existing test |
| `pnpm.cmd android:sync` and `pnpm.cmd android:build:debug` | exit 0; current web index/entry embedded byte-for-byte |
| Gradle `:app:assembleDebugAndroidTest` | exit 0 |
| `VoiceCallRuntimeTest` on isolated API 34 emulator | 10/10 actual Android runtime tests, not mocked NotificationManager |
| `tests/android/voice-process-expiry.ps1` with opt-in instrumentation | Both phases pass: process absent while card remains, then card gone before runtime reconstruction |
| `voice-ring.spec.ts`, Chromium 1440 and 390 | 76/76, no skips; incoming screenshots inspected in both themes |
| `session-devices.spec.ts`, same viewports | 25 pass, 2 intentional mobile inapplicability skips, 1 reproduced baseline layout failure (below) |
| `git diff --check` | exit 0 |

Initial failures were resolved, not hidden: Firebase compile classes needed the
explicit existing dependency; the JVM-only mutation runner moved out of the
Android bootclasspath; one old assertion required raw provider-error logging and
now rejects it; the stale-build check correctly required a fresh web build.
Existing Vite sourcemap/mixed-import/large-chunk, Gradle deprecation and Node
type-stripping/module-format warnings remain. The pinned jq executable's hash was
verified without changing PATH.

## Actual Android Evidence And Limits

A fresh emulator userdata/cache under ignored `output/voice-delivery-task4/`
ran Android 14 / API 34 with network disabled. Only synthetic identities/events
were used. Debug and test APK installation succeeded there, not on either personal
phone. Instrumentation asserts the emulator fingerprint before clearing its
synthetic app state.

The ten cases verify service receipt without WebView/network, channel/category/
timeout/no-full-screen, duplicate suppression across runtime reconstruction,
cancel-before-ring persistence, old-cancel isolation, actual OS-card expiry,
unverified/wrong-session refusal, exact foreground suppression, preference/logout
cleanup without touching ordinary cards, and pending tap re-verification/rebinding.
They also verify consumed-action revalidation from the real private file and a
subsequent cancellation overriding it.
Device PackageManager independently confirmed service resolution order.

An additional opt-in two-process probe publishes an eight-second synthetic card,
ends only the fixture app process using `am kill` (not force-stop), proves the
process is absent and the OS still holds the card, waits nine seconds without a
process, then starts a fresh instrumentation process to read NotificationManager
**before constructing the runtime**. Both phases passed. This proves API 34 OS
timeout independent of the app timer, not FCM wake/delivery or OEM timing.

The debug APK has all six Firebase initialization resource names. The local
configuration is present, ignored and untracked; neither values nor FCM tokens
were printed. Version and signing material are unchanged.

**Not proved here:** FCM transport, physical heads-up visibility, OEM/Doze timing,
delivery after process death, actual MainActivity cold/warm tap through a live
authenticated WebView into the chat, two-device synchronization, API 24-25 runtime,
or official-GMS versus microG compatibility. Runtime reconstruction is not a
process-killed delivery test. A crash between durable seen-generation persistence
and OS publication can lose that alert; replay deliberately does not re-alert it.

Nothing remains unavailable by the owner's instruction. The authorized Realme's
prior read-only inventory is Android 15/microG, old Firebase-free 0.1.3/build 4,
notifications denied. It was not modified and does not establish delivery proof.

## Separate Existing Layout Finding

The session-device suite exposed D-222's existing stress-width case: at a forced
260px desktop settings measure the unknown-device title is truncated. The
unchanged test fails identically on an isolated archive of baseline `7e0a9bcc`.
Nested padding leaves 172px for text needing 173.80px in self-hosted Inter. A
DOM-only normal-white-space counterfactual wraps the title and keeps switches
inside. A separate two-theme diagnostic passed on desktop 1440 and mobile 390;
normal 560px desktop settings and the normal mobile sheet do not clip the title.
No source CSS or test expectation was weakened. D-222 remains open for its own
layout work; this batch does not claim an entirely green session-device suite.
Two mobile skips are desktop-only search/resize checks, not skipped call behavior.

## Review And Next Action

Independent combined review initially reproduced three P2 races: consumed taps
lost during same-session refresh, a ring gate stuck waiting after registration
generation changed, and a rotated token discarded during registration. All are
fixed and independently re-reviewed: **APPROVED for source/debug scope**, no
remaining actionable findings. The reviewer ran 44/44 focused cases including ten
mutations and checked seven frozen source hashes. Retained taps require native
revalidation; a newer tap replaces the old receipt and is drained once. Calls-gate
ownership uses stable user/session identity rather than each registration attempt.
Token rotation drains within the original operation, including persistence of
the first explicit enable while the backend preference is still false.

Final build, full unit suite and 76-case browser suite ran after these corrections.
The rebuilt debug APK embeds `index-Cy0RkDXO.js` and its matching index byte-for-byte.
Source/debug completion does not promote the feature to production readiness.

Next: Task 5 operational prerequisites and a
separately authorized signed candidate. Apply each owner-specific migration only
after a verified backup and raising transaction checks; deploy Edge separately,
keep both dispatch gates off, and activate narrowly only after physical checks.

## Web Deployment Evidence

Implementation commit `9d059c4afda1594254c074d498a792651a92b63c` was pushed to
`main`. Coolify completed its ordinary web auto-deploy; the running container's
image matched that full commit, was healthy, and the previous `7e0a9bcc` replica
was absent. Before deployment, public `index-Chr49y24.js` contained the LETSCUBE
positive control but not `revalidateConsumedAction`. Afterwards,
`index-CYPDJM8O.js` contained both. Its stylesheet and `/`, `/privacy`, `/support`,
`/login`, `/register` returned 200. No authenticated production content was read.

During the overlap of old/new replicas, two document-to-entry probes returned
404 for the referenced JavaScript. This repeats the already recorded asset
continuity risk; it resolved after replica retirement, not because of a code
repair in this batch. It remains open, alongside the unrelated D-222 stress
layout case. These HTTP/content checks are deployment evidence, not physical
Android delivery or a signed native release. No Edge or database rollout occurred.

Primary references: [Capacitor data-only delivery](https://capacitorjs.com/docs/apis/push-notifications),
[Firebase Android receipt](https://firebase.google.com/docs/cloud-messaging/android/receive-messages),
[Android 8 notification timeout](https://developer.android.com/about/versions/oreo/android-8.0),
[Supabase auth callbacks](https://supabase.com/docs/reference/javascript/auth-onauthstatechange).
