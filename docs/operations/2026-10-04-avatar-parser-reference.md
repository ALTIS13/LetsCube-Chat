# Bounded Avatar Restore Reference Controls

Date: 2026-10-04. Owner: Codex coordinator. Prerequisite for D-338 and item
82 / D-342. Parent contract: [restore acceptance](2026-10-04-avatar-restore-next.md).
This is not the full restore operator and does not reopen R5 or production SQL.

## Implemented Source Boundary

- [Receipt guard](../../tests/server/media-restore-reference.contract.mjs) is
  action-free. It requires independent before/after source capture, exact backup
  provenance, separately identified copies, closed isolation fields, exact native
  authority hashes and a complete named check inventory.
- [Behavioral tests](../../tests/server/media-restore-reference.test.mjs) are
  **18/18**; a permissive baseline gave an actual circular-reference RED. Seven
  compiled guard/result mutants fail the independent literal refusal oracles.
  Shared loss, NULL/empty and nested order cannot substitute for source authority.
- Returned `fullRestoreApproved` and `runtimeApproved` are always literal false.
  A consistent fabricated receipt is not proof: the independently frozen producer
  and actual native readback remain required. This guard is not yet wired into a
  full copied-PG17 acceptance operator.

## Fictional Native Preflight

[Fixture schema](../../tests/server/fixtures/media-restore-pg17-controls.sql) and
[native queries/mutants](../../tests/server/media-restore-pg17.fixture.mjs) contain
fictional objects only. The final local PG18.4 positive pair passed **39 actual
native checks**; the native suite is **4/4**, including the two review negative
controls and a failed-spawn case. There were no remote actions or production
data in that run. Ten initial lifecycle RED cases became GREEN; the final
**38/38** operator/lifecycle/oracle controls cover lost create acknowledgement, readiness,
assertion/diagnostic/cleanup failures, occupied namespaces, identity replacement,
source pins, approval scope and a compiled approval-guard omission.

Independent review then found two false-positive denial oracles. An omitted table
INSERT grant could satisfy the generic RLS-error check, and a process status 255
with retained native SQL diagnostics could satisfy the generic nonzero-exit check.
Both actual local native mutants wrongly passed all 38 checks; their independent
must-refuse assertions were RED. The old review stays refused. Positive ordinary
role INSERT/rollback and exact SQLSTATE/primary-message/psql-exit controls were
verified in the final **60/60** run (18 guard + 38 operator + 4 native cases).
The missing-grant mutant now refuses at the ordinary-role positive INSERT; the
status-255 mutant refuses despite retaining the actual PostgreSQL diagnostic.
Numeric exit 3 and one exact anchored SQLSTATE/primary line are required. An
initial strict CHECK expectation failed on the real constraint name and was
corrected to the measured `bound_check`, not an arbitrary 23514. All 18 fresh
calibration/RED/intermediate/final local directories and native PIDs were absent,
with instrumented jobs zero and frozen source/binary hashes unchanged.
The initial 38-pass count is not accepted
RLS or transport-failure discrimination proof.

Native controls include CHECK operators/constants/presence/validation, key names,
deferrability and column/function binding; policy declaration order, roles,
USING/WITH CHECK and non-owner RLS reads/denial; separate default `f/r/S` and
global scope, original ordering, widened rights/grant option and newly created
object permissions. Extension current ACL changes are compared with initial
privileges **inside the same transaction**, not after rollback. Common loss of
CHECK, policy, default scope and extension history is caught by independent literal
source-presence queries even when both copies agree. Every schema mutant must
restore the same-copy DDL byte-for-byte.

The preflight corrected two assumptions without relaxing the restore gate:

- PostgreSQL 17 records relation NOT NULL in `pg_attribute`, whereas the local
  PG18 fixture also has NOT NULL constraint rows for its primary-key column and
  explicitly non-null quantity. Selected `c/p/u` capture and independent attribute
  assertions make that boundary explicit. This is not a whole-class inventory.
- Inverse role-OID bootstrap alone retains the policy declaration array in the
  local fixture. An actual reversed `TO` declaration changes the captured native
  ordinal and is detected. This does **not** establish the cause of R4's policy
  DDL permutation. No role-list, ACL or expression string normalization is used.

A separate bounded read-only production diagnostic captured 31 role identities
and boolean attributes, with unchanged production identity before/after. The
source bootstrap already matches the current copy operator. Changing the
bootstrap name is therefore not an evidence-backed repair for the 21 default-ACL
differences. Remaining relative role-rank reconstruction needs its own native
controls and backup-bound capture. This supplemental diagnostic contains no
password/config capture and is not full role/material or restore-fidelity proof.

PostgreSQL documents constraint [flags/bindings](https://www.postgresql.org/docs/17/catalog-pg-constraint.html),
policy [roles and expressions](https://www.postgresql.org/docs/17/catalog-pg-policy.html)
and separate [initial privilege history](https://www.postgresql.org/docs/17/catalog-pg-init-privs.html).
The concrete assertions above are executed fixture evidence, not documentation
claims about LETSCUBE production.

## Exact PG17 Run

The corrected ten-input closure passed fresh independent review; the old refused
review remains immutable. The first finite pair then passed **39/39** on the exact
Supabase PG17.6 image, with `pg_stat_statements` **1.11** (local PG18 used 1.12).
Source pins matched before/after. The pair had fresh distinct names/owner labels,
network none, no ports/mounts, cron off and bounded memory/CPU. It used no
production DDL/rows or backup replay; only production identity was read at the
operator's lifecycle boundaries.

The reviewed producer queried each exact ID and name after removal before writing
success. A separate coordinator readback confirmed both names and owner labels
absent and production identity equal to the independent pre-run capture. A
supplemental Docker-event probe did **not** recover durable IDs; it is not accepted
cleanup authority. The calibrated history returned 252 container exec events and
no owned removal records. Docker returns only the latest
[256 events](https://docs.docker.com/reference/cli/docker/system/events/), so this
history cannot substitute for immediate readback or retained lifecycle identities.
The next full-copy producer must retain inspected IDs before its native work;
this fixture is not rerun merely to fill that optional diagnostic gap.

No R5 namespace, migration, provider upload, media deletion/refund or native
release is authorized by this bounded fixture.

## Remaining Acceptance

The full native-class inventory, independently captured live-before schema and
backup replay, production role bootstrap and **all actual installed extensions**
remain unproven. The extension fixture covers `pg_stat_statements`, not every
deployed extension or historical install/update path. The full restore refusal,
backup-alone recovery gap and D-338/D-342 stay open. Preserve the earlier frozen
80/80 R5-v2 and 45/45 source-observer evidence; neither is repeated or weakened.

After the full [independent-reference contract](2026-10-04-avatar-restore-next.md)
passes, continue the real Auth/setter/RLS source-observer rehearsal and then
[durable admission/atomic publication](2026-10-03-avatar-source-epoch-next.md).

## Owner Instructions Preserved

The owner requested independent continuation while away, with persistent
checkpoints and readiness-gated rollout rather than new approval rounds.
Realme and rented iPhone, Samsung/comparable Android are available for relevant
mobile QA; verify current access, bound paid sessions and release promptly.
A063 stays excluded. Availability is not permission to expose personal data,
overwrite a release build or lift native/reclamation HOLDs. This backend slice
uses no devices or paid minutes.
