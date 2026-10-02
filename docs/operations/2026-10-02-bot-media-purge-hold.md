# Bot Media Purge Hold

Owner: Codex coordinator. Base `2c14927a`, candidate branch
`codex/bot-inline-media-20261002`.
Plan: [checklist](../superpowers/plans/2026-10-02-bot-media-purge-hold.md).
Status: reviewed SQL applied once and independently verified on production
at 23:57 MSK on 2026-10-02. Source publication/exact web proof is next.

## Cause And Change

The [writer inventory](2026-10-02-bot-media-writer-inventory.md) exposed a bypass:
D-103 checks some references, leases a queue row, then removes its file outside
the transaction. Neither the ingest receipt nor its durable PUT attempts are
part of that authority. Disabling a future reclaimer does not disable D-103.

The reviewed slice excludes the entire `chat-media` bucket from claim eligibility
**before LIMIT**. It does not decode/guess paths or wait for a receipt to exist.
Canonical, encoded, malformed and future/unregistered objects share the hold.
Pending queue entries remain pending; no attempt or lease is consumed by a hold.
Existing reference-based `kept` behavior remains, as does moving variant targets
of deleted messages into the queue. Other buckets retain the previous behavior.

A queue CHECK additionally refuses any non-null `claimed_until` for `chat-media`.
An invocation already executing the old compiled function cannot get a protected
lease by waiting until the SQL replacement has finished. Its mixed-bucket batch
may fail as a whole; a subsequent current invocation can pick ordinary rows.
The migration drains queue users with an ACCESS EXCLUSIVE lock, then refuses
unsettled protected attempts/leases. It does not clear them to force acceptance.

No new removal authority, object-generation model, writer admission, DELETE
intent, quota refund, object inventory or provider call is installed. Ingest
receipts, daily charges, attempts, Storage policies and existing RLS/ACL are
unchanged. The ordinary `media` bucket's separate reference races are not solved.

## Rulings And Limits

- Hold the whole bucket before narrowing by generation/reference state. Cost:
  unused and non-ingest `chat-media` objects remain retained temporarily.
- Keep finished, unleased historical `done`/`kept` queue rows intact. The fresh
  read-only snapshot has three `done` rows from 2026-09-28, one attempt each,
  no lease and no unsettled entries. Erasing history is not a rollout gate.
  Cost: this forward barrier is not proof of past provider terminality.
- Add the CHECK as well as the claim predicate. Cost: stale mixed-bucket calls
  fail their whole batch safely rather than partially lease protected objects.

An already-issued remote DELETE cannot be cancelled by this SQL. An unresolved
attempt, any protected lease, or terminal row lacking a finish stamp blocks the
rollout. Object generations and conclusive provider outcomes remain mandatory
before any reclamation. Do not interpret absence of observed references as
permission to remove the retained 28 receipts' objects.

The rollback restores the old unsafe route and drops the backstop. It exists for
rehearsal and separately decided recovery, not automatic resolution of a hold.
Nothing restores previously removed bytes or alters charge history.

## Source And Frozen Proof

Migration: [SQL](../../supabase/migrations/20261002203853_bot_media_purge_hold.sql).
Rollback: [SQL](../../supabase/migrations/20261002203853_bot_media_purge_hold.rollback.sql).
Both have byte-identical copies in `.migration-backup/supabase/migrations/`.
They have one top-level transaction, raising prestate/self-checks and rollback
headers. The function identity, owner, ACL and empty search path are retained.

- Migration SHA256: `a27a80e03af5689da326636d036d993c00dbd0f4990598b2f51eda07129b504b`.
- Rollback SHA256: `42120442dba2897a5a866de966d2b8032f4280d25c2366b67f32d00bf206212f`.
- Old claim body SHA256: `22ae6a8dadb994f1803bbf5b030827fa6fb1c86d350adbf898f64b7a43c3b097`.
- New claim body SHA256: `ae7c20e755a7631e531c211167896cf6b62536923189392cbbb83db35ae4084c`.

Fresh production read-only preflight at 23:40 MSK confirms the old body/owner/ACL,
no public table lacking RLS, 28 complete receipts / 47,240 bytes / zero reserved,
seven acknowledged PUT attempts and zero unsettled protected purge entries.
No raw paths, URLs, message bodies, identities, tokens or media were selected.

