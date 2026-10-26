# History Write Clock And Physical Cold QA

Owner: Codex coordinator. Stage: actual candidate42 cold failure and completed
same42 producer-only diagnostic; exact native cause remains unresolved.
Stable remains0.1.39/build40; candidates41/42 are NOT published. Realme42 is
normal guest after cleanup; A06337 is untouched. Full physical cold/save is OPEN.
No SQL migration or shared-web release follows from these candidate results.

## Actual Native40 Result

The single new owned Realme cohort follows ordinary empty-guest admission BEFORE
SDK/RLS seed and one ordinary LoginForm Auth40 lifetime. Exact source97e07de8/
APK40, unchanged signer/Firebase/parity and retained installation are bound.
New API sessions retire before native login; tokens are neither injected nor
persisted in QA records. No production capture or personal conversation is used.

WarmPID29524 receives the synthetic3,608,655B PNG with its natural preview. The
preview decodes; original is absent before tap, then actual original IDB and
viewer Blob hashes/dimensions match. Pre-open observations, however, show no
default-history pointer. Cold newPID2206 with phone WiFi/data off reaches
tap-media: the received timeline row and its controls are absent, while exact
preview AND original binary-cache keys are present. No completed transfer occurs.
The cold viewer/gallery workflow is UNAVAILABLE, not accepted or retroactively
explained by the old PID31720 receipt. Scope discovery cannot recover a page that
was never durably committed.

All actual network/helper/normal-return cleanup passes. Native Auth40 ordinary
exit retires its one new SID/binding and retains every old SID. SDK cleanup then
removes only the owned fixture group, message, original/preview/variants and purge
footprint; final relational/media absence and new API SID retirement pass.

Normal non-instrumented UI still showed the retired QA list after the first
exit. One bounded ordinary menu/exit repeat restores the empty guest and it stays
stable7sec at11:19:11Z. This preserves the separate logout discrepancy; no guessed
SDK upgrade, broad revoke or storage/app-data deletion is applied. The phone's
original network is restored; A063 is untouched in this cohort.

Private exact receipt/guards: .ops-private/gallery-auth-native40-20261026/,
coordinator-result40.json, normal-guest40-restored.json and LIVE-RUN.md. API
ledger/recovery is in gallery-fixture40-20261026. Do not replay the consumed seed.

## Reproduced Storage Race

An independent actual-IDB test reproduces a legitimate multi-document race in
both Chromium and WebKit. History service computes a timestamp before storage
finishes digest verification/acquires its readwrite transaction. A later profile
write may commit first; storage sees a timestamp greater than the history call's
old timestamp and falsely treats ordinary concurrency as clock rollback.
The earlier history/page-pointer write returns false and cold history is empty.
Two race cases go RED while genuine numeric clock-rollback controls pass.

This proves a source defect consistent with missing native40 history; it does
not establish that it was the sole cause of that phone outcome. No second API
cohort is created just to repeat the symptom.

## Repair Contract

HistoryCacheStorage.write accepts either a fixed timestamp (unchanged numeric
semantics) or a clock function. Offline history passes its existing clock as a
function. Storage snapshots lease/scope/payload/digest before its first await,
then calls the clock once synchronously in owner.get.onsuccess, AFTER generation
admission and acquisition of the exclusive transaction. It uses that one safe
integer consistently for timestamp, TTL, rollback and eviction. No await occurs
inside the transaction callback. The final row byte bound is checked before any
delete/put, including timestamp-size growth.

Account/backend/session/generation, digest, transaction-complete ACK,10-record/
8MiB/seven-day bounds and actual clock rollback remain unchanged. Owner-wide JS
serialization would not cover another document; tolerance or max(timestamp)
would hide real rollback. No server or permission authority comes from the clock.

## Verification And Next Action

- Source causal cases: RED2 race/2 passing rollback controls, then GREEN4/4 on
  both engines with real two-document IndexedDB and held digest.
- Affected storage/load/offline/cold-consumer cohort122/122 passes; client
  typecheck passes. Independent boundary review found an invalid-clock runtime
  input being accepted as timestamp0; an explicit type refusal repairs it.
  Focused final clock/boundary cases16/16 pass on Chromium/WebKit, including
  actual transaction-lock wait, stale generation, mutable caller inputs, real
  rollback and timestamp-size overflow before eviction; two mutants are killed.
- No new native candidate, device update, production web change or SQL change
  is implied by these source results. Read-clock races and the separate logout
  discrepancy are not silently marked resolved.

Next at that source checkpoint: build candidate0.1.40/build41, retain
package/signer/data, and exercise the missing physical cold/save criterion.
Only observed, cleaned runtime evidence can close that criterion. Reuse valid
baseline coverage and preserve all original refused receipts.

## Candidate41 Physical Follow-Up

Candidate0.1.40/build41 atf010036b is built with the original signer, Firebase4,
QAfalse and APK/AAB/source parity. Realme40->41 retains UID/data/firstInstall;
guest/fatal0 passes. Full retained APK is7,834,625B/SHA256
dd3238ecb2acbed40b7ef9abee06e28850ac70aa0e35585c92417e4a402d6051.
This candidate is NOT published; Stable40 and the shared web remain unchanged.

