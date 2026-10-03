# Exact Variant Claim Ownership, 2026-10-03

Owner: Codex coordinator, branch `codex/bot-inline-media-20261002`, base
`0ac96a70`. The owner authorized readiness-gated deployment without another
approval round. This is the independent D-339 scheduling repair, not a claim
that D-338 avatar publication or the whole media lifecycle is repaired.

## Cause And Contract

The prior queue accepted finish/retry by scope and target alone. After A's lease
was reset or reclaimed by B, A could delete B's job or clear B's ownership and
alter its retry schedule. Actual captured functions and avatar enqueue triggers
reproduce both failures; literal refusal plus the entire B row is the oracle.

The worker now retains its own accepted claim-request UUID and carries it on
both settlement RPCs, ignoring forged ownership in returned row metadata. SQL
locks and mutates only the exact scope/target/token. Stale, null, invalid and
released identities return false without changing any row. There is no legacy
fallback. Backoff remains 60/120/180/240 seconds, with the existing fifth-failure
exhaustion rule and sanitized errors.

Old RPC signatures remain callable but return false without mutation. During a
rolling deploy old workers can leave a job until the existing 15-minute reclaim
threshold; they cannot consume a new worker's job. SQL rollback restores the
exact prior function definitions/owners/ACL/configuration and the old defect:
coordinate worker rollback first. No queue data, enqueue/claim functions, RLS,
policies, table grants, triggers, Storage objects or accounting are changed.

Migration: `20261003183925_media_variant_claim_token.sql`; rollback has the same
stem. Both archival copies are byte-identical. The migration is one transaction
with bounded locks and raising prestate, catalog and behavioral self-checks.

## Verification

| Boundary | Result | Meaning |
| --- | --- | --- |
| Actual compiled worker + installed SDK | 9/9 | Exact token on all three scopes and both settlements, no legacy fallback, new batch token, two compiled omission mutants |
| Actual archived SQL on local PostgreSQL 18.4 | 14/14, no skips | Initial captured 0/2 RED; real row-lock 55P03, retry budget, whole-row preservation, role denials, predicate/catalog mutants, exact rollback/reapply |
| Full restored PostgreSQL 17.6 + PostgREST 14.12 | 6/6 | All three scopes x finish/retry; exact rollback, copied queue and policies/RLS/grants/triggers unchanged |
| Actual worker/SDK over full PG17/PostgREST | 6/6 + 2 role denials | Current/stale settlement; pre-import/compile and final closure hashes match; copied queue restored, listener absent |
| Operator fault gates | 10 controls | Four owned-launch controls, two rejected CLI actions, two real copy-cleanup failures, lost-mutex ACK and an executed cleanup-refusal omission mutant |
| Unchanged built worker controls | 34/34 | Queue drain, variant terminal cases and upload headers retain behavior |
| Full unit suite | 4,941 passed, 0 failed, 13 existing optional skips | 4,954 total; clean bounded-concurrency rerun |
| Web/API typecheck and real builds | Pass | Web `sw.js build 73f59773f2cf5c46`, `built in 6m 26s`; existing sourcemap/chunk warnings, no build failure |

The first loaded full unit run had one unchanged Android aggregate-signing
dry-run timeout. Its focused rerun passed and the full rerun above also passed.
No Android build, install, signing or publication was performed.

The production backup was restored into an exact-image, network-none, no-port,
no-mount owned copy, with cron disabled. Only fictional fixture rows are mutated.
The actual SDK/worker HTTP gate also verifies current/stale finish behavior and
untrusted-role refusals. Final HTTP/fault receipts match frozen inputs;
independent review has no remaining P1/P2. Source proof and deployment proof
remain distinct.

Independent review found four P2s in the ignored operator, not in the SQL/worker:
lost creation replies escaping cleanup, historical CLI dispatch on import,
success-only queue restoration/early success receipts, and independently hashed
worker bytes differing from compiled input. These were repaired with action-free
transport imports, exact-owned recovery, unconditional cleanup before receipt,
and captured-source/closure hashes. A coordinator accidentally overlapped two
HTTP checks on the same copy: both refused acceptance, an exact-owned orphan
was stopped after executable/argv/container checks, and an owned nonce mutex
now prevents shared config/listener overlap. Final checks run sequentially.

