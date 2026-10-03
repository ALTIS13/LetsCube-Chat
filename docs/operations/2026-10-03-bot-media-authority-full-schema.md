# Message Authority: Full-Schema PostgreSQL 17 Rehearsal

Date: 2026-10-03. Owner: this Codex chat. Branch:
`codex/bot-inline-media-20261002`; starting source `092629c6`.
This completes the next bounded **test-only** stage for D-336/D-337 / item 78.
It is not a runtime migration, deployment or permission to reclaim media.

## Observed Gaps And Repairs

The [prior PG18 repair](2026-10-03-bot-media-authority-repair.md) uses reduced
policies and sanction stubs. Restoring the real schema exposed these boundaries:

1. The SECURITY DEFINER forward RPC did not check the real private-recipient
   block predicate. The direct table route refused via RLS; the RPC did not.
   The fixture now invokes the actual `public.blocked_from_chat` predicate.
2. A stale direct forward INSERT could bypass the repaired RPC after its source
   was hidden. A fixture-only BEFORE INSERT guard reuses retained source/target
   authority for authenticated, non-bot forwards. This is INSERT coverage, not a
   claim about every permitted UPDATE or raw/admin writer.
3. A fresh ban/mute check did not protect the absence of a sanction until commit.
   The fixture retains the actor profile, target chat, and private-chat peers.
   Actual bans/mutes/blocks and membership-topology mutations acquire matching
   sentinels with NOWAIT. OLD and NEW keys are covered for UPDATE/DELETE.

These additions revealed two compatibility defects in the candidate itself:

- A missing-parent refusal blocked legitimate profile/chat FK cascades. Only
  nested DELETE may proceed when its parent has already disappeared. Ordinary
  INSERT/UPDATE still require the sentinel and refuse a missing parent.
- `FOR UPDATE` conflicted with implicit FK KEY SHARE, introducing an actual
  waiting edge even though explicit acquisitions used NOWAIT. The mutator now
  uses `FOR NO KEY UPDATE NOWAIT`: it still conflicts with retained reader SHARE,
  but coexists with FK KEY SHARE. Both profile and chat FK directions are tested.

No authority is inferred from decorative roles. Human bans/mutes/blocks and bot
privacy remain their distinct existing contracts. A source-only or unrelated
actor must not be silently treated as the destination actor.

## Environment And Data Safety

The rehearsals used full fresh, checksum-verified automated backups and restored
roles plus the entire database, not reconstructed tables. All copies used the
running database's exact image:

```text
PostgreSQL 17.6 / supabase/postgres:17.6.1.136
sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00
```

Each disposable server container had network `none`, no ports/mounts, local socket
only, cron launch off, 1 GiB/1 CPU bounds and a verified unique owner/ID. Production
was queried read-only to pin the image, accepted writers and initial catalog.
The backup operation ran the existing owned backup script. No production SQL
mutation, object operation, provider request, account login or personal capture
was performed. Copied row values never appeared in output or reports.

Only fictional `e507...` users, chats, messages, sanctions and a registration
invite were exercised. Real registration/profile/membership triggers, RLS,
source visibility, topics and final message triggers remained enabled. The main
behavior/bootstrap run executes one transaction and rolls it back. Concurrency
setup commits only fictional rows and test definitions in the isolated copy;
individual sanction/member/block writers roll back their uncommitted changes.

Catalog/accounting fingerprints were checked across pristine bootstrap rollback.
For final mutation rehearsal, server-side SHA-256 multiset hashes additionally
covered **every ordinary table's copied rows in public/private/auth/storage**,
public/private/fixture function bodies and properties, and noninternal triggers.
No row contents were returned. These fingerprints matched before/after each
mutant and after the positive rerun; original policy/ACL/accounting fingerprints
were checked separately during restore and the initial behavior rehearsal.

All three exact owned containers were removed, including the exploratory copy.
Final ID/name absence and unchanged production database runtime were verified.
Backups and root-only receipts remain; no shared container/service was removed.

