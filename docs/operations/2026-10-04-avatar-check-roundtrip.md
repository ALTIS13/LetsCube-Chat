# CHECK Roundtrip Diagnostic

Date: 2026-10-04. Owner: Codex coordinator and a bounded diagnostic worker.
Branch: `codex/bot-inline-media-20261002`. Candidate-only independent Task2 of the
[coverage plan](2026-10-04-avatar-class-coverage-next.md#strict-ddl-and-representability).
Stage: public 30/30, private source 21/21 and fresh native 8/8 passed. Coordinator
frozen evidence/identity readback and independent source/final reviews accepted,
with no P1/P2. Source commit `4a823f9ea45e36225cfdd802a42dd0a0b56341ee`.
No old runner or full restore operator is run.

## Exact Question

Can one fictional INTEGER CHECK and its native bindings survive two PostgreSQL
dump/replay steps with dropped-column holes, and are the actual dump endpoints
byte-identical? Keep these two questions separate. Agreement of reference1 with
reference2 is parser convergence, not evidence that either equals the source.

New [fixture/diagnostic](../../tests/server/media-restore-check-roundtrip.fixture.mjs)
and [literal controls](../../tests/server/media-restore-check-roundtrip.test.mjs)
retain raw attributes/constraints, dropped slots, native addresses/inverse
resolution, constraint definition and dependencies. Their narrow projection
does not rewrite raw `pg_node_tree`, native ordinals, dump bytes, role/ACL order,
generated names or parentheses. The old complete-DDL veto is unchanged.

The fictional case is `quantity >= 0`, with INTEGER slots1/4 dropped. Active
columns are id/quantity/alternate; source quantity slot3 may become slot2 in the
parser replay. Binding must resolve to the native quantity column, not merely
the same physical number. Additional native classes, physical layout and copied
data are not admitted by this diagnostic.

## Required Evidence

Native source/reference1/reference2 dump bytes must be captured privately before
classification. Source-vs-reference and reference-vs-reference outcomes are
separate. Any source byte inequality keeps `strictOperator:REFUSED`; byte equality
is `BYTE_EXACT_DIAGNOSTIC_ONLY`, never full restore approval.

Independent literal controls change the CHECK constant/operator, remove it from
both reference subjects, change validation or column binding, and relabel a
reference as backup/replayed origin. They must reach their own refusal oracle
even when the separate dump comparison is already refused. Origin IDs/digests
provide consistency only, not authenticated provenance.

Final source/binary pins, native counts, exact same-copy raw/dump rollback,
fresh owned PID/path absence, settled jobs and preserved primary+cleanup errors
are required before this stage is accepted. Coordinator independently ran the
new public controls: **30/30**, zero failures/cancellations/skips, 133.515ms.
Literal object OID and precise common-loss mutant corrections are included.

The fresh runner corrects bounded child settlement, environment isolation,
actual pending-SQL observation, unrelated-row rollback and joint terminal-journal/
primary-error retention. Private Node-child/source controls passed 19/19, then
21/21 after a narrowly scoped Windows filename correction. They do not themselves
establish PostgreSQL behavior.

The first native baseline failed: seven cases passed and the roundtrip plus final
after hook failed, 45.3751554 seconds. Primary failure was opening the Windows-
invalid `roundtrip-operator>-raw.json`, not a diagnostic refusal. The final pointer
was correctly absent. All seven exact owned PID/path closures and jobs0 were
independently verified; the failed source snapshot, report, journal and raw
artifacts remain immutable in their private run namespace. The revision changes
only that known artifact name to `operator-gt`, leaving the control name, SQL
expression and dump/raw bytes unchanged. Literal filename RED 0/1, GREEN 2/2 and
the compiled unsafe-name mutant prove this correction; coordinator independently
reran the changed 2/2 controls.

Fresh final local PG18.4 run: **8/8**, zero failures/cancellations/skips,
50.8105418 seconds; run `0a778f3c-ad90-491e-adca-876a7dc2c1ab`. Its immutable
final manifest records eight exact test names, 24 unique controls, 7 exact owned
lifetimes, three source/five binary/Node pre/post pins and the reviewed source
manifest. Coordinator readback matched all pins, 142 child starts/terminals,
actual inspected cluster/database/session identities and exact current PID/path
absence/jobs0. The active pending connection was independently observed as
`Timeout/PgSleep` before its assertion-failure control.

The native positive has one table and one CHECK in each database. Source has
five attribute slots including dropped 1/4; both references have three active
slots. The quantity binding is native slot 3/2/2, not a physical-slot equality
claim. Same-copy raw/dump rollback is exact, and the unrelated fictional row
returns from counter999 inside each mutation to counter71 afterwards.

Both independently compared endpoints are **byte-equal**: SOURCE_vs_REF1 and
REF1_vs_REF2, each 1263 bytes. This one case is `BYTE_EXACT_DIAGNOSTIC_ONLY`, not just parser
convergence and not full recovery. The dump classifier still refuses unequal
source bytes. Constant1, operator>, common CHECK loss 1/0/0, validation, column
binding and origin controls reached their own literal oracles; compiled query
omission captures 0 while an independent native count is 1. Actual SQLSTATE22012/
`division by zero` survived both cleanup-journal and terminal-journal faults.
Independent frozen final review matched exact source/binary/Node pins, all eight
cases/24 controls/seven lifetimes, 142 paired starts/terminals and 284 retained
stdout/stderr artifact pins. Inspected identities, literal mutations, dump bytes,
unrelated-row receipts and joint primary/journal faults agree, with no P1/P2.
The reviewer ran no tests/native processes; coordinator supplied direct execution
and actual PID absence. No frozen or failed evidence was rewritten.

## Next

Task2's scoped source/local-evidence step is complete on the candidate branch.
Continue separately version-bound PG17 and native-type coverage; these
diagnostics do not authorize full restore dispatch or operator wiring.

## Boundary

Scope is one fictional PG18.4 INTEGER CHECK. PG17 is explicitly unexecuted, and
fullRestoreApproved/pg17Accepted/runtimeApproved/productionApproved remain false.
There is no production SQL, operator wiring, R5 dispatch, deployment, native
release, provider/media action or paid device usage. Existing full recovery,
extension/history/type/operator/provenance and reclamation HOLDs remain open.