The single new owned cohort07a8847b finishes UNAVAILABLE at11:52Z. An exact
fixture-chat-prefix read, calibrated with the actual service/IndexedDB, now
separates owner/page/message from the default pointer. WarmPID19528 renders the
row and opens/hash-checks the original, but page/message/pointer are absent.
ColdPID24073 again has no row/page/message/pointer, while owner and both binary
cache representations exist. This confirms the missing history persistence
boundary; the clock repair alone does not close it. Do not claim this physical
journey passes, publish41, or replay another unchanged cohort.

Network/helper/normal-return cleanup, Auth41 new-SID/binding retirement with old
sessions retained and exact API rows/media/purge cleanup all pass. A separate
post-logout guest witness refuses (so full PASS refuses too). One known normal
menu/exit repeat restores a stable guest at11:53:29Z. No storage/app-data clear,
personal-content capture, SQL mutation or A063 change is performed.

Next at that checkpoint: diagnose the actual hook-to-disk admission/projection boundary
before another native candidate. The reviewed clock fix remains committed,
not rolled back or mislabeled as the sole cause. Runtime records are private
under gallery-auth-native41-20261026/LIVE-RUN.md; all owned processes/fixtures are
settled. A read-only two-QA-profile shape check returns only types/lengths/booleans.

## Post-Finally Privacy Publication Gap

A real-hook/real-service/IndexedDB test reproduces a second source mechanism.
The successful REST head has already run its finally and renders the received
row. Its optional disk publication is still hashing when the first hides-channel
join changes the privacy generation. The unchanged ticket correctly refuses the
write, but nobody observes false. The300ms follow-up cannot use a pre-join hidden
verdict as live proof, so no saved page/default pointer follows. RED observes one
visible row, write=false, one hidden read and no durable default snapshot.

The central persistReceivedHistory helper retains the caller-captured owner and
scope/privacy predicates for all three publishers: head, older page and delayed
live snapshot. Only a false write with a still-current scope/account, an expired
privacy ticket and an online device schedules the existing bounded recovery.
That recovery performs a fresh REST/hidden-ID read before publishing. Storage
failure alone, offline, unmount or account retirement cannot request recovery;
no hidden verdict, generation fence or clear retirement is bypassed.

Final focused cases10/10 pass, including three killed mutations. The causal
case now has a saved snapshot and two actual hidden reads. Typecheck passes.
The affected191-case run found three AST harness failures because it extracted
fetchMessages without its new actual helper; loading that actual callback, not
a stub, repairs the harness and its focused9/9 passes. Other182 cases pass in
that run. No visual layout or SQL change is involved.

Read-only actual two-QA-profile types/timestamps/UUIDs and client-column defaults
show no proven projection mismatch. Synthetic malformed-profile refusal is not
claimed as the native cause. Neither source race alone proves the exact native41
timing. Candidate0.1.41/build42 was the next physical check; its actual outcome
and the subsequent same42 witness are recorded below. Candidate41 was never
published; the catalog remains Stable40.

## Candidate42 Physical Follow-Up

Candidate0.1.41/build42 at6a677c28 includes both reviewed source repairs. The
actual owned cohort68046c4d still finishes UNAVAILABLE: the cold history
page/pointer and timeline row are absent while original/preview binary bytes
remain. This is not full cold viewer/gallery acceptance, and neither the clock
repair nor the post-finally privacy repair is certified as the cause of the
specific native failure. No candidate42 publication or further guessed product
patch follows from this result.

All owned Auth/API/helper/network cleanup passes; old sessions are retained,
new owned sessions retired and the exact fixture footprint removed. Normal
non-instrumented guest restoration passes12:36:01Z. Private records remain in
`.ops-private/gallery-auth-native42-20261026/coordinator-result42.json` and
`normal-guest42-restored.json`; the consumed API ledger is in
`gallery-fixture42-20261026`. Do not replay that cohort or its stable ticket.

## Same42 Producer Diagnostic

One different, finite same42 producer-boundary witness completes12:57:06Z at
unchanged6a677c28/build42. Its status is
`OBSERVED_PRODUCER_ONLY_NOT_MEDIA_ACCEPTANCE`, not a cold/media PASS. Ordinary
empty-guest admission precedes the fresh owned SDK/RLS fixture and one ordinary
installed LoginForm Auth42 lifetime. The passive JS watch runs before opening
the owned chat; no new product build, cold restart, original opening/download,
gallery save, provider test, fault injection or personal capture occurs.

The witness is calibrated against real SHA/get/put and an actual completed
IndexedDB transaction, with unchanged calibration digest and a cleaned temporary
DB. Wrappers remain intact; overflow and observer errors are zero. In its bounded
observed window:

- `fixturePayloadHashesUnattributed` and `pointerPayloadHashesUnattributed` are0.
  These are counters, not captured payloads or digest values.
