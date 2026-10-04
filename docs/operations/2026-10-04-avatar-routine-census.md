# Standalone Routine Census

Date: 2026-10-04. Owner: Codex, branch `codex/bot-inline-media-20261002`.
Base: `8edfd6b886daa89e015dbe831244e0ba8433475f`. Candidate only.
Stage: public source, v2 guard-source and frozen local-evidence peer reviews
accepted. Fresh v2 final calibration **109/109** and coordinator readback passed.
No full recovery or production acceptance.
Source commit: `98ad9be9c718423748cfbfa8662c75303751bb59` (candidate only).

## Cause And Scope

The frozen selected-class census does not enumerate standalone `pg_proc` rows.
Agreement between two selected replay observations cannot reveal routines missing
from both. This is a selected coverage gap, **not** a demonstrated bypass of the
full restore operator: its strict DDL comparison is separate and unchanged.

Task1 of the [coverage plan](2026-10-04-avatar-class-coverage-next.md#next-small-step)
adds three independent files: [query builder](../../tests/server/media-restore-routine-census.fixture.mjs),
[refusal contract](../../tests/server/media-restore-routine-census.contract.mjs),
and [literal controls](../../tests/server/media-restore-routine-census.test.mjs).
There is no production import, schema migration, operator wiring or dependency.
Old selected modules, runners and frozen evidence are not edited or replayed.

The query enumerates `pg_proc` directly by declared schemas, independently of
table reachability. Each captured row retains its local decimal-string OID,
native name/argument address, native inverse-resolution result, and raw catalog
fields. The accepted PG18.4 shape is fixed from the versioned primary sources,
not learned from the capture:
[pg_proc.h](https://raw.githubusercontent.com/postgres/postgres/REL_18_4/src/include/catalog/pg_proc.h),
[catalog version](https://raw.githubusercontent.com/postgres/postgres/REL_18_4/src/include/catalog/catversion.h),
and [address function signatures](https://raw.githubusercontent.com/postgres/postgres/REL_18_4/src/include/catalog/pg_proc.dat).

## Contract

Shape, version, scope and capture consistency are validated first. Native member
keys of **each** subject must then match the source, before the nonempty-family
refusal. Common loss and count-preserving identity changes refuse
`routine_census_refused:live-membership`. Intact nonempty families, including
functions, procedures, aggregates and window functions, refuse
`routine_census_refused:unsupported-semantics`. Enumeration does not implement
language/body/default/privilege/dependency semantics.

Only an empty supplied family can return this frozen scoped receipt:

```json
{"scope":"routine-census/v1","coverage":"explicit-schema-only","fullRestoreApproved":false,"pg17Accepted":false,"runtimeApproved":false,"productionApproved":false,"residuals":["all-other-native-classes","extension-scope-open"]}
```

The receipt is not authenticated absence or full recovery approval. Origin labels,
unique capture IDs and the canonical source digest provide consistency, not trusted
live/backup provenance. Excluded schemas, extensions, concurrent DDL/ABA, routine
payloads, other native classes and copied data remain unproved. PG17.6 is explicitly
`profile-unexecuted`. The old strict full-DDL comparison remains mandatory.

## Evidence

Pure characterization: `ROUTINE_CENSUS_BASELINE=1` runs the actual old selected-only
contract with its empty selected observation; the desired routine refusal is RED
with **Missing expected exception**, not an import/startup/unsupported-class error.
This pure test does not establish actual catalog counts; the native sidecar must
calibrate the unreferenced function/procedure source2/reference0/restored0 case.

New pure controls: **51/51**, zero skips/failures. Literal source-membership,
same-count wrong-key, duplicate local/native keys, profile/header/raw-field drift,
NULL/false inverse resolution, scope/origin/digest drift and accessor-zero-call
oracles pass. Four compiled mutations break independent literal refusal oracles:
membership comparison, duplicate rejection, unsupported-semantics refusal and
the server-version literal. Raw inputs remain unchanged.

Independent public review reran **51/51** with no P1/P2; all three source pins and
the specification pin matched. The exact three reviewed files were committed
with index/committed-byte readback; no unrelated file rode into that commit.

Fresh local PG18.4 final run: **63/63** (51 pure + 12 native), zero failures/skips/
cancellations, 52.414744 seconds. Native baseline independently observed source2/
reference0/restored0, while the actual old selected observation remained empty;
the desired refusal failed with **Missing expected exception**. New direct
enumeration refuses this common loss before unsupported semantics. Intact native
function/procedure counts2/2/2 refuse semantics; additional actual aggregate and
WINDOW rows give4/4/4 and remain refused. No routines are invoked.

Empty calibration is actual **0/0/0**, not relabelled copies: source routines are
dropped within BEGIN/ROLLBACK, and each copy is independently counted/captured.
Three unique capture IDs/origins are retained. Source returns to2, with exact raw
rows and native dump bytes after rollback. These sequential fictional observations
are not a concurrent-DDL or authenticated producer fence.

Actual count-preserving rename and common loss refuse. Compiled direct-query
omission yields captured0 despite independent native count2; the literal count
oracle fails. Removing live comparison yields the wrong `unsupported-semantics`
reason; the literal `live-membership` oracle fails. Native tests preserve primary
SQLSTATE/message alongside log/journal failures and settle active SQL on teardown.

Final six fresh lifetimes have exact owned PID/path absence and jobs0. Coordinator
independently reread the final journal/manifest and all six source/five binary pins,
including actual counts2/0/0 and0/0/0. Historical stopped-directory HOLD is untouched.
Independent native review found an unbounded post-timeout settlement path and a
final manifest that does not itself require the complete control/lifetime set.
The successful original run proves its observed controls, not those missing
guards. A new v2 runner corrects both; the original runner, journal and final
manifest stay frozen and are not rerun. Prior whole-unit
evidence remains 4948 pass / one unchanged Android
cold-Gradle timeout /13 optional skips, not whole-suite GREEN.

V2 source baseline is actual **0/2 RED**, compiling only the frozen command/gate
against fictional child/timer adapters: deadline stays pending and empty final
sets are accepted. New **46/46** source controls kill four compiled mutants,
including early job deletion and unbounded settlement. Tests also compile the
actual new cleanup/after-hook and require zero removals/writes for retained jobs
or incomplete sets. These modeled controls are not real native fault proof.

An independent stationary eight-source peer review found no P1/P2. V2 keeps
jobs until actual CLOSE, bounds result/diagnostic/settlement separately, preserves
primary and cleanup errors, and refuses removal with unconfirmed jobs. Final
acceptance requires the literal unique twelve controls and six lifetime labels;
filtered runs cannot emit a final manifest. These are specific process guards,
not a universal OS/filesystem/descendant deadline guarantee.

Fresh v2 final **109/109** (51 public + 46 guards + 12 native), zero failures/
cancellations/skips, 54.022668 seconds. Coordinator independently verified its
frozen manifest/journal, eight source/five binary/four protected-original pins,
all twelve control names, actual2/0/0 and0/0/0 counts and six exact owned PID/path
absence/jobs0 closures. Independent frozen native-evidence review matched all
source/binary/protected pins, twelve control names, six ordered lifetime receipts,
native counts and literal error/rollback evidence, with no P1/P2. The reviewer
performed no new native execution; exact PID absence was independently probed by
the coordinator. All authority flags remain false; no old or historical held
target was replayed.

## Next

Task1's scoped source/local-evidence step is complete. [Task2 CHECK diagnostic](2026-10-04-avatar-check-roundtrip.md)
has fresh native 8/8, coordinator readback and independent source/frozen-evidence
reviews with no P1/P2. No operator/admission contract is changed. Continue exact PG17/native-type
prerequisites. Full restore/R5, production SQL, main deployment,
native publication and reclamation/refund authority remain unchanged.
