# PG17 Header Prerequisite: Source Contract

Date: 2026-10-04. Owner coordinator. Base `b5f373e5`; candidate branch only.
This advances the [approved prerequisites](2026-10-04-avatar-pg17-prerequisites.md),
not a production change or a full PG17 restore profile.

## Implemented Boundary

New action-free files under `tests/server`:

- [Fixture](../../tests/server/media-restore-pg17-header.fixture.mjs) pins
  `170006/202406281`, catalog OIDs and all ordered field names/native type names:
  `pg_type=32`, `pg_enum=4`, `pg_range=7`, `pg_constraint=26`.
- [Contract](../../tests/server/media-restore-pg17-header.contract.mjs) independently
  refuses other minors/catalogs, missing/extra/reordered fields, wrong or shadow
  types, address-function overloads/OIDs/kinds/volatility, IN/OUT types/modes/names,
  non-data evidence and attempted authority fields.
- [Tests](../../tests/server/media-restore-pg17-header.test.mjs) supply independent
  literals, not the fixture's exported constants; malformed input never calls
  accessors or `toJSON`, nor changes the supplied evidence.

Exact function definitions are from
[REL_17_6 pg_proc.dat](https://github.com/postgres/postgres/blob/REL_17_6/src/include/catalog/pg_proc.dat#L6117).
Catalog manifests retain native `pg_catalog` type names (including array names),
not search-path-dependent display aliases. Both functions' three IN and three
OUT arguments are checked. This does not calibrate native address inverses.

The new profile is deliberately `pg17.6-prerequisite`, **not** `pg17.6`.
Its immutable receipt says `supplied-header-only` and keeps all four approval
flags false. Existing PG17 recovery/type/CHECK refusal remains unchanged. No SQL
builder, database connection, process allocation or operator wiring is included.

## Measured Validation

Legacy baseline reaches the real `profile-unexecuted` refusal: **0/1 RED**.
An initial incomplete baseline hit `shape` instead and was corrected before
implementation; it was not accepted as the intended regression measurement.

New source tests pass **57/57**, including **13 compiled mutants** that break
independent refusal/receipt assertions. Deep input originally exhausted the stack
(46/47); fixed depth/node limits now refuse specifically. A first node-budget
mutant exposed a redundant generic `shape` oracle (49/50); separate literal
`input-depth` and `input-budget` reasons now detect both omissions.
Depth is capped at 16 and copied evidence nodes at 4096. Independent source review
found a P2: Proxy evidence could execute introspection traps. Actual new regression
was RED50/56, retained with pre-fix source bytes. `types.isProxy` now refuses before
introspection; five nesting cases and revoked Proxy pass with literal zero hooks,
and its compiled omission is detected. The original finding is not erased.

Changed and adjacent header/type/routine/native-class/CHECK/role-order source
checks pass **302/302**. This is not a claim that the entire project suite is
green. Prior whole-suite limitation remains 4948 pass / one unchanged Android
cold-Gradle timeout / 13 optional, with no new Android/native execution here.

Independent source/candidate review is required before publication; its current
receipt is retained privately. No previous native runner or publication gate is
replayed just because its current branch paths have moved to a new checkpoint.

## Disk-Full Recovery

D: reached zero free bytes and a manual patch truncated the new untracked test
file. It was restored from the retained patch text and all 50 tests reran; no
tracked source or old frozen evidence was lost. Only 15 regenerable project
Gradle-cache files were copied to C:, hash-verified and removed from their exact
cache path. The old project-move diagnostic log was preserved on C: with a
byte-verified symbolic link at its original D: path. No secrets, release artifacts,
backups, personal data or held native directories were cleaned. Exact recovery
paths/readbacks are in the private current resume/validation receipt.

Disk capacity remains an operational risk; do not start large builds or native
allocations on the nearly full volume. Existing JDK/global PATH and connectivity
services were not changed.

## Next

Resolve the exact [vendor build/wrapper prerequisites](2026-10-04-avatar-pg17-vendor-provenance.md),
then independently review a **new**, bounded fictional PG17 producer before
allocation. Actual header, table/domain NOT NULL, CHECK/address/type, bootstrap,
extension and lifecycle controls remain unexecuted for this profile. Strict
full-DDL and authenticated provenance vetoes remain; item82/D-342 stays open.
No production SQL/main/runtime, R5/full restore, native/Android publication,
reclamation/refund or old-HOLD cleanup authorization is added.
