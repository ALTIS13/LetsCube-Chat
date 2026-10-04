# Native Class Coverage: Next Bounded Plan

Date: 2026-10-04. Source checkpoint `c83ef8898bb16d20b8d9cd3f45441959c7a2fca1`,
branch `codex/bot-inline-media-20261002`. This slice writes only this report.
It continues the approved plan, not a new brainstorming or runtime approval round.

**Goal:** expose unenumerated native classes before widening selected acceptance.
**Architecture:** add fresh version-bound census/refusal sidecars; retain existing
raw captures, strict full-DDL equality and independently owned source authority.
**Tech stack:** action-free ESM/native catalogs; future local PG18 then owned PG17.
**Spec:** [restore/reference contract:37](2026-10-04-avatar-restore-next.md#independent-reference-contract)
and [coverage backlog:56](2026-10-04-avatar-native-inventory.md#closed-admission-coverage-plan).
Future execution follows executing-plans with assigned files, without delegation.

## Current Evidence And Coverage

Reuse the [accepted selected closure](2026-10-04-avatar-native-classes.md#evidence):
49/49 local controls, independently41/41 pure, ten final lifetime absence checks.
No tests were rerun here. The historical stopped-directory HOLD and immutable
failed/recovery-refused receipts remain; no retry or transfer of removal.

Key references: [census:30](../../tests/server/media-restore-native-classes.fixture.mjs#L30),
[records:50](../../tests/server/media-restore-native-classes.fixture.mjs#L50),
[incident bindings:68](../../tests/server/media-restore-native-classes.fixture.mjs#L68),
[projection:115](../../tests/server/media-restore-native-classes.contract.mjs#L115),
[live comparison/false authority:205](../../tests/server/media-restore-native-classes.contract.mjs#L205).
Raw retention, enumeration and semantic comparison are different coverage claims:

| Family | Selected-v1 coverage | Gap / exact refusal boundary |
| --- | --- | --- |
| Relations | Explicit-schema non-index roots; zero-constraint tables included. Ordinary r: persistence, RLS/force, replica identity, options, schema and incident owner bindings compared. | Other relation kinds, partitions/inheritance/typed relations refuse. Raw access-method/tablespace/physical fields are not full semantic comparison. |
| Columns | All positive slots including drops; active name/rank/type/collation, NOT NULL/storage/compression and selected flags; ordered vectors remapped. | Defaults/missing/generated/identity/inherited payloads refuse. No physical layout or complete type/default semantics. |
| Constraints | c/p/u/f and PG18 n; native definition, validation/enforcement/deferral/action flags, table/index/FK-column/operator bindings. | Domain/parent/inheritance/period/exclusion shapes refuse; only explicitly scoped constraints are enumerated. |
| Triggers | All scoped table triggers; named user definitions/WHEN/args; internal FK structural keys, enable-state and bindings. | Non-FK internal and unsupported parent/transition/argument shapes refuse; not arbitrary trigger-function dependency proof. |
| Indexes | Indexes of scoped roots; native definition, selected flags, active keys, opclasses/collations/options. | Expression/predicate/exclusion shapes refuse; partitions/access-method/opfamily implementation are not closed. |
| Defaults, policies, domains | `pg_attrdef`, `pg_policy`, domain `pg_type` rows are census sentinels. | They trigger `unsupported-class`; there are no matching semantic record adapters. This is detected unsupported presence, not coverage. |
| TOAST | Incoming dependency can reveal native TOAST addresses; raw root retains reltoastrelid. | Any TOAST endpoint refuses at contract:104. Dropped TEXT positive is not representable by v1; dropped INTEGER positive is not a production TEXT-table proof. |
| Standalone routines/types | Referenced proc/type addresses are anchors; selected routine deparse retained. | No standalone `pg_proc` census; non-domain `pg_type`, enum labels, range/composite/array semantics absent. Reachable address equality does not compare their full payloads. |
| Schemas/operators/collations | Selected binding addresses only. | No independent whole membership/payload census for these families, casts, conversions, AM/opclass/opfamily/AMOP/AMPROC/transform semantics. |
| Rules/partitions/sequences | Relation kind/relhasrules may cause refusal. | No independent `pg_rewrite`, inheritance/bounds or sequence-parameter/state adapter. Indirect refusal is not independent completeness. |
| Privileges/setup/history | Incident shared owner/ACL-role endpoints only. | Roles/material/settings, current/default/column ACL and historical extension privileges need their separate contracts; selected-v1 does not close them. |
| Other objects and data | Not enumerated as a complete family. | Replication/event/security objects, descriptions, large objects, foreign mappings, text search, statistics, extension members outside scope and copied-row multiplicities remain unclassified. |

Census and records use separate FROM clauses, but share scope and family filters.
Their agreement cannot detect a class omitted from BOTH enumerators. Unknown
**supplied** census/endpoint classes refuse; unknown objects outside the census
are not discovered. No dependency edge is evidence of complete class enumeration.
The [prior raw inventory:3](../../tests/server/media-restore-native-inventory.fixture.mjs#L3)
also filters system/TOAST/temp namespaces and is same-copy only. Neither query set
proves absence of extension members in an excluded namespace. The old private
plan `.ops-private/avatar-native-class-plan.md:194,224` remains a backlog, not an
audited closed catalog/component registry.

## Current Operator And Authority

Read-only source inspected: `.ops-private/avatar-epoch-full-copy.mjs`, SHA256
`7b61de995d848c7e4913bc11c2b7e2fe20f3f9b593253325723ca1b82a74ad70`.
Locations refer to source only, never its private inputs.

- Lines188-230: legacy metadata omits constraints/internal triggers; ordinary
  tables, policies, function bodies and information-schema columns are restricted
  to four schemas. Broader ACL inventory does not close native object semantics.
- Lines61-114: typed current/default ACL, roles/settings and initial-extension
  history capture exist. Lines128-157 selfcheck permissions+roles, not the selected
  class inventory or historical initial privileges. Lines322-326 have no explicit
  restored-vs-source initialPrivileges assertion; that capture remains diagnostic.
- Lines160-170: catalog samples and schema dump are sequential calls. Lines278-290
  check source identity/backup and whole snapshot drift; this is not a simultaneous
  catalog+dump snapshot or a demonstrated source-DDL ABA fence.
- Lines315-326: clone-only repair plan and metadata/roles/permissions comparisons
  precede strict `restored.ddl === before.ddl`. Selected-v1 is not wired here;
  its known gaps do NOT prove this operator admits a corrupt restore. Exact DDL
  and other checks may independently refuse it.

[Digest:54](../../tests/server/media-restore-native-classes.contract.mjs#L54) hashes
the supplied source; contract:211 requires labels/distinct capture IDs and matching
digest/scope. Relabelled, consistently rehashed replay data can still satisfy those
relations. Caller-origin strings/hashes are not authenticated live/backup provenance.
The stronger [reference receipt:61](../../tests/server/media-restore-reference.contract.mjs#L61)
binds before/after, backup/reference inputs and copy identities, but also consumes
caller-supplied hashes/check outcomes; its producer and mutation controls remain
essential. Its result explicitly leaves all other native classes unproven.

The frozen native runner `.ops-private/avatar-native-class-native.test.mjs:144-176`
uses plain BEGIN for multiple capture statements, a separate header and a separate
dump; three databases share one cluster. This is not independent-copy/concurrency
proof. Before/after equality cannot detect A->B->A; a future native capture fence
or explicit refusal is required. Repeatable-read is not a blanket DDL/deparser fence.

## Next Small Step

**Task 1: closed, scoped standalone-routine census/refusal.** Do not edit the frozen
selected modules or operator. Proposed fresh files only:
`tests/server/media-restore-routine-census.fixture.mjs`,
`tests/server/media-restore-routine-census.contract.mjs`,
`tests/server/media-restore-routine-census.test.mjs`,
`.ops-private/avatar-routine-census-native.test.mjs`; future evidence stays private.

Interfaces: `routineCensusQueries(profileId,schemas)` -> frozen `{header,census}`;
`assertRoutineCensus({profileId,liveBefore,reference,restored})` -> closed scoped
receipt or `routine_census_refused` with a literal reason. Snapshot fields exactly:
`header,profileId,schemas,captureId,origin,sourceReceiptSha256,census`; census rows
exactly `local,address,roundtrip,raw` using the existing native address triple and
decimal-string OIDs. Origins/IDs/source digest follow existing consistency rules,
not new authentication. Enumerate `pg_proc`
directly by declared schemas, independent of table reachability and record builders;
retain raw rows and native address/inverse results privately. Pin exact PG18.4
pg_proc column/signature shapes from primary-version definitions plus calibration,
never learn the accepted header from the subject. PG17 remains `profile-unexecuted`.
Known routine kinds f/p/a/w are enumerated, not semantically admitted. After shape
validation compare source membership FIRST; matching nonempty sets then refuse
`unsupported-semantics`. Empty family may return only `scope:'routine-census/v1',
coverage:'explicit-schema-only'`, all four authority flags false and mandatory
`all-other-native-classes,extension-scope-open` residuals. Do not compose this empty
receipt into full admission; it is calibrated absence only for this exact scope.

- [ ] RED: fresh fictional schema with one unreferenced function and one procedure;
  actual native source/reference/restore counts2/0/0 after both-copy omissions.
  The old selected-only observation can remain unchanged; desired membership oracle
  must fail from Missing expected rejection, not unsupported-class/startup/import.
  This characterizes a selected census gap, not an operator admission bypass.
- [ ] GREEN: new sidecar refuses that literal case `live-membership`; intact2/2/2
  refuses `unsupported-semantics`; calibrated0/0/0 returns only the literal scoped
  receipt. Rollback restores exact same-copy raw rows and native dump bytes.
- [ ] Pure/native omission controls: missing/duplicate census, same count but wrong
  native key, unknown kind/version/field, NULL inverse resolution, accessor zero
  calls; compiled omission of direct pg_proc enumeration/live comparison must RED.
  Independent query constants, not the subject's own counts, establish the oracle.
- [ ] Bound fresh PG work and retain primary adapter/SQL failures; persist identity
  before controls, unconditional exact-owned teardown and terminal jobs/PID/path
  evidence, source/binary pre/post pins. Never touch the historical held directory.

Later command, **not run here**: per-command `BOT_INGEST_PG_BIN` using the existing
configured runtime, then `node --test --test-concurrency=1
tests/server/media-restore-routine-census.test.mjs
.ops-private/avatar-routine-census-native.test.mjs`. No new dependencies or old suites.
Next census family after this independently testable step is native types/enum/range;
extension-outside-scope and the remaining coverage table cannot be silently cleared.
Future TOAST support separately needs literal wrong-parent/orphan/multiple-owner
and missing-internal-index refusals with native bindings. No generated-name stripping,
blanket edge exemption or physical-file/Storage-generation claim; v1 stays refused.

## Strict DDL And Representability

Keep the current full-DDL veto unchanged. Native bootstrap/setup alignment may make
some raw ACL/order/dump states representable; original-rank name-only planning does
not prove role attributes/material or historical extension baseline. Unrepresentable
native order/history remains refusal; no catalog writes, sorting or text rewriting.

**Task 2: one diagnostic CHECK roundtrip slice**, separate from admission. Proposed
fresh `tests/server/media-restore-check-roundtrip.fixture.mjs` and
`.ops-private/avatar-check-roundtrip-native.test.mjs`. With fictional INTEGER holes,
native dump/replay twice; retain exact source/reference1/reference2 bytes and raw
catalogs. Classify byte-exact source representability versus refusal; no stripping
parentheses, generated names, role order, ACL blocks or pg_node_tree text.

- [ ] Positive: known CHECK constant0/operator>= and supported bindings survive;
  reference1/reference2 dump equality is measured, not assumed. Same-copy rollback
  remains byte-exact. A converged dump is not proof it equals source authority.
- [ ] Negatives: change constant to1 or operator to>, drop CHECK from both subjects,
  change validated/column binding, or give reference backup/replayed origin. Each
  must hit an independent literal source oracle; if an earlier representability
  refusal prevents reaching it, split the diagnostic from the mutation case.
- [ ] If source raw DDL differs even while native projections converge, retain
  strict operator REFUSED. Report the exact compared endpoints and unclosed classes;
  do not call semantic equivalence, full recovery or production acceptance.

Parent contract:48 permits a future **exact reference-vs-restore** comparison only
after independent provenance, closed native classes, privileges/history, copied
rows and native controls close. That is a different reference endpoint, not a
semantic-normalization loophole. No operator comparison changes in Tasks1/2.

**PG17 handoff:** future fresh profile/fixture, exact separately owned image/binaries/
extensions/bootstrap and original-rank evidence. Pin its actual catalog shapes and
NOT NULL model; do not relabel PG18 n/conenforced/conperiod payloads or reuse its
catalog version. Reproduce the source-membership and representability mutants on
PG17 before wiring. Unclassified classes and unknown versions continue refusing.

## Review Focus And Handoff

Review common loss in both enumeration paths (Task1 RED), count-preserving key swaps
(Task1 mutations), unsupported semantics hidden by equal sets (Task1 intact case),
parser convergence mistaken for source proof (Task2), and lost primary/cleanup
failures (Task1 lifecycle). Remaining provenance/race, TOAST, full type/operator/
extension and copied-data adapters stay explicitly open, not inferred from these tasks.
Uninspected/non-enumerated families have no proved counts or absence: UNKNOWN
means REFUSE for full admission, not an invented successful coverage entry.

This planning slice performs source reads and document validation only: zero tests,
native/SQL/remote/R5/provider/device actions, no cleanup retry, stage/commit/push.
Old frozen files/reports and coordinator shared docs are unchanged by this owner.
Full restore, backup-alone recovery, D-338/D-342 closure, production SQL/main/native
publication and reclamation/refund authority remain unchanged. Next action is the
bounded Task1 implementation under its file assignment, not full restore dispatch.

Checkpoint: source/design complete. Validation:11 relative links/line anchors resolve,
zero trailing whitespace; all10 inspected source/spec hashes unchanged on readback.
Only this new report was written; no fresh execution or frozen-evidence updates.
