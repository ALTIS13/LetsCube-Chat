# Native Type Census: Bounded Implementation

Date: 2026-10-04. Owner: coordinator. Base: `2403aa55a41ba94d260005e196ef17ebb63b352d`.
Branch: `codex/bot-inline-media-20261002`.
Continues the [frozen coverage plan](2026-10-04-avatar-class-coverage-next.md).
Routine and CHECK stages are complete; their frozen inputs are not edited/replayed.

## Contract

Fresh source-only files: `tests/server/media-restore-type-census.fixture.mjs`,
`media-restore-type-census.contract.mjs`, `media-restore-type-census.test.mjs`.
No operator/admission wiring. Queries return frozen `{header,namespaces,census}`.
`assertTypeCensus({profileId,liveBefore,reference,restored})` checks supplied raw
snapshots, not authenticated live/backup provenance. Snapshot fields:
`header,profileId,schemas,namespaces,captureId,origin,sourceReceiptSha256,census`.
Namespace rows are `{oid,nspname}`; each requested namespace must exist exactly
once. Census entries: `{local,address,roundtrip,formattedName,raw,enums,ranges}`.

Enumerate **all** `pg_type` rows in explicit schemas directly, including generated
arrays, table/composite row types, domains, shells, enum, range and multirange.
Do not filter by table reachability, typtype, extension membership or generation.
Retain complete `pg_type`, associated `pg_enum`, and associated `pg_range` rows.
These associated rows are shape/binding diagnostics, not semantic adapters.
Extension objects outside the explicit namespace list remain UNKNOWN.

Pin PG18.4 server/catalog versions and catalog field order from exact primary
definitions. A native type address has **one formatted name**, including arrays,
and no arguments; scope comes from the raw namespace OID and namespace census,
not by splitting the formatted name. Validate native inverse resolution.
OIDs are canonical decimal strings; no OID equality between independent copies.
Reject unknown profile/kind/shape, malformed input, duplicate native/local keys,
missing namespaces, inconsistent bindings, getter/cycle/provenance inputs.

After structural validation, compare source membership to each copy FIRST.
Common loss in both copies must refuse `live-membership`. Matching nonempty
membership always refuses `unsupported-semantics`, even when payloads match.
Only supplied exact empty scope returns `type-census/v1`, `explicit-schema-only`,
four false authority flags and residuals `all-other-native-classes` and
`extension-scope-open`. That receipt is not absence proof without a calibrated
native capture producer and must not be composed into full admission.

## Tasks

### Task 1: Source census/refusal

- [x] Write a literal common-loss oracle; run it against the actual selected-only
  contract first. Expected: Missing expected exception, not a missing import.
- [x] Implement fresh queries and contract; literal guards cover empty scope,
  every known type kind, generated names, count-preserving swaps, associated row
  bindings, malformed JSON, provenance and immutable evidence.
- [x] Compile real membership/unsupported/version/binding/missing-scope mutants;
  require independent literal oracles to fail. No mutation of frozen source.
- [x] Run changed source plus adjacent routine/CHECK/selected suites. No broad
  native/Android replay, and no claim of whole-suite GREEN.
- [x] Fresh-context source review; no P1/P2 found, independent191/191.
- Commit exact reviewed source/docs after stationary final metadata readback;
  record the resulting SHA/remote outcome in Git and the current private resume,
  not by rewriting this frozen pre-commit plan to insert its own commit hash.

### Task 2: PG17 prerequisites

- [x] Independent primary-source report for exact PG17.6 catalog/signature and
  NOT NULL model, separate runtime/bootstrap/extension/original-rank requirements.
- [x] Distinguish source documentation from unexecuted native profile. No
  runtime installation, image dispatch, global environment or live SQL changes.

## Review Focus

Direct scope omissions affecting both replay copies; generated-array/table-row
types silently filtered; missing namespace confused with empty schema; one-part
formatted native address mistaken for schema/name; OID coercion/collision;
enum/range rows attached to the wrong owner; matching sets admitting unimplemented
semantics; caller hashes mistaken for authentication; new profile inferred from
PG18. Narrow helper APIs must not execute arbitrary getters or mutate evidence.

Native dispatch is a **next separate stage**, after source review and a fresh
owned runner with calibrated actual counts, immutable raw receipts, bounded
child settlement and exact lifetime closure. Do not copy execution authority
from old sidecars. Actual SQL enumeration and compiled query-filter mutants
belong to that native stage; string construction tests are not native proof.
Strict full-DDL veto, full restore/R5, production SQL/main,
native release, media reclamation/refund and stopped-directory HOLDs remain.

Primary sources: [pg_type.h](https://raw.githubusercontent.com/postgres/postgres/REL_18_4/src/include/catalog/pg_type.h),
[pg_enum.h](https://raw.githubusercontent.com/postgres/postgres/REL_18_4/src/include/catalog/pg_enum.h),
[pg_range.h](https://raw.githubusercontent.com/postgres/postgres/REL_18_4/src/include/catalog/pg_range.h),
[objectaddress.c](https://raw.githubusercontent.com/postgres/postgres/REL_18_4/src/backend/catalog/objectaddress.c).
