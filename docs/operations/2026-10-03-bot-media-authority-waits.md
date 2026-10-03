# Message authority after existing waits

Date: 2026-10-03. Owner: Codex coordinator. Stage: bounded local C6/C7/C8 and
forward-RPC C9 characterization complete. Source baseline: `15abed3d` on
`codex/bot-inline-media-20261002`. Evidence: 25/25 diagnostic cases on local
PG18.4, 24/24 accepted-hook comparison cases; strict authority acceptance remains
RED. Blocker: the existing file-id and forward authority windows below.
Next: narrowly repair those authority windows in a test-only candidate, then
require strict refusal, real lock-order/rollback proof and PG17/full-schema gates.

The [prefix review](2026-10-03-bot-media-coverage-prefix-review.md) identifies
membership/source reads before the existing epoch SHARE wait. The current
coverage prototype does not change those checks. Use fictional disposable local
PostgreSQL databases, the captured bot writer plus accepted ingest delta, and
the actual epoch trigger. No production operation, policy change, native build,
Storage deletion, physical generation or charge release is part of this slice.

## C8 Test Contract

[file-id waits](../../tests/server/bot-media-coverage-file-id-waits.test.mjs)
uses an uncommitted UPDATE of the sending bot's membership row. The source remains
readable to another session until that transaction commits. The writer reads it,
then reaches the actual epoch SHARE wait. `pg_locks` must show the waiter's
ungranted transaction-id lock on the blocker's `backend_xid`, its granted
membership RowShareLock, and `pg_blocking_pids` must name that blocker.

Cases: full-to-restricted, removal and a later join epoch, through both the send
RPC and the command RPC actually called by the gateway. A normal readable
control succeeds; already-revoked controls refuse. State checks include committed
message rows, idempotent results, operation results, grants, receipt/identity
accounting, Storage rows and registered observations. The fixture has focused
fictional RLS, not a full production restore.

Default mode characterizes the retained gap, if reproduced, and asserts the exact
unsafe committed copy/result rather than treating it as acceptance. With
`BOT_MEDIA_AUTH_REQUIRE_FRESH=1` the same controlled race requires refusal and no
new committed effects. That strict mode must be RED until a separately reviewed
authority repair exists. `BOT_MEDIA_COVERAGE_BASELINE=1` compares accepted hooks
without the coverage candidate; it does not remove the accepted observer/resolver.

## Observed Results

1. **File-id authority gap (D-336).** Both the captured send and actual gateway
   command commit a copy after a concurrent privacy restriction, membership
   removal or later join epoch commits during the existing membership SHARE
   wait. The source is then unreadable to a fresh request; removed membership
   also denies sending. The old request still creates message idempotency, and
   the command creates its operation result. No upload grant is involved. Six
   actual waited cases plus two no-wait control groups characterize this on both
   accepted hooks and the coverage prototype. Coverage is not an authority fix.
2. **Forward authority gap (D-337).** The captured definer RPC commits a copy
   after source hiding/clearing, source membership removal or destination
   membership removal commits during the destination epoch wait. A fresh RPC
   refuses even before that wait is released; a retry also reruns current
   authority. The committed copy retains source attribution and copies only
   matching ready variants. Four actual waited cases reproduce the gap in both
   modes. The path guard still refuses a changed canonical pointer, scrubbed
   deletion or removed source row: pointer equality is not audience authority.
3. **Existing ingest protections survive (bounded C7).** Token/member revocation
   committed before the actual SHARE lock produces `42501` and no current
   completion, message, result or grant. Once SHARE is held, actual revoker
   transactions remain blocked while commit waits on Storage. Server clock
   expiry is checked after that real Storage wait, producing `55000` and
   rolling back new grant/binding/result work. Original receipt time/bytes,
   acknowledged fictional PUT outcome and prior bindings remain unchanged.
   These four cases pass with and without the coverage prototype.
4. **No inverse closer prefix in the tested C6 sequence.** While ingest retains
   its quota/operation/token/member/receipt prefix and waits on Storage, the
   fictional closer completes without waiting for it. The later closed-pointer
   message is refused and only current commit work rolls back. This is a
   fixture control-state experiment: its pending receipt and PUT outcome
   deliberately remain held. It cannot authorize a real close or deletion.

The [forward cases](../../tests/server/bot-media-coverage-forward-waits.test.mjs)
verify literal source/compiled hashes, ACL/owner/volatility and enabled epoch
triggers. [Ingest cases](../../tests/server/bot-media-coverage-ingest-waits.test.mjs)
prove actual row/transaction waits, not an elapsed-time pause. Their expiry oracle
reads the server clock against the stored deadline while Storage remains locked.

## Validation And Review