## Verification

| Gate | Actual result |
| --- | --- |
| Original repair with real schema, before extension | 13/15; private-block RPC and stale fallback assertions RED |
| Sanction retention before sentinel extension | 0/3; late ban/global-mute/target-mute assertions RED |
| First extended candidate with cascade cases | 15/17; legitimate profile/chat cascade assertions RED |
| Original sentinel strength | FK waiting-edge oracle RED on separate actual sessions |
| Complete behavior/bootstrap/cascade/missing-parent gate | 18/18; pristine bootstrap rollback and final preinstalled gate pass |
| Frozen concurrent gate | 19/19; three late sanctions, three real epoch waits, nine exact-mode refusals, three target/control cases and FK compatibility |
| Mutation gate | 11 executable variants / 15 exact expected failures; 18 positive cases before and 25 after; no unexpected selected failures |
| Old local gate | Reused 50/50 and 13/21 after checking all eight old frozen input hashes unchanged |
| Syntax | Three new JS files checked; no application-bundle change |

The waited bot cases observe the actual blocker/transaction-ID edge and granted
membership RowShareLock via `pg_locks` / `pg_blocking_pids`, then revoke supporting
reply, archive the target topic, or run the actual `chat_bot_set_privacy` prefix.
They require literal `P0002`/`42501` and absent new idempotent result. Exact READ
UNCOMMITTED, REPEATABLE READ and SERIALIZABLE each refuse `0A000` on the actual
send, forward and direct-fallback routes. No isolation mode is silently reset.

Nine fixture helpers are postgres-owned VOLATILE definers with empty search_path
and no anon/authenticated/service EXECUTE. All three client roles were also
actually refused when calling the private target helper. No schema/role grant or
RLS broadening was used to make tests pass.

### Executable Mutants

Compiled definitions/call sites or actual installed hooks are changed. Expected
values remain literals; each variant is restored before the next one.

| Mutation | Expected failed oracles |
| --- | --- |
| Remove actual private-block predicate | 1 |
| Drop direct-forward INSERT guard | 1 |
| Remove profile cascade exception | 1 |
| Remove chat cascade exception | 1 |
| Remove required missing-sentinel refusals | 1 |
| Grant authenticated EXECUTE on new helper | 1 |
| Restore stronger FK-conflicting sentinel locks | 1, actual waiting edge |
| Drop ban/mute hooks | 3 |
| Drop private-block retention hook | 1 |
| Drop membership-topology hook | 1 |
| Remove human target retention call | 3 |

Independent read-only review found the two candidate compatibility P2s above;
both were reproduced RED and corrected in one fix pass. The reviewer did not run
SQL/tests and its pre-fix source manifest is not advertised as review of the
final changes. Both workers are closed. The final execution/current manifests
below match; no runtime approval is inferred from source review.

### Rejected Harness Trials

Setup/transport failures were not counted as application RED or passing tests:
an imported helper recognized the old `prepare` argv; the fictional users needed
the real invite gate; chat creation already created owner membership; psql needed
a final semicolon for a compiled definition; pg_cron refused an alternative
database name; CREATE TEMP required occurring before the read-only fingerprint
transaction; an unqualified regclass name failed a restore target assertion.
The latter left an FK-lock mutant in the owned copy, recovered by the exact two
known compiled definitions before the complete successful mutation rerun.
After successful container removal, the cleanup verification used Docker's
wrong `.Id` formatter field; corrected `.ID` checks confirmed absence without
repeating deletion. None of these trials mutated production SQL.

## Frozen Inputs

SHA-256 shared by final race and mutation receipts, rechecked against working
files. Old accepted writer prosrc pins are still enforced by the original loader.

