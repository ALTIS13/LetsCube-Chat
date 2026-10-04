# Native Type Census: Source Checkpoint

Date: 2026-10-04. Owner: coordinator, candidate branch
`codex/bot-inline-media-20261002`, base `2403aa55`.
Implements Task1 of the [bounded plan](2026-10-04-avatar-type-census-plan.md).
Fresh public fixture/contract/test only; no operator wiring or migration.

## Observed Gap

The actual selected-only contract can accept an empty selected family while
standalone types were never enumerated. The desired enum/generated-array
common-loss oracle failed against that contract: **0/1**, exit1,
`Missing expected exception`, 93.9745ms. This is a supplied-input source
characterization, **not** a native omission count or evidence that the full
strict-DDL operator admits a corrupt restore.

Fresh queries enumerate every `pg_type` row in declared schemas, rather than
following tables or filtering type kinds. Generated arrays, composite/table
row types, domains, enum, range/multirange and shell types are not excluded.
Related `pg_enum`/`pg_range` rows are retained with exact column shape and
owning-type binding. These rows are diagnostics, not semantic comparators.

The exact [PG18.4 type definition](https://raw.githubusercontent.com/postgres/postgres/REL_18_4/src/include/catalog/pg_type.h)
defines seven kind codes and 32 fields; [enum](https://raw.githubusercontent.com/postgres/postgres/REL_18_4/src/include/catalog/pg_enum.h)
and [range](https://raw.githubusercontent.com/postgres/postgres/REL_18_4/src/include/catalog/pg_range.h)
carry 4 and 7 fields. PostgreSQL's
[native address implementation](https://raw.githubusercontent.com/postgres/postgres/REL_18_4/src/backend/catalog/objectaddress.c)
returns a type's single formatted name (arrays included), not schema/name
components. The source guard preserves this and checks namespace scope by
its own `{oid,nspname}` census. A missing schema cannot masquerade as empty.

## Source Behavior And Evidence

- Source membership is compared with EACH copy before the unsupported-payload
  refusal. A common loss or count-preserving identity swap refuses.
- Equal nonempty membership still refuses `unsupported-semantics`; enumerated
  type kinds and raw payload retention never grant semantic recovery approval.
- Only supplied empty existing scopes receive `type-census/v1`,
  `explicit-schema-only`, four false authority flags and the mandatory
  other-class/extension residuals. The caller's hashes/origin strings are
  consistency checks, not authenticated live/backup provenance.
- OIDs remain canonical uint32 decimal strings, local to each snapshot.
  Accessors never execute; malformed shapes, duplicate keys, wrong owners,
  scope/version/signature drift and unexpected adapters fail closed or retain
  their original error. Inputs are not mutated.

First focused GREEN was **62/62**, 131.5423ms. With query-input controls and six
compiled mutants, the changed and adjacent source suites pass **191/191**:
type69, routine51, CHECK30, selected41; exit0, fail/cancel/skip0, 230.3605ms.
Mutants remove source membership, unsupported semantics, missing-namespace and
enum/range-owner guards, or alter the accepted server version. Each makes an
independently literal refusal oracle RED; these are executed modules, not source
grep or assertions derived from the constant being mutated.

Command:

```powershell
node --test tests/server/media-restore-type-census.test.mjs tests/server/media-restore-routine-census.test.mjs tests/server/media-restore-check-roundtrip.test.mjs tests/server/media-restore-native-classes.test.mjs
```

Fresh-context independent review accepted all nine public source/document
inputs without P1/P2, rechecked primary definitions and repeated **191/191**.
Its 43 link checks (16 relative targets, 27 external URL syntax) pass. The exact
three source hashes are:

| Module | SHA256 |
| --- | --- |
| fixture | `76d02ab8e4cb30f61c4dccbaba051a5e5f2986f893413fb5fc7d182daf6832eb` |
| contract | `254a44fb2430c49e40ae8d917857188f4428b198f9c812d362e41439d4dcc844` |
| test | `0a679acbed666b407ce67dd4f9113d7a71548a8d23d5e8d26d0819febc5a9690` |

The final metadata delta records this accepted source review; the candidate
commit/remote SHA is retained in Git and the current private resume after the
exact-byte gate. No source code changed after review. Prior frozen routine/CHECK/
native evidence is retained unchanged and not replayed. Coordinator syntax3,
fresh-document links10 and protected pins7 pass; item82/D-342 stay open.

## Boundaries And Next Action

SQL queries have **not executed** in this stage. Supplied fictional fixtures
prove source behavior only; actual enum/array/range counts, header/type encoding,
quoted identifiers, native inverse calibration and query-filter omission
mutants require a NEW isolated owned native runner and separate dispatch review.
There is no new local cluster, remote action, production capture or paid device use.

PG17 stays `profile-unexecuted`. Its [exact prerequisites](2026-10-04-avatar-pg17-prerequisites.md)
are source guidance, not an installed runtime. After source review/commit, next
stage is the fresh PG18.4 native producer/controls/lifetime closure; then the
independently pinned PG17 compatibility setup. Never relabel PG18 payloads or
normalize native DDL/order/history to obtain GREEN.

D-342 / tracker item82 remain open. Strict full-DDL veto, full restore/R5,
production SQL/main deployment, native/Android release, media reclamation/refund
and historical stopped-directory HOLDs are unchanged. The retained broad unit
result 4948 pass / 1 Android cold-Gradle timeout / 13 optional is **not** whole-suite
GREEN; unchanged broad/native suites were not rerun for this action-free source slice.

Ruling: keep the existing single resume record instead of creating duplicate
scratch checkpoints; exact old proofs remain dated, not overwritten.
Ruling: focused and adjacent source verification follows the explicit reuse/HOLD
boundary instead of the skill's general whole-suite rerun. This costs no new
app/native verification; it also grants none.

## Reviewer Boundaries Retained

The coordinator accepts the reviewer's eight exclusions as **open work**, not
successful behavior. Each follows the source-only scope and existing HOLDs;
if interpreted as closed, the cost would be a false recovery/release claim.

| Excluded behavior | Ruling / next verification |
| --- | --- |
| Actual SQL counts/encoding/quoted names/inverse and query-filter mutants | Fresh owned native producer required; no source test substitutes. |
| Type/enum-order/range-subtype/array/composite/domain/ACL/default/shell/extension semantics | Nonempty family refuses; independent adapters remain open. |
| Authenticated live/backup/copy provenance and actual empty scope | Caller consistency is not authentication or absence. |
| Installed PG17/vendor/setup/history and security applicability | Exact source prerequisites only; native identity unexecuted. |
| Full-DDL/full restore/R5/backup-alone recovery/item82/D-342 | Strict veto/HOLD retained; no closure. |
| Old frozen routine/CHECK/selected evidence and historical RED timing | Reuse dated coordinator proof, not a new native review/replay. |
| App/runtime/Auth/provider/device/main/native release/cleanup/reclamation/refund | No changes or acceptance in this backend-source stage. |
| Whole suite/build and retained Android cold-Gradle failure | Dated non-GREEN remains; only four source suites ran. |
