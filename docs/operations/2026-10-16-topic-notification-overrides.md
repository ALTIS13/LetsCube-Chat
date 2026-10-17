# Topic Notification Overrides: Execution

Owner: coordinator. Branch:codex/topic-alerts-20261016, base05f72b25 in the
main-based android-current worktree. Stage:Task3 structural repair30d8dd80 and
Task4 native/album bindingbdb346f4 source accepted after review and final170/170
PG17 +220/220 dispatcher controls. Task6 fresh backup verified; full-schema
clone lifecycle/recovery and compatible v2 transport remain open. Item77 remains
OPEN, no reachable control or released feature. No production SQL/native release.
[Fullstack plan](../superpowers/plans/2026-10-16-topic-notification-overrides.md).

## Accepted Source Contract

The new pure policy changes only parent mute. Unknown settings and unavailable
independent restrictions refuse alerts. Actual same-chat null/general aliases
share one key; missing, archived, foreign, unread or differently owned topic
snapshots cannot become general. Reader/account epoch is part of snapshot identity.
The module provides display identity/policy, not delivery authority.

Eight literal cases pass after observed missing-contract RED; seven compiled
rule mutants break their independent expected values. Existing parent mute's
expiry/permanent precedence is retained as a real positive/negative control.
General now also needs an owned snapshot: null and actual general both refuse
an archived general row. No shipping consumer uses this contract yet.

## Persistence Draft and PG17 Evidence

The proposal adds own-access SELECT RLS and authenticated RPC-only writes,
server-derived ownership and canonical scope, bounded monotonic revisions and
explicit inherit rows. Concurrent first writers serialize on account/chat; stale
CAS returns the current choice without retry. The actual captured producer gate
retains independent restrictions; enabled bypasses only parent mute. Runtime is
default-off; rollback retains rows and disabled enforcement while stopping the
enabled bypass and new writes. This is a DRAFT, not a production migration.

Final DB/concurrency run:33/33, including12 genuine PG17.6 cases and6 compiled
security-omission controls. The isolated synthetic fixture uses the same immutable
PG17 image, network none, no published ports, read-only root and tmpfs only;
there are no production volumes. Two distinct backend PIDs prove advisory/row
waits, stale CAS, rollback, repeatable-read refusal, session retirement during a
wait, chat classification, membership removal/rejoin and topic archive/delete.
PGlite covers actual captured visibility/DND/global/category policy, timed parent
expiry, message-topic edits, general aliases, read filtering, direct-write refusal,
revision exhaustion and rollback mode. It is not a full-schema restore.

The native test driver initially lost role/JWT by opening a new connection for
each statement. A literal context/role/error-recovery test went RED, then GREEN
after a persistent control connection; earlier results are not treated as full
acceptance. Additional real defects were reproduced before repair: stale session
after a barrier wait, pre-wait chat eligibility, archived-general alias bypass,
and archived/deleted/reclassified preferences being returned as available.
Self-check omissions of private RLS, definer, search path and read-RPC ACL also
went RED before stronger owner/config/ACL checks. Kub typecheck passes.

Task2's parent/message-admission coupling is still dependent on Task3; canonical
CLI-generated migration/mirror registration waits for the composed candidate.
No SQL was applied to production, no client toggle is mounted and no main push
or native release took place. Fullstack, old-client and native acceptance remain
separate gates. Test logs live in ignored output/topic-alert-task2.log.

## Read-Only Preflight

Exact configured production target is PostgreSQL17.6. A bounded source/catalog
snapshot covers13 notification functions and15 tables; every selected public
table has RLS enabled. No message rows, credentials or personal data were read.
The current push policy includes source visibility and DND/global/category gates;
it still uses chat-only mute. Topic uniqueness is one general row per chat;
messages.topic_id has ON DELETE CASCADE, not SET NULL. No old SQL is reapplied.

Local PostgreSQL is18.4 and was not used as PG17 evidence. The explicit isolated,
network-disabled PG17 fixture contains synthetic data and real independent
sessions. No full-dump restore or D-342 acceptance is inferred.

## Delivery Baseline: Task3 Started

Six further captured definitions are hash/owner-pinned: real message fanout,
notification-to-push enqueue, single Web/native rechecks and album enqueue/recheck.
The new delivery fixture keeps those producers and the actual composed policy;
only display-name/avatar/payload formatting and mention recognition are fixture
boundaries. Four controls pass in PGlite and genuine isolated PG17.6. The PG17
driver's SELECT-only query wrapper initially refused a DML-returning helper;
the fixture now uses explicit exec plus a SELECT without weakening the driver.

These controls establish two still-unfixed Task3 failures, not feature success:
disable then re-enable before a single pending alert's first recheck still
delivers it; denial of an incomplete album remains non-terminal and the final
part can revive it. Feed rows and read state remain present in the controls.
The next enforcement must retain those feed positives while making alert
suppression monotonic, including later parts/new subscriptions and rollback.

## Remaining Gates

Preference-state source is implemented separately from delivery: real hook,
store and Zustand with controlled lifecycle/SDK ports,155/155 focused checks
including66 new cases and10 compiled omissions. Account/epoch/chat/mount guards,
in-flight read invalidation, pending versus confirmation, no silent CAS retry,
conflict restoration and reconnect refusal/reconciliation are covered. The
store resets topic views at account retirement. Coordinator removed obsolete
`as never` RPC casts because Task2 types already exist; final typecheck passes.
No mounted production control or use of the view cache as alert permission.

Client presentation/audio is coordinator-owned and still uncommitted/integration
work. Actual hook RED cases now preserve feed/unread without forbidden sound/
Windows cards, permit an enabled child under a muted parent and recheck after
foreground/iconless-retry awaits. A confirmed read while permission waits must
make zero native notify calls, not merely remove a briefly shown card. Duplicate
INSERTs merge metadata without another sound; unknown UPDATE cannot consume
INSERT admission. The guard cache is bounded to the existing30-row page.
Audio authority now follows actual resume, with final live owner/DND/audio/chat
and context-identity checks before oscillator scheduling. The initial double
live-guard implementation consumed the existing send-sound cooldown twice;
real positive controls caught it and the no-authorizer path remains single-call.
Current sound/adjacent43/43 and targeted presentation9/9 pass; full affected
integration remains a separate gate. No microphone/media was acquired.

Read-only publication catalog: supabase_realtime is owned by postgres and is
not all-tables; topics/notifications are present. New preferences require an
explicit publication addition and actual cross-device/WS acceptance; SUBSCRIBED
alone cannot prove it. The isolated PG17 fixture has replica wal_level, so its
catalog proof is not logical replication or authenticated PostgREST acceptance.

The legacy opt-in worker no longer selects raw pending rows and sends directly.
Its actual source now uses maintained claims, a fresh literal-deliver recheck
after the subscription await, and token-bound completion/retry. Unknown/error/
lost-claim results refuse. Permanent errors deactivate the exact subscription
binding instead of deleting it; logs omit backend/provider payloads. Default
opt-in and limits are unchanged. RED2pass/27fail became41/41 with7 compiled
omission controls; unchanged ownership2/2 and coordinator API build pass.
Provider-accepted requests cannot be recalled; an unconfirmed ACK is delivery
uncertainty, not permission for an immediate second send. This is source proof,
not SQL/fullstack/OS acceptance. Edge and the rest of Task4 remain open.

Fresh review of05f72b25..35110e76 found a remaining P2: a same-ID/UID
subscription may change endpoint/keys after lookup but before the recheck;
active/owner checks alone then authorize the cached old descriptor. This is
before provider entry, not the unavoidable in-flight race. The additive bound
RPC and descriptor fingerprint repair is in progress. Until its SQL and all
relevant consumers pass, the legacy checkpoint is not an active-release
candidate. Do not call a second lookup an atomic fix or enable the opt-in.

Task2 delivery coupling and Tasks3-7 remain open: terminal suppression across all
dispatch paths; client ownership/sound/Windows without feed loss; actual
fullstack/migration/rollback/native compatibility; then reachable UI and release.
An old embedded/foreground client ignores new policy fields. A refused native
preview can still produce generic fallback. Neither is solved by an RPC stub.
Do not publish a resolver-only/local-toggle feature or claim old-client parity.
Unrelated sidebar/search/version files and A063 remain untouched.

## Reviewed Client Slice, 2026-10-17

Final affected client integration:181/181, zero skipped; full kub typecheck
passes. This includes actual React/hooks, row merge, Windows serialized adapter
and actual compiled sound scheduling with controlled provider/audio ports.
The stale DND fixture lacked voiceCallSnapshot; only its irrelevant idle-call
boundary was repaired. No production requests, microphone or OS audio proof.

Independent review found two further P2 races. A server decision already in
flight could ignore a received alert_suppressed_at update; eviction from the
30-row snapshot could fall back to the original unread INSERT. Six actual
held sound/desktop cases were RED, then GREEN: terminal update, eviction/read,
and a stale null/missing-field refresh after terminalization. Missing current
snapshot now denies; read and terminal markers remain monotonic. Four compiled
guard omissions fail the literal zero-notify/zero-sound assertions. Delta review
found no further actionable issue. Logs:output/topic-alert-client-reviewed.log,
topic-alert-terminal-client-red.log and topic-alert-terminal-client-green.log.

Message alerts obtain an exact own-ID decision after native foreground/audio
resume awaits, then recheck owner, session epoch, read/pending state, DND/audio,
open chat and context lifetime immediately before presentation. Feed/unread data
is separate. A failed/unknown RPC never grants permission. The preference cache
is display-only. These consumers REQUIRE the additive SQL; do not deploy this
client checkpoint alone or relabel it as old-client/native acceptance.

## Initial Server Review, Superseded Below

The Task3 native run was50 pass/2 fail/0 skip, NOT clean acceptance. All three
bound/setter interleavings passed, including a real deadlock control; two marker
guard cases failed in a SELECT-only test-driver DML setup, before the guard.
An earlier all-case setup refusal was caused by fixture ALTER-target ownership.
Those failures remain recorded and must not count as guard coverage.

