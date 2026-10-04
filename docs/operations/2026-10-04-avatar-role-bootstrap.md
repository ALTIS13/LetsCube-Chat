# Restore Role-name Bootstrap: Original Native Rank

Date: 2026-10-04. Owner: Codex coordinator, implementation by Aristotle.
Parent: point 2 of the [restore/reference gate](2026-10-04-avatar-restore-next.md).
This is an action-free name planner/validator, not full role restoration or
permission to dispatch R5, replay a production backup or apply source-epoch SQL.

## Observed Native Difference

On fictional local PG18.4, creating the same user names alphabetically instead
of their captured native OID rank changes raw default ACL ordinals. The control
covers schema-scoped functions, tables and sequences, plus global table defaults.
The existing schema-default preflight correctly refuses the incompatible order
with actual `psql` exit 3 and exact `P0001`/default-order primary. Its installed
default records remain unchanged. A separate raw equality oracle goes RED.

Creating names serially in source rank on another fresh cluster preserves those
four raw/typed default records, even with independently different absolute user
OIDs. This counterexample is not proof of the cause of every 21 live R4 deltas.

The supplemental read-only live role projection already showed bootstrap OID 10
as `supabase_admin`, matching the old operator. Renaming bootstrap to `postgres`
would not fix that observation. In the native control, `postgres` is deliberately
a later normal role, preventing a hard-coded bootstrap-name assumption.

## Implementation

`tests/server/media-restore-role-order.contract.mjs` exports:

- `planRoleNameBootstrap({ source, pristine, bootstrapName })`: serial safely
  quoted `CREATE ROLE` statements for captured user names only.
- `validateRoleNameBootstrap({ source, pristine, bootstrapName, restored })`:
  exact complete name set, fixed identities and relative native rank.

Both are action-free and explicitly return `role-name-order-only`, with
`fullRestoreApproved`, `runtimeApproved` and `productionApproved` all false.
Nothing imports them into a release/production operator.

Input is a dense ascending array of exact `{ oid, name }` records, numeric
positive uint32 OIDs, unique names/OIDs, no coercion or extra/accessor fields.
Captured bootstrap name and predefined native identities must match the
independently supplied pristine inventory. Preexisting user/QA roles refuse.
Normal absolute OIDs may differ after serial creation; relative name rank may not.

Quoted identifiers preserve punctuation and Unicode. Empty/NUL, malformed UTF8
identity, more than 63 bytes and reserved normal-role `pg_` names refuse. The
16384 allocator boundary comes from
[PG17.6 `FirstNormalObjectId`](https://github.com/postgres/postgres/blob/REL_17_6/src/include/access/transam.h),
not guessed role chronology. Reserved names are checked against the
[PG17.6 role implementation](https://github.com/postgres/postgres/blob/REL_17_6/src/backend/commands/user.c).

## Verification

Implementation run: **51/51**, no skips: 50 unit tests including ten compiled
mutants, and one actual PG18.4 case with 14 internal checks. The coordinator
also ran the 50 unit tests independently, all passed. Literal oracles cover
bootstrap/rank/fixed inventory, allocator and byte boundaries, quoting, and each
false authority flag. RED uses a permissive baseline and an actual legacy clone,
not missing imports. An initial aliased test seed was corrected without loosening
the implementation contract.

The native case verifies exact raw defaults, wrong rank/unknown/missing/extra
roles, an actual extra-QA-role transaction and exact rollback. Known fictional
harness seed roles are removed only inside inspected disposable servers to
obtain a pristine inventory; this is not a source/production cleanup strategy.

Five initial RED/GREEN directories and PostgreSQL PIDs are absent, inspected
identities persisted before work, jobs zero. Three new sources, five configured
binaries and the previous parser/R5 closures match before/after hashes. No old
suite was rerun. Independent delta review is required before candidate publication;
the continuation checkpoint records its result.

## Remaining Work

The outer producer still owns source/backup/image provenance and genuine pristine
capture. Attributes/password material, membership/grantors/options/settings,
historical extension baseline, stable class completeness and exact PG17 execution
of this new helper are not proved here. Name rank is not full recovery.

Continue with the [native inventory coverage](2026-10-04-avatar-native-inventory.md)
and a version-bound stable comparator before a fresh complete-reference operator.
Keep same-copy DDL and rollback byte-exact; never sort away nested ACL order or
write system catalogs. D-338/D-342 and existing production/native/reclamation
HOLDs remain open. No device minutes or production changes in this step.
