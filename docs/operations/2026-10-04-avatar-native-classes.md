# Selected Native Constraint/Trigger Bindings - 2026-10-04

Owner: Aristotle implementation, Codex coordinator review. Candidate checkpoint
`e07af4f1` on `codex/bot-inline-media-20261002`. This is a source/local prerequisite
for D-338/D-342, not runtime wiring, full recovery or production acceptance.

## Implemented Scope

Three new public modules capture and compare an explicit schema subset:

- [queries and pinned catalog shape](../../tests/server/media-restore-native-classes.fixture.mjs);
- [action-free comparison contract](../../tests/server/media-restore-native-classes.contract.mjs);
- [pure controls and compiled mutations](../../tests/server/media-restore-native-classes.test.mjs).

The executable profile is specifically PostgreSQL 18.4 with catalog version
202506291. PG17 and unknown/mixed profiles refuse. Independent census membership
and each replay are compared with live-before, preventing a common omission in
both replay subjects from passing. Ordinary constraints, active column bindings,
user triggers and structurally identified internal FK triggers are selected.
Generated FK names and absolute OIDs are not stable identities; raw catalog
payloads and native deparsed definitions remain evidence, not normalized text.

The successful receipt is literally `constraint-trigger-bindings/v1`,
`selected-only`. Full-restore, PG17, runtime and production authority are all false.
Source digests, capture IDs and origin labels do not authenticate provenance.

## Evidence

The implementer's final frozen run passed **49/49**, no skips or cancellations,
95.77s: 41 pure and eight native cases with 23 named inner controls. Seven actual
compiled mutations were rejected. Native cases include common CHECK/root loss,
dropped INTEGER-column replay, FK enable/action/target and CHECK validation,
qualified routine bindings, unsupported classes and teardown faults.

Coordinator independently read the changed source/native tests and retained
reports, reran only the pure suite (**41/41**, 121.92ms), and checked seven source,
two instruction, five binary and two evidence hashes. The frozen manifest hash is
`f50cc804e2fd59ea92e147cc9ede05f8cf28409960380f25e7f546cdedf59ede`.
No native suite was rerun by the coordinator or appended to frozen evidence.

All ten final fresh lifetimes have matching before/after identities, jobs=0 and
independently checked path/PID absence. One **historical stopped directory** from
an earlier failed pending-job control remains HOLD after exact removal was
policy-refused. Its original failure and separate recovery-refused receipt are
retained; no alternative deletion API or retry was used. Therefore the final
run's cleanup passed, but blanket historical cleanup is **not complete**. The
coordinator retained this boundary; it is not a new direct owner command.

## Limits And Next Step

This positive uses three fictional databases in one fresh local cluster, not
independent production restores. TOAST endpoints are explicitly unsupported;
an actual dropped TEXT case showed surviving source/copy physical dependencies.
Typical TOAST-bearing production relations are outside this positive domain.
Domains, partitions, inheritance, unknown endpoints, column defaults/generated
payloads and expression/partial indexes remain refused. Routine/type/operator/
index boundary semantics, complete class coverage, source capture races,
authenticated provenance and extension history remain unproved.

Review accepts this narrow source/local prerequisite only. Next: close the class
coverage/provenance plan and demonstrate supported PG17 behavior before full
operator wiring. Do not treat passing selected controls as full DDL equality or
backup-alone recovery. R5 dispatch, production SQL, Android/native publication
and whole-chat-media reclamation remain HOLD. No old role/parser/R5 suite, remote
restore, migration, provider mutation or device operation was run here.
