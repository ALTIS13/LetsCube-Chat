# Avatar Source Epochs: Next Implementation Slice

Owner: Codex coordinator. Follows the independent
[D-339 claim repair](2026-10-03-media-claim-token-rollout.md), not a replacement
for it. D-338 and message-authority D-336/D-337 remain open. This document records
the next executable boundary; none of the epoch/intent/publication changes below
is installed merely because the queue repair is installed.

## Current Evidence

Actual avatar workers can publish stale ready/failed rows, overwrite a newer
profile variant at its fixed path, and leave accepted PUTs without a publication
record. URL rechecks do not close the DELETE/INSERT gap or A-old -> B -> A-new.
[Accepted 73-case counterexample gate](2026-10-03-media-avatar-concurrency.md)
is reused with its source boundaries, not relabelled as a deployed repair.

Source inventory covers profile settings, administrator replacement/reset,
chat avatar updates, missing-profile bootstrap, bot upload/clear and the trusted
bot setter. Direct permitted PostgREST and trusted SQL remain alternate routes;
client-only safeguards are insufficient. Current bot uploads allow upsert.

Read-only production metadata was captured on 2026-10-03: 50 columns across the
four affected public tables, 18 owner-table triggers, 22 policies and five
selected bootstrap/setter/path functions. Full definitions and grants remain in
the ignored operational file; no message/account/media rows were read or printed.
The capture was repeated after an actual split-UTF-8 SSH control passed, retaining
the exact same metadata hash. Use the corrected capture, not an unverified reader.
Metadata SHA256: `7a660b64b61ee12d2b2ed8940fdeb4a8defde542bc156eca227e16871506e266`.
This closes the inventory's missing-live-catalog question, not implementation QA.

## Contract

1. DB-owned private current-source rows and retained history bind scope/owner to
   a fresh logical epoch on every INSERT or explicit avatar assignment, including
   equal URL, NULL -> NULL and clear. Ordinary clients cannot assign the epoch.
   A-old -> B -> A-new creates three distinct epochs; an epoch is not bytes or
   a provider object version.
2. Hooks observe final rows across nested triggers. Explicit avatar-write events
   precede enqueue; a bounded all-UPDATE fallback catches indirect changes or
   missing ledger, without rotating on every presence/name update. Delete, ID
   replacement and truncate invalidate current references but retain admitted
   intent/history. Preserve existing grants, RLS, guards and bootstrap semantics.
3. Queue and scan call the same trusted admission RPC. Lock order is owner,
   current epoch, retained attempt/source/target. Missing ledger/RPC fails closed
   before external I/O. Clearing an avatar invalidates work without a GET.
   No database transaction spans network calls, and no queue/owner inversion is
   introduced.
4. A fresh server attempt, distinct from a rotating queue token, durably binds
   exact owner/epoch/kind/source and a fresh target before GET/PUT. Retain pending,
   unknown, stale, failed and accepted-but-unpublished outcomes after owner deletion.
   Variant PUTs are insert-only at unique epoch/attempt addresses; retries do not
   reuse a previous target. Check existing Storage read boundaries before changing
   addresses.
5. One atomic publisher validates the current epoch and exact retained attempt,
   target, kind and outcome before replacing ready or failed rows. Stale work
   records only its own outcome; it cannot DELETE the newer publication. Queue
   settlement remains independently token-fenced.
6. Original avatar upload coverage needs a durable pre-PUT source intent and a
   fresh insert-only source address linked to the later setter. An overwrite that
   never calls the setter cannot be detected by URL alone. Legacy same-path write
   authority must not silently count as covered; bootstrap creates logical
   observations/unmanaged holds, not retroactive I/O admission or physical versions.

## Ordered Acceptance

1. Pin actual bootstrap/setter/trigger order/enabled state and row grants. Write
   literal RED cases for clear, equal URL, ABA, nested writes and missing ledger;
   keep unchanged RLS/permission cases as controls.
2. Implement private epoch/history and trusted admission/publication in disposable
   SQL with bounded locks, deterministic order, raising self-check and exact
   rollback. Keep ordinary-role table authority absent. Test omission mutants.
3. Wire the actual compiled worker and installed SDK for queue and scan. Exercise
   pre-I/O crash, accepted-PUT gap, stale/current outcome, wrong target/kind and
   ownership revocation. No permissive legacy fallback.
4. Rehearse the frozen inputs against a freshly restored full PG17/PostgREST
   copy; verify roles/catalog/rows/rollback. Separately prove real Storage semantics
   using isolated non-personal fixtures before any physical-generation claim.
5. Independent review, verified fresh backup, one apply, readback and exact-image
   deployment. Preserve valid evidence and record every unresolved boundary.

No provider deletion, quota refund, path reuse, age-based pruning, native release,
device operation or paid cloud session follows from this contract. Whole-
`chat-media` HOLD, Android/native HOLD and A063 exclusion remain unchanged.
