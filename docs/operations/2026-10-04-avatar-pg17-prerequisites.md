# PG17 Restore Census: Exact Prerequisites

Date: 2026-10-04. Owner: independent source-only sidecar; the coordinator owns
future PG17 execution and setup evidence. Parent owns the separate PG18 type
census/refusal implementation. This document does not implement that work.

Resume: source shape verified; proposed `pg17.6` profile remains unexecuted.
Blocker: no newly verified PG17 image/binary/bootstrap/extension closure or native
profile controls in this slice. Next action: coordinator assigns fresh PG17
profile files and an exact-owned fictional runner after obtaining those inputs.
No dispatch or installation is authorized by this report.

The [active checkpoint](../HANDOVER.md#L25) closes the accepted PG18 routine and
CHECK diagnostic slices. Reuse their evidence; do not reopen their runners.
The [frozen plan's PG17 handoff](2026-10-04-avatar-class-coverage-next.md#L173)
and [independent reference contract](2026-10-04-avatar-restore-next.md#L37)
remain the governing boundaries. Full restoration, D-342/item82 and all HOLDs
stay open; strict full-DDL equality is unchanged.

## Official Source, Not Installed State

The exact upstream tag is `REL_17_6`, not the moving `REL_17_STABLE` branch.
[configure.ac:19](https://github.com/postgres/postgres/blob/REL_17_6/configure.ac#L19)
declares 17.6; its [numeric version construction](https://github.com/postgres/postgres/blob/REL_17_6/configure.ac#L2253)
gives the proposed machine-version expectation `170006`.
[catversion.h:59](https://github.com/postgres/postgres/blob/REL_17_6/src/include/catalog/catversion.h#L59)
defines `CATALOG_VERSION_NO=202406281`. These are source expectations, not a
measurement of any installed server. A vendor build also needs its own binary
and patch provenance; version text/catalog version alone cannot identify it.

Future header calibration must observe `server_version_num` and
`pg_control_system().catalog_version_no`, exact ordered positive catalog
attributes, their native types, and the two function signatures below. Unknown
minor versions, extra/missing/reordered fields or unknown function overloads
refuse; never learn the allowed header from the subject. The control functions
are documented in [PG17 system information](https://www.postgresql.org/docs/17/functions-info.html).

### Dated Security And Compatibility Boundary

Verified 2026-10-04: the official
[Supabase announcement dated 2026-09-25](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes)
describes rollout from 17.6 to 17.11 with security fixes. Recreating custom
operators with non-built-in selectivity estimators now requires superuser;
existing operators continuing to work does not prove dump/restore compatibility.
It also identifies independent `ltree`, `btree_gist` and `pgcrypto` compatibility
checks. No detection, reindex, decryption, upgrade or SQL action was performed or
authorized here; applicability to our self-hosted deployment remains UNKNOWN.

`REL_17_6` remains ONLY the exact historical/current-proposed recovery profile,
not a recommended fresh production deployment. Actual self-hosted version and
vendor patch state are UNKNOWN without fresh inspection. The next safe native
environment must have a pinned known-identity profile matching its intended source;
never retag 17.11 as 17.6 or assume these historical shapes admit another build.
Operator/extension/security compatibility is a separate gate, not permission to
broaden roles, remove estimators or alter extension state to force a restore pass.
The version-specific checklist below describes the proposed REL_17_6 profile only.

### Exact Catalog Shapes

The following ordered `name:SQL-type` manifests transcribe the tagged catalog
definitions, including variable-length attributes. Counts are ordinary user
attributes, not heap system columns. `"char"` is PostgreSQL's internal type.

**pg_type: 32 fields, catalog OID 1247.**
[REL_17_6 pg_type.h:34-233](https://github.com/postgres/postgres/blob/REL_17_6/src/include/catalog/pg_type.h#L34).

```text
oid:oid typname:name typnamespace:oid typowner:oid typlen:int2
typbyval:bool typtype:"char" typcategory:"char" typispreferred:bool
typisdefined:bool typdelim:"char" typrelid:oid typsubscript:regproc
typelem:oid typarray:oid typinput:regproc typoutput:regproc
typreceive:regproc typsend:regproc typmodin:regproc typmodout:regproc
typanalyze:regproc typalign:"char" typstorage:"char" typnotnull:bool
typbasetype:oid typtypmod:int4 typndims:int4 typcollation:oid
typdefaultbin:pg_node_tree typdefault:text typacl:aclitem[]
```

The source kind codes are `b/c/d/e/m/p/r`; arrays are not a new `typtype` code.
Preserve raw `typelem/typarray/typrelid`, domain/default/ACL payloads and dependency
bindings; enumerating kinds is not admitting their semantics.

**pg_enum: 4 fields, catalog OID 3501.**
[REL_17_6 pg_enum.h:29-35](https://github.com/postgres/postgres/blob/REL_17_6/src/include/catalog/pg_enum.h#L29).

```text
oid:oid enumtypid:oid enumsortorder:float4 enumlabel:name
```

Capture labels directly through their owning type's declared schema, independently
of referenced tables. Preserve label/sort order; local row OIDs are evidence,
not cross-copy identities. Native ordering is explained in
[PG17 pg_enum](https://www.postgresql.org/docs/17/catalog-pg-enum.html).

**pg_range: 7 fields, catalog OID 3541; no separate oid attribute.**
[REL_17_6 pg_range.h:28-49](https://github.com/postgres/postgres/blob/REL_17_6/src/include/catalog/pg_range.h#L28).

```text
rngtypid:oid rngsubtype:oid rngmultitypid:oid rngcollation:oid
rngsubopc:oid rngcanonical:regproc rngsubdiff:regproc
```

`rngtypid` is the owning range type; `rngmultitypid` binds its multirange. Preserve
subtype/collation/opclass/canonical/difference-function bindings, including zero
optional references. Do not fabricate a `pg_range.oid` or equate matching names
with matching payloads. See [PG17 pg_range](https://www.postgresql.org/docs/17/catalog-pg-range.html).

**pg_constraint: 26 fields, catalog OID 2606.**
[REL_17_6 pg_constraint.h:30-147](https://github.com/postgres/postgres/blob/REL_17_6/src/include/catalog/pg_constraint.h#L30).

```text
oid:oid conname:name connamespace:oid contype:"char" condeferrable:bool
condeferred:bool convalidated:bool conrelid:oid contypid:oid conindid:oid
conparentid:oid confrelid:oid confupdtype:"char" confdeltype:"char"
confmatchtype:"char" conislocal:bool coninhcount:int2 connoinherit:bool
conkey:int2[] confkey:int2[] conpfeqop:oid[] conppeqop:oid[]
conffeqop:oid[] confdelsetcols:int2[] conexclop:oid[] conbin:pg_node_tree
```

Do not append PG18 `conenforced` or `conperiod`, synthesize their defaults, or
discard extra fields to make profiles agree. Capture domain constraints through
`contypid`, not just a join to tables; declared-schema completeness still excludes
unclassified classes and extension objects outside that scope.

### NOT NULL Is Version-specific

PG17 table NOT NULL is `pg_attribute.attnotnull`, not a `pg_constraint` row.
PG17 **does** have `contype='n'` for domain NOT NULL; also retain domain
`pg_type.typnotnull`. A claim that PG17 has no `n` at all would be incorrect.
[PG17 constraint model](https://www.postgresql.org/docs/17/catalog-pg-constraint.html),
[REL_17_6 attnotnull:119-120](https://github.com/postgres/postgres/blob/REL_17_6/src/include/catalog/pg_attribute.h#L119),
[PG17 domain flag](https://www.postgresql.org/docs/17/catalog-pg-type.html).

PG18 adds table NOT NULL catalog rows and the enforcement/period fields.
[PG18 constraint model](https://www.postgresql.org/docs/18/catalog-pg-constraint.html),
[REL_18_4 constraint definition](https://github.com/postgres/postgres/blob/REL_18_4/src/include/catalog/pg_constraint.h#L46).
The frozen [PG18 header](../../tests/server/media-restore-native-classes.fixture.mjs#L3)
and [version check](../../tests/server/media-restore-native-classes.contract.mjs#L44)
are therefore not reusable PG17 payload validators. PG17 also has its own
`pg_attribute` layout; any broader column adapter must independently pin it.

### Object-address Functions

Exact tagged entries:
[REL_17_6 pg_proc.dat:6117-6132](https://github.com/postgres/postgres/blob/REL_17_6/src/include/catalog/pg_proc.dat#L6117).

| Function | IN arguments | OUT record fields |
| --- | --- | --- |
| `pg_identify_object_as_address` | `classid oid, objid oid, objsubid integer` | `type text, object_names text[], object_args text[]` |
| `pg_get_object_address` | `type text, object_names text[], object_args text[]` | `classid oid, objid oid, objsubid integer` |

Both are ordinary functions (`prokind=f`), return `record`, are stable, and have
three IN/three OUT arguments. Pin input/output types, modes and names rather than
assuming a matching proname is sufficient. Native identify/inverse semantics:
[PG17 object information functions](https://www.postgresql.org/docs/17/functions-info.html#FUNCTIONS-INFO-OBJECT-TABLE).

Require each supported endpoint's inverse to return its exact local triple;
cross-copy matching uses native name/argument arrays, never local object OIDs.
Do not assume every catalog row, notably enum/range child records, is independently
addressable by these functions. Bind children to native owning-type addresses and
calibrate supported classes on PG17; unknown/NULL/wrong inverse results refuse.
Native addresses do not prove complete enumeration or authenticated provenance.

## Separately Owned Runtime Evidence

No installed-runtime, image, extension, bootstrap, process or configuration probe
was performed here. Earlier owned PG17 evidence in HANDOVER is not a current
installation inventory or acceptance of this new profile. All rows below are
prerequisites, not recorded successful checks.

| Evidence owner | Required fresh closure | Current status in this slice |
| --- | --- | --- |
| Coordinator / runtime custodian | Exact image digest, vendor source/patch/build identity; separately identified reference/restore copies with parent's isolation constraints. | UNKNOWN; no image inspection. |
| Binary custodian | Actual `postgres/initdb/pg_ctl/psql/pg_dump` paths, versions and pre/post hashes; client and server identities bound to execution. | UNKNOWN; no executable/version/hash probe. PG18 local proof is not PG17 proof. |
| Extension custodian | Exact installed versions, control/scripts/libraries, membership and stable object/column addresses; source current versus historical privileges captured independently. | UNKNOWN; no extension/config reads. |
| Bootstrap / role owner | Actual initdb bootstrap name/fixed identities, pristine inventory, serial original-rank names; independent attributes/material/memberships/grantors/options/settings closure. | Name-only PG18 SOURCE mechanism reusable; not PG17 native proof. Full PG17 setup unproved. |
| Capture / reference owner | Live-before authority independent of backup/replay; exact identities, source fence, private raw rows/dumps and before/after receipts. | Unexecuted for this profile; labels/hashes alone are only consistency. |

[Original-rank scope](2026-10-04-avatar-role-bootstrap.md#L26) does not restore
attributes/password material or prove arbitrary ACL representability. Do not
assume the bootstrap name is `postgres`, rename it by guess, or alphabetize roles.
A fresh fixture must contain no extra QA-manager role before pristine capture;
any permitted removal is exact-owned clone work with independent final inventory,
not a production-role operation. Preserve material privately, never in this report.
Unrepresentable native ACL order remains refusal before every repair mutation.

Same extension versions/current grants do not establish identical historical
`pg_init_privs`; see [PG17 initial privileges](https://www.postgresql.org/docs/17/catalog-pg-init-privs.html)
and the [parent's independent privilege requirement](2026-10-04-avatar-restore-next.md#L52).
No system-catalog rewrite, SQL text normalization, generated-name stripping or
extension-history repair is authorized here. TOAST and other unclassified families
remain refused; this is not a closed whole-catalog inventory.

## Finite Acceptance Checklist

All items below are **future, unexecuted**. Coordinator assigns new files/owners;
no frozen PG18 modules/evidence or prior stopped-directory HOLD is modified.

1. Freeze exact PG17 source/profile, owned image/binaries/extensions/bootstrap and
   runner inputs; independently verify source/setup provenance before dispatch.
   A missing prerequisite stops dispatch, not an install or speculative old rerun.
2. Actual native header must match `170006/202406281`, the 32/4/7/26 ordered shapes
   above and function signatures. Wrong minor/catalog/field/type/mode/overload
   mutants must reach literal profile/header refusal, not startup/import failure.
3. In fresh fictional scopes enumerate unreferenced type rows, automatic arrays,
   enum labels and range/multirange rows directly; independent SQL counts and keys
   precede projections. Actual source nonempty/both subjects missing must fail
   membership FIRST. Equal nonempty unsupported semantics still refuse; actual
   separately captured three-scope empty calibration gives only scoped absence.
4. Native missing/duplicate/key-swap/label-order/range-subtype or owning-type
   mutants must fail independent literals. Compile enumeration and source-compare
   omissions and require RED; common loss in both replay paths is not equality.
5. Calibrate table INTEGER NOT NULL and domain NOT NULL separately: literal table
   `attnotnull=true` with zero table `n` rows; domain `typnotnull=true` plus its
   domain `n` row. DROP NOT NULL must hit independent payload refusal even if
   table constraint membership is unchanged. No invented PG18 enforcement flags.
6. On this exact PG17 setup reproduce the narrow CHECK roundtrip with INTEGER
   dropped-column holes and exact SOURCE/REF1/REF2 bytes. Operator/constant,
   common CHECK loss, validation and column-binding mutants must reach their own
   literal reasons rather than an earlier DDL veto. Convergence alone is not source
   equality; same-copy raw/dump rollback and unrelated fictional rows stay exact.
7. Prove supported native address inverses and dependency ownership, including
   wrong owner/subtype/array/composite/domain bindings. Wrong/NULL inverse and
   unsupported classes refuse. Do not use generated internal names as stable keys.
8. Independently exercise original-rank versus alphabetical bootstrap, missing/
   extra QA role, default ACL scope/grantor/option/ordinal and extension initial
   versus current privileges. Native refusal occurs before ALL repairs; retain
   literal SQLSTATE/primary and exact rollback, not merely nonzero process exit.
9. Persist allocated/inspected identity before work; observe actual pending SQL
   before fault injection. Bound child exit/close/kill/persistence and retain
   primary plus cleanup/journal failures. Exact final cases/controls/lifetimes must
   refuse filtered/incomplete runs. Verify all fresh jobs/backend/postmaster/PID/
   paths absent; preserve unresolved HOLDs, never delete an uncertain target.
10. Independent frozen source/evidence review checks pre/post pins, native raw
    artifacts and each literal refusal. Only then consider separate operator
    wiring under the parent contract; these controls alone cannot approve full
    restore, backup-alone recovery, PG17 production, main or native publication.

Routine/CHECK accepted PG18 stages stay closed; item6 is new PG17 portability
evidence, not a rerun or downgrade of those accepted diagnostics.
`fullRestoreApproved`, `pg17Accepted`, `runtimeApproved`, `productionApproved`
remain **false**. Whole-media/reclamation/native HOLDs are unchanged.

## Source-only Validation

This owner wrote only this fresh document. Primary tagged sources and versioned
official manuals were read. Document checks passed: seven relative file/line
links, four unique field manifests with literal counts32/4/7/26, ten checklist
items and zero trailing whitespace. External URL syntax is checked, not a claim
of native calibration. All eight inspected local source/spec hashes match before/
after, including the frozen coverage-plan SHA256
`0003b965726b4fdcf4592dcc32fe2267cfd1ef772b8e634c23bc85d6dd62d217`.
No native/SQL/test/remote/provider/device
commands, credential/configuration reads, install, cleanup retry, stage/commit/
push or old-evidence edits. Existing installed runtimes remain UNKNOWN here.
