# Item 74: phone-search SQL rehearsal

Resume: owner Codex SQL worker; stage complete, awaiting coordinator independent
SQL review/apply; worktree `.worktrees/bot-platform`, branch
`integration/message-actions`, starting HEAD `29176d72e6b1686a61bd91ef322d592f115e40e6`.
Evidence: actual PG17.6 concurrent backends, isolated full fresh-backup restore,
exact rollback catalog and mutation tests below. Blockers: none in this SQL slice.
Next: coordinator review, fresh prestate drift check, byte-identical migration
backup copy and authorized production apply. No commit, push or production SQL
apply was done by this worker. Other owners' client/test changes were preserved.

## Changed Paths

- `supabase/migrations/20260930235000_phone_search_for_everybody.sql`
- `supabase/migrations/20260930235000_phone_search_for_everybody.rollback.sql`
- `tests/rehearsal/phone-search-item74/fixture.sql`
- `tests/rehearsal/phone-search-item74/rehearse.mjs`
- `tests/rehearsal/phone-search-item74/prestate.mjs`
- This report.

Worker-reviewed SHA256 (raw file bytes, superseded by the integration addendum below):

```text
migration 75a677fd58e7fbd1669c2d6e84ae6ac925bb2265c8d74150668575ae484397d1
rollback  9a802805385579a6e6c27c609038f5ec0a91626b8375de3df725340e0f7fe877
```

## Cause and Patch

The candidate counted before inserting without account serialization. Twelve
separate connections, all witnessed in `pg_stat_activity` waiting at a test-only
insert barrier, produced twelve successful lookups and twelve committed rows
against the literal ten-per-minute requirement. The original definer owner is
`postgres`, whereas the authorized migration role is `supabase_admin`; a new log
table owned by the latter also lacked the RPC owner's required access. Only for
the initial quota reproduction, an explicit log grant was supplied in the new
isolated container so that the unrelated permission failure could not mask the
race. The quota body itself was unchanged in that red run.