- Owner gets20/hits20 and owner put attempts4 show owner-store activity; put
  attempts are not claimed as completed transactions.
- Page gets1/hits0 and pointer gets1/hits0; page/pointer put attempts are0.
  Page/pointer transaction-complete and abort counters are also0.
- The own image row and React fiber are present. Observed row/sender IDs have
  UUID shape, required created/updated timestamps are valid, and pending/failed/
  checking are false. `reply=array`/`replyId=missing` is recorded as shape only,
  not a proven projection incompatibility.

This narrows the observed boundary to no watched history payload publication or
page/pointer put attempt despite a rendered own row. It does not establish which
source admission gate ran or refused, or prove that either repaired source race
caused the earlier native outcome. The coordinator investigates that source gate
in parallel; no additional product fix or new cold/original replay is inferred.

The watch is restored and its calibration DB clean. Helper removal, normal app
return and unchanged network pass; native is quiescent and no fixture cleanup
remains. Auth cleanup retains old SIDs, removes the new own SID and retires its
bindings. Exact owned API cleanup is complete. The original coordinator result
retains `normalGuest: UNAVAILABLE`; a later separate normal, non-instrumented UI
logout witness passes with stable guest at13:11:23Z. No app-data clear, broad
session revoke or authentication injection is used.

Safe metadata receipts and the current private run record are in
`.ops-private/history-native42-producer-20261026/coordinator-result.json`,
`normal-guest-producer42-restored.json` and `LIVE-RUN.md`. They contain no message
bodies, personal identifiers or token values. The APIproducer ticket is consumed;
reuse its settled cleanup evidence, not another seed. Stable0.1.39/build40 and
shared web remain unchanged; candidates41/42 are NOT published. Realme42 is now
normal guest, A06337 is untouched, and full physical cold/save remains OPEN.

## Unrelated Retirement And Semantic Clear Marks

The next two finite same42 native gate probes are UNAVAILABLE, not product
acceptance. R1 builds its helper but fails before installation because the
coordinator retains the old producer filename. A real coordinator-to-device
constructor contract test now covers that boundary. R1's exact API cleanup
passes; normal UI/Auth cleanup recovery and stable guest pass14:24:11Z. R2 installs
and removes its owned helper, but obtains no debug socket or gate verdict. Its
Auth lifetime, exact API footprint, normal return and unchanged network settle;
stable non-instrumented guest passes14:33:19Z. No forward was created, no content
was captured and no native publication follows. Consumed tickets are not replayed.
Private receipts remain under history-native42-gates[-r2]-20261026. These probes
do not certify the cause of the earlier native missing-page outcome.

Separately, an actual-hook/service/IndexedDB test reproduces unrelated-chat
retirement before a queued publication. Chat A stays visible and its account/
scope/privacy callback remains true, but retiring B invalidates every service
handle; A's write correctly returns false before hashing and no page follows.
The message hook now consumes that generation event and requests one existing
bounded recovery. It evicts the clear-boundary answer and re-reads actual server
and hidden-message authority before publication; it never retries retired rows
against a newly captured handle. Twenty events coalesce into one head read.
Offline, unmount and account-retirement controls remain inert.

Review caught two retry hazards before rollout. A terminal403 must purge RAM/
disk without scheduling itself again, including through another document's real
BroadcastChannel. Both the local loop and the two-document ping-pong go RED.
A scope-local access-refusal latch is set before purge, cancels pending recovery,
and suppresses cache-event retries until a new scope or fully validated successful
head. Ordinary reconnect/retry still revalidates and releases the latch on success.
Final recovery13 cases pass (11 plus the two added restored-access cases), with
five compiled mutations killed. This is browser/source proof, not native proof.

The membership callback also retired cache for the same timestamp represented
with Z versus +00:00, while the delta reducer treated distinct microseconds as
equal. A shared sameTimestampInstant uses the existing timestampMicros parser:
null/undefined agree, equivalent offsets agree, a one-microsecond change does not,
and distinct malformed strings do not collapse. Saved-list, fresh-list and live
clear/hide comparisons use that rule; a foreign-user UPDATE is ignored. Timestamp8
focused cases include three killed mutations; the agent's affected52 pass.

Coordinator affected checks:147 initially146 pass/one stale static assertion.
The assertion already fails on unchanged6a because its departures dependency list
omits authSessionSource. Its corrected exact binding/cache-authority assertion
and timestamp cases pass18/18. Separate hidden-batch/tuple/browser cohort106/106
passes; final typecheck passes. Independent final review finds no blocker. No
layout, SQL, RLS, global logout, PC network, A063 or rental change is involved.
Web rollout is prepared next; Android40 remains Stable and41/42 are unpublished.
Final actual web build emits62bfb74614f37c48 and built in12.62s; public-role scan
finds no service_role token. Before/local source markers pass0/0/0/0 to1/1/1/1
for clock/privacy/recovery/microsecond equality. These markers are deployment
custody controls, not substitutes for the behavioral cases above.
