# History Write Clock And Physical Cold QA

Owner: Codex coordinator. Stage: clock repair reviewed; candidate41 preparation.
Stable remains0.1.39/build40. No SQL migration.

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

Next: build the next immutable candidate0.1.40/build41, retain
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

Current action: diagnose the actual hook-to-disk admission/projection boundary
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
timing; candidate0.1.41/build42 and actual cold proof remain next. Candidate41
was never published; catalog prior/rollback stays40, while Realme currently has41.