Backup `20261002-234226` passed all checksums/archive validation and full restore
into an isolated, same-image PostgreSQL 17.6 container. It has no network, ports
or mounts, cron is off, owners/roles/ACL are retained. Dumps/logs stay root-only
on the LETSCUBE server, not in the repository or chat.

Shipped PG17 claim handed a fictional oldest protected row to its service role:
literal expected-zero assertion RED. With this patch, seven rehearsal groups
pass, including six actual role-switch denials, protected/ordinary selection,
stale-body named CHECK refusal without partial queue writes, preserved function
identity/access, exact whole-file reapply refusal, rollback and reapplication.
All fictional data and claim side effects in behavioral transactions rolled back.
No Storage API or provider operation was performed.

An additional same-image PG17 test pauses a **real already-running old public
claim** on a controlled variant relation lock, installs the migration, then
releases only the owned blocker. The resumed invocation is refused by the named
CHECK with no partial lease or attempt update. This supplements the clone case;
it is not a simulated source-only interleaving.

The local PG18.4 worker first observed four protected returned rows versus the
literal zero expectation (RED), and separately the missing stale-body CHECK
rejection (RED). Its first complete run had 21 passes and one temporary `pg_ctl`
startup failure before behavior; that case and the strengthened CHECK omission
mutant subsequently passed 2/2. No 22/22 single-run acceptance is inferred from
those reruns. The required final sequential run followed before production.

That final sequential run now passes **36/36**, zero failures/cancellations/skips,
221.44 seconds: 22 new actual-PG hold cases, five unchanged worker cases and nine
existing operator-envelope cases. The temporary-startup failure did not recur;
its cause remains unestablished. Test source SHA256 is
`59d8cb614f03b1ad138d6099aaaf88b878c28dc286090c3cdf25caad2772ad15`, fixture
`32739207a5be69dcebcfbeffea6c894d2573bdecd67815103f04bc0e78f3b28a`.
Accepted resolver/upload-intent and unchanged app/native evidence is reused;
no new frontend/runtime/build/native behavior is asserted.

Independent review approved the exact SQL/rollback and full frozen test/fixture
without P1/P2. It checked both prosrc hashes, inverse transformation, archive
parity and real lock-interleaving/literal mutation coverage. The operator input
question was resolved by capturing an owned Buffer, checking its SHA again and
executing that snapshot rather than rereading a file after an awaited gate.
The reviewer did not repeat PG17 acceptance or certify provider terminality.

Both top-level SQL envelopes pass the existing lexer, and injected early COMMIT
and extra ROLLBACK controls are rejected. The imported lexer module's existing
22 tests also pass; these are not 22 extra behavioral purge tests.

## Production Acceptance

Fresh immediate backup `20261002-235719` passed manifest checksums, archive
validation and freshness; database SHA256 is
`da386dfc9495c4e2a06e3e510fdd98d9bf938c8e1efb0371eef1bc774896aeb0`.
An additional pinned Unix-socket custom dump was list-verified and retained
root-only with SHA256
`b8d2e4f328ed6a893f98e23e8dcebdac882b7bc4013093e3212ae2aa60e3f609`.
No dump or raw database row is in Git or chat.

The operator executed the exact reviewed owned SQL Buffer once. The durable
attempt envelope and root-only receipt both report `verified`; receipt timestamp
is `2026-10-02T20:57:55.683Z`. Independent observation confirms the new exact
claim hash, preserved function OID and validated CHECK. Aggregate fingerprints
of every policy, table access/RLS authority, other public/private functions,
ingest receipts and upload attempts are identical before/after.

Actual service-role control in a rolled-back production transaction returns
zero protected rows and the one fictional oldest ordinary row. A separate
rolled-back direct-lease control is refused by the CHECK. No provider/Storage
call occurred; all fictional rows and claim effects were rolled back. Complete
receipts remain 28 / 47,240 bytes, reserved zero. Do not reapply or automatically
roll back: a rollback restores the unsafe route. Lost acknowledgement always
requires installed-state observation rather than another execution.

## Next Boundary

After verified source publication, resume no-delete reference admission/generation
work, followed by avatar and
variant writer/I/O participation. D-103 must later join the generation-bound
single seal/DELETE-intent authority before this whole-bucket hold can be lifted.
No native build/install/publication, physical-device proof or paid minutes.