Independent source review rejected the candidate for three P2s: source topic
row -> parent-chat lock inversion against actual FK CASCADE; absent topic INSERT
terminalization; and O(history+all album groups) work on ordinary alert paths,
including repeated no-op updates of already terminal groups. Repair must separate
targeted alert reconciliation from rare scope changes, preserve a safe source
lock order, and prove archived-general insert/delete cannot revive admission.
Membership loss/rejoin is also being checked against retained pending alerts.
Task3 source remains draft; no canonical migration or production apply.

Single Web/legacy delivery now binds immutable descriptor bytes through a
versioned UTF8-length-framed SHA256 and additive service-only bound recheck.
Missing/unknown RPC fails closed. Cached inactive state cannot override current
server allow. Coordinator reproduced a second Web bug: a permanent failure for
old descriptor A could deactivate replacement B with the same ID. Retirement
now matches ID, owner, endpoint and both key fields; two RED cases became GREEN,
and removing those filters kills a compiled omission. Affected single/worker/
album source controls98/98, followed by Edge+updated voice fixture60/60; API
build passes. This is not album/native descriptor-binding acceptance.

Album async preparation/final-check ordering remains in progress. Full-schema
restore, authenticated PostgREST, actual provider/OS and old foreground/native
compatibility remain Task6 gates. Current Stable22 and D366 are unchanged.

## Dispatcher Preparation Checkpoint

Commits:4fc8e3af client presentation,57965d69 bound single delivery draft/worker,
1ad0ca3a maintained single Edge and album preparation. No main push/apply/release.
The final client build completed in22.53s with sw.js build549c202c7c1054a5;
existing sourcemap/chunk warnings are not treated as runtime or device proof.

Album now has an explicit preflight -> async prepare -> final recheck -> fresh
payload send boundary. OAuth/topic hashing occurs before the final check. A
changed selected member uses the final payload, not the preflight copy; a changed
chat, invalid payload, unknown/error/refused/claim-lost result cannot send. Only
a prepared provider call can ACK sent/gone; an unprepared sent outcome is a
release/invalid_prepare_outcome, not fabricated provider acceptance.

Seven genuine album failures were reproduced before repair, including the
coordinator's false-sent-ACK contract case. Agent final83/83 includes14 compiled
omissions and focused no-emit/type-contract validation. Coordinator integrated
actual single/legacy/album/voice paths:191/191, zero skips, in
output/topic-alert-dispatch-reviewed.log. Two earlier single mutation controls
hit duplicate anchors after album gained the same retirement logic; they now
mutate only the actual single-delivery function, not both consumers. The prior
162/164 setup result is not called a clean run.

Album Web/FCM permanent failures retire only the descriptor/owner actually sent;
that CAS is not a fresh delivery-binding RPC. Album/native target fingerprints
remain unbound and are a release gate. A second lookup is not an atomic repair.
Provider-accepted requests cannot be recalled. Source checks do not close the
full-schema, PostgREST, real push/OS, old-client or supported-platform gates.

Current callable tool inventory includes Figma, Mobbin, Mobile MCP cloud-device
allocation/release, browser and bounded subagents. No Rive-specific callable
tool was found in this inventory. No paid device or design generation was used
for these backend checks. Visual/mobile minutes belong to the actual rendered/
device acceptance stage, not a substitute for these server contracts.

## Structural and Rehearsal Follow-Up

Task3's first structural repair is still under review, not accepted: native
full65/66 had one SSH metadata refusal in teardown before dropdb; a separate
3/3 run covers that case plus a new read-reopen omission. There was no single
clean67/67 run. The coordinator confirmed one orphan synthetic database and
zero fixture connections in the exact-owned network-none container. A private
cleanup guard now retries only one transport-only metadata read, never an owner
drift or DROP; its literal bounds/identity/refusal controls pass3/3. Final exact
container cleanup remains required after the last native run.

Fresh independent review found two remaining lock edges: preference-row ->
chat FK CASCADE, and UUID-ordered album notification locks versus the existing
unordered mark-all-read RPC. Their structural repair/reproductions are assigned;
do not promote the preceding native/source counts as their acceptance.

Compatibility audit found no existing enforceable rollout boundary. Stable22's
embedded hook ignores the new marker/RPC. Mandatory-update UI, foreground
presence and native-preview protocol1 are not document-level alert capability.
Two PWA documents may share a JWT while running different bundles. Task6 must
exclude legacy direct feed consumers through a tested versioned transport while
preserving the complete feed/read state for the new consumer; one session ACK
must not reopen legacy access. Until this exists, override CAS stays unavailable.
Already accepted provider/in-flight events are outside the pending guarantee.

Native single dispatch also retains cached inactive terminalization and id-only
retirement; token/app_version/session descriptor binding is not yet implemented.
The next Task4 delta owns those native and album bound-RPC consumers together,
with preparation before the final check and exact-descriptor retirement.

Readonly preflight metadata,2026-10-17: exact PG17.6 and PostgREST14.12 images
were checked without application rows. Database size was123063443 bytes, free
backup volume62921773056 bytes and available memory5366521856 bytes. There are
no custom tablespaces or pgrst role/database overrides. Actual exposed schemas
are public,storage,graphql_public, not just public. Four absent environment
settings are not assumed effective defaults. The first startup-shape probe
refused before CLI execution; actual-process configuration evidence is pending.

