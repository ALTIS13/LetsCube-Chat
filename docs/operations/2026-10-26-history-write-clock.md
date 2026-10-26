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
