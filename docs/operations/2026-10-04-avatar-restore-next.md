# Avatar Restore Acceptance: Next Bounded Proof

Date: 2026-10-04. Owner: Codex coordinator. D-338 prerequisite, with the separate
item 82 / D-342 backup-recovery risk. This is the next acceptance contract, NOT
an implemented reference operator, admitted PG17 copy or production migration.
Reuse the accepted [source observer and R4 evidence](2026-10-04-avatar-source-observation.md).

## Why The Existing Gate Stays Closed

R4 reaches exact typed current object-ACL and role/settings hashes after
clone-only reconstruction, but refuses 21 default-ACL array order differences
omitted from that inner inventory. Its complete DDL remains unequal. All exact
owned copies are absent; backups remain. No epoch SQL was applied.

The new capture includes typed default privileges in the native pre-COMMIT hash,
and separately captures historical extension initial privileges, extension
versions/configuration and stable membership/object/column addresses. The local
`pg_stat_statements` 1.12 control distinguishes a changed current SELECT grant
from unchanged initial privileges. This is PG18.4 fixture evidence, not proof
about the deployed PG17 extensions. PostgreSQL records extension initial grants
separately in [pg_init_privs](https://www.postgresql.org/docs/17/catalog-pg-init-privs.html).

Actual local PostgreSQL controls also show that default ACL reconstruction cannot
generally choose array order by issuing grants in a chosen sequence: native
role-OID ordering can make the captured ordinal unrepresentable in another
bootstrap. The separated native preflight then raises before any repair mutation.
Do not edit system catalogs,
sort away source order, recreate production roles or claim arbitrary native
reconstruction. [ALTER DEFAULT PRIVILEGES](https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html)
affects future objects; global and schema-scoped defaults are distinct scopes.

Parenthesis-only CHECK text, a policy role permutation and added schema-ACL dump
blocks are diagnostic observations, not proven harmless changes. Their proposed
parse/deparse, role-order and historical extension-baseline causes still require
native PG17 reproduction. Keep the strict refusal until those controls exist.

## Independent Reference Contract

1. Capture immutable live-before complete schema DDL and native catalogs,
   with hashes/provenance before and after the verified backup. A reference made
   from the backup or restored-copy DDL is circular and must fail a mutant.
2. Use separately identified, exact-owner same-image copies for the live-DDL
   reference and backup restore. Each has network none, no ports/mounts and cron
   off. Verify binaries, role-bootstrap and extension setup, not just image tags.
   Capture native role ordering before choosing any clone-only bootstrap change;
   prove source default order representable or refuse. Role attributes,
   memberships, grants and settings must still match independently.
3. PostgreSQL replays the live-before schema into the reference. Its parser, not
   a string rewriter, handles expressions. Exact reference-vs-restored DDL may
   replace ONLY the cross-restore comparison with the live dump after the controls
   below pass. Same-copy installed-state and rollback DDL remain byte-exact.
4. Current typed ACL/default ACL/settings remain independent source authority:
   owner, grantor, scope, privilege, option, NULL/empty and nested order survive.
   Initial extension privileges and membership/version are checked separately;
   same image does not prove the same historical baseline. Never rewrite
   `pg_init_privs` merely to make textual dumps match.
5. Close the native class inventory: constraints and flags/dependencies, column
   expressions, indexes/partitions, policies, triggers/rules, routines/types,
   sequences and extension membership. Unknown classes, unsupported expressions
   or common loss from both replay paths must refuse. Preserve complete copied
   row multiplicities and the existing active-column-hole-only projection.

If historical initial privileges differ, whole-catalog fidelity remains unproven.
A narrower parser-roundtrip result must say exactly what differs; it cannot close
D-342 or silently expand migration/reclamation authority.

## Required Native Controls

- On the exact PG17 image, reproduce CHECK roundtrip including dropped-column
  holes. Changed operator/constant, missing CHECK, validation/deferrability or
  binding changes must independently fail.
- Reproduce policy role ordering under different role bootstrap. Missing role,
  added PUBLIC and changed USING/WITH CHECK must fail.
- Cover default `f/r/S`, global/schema scope, original grantors/options and native
  ordinals. Missing scope, widened rights and unrepresentable order must fail.
- Reproduce initial/current extension-ACL differences for the actual installed
  extensions and the additional dump blocks. Neither current grants nor a dump
  hash substitutes for historical native records.
- Mutate reference provenance, setup and asserted outcomes. Exercise lost ACK,
  assertion and diagnostic failures with exact cleanup of BOTH copies. Retain
  backups; independently verify copy ID/name absence and production identity.

Freeze all inputs before the final finite run, obtain independent exact-byte
review, then prepare a fresh non-reused copy namespace. A known-refusing R5 is
not rerun speculatively. No production DDL/rows, provider upload, deletion/refund,
native release, paid device minute or account mutation is part of this proof.

## Continuation

Final frozen local controls are **80/80** with 14 source/19 configured binary and
extension-input pins unchanged. R5 dispatch stays closed; local source acceptance
does not approve the reference operator or copied-PG17 preparation above.

After this gate passes, run the existing full-schema source-observer rehearsal,
including real Auth bootstrap/setters, role denials and exact rollback. Then
continue [durable admission and atomic publication](2026-10-03-avatar-source-epoch-next.md).
The source observer's 45/45 and D-339 rollout evidence remain reusable; neither
is a substitute for this gate. Backup PLUS supplemental live capture remains
distinct from independently recoverable backup-alone state under D-342.