| Frozen-input run | Result | Boundary |
| --- | --- | --- |
| Three new files, coverage prototype | 25/25, no failures/cancellations/skips; 196.7 s | Eight file-id, twelve forward-RPC, five ingest/closer diagnostic cases. Passing characterization is not passing fresh-authority acceptance. |
| Accepted hooks, file-id plus four ingest cases | 12/12, no failures/cancellations/skips; 112.7 s | Coverage SQL is omitted. C6 fictional closer is intentionally not selected. |
| Accepted hooks, forward RPC | 12/12, no failures/cancellations/skips; 149.7 s | The same four forward authority gaps already exist without coverage. |
| Strict coverage prototype: gateway-command privacy plus hidden-source forward | 0/2, two expected assertion failures, no cancellation/skip | Correct wait/control setup completes; old requests commit instead of refusing. This is RED security acceptance, not a setup error or a fix. |
| Strict accepted hooks: same gateway-command privacy and hidden-source forward | 0/2, two expected assertion failures, no cancellation/skip; 12.4 s | The same missing refusals occur without candidate coverage; both actual waits and fresh-request denial controls complete. |

An earlier one-case strict accepted-hook run also failed on missing refusal after
privacy restriction, with the real wait observed. The final two-path comparison
above uses the same frozen test inputs as the candidate. Raw local TAP output is
ignored under `.ops-private`; no personal data is used.

Read-only independent review found no P1/P2 in the frozen three test files and
caller inventory. It did not execute tests or accept production authority.
The coding worker stopped after writing the forward file; the coordinator
reviewed, ran and owns it. No safeguard was bypassed or blocked worker retried.
All worker sessions are closed. The stale report ownership/fallback wording
identified by review is corrected here; that docs correction is coordinator-owned.

| Executed/reviewed test | SHA-256 |
| --- | --- |
| `bot-media-coverage-file-id-waits.test.mjs` | `b07cb97cbd80b15fdd236f855a2c4fe0f7a83961d4b513729eaf0a8a79bf894c` |
| `bot-media-coverage-ingest-waits.test.mjs` | `ff66b1de9be0a5bbb62d62bcbdeb515e36c612ef53c08b706bc00c9d7c704d3e` |
| `bot-media-coverage-forward-waits.test.mjs` | `1ca8a5b9f9ec1e2896b275269be44c646fe579fa8cfc6cec69058b495f85e3d2` |

The earlier 33/33 coverage/mutant evidence is reused, not rerun: its five pinned
SQL/fixture/test inputs are unchanged. No application/UI/native source, shared
fixture, migration or dependency changed. Three `node --check` validations and
focused diff/link checks apply to this test/docs slice; no application build,
authenticated browser, physical-device or production proof is claimed.

Reproduce the new diagnostic candidate in PowerShell:

```powershell
$env:BOT_INGEST_PG_BIN='C:/Users/maksi/scoop/apps/postgresql/current/bin'
Remove-Item Env:BOT_MEDIA_COVERAGE_BASELINE,Env:BOT_MEDIA_AUTH_REQUIRE_FRESH -ErrorAction SilentlyContinue
node --test --test-concurrency=2 tests/server/bot-media-coverage-file-id-waits.test.mjs tests/server/bot-media-coverage-ingest-waits.test.mjs tests/server/bot-media-coverage-forward-waits.test.mjs
```

For the strict two-path gate add `BOT_MEDIA_AUTH_REQUIRE_FRESH=1` and select
`--test-name-pattern='(^command.*full to restricted)|(^C9 existing-wait authorization gap: source hidden$)'`
with the file-id and forward files. This must remain RED until the authority
repair is accepted; do not turn off that gate to claim fresh-authority safety.
For accepted-hook comparisons add `BOT_MEDIA_COVERAGE_BASELINE=1`. Select
`--test-name-pattern='^(send|command|ingest)'` for file-id/ingest (excluding the
coverage-only closer case); run the forward file separately without that pattern.

## Remaining Boundary

The [caller/isolation inventory](2026-10-03-bot-media-caller-isolation-inventory.md)
is source-only. PostgREST isolation and `55P03`/`0A000` caller retry behavior are
not accepted. These cases do not cover every quota/operation/grant wait, or every
bot/source authority change. Direct forward fallback, bans/mutes/topics, source
locks and every permitted mutator need separate proof; this is not full C6-C9
acceptance. Gateway preflight token lookup is outside the message command RPC;
do not infer ingest's retained-token guarantee for already authenticated file-id
requests.

Repair the loaded authority bodies only in disposable fixtures first. Validate
the actual gateway command and retries, source/destination checks, refusal before
any new committed effects and preserved idempotent successful retries. Review
lock order against the unchanged ingest prefix and all mutators; moving a plain
SELECT or adding a check before another wait is insufficient. Strict literal
oracles must become GREEN without changing the denial expectation. Fresh PG17
full-schema/rollback rehearsal, backup and real acceptance remain mandatory before
a production migration. Physical-generation/avatar/variant/external-I/O gates
are still separate. No delete/refund or replay of already accepted SQL.

All data and identities were fictional in loopback-only disposable local
clusters. No account was used, no third-party component installed and no paid
device minute spent. Owner's Oct 3 constraints remain: only owned accounts and
license-permitted components; never bypass tool safety controls. No production
DB/API/SSH write, personal capture, Storage/provider request or native operation
was performed.

PostgreSQL documents the [READ COMMITTED snapshot and row-lock recheck behavior](https://www.postgresql.org/docs/17/transaction-iso.html)
and [STABLE versus VOLATILE query snapshots](https://www.postgresql.org/docs/17/xfunc-volatility.html).
Those explain why lock acquisition alone is not a fresh authority decision; the
actual session cases above, not a documentation inference, establish these gaps.
