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

Four fresh, isolated full PG17 restores refused strict catalog equality before
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
memberships match; the ALL/postgres database application settings are absent.
Direct inspection of setting names corrected the initial search_path diagnosis:
the missing record contains `app.settings.jwt_secret` and `app.settings.jwt_exp`.
Values remain private; no setting value was printed or copied into this report.
Full schema DDL equality is not established. These are distinct findings, not
one harmless aggregate-order change. New item 82/D-342 tracks recovery fidelity
separately from avatar observation. The next source slice uses native typed ACL
entries for exact clone reconstruction and vetted database settings, preserving
raw readback instead of normalizing missing rights. No production recovery or
backup-script modification has occurred.

The prepared-copy contract uses the verified full backup **plus supplemental
live catalog/settings capture**. Reconstruction from that capture cannot prove
faithful recovery from the backup alone. Item 82/D-342 remains open until the
durable backup/recovery procedure itself retains and restores the missing state.
The clone-only repair scope is the two measured application settings; persisted
database search_path repair is excluded. Session-local search_path for catalog
measurement/self-checking is a different, non-persistent operation.

### Fourth Restore And Remaining Coverage

The exact reviewed R4 copy/rehearsal closures contain seven/fourteen files. Final
combined local controls pass **62/62**, zero failures, cancellations or skips;
helper controls account for 40. Real wrong ACL, role attribute, membership,
configuration value/order and grant-option changes raise the specific
`P0001/avatar_epoch_restore_fidelity` before COMMIT and roll back. Native hashes
retain nested array order, duplicates and NULLs. Real pending-SQL and native
log-read teardown faults preserve the primary failure after exact owned PG stop
and path removal. Five helper-source/four binary pins match before/after.

R4 applied clone-only typed object-ACL and application-settings reconstruction.
The native object-permission and role/settings hashes then match, but the outer
catalog gate correctly refuses: **21 schema-scoped default ACL arrays** reorder,
seven each for routines, tables and sequences. Before/after have 27 default-ACL
records; the typed hash inventory captured none. All other captured metadata,
after the already specified active-column projection, matches. This is a concrete
coverage gap, not permission to sort away ACL order. No epoch SQL was applied.
Independent exact ID/name absence and unchanged production identity were verified;
the fresh backup and private diagnostics remain retained.

The complete DDL also differs: four CHECK expressions have parenthesis-only
text differences, one policy lists the same two roles in a different order,
twelve default-ACL blocks reorder lines and two additional schema-ACL blocks
appear. Those are diagnostic classifications, NOT an equivalence oracle. In
particular, the extension initial-privilege cause of the two extra blocks still
needs actual native catalog evidence. No blanket whitespace, parenthesis, role
or statement sorting is accepted. Same-copy installed/rollback DDL comparisons
remain byte-exact.

R5 preparation stays unexecuted while that DDL boundary is unresolved. Its new
native default-ACL capture/control first fails against the old query (actual
zero instead of the one specifically owned default); the corrected capture
passes and an actual default privilege change triggers pre-COMMIT refusal and
rollback. The generic fixture has its own baseline defaults, so this oracle
selects the literal fictional owner/schema rather than guessing a global count.
Full helper reconstruction, frozen-input review and the copied PG17 rehearsal
are separate remaining gates, not implied by this focused positive control.
Independent review retains the refusal and defines the
[next native/reference acceptance contract](2026-10-04-avatar-restore-next.md).
It requires actual role-order, expression and initial-extension-privilege proof;
the reference operator is not implemented or approved by this report.

### R5 Local Source Gate

The preceding **73/73** run did not close independent review: two P2s remained
in mixed transaction composition and the error oracle. Final R5-v2 combined
local result is **80/80**, zero failures/cancellations/skips: 19 copy controls,
nine rehearsal controls and 52 helper controls. Fourteen source
pins, 19 configured binary/extension-input pins and the helper-report pin match
before/after. Exact current helper PG directories are absent and matching native
processes are zero. The pending-SQL and failed-log-read cleanup faults remain
part of this final run, not substituted by callback-only tests.

The mixed transaction's native order guard formerly followed setting and ordinary
ACL repairs. Actual local event-trigger/sequence controls are non-transactional
observations, so rollback cannot erase evidence of an earlier repair attempt:
the old composition is RED, with five ACL attempts observing preceding settings.
The separated preflight now refuses at the exact expected P0001 before all repair
classes, with zero observed attempts. A valid mixed settings/object/default repair
also commits the three independently captured native permission/role/hash records
exactly. PostgreSQL's [DDL event-trigger boundary](https://www.postgresql.org/docs/18/event-trigger-definition.html)
excludes shared database objects; the probe observes the preceding settings at
ordinary ACL attempts, not a claimed ALTER DATABASE event.

The prior marker-only error predicate accepts three wrong-error controls and is
RED 0/3. The corrected predicate requires literal P0001 and the exact primary
exception message. An actual native 42601 syntax failure retaining the same marker
is rejected; unrelated adapter failures cannot supply the intended refusal.
The focused corrected controls pass 5/5; the helper plan export has its own API
RED before implementation and preserves the accepted standalone wrapper.

Real schema-scoped table/sequence/routine default repairs preserve raw source
ACLs, options and unrelated data/roles/settings. Default content, grant option,
scope and omission mutants fail the native pre-COMMIT fingerprint and roll back.
Different role creation order demonstrates a native unrepresentable ordinal;
the helper refuses it instead of claiming that reordered GRANT commands repair
every source array. Unsupported global/type/schema changes stay refused.

The new extension-history diagnostic first has an incorrect plpgsql-only fixture
assumption: native inspection finds zero extension initial-ACL records there.
The final control uses the existing cached `pg_stat_statements` 1.12 extension,
whose script explicitly sets privileges. A native presence control establishes
one exact view record; omitted capture is RED 0/1 and complete capture is GREEN.
An actual current PUBLIC SELECT revoke changes current ACLs while historical
initial ACLs, extension version and membership stay exact. No system-catalog
write, external component installation or global PATH change is involved.

R5 remains unexecuted remotely. The actual launcher refuses obsolete R4 approval
before importing its changed operator; source-only approval must not enable
dispatch. These are local-source results, not full PG17 or production acceptance.

## Still Open

No durable original-source/variant-target pre-I/O intents, trusted admission,
atomic publisher, actual-worker queue/scan wiring or real Storage physical-version
proof is installed here. Logical epochs do not detect an original same-path PUT
that never calls a setter. Bootstrap is not retroactive admission. D-338,
D-336/D-337 and the whole-chat-media deletion/refund/path-reuse HOLD stay open.
Android/native HOLD, A063 exclusion and paid-device minutes remain unchanged.
No production SQL, runtime deployment, provider send or device action follows
from the observation-source acceptance alone.