The new private full-schema launcher has23/23 offline controls and strict
backup/restore/ACL/resource guards; no operational phase, backup or allocation
has run. It does not implement the fullstack driver/seed/candidate test yet.
CLI configuration behavior is checked against the official
[PostgREST14 configuration](https://docs.postgrest.org/en/v14/references/configuration.html)
and [CLI reference](https://docs.postgrest.org/en/v14/references/cli.html), not
inferred from an unset environment variable or a successful HTTP root response.

## Final Structural and Target-Binding Acceptance

Source commits30d8dd80/bdb346f4 are local, not deployed. Reciprocal independent
reviews found no remaining P1/P2 in the frozen Task3 and native/album slices.
The suspected callee-pin drift was disproved by actual assembled function DDL;
the existing literal pins already include NOWAIT. No pin was weakened.

One complete coordinator run on isolated PostgreSQL17.6 passed170/170, zero
failures/skips, exit0,701603ms. It includes all three files:
`topic-notification-delivery-db.test.mjs`,
`bound-native-album-delivery-db.test.mjs` and
`bound-native-album-concurrency.test.mjs`. Log:
`output/topic-alert-pg17-final-integrated.log`. SQL/fixture hashes before/after:

| Input | SHA256 |
| --- | --- |
| Task3 SQL | e2d7c687152eceebe1954e1ec291d50f9af8d610d2bc2cd28fdaeb734edc5c7b |
| Delivery fixture | 94715c00c00915b21fea9f2d77d69d22ab908cf4449e322215539478636e30d0 |
| Delivery tests | e8a2bd3ecd14b602bb6128b6d1c56d934c19f5709f771f822a2d36938c27eb09 |
| Native/album SQL | d9c2d8bc5831c025626db5b194240ec7ddcfb99ca4ae454630dd0fd142238bd4 |

Actual read-all, source/pref FK cascades, descriptor deletion, partial album,
terminal reclassification/read-reopen and loaded omission controls now pass.
The affected real Edge/legacy/album/voice unit run passes220/220, zero skips,
in `output/topic-alert-bound-dispatch-integrated.log`; updated adjacent fixtures
also passed35/35 separately. Existing reviewed client181/typecheck/build evidence
is reused because those sources did not change.

Native descriptors bind ID/owner/platform/provider/token/app_version/session;
typed NULL and UTF8 lengths agree between SQL and dispatcher. Final delivery
cannot fall back to an unbound check. A mismatch releases only its exact lease;
permanent failure retires only the descriptor actually sent. Album preparation
precedes final bound authority and uses the current validated payload. Neither
this nor target locks can recall an already-provider-accepted/in-flight request.

After the last run, the exact owned synthetic container was removed. Read-only
pre-cleanup inventory proved zero other databases/connections and one orphan
fictional database; it was removed with that container. No images or unrelated
containers were pruned. The private cleanup receipt is retained. Foreign root
sidebar/search files and the private Android version overlay retain their four
original hashes.

## Full-Schema Operational Checkpoint

Controlled metadata preflight passed; direct production process-environment
parity is still not claimed. Launcher29/29 offline continuity controls passed.
The actual fresh full-schema/custom archive/globals backup passed source-before/
after, archive validation and checksums, and read-only resume recovered backup.
Production application rows/schema were not changed or exposed.

The first restore refused at clone-create before any container start. Exact
read-only inspection found the owned CREATED/stopped clone with correct image,
network-none/resources/caps/user and declared tmpfs, but Docker's pre-start
Mounts was empty. Requiring realized mounts at that phase was a false refusal.
Mount validation source has been repaired31/31, without restarting the clone.
Review then found a separate real lifecycle defect: the old restore tail would
stop/start the container, discarding tmpfs data. That tail was never reached.

Kuhn owns a private-only supervisor/pg_ctl lifecycle and bounded CREATED-clone
recovery repair. Retain the verified backup, original failure/CID and exact
ownership; no blind restore/backup replay, shared state override or production
service restart. Current r1 clone is stopped, not an accepted restored database.
Full-schema authenticated HTTP, candidate/rollback, v2 transport/legacy fence,
actual delivery/UI and platform rollout remain open. Stable22/D366 are unchanged.

R1 follow-up: a retained actual running synthetic-container receipt also had
Mounts=[], so the first34/34 recovery source was rejected before live use.
Kernel-mount validation then passed36/36. Live one-shot recovery replaced only
the exact CREATED/never-started CID and launched the supervisor, but correctly
refused at clone-start before globals: Docker mounted /qa with default noexec.
No copied production rows/globals/archive were restored. The exact failed clone
was stopped/removed with source-target before/after identity unchanged; original
R1 backup, CIDs and failure receipts remain. No images were pruned.

Explicit exec is now declared only on /qa for the pinned PostgREST executable;
/tmp remains noexec. Coordinator offline38/38 and compiled omission controls pass
in the private fullstack-exec-final.log. Actual /qa exec and full restore/HTTP
are not yet proven. Kuhn prepares a fixed R2 attempt which adopts the verified
R1 artifacts with immutable provenance instead of taking another dump; no live
R2 adoption/allocation has run. New v2 SQL/server tests and pure client/helper
tests are in separate worker scopes; the existing hook is not yet changed.

R2 follow-up: coordinator source controls38/38 plus adoption5/5 passed in two
explicit runs (the first command accidentally selected only the38 existing
tests, so it is not labelled a single43/43 run). Actual fixed R2 adoption passed,
reusing the verified R1 archive with immutable provenance and no new dump. Actual
restore completed globals/archive and preserved the container/tmpfs across
pg_ctl restart, then refused at the strict compare stage. The exact network-none
R2 clone remains running for bounded metadata-only diagnosis. There is no
accepted restore/HTTP proof; no comparison was relaxed and no production SQL ran.

V2 source checkpoint: coordinator server49/49 PGlite passed, but independent
review found missing source/access invalidation for already read/terminal rows;
membership loss could make lookup unavailable without signalling the live client.
Leibniz repairs the new sidecar source emitters without rewriting history or
reopening Task3. Empty-feed refresh also called a1..100-ID lookup with an empty
array; the helper now skips only that empty lookup while retaining real page/
owner authority. A fresh helper plus actual-SQL/parser cross run passes82/82
(80 unit +2 contract), zero skips; log output/topic-alert-feed-v2-client-final.log.
It is not PostgREST/Realtime wire proof. Existing hook remains unchanged.

## Revision and Recovery Follow-Up

The later frozen revision candidate passed one coordinator run205/205, zero
skips/failures: server106, pure helper96 and actual-SQL/client-envelope cross3.
Log: `output/topic-alert-feed-v2-revision-integrated.log`. The previous cross3
RED is retained. This acceptance precedes the next independent finding: a lower
revision could carry read-proof discarded by the higher-revision payload merge.
Hume repairs that monotone overlay and integrates the real hook; the earlier
client typecheck/build is not acceptance of this changed hook.

The logical R2 copy lost real extension-owned search-path settings, schema ACLs
and two indexes. It is not a faithful recovery copy; no drift allowance or
hand-repair was applied. Existing PG17 tools support standard physical backup.
An actual read-only replication `IDENTIFY_SYSTEM` attempt refused at HBA without
creating a backup/slot or changing roles/configuration. Metadata confirms an
existing replication-capable DB postgres and matching OS UID100, plus a writable
exact HBA path. A narrowly scoped temporary local-peer recipe and its failure/CAS
controls are being prepared privately for review. No config write/reload or
physical backup has run. After diagnosis, exact owned R2 cleanup passed through
the pinned launcher: container absent, source identity checked, private artifacts
retained. No candidate SQL, PostgREST, Realtime wire or fullstack acceptance is
claimed.

Changed client coordinator verification passes163/163 (helper105, mounted-hook55,
SQL-envelope cross3), zero skips/failures. Nine changed-helper SQL/producer/
composition checks pass separately. Full kub typecheck and production build
`f5fcce77b542808d`/11.98s pass. Existing sourcemap/mixed-import/chunk warnings remain;
this is not an application deployment. Independent hook review and adaptation of
the older raw-feed test ports remain open; the initial affected run61PASS/59FAIL
is not relabelled as a clean suite.

## Commit-Time Ownership Repair

The migrated affected fixtures exposed a genuine queued React-state race:
`QUEUED_V2_ROW_MUST_RETIRE` failed when a received read frame was queued, its
owner retired, then React applied that frame. The earlier receive-time guard
could not fence a later state commit. The coordinator reproduced the RED before
repairing the actual hook with commit-time functional setters; adjacent loading,
error and redisplay publications now use the same owner boundary. A compiled
guard omission restores the literal failure. The minified wiring sensor follows
the guarded setter and rejects disconnected row transforms/receivers.

One coordinator affected run now passes320/320, zero skips/failures, in
`output/topic-alert-feed-v2-commit-owner-final.log`. It includes the migrated
read/Windows/DND/audio suites, helper, mounted hook and actual SQL-envelope/parser
cross. The unchanged SQL-only106 and dispatcher/PG17 evidence are not rerun.
The earlier215PASS/1FAIL and pre-repair build remain history, not current build
acceptance. Independent whole-integration review was clean before this repair;
the coordinator's genuine RED/GREEN and omission verify its narrow fix pass.

Task7's compact component/behavioral source is being prepared independently while
Task6 recovery gates remain open. No header mount, visual acceptance, production
toggle or release is implied by that parallel preparation. The existing menu/
Liquid Glass and canonical general aliases remain the design authority.

The reviewed feed/actual-hook slice is committed locally as `c82104d2`.
Final changed-source kub typecheck passes; actual build marker
`4a7dbfc49a80fe21` completes in12.78s, retaining the known build warnings.
The candidate is not pushed or deployed. Lifecycle supplement/worker coordinator
verification passes73/73 (44unit +29server), zero skips/failures, in
`output/topic-alert-feed-maintenance-final.log`; its independent review remains
open. Default-off maintenance has no clients/timers/logs, and its actual logger
receives only explicit counters/backlog/error codes. The SDK request has a30s
abort deadline; already accepted database work is not recalled by that deadline.

## Reviewed Preparation Checkpoint

Lifecycle source is committed as `f044e3ae`; independent review found no new
P1/P2. The coordinator API build passes and its startup consumer is present.
Maintenance budgets are explicit: two100-row discovery windows, at most10
accounts/pending IDs, at most1000 retention and1000 orphan event deletions per
tick, plus at most10 fence deletions.24h is an eligibility cutoff, not a backlog
SLA. No Auth/profile deletion trigger or activity-lock change was introduced.

Task7's compact component is committed as `f5e44185`: actual React/preference-hook
25/25 with7 behavioral omissions. A separate final-CSS render batch covers20
fictional states across1440/390 and light/dark, including pending/conflict/error,
long title, keyboard/radio behavior and44px targets. It has zero external
requests/page errors. The first capture missed index.html's colorScheme setting;
the corrected fixture now matches it, and only the affected visual batch was
rerun. The coordinator inspected the contact sheet and individual final dark/
light pixels. Impeccable detector returns an empty finding list. Evidence:
`output/topic-notification-control-source-final.log`,
`output/topic-notification-control-visual-final.log`,
`output/topic-notification-control-contact-sheet.png`.
This is not a header mount, a physical device, fullstack visual acceptance or a
launched feature. Its optional visual harness is pinned to this exact compiled
CSS artifact, not advertised as an arbitrary future-build visual suite.

Private physical-backup source review found a same-CID restart gap: an outer
Docker check plus unchanged cluster ID did not fence a later `docker exec`.
The worker now requires boot/init/postmaster start identity before its effects;
coordinator offline43/43 and restart-zero-write/reload omission controls pass.
Source SHA256332f1754b03224dec930a84e64b9dd6596b892088f38738ba975d79444cb7672.
Both public/generated backup entrypoints still refuse before I/O while reload
equivalence is unproven. No actual HBA write/reload, physical backup or restore
was performed. A separate read-only parser probe's initial positive control
refused; classification/own invocation diagnosis is ongoing, not a production
configuration-error conclusion. Unresolved external-key scope is not waived.

Fresh origin/main remains05f72b25. Outgoing14-commit own-tree check parses74
changed source/test files and resolves71 actual aliases in their own trees;
comments/template strings are not counted as imports. Read-only Coolify metadata
confirms all five repository applications use main. The candidate branch is not
a Stable deployment or permission to bypass the remaining runtime gates.

One final assembled-source run, explicitly QA0 and sequential across the changed
boundaries, passes418/418, zero skips/failures,60657ms:
`output/topic-alert-feed-assembled-source-final.log`. This combines current feed,
hook, read/Windows/DND/audio, lifecycle and compact component checks; it does not
replay the unchanged full PG17/dispatcher suites or establish real delivery.
The four protected foreign sidebar/search/version hashes still match the saved
prestate. No Android, iOS, Windows package or personal production screen was used
for these source/fictional checks.

The first parser refusal was a probe-environment defect, not a proven source
configuration error: env clearing omitted the observed locale archive. A single
corrected calibration and one read-only sweep now pass3/3 controls and43 raw GUC
comparisons, with0 mismatches and20 explicitly unexamined settings.46 parser
executions return0;11 files/61 config rows have stable metadata/load identity and
zero parse errors/pending_restart. Load time predates both new backend starts.
The20 gaps include12 extension GUCs,6 sensitive/command/connection GUCs, one
session/role override and one file-only name. This is not reload authorization.
Independent review additionally found a removed-include selection gap; a bounded
coverage repair/applicability probe is assigned. No full sweep replay, reload or
authentication change is authorized by the positive aggregate alone.

## Reload Coverage Checkpoint

The separate probe's removed-file coverage repair passes the coordinator's
20/20 offline cases, zero skips/failures. It now selects all settings whose
source is configuration file and retains loaded source-file metadata, including
removed include files. A bounded read-only applicability measurement found
zero genuinely loaded-only GUCs; it additionally selected TimeZone, which was
not part of the prior43 equal/20 unexamined sweep. No new parser calls or full
sweep replay were performed. Prior comparison counts remain unchanged.

HBA9/IDENT6 parsed rows have zero server parse errors. No include, at-file or
continuation reference was observed in the checked primaries. The conservative
HBA-shape classifier and three directory contexts nevertheless remain UNPROVEN;
this is not an exported loaded-auth snapshot or permission to reload. Safe
receipts are retained privately. Frozen probe84ac9120/tests dad0e71c; physical
backup332f1754 and its hard refusal are unchanged. No production writes/reload.

The next bounded decision compares a complete, independently recoverable logical
backup package with the narrow peer-auth path. A catalog-derived recovery
supplement would have to be captured consistently and verified as part of a NEW
backup format, not hand-repair the failed R1/R2 archive or waive security drift.
Isolated HTTP acceptance preparation proceeds separately. Main, Stable22 and
the accepted D366 runtime remain unchanged; the candidate is shared on
codex/topic-alerts-20261016 at5eea874d.

## One-Transaction Candidate Preparation

The coordinator added scripts/topic-notification-candidate.mjs to assemble only
the six frozen proposal digests in dependency order. It imports without database,
network or filesystem-write effects and returns the SQL plus digest/manifest;
it is not canonical migration registration or an apply command.

The RED baseline joined the existing independently committed drafts: a later
failure left the first table committed in real PGlite. Collapsing the envelopes
then exposed LOCAL-role and setting leakage between original stages. Independent
review additionally reproduced CR-comment and Unicode-identifier lexical holes
in the incumbent-style scanner. These findings were fixed by replacing that
scanner with the real PG17 grammar, not adding keyword exceptions. Candidate
execution refuses a pre-existing bounded SET ROLE context before DDL and restores
the captured session search_path/timeouts and session role before each stage.

libpg-query17.7.4 is an exact development dependency, WASM/PG17 parse-only, with
MIT license and integrity pinned in pnpm-lock.yaml. Its sole dependency
@pgsql/types17.6.2 is also MIT; installed license notices are retained. There is
no frontend import or new runtime service. Installation used --ignore-scripts;
the existing LiveKit peer-type warning was not changed or hidden. Upstream:
https://github.com/constructive-io/libpg-query-node/tree/17-latest and
https://www.postgresql.org/docs/17/sql-set-role.html.

Final changed-source32/32 passes, zero skips/failures, including real rollback,
caller-context, LOCAL baselines, UTF-8 byte boundaries, hash refusal and seven
compiled literal omissions. Log: output/topic-notification-candidate-final.log.
The assembled117198-byte candidate has SHA256
4dacb35beedd1dd4d312b836d4c5d4b52462476bba5c886d55233d8070e9f537.
It parses with PG17 grammar; this does not replace full-schema execution, restore,
wire or production acceptance. Prior418-source evidence remains separate and was
not repeated. R3 snapshot-bound logical capture/restore and the bounded HTTP
fixture remain in preparation. Physical backup stays hard-refused.

## Isolated HTTP Harness Checkpoint

Source1787e9c5 contains the reviewed one-transaction assembler;0e2463f1 contains
the bounded HTTP harness. The latter's coordinator selftest now passes48/48,
zero skips/failures, explicitly QA0. Independent review found two P2s: caller
args could change after scope validation while inspect awaited, and decision
checks did not assert the known scope/revision values. Genuine held-port REDs
and loaded omissions verify the repair: the exact frozen JSON wire is validated
before awaits, and known decision scope/revision are literal assertions.
Log: output/topic-notification-fullstack-selftest-final.log.

There is no real HTTP bridge/fixture yet. SELFTEST_ONLY is explicit; none of
these48 checks claims HTTP/Auth/Realtime/provider acceptance. Missing runtime
inputs fail rather than skip or use production configuration. The finite HTTP
slice attaches only to an existing pinned clone and does not implicitly allocate,
seed, apply SQL or replay failed requests.

R3 logical pipeline preparation passed the coordinator's17/17 focused cases,
zero skips/failures, including actual PG17 AST/bundle and in-memory metadata
supplement. Frozen source8de02a17 was submitted for independent review. A single
actual read-only preflight refused at control/OperationFailure127 before creating
its evidence root. A separate bounded read-only inventory confirmed host Node and
nodejs are absent, but an existing worker image has Node24.21.0. No package was
installed or backup/restore run. The scoped solution under review is an owned,
network-none parser container using that existing exact image, mounting only the
public parser code/WASM read-only, never the secret backup root. Physical auth
and all production application data/configuration remain unchanged.

R3's framing/CR repair and isolated parser adapter passed coordinator25/25,
zero skips/failures; the actual bundled CLI emits exactly64 hex bytes plus LF,
with empty stderr. The initially suspected escaping defect was disproved, not
patched. A read-only adapter preflight nevertheless refused on a real Docker
template parse error. Bounded boundary diagnosis confirms source identity, paths,
capacity and namespace pass; only the image-format probe fails. No root or
container exists from these preflights. New adapter review found durable intent
could be lost on a delayed create and ordinary TERM bypassed cleanup; both are
assigned to the adapter's one fix pass, alongside the actual formatter repair.
The previous25 tests are not acceptance of those changed runtime controls.

## R3 Actual Attempt and R4 Direction

Final R3 source128b1694 passes the coordinator's31/31 focused cases. Actual
read-only preflight passes after using structured inspect instead of the broken
custom Go template. One backup invocation then refuses at schema/OperationFailure
137 during the mandatory synthetic parser control, BEFORE the exporter opens or
any database dump is captured. Exit137 does not establish OOM or another cause.
Exact owned cleanup passes; parser containers are absent and private partial
control/failure artifacts remain. No application SQL/config/auth or clone changed.

The selected R4 direction avoids further remote-runtime work: capture the same
snapshot-bound archive/reference/integrity on the server, transfer ONLY the schema
SQL files byte-for-byte into ignored private local storage, verify their captured
hashes and run the already working pinned PG17 parser locally. Remote restore
still requires strict catalog/index/ACL/data/sequence/isolation checks; a final
local hash-bound source/restored schema comparison completes the package proof.
Intermediate capture/restore states must explicitly say AST pending, not verified
recovery. The exporter must close before local transfers; globals and row data
stay remote. This is trusted coordinator evidence tied to immutable artifacts,
not a new untrusted caller boolean or an excuse to waive schema comparison.
R3 remains frozen; Hume owns only new R4 files and reuses the reviewed components.

## R4 Capture and Actual Schema Equivalence

Frozen R4 source13438c81 passes the coordinator's16/16 focused cases, zero skips.
The previous preflight refusal was generated Python's invalid-escape SyntaxWarning:
actual preflight passed but strict transport correctly refused its stderr. The
raw-regex fix now compiles with stderr0 and warnings-as-errors, without weakening
transport. The local capture receipt/byte gate precedes any original restore call.

Actual R4 preflight and snapshot-bound capture/integrity pass. The exporter closed
before transfer; only the two schema files were byte-transferred. New local
directory ACL allows only the current user/System/Administrators, with zero other
allow principals. Capture manifest SHA256 is
c080298de3d04fc03f972e531d260ff47575f774bea7feb8ef7559556615c9a0.
No clone, candidate migration or production application SQL has run.

The old reader refused the REAL dump's three same-key restrict/unrestrict blocks
and two same-DB reconnects (quoted source name/plain archive name). The immutable
capture was not changed or repeated. A NEW local verifier-v2, separate from the
frozen generators, validates complete PG17 SQL segments and exact psql transitions.
Coordinator11/11 passes, with five loaded omissions. Actual byte-bound capture
verification passes4817 statements/3 blocks/2 reconnects; source/archive share AST
hashad5315f1c18776610ecaef7fde3b12e48d3858ae63ee59fc4f96ffcd3d8867bd.
Its source3e13f258 and tests2da76d16 are independently reviewed before clone restore.
Capture-generator pins and verifier pins are separate; no old receipt is forged
and no unverified intermediate state is called full recovery. Receipt is private
capture-ast-v2.json. Strict restore/data/ACL and final restored AST remain open.

## R4 Restore Refusal and Logical Recovery Diagnosis

Independent verifier-v2 review found parseable EOF was not necessarily a terminated
psql statement at a meta boundary. The coordinator reproduced RED before requiring
a positive terminal RawStmt length; a loaded omission restores the failure. Final
13/13 passes. Sourcee01cf360, tests6651e0d2; the old3e13f258 receipt was preserved
as superseded, not overwritten. Actual unchanged4817-statement equality passes
with a fresh current-verifier receipt.

One gated R4 restore ran against the owned network-none clone and refused at the
strict catalog boundary, before final data/sequence/control acceptance. The clone
was held only for bounded read-only diagnosis, then exact R4 cleanup passed.
No candidate migration, source repair or application SQL ran. All capture files
and failure/diagnosis evidence remain private and immutable.

The diagnosis separates representation from a real recovery defect:1531 columns
match by dense name order and every other property.62 raw attnum differences in8
relations correspond to11 actual dropped-column slots (attisdropped/type0).
Four constraint definition strings differ only in redundant parentheses, with
equal actual PG17 ASTs preserving casts/literals/operators. However, graphql and
graphql_public each truly lost four USAGE grants: owners match, no extra grants.
They are not direct extension members and were omitted by the supplement's
extension-only schema selector. This is NOT a verified recovery.

The new bounded restorer2 uses the same captured archive/reference, a fresh owned
clone/intent, full owner/grantor/grant-option recovery for ALL14 captured non-system
schemas, logical column ordinal comparison and actual PG17 constraint AST proof.
No diff-driven two-schema allowlist, string stripping, hand-repaired failed clone
or unnecessary fresh source dump is selected. Constraint-only SQL witnesses are
additional private DDL verification inputs, never globals, message rows or catalog
password bodies; their bytes/pins must join the final proof. Full data/sequence/
controls and source/restored schema AST still precede any recovery PASS.

## Restorer2 Actual Checkpoint

Frozen restorer2 modulef18f2bdf/tests6479fa23 passed coordinator15/15 with five
loaded omissions and independent review without actionable P1/P2. It ran once
against a NEW exact owned restore2 clone using the unchanged R4 capture, not a
hand-repaired failed clone. Actual server comparison passed logical columns,
constraint identities/properties, ALL14 schema owners/ACLs including grantors
and grant options, other catalog groups, data, sequences and extension controls.
The intermediate receipt explicitly remains verified=false/AST pending.

Three private DDL files downloaded with exact byte hashes; download manifest
9c9d7474...11eddfb50. No globals, user rows or password catalog was downloaded.
Local final verification refused RESTORE2_SCHEMA_AST_DIFFERENCE. Both constraint
witnesses were parsed, but their equality assertion occurs AFTER the schema
assertion: constraint AST equality has not yet been accepted. No final verified
receipt exists. The exact owned restore2 clone stays network-none for bounded
read-only diagnosis; original R4 clone remains absent. No source repair, HBA
reload or production application SQL was performed.

Next: classify the actual local AST difference without exposing SQL literals,
changing immutable captures or replaying restoration. Only a proved decomposition
with exact catalog coverage may replace a raw representation comparison; any
uncovered structural/ACL difference must still refuse. In parallel, bounded
synthetic seed and HTTP transport source work may proceed, but may not attach,
apply SQL or claim actual Auth/HTTP/Realtime/delivery acceptance.

## Exact Comment Calibration and HTTP Preparation

Local diagnosis established eight additional schema GRANT statements, one schema
comment and thirty default-ACL statement position changes, not just GRANT drift.
All768 constraint witnesses independently match actual PG17 AST. Default ACLs
contain the same78 statements:18 inversions are disjoint GRANT/GRANT operations;
all78 per-recipient subsequences, including privileges/options, match. The full
defaultACL catalog remains strict. No generic sorting or ignoring comments is a
valid recovery proof.

One bounded calibration ran inside the owned network-none clone in a NEW empty
database, using the exact binary/options for default/NULL/custom schema comments.
The temporary database was removed; only three tiny DDL controls and the captured
ALL14 schema ACL/defaultACL projection plus two direct extension schema names
were downloaded, byte-pinned in private storage. Probe receipt a7280875...319847.
Review found its before/after logical comparator omitted constraint definitions;
the original probe stayed frozen. A separate raw comparator went RED on actual
CHECK expression drift, then GREEN; an actual READ-ONLY full raw-catalog match
against the saved restore2 reference passed, including definitions and incarnation.
Raw receipt fa7b39d4...babaac. No calibration was replayed to repair that proof.

New finalizer3 source initially passed15/15 with seven loaded omissions. It models
all twelve non-extension schema comments from the actual dump/calibration, leaves
the two unknown direct-extension schemas untouched, and requires combined exact
ACL/catalog/data/sequence/control proof plus schema/constraint AST. Its initial
local plan was preserved as superseded, never executed. Independent review found
an ACL change could occur between the catalog read and final schema dump; Hume
owns a held-case RED/GREEN fix and post-dump raw-catalog closure before first run.
Verified recovery and application SQL acceptance remain open.

HTTP transport source passed17/17 including actual bounded loopback/subprocess
abort and three omissions; no live HTTP call occurred. Initial seed21/21 uses
captured DDL and four real trigger functions in PGlite; prepare17/17 covers ports,
three explicit COMMIT boundaries and incarnation, not PostgREST startup. Those
do not substitute for full restored PG17 execution. An actual READ-ONLY clone
input check found invitations ARE required (receipt9e1c3bf1...c088af). The original
seed correctly refuses; Leibniz owns a distinct legitimate synthetic-invitation
variant, using real consume hooks, not disabled RLS/triggers, policy changes or
another person's admin account. PostgREST/JWT/attach and real HTTP remain separate.

Checkpoint6d9778a6 is pushed only to codex/topic-alerts-20261016. No main push,
production application SQL, HBA reload, native publication or paid-device
allocation occurred; Stable22/D366 remain unchanged.

## Combined Recovery Accepted

The review's ACL race was reproduced using the actual generated phase: a grant
option changed during the final schema capture. New post-dump exact raw-catalog
comparison refuses that case; its loaded omission reintroduces the false proof.
Final sourceacd96db4/tests919abdf2 pass18/18, zero skips. The superseded local plan
was retained; the current plan is04477a26...33a0b9. No old generator/capture or
intermediate refusal receipt was rewritten.

One actual finalization ran only on the existing owned network-none clone and
passed catalog, ALL14 schema ACLs, calibrated twelve non-extension schema comments,
default ACLs, data, sequences, extension controls and post-dump raw-catalog closure.
Phase proofaeab668b...49c467 remained AST pending. Its final schema downloaded
byte-identically:1900000 bytes, SHA230d0cdf...342d623.

Actual local final verification now passes: receiptc6ec17759f967e24e5b4d261ea18b826ef745b08332d83529bac89d3171b2ee3,
scope logical-recovery-effective-acl-calibrated-comments-disjoint-default-order.
Unfiltered AST equality is explicitly FALSE (4817/4825 statements): the eight
additional schema GRANT statements are covered by exact owner/ACL/grantor/grant
option catalog equality.18 default-ACL inversions are proved disjoint grants,
with unchanged exact statement/subsequence sets and final defaultACL catalog.
All other structural ASTs match; all768 complete constraint ASTs match. Unknown
direct-extension schema comments were not rewritten. This is a concrete combined
recovery proof, not a claim that pg_dump text/ASTs are identical in all respects.

Next: actual clone-only candidate transaction and legitimate synthetic invitation
fixture, followed by exact PostgREST/JWT startup and HTTP acceptance. The original
seed correctly refuses the actual invite-required policy; its new variant must
use the real consume hooks. No application candidate, synthetic-account seed,
PostgREST start, real HTTP/Realtime/provider acceptance, production SQL or native
publication has occurred. Item77 remains open; the clone stays bounded to Task6.

## Actual Candidate and Invitation Fixture

New immutable invite seed11f14aee/tests0ef7e620 passed22/22 PGlite/source checks,
including real captured consume hooks, exact two uses, ordinary-user-only roles,
expiry/revocation/collision refusals and three loaded omissions. New prepare
012cac86/testsa81a960a passed15/15 kernel controls after a held post-enable-failure
repair. A best-effort runtime OFF is permitted only under the same CID/DB epoch;
unknown incarnation/ACK remains UNKNOWN and forbids adoption/retry. Failure
intent survives before compensation. Old seed/prepare artifacts remain immutable.

Independent review found no new material seed/prepare-invite defects. The
coordinator first generated the actual-proof-bound inert plan7debf588...e3304182
(251507 bytes), then executed it ONCE only on the existing owned network-none
clone. Candidate4dacb35b, invitation/accounts/sessions/chat/topics and initial
enable all returned their three explicit COMMITs; the full restored PG17 trigger
chain and seed self-checks passed in7.5s. No policy/GUC/RLS or trigger bypass was
used. Initial-stage bytes are privately pinned at
a098eeb470eb5d0444e0ff6f0513ba982047de79c894c829659a7c8b17bc35ee.

This clone is NOW modified by the candidate: do not replay baseline restore,
finalizer or candidate application against it. Future attachment uses the actual
initial-stage/catalog/fixture pins. No PostgREST or real HTTP acceptance yet.
The first PostgREST source15/15 gained failed-prepare marker guards (17/17).
Independent review additionally reproduced a DB restart after the first SQL guard
and loss of false/retired flags in private credential reads; Hume owns that one
fix pass before first startup. A source-pinned inert starter builds successfully;
JWT issuance/startup is intentionally delayed until the finite HTTP bridge is
ready, avoiding credential expiry while source is prepared. Production and native
packages remain unchanged; no private credentials are printed or committed.

## PostgREST Runtime and Fresh Guard Batching

The first actual startup refused before HTTP: the PostgreSQL-only binary path
was incorrectly reused for env/timeout/cat. The clone remained alive, unchanged
incarnation, no restart/OOM. Exact runtime paths and bounded timeout were
calibrated on that clone; the binary itself reported PostgREST14.12. One reviewed
explicit forward recovery archived the failed payloads and retained the original
intent byte-identically before starting the service. Ready metadata is pinned at
e0054b530cdf484b7b0952b2819dee6cfb556dd3cea3e2ffceac21a94872aceb.
Original failed artifacts and forward/archive proof are separate, not rewritten.

A Windows child-process minimal environment then prevented SSH attachment. A
safe true-command differential isolated that environment contract; only the new
bridge's local spawn adapter inherits process.env. Frozen PG/transport/server
ready were not changed. Actual readonly attach and three guards passed, zero
HTTP requests: attach9222ms, checks4252/4081/4256ms. This is not HTTP acceptance.
Roughly155 SSH calls would exceed the unchanged public180s scenario deadline.

The correction batches the same fresh Docker/process/key/config/role/fixture/
runtime/full-catalog/DB-epoch checks, rather than caching results or raising the
deadline. Original service evidence is kept distinct from short-lived client
credentials: a new900s lease uses the existing isolated key and fresh actual
session validation, with a new private proof/pack, never a rewritten old ready.
Fast source38/38 and lease source15/15 passed together53/53, zero skips. Independent
review found one P2: the inherited QA issuer omitted is_anonymous=false required
by the real SQL identity function, while the frozen driver accepted exactly the
old seven claims. Hume owns one focused new-lease issuer/compiled-validator fix
with a token-to-actual-SQL RED/GREEN control. No old lease was issued and no real
HTTP/CAS request has been sent. Actual speed and HTTP48 acceptance remain open;
Realtime/provider/client/native/production acceptance is still separate.

## Old Consumer Compatibility Boundary

Readonly source analysis confirms the candidate already fences the legacy feed
account-wide in the same transaction as the first successful explicit enabled/
disabled preference. The restrictive SELECT policy and private fence do not
depend on a document's ACK, heartbeat, session list or package version. Old and
new tabs can share a JWT/session, so a new per-session capability registry would
not solve that boundary. The v2 reader retains own visible history/read state;
the current hook has no legacy fallback. Returning to inherit or runtime rollback
does not erase the fence or terminal alert suppression.

This is a deliberate old-client upgrade cost, not feed-row deletion. Actual
legacy REST before/after activation, an already-subscribed WebSocket, same-JWT
old/new consumers and Windows focus refresh remain required runtime checks.
Already-authorized queued frames/callbacks and provider-accepted cards cannot be
claimed recalled merely because future SELECT/alert admission now refuses.
No separate capability schema or unchanged-old-client compatibility is inferred.

## Corrected QA Identity and Measured Budget

The review P2 went genuinely RED at both boundaries, then GREEN: new lease
691937cd/tests7b870920 pass19/19. It adds literal is_anonymous=false and recomputes
HMAC; the new compiled validator accepts exactly eight claims and boolean false.
The actual SQL identity gate is exercised with ordinary/anonymous/missing claim,
expired/foreign session and ban cases. Frozen PG/transport/bridge/server evidence
was not rewritten. One actual http-r2 QA lease was issued, metadata-only proof
e4f47a71918ab1f36f3591c7379adde9cedf2b924fa7670bfca1ecd75958ae1e. Its bound driver
d2a2bb7a0935f91c47372c38b9874ce05c6adc542095291f6b7adddc35524033 attached in1941ms;
three fresh guards took2013/1928/2198ms, with zero HTTP requests.

A single-SSH readonly timing control then located the cost: server4223.562ms of
host5382ms, three fresh guards1426.271/1390.188/1347.747ms. Each batch took1261-
1318ms; Docker inspections took38-63ms. Nine Docker calls, no HTTP or lease issue.
That disproves the earlier dominant-SSH hypothesis. Persistent SSH alone would
still exceed180s, so its unexecuted prototype was stopped and retained.

Ruling: the original180s TEST budget had no measured basis. Keep every fresh
catalog/identity/epoch/role/fixture/lease guard,15s individual operation and80 HTTP
cap, but allow a finite480s total (500s runner wrapper), below the900s QA JWT TTL.
This is not a production timeout or permission change. The literal virtual-clock
case went RED after210s against the old helper, then GREEN through479999ms and
refused at480000ms; loaded180s/600s mutations are detected. Selftest51/51, zero
skips, independent focused review accepted. Current helper140fe16a/tests1ff27bff.

The actual48-request HTTP/CAS/session/rollback scenario has now started ONCE on
that owned clone. Its attempt marker is durable; completion is not yet known.
Do not retry or reseed after an interruption/unknown commit. Realtime, provider,
client/native, old-consumer and production launch acceptance remain open.

## Actual HTTP Slice Accepted

The single http-r2 attempt completed successfully in313158ms, under the measured
finite480s limit. Receipt SHA256:
b7b319422af1d6ad44eedad6ebabf009a9a9c2614328a4b9d75fe55a98055150.
It records48 real authenticated HTTP requests, boundary
HTTP_CAS_SESSION_ROLLBACK_ONLY and explicitly fullstackAccepted=false.

Actual PostgREST/PG17 confirmed account-owned CAS/read across two A sessions,
stale-revision conflict, independent B preferences, null/general alias collision,
four real message producers and fresh alert decisions. Disable makes previous
alerts terminal even after re-enable; the retired oldA JWT is refused for read
and write. Runtime rollback refuses new preference writes/reads, preserves
revision/history and suppression, and resume does not revive old alerts. A new
post-resume message remains eligible under the newly confirmed preference.
Feed payload/read/created history hashes and the terminal timestamp are retained.
No policy/producer was mocked; no provider/OS acceptance follows from that fact.

The clone now intentionally has oldA retired, runtime enabled, A topic revision5,
general disabled revision1, second topic enabled revision1, B topic revision1,
and account-wide legacy fences for A/B. Do not replay the completed slice,
restore/reseed or erase fences to obtain preactivation controls. The original
candidate/ready/archive/lease/attempt files remain intact. Test budget source is
commitede0024c; no application-source change, production SQL/main push or native
publication occurred. Next: readonly Realtime image/schema/replication preflight,
then one actual legacy WS/REST compatibility slice using a separately owned fresh
fixture. Real WebSocket/client/provider/native and launch gates remain open.

## Actual Realtime Preflight

New readonly metadata source passed 13/13 and independent review. Its first
actual inventory refused at Docker's image-format contract; no metadata acceptance
was claimed. A bounded diagnostic located the image-only formatter. An actual
controlled pair kept all fields and changed only image .Id to .ID: the original
refused, the latter passed. No raw image configuration or stderr was printed.
The original generator/attempt stayed frozen; a minimal new wrapper went RED on
the literal field, then 6/6 GREEN including generated selection and drift controls.

Actual V2 preflight passed with clone/PG epoch checks before and after:
receipt SHA256 04ad8b765b7a2c01943665b8596c1c84fcdfdaaa80661f88aad322c224c56540.
The running service is supabase/realtime:v2.102.3, image/repository digest
sha256:aa1c92c0cf326007563641730ec9da9c60478caa6853887775365fa2c097a471.
Optional version/revision labels are absent, not invented from the tag.
The clone has zero slots/senders, capacity10/10, and both realtime/_realtime
schemas with schema_migrations(version bigint, inserted_at timestamp(0)).
Migration-version rows, tenant data, service configuration and keys were NOT read.
The 36-table supabase_realtime publication contains notifications and
notification_feed_events_v2. This is metadata, not successful WAL delivery.

Concrete next gate: clone wal_level is replica, not logical. Starting Realtime
now cannot prove actual logical replication. Prepare a reviewed clone-only,
data-preserving PostgreSQL epoch transition: verified owned QA backup, exact old
process/arguments/settings, all catalog/data/sequence/role checks before/after,
socket-only/cron-off/network isolation retained, and a new append-only receipt.
Do not restart the container, rewrite old initial/ready proofs, reset A/B fences
or restore/reapply the accepted candidate. No such restart/configuration change
has occurred. Actual Realtime startup, migration-history compatibility, fresh
unfenced fixture and SDK/old/new consumer checks remain open. Production is unchanged.

## Realtime Startup Boundary and Target Choice

The exact public tag resolves to `cd952f26787d764b357eec01568f680137756293`;
this pins source research, not proof of the image build's provenance. Its
[entrypoint](https://github.com/supabase/realtime/blob/cd952f26787d764b357eec01568f680137756293/run.sh)
always runs metadata migrations. Self-host seeding additionally replaces the
matching tenant and performs maintenance; it is not appropriate for preserving
the restored fixture. First tenant connect also runs migration reconciliation,
partition creation and broadcast replication even when that entrypoint is bypassed.
[Connection source](https://github.com/supabase/realtime/blob/cd952f26787d764b357eec01568f680137756293/lib/realtime/tenants/connect.ex).
Exact history sets matter: 31 metadata and 72 tenant migration versions are in
this source; neither their presence in the clone nor a no-DDL startup is proved.
Do not forge migration history, copy real tenant secrets or blindly seed/upsert.

Ruling after inspecting the existing supervisor/restorer: a separate RT-owned
clone from the SAME immutable capture is less risky than extending the accepted
HTTP target through a PG restart and subsequent Realtime DDL. The supervisor can
survive a PG-only restart, but that would need backup/argv/epoch/rollback handoff
and still lose the frozen catalog boundary during RT startup. The new target
instead boots with complete socket-only/cron-off/net-disabled options plus
logical WAL, under a new owner/root/intents/proofs/cleanup scope. Capacity for
the additional bounded clone and RT process must be checked first. Capture
owner/root/pins remain distinct readonly inputs; changing a name or relabelling
an old receipt is not sufficient.

Accepted recovery/ACL/comment/constraint/data algorithms are reused, not rerun
as work on the old target. Applying the candidate and a fresh unfenced fixture
once on the new target is a new Realtime stage, not another HTTP48 replay.
The existing HTTP clone, data, fences and all original proofs stay unchanged.
Hume owns the inert adaptation, Kuhn readonly source/clone history/component/
plugin/role/tool metadata, and Leibniz independent review. No new allocation,
PG restart, configuration change, migration-history write or RT startup occurred.

## Actual History and Tool Metadata

The first history probe's nullable-timestamp assumption was caught against the
actual earlier receipt before execution. Its version column remains NOT NULL;
nullable inserted_at and NULL values are accepted only when that column is
actually nullable. Two genuine RED cases became 24/24 GREEN. Independent review
found no other material issue. Its first actual run refused at tool inventory,
not at source/clone history queries; no full metadata acceptance was inferred.
Narrow diagnostics and a known-file control proved readlink -e unsupported in
this image while -f resolves the existing regular target to the known hash.
The frozen probe was retained; a two-flag-only wrapper passed 10/10 with regular
file, stat/resolution-race and omission controls.

Actual complete history V2 receipt:
`4afbb84984274c9485ecb06271a9d410098cf27191751910c65d038f59efd29b`.
Source/clone identities, PG epochs and both snapshots were checked before/after.
Both exact version sets AND rows match: 72 tenant, 31 metadata. No history-copy,
recovery or fabricated version rows are needed. Other production data/config/
tenant rows/keys were not read. The declared 12-component fingerprint projection
differs in seven groups: schemas, relations, columns, constraints, indexes, types,
triggers. Columns count 190/185; other component counts match. Routines, policies,
default ACLs, sequences and extension members match, with no unsupported shapes.
This is not full-schema semantic equivalence or proof of actual schema drift.
Readonly per-object/field classification is next; no normalization/waiver is implied.

socat/python3/perl were absent only at the selected paths, not proved globally
absent. wal2json 2.6 and pgoutput are regular hash-bound files, not execution or
replication acceptance. Startup remains explicitly false.

The separate R5 clone adapter initially passed 16/16 and generated an inert
actual-input-bound plan. Independent review found two P2 correctness defects:
the local DDL verifier did not validate a contradictory/missing logical epoch;
cleanup could falsely report absence after a known CID was renamed. One focused
RED/GREEN fix pass is underway. The old plan is retained and has NOT executed.
No new allocation, container/PG restart, history write or RT startup occurred.

## Separate Logical-WAL Recovery Accepted

The two clone-adapter findings went genuinely RED against the frozen original,
then GREEN: missing/contradictory local epoch now refuses; renamed or unknown
saved CID cannot produce a false cleanup success. Final source 6963e42a/tests
4fecf8d8 pass 22/22, zero skips, including two new compiled omissions. Original
source/tests/inert plan stay preserved. An actual new-input plan was pinned;
readonly preflight passed target absence and sufficient memory/disk capacity.

One restore then ran ONLY on the new owned R5 target. Remote proof
`169345999e1839636ab5d4a1856c8a6e666ce7a7d156742af9a82d2f0cb041aa`
confirms logical WAL, catalog/data/sequences/controls/comments and 768 constraints,
with AST still pending. The new file manifest and fresh epoch guards confirmed
all three DDL hashes match the already retained local bytes, so three artifacts
were reused and none redownloaded; no old receipt was relabelled as new.

Local new-target schema/constraint verification now passes:
`2441c65f68a6ad9fd5bd35444102fbe4b4d9552355b733cd364f2efa6353a878`,
scope separate-realtime-logical-recovery, verified=true. Logical WAL and distinct
CID/cluster from the protected HTTP clone are confirmed. This is baseline
recovery acceptance, not candidate/fixture/Realtime or production acceptance.
Do not replay restore/finalizer/reset on R5. Original R4 HTTP data/proofs remain
untouched. Next: a current candidate plus fresh ordinary invited, unfenced RT
fixture with both parents allowing alerts, then actual SDK/old-new consumer wire
checks. Token issuance/startup waits for the finite runner preparation, not a
new owner approval. No new R5 candidate/JWT/PostgREST/Realtime start occurred yet.

## Realtime Preparation And Actual Fixture Refusal

The reviewed per-object classifier passed15/15 and ran once, receipt
ff73e83d3f48aeb72d32fac4ce1eb96d765a11c979df74d217163845ad50594f.
It retains exact natural keys, physical dropped slots/attnum, missing-value
metadata, partition inheritance and generated constraint-trigger names. Live
partitions now include20 October instead of the retained13 October. No raw
defaults, function bodies, tenant rows or keys were exposed; no normalization
or full semantic-equivalence/recovery waiver is inferred.

The official anonymous Node22-alpine pull and isolated nonroot/network-none
runtime smoke passed at image digest0a7108bf...bc2e402, Node22.23.3. The temporary
container is absent afterward. The original script was rejected at compile time
by strict Python escape checking, before any server intent/effect. A new pinned
wrapper changed only the version-regex raw-string prefix; original evidence stays.
Pinned image run.sh/server script hashes match the selected upstream scripts,
not an attestation of the whole Realtime image build.

New prepare1f60d90a/tests cb5417e9 and classifier2f6d3f1a/tests ab0bef53 passed
29/29 coordinator checks, zero skips, and independent source reviews. Actual R5
candidate COMMIT is acknowledged, but seed failed before enable. Readonly state
confirms zero QA users/chats/sessions and runtime=false. The failure markers stay
intact; no candidate/seed/reset replay or successful-stage adoption is permitted.
A rollback-only diagnostic obtained P0001, then a changed-verbosity diagnostic
identified RT_SEED_UNFENCED_REQUIRED, with unchanged post-state both times.
Source inspection localizes the incorrect assumption: real chat_members INSERT
triggers emit invalidate events even with no legacy fence. The guard combined
zero fences AND zero events. Correct the fixture to retain and explicitly account
for legitimate invalidations, never delete them or disable the production trigger.

Actual SDK/old75096aa3/current-hook baseline preparation passes14/14 and produces
a self-contained Node22-target bundle, not actual wire acceptance. Disabled CAS,
rollback and already-authorized callback boundaries remain open. A bounded
stdin/stdout inspector protocol lets an external host guard freshly verify owned
Docker/PG/service state without a Docker socket or production mounts in clients.
No R5 JWT issuance, PostgREST/Realtime start, native or production action occurred.

## Full Fixture Measurement And Relay Fallback

The reviewed forward seed4f59c5fa passed17/17 and independent review, but its actual
seed transaction also refused before enable. New intent/failure evidence is kept;
no seed ACK, enable intent, fixture proof or successful stage exists. Both failed
paths leave zero synthetic users/chats/sessions/events and runtime=false.

An actual rollback-only diagnostic then measured the complete legitimate fixture,
receipt d47f434ed9a31ed7c0dc47ef0ae7b3ec36e8df51b7c583cd3d74a772b7e6fe75:
A has one invalidate; B has one invalidate plus one created event linked to an
ordinary chat_added notification. Fences remain zero. Its payload keys are exactly
actor_id/chat_id/chat_name/chat_type and chat matches the fixture. The transaction
rolls back, including the notification; no production/person data is involved.
This is why tests containing only the new access trigger were insufficient: the
existing membership-notification trigger is also part of the real full schema.
The next forward2 must retain this normal history. Its exact corrected transaction
and readback must pass a rollback preflight BEFORE any further fixture COMMIT.

Baseline client19 plus finite nonce-inspector IPC27 pass46/46 coordinator checks.
Actual locked-SDK testing exposed automatic GET retries on503; one RED/GREEN pass
now aborts non2xx/network failure after one dispatch and hides response bodies.
IPC review found no material issue. The client still needs the measured B-history
baseline correction; neither wire/CAS-denial/rollback/OS acceptance is implied.

Node core relay source passes13/13 real-stream controls. Its calibration cleanup
review found a resource-refusal leak; two real failing lifecycle cases went GREEN
in7/7 with a separate exact-owned-CID cleanup guard and loaded omission control.
The actual Docker single-Unix-socket bind was refused with invalid argument before
the process started. The exact created CID was reconciled by owner/image/command/
intent/mount/error hash and removed; PG epoch is unchanged. No live relay PASS.
Do not repeat that mount topology or claim cross-container Unix acceptance.

A bounded existing-tool inventory then found Perl5.42.0 at an exact Nix path;
its binary SHA3220cf58...7c511a and core INET/UNIX/Select/JSON modules are actually
verified. Selected-path absence had not proved global absence. Use this existing
runtime for a bounded opaque relay inside the owned clone. No additional runtime
installation, broad directory/proc mount, HBA change or Postgres restart is needed.

## Actual Forward Fixture Accepted

New forward2 source0363830f/tests526c7a44 pass26/26 coordinator checks and
independent review. They use the real captured membership-notification trigger,
not only the new access signal. The synthetic A actor context is transaction-
local; the existing invite/account/membership triggers remain enabled unchanged.

The exact generated seed plus full factual readback ran once with ROLLBACK:
d76e6cd8e26c82ff5ca532a31e5fb4344b99749c4c19060774d6b5f0e80e0b71.
Readback matched, post-state was pristine/off and catalog/epoch stayed bound.
Only after that proof passed did two guarded seed/enable COMMITs run once.
New initial-stage receipt3b7cd9b8436ba5ecf1d7aa32220a3b425590e914c268205a66e4d548a3e5ccb0
confirms ordinary invitation accounts, ALLOW parents, fences0 and retained normal
notification/event history, runtime=true. Transport readiness remains false.
Both earlier failed preparations and their evidence remain intact; no replay,
history deletion, trigger bypass, candidate reapply or new clone was used.

Public actual-hook/SDK baseline, finite inspector IPC and combined Node22 bundle
are committed849ce348 on the feature branch. Final55/55 coordinator checks pass;
measured B chat_added is remembered by the same ID and must survive the scenario.
Independent delta review found no material issue. This is source preparation,
not live Realtime/CAS-denial/rollback/provider/OS/production acceptance.

## Actual Existing-Perl Transport Accepted

Opaque Perl relayd0ac1150 passes14/14 real local stream controls; the new bounded
operator7701a15f/tests05173b23 pass11/11 plus independent review. Generated
Python and six Perl control helpers compile warning-free. Unknown detach ACK,
PID reuse, foreign identity and resource-refused cleanup have meaningful controls.

One actual Linux calibration now passes in6.3 seconds, receipt
02fb21037aa2f1bd8d0e31a3ec32464a25c3a5448d999229eebe1d2c1e1aa97a.
Read-only SQL through TCP127.0.0.1:54321 proves the same postgres/cluster/postmaster,
logical WAL and Unix peer; a262144-byte synthetic response matches exactly.
Cleanup signals only the saved PID/startticks/exe/cmd/source identity. Process
absence and closed port are confirmed; PG epoch is unchanged. Source/log/PID/
intent evidence stays retained. No runtime install, broad mount, HBA change,
Postgres restart, JWT/PostgREST/Realtime startup or provider delivery occurred.
Do not repeat accepted calibration without changed input. The next live lifetime
must use a distinct owned service scope and reuse this accepted transport proof.

## PostgREST Staging Accepted, Not Startup

New R5 PostgREST definitions initially passed8/8; review found a material gap:
the staged binary was hash-checked only after exec. A held binary-replacement
case went RED, then GREEN with regular/non-symlink, owner, single-link, mode0700
and binary-SHA checks inside the launcher BEFORE exec. Final source3a2bf345/
testscad6649c plus inert wrapper4bca676d/tests67a44562 pass13/13 coordinator
checks, including loaded omissions. Old source/test bytes remain preserved.
The separate process-only verifier deliberately does not assert baseline catalog
or slots after the declared Realtime metadata transition.

One reviewed coordinator stage operation now passes without starting a process:
stage proofc2fcb9955e2bfaa82e5fc850fb47e59999ace79ad1a8f0382168be3b8f145356.
Only the known accepted R4 QA binary bytes were copied and rehashed; no old key,
config, token or production binary was read/adopted. A fresh QA signer is generated
in server RAM, retained in an exclusive owner-private0600 file and copied only to
the owned clone0600 key/config. Readback, binary hash, new-file state, closed port,
candidate catalog, fixture and epoch checks pass. Nothing secret is output.
No JWT, HTTP process, Realtime tenant/service or provider call was issued.
Do not replay staging; the successful stage is the next start phase's prestate.

## Node Runtime And Boot Review

The self-contained combined actual-hook/SDK/IPC bundle efab511e now imports in an
isolated Linux Node22.23.3 container (uid1000); receipt000a1f22. External package
resolution is zero; no host Git/repository, credentials or client run is required.
The exact temporary container is removed. Build from the canonical worktree:
esbuild source comments are CWD-sensitive, so a different bundle hash from a
different CWD is a refusal, not permission to silently replace an accepted pin.

One native Elixir cleanup-control attempt refused before acceptance. Its exact
container is absent and inode-bound temporary env removed; original intent/CID
and failure remain retained. A changed safe diagnostic records only prerequisite
booleans, stage enums, output lengths/hashes and exception classes, never raw
output or runtime secrets. No tenant was created and no JWT issued.

Independent boot review found two material harness issues before launch: an
image config ID is not its registry manifest digest, and a failed container
cleanup must not skip private env unlink. One RED/GREEN fix pass handles them.
The next launch is finite metadata-only startup/read-only Repo/listener proof,
with a NEW actual Perl relay lifetime and exact cleanup. Replication, tenant,
authenticated SDK delivery and CAS/rollback remain separate unaccepted stages.

The changed native diagnostic67d301eac9f4 established the pre-Elixir cause:
ERLANG_DIRTY_CPU_THREAD_LIMIT, rc139, stderr60 bytes, stdout0; safe receipt
0162e1093bab44ad59995a5b115212405944525f43e37eb0749c3eb35fde0b8b.
Exact container/env cleanup and closing clone identity pass. No raw logs are
retained or emitted. A Docker CPU quota alone did not bound Erlang's threads.

One changed execution environment sets `ERL_FLAGS=+S 2:2 +SDcpu 1 +SDio 1 +A 4`
without increasing CPU/memory/PID limits or changing the frozen service/tenant
bootstrap. These are documented [Erlang runtime flags](https://www.erlang.org/doc/apps/erts/erl_cmd.html).
Actual Linux evaluationf83ac214d907 now completes all three original controls
and the loaded cleanup-omission mutant, native diagnostic source5e2fe973:
receipt dbd84c88ed54126b723424f1a9b6a818ceef3fdc0d3427c80e0ce3101a91aad9.
Jason is loaded; Repo/Supervisor are absent; exact container/env are removed and
clone identity remains unchanged. This proves native bootstrap file-control
flow with only the API leaf replaced, not a real tenant/API/service or delivery.
HOST5a3b62c4 keeps a safe private failure-stage/RPC hash receipt;5/5 coordinator
checks include actual generated env evaluation and loaded omission controls.

## First Metadata Boot Refusal

Final adapter4c0674f9 binds HOST5a3b62c4; coordinator14 adapter plus2 dispatch
checks pass16/16. Image `.ID` and exact RepoDigests are separate; every guard
freshly measures the clone/relay. Env cleanup refusal cannot produce acceptance.

One actual finite metadata boot6c52d9843661 refused at `probe`: last RPC rc1,
stdout0. Private boot receipt372076e808f88deb5bb4c661e5c16403ce677f4f4f9f9557638413984cb8776c
and adapter2eec69dc are retained. Exact service/container cleanup is REMOVED,
env cleanup REMOVED and Perl cleanup passes. A fresh readonly reconciliation
confirms the original baseline catalog/fixture/epoch still match; no JWT/tenant,
HTTP or replication slot was created. Do not replay this opaque attempt.
Next changed diagnostic captures bounded RPC stderr only as fixed classes and
lengths/hashes, with the same identity-bound cleanup. The cause is not inferred
from a generic rc1 or repaired by changing database access.

The public single-lifetime phase runner now has75/75 coordinator checks, zero
skip: baseline -> authenticated disabled CAS -> parent-controlled compatible
rollback with runtime=false. Original sockets remain, new HTTP drains before
phase changes, and retained history/read-state is checked separately from alert
eligibility. This remains source-only pending actual composed parent/service
execution; reconnect/refresh, inherit reset, held callback
and provider/OS gates are not relabelled complete.

Independent review of the frozen seven-file phase delta5b910199/16698aef found
no new P1/P2. Coordinator75/75, zero skip and diff checks pass. Actual parent/
service execution remains outstanding; the review is not a delivery receipt.

## Actual Metadata Boot Accepted

The changed bounded stderr diagnostic e56a180b3c92 retained only50 bytes/hash,
not raw output. Hash b6c61e38...be9a14's public-source comparison is exact for
[Elixir's CLI](https://github.com/elixir-lang/elixir/blob/v1.18.4/lib/elixir/lib/kernel/cli.ex#L397)
`RPC failed ... :noconnection` message; this alone did not establish
cookie or SQL failure. Selected pinned-image metadata confirms its inherited
`ERL_AFLAGS=-proto_dist inet6_tcp`; the
[pinned Dockerfile](https://github.com/supabase/realtime/blob/cd952f26787d764b357eec01568f680137756293/Dockerfile#L102)
declares the same.
QA used127.0.0.1; DB/Endpoint IPv4 settings do not set Erlang distribution.

New inert wrapperdd66e7ca overrides only execution `ERL_AFLAGS=-proto_dist inet_tcp`.
Coordinator6/6 includes actual generated Python env/serialization, inherited-value
omission and compiled full parent. Frozen adapter/HOST/diagnostic/tenant-bootstrap
bytes remain unchanged and all receipt namespaces retain the new wrapper/host pin.

One actual changed run50ed9a4c71b6 now passes:
boot5bbe4d230efe7014acfc02dd10e33185f0e7d86696c71426a7c06222a1bab174;
adapter ae4101d4527aa6709dfb5afd6a28319c60ccd172ed252c4220b264bac54b46e5.
Read-only Repo proves actual DB/role/search path/cluster/postmaster/no slots/no
owned tenant and listener4000; RPC exits0, stderr0, expected stdout41 bytes.
Exact container/env cleanup is REMOVED and Perl cleanup passes. Independent
readonly reconciliation04fba313 confirms actual service name absent, no env and
unchanged baseline. Do not rerun this accepted calibration. No tenant, JWT,
PostgREST start, WS/CDC, provider, OS or production acceptance follows from it.

Connected-phase guard source12/12 was independently reviewed. One P2 is real:
its fixture/coverage used legacy `notification_feed_events` instead of the
candidate's actual `notification_feed_events_v2`. One genuine fixture RED/GREEN
fix pass is required before composing it; no live guard result was claimed.

The P2 fix85dc7226/tests76f0b319 now passes13/13 coordinator checks. The real
PGlite fixture contains the v2 table; legacy-only publication membership and
omitting the v2 unfiltered-coverage check fail the literal controls. Baseline
activeSlots0 is unchanged. This closes the source review finding, not actual
connected tenant/slot acceptance; no rereview or old-suite replay is needed.

## Actual Node22 Entry Boundary Accepted

New finite entryd8f3a9ba generates8734c3be and pins current public phase bundle
0f924d80 (11038678 bytes), sourceDigestf07d92df. Its four-byte length prefix is
consumed exactly, SHA checked before compile, and one safe readiness frame precedes
the actual phase IPC. Following stdin bytes survive fragmentation or a same-write
config. Local15/15 includes real children, timeout/EOF/hash/size/output refusal,
loaded omissions and actual bundle import; the local runtime is Node24, not22.

One separate finite Linux Node22 run now accepts this CHANGED entry/bundle:
94c31d67fd6f10ab63816f8a73dc3d31a0158d27e9587af50e98e3640f290dc2.
Actual readiness is followed by the real phase IPC's expected unbound-config
refusal with inspectCount0. No valid credentials, tenant or network inspection
was supplied. Exact container cleanup and fresh unchanged R5 baseline pass.
No copied repo/Git/external dependency is needed inside the Node container.
This is a loader/IPC boundary, not an authenticated session/CDC delivery result.

The finite parent composition still requires actual HOST/process/IPC adapters
and phase checkpoint SQL. An unbound source kernel is not a runtime permit.
The coordinator also identified an ignored-signal deadline gap in its draft:
checking abort only before/after an awaited port cannot bound a never-resolving
port. One genuine refusal/cleanup fix pass is in progress before acceptance.

## Actual Initial Checkpoint Accepted

Checkpoint reader/validatorf78740ec/tests81fa35c9 pass14/14 coordinator checks
and independent review. Selected real DDL/PGlite cases cover own account/chat,
all four sessions, exact CAS/fences, initial message history, terminal state,
microsecond timestamps and canonical JS hashing. Five loaded omissions fail.
Committed CAS is admitted transiently only for baseline INSPECT, not its ACK.

One actual PG17 repeatable-read read-only UTC projection now passes against the
unchanged owned R5 baseline before and after; no raw rows are saved or reported:
1eca560dae74163721f30f8e4f593c2471bb0ec5739e84a7a7dd50e501439a43.
Result initial/inspect is pristine, runtime=true; sessions4, fences0, messages0,
requested notifications0, initialHistory1. This proves the initial SQL/runtime
shape, not later producer/CAS/rollback or WS/CDC semantics. The parent must do
fresh phase inspections during the actual run rather than echo this receipt.

## Actual Metadata And Session-Lease Findings

The first actual PG17 connected-metadata SELECT succeeds, but85dc7226's
`validatePhase(started,baseline,current)` refuses. A safe readonly diagnosis
confirms exact owner/CID/stage/UTC/epoch and candidate catalog3f87350b, publication
coverage and all hashes; slots/owned tenant/extensions are0. All seven existing
partitions have supported=false. The measured non-child-prefixed objects are
only inherited CHECK `messages_payload_exclusive`: contype=c, conislocal=false,
coninhcount1, conparentid0 and same parent constraint name. No mismatched index
name exists. Generic prefix refusal is not a valid inheritance classifier.
The fix must bind parent identity/definition, keep existing physical fingerprints
unchanged, and meaningfully test dropped-column/fast-missing differences for a
new partition. A broad schema waiver or deleting constraint checks is not a fix.

An independent old full-fixture guard now refuses only its sessions fact. That
fact is time-dependent (`not_after > clock_timestamp()+30 minutes`); rows were
not changed, and Hume confirms no live commands. The clone remains running with
the same PID/incarnation. The accepted initial checkpoint used a15-second live
threshold at its measured time; neither old receipt is a fresh launch permit.
Two partition-name diagnostic attempts refused at this stricter prestate before
SQL; a scoped metadata-only read then measured the inherited CHECKs with exact
incarnation/role/epoch guards, without claiming session/runtime admission.

Next is a forward ordinary QA-session lease: append four NEW SIDs for the same
owned invitation accounts, preserve every original session row, and create the
lease only when the full controller is ready. Do not update old not_after,
re-age a receipt, reset/reseed the fixture or rewrite its old stage proof.
The new lease and checkpoint binding need explicit new proof/contracts before
services or the fixed tenant can start. No new sessions or tenant were created.

One exact-target rollback-only DDL measurement now creates planned child20 under
the actual supabase_admin role, measures parent/old19/new20 metadata, then removes
it with ROLLBACK. Cluster/postmaster/role/absence/no slots/no tenant checks raise
before CREATE; parent attachment is checked afterwards. Full catalog and epoch
match before/after. SQLffdc5069, evidence1bb7ac901e0809dbd8082ac5ad9f4f9699281eb502786446310324a75b061b04.
Actual RT parent/old/new have nine contiguous live columns and no fast-missing
values; there is no evidence to invent a broad dropped-column normalizer here.
Old/new child owner is supabase_admin. Inherited CHECK expression matches, while
parent is NOT VALID and children are validated. ACL entries are the same set but
the old/new physical arrays differ in order. Keep old physical before/after
comparison; canonicalize only justified new-child equivalence, not all metadata.

Parent/core/HOST are frozen at02994173/8b7d1a79, local reported10/10 and6/6.
They include the ignored-signal and absolute aggregate deadline repairs, but new
partition/session contracts are not integrated and additional flow/unknown-ACK/
rollback leaf controls remain. No active exec or live action belongs to that
worker. This is a dependency handoff, not permission to run the old HOST.