```text
54efa969b5fe3cef9c1bc7b47aa62c36c50931e1e7230cc70ccc1fd3f81c9000 tests/server/bot-media-authority-full-schema.fixture.mjs
a0c1d1ec8fe4aebc48895c7af4306b8720f5b580123a0724540011b1e8323355 tests/server/bot-media-authority-full-schema-repair.fixture.mjs
bd761952ff4c04522b162499c3f3f26f31973ddce30e8d88578341bad58f70a8 tests/server/bot-media-authority-full-schema-races.fixture.mjs
f1a43be87e252b77824b37875261ff2c194c549c1edbc83531ce240599fc9f9a tests/server/fixtures/bot-media-authority-full-schema-candidate.sql
ddc4981f4469e640da45969212d4383e44d2f99fc8fe2d6d8bab73bf160286d7 tests/server/fixtures/bot-media-authority-sanctions-candidate.sql
370e7ea7702cccc73b323d1697503e0fc5c2d5770459b8dc332409b88a852dc4 tests/server/bot-media-authority-repair.fixture.mjs
3425b2aaa962b67df0db2d7ac0524f39dbe15b528cf4b6249183bc4e0b34134c tests/server/fixtures/bot-media-authority-candidate.sql
ecb6ccbb23ab51cb63a2908146ac56b3c5eea64ba7bc763c3443422fcc252a84 tests/server/bot-media-coverage.fixture.mjs
```

Private receipt file hashes (receipts themselves are not committed):

```text
ea178ae598c210adedb768723f6ae9ef669e0b3df6c53db977c6ea15d5239463 frozen-mutations receipt
3446485689b415e24c4a37be4d9e79e9d2342d5e289c655f28f6776b1ae9fe77 frozen-races receipt
```

## Reproduction Boundary

The committed fixtures are transport-free: `runFullSchemaAuthority` takes
`exec/query`; concurrent oracles take separate `session` connections plus an
observer. `mutateFullSchemaRepair` exposes the bounded compiled mutants. They
must be invoked only after separately verifying a fresh full-schema disposable
copy, the accepted prosrc pins, ownership/isolation, backup and rollback path.
The `preinstalled` option is for the already seeded owned concurrency copy, not
for a live database. `baseline` and partial-repair comparisons are diagnostics,
not alternate passing acceptance modes.

This run's dated restore/socket/mutation/freeze operators and private receipts
remain under `.ops-private`; they are not generic credentials or a production
runner. Removed containers must not be blindly recreated under old receipt
paths. A new rehearsal needs a new verified owned copy and receipt namespace.

## Remaining Gates / Next Action

D-336/D-337 and item 78 remain open for runtime. The new locking is conservative:
it serializes relevant sanction/topology changes against a forward, with NOWAIT
refusal instead of a new wait. This availability cost has not been accepted for
production. The nested DELETE missing-parent exception proves these two cascades,
not every enclosing wrapper or deferred-FK/admin context.

Next: combine the unchanged whole-message coverage protocol with this candidate
in a fresh full-schema PG17 copy; exercise real nested/non-media callers,
savepoints and effective PostgREST role isolation/commit behavior. Then complete
gateway/outbox `55P03` retry semantics with unchanged client/idempotent identity,
fresh authority, atomic current refusal and no missing-RPC fallback. Preserve
earlier committed reservations/PUTs. Use the
[caller inventory](2026-10-03-bot-media-caller-isolation-inventory.md).

Attribution/preferences, every non-message holder, physical generation and
external-I/O remain separately open. No close/delete/refund, public Storage
cleanup, runtime migration, main deployment, native build/install/publication or
paid device use follows. Whole-chat-media purge hold, Android/native HOLD and
A063 exclusion remain. Previously applied identity/resolver/observer/hold SQL
must never be replayed.

PostgreSQL's [row-lock compatibility matrix](https://www.postgresql.org/docs/17/explicit-locking.html#LOCKING-ROWS)
and [trigger/cascade semantics](https://www.postgresql.org/docs/17/trigger-definition.html)
support the mechanics. They do not replace the measured application oracles or
establish production acceptance.
