# Native preview: PG17 recovery rehearsal

## Current boundary

2026-10-08 Moscow: D-335's additive server-only default-none schema is installed
once and independently post-verified. The earlier read-only/rehearsal checkpoints
below are chronological evidence, not current deployment status. Native positive
device/credential/choice/card/OS acceptance remains open; generic v1 is unchanged
and rich previews stay disabled. The owner's DB authorization is explicit.
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

Source review of the next frozen driver found two P2 fixture defects before any
allocation: chat creation already triggers creator membership, so the explicit
member INSERT conflicts; member/ban audit triggers leave fictional audit rows
after entity cleanup, preventing all-table equality. Correct the exact fixture
and audit cleanup without disabling triggers or relaxing equality, then re-review.
These are static findings, not actual PG17 RED/JWT results. Source ACL controls
RED1/GREEN1,7 refusals and4 compiled omission mutants do not substitute for native
candidate acceptance. Both fixture P2s were then corrected and independently
source-accepted: actual-source PGlite RED2/GREEN1,9 refusal controls and6 compiled
SQL mutants. Membership updates only joined_at and preserves creator owner;
audit cleanup checks exact forms after entity removal. No triggers or equality
checks were disabled.

## Attempt5 actual result

One reviewed changed-input copy ran. Full archive restore passed with full
effective security, database settings, namespace/default ACL and control
inventory equality. Raw byte equality is false; all19 fixed explicit block
allowances matched. This is measured bounded equivalence, not exact raw bytes
or a general solution to D-342.

The driver then refused at fictional fixture creation: SQLSTATE22023 and exact
`invite_required`. The actual handle_new_user/registration_invite_apply_from_profile
chain requires raw_user_meta_data.invite_code; the fictional users omitted it.
This is a fixture defect, not a migration or production failure. No HTTP/JWT
acceptance or final same-copy rollback is claimed from this attempt.

The exact owned copy was removed healthy, without OOM; container name/listener
namespace absent and production identity unchanged. Private logs stay private.
Next repair supplies one isolated synthetic invite, limit3, no role/location
assignments, exact UUID/code collision guards, metadata for the three fictional
users and exact invite/uses/audit cleanup. Keep registration/RLS/triggers and full
row/sequence equality active. Re-review before another changed-input copy.
No production SQL has been applied.

## Attempt6 actual result

The clone-only invite/uses/audit repair passed causal source controls and focused
independent review. One changed-input copy again passed full restore, effective
security/settings/ACL/control equality and all19 fixed raw allowances. Its
fictional fixture transaction then refused: SQLSTATE23505,
`notifications_message_user_once_idx`, actual psql exit3 with the frozen SQL hash.
The actual `enqueue_message_notifications()` trigger had already created the
notification for the first fictional message; the deterministic fixture INSERT
attempted to duplicate it. The album's second message has the same source path,
but attempt6 did not reach it. This is a fixture defect, not a demonstrated
migration or production failure.

The exact copy was removed healthy/non-OOM; its container/listener namespace is
absent and production identity unchanged. HTTP/JWT and final same-copy rollback
are not accepted. Existing logs without explicit exit receipts remain NOT PROVEN.

An independent read-only pre-install probe matched the pinned production
container/image/cluster/database identity and found all four proposed objects
absent. The actual postgres owner has the required auth-schema USAGE,
auth.sessions SELECT, auth.jwt()/auth.uid() EXECUTE and RLS-bypass authority.
These dependency checks do not prove the proposed recipient lookup or authorize
display, and must not replace the rehearsal or fresh pre-apply guards.

Next: a coupled actual-source preflight covering registration, membership/audit,
both message/notification producers, cascade dependencies, album-only authority
and cleanup. Replace only proved fictional trigger-created notifications before
the deterministic INSERTs, guard the exact dependents and retain indexes/triggers.
Exclude ordinary native authority for both fictional notifications before the
album-only tests. No blind restore loop or broad row deletion. After focused
review, one changed-input copy must establish real signed JWT/session/RLS and
dependency paths, raising self-check controls and final same-copy rollback.
Production installation still requires a fresh verified
before-state backup, reviewed transaction, raising check, byte-identical
migration mirror and real post-apply validation. No production SQL has run here.

