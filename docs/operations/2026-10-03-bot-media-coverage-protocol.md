# Transaction-Wide Message Coverage Prototype

Owner: Codex coordinator. Baseline: `e9d713d4`, branch
`codex/bot-inline-media-20261002`. This is a test-only protocol experiment over
fictional PostgreSQL rows, not a migration, production admission, or permission
to seal/delete/refund. The existing whole-`chat-media` hold remains mandatory.
The identity, resolver and observations SQL have already been applied; do not
replay them. [Foundation](2026-10-03-bot-media-admission-foundation.md) and
[observations](2026-10-03-bot-message-media-observations.md) remain the context.

## Decision And Scope

Ruling: replace the refuted sorted per-statement shared-object experiment with
one coarse transaction-wide, **nonwaiting** coverage barrier. Multiple writers
share it through transaction end; a test-only closer tries exclusive access and
refuses immediately on conflict. No per-object upgrades or new advisory wait
edges are introduced. Cost if wrong: unsafe late references; therefore this
candidate stays outside migration/runtime paths until actual-session acceptance
and every lifecycle participant's coverage have independent approval.

Ruling: READ COMMITTED only for this candidate. Fixed-snapshot writers/closers
are refused explicitly, not assumed to observe fresh committed close state.
Cost: this deliberately narrows compatibility and is **not** approved as a
production restriction. A complete caller/isolation inventory is required.

Ruling: unknown/ambiguous observations block all close; after any fixture
generation closes, new unknown references are refused globally. Unknown is not
absence. Cost: very conservative availability and potentially no reclaimable
objects. Narrowing unknown coverage requires a separately proved namespace
contract, not a heuristic based on today's 740 holds.

## Candidate Contract

- Before every INSERT/UPDATE/DELETE/TRUNCATE statement on `public.messages`, try
  a shared transaction advisory fence. Keep existing RLS, ownership and row
  guards; this is not their replacement. On conflict, `55P03` aborts the current
  transaction. A caller must retry the **whole** operation, not skip admission.
- After statement, resolve complete OLD and final current NEW rows. Nested row
  writes can supersede NEW transition images. Include existing bound
  observations; reject references to fixture-closed logical generations.
  Canonical/URL/parent-bucket preview are independent inputs.
- The fictional closer tries the same global fence exclusively without waiting,
  then performs fresh plain reads. No message, membership or Storage row locks.
  Its own private control rows use `FOR UPDATE NOWAIT`; an uncovered row owner
  yields a named `55P03` refusal rather than a new wait under exclusive coverage.
  It refuses unknown coverage or any reference to a requested generation. It
  changes only the fixture's control rows, never accepted registry state.
- A writer cannot upgrade its shared fence to a closer. An exclusive closer
  cannot reenter message DML, even if its own PostgreSQL lock would be compatible.
- Savepoint rollback and whole-transaction rollback must release only their own
  acquisition and retain any barrier acquired before the savepoint.
- No per-object reference counter, lease inference, quota reset or new client
  authority. The closer is not granted to application roles.

The candidate lives in
[`tests/server/fixtures/bot-media-coverage-candidate.sql`](../../tests/server/fixtures/bot-media-coverage-candidate.sql),
not `supabase/migrations`. Its schema and close state exist only in disposable
fixtures. Logical UUIDs remain **not** verified physical Storage incarnations.

## Evidence Checkpoint

Initial feature RED: both trusted canonical and authenticated URL-only writes
were accepted after a fictional close when only shipped observations were
installed. Resolver/registry and fixture-close controls passed first. These are
missing-admission failures, not a missing file, syntax error or RLS denial.

The first candidate run exposed a fixture SQL error (`42883`, qualified
`pg_catalog.coalesce`); corrected to PostgreSQL's special `coalesce` expression.
The first broad core run was 12/13: the preview test violated the already accepted
derived-path CHECK rather than reaching admission. It now uses a valid derived
preview and verifies the parent-bucket positive control before refusal. The
moderation case initially used unsupported `resolved`; the captured trigger's
actual terminal status is `dismissed`/`actioned`, and the fixture was corrected.
Neither fixture mistake required changing any accepted production constraint.
The uncovered-control-row test initially went RED with an actual lock timeout
before the NOWAIT change. Independent review then found two P2 defects in its
acceptance evidence: a timeout could mask omission of NOWAIT, and the snapshot
pause was outside the closer's actual acquisition path. Both are corrected:
lock timeout is disabled and the oracle checks the actual blocking edge; the
snapshot pause is inside the loaded closer immediately before acquisition.
Executable NOWAIT-omission and cached-pre-acquisition-scan mutants now violate
those same literal oracles and actually commit the forbidden behavior. The four
targeted normal/mutant cases pass. Earlier failed/interim runs are not final
acceptance and the original 31-case run is superseded below.