The patch takes a namespaced account advisory transaction lock before counting,
uses current wall time after waiting, rejects non-READ-COMMITTED member calls,
sets `search_path=pg_catalog, pg_temp`, retains qualified auth/table references,
and aligns the log owner with the existing definer. Client/PUBLIC/service-role
log access remains revoked. The catalog self-check verifies effective grants,
column-level grants, owner/access, function attributes, preference default/check
and log shape/FK. `VOLATILE` fresh statement snapshots after the lock are the
relevant [PostgreSQL 17 contract](https://www.postgresql.org/docs/17/xfunc-volatility.html).

Direct SQL also proved both missing input restrictions red: naked international
digits and Russian local ten digits found an existing synthetic profile. The
RPC now admits only explicit `+` international syntax, or exactly eleven stripped
digits starting with Russian `7`/`8`. Formatted positives remain accepted. The
shared `_normalize_phone_e164` function was not changed.

The log stores only `user_id` and `looked_up_at`. It is a bounded quota cache,
not a hard 24-hour retention promise: stale timestamps of inactive live accounts
remain until the next successful lookup; active accounts retain at most 100 rows.
An `auth.users` FK with `ON DELETE CASCADE` removes the cache when the account is
deleted. Stale pruning, cascade and another account's preservation were tested.
No cron or unrelated production behavior was added.

## Prestate and Rollback

Read-only live inspection as `supabase_admin`, restricted to `supabase-db`, found
the candidate absent and the original function owned by `postgres`, STABLE,
SECURITY DEFINER, `search_path=pg_catalog, public`, ACL
`{postgres=X/postgres,authenticated=X/postgres}`. Exact hashes computed in the DB:

```text
UTF8 pg_get_functiondef SHA256
53e17a81ab737d08e419aeaffbef8a16593c76ecd4e80c88afdb59b77006bbe6
UTF8 prosrc SHA256
bbb8be1eb61ac7768d9d277a9fee9a45bcb5494d725ffdcc7adb1e9742d59fee
```

The independent synthetic prestate and the full restored prestate matched this
exact definition hash before apply. Rollback restored body/hash, owner, ACL,
volatility, definer flag, path and old comments exactly, removed the new column
and log, and restored staff-only lookup. Rollback/reapply idempotence passed.
Both migration files and fixture passed the lexer check for exactly one
top-level BEGIN first and COMMIT last, excluding comments/dollar quotes; injected
command-tag ROLLBACK and extra transaction statements are rejected.

## Rehearsal Evidence

Every quota wave used twelve distinct, simultaneously blocked SQL backends;
authenticated claims/role were set inside each transaction. No timing-only or
source-string assertion substitutes for these SQL results:

| Case | Successful | Rate-limited | Stored rows |
| --- | ---: | ---: | ---: |
| Empty minute quota | 10 | 2 | 10 |
| Nine recent lookups | 1 | 11 | 10 |
| Ninety-nine lookups two hours old | 1 | 11 | 100 |
| Removed-lock mutation, nine recent | 12 | 0 | 21 |
| Removed-lock mutation, ninety-nine old | 12 | 0 | 111 |
| Minute constant changed to eleven | 2 | 10 | 11 |
| Day constant changed to 101 | 2 | 10 | 101 |

The synthetic complete run passed 13 groups before the coordinator's final input
contract finding: 22 migration self-check mutations, 10 rollback self-check
mutations, four concurrent quota mutations and two transaction mutations were
killed. These mechanisms were unchanged by the subsequent input guard. The final
guard was then tested against actual matching SQL fixtures: both original forms
red, full-restore positives/negatives green, and a focused two-group run killed
its removal for both local and international inputs. Total: 39 killed mutations.
The existing focused phone-contract Node suite passed 3/3. Workspace-wide gates
belong to the coordinator and were not rerun here.

## Full Fresh-Backup Restore

This was a full data-and-schema restore, not schema-only and never into production:

```text
/srv/letscube/backups/automated/20261001-155443/db/supabase-postgres.custom
```

The coordinator supplied verified prestate evidence: SHA256SUMS 15/15 and 161
TABLE DATA entries. This worker restored that exact custom dump with
`pg_restore --exit-on-error --single-transaction` into a uniquely named new
PG17.6 container/database. Restore exit was 0; its 163-table catalog matched the
read-only production catalog (TABLE DATA entries are not the table count).
The final full-restore run passed **10 groups, zero skips**, including all three
concurrent quota waves, privacy writes, input normalization, transaction lifetime,
retention/account deletion, and exact rollback/reapply.

Authenticated `INSERT(user_id) ON CONFLICT DO NOTHING` preserved the previously
stored contacts/forward/presence/status row byte-for-byte. Partial UPDATE of one
field plus `updated_at`, with RETURNING user_id, returned exactly the own row and
preserved other fields. Other-account/anon UPDATE returned zero rows; their
INSERT was refused by RLS. The absent own row initialized successfully. These
passed on the actual restored columns, policies, grants and timestamp trigger.
SQL zero-row UPDATE is the evidence behind the client's `.single()` refusal;
this worker did not claim an HTTP/PostgREST integration test.

For synthetic auth-user seeding only, the owned restore's invite-only flag was
temporarily changed and restored in one transaction; no policy/trigger was
disabled or replaced. No existing restored user IDs were reused. Cron jobs were
off. Required `pg_net` preload was directed at the empty `postgres` DB, not the
restored DB, consistent with its [database configuration](https://github.com/supabase/pg_net#installation).
Containers had `network=none`, no published ports, no host mounts, bounded memory,
and tmpfs data. Raw restore diagnostics and all personal rows remained unprinted.
Initial restore setup failures (pg_net preload, pgbouncer role, table-count
assertion, invite-required fixture setup) were resolved in new owned containers,
not by modifying existing rehearsal/live services. Every owned container was
removed after exact ID/name/image/owner-label/network checks. No Happ, network,
existing container, live restore or production backup action occurred.

## Reproduce

Run from `D:/CodexProjects/LetsCube-Chat/.worktrees/bot-platform`:

```powershell
node tests/rehearsal/phone-search-item74/prestate.mjs
node tests/rehearsal/phone-search-item74/rehearse.mjs --syntax-only
node tests/rehearsal/phone-search-item74/rehearse.mjs --ssh --mutations
node tests/rehearsal/phone-search-item74/rehearse.mjs --ssh --fresh-backup
node tests/rehearsal/phone-search-item74/rehearse.mjs --ssh --only=whole-number --input-mutation
```

`prestate.mjs` only reads live schema metadata and fails on the exact owner/hash/
ACL drift. All other SSH commands above create their own labelled container and
never attach to `supabase-db` or the existing rehearsal. The pinned PG17 image
must already exist; nothing is pulled. Cleanup is exact-target-only. The full
backup path is intentionally pinned to this approved prestate. Coordinator owns
independent SQL review, backup-copy recording, production apply and deployment.

## Coordinator Integration Addendum

The first guarded production apply was atomically rejected by the raising FK
self-check. Its exact old function hash and absence of both new objects were
confirmed after rollback. A rolled-back metadata-only FK probe established the
cause: the live `supabase_admin` default path exposes `auth`, so
`pg_get_constraintdef` renders `REFERENCES users(id)` instead of the fully
qualified form seen in the initial isolated role.

Both SQL transactions now set `search_path=pg_catalog, pg_temp`; the runner
sets the isolated role's ambient path to `public, auth, extensions`. The
coordinator's repeated full-restore run passed 10/10 groups, zero skips, with
exact-container cleanup. Independent review found no issue in this narrow
delta. Final applied raw-file hashes are:

```text
migration 34871c285dcaf35426d8d3c05f200f78908c1b59f07c9c223af0757ca0f64469
rollback  6e07b55eee3394daf06961c28a032195434eb7a3083dbe68bf7e3d822b98f7d2
```

The successful apply revalidated all 15 fresh-backup checksums, exact prestate
inside the same locked transaction, raising catalog assertions, and notified
PostgREST's schema cache. Both migration-backup copies are byte-identical.
Live UTF8 function definition SHA256 is
`b407086374d55fbe72954ff8da9256e6bc838c51e35fe7bf7a3e762900fdcc11`.
Owner/path/volatility/client grants match the intended contract; 82/82 public
tables still have RLS. A real authenticated read-only PostgREST smoke passed
own-column read, foreign-row isolation, anonymous denial and an empty invalid
query, then revoked only its own temporary auth session.

The reviewer also reproduced `PASS SUMMARY checks=0` for an unknown `--only`.
The runner now requires a positive executed count and an actual selector match;
the local positive/negative regression pair passes 2/2. The final mutation run
also includes removing the transaction path under the production-like default.
Web integration/deployment and user-facing completion are tracked in the
coordinator's implementation record, not inferred from this SQL report.
