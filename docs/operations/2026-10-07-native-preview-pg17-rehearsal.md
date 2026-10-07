# Native preview: PG17 recovery rehearsal

## Current boundary

2026-10-07: production remains read-only for this slice. D-335's accepted source
proposal is not installed. The owner's DB authorization is explicit; the open
gate is recovery/real-system verification, not a missing routine permission.
Android read-card cleanup and release are independently accepted:
[release report](2026-10-07-android-read-cleanup-release.md).

This bounded rehearsal does not certify universal D-342 recovery or the separate
avatar signed-provenance contract. Do not repeat their unchanged hash/profile
loops. The candidate SQL and privacy contract are unchanged:
[recipient authorization](2026-10-07-native-message-preview-authorization.md).

## Actual evidence

A fresh full custom archive, schema, globals and extension-control inventory
were sealed on the host, with checksums, private directory/file modes and source
schema/security before/after comparison. Archive: 6,080,559 bytes, 3,184 TOC
objects, 170 TABLE DATA objects. No dumps, role passwords, message rows or media
were copied to the workstation or committed.

The isolated copy used the current production PG17.6 image, one CPU/1GiB,
network none, no ports or host mounts. Cron was disabled and pg_net dispatch
redirected to an absent QA database. The existing PostgREST binary was pinned,
but no QA HTTP listener or JWT consumer has run at this checkpoint.

Attempt1 stopped before restore: an interactive `psql -c` consumed the remaining
SSH/bash input. A read-only control reproduced this; bounded stdin fixed it,
and an omission mutant detected regression. Attempt2 stopped during an
in-container PID1 shutdown without a server-stopped acknowledgement. That
attempt's exit code was not retained; do not report an inferred exit137 as fact.

Attempt3 changed to host-side stop/start of the exact owned container. Normal
exit0/noOOM was verified. `pg_restore --exit-on-error --create` then completed.
Database settings, default ACLs, roles, memberships, extensions, control inventory,
RLS and policies matched. Full security/raw-schema comparison correctly refused
acceptance because other differences remained.

The database-properties oracle was corrected: a missing TOC DATABASE entry did
not prove settings were absent. Rendering the archive with `pg_restore --create`
showed CREATE DATABASE and three ALTER DATABASE statements. The effective restore
flag belongs to pg_restore for custom archives, not pg_dump's script-only option.
[PostgreSQL17 dump documentation](https://www.postgresql.org/docs/17/app-pgdump.html).

## Exact differences and proposed clone-only supplement

Explicit owner-only ACL versus NULL affected 39 tables and the private schema.
These need PostgreSQL's effective `acldefault` comparison; they are not evidence
of lost grants by themselves. Real differences must not be ignored:

- `net.http_get` / `net.http_post`: ACL and function settings.
- `graphql` / `graphql_public`: schema ACL.
- Two named voice request/response indexes in `net`: absent in the restored copy.

Source owners and function body digests matched. The preparation seals metadata
for exactly two schemas, two functions and two indexes, restores only those in
the isolated copy inside a transaction, and requires a raising exact self-check.
It does not repair production, change catalogs directly or rewrite the proposal.

Raw dump differences also include four CHECK renderings, one policy rendering
and ordering in 12 default-ACL sections. The proposed comparator accepts only
the five exact observed block pairs plus line-multiset equality for those 12
order-only blocks. An unknown SQL change, altered predicate or privilege must
refuse acceptance. Whole-dump sorting or a broad ignored diff is not permitted.

The coordinator retained an immutable ignored review snapshot of the loader.
Review found a P2: automatically sealing a named TABLE block could bless an
altered CHECK predicate. A fictional pre-seal `>` -> `>=` change was accepted;
post-seal negative controls had not tested that boundary. The repaired loader
pins the source schema hash and five complete observed hash pairs at sealing,
before allocation and final comparison. Actual RED1 -> GREEN1, eight pre-seal
refusal controls and three compiled omission mutants passed. Independent review
accepted the narrow change and each pair's operators, limits, regex and policy
semantics; final loader SHA256:
`2db7275c564924220a76c19810f08706fd198e731daa9f3b33771478284052fd`.
This is source acceptance only. A changed-input copy is authorized to proceed;
source preparation does not establish recovery, HTTP/RLS or rollback acceptance.

## Closure and next stage

Attempt4 ran once after the focused repair review. Full restore and the exact
supplement's raising check passed; full effective security, namespace/default
ACL, database settings and control inventory matched. The strict raw gate
correctly refused two additional `graphql`/`graphql_public` ACL blocks. Their
statements match the sealed source privileges, but this new allowance is not
yet accepted. Candidate mutation/JWT/rollback did not run. The minimal next
change pins these two complete block pairs while retaining mandatory effective
security equality; unknown grants or additions must refuse. Extension initial
ACL serialization is an explanation to verify, not a measured cause.

All four allocated copies were removed after their bounded attempt. Independent
coordinator readback confirms the exact QA container name absent. No QA listener
or active local rehearsal process remains at this checkpoint. Production identity
was unchanged; normal production row activity was not compared or claimed absent.
The verified private backup package is retained on the host.

Next: review the narrow two-block allowance and the candidate/JWT/rollback driver,
then run one changed-input copy with the exact supplement; require full effective
security and bounded raw
equivalence. Only then apply the candidate to that copy, exercise real signed
JWT/session/RLS and dependency paths, prove raising self-check mutants and
same-copy rollback. Production installation still requires a fresh verified
before-state backup, reviewed transaction, raising check, byte-identical
migration mirror and real post-apply validation. No production SQL has run here.

Private evidence and resume artifacts:
`.ops-private/native-preview-pg17-rehearsal-20261007-r1-evidence/`,
`.ops-private/native-preview-pg17-rehearsal-20261007-r1.mjs` and the bounded HTTP
adapter. They are not public Git artifacts. Keep operational history here and
the concise active checkpoint in `docs/HANDOVER.md`.