Private evidence and resume artifacts:
`.ops-private/native-preview-pg17-rehearsal-20261007-r1-evidence/`,
`.ops-private/native-preview-pg17-rehearsal-20261007-r1.mjs` and the bounded HTTP
adapter. They are not public Git artifacts. Keep operational history here and
the concise active checkpoint in `docs/HANDOVER.md`.

## Attempt7 Actual Result

The coupled fixture repair passed actual-source causal RED2/GREEN1, eight negative
controls, eight compiled omissions, eight preview controls and a sequence-advance
oracle. Both notification producers and dependent cleanup remained active; no
trigger, unique index or row/sequence equality gate was disabled. Independent
source review accepted the frozen repair and the bounded attempt7 envelope.

One changed-input copy restored successfully. The fictional fixture and candidate
transaction exited0. The plain positive/header rollback and seven intentionally
raising self-check mutants passed; eight retained security/raw/row equality
checks passed. Actual PostgREST started in the isolated copy, but `http-controls`
refused. No final candidate acceptance, JWT/RLS result or final same-copy rollback
is claimed. The retained adapter evidence does not identify the failing HTTP
request/status/assertion. Do not infer a migration defect or successful consent
mutation from that absence. A bounded clock observation is not proof of a lease
failure.

The exact copy was removed healthy/non-OOM; its container and listener namespace
are absent, production identity unchanged. No production SQL ran. Cap7 remains
active. The next reviewed private delta adds an exclusive, value-free journal of
request ordinal, safe route, status, SQLSTATE, response type/key names/array length
and numeric assertion source frame. No JWT, response/message/title/body values,
raw stack or personal rows enter that journal. Preserve the original driver and
adapter byte-identically before the change; another copy requires a reviewed
changed-input envelope, not blind replay. Production installation still requires
accepted real HTTP/session/RLS, rollback/equality, a fresh verified backup and the
transactional migration gates above.

## Attempt8 Actual Result

The value-free trace and separate `attempt-8/http` envelope passed independent
review. Before allocation, exact live identity and local source/backup hashes
matched. Full restore passed with the same19 explicit raw allowances and full
effective security/settings/ACL/control equality. Fixed83 old artifact hashes and
fresh8 baseline matched the sealed actual7 proof. Plain/raising7/equality results
are explicitly reused from7, not counted as new native8 tests.

