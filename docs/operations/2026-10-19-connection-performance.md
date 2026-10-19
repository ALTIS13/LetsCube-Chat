# Connection And Cache Performance

Owner: Codex coordinator. Branch `codex/search-continuity-20261019`, source
parent `563a2532`. Stage: six reviewed repairs RELEASED as product `1ef85b8f`,
web build `9e82c0d67b28ed43` and Android Stable 0.1.30/build31.
[Exact release evidence and limits](#release).
No SQL mutation was justified or applied. This closes the proved D-377--D-382
defects, not every possible daily slowdown or the whole synchronization stage.

## Separate Causes From Hypotheses

The report that loading becomes slower each day does not establish that hashing,
disk caches or the server cause it. Preserve accepted warm-chat/photo/recovery
evidence. Do not clear user data, raise cache limits or change indexes merely
because a collection grows. No personal content is recorded by these probes.

Read-only production sample at2026-10-19T04:12Z: disk43%, available memory4901MiB,
8CPU, vmstat83--89%idle, memory/IO pressure averages0. Database127,913,107B,
estimated4571 messages, no long transaction/lock queue in the sample. A transient
docker CPU sample is not sustained saturation: over18.953s the dominant Realtime
statement executes37 times/522.4ms; other observed statements are much smaller.
Statistics since August are not per-day latency evidence.

Three workstation requests each to public HTML/SW return200 in96--145ms/100--124ms;
the unauthenticated Auth edge refuses401 in81--126ms. Server-origin requests are
49--73ms. These measure public transport only, not authenticated history, an
affected tester's route, or historical performance. No production restart,
vacuum, cleanup or migration follows from these measurements.

## Navigation Blackhole Repair

Observed source: `public/sw.js` waits for navigation fetch indefinitely and uses
the saved complete build only after rejection. A route change can leave a read
pending without rejection while the browser still reports online.

The VM runs the actual worker with a controlled network and literal2500ms clock:
before the patch both held-navigation cases fail because no answer arrives. The
repair retains network-first behavior but bounds the initial fetch at2500ms,
aborts the abandoned read, and falls back to the existing complete cached build
or offline page. Fast responses clear the timer; no API/media caching, privacy,
update activation or build-identity policy changes. This bounds the wait for
response headers, not arbitrary streaming response-body completion.

Validation so far: worker/build/editor-precache/notification boundary104/104,
followed by the additional caller-cancellation RED/GREEN and final worker22/22;
real built controlled PWA with a local blackholed navigation and server-observed
read cancellation passes Chromium and WebKit2/2. All fixture servers/contexts
close; no Auth, backend mutations, device or rental involved. New behavior is
source-tested; deployment is verified below, not a sole explanation of the
owner's daily slowdown.

## Trusted History Verification

Initial exact-helper reproduction:1000 verified held messages plus one fresh
message requests all1001 hidden-message checks in11 calls/six sequential waves;
4500 plus one produces46 calls/23 waves. A fully trusted unchanged set produces0.
Full verification is correct after losing privacy trust; rechecking already
proven IDs just because a fresh ID is present is the bounded repair candidate.
The first repair passes86 affected executor checks, including19 new ones, but
independent review produces a new RED: a globally verified hidden ID can return
after hook remount because proof does not retain its hidden verdict. Baseline
passes that private control; the first candidate fails. Do not deploy that
candidate. Reuse proof only where the sanitized held result is actually present,
or obtain the missing verdict. The repaired candidate rechecks the current page
(at most100 message IDs in the no-reply case), plus untrusted held IDs, in one
request rather than11. A synchronous skip also requires the page verdict to be
available in the sanitized held rows or current hidden set. Remount with/without
a fresh ID, reply targets and refused recovery are negative controls.101 affected
checks and4 targeted warm omissions pass; the independent previously failing
remount control also passes on the final source. No new global
hidden-state cache, eviction or persistent-history redesign.
The executor runs the full compiled hook/cache source with fictional React/IO,
not mounted browser React or live1000-message traffic.

## Auth Response Body

Confirmed installed-SDK finding: the old deadline ends at Auth response
headers, before the SDK reads JSON. A held refresh body can therefore retain its
session lock and queued session/API calls. Three calibrated200/400/401 cases
fail before repair and pass after receiving Auth's finite body inside the
original30s fetch boundary. Actual SDK51 affected checks and peer source review
pass; complete invalid-token responses still retire the session, incomplete
transport stays retryable without artificial logout. Native-HTTP Chromium and
WebKit8/8 also release the queue and preserve the proper error classification.
No production credentials/session, screenshots or external requests involved.
Existing PostgREST streaming and Storage file transfers are retained; finite
read-signing JSON is covered separately below.

## Storage Signing JSON (D-382 / R6)

Confirmed installed Storage SDK2.105.1 finding: all `/storage/v1/` requests were
classified as unbounded transfers. `createSignedUrl(s)` actually POSTs finite
JSON to `/storage/v1/object/sign/{bucket}[/{path}]`. Held headers and body both
remain pending past30000ms before repair; the completed batch control passes.
The unresolved promise prevents the signing store from reaching its in-flight
cleanup. That consequence is source-grounded, not measured tester incidence.

Only that POST becomes a read with the existing30000ms deadline and3000ms
stranded-network cutoff. The original budget now owns the complete finite JSON,
as for Auth: a stalled error body is transport failure, not a false completed
Storage/RLS refusal. Complete403 status/code/message, per-path refusal, response
metadata/clones and caller abort cause remain intact. Signed GET, file upload
and `/object/upload/sign/` remain unbounded streaming transfers.

Actual installed-SDK RED -> GREEN;23 new checks including6 loaded omissions and
51 adjacent Auth/PostgREST/connection checks pass. Typecheck and scoped whitespace
checks pass. Final independent review finds no P1/P2 and pins match:
`requestDeadline.ts` SHA256 `9c7d57e8e577cf9e7ba2e446b021cdcb1817ab92ccf4ebe01641f707f2f55ce0`,
`deadlineFetch.ts` SHA256 `577ad9b83aa149c7d782906f1751c241e24f8c29edc787d7822159565bb682b5`.
[Focused SDK tests](../../tests/unit/storage-signing-deadline-20261019.test.mjs).
This is actual SDK with controlled Node fetch/stream/clock leaves, not live
Storage/RLS, browser route-change or media-transfer acceptance. Deployment is
verified below.

## Retry Ownership

Mounted Ban/Mute hooks reproduce orphan retry work after fail -> Realtime fail
-> unmount: the old hook issues a third query. One owned retry timer, one active
read and one trailing refresh now retire on cleanup; success clears old retries.
Last-known sanction, refusal, scope/owner checks and backoff remain. Four REDs
precede the repair;33 mounted/omission plus8 adjacent checks pass. Two independent
source reviews find no new P1/P2. No policy or database changes.

## Avatar Signing And Metadata Retry (D-381)

Avatar/signature feedback above512 signed objects has calibrated reproductions.
AST inspection of the actual public entry at04:32Z establishes effective
`VITE_MEDIA_SIGNED_URLS=signed`. Thus the defect's mode is applicable, but an
affected tester's threshold/history remains unknown. The active-lease plus512
idle-answer budget/passive-peek repair preserves mounted renewal, coherent raw
rows and account fences; the configuration is unchanged, not a raised idle cap.

Independent review then found bulk metadata failure issuing7 reads without
time/action versus baseline1. Individual feedback was already present on the
baseline. Six actual mounted error/rejection cases and a queued-after-detach
case were RED before the final repair. Failure now records a literal30000ms
cooldown before emitting, without inventing a NONE answer or losing a known
avatar. One store-owned timer retries mounted demand, coalesces existing work
and heals at the cooldown boundary. Release removes queued retries; generation/
timer identity fences reset and old completions. Idle failure timestamps are
bounded at512 plus mounted failed ids and own no retry work.

Final132/132 affected checks pass, including the original capacity controls and
21 additional metadata/cleanup checks; six new literal omissions are killed.
Final peer review is clean, no P1/P2. Frozen metadata source
`avatarVariantStore.ts` SHA256 `fc9e24f280fc48ec6daf1ba37525691bdc4043584afdc59487cdd1fe9b07c95d`;
[mounted tests](../../tests/unit/avatar-signature-capacity.test.mjs) and
[store tests](../../tests/unit/avatar-variant-store.test.mts). These are actual
mounted React/source checks with controlled SDK/transport/clock, not live
failure-rate/latency. The final frozen browser consumer matrix passes 32/32 in
Chromium/WebKit at 390/1440, both themes; one metadata read and zero forbidden
public requests remain literal assertions. WebKit ready/refusal pixels were
inspected. Earlier111 readiness is superseded by132. The fixture now waits for
the synthetic account/profile/signing generation before mounting its independent
avatar consumer; its former generation0 ->1 duplicate query was not an Auth bug.
A stale Vite HMR run remains a failed fixture run, not accepted evidence. Final
32/32 acceptance uses a fresh loopback-only Vite on frozen source; it is stopped.

## Release

Product source `1ef85b8fdf47b1e68b1c2acebeae205eac358e25` follows the seven reviewed
commits from `563a2532`; all own-tree aliases resolve. Final typecheck and diff
checks pass. No dependency, production configuration, SQL or RLS change.

The signed Android build reports `sw.js build b653e86183abf91c`, Vite11.74s,
Gradle31s. Original signer, four Firebase resources, release flags, secret scan,
42 web files, APK/AAB asset and native DEX parity pass. APK7,792,777 bytes,
SHA256 `880651f5c3c94da44d63314ac4d2d9986ec737b765fdbbb5aec2a6598922e7b9`;
AAB7,425,495 bytes, SHA256
`330050f8254f10f0ff7dbe0d0614a17d1a4af81fce1dc9d8c74f9e29cce12907`.
Actual Realme 0.1.29/30 ->0.1.30/31 in-place retains UID/data/firstInstall,
opens the guest UI and reports zero fatal crashes. The first guarded invocation
refused the locked screen before installation; normal nonsecure keyguard dismiss
then permits the single upgrade. No PIN, clear/uninstall or A063 access.

The existing publisher stages and activates Stable31 under its lock with exact
old-catalog/artifact CAS and byte-checked rollback. Separate HTTPS streaming at
05:16:40Z confirms the entire public APK length/SHA above, mandatory=false and
previous Stable30 retained. Guest startup is not signed-in long-session,
transient-network, FCM/provider or all-platform physical acceptance.

Web deployment finishes at05:18:57Z. At05:19:27Z sole-healthy image is
`l64kyyu1sysev2izzjjbizhe:1ef85b8fdf47b1e68b1c2acebeae205eac358e25`, build
`9e82c0d67b28ed43`, entry `/assets/index-BMWVkHuq.js`. Public/container SHA256
parity passes for HTML/JS/SW; JS SHA256
`150cde901fe8bf875b6d2625364d105e53891aa065b98916a172ddc993f4c812`, SW
`d33a4e2f106a1b89a8e8b9b5473d43c0982415a6357d5283d78c3fccfe1f9fde`.
The new navigation deadline marker is absent from old563 source, present in the
release source and the actual public worker. Windows remote renderer and shared
iPhone PWA receive the web change; Windows shell0.2.14 remains unchanged/unsigned,
and this is not a native Apple release or physical iPhone latency claim.

One natural production HTTPS canary uses the actual installed SDK and the
unmodified final deadline adapter: owned QA login HTTP200/299ms, same-SID refresh
HTTP200/200ms, SDK getSession success, exact own-profile read HTTP200/56ms. The
server confirms the new SID active; no pre-cleanup SIGNED_OUT/false logout occurs.
One local-only logout returns204 and exact read-only reconciliation confirms
the new SID absent, older sessions/target unchanged. No tokens persisted,
message queries, Storage requests, personal captures or Auth session held.

The immutable strict receipt is nevertheless `FAIL_CANARY_CLEANUP_PASS`:
a process-wide console.error counter saw one call whose arguments were discarded
for privacy, and the separate adapter waiting count was not captured. Thus
natural Auth/read completion and cleanup are established, but diagnostic-clean
overall PASS is NOT. No failure source is identified; do not attribute it to the
SDK/product, rewrite the receipt, rerun login merely for green, or silently drop
the oracle. Final reconciliation is retained at ignored
`performance-20261019/natural-auth-1ef85b8f-9d61/final-review.md`.

## Other Candidates And Evidence

- Outgoing media IndexedDB restore can reconstruct all pending user files. No
  stale-record accumulation or ownership-safe reason to delete them is proven.
- Build identity SHA-256 runs during builds, not over user history on startup.
- A new document clears the RAM history map. A long-session growth case is not
  proof of disk accumulation across true cold launches.
- Full authoritative privacy verification after losing trust still scales with
  held history (4501 IDs require46 current GET batches). A future bulk read must
  preserve RLS, current verdicts and read-deadline semantics, with migration
  backup/rehearsal if needed; increasing parallelism or dropping checks is not
  accepted as a substitute. This release does not claim that cost is removed.
- A future changed-input diagnostic should safely classify that one console
  signal and independently record adapter waiting state, without retaining raw
  SDK arguments or treating successful operations as an overall clean run.

Ignored aggregate receipts and bounded worker notes:
`.ops-private/performance-20261019/`. Public source/test changes are reviewed
separately from these diagnostic artifacts. No secrets or personal data belong
in this report.
