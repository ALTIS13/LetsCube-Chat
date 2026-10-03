# Avatar Source Observation, 2026-10-04

Owner: Codex coordinator. D-338 acceptance step 1, following the already
deployed [D-339 repair](2026-10-03-media-claim-token-rollout.md).
This is reviewed observation source, NOT a production migration or a completed
avatar I/O/publication repair. [Remaining contract](2026-10-03-avatar-source-epoch-next.md).

## Implemented Source

The disposable [candidate](../../tests/server/fixtures/media-avatar-source-epochs-candidate.sql)
and [rollback](../../tests/server/fixtures/media-avatar-source-epochs-candidate.rollback.sql)
add private current/history ledgers for profile, chat and bot avatars. Every
INSERT and explicit assignment receives a DB-owned UUID epoch, including equal
URL, NULL-to-NULL and clear. Live NULL is distinct from a deleted-owner tombstone.
Unrelated writes preserve the observation; missing current state or indirect
source changes reconcile against the final owner row, not stale outer NEW.
History survives deletion, ID replacement, truncate and reinsert.

The observer locks owner before current/history, visits multi-owner candidate
sets deterministically, and has bounded lock/statement settings. Explicit hooks
precede existing enqueue hooks; row and statement fallbacks handle nested writes.
Existing owner/setter/queue APIs, RLS and grants are not replaced. Both ledgers
and internal helpers deny ordinary/service-role authority. One-transaction
self-checks reject changed baseline hooks, unexpected privileges and malformed
new state. Rollback drops only owned additive objects, without CASCADE.

## Verification

[Behavioral tests](../../tests/server/media-avatar-source-epochs.test.mjs) use a
minimal owned PG18.4 database with captured owner triggers/functions and selected
schema/permission metadata. Initial shipped-state expectations went RED 0/6:
actual INSERT/equal/ABA/clear writes had no required current/history observation.
Final candidate result: **45/45**, zero failures, cancellations or skips.

Coverage includes three scopes, equal/NULL/clear/ABA, indirect and nested writes,
missing ledger, owner replacement/deletion/truncate, observation-before-enqueue,
actual captured Auth bootstrap/bot setter, role denials and exact selected-catalog/
fictional-row/queue rollback. Three actual same-owner lock schedules require
55P03, the exact blocking PID relationship and distinct committed epochs.
Unrelated-owner lockability was checked only after observer release, not while
that observer remained open.

Five behavioral omission/mutation controls expose lost equal events, missing
reconciliation, stale final-row reads, omitted owner lock and erased history.
Table/column privilege leaks, missing SECURITY DEFINER and a disabled original
hook make the raising self-check fail. Mutants restore original functions/hooks
before positive replay. Permission-like AssertionErrors remain unexpected errors.

Independent review found an incompatible fictional presence value in the pure
[contract](../../tests/server/media-avatar-source-epochs.contract.mjs). The fixture
first added the literal live validated CHECK; the old contract then failed with
actual 23514 after its seven epoch events. The contract now writes `idle`, without
rewriting SQL or disabling the CHECK. Invalid-value refusal preserves all rows;
valid `idle`, `dnd` and NULL do not rotate observations. Final re-review has no
remaining P1/P2 for the four observation-source files.

Pre/final 10 source and four configured binary pins match. Owned local SQL
settled; final RED/GREEN directories are absent and matching PG processes are
zero. Earlier policy-refused startup directories were not retried. The minimal
fixture is not full Auth/RLS/constraint or production equivalence.

## Full-Copy Restore Gate

Three fresh, isolated full PG17 restores refused strict catalog equality before
candidate SQL was applied. All exact owned containers are absent; verified
backups are retained. Production container/database identity remains unchanged.
The second restore retained full before/restored metadata for structured diagnosis:

- 21 active column records differ only in physical ordinal/type identifiers;
  active column names/order and all other captured fields match.
- 39 tables changed explicit owner-default ACL arrays to NULL/default. Direct
  JSON inspection corrected an earlier misreading as empty ACLs; each contains
  the owner's full privileges, not an empty array. Raw equality still refuses.
- All captured function, policy, trigger and table/column grant records match;
  there are no missing or added identities in those captured sections.

The next reviewed operator must restore these exact explicit owner-default ACLs
only on its isolated copy, retain raw snapshots and compare active column order without
discarding types/defaults/grants. Installed-state and rollback comparisons must
remain raw exact checks. Complete fixed-key schema-only DDL plus role attributes,
membership/settings and raw object ACLs supplement the previous selected catalog.
Constraint and excluded-schema policy omissions must make that gate fail.

Refusal cleanup must run even when diagnostics fail or disk pins drift after
import; only the captured reviewed cleanup and exact receipt identity may remove
the copy. Expected omission errors must be bound to the current SQL invocation,
not a stale shared error log. Current local operator controls pass **19/19**;
source review and real restored-copy execution remain separate acceptance steps.
After the actual-array correction, controls pass **21/21**, including real local
PG18.4 GRANT ALL for both ordinary and superuser owners, with exact raw ACL/
owner/default/RLS equality. Revoked/custom ACLs stay unrepaired and cannot pass.

The third restore applied the 39 exact owner-default representation repairs,
but expanded comparison still refused: 18 table/one function ACL arrays reorder,
private schema/two net routines have explicit-default-to-NULL changes, and
graphql/graphql_public schemas lose custom USAGE/grant-option entries. Roles and
memberships match; the ALL/postgres database search_path setting is absent.
Full schema DDL equality is not established. These are distinct findings, not
one harmless aggregate-order change. New item 82/D-342 tracks recovery fidelity
separately from avatar observation. The next source slice uses native typed ACL
entries for exact clone reconstruction and vetted database settings, preserving
raw readback instead of normalizing missing rights. No production recovery or
backup-script modification has occurred.

## Still Open

No durable original-source/variant-target pre-I/O intents, trusted admission,
atomic publisher, actual-worker queue/scan wiring or real Storage physical-version
proof is installed here. Logical epochs do not detect an original same-path PUT
that never calls a setter. Bootstrap is not retroactive admission. D-338,
D-336/D-337 and the whole-chat-media deletion/refund/path-reuse HOLD stay open.
Android/native HOLD, A063 exclusion and paid-device minutes remain unchanged.
No production SQL, runtime deployment, provider send or device action follows
from the observation-source acceptance alone.