Two stopped local startup directories remain after the tool rejected removal
before execution. They are recorded privately, have no running server/process,
and were not deleted by circumventing that policy. Final accepted PG18 fixture
was removed. The remote copy was removed by exact ID/name/owner/image/isolation
checks after catalog reconciliation; production DB identity is unchanged,
backups remain.

## Deployment Checkpoint

SQL was applied **once** after fresh checksum/archive-verified backup
`20261003-222036`. The initial apply envelope refused publication because its raw
JSON aggregate hash differed. Independent readback found the exact same five
definitions/owners/ACL/configurations, but production and the initialized copy
sort overloaded text signatures differently. No SQL retry or rollback occurred.
A separately reviewed reconciliation compares all fields by unique full
signature in ASCII order; the original refusal receipt is retained. The raw-order
counterexample is RED, reordered exact control passes, and deviations in each
of the five fields are refused. No comparison field was dropped.

Production catalog/RLS/policies/grants/triggers match; all public tables retain
RLS. Four actual service-role NULL-only HTTP calls return literal false through
the live PostgREST cache after its schema notification. No fixture row or Storage
request is written into production. The worker environment is loaded from its
existing secret mount, as its normal entrypoint, without printing values.

Runtime source `8da252adcab3da6752fcd25ecb049e12d18f2fe1` is pushed to the candidate
branch and `main`, after reading all 13 outgoing commits and resolving imports
against each commit's own tree. Web, worker and deliberately triggered Gateway
are sole healthy exact-revision replicas; prior replicas are gone. Prior worker
token/Gateway busy markers were false; new markers are true. Both the dedicated
worker bundle and the executed `index.mjs` contain the two token settlements.
Gateway carries the allowlist, sanitized busy envelope and retry header. The
support-mail rebuild is healthy and its behavior was not changed.

The public `/assets/index-CS8eG8Nz.js` references the new busy rule, matches the
container byte hash, and is referenced by current public HTML. SHA256:
`9151bd66c2d6345af9ebca927080df99cadda2418bbedd05d1635695dfbd13f3`.
The initial SSH-text hash check was not byte-safe: chunk decoding and trimming
are not an asset-byte comparison. Server-side SHA256 and public raw bytes pass.
An actual SSH control splitting one fictional UTF-8 character was RED before
the diagnostic reader gained stream decoding and GREEN afterwards. Fresh avatar
metadata retains the same hash; live NULL-only RPC/catalog checks pass again.
Earlier frozen operator receipts describe their original sources and must not
be reused as current-input approval for a later migration.
Post-deploy live RPC 4/4 and catalog/metadata readback pass again. This is not a
signed-in production screenshot or native/PWA hardware acceptance.

The already-reviewed caller busy recovery in `3976348f` is also in this candidate:
exact `500/55P03` preserves app outbox identity/payload; only replay-safe Gateway
message RPCs expose sanitized 503/retry-after 2. Its unchanged 57/57 focused,
7/7 compiled, 27/27 browser/IndexedDB and full PG17 HTTP 9/9 evidence is reused,
not relabelled as new tests. See
[caller recovery](2026-10-03-bot-media-busy-recovery.md).

## Remaining Work

D-338 still requires DB-owned logical source epochs across all avatar setters,
clear/same-URL writes and nested triggers, durable source/target intents before
external I/O, fresh attempt paths and atomic publication. A claim UUID is not
a source epoch, physical object generation, permission to delete media or
permission to refund quota. D-336/D-337 and tracker item 78 remain open.

Whole-`chat-media` HOLD, Android/native HOLD and A063 exclusion remain. No provider
deletion, quota release, path reuse, device action or paid cloud session is part
of this repair. Do not replay earlier accepted SQL or restart completed gates.