Final frozen-input run on local **PostgreSQL 18.4**, fictional disposable
databases: **33/33 passed**, zero failures/cancellations/skips, 264.8 seconds.
This includes 19 core cases, five authority cases and nine executable-mutant
cases. Eighteen actual client-role denials distinguish schema USAGE from private
EXECUTE/table access; the service role does not bypass table admission. Captured
ingest, forward and file-id bodies retain their separate authority and rollback
controls. Initial baseline feature RED was 0/2 on the missing closed-reference
guard; normal positive registry/close controls had passed first. The final source
also passes four `node --check` commands. No application/native build is claimed.

Run:

```powershell
$env:BOT_INGEST_PG_BIN='C:/Users/maksi/scoop/apps/postgresql/current/bin'
node --test --test-concurrency=2 --test-reporter=tap tests/server/bot-media-coverage.test.mjs tests/server/bot-media-coverage-authority.test.mjs tests/server/bot-media-coverage-mutants.test.mjs
```

Current final-input SHA-256 fingerprints:

| Input | SHA-256 |
| --- | --- |
| Candidate SQL | `fee4dc29439322a4f6c5357323e3c434342a5a865b124beaa98a0c078d51a018` |
| Fixture | `ecb6ccbb23ab51cb63a2908146ac56b3c5eea64ba7bc763c3443422fcc252a84` |
| Core tests | `41a432f61cb342822c518de61da6eec4c30311895525497c1cec6952ea708ce9` |
| Authority tests | `d8d12a498b73223deeef5cfab3bf9734eecf8fec2051312391adcf55414a96f8` |
| Mutant tests | `0d86a7c6c044c565e3e75f3e4b9ea57951862ff65d2b3133d92997a48a22fccd` |

Source reviewers and the authority-test worker are closed. The coordinator
verified the review fixes with the strengthened four-case run and final full
run; there was no second independent acceptance review after those fixes.

The [independent prefix review](2026-10-03-bot-media-coverage-prefix-review.md)
derives eleven remaining acceptance groups from exact source anchors. It does
not claim that the old authorization checks are refreshed by coverage. Authority
tests use the captured forward/file-id implementations with fictional membership
policies, not every live production RLS definition. They inject a closed source
control **only after** proving the normal closer refuses existing references;
that injection tests defense under inconsistent state, not a valid close path.

## Remaining Boundaries

This barrier covers message statements only. Actual ingest/reserve/upload/grant
operations, avatars, variant rows/source reads/PUT publication, moderation
changes and D-103 claimant/finish are not automatically participants. A closer
must remain disabled even if the fixture has no message references: its known
receipts deliberately remain pending holders, and no external I/O is resolved.

Before production admission: independently review lock prefixes and authorization
after existing waits; prove retry behavior and caller isolation; rehearse exact
PG17 and full schema/bootstrap/rollback/catalog/ACL coverage. Before reclamation:
prove physical generations, late/unknown PUTs, every other holder, crash recovery,
generation-aware DELETE and exactly-once release. Never infer those from these
message tests. No production write, device installation, native release, paid
device minute, capture or external Storage/provider call belongs to this slice.

Next bounded stage: the prefix review's actual authorization-after-wait cases,
with baseline/candidate separated, plus caller/isolation inventory. A deliberately
divergent retained binding versus the current resolver needs its own isolated
case; existing ledger scans are not that proof. Exact PG17/full-schema/bootstrap/
rollback and every non-message participant remain separate gates. No production
admission migration or reclaim entrypoint is authorized by this test checkpoint.

## Primary References

PostgreSQL's [transaction advisory try-lock functions](https://www.postgresql.org/docs/17/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS)
return immediately rather than waiting. Its [isolation contract](https://www.postgresql.org/docs/17/transaction-iso.html)
distinguishes fresh READ COMMITTED commands from fixed transaction snapshots.
These support the mechanics, not the correctness of this application protocol;
actual independent-session tests remain the acceptance oracle.
