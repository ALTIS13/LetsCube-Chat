# Bot Media Reconciliation - 2026-10-02

## Resume

Owner: Codex coordinator. Stage: bounded read-only inventory verified after the
accepted [D-258 rollout](2026-10-02-bot-inline-media.md). Both reused workers
are closed; independent review approved the frozen report without P1/P2 issues.
The write scope was an operator SQL report and focused fixture tests. No scheduled task, deletion,
quota release or production migration is authorised by the report itself.

## Safety Contract

- Read one repeatable-read, read-only database snapshot with explicit statement
  and lock timeouts. Roll back at the end, including normal success.
- Check the selected catalog before reporting; drift is an error, not an empty
  inventory. The durable state names are `reserved` and `complete`; completed
  operations retain `result` and `completed_at`.
- Emit aggregate counts/bytes only. Never emit account/chat/bot/message ids,
  object paths, keys, token fingerprints, URLs, message bodies or media.
- Count references by exact canonical bucket/path across all authors and bot
  identities, including soft-deleted messages. A reused object is not orphaned
  just because the receipt's original message disappeared.
- Storage metadata presence and canonical-column reference absence are only
  database signals. They do not establish actual object bytes, provider deletion,
  absence of legacy URL references or permission to delete.
- Keep failed and completed admissions charged. Deleting a message, a bot or a
  Storage row does not make it safe to erase a durable idempotency receipt.

## Observed Starting State

The exact synthetic `d258:` key cohort contains 21 `complete` admissions with
results and completion timestamps, totalling 35,430 charged bytes across the
three QA attempts. The three groups were removed, tokens revoked and the
disposable bot returned to pending deletion. This is evidence that QA cleanup
does not silently reset quota, not proof that its objects should be deleted.

## Follow-Up Gates

The report passes 9/9 actual PostgreSQL 18.4 fixture cases, without skips:
reserved/complete counts and bytes, Storage metadata missing/mismatch controls,
cross-author reuse and soft-deleted references, empty-ledger positive control,
schema/owner/index/state drift and non-BYPASSRLS refusal, actual DML/DDL
read-only enforcement, exact lease-expiry equality, one two-connection snapshot
and keyed Storage lookups among 5,000 unrelated objects. A real 20,000-entry
fixture is accepted with 1,360,000 bytes; the 20,001st entry raises. Read-write,
expiry, deleted-reference and raised-cap mutants change the measured outcomes.
Syntax and diff checks pass. No full application suite was repeated for this
operator-only report.

The production target was verified independently as healthy `supabase-db`,
`supabase/postgres:17.6.1.136`, database `postgres`, PG17.6 and trusted operator
`supabase_admin`. The exact source SHA256
`239778353661bb4b1fa8d685d4d526e2b0878cf8a4f6b3005dd4b6f5a795c3a0`
was checked before execution. Its READ ONLY REPEATABLE READ snapshot at
`2026-10-02T12:35:14.574692Z` (15:35:14 MSK) ended in ROLLBACK; the full
SSH-plus-query elapsed time was 716 ms, not a standalone SQL benchmark.

| Aggregate | Production snapshot |
| --- | --- |
| Charged / rolling 24-hour entries and bytes | 21 / 35,430 |
| Complete / reserved entries | 21 / 0 |
| Storage metadata rows present and matching MIME/size | 21 |
| Missing/invalid/mismatched Storage metadata | 0 |
| Complete result identity and timestamp present | 21 |
| Original message absent / canonical reference rows | 21 / 0 |
| Canonical-column candidate entries | 21 |
| Noncanonical paths / expired reserved leases | 0 / 0 |

These counts agree with the exact synthetic QA cohort measured before the
audit. Removing the three disposable groups removed the original messages but
did not erase upload receipts or reset retained/daily quota. The operator report
only enumerates charged receipts; unrelated and legacy objects are not an
inventory gap falsely reported as zero. Canonical-column candidate counts do
not prove absence of legacy references, actual bytes or safe deletion.

The audit creates no table/function, API, cron or scheduler. Run the SQL only
through a trusted database operator with SELECT and BYPASSRLS; `psql -X -qAt
-v ON_ERROR_STOP=1` should receive the reviewed file on stdin. Never relax a
failed drift/timeout/cap guard to obtain a reassuring report. Large reference
scans may reach the explicit 15-second timeout; that is refusal, not zero data.

A destructive reconciler remains a separate stage: a reviewed lifecycle/state
contract, fresh backup and restore/rollback proof for any schema change,
immutable receipt preservation, fenced admission/commit interleavings, a grace
period and bounded revalidation of all supported references, actual Storage API
outcome reconciliation after timeouts, and exactly-once retained-quota release
without resetting the rolling daily budget. Do not infer those capabilities
from successful inventory tests.
