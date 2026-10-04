# Restore Native Inventory: Selected Controls And Coverage

Date: 2026-10-04. Owner: Codex coordinator. Parent: point 5 of the
[restore/reference contract](2026-10-04-avatar-restore-next.md).
This is a selected same-copy prototype and coverage plan, **not** a complete
native inventory, production change or permission to dispatch R5.

## Observed Gap

The frozen full-copy helper's `metadataSql` does not collect constraints. Its
trigger query deliberately excludes `tgisinternal`. On separate fictional
PG18.4 databases, adding `inventory_value_check` changes no legacy metadata
record; disabling the two child-table internal foreign-key triggers also
changes no legacy record. Independent catalog counts are respectively 1 and 2.

These are omissions in that metadata projection. The existing complete DDL
comparison remains strict; this experiment does **not** establish that the
full restore operator would admit either damaged state.

The first runner invocation was invalid: Node interpreted a two-argument test
function as a callback while it returned a Promise. That setup failure is not
RED evidence. Corrected baseline queries then failed the literal capture
assertions, `0 !== 1` and `0 !== 2`, with cleanup verified.

## Implemented Scope

`tests/server/media-restore-native-inventory.fixture.mjs` supplies action-free
queries for user/extension-schema constraints and all their table/view triggers,
including internal triggers. Raw catalog rows, OIDs, generated names, nested
arrays, NULLs, definitions and constraint bindings remain intact. There is no
text/ACL normalization or production integration.

This deliberately uses same-copy identities. Restoring a database can change
OIDs and generated internal-trigger names; comparing these snapshots between
different copies is **not** an implemented cross-restore identity contract.

Initial local controls: **7/7**, no skips. Two real legacy omission cases,
unvalidated CHECK/changed constant cases, and four compiled query mutants:
missing CHECK, omitted internal triggers, forced validation and missing FK
column binding. Mutants must reach literal assertion failures, not SQL/import
errors. Same-copy catalog and schema-only DDL rollback are exact. Seven owned
directories and PostgreSQL PIDs were absent; synchronous native calls settled;
four source and five configured binary hashes matched before/after. Subsequent
independent review and final frozen evidence are recorded in the continuation
checkpoint; these initial counts are not cross-version acceptance.

PostgreSQL documents the constraint flags and bindings in
[PG17 `pg_constraint`](https://www.postgresql.org/docs/17/catalog-pg-constraint.html),
and internal/enabled trigger state in
[PG17 `pg_trigger`](https://www.postgresql.org/docs/17/catalog-pg-trigger.html).
PG18 adds relation NOT NULL constraints and further flags to
[`pg_constraint`](https://www.postgresql.org/docs/18/catalog-pg-constraint.html).
Retaining raw rows prevents this prototype from silently dropping those fields;
it does not prove PG17 execution or version compatibility of a future comparator.

## Closed Admission Coverage Plan

Every row below is required before full admission. A class absent from a dump
must be checked independently against live-before native authority. Equality
between two replay paths cannot excuse shared omission. An unclassified object,
dependency or unsupported expression must refuse; an empty capture is not proof
of absence until calibrated against known objects.

| Class | Existing evidence / limitation | Required independent comparison and negative control |
| --- | --- | --- |
| Source, backup and copy identities | Bounded receipt guard; fictional PG17 pair accepted | Persist inspected IDs before execution; bind live-before/after catalogs and verified backup, reject circular provenance and drift |
| Roles | Captured names and native OIDs; name-order helper being built separately | Preserve bootstrap/predefined identities and relative user rank; independently match attributes, membership/grantors/options and settings; reject extra/missing roles |
| Current ACL/default ACL | Typed capture and native order refusal exist | Cover all owners, grantors, scopes, f/r/S defaults, column rights, NULL/empty and nested ordinals; widened/missing rights or unrepresentable order refuse |
| Extension history | Separate initial/current ACL, version/config and membership diagnostics | Match historical `pg_init_privs`, extension membership and binary/setup inputs independently; current grants cannot stand in for initial privileges |
| Relations | Existing ACL/owner data; RLS/identity limited to selected ordinary tables | Include relation kinds, persistence/access method/options, partitioned and foreign tables, view definitions/security/options; missing kind or changed flags refuse |
| Columns and expressions | `information_schema.columns` in four schemas; active-column-hole-only projection | Bind native attributes/default/generated expressions, types/collations/identity flags and dependencies; only the explicitly allowed dropped-column projection may differ |
| Constraints | New same-copy raw prototype | Stable table/domain/index/parent/column/operator bindings plus validation/deferral/inheritance/action flags; missing CHECK/FK, changed constant/operator/binding refuse |
| Indexes and partitions | No independent complete capture | Keys/expressions/predicates/opclasses/collations/options, validity/ready/replica identity, bounds/inheritance/dependencies; omitted index or changed bound refuses |
| Policies | Existing limited-schema policy records and PG17 fictional controls | Native role order, command/permissiveness, USING/WITH CHECK and stable expression dependencies; extra PUBLIC/missing role or predicate changes refuse |
| Triggers and rules | New all-trigger same-copy prototype; rules not covered | Stable function/constraint/parent/column bindings, enabled/internal/arguments/transition tables and rewrite rules; disabled FK trigger or missing rule refuses |
| Routines | Definitions/selected flags for functions in four schemas; other kinds incomplete | All routine kinds, language/config/security/volatility/parallel/leakproof/strict/cost/support and argument/return bindings; changed flag/body or omitted procedure refuses |
| Types and related semantics | Existing type owner/ACL only | Domains/enum order/composites/ranges/multiranges plus operators/casts/opclasses/opfamilies/collations/conversions; binding/order changes or unknown kind refuse |
| Sequences | Existing relation ACL only | Native sequence parameters and ownership/identity dependency; copied state needs its own value/multiplicity evidence; changed increment/ownership or lost state refuses |
| Publications/subscriptions and event triggers | Not independently covered | Inventory definitions/options/membership/filter/security boundaries; restored subscriptions/event triggers must remain inert; unexpected class refuses |
| Other dumpable objects | No closed class registry | Include schema/database settings, large objects, foreign servers/wrappers/mappings, text-search objects, extended statistics and shared dependencies, or explicitly prove absence; redact secrets and refuse unsupported classes |
| Copied rows | Existing multiplicity/active-column projection contract retained | Full table membership and duplicate multiplicities; missing table/row or changed active binding refuses |

## Next Step And Boundaries

Freeze and independently review the role-name and selected-catalog delta. Then
build a version-bound stable native class registry/comparator and exact PG17
controls before wiring a fresh full reference/backup operator. Do not modify the
previous ten-input parser closure or turn its review into runtime authority.

D-338 and item 82/D-342 remain open. Backup plus supplemental live capture is
not backup-alone recovery. No production DDL, backup replay, new source-epoch
SQL, provider call, reclamation/refund, device minute or native release occurred
in this selected-inventory step. Existing HOLDs remain.
