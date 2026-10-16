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
