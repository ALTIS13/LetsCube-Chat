# Topic Notification Overrides: Execution

Owner: coordinator. Branch:codex/topic-alerts-20261016, base05f72b25 in the
main-based android-current worktree. Stage:Task5 state/presentation source
verified; Task3 candidate rejected pending structural repairs, Task4 integration
continues. Item77 remains
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

## Server Review Still Open

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