The real HTTP driver passed assertions preceding request19: recipient/device
capability, default-none behavior, consent insert/change, bounded sender/message
projection, missing/invalid/expired JWT and invalid/foreign-session denials.
Request19 was the first role-denial control, role `anon`: observed HTTP401 and
SQLSTATE42501, but the driver expected403 for both `anon` and `service_role`.
The failure frame and sanitized response journal identify that exact harness
oracle mismatch. PostgREST distinguishes anonymous401 from authenticated403 for
insufficient privileges; see [its primary error reference](https://docs.postgrest.org/en/v14/references/errors.html).
The request was denied, not granted. No SQL/permission fix or acceptance of any
arbitrary4xx is justified. The `service_role` control was not reached; retain its
separate exact403/42501 expectation. The original7 HTTP cause remains unknown,
not retrospectively proved identical.

Copy8 was removed healthy/running/non-OOM; name/listener namespace absent and
production identity unchanged. Parent finite session77200 ended exit1. Remaining
HTTP controls, read-only/album/behavioral mutants and final same-copy rollback/
fixture cleanup/equality did not pass and are not claimed. No production SQL.
Next is a causal source correction of the exact role/status oracle and a reviewed
attempt9 namespace preserving7/8 evidence and the same unchanged SQL proposal.
No automatic retry or unreviewed cap increase.

## Attempt9 Actual Result

The exact role/status correction passed actual-source RED/GREEN controls. Review
found a missing SQLSTATE assertion; the r2 repair requires literal42501 for both
roles, with separate wrong/missing-code controls and four compiled omissions.
Independent review accepted r2. Unchanged caps/restore/raising suites were not
replayed. All83 proof7 hashes and42 actual8 receipts remained fixed; HTTP8 results
were not reused because copy9 has a fresh JWT/session/consent context.

One reviewed copy passed full restore, all19 narrow raw allowances, effective
security/settings/ACL/control equality and the sealed proof7 reuse gate. Real
HTTP requests19/20 demonstrated anon401/42501 and service_role403/42501. Later
request55 returned200 with an empty array at the post-undo positive of the
`message-deleted` case. The sanitized journal and exact source sequence identify
this case; it is not an inferred lease, network or authorization failure.

The existing `private.deleted_message_keeps_nothing()` trigger makes deletion
terminal: setting deleted_at back to null cannot restore the message/content.
`private.scrub_deleted_message_notifications()` also removes unsent native
authority. The harness expected a reversible transition, contrary to this
deliberate contract. Do not weaken the triggers, restore deleted content or change
the preview proposal/grants to satisfy that false expectation. Move deletion to
an explicit terminal control after the other HTTP scenarios; verify attempted
resurrection stays denied and check the remaining fixture transitions first.

Parent finite session13447 ended exit1. Copy9 was removed running/exit0/non-OOM;
name/listener namespace absent and production identity unchanged. Remaining
HTTP/read-only/album/behavior controls and final same-copy rollback/full row+
sequence/security/raw equality are not accepted. No production SQL, numbered
migration or native rich-display rollout. Any next copy needs the reviewed
changed-input fixture/envelope, not automatic replay.

## Attempt10 Actual Result

The terminal deletion repair passed focused actual-trigger RED/GREEN, literal
omissions and independent source review. Existing restore/raising suites were
not replayed. One reviewed copy passed full restore, all19 raw allowances,
effective security/settings/ACL/control equality and sealed proof7 reuse.
Ordinary HTTP/session/device/visibility/push eligibility assertions preceding
request80 were reached; the separate read-only RPC positive passed.

Request80 returned200/array1. The next album fixture mutation, fixture-change-35,
exited3. Its wrapped SQL hash was
`369cc9fdca13866200da70c077b9196d6923790849d3e0a84bf5e3bfbbc88555`.
A bounded read-only diagnostic matched that hash and found SQLSTATE23514,
`message_sender_immutable`, with context
`private.enforce_message_sender_on_update()`. The old fixture tried to update
the ordinary root message from text to image and later restore it. The existing
sender/type immutability trigger correctly forbids that transition, including
maintenance SQL. This is not a CHECK-constraint or proposal/grant failure.

Next preparation creates two new fictional image rows and exact notifications,
keeps root text/notification/outbox intact, and uses content-only fictional URLs
with NULL media_path/media_url. Non-null media fields would enqueue
private.media_variant_jobs, whose rows have no message FK and would survive the
current fixture cleanup. Both image producers remain enabled; exact-owned
notification replacement and exclusion of ordinary authority precede album-only
controls. Do not change message types, disable guards or create storage objects.

Parent finite session56865 ended exit1. Copy10 was removed running/exit0/non-OOM;
name/listener namespace absent and production identity unchanged. Album controls,
behavioral mutants, terminal deletion, final rollback and complete fixture
row/sequence/security/raw equality are still unaccepted. No production SQL or
numbered migration. Another copy requires a reviewed changed-input envelope.

## Legitimate QA Session Readiness

The existing owner-provided saved QA state failed the expiry precheck. The actual
read-only probe exited1/SAVED_SESSION_EXPIRED before Auth, SSH or SQL. Its zero
device count is an unobserved sentinel, not evidence that no Android device
exists. No login, refresh, production mutation or personal capture occurred.

A separate normal Supabase refresh of that allowlisted QA state is being prepared:
one physical dispatch, no lost-ACK retry, live identity/JWT verification, original
state hash preservation and an exclusive ignored restricted fresh-state file.
This is not fake session/device insertion. Even a valid refreshed web session
does not by itself prove a matching Android/FCM binding. Native capability,
secure credentials, explicit consent/current epoch and real OS-card acceptance
remain separate from SQL rehearsal and authorization.

## Attempt11 Actual Result

The two-new-image repair passed actual-source RED23514/GREEN: two producer
replacements/photo projections, both suppression/foreign-device negatives, root
row/ordinary authority preservation and core/full selected cleanup equality.
Five compiled omissions were refused. The bounded envelope passed seven compiled
omissions and strict normalization of the four independently reviewed core
blocks; all13 frozen inputs and three snapshots were verified separately.
Initial fixture and full cleanup remained byte-identical. Proposal unchanged.

One reviewed copy passed full restore,19 explicit raw allowances, security/
settings/ACL/control inventory and sealed proof7 reuse. Actual ordinary HTTP,
read-only, both album projections/suppression/foreign-device checks and three
behavioral mutants reached their expected assertions. Request98 returned200/
array1 before terminal deletion. The next fixture-change-41 exited3, P0001,
`d335_terminal_delete_source_not_plain_text`; failed wrapped SQL SHA256
`35b3259e275397a0c2df7fce02f6348b0064701651cb8795e9e012f6e7dcc09f`
matched the exact frozen driver control. A catalog-only production read confirmed
media_metadata is nullable with default'{}'::jsonb; media URL/bucket/path have
no defaults. No personal rows were read. The precheck incorrectly required NULL,
despite empty metadata also representing no media. Correct only this initial
predicate to allow NULL/empty object, while keeping the post-deletion NULL,
content scrub/no-purge and attempted-resurrection checks unchanged.

Parent finite session37924 ended exit1. Copy11 removed running/exit0/non-OOM;
name/listener namespace absent and production identity unchanged. Terminal
deletion, final same-copy rollback and full row/sequence/security/raw equality
remain unaccepted. No production SQL or numbered migration. Source12 preparation
is this measured one-line correction with fresh HTTP context, not automatic
replay or reuse of an earlier HTTP result.

## Normal QA Refresh Actual Result

The normal one-dispatch helper passed focused refresh/probe/ACL/seal controls.
Independent review found the durable intent lacked sync before POST. Its narrow
open/write/sync/close correction passed RED2/GREEN5 and two compiled omissions;
review accepted the changed source. Old controls were not replayed.

One actual attempt exited1/AUTH_REFRESH_REFUSED: postCount1/getCount0/unknownfalse,
restricted parent/effective file DACL verified, freshStateWrittenfalse and no
live Auth identity/device result. No second POST, login, signup, SQL or personal
capture. Empty exclusive state reservation and durable intent remain private;
do not delete them to retry. The false originalUnchanged field is an unobserved
success-path sentinel, not evidence of an original-file mutation. The helper
has no original-file write path. A normal new login for an existing allowlisted
QA account, if needed, is separate from refresh and must verify returned identity;
never insert fake production Auth sessions or device bindings.

## Attempt12 Accepted

Only the initial terminal precheck changed: absent media metadata permits NULL
or an empty object, while the post-deletion scrub and no-resurrection checks stay
strict. Actual selected-trigger RED1/GREEN3 plus a compiled omission passed;
the installed empty-object column default preceded the fictional row insert.
The reviewed source envelope retained prior seals and changed only that predicate.

One actual isolated PG17 run ended exit0:103 HTTP responses,59 controls,
three compiled behavioral mutants and a read-only positive. Terminal deletion,
attempted resurrection/default-none, same-copy header rollback and all row/
sequence/raw-schema/effective-security equality checks passed. Raising plain
positive1, header rollback1, seven compiled raising mutants and eight equalities
are explicitly reused attempt7 evidence, sealed against the fresh12 baseline;
the corresponding fresh12 raising counts are zero, not repeated tests.

The copy was removed running/exit0/non-OOM; its namespace/listener is absent.
Production identity and current source schema/security are unchanged. The exact
proposal hash remains ACE0A223E47EEC9DE30F10A7DF625083195C6CD287A3F4C5AB7DFA2089E66CDA.
This accepts SQL rehearsal only, not production installation or native display.
No further unchanged proposal rehearsal is needed.

## Installation Preparation

The source-only generator reuses the durable one-execute/observe/verify envelope
and immutable proposal body. Independent review found one P2: the security
digest omits dependency columns/defaults/constraints, and its before-check ran
before table locks. Concurrent dependency DDL could therefore evade both guards.
Move locks before authoritative checks and pin dependency definitions, then test
only the changed guards. No generated migration, mirror, backup or production
execution has occurred. A fresh verified backup, reviewed transaction/raising
self-check, byte-identical mirror and real post-validation are still required.

Normal existing-QA password sign-in is being prepared separately after the known
refresh refusal. It must preserve the original state and failed refresh artifacts,
verify returned UID/email/live session, use one durable dispatch and restrict fresh
state before writing tokens. No signup, Auth-admin path, captcha bypass or fake
session/device insertion. Even a valid new web session is not an Android/FCM
binding; that remains an explicit observed gate, not an inferred success.

## Normal QA Sign-In Actual Result

The separate existing-QA password helper passed source review,11 focused controls,
three compiled omissions and syntax checks. One actual normal sign-in passed:
one password POST/one GET user, returned identity/live session verified, no
signup/refresh/captcha bypass/retry. Restricted parent/file DACL, synced intent,
fresh-state write/readback and original-state hash readback passed. Failed
refresh artifacts and original state were preserved; no personal capture.

The separate read-only probe verified Auth signature/current identity, exact DB
target and live auth.sessions membership. It then returned
NO_CURRENT_ANDROID_FCM_DEVICE with devicePresenceObserved true and count0.
Unlike the expired-state probe, this is an observed absence under the new SID,
not an unobserved zero. No SQL mutation or device endpoint reassignment occurred.

Independent review accepts staged server-only installation after backup,
rehearsal, guarded transaction/catalog/preservation and live-JWT recipient plus
negative checks. A device-positive response is required for later native display,
not for additive inert schema. Record nativePositive=false,
richPreviewEnabled=false and canPublishRich=false explicitly. An empty capability
is negative-device evidence, never positive default-none capability evidence.
The MessagePreviews native plugin is absent, so the current UI stays unavailable
and generic v1 remains. Next native prerequisite is an acknowledged actual device
UUID; current registration does not expose it to the preview bridge.

## Guarded Installation Accepted

Installed once on2026-10-07 UTC /2026-10-08 Moscow; versioned migration
`20261007210924_native_message_preview.sql` and its byte-identical mirror have
SHA256 `02681CFB8966EF7DEB362D95538DC4B787986772E4173A0777465A46DC1DE321`.
The original reviewed proposal body remains immutable (ACE0A223...); its
"SOURCE PROPOSAL ONLY" comment is historical provenance inside the install
wrapper, not current status. Do not edit the applied SQL or replay installation.

The wrapper's measured dependency-drift finding was repaired before execution:
table locks precede authoritative checks, security and typed dependency digests
pin relevant definitions, and only the exact new objects/own FK triggers are
excluded from the preservation comparison. Focused PostgreSQL guard RED/GREEN,
compiled omissions and independent review accepted that changed scope; the
unchanged proposal HTTP/raising suites were reused, not repeated.

One fresh backup ran. Preparation stopped after archive completion but before
dispatch; read-only diagnostics verified freshness,15 checksum controls, readable
TOC and private file modes. A reviewed narrow resume verified that same completed
backup, full target archive/globals/raw-schema parity and exact target, then
ran rollback-only lock guards and sealed the numbered SQL/mirror. It did not
take a second backup or dispatch installation during preparation.

The durable one-execute envelope dispatched the reviewed SQL once. Its bound
terminal marker records exit0, table plus three functions exist, and no install
session remains. The first post-check refused on FK pretty-printing:
`REFERENCES users(id)` under a search_path containing auth versus the expected
schema-qualified form. Function bodies/output signatures, columns, constraints,
policies, privileges and preserved security/dependency digests matched. This was
a catalog-oracle mismatch, not a failed SQL transaction or permission repair.

Only the catalog reader changed to `SET LOCAL search_path=pg_catalog,public`.
Actual PostgreSQL canonicalization RED/GREEN and verification-only zero-dispatch
controls passed. Independent review accepted helper47E1D258... . The subsequent
`--verify-installed-only` completed exit0/verified-postchecked, with sqlDispatches1:
it independently observed the terminal state and validated the installed schema,
without calling execute/applyEnvelope or sending the migration again.

Actual live QA-JWT HTTP checks passed: recipient matches the signed-in account,
own consent is empty (default none), both capability and preview reject a proven
unregistered UUID with empty arrays, and anonymous callers receive401/42501.
PostgREST schema-cache reload and exact schema/catalog/grant/preservation checks
passed. No notification was sent, no preview preference/device binding was
written, and no existing message/account/media row was changed by this migration.
These negatives do not prove an authorized-device preview or a rendered OS card.

Private receipts remain restricted: prepared context, one-dispatch attempt and
postproof at `.ops-private/native-message-preview-server-install-20261007-*`.
No archive, token, account identifier, notification content or media is committed.
Rollback remains the reviewed header's four restricted drops only after disabling
consumers and checking exact objects/empty consent; no CASCADE, choice loss or
live-database restore is authorized by this acceptance. D-342 universal recovery
is separate. D-335 remains OPEN with nativePositive=false, richPreviewEnabled=false
and canPublishRich=false; next is the actual acknowledged device-ID contract.
