# Production Completion Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans or bounded
> superpowers:subagent-driven-development. Track the checkboxes below; an approved
> continuation is not a request to restart completed design or acceptance.

**Goal:** Close the agreed LETSCUBE functionality, reliability, interface and
platform backlog with production evidence and no loss of user data.

**Architecture:** Preserve the shared React client, Tauri/Capacitor shells,
self-hosted Supabase, worker, Bot Gateway and LiveKit. Deliver independently
reviewable slices through existing contracts; source tests, actual service wire,
provider/device acceptance and production rollout are separate evidence layers.

**Tech Stack:** TypeScript/React, PostgreSQL17/RLS, PostgREST, Supabase Realtime,
IndexedDB, Web Push/FCM/WNS, Tauri, Capacitor, LiveKit, Coolify.

**Spec:** [owner requirements and queue](../../PRODUCTION_PRIORITY_TRACKER.md),
[current checkpoint](../../HANDOVER.md),
[working lessons](../../operations/working-lessons.md),
[reference mechanics](../../operations/reference-clients.md).
Existing subsystem plans remain authoritative for their exact API/test contracts;
this document coordinates their remaining deliverables, not a replacement design.

## Global Constraints

- Owner on2026-10-18 authorizes implementation, reviewed production rollout and
  necessary migrations throughout this plan without another approval round.
- A migration still requires verified backup, one transaction, raising self-check,
  exact rollback and byte-identical `.migration-backup` copy (CLAUDE.md section10).
- Keep RLS and account/session/privacy fences; never expose secrets or personal
  content. QA screenshots/traces/video stay off when signed in; browser tests use
  `KUB_QA_ALLOW_MUTATIONS=0`. Synthetic owned QA mutations require exact cleanup.
- Realme and bounded paid iPhone/Android rentals are authorized. A063 belongs to
  Apollo and is excluded. Allocate a rental only for a prepared finite checklist;
  release it in cleanup. Do not install over a release for incidental QA.
- Windows EXE remains unsigned by the owner's explicit decision. Do not change
  Publisher/PFN/MSIX identity or submit to stores. Native Apple release ownership
  remains separate; coordinate changed shared contracts, not acknowledgements.
- Preserve liquid-glass design and actual Telegram/Discord mechanics, not labels
  applied to different behavior. Check reusable modules and licence obligations
  before new infrastructure. No global Java/PATH/routing/Happ changes.
- At most three bounded workers, disjoint write scopes, no recursive delegation.
- Before push inspect `origin/main..HEAD` separately and resolve imports against
  each commit's tree. Main pushes deploy; verify exact image and public/content
  parity. Published APK24 is immutable; use the next version/build for new code.

## Review Focus

1. Cold restore, owner change and concurrent send/discard must preserve FIFO,
   idempotency and account isolation (Task2; retain D-367 negative controls).
2. Parent/child notification decisions, old clients and rollback must not leak or
   revive alerts; a foreign read must fail while an own read reconciles (Task1).
3. Keyboard, safe-area, compact containers and enlarged text must not hide actions
   or introduce double insets (Tasks8/10; exact element at1440/390, both themes).
4. Media permission/source changes must revoke derived access without destroying
   originals or breaking durable retries (Tasks3/5).
5. Slow/offline/reconnected/background clients must recover without reload,
   duplicate effects or misleading delivery/read state (Tasks2/7/10).

## Accepted Baseline (Reuse)

- [x] Web sender/text, sender-only, none and exact activation on installed iPhone
  PWA; ordinary Android23 FCM/read/tap/logout; owned QA resources retired.
- [x] D-357--D-364 accepted synchronization repairs; D-365 media position ownership.
- [x] D-367 actual Chromium/WebKit IndexedDB FIFO and discard repair;117 affected
  checks; production owned HTTP FIFO; Android24 in-place guest upgrade.
- [x] Android0.1.23/build24 Stable, mandatory=false, original signer/Firebase and
  full public APK hash; web source5af58c2b, image8159c627. Windows shell0.2.14.
- [x] Topic runtime remains OFF. Ordinary production feed-v2 admission/read is
  accepted, but does not substitute for override compatibility or provider proof.

Evidence: [notifications release](../../operations/2026-10-18-cursor-return-notifications.md)
and [FIFO/Topic continuation](../../operations/2026-10-18-outbox-restore-and-topic-wire.md).

## Task1: Finish Topic Notification Acceptance (#75--77,95)

**State:** IN PROGRESS; immediate critical path. No global enable yet.
**Files:** `tests/server/topic-notification-realtime-client.hook.mjs`, its focused
control tests, existing notification consumer/SQL contracts and private finite
runtime operators. Product files change only after a reproduced failure.
**Interfaces:** Existing `mountRealtimeClientHook`, `createNotificationFeedV2`,
notification decision/read RPCs; current and pinned old client sources.

- [x] Extend actual-hook actions/observability with regression and omission tests,
  without replacing the SDK, parser, read RPC or reconnect with a fake remount.
- [x] Capture fresh schema-only PG17 and numeric Realtime migrations; start a
  bounded internal PG/PostgREST/Realtime clone with fresh QA-only credentials.
  Actual schema/tenant/fresh registration seed boot passes; the SDK mount still
  refuses readiness, so policy/read/rollback cases are NOT accepted yet.
- [ ] Exercise ordinary JWTs/current+old hooks: parent-muted child-enabled,
  inverse, independent recipient positive, own/foreign/cross-session read,
  retained history, terminal suppression, rollback and same-document reconnect.
- [ ] Repair only demonstrated defects, review, then run affected checks and
  actual provider/device canaries before a backup/CAS/readback global rollout.
- [ ] Record final runtime state and cleanup; close only covered tracker parts.

## Task2: Nikita Intake and Synchronization (#2,52--53,79,83--87)

**State:** NEXT; already accepted fixes are not blank stages.
**Files:** Existing intake reports, chat cache/reconnect/outbox modules and their
focused tests; `docs/PRODUCTION_PRIORITY_TRACKER.md` and defect registry.
**Interfaces:** Account-owned warm history, stable client-message identity,
privacy admission, message anchors and lifecycle recovery already in the client.

- [ ] Reconcile new authorized conversation requests against recorded IDs; retain
  no personal message/media bodies in public reports. Establish client/build and
  intended action for unresolved five images/one video before inventing a fix.
- [ ] Measure one current opening/switching or VPN-reconnect episode; identify the
  first violated boundary, then add an actual failing regression before repair.
- [ ] Close microphone84, read-state85, task-reload86, sound83 and emoji79 through
  their own changed-input cases; do not infer device acceptance from source.
- [ ] Verify cold/warm/offline/background/account-switch behavior at the affected
  boundary and publish independently accepted slices.

## Task3: Media Completion (#25,29,104--105)

**State:** QUEUED; D-365/#104 is DONE, not an outstanding position repair.
**Files:** Existing media upload/playback/album/cache/editor components and tests.
**Interfaces:** Existing HD/original choice, durable upload identity, variant
metadata and positional intent; preserve original bytes and explicit downloads.

- [ ] Map accepted albums, HD/original, auto-small/manual-large download/cache and
  recorder feedback evidence; reproduce only uncovered user workflows.
- [ ] Finish missing grouping, quality defaults and save/cache semantics with
  focused behavioral tests and rendered desktop/mobile states.
- [ ] Implement the remaining pre-send photo/video editor as a separate slice,
  choosing a maintained permissively licensed component before bespoke engines.
- [ ] Accept actual send/retry/view/save behavior on affected shells and release.

## Task4: Faithful Recovery (#82/D-342)

**State:** QUEUED; migration-specific rehearsals are already accepted.
**Files:** Existing recovery operators, coverage reports and backup contracts.
**Interfaces:** Backup-alone restoration of roles/ACL/settings/schema/data, not
an already initialized clone whose prerequisites come from production.

- [x] Compare accepted receipts: R6 restore768 constraints and rollback173
  tables/10 sequences are accepted. Roles/settings/default ACL were restored;
  the missing boundary is a sealed backup package without source-derived
  prerequisites. Supplemental GraphQL/net ACL/settings/two indexes must travel
  inside that durable package, not be fetched again from production.
- [ ] Complete the isolated backup-alone rehearsal without touching production
  data/services: a clean same-image PG17 target consumes only the retained sealed
  package; reuse accepted comparators. Omit one concrete ACL grant-option in the
  restore consumer and require the independent ACL check to refuse it.
- [ ] Record verified recovery time, exact cleanup and remaining external limits.

## Task5: Trusted Media Authority (#78/D-336--339)

**State:** QUEUED; source/isolated/controlled Storage checks exist.
**Files:** Existing trusted writer, forward/avatar contracts and migration plan.
**Interfaces:** Durable source-to-target authorization, idempotency and bounded
busy retry; no public client service-role or path-only authority.

- [ ] Resume the existing candidate at its first uncovered real runtime/Storage
  boundary, rather than rerunning accepted local suites.
- [ ] Prove source/target revoke, retry, deletion and avatar lifecycle with actual
  owned Storage outcomes; preserve unrelated originals.
- [ ] Apply required SQL only through section10 and verify actual consumers before
  promoting or closing the defect family.

## Task6: Groups, Publication and Bots (#19,43--48,80--81)

**State:** QUEUED; existing bot viewer/vocabulary are released.
**Files:** Existing group/channel permission/settings, conversation type and bot
interface modules, contracts and tests. Internal identifiers stay compatible.
**Interfaces:** Group versus Group-chat mechanics; publisher/reader authority,
inherited/scoped permissions, bot message/media visibility and shared UI.

- [ ] Prove actual publisher positive and reader-negative control for publication
  channels, then repair uncovered settings/permission inheritance.
- [ ] Finish structural Group rail and personal/shared bot surfaces without
  rebuilding accepted bot message reading or relabelling the old structure.
- [ ] Implement remaining auto voice-room mechanics behind tested ownership,
  membership, empty-room cleanup and reconnect rules.
- [ ] Accept ordinary-user creation/join/publish/bot workflows, not staff-only UI.

## Task7: Calls (#32,44--45)

**State:** QUEUED; private calls/history already exist.
**Files:** Existing LiveKit, Android call delivery, participant and public-route
call-control modules and their current rollout/checklists.
**Interfaces:** Actual background/killed activation, permissions, identity,
participant lifecycle and group-call state; no duplicate room/call on reconnect.

- [ ] Reconcile current Android24 with disabled call-delivery rollout and accepted
  A/B/C/D2/E/F/G stages; execute only missing lifecycle/device cases.
- [ ] Finish group voice/background/participant paths and readable microphone-to-
  video status with real failure regressions and responsive visual inspection.
- [ ] Verify denial, timeout, logout, stale activation and reconnect, then roll out
  only accepted delivery paths.

## Task8: Interface and Motion (#18,30--31,34,93)

**State:** QUEUED; preserve current glass and accepted focus/reduced-motion fixes.
**Files:** Existing navigation, container sizing, search, typography and settings
components; targeted visual/performance fixtures.
**Interfaces:** Stable dimensions, actual container width, keyboard/safe-area
ownership, readable defaults/scale and reduced-motion preference.

- [ ] Measure one uncovered native search expand/collapse or compact-container
  defect, including frame/layout evidence before changing animation.
- [ ] Verify exact changed elements at1440/390 in both themes and enlarged text;
  keep controls reachable, lines aligned and navigation logically persistent.
- [ ] Use available Mobbin/Figma/Rive only for a specific missing reference or
  implementation need; do not spend subscription minutes on repeated exploration.
- [ ] Publish reviewed UI slices and record physical checks separately.

## Task9: Product Depth (#17,19--20,27,36--38,92)

**State:** QUEUED; D-354 source/browser fix4765bcad is included in shipped
web5af58c2b and Android24; actual authenticated draft/retry/retirement remains.
**Files:** Existing public download/changelog, profile/contact/shared-media,
roles/tasks/staff/support components and their focused tests.
**Interfaces:** Public unauthenticated downloads, scoped roles, contact/phone
privacy, task invalidation, profile history and existing support assignment.

- [x] Reconcile D-354 inclusion: shipped hook/modal/checklist blobs match current;
  accepted hook SHA matches its report. Do not repeat accepted fictional tests.
- [ ] On Android24 leave owned task checklist/comment drafts unsaved; update the
  task through a second QA client. Real Realtime refresh must update server data
  without reload/unmount or either draft loss. Test transient error/Retry and
  permission-loss retirement as separate controls.
- [ ] Close remaining ordinary-user journeys with actual positive and denied
  controls; retain accepted support/email/auth/security baselines.
- [ ] Finish remaining marks/history/presence and public product states without
  introducing fake activity, marketing claims or placeholder versions.

## Task10: Platform Delta Matrix (#7,9,28)

**State:** QUEUED; latest Android24 baseline supersedes old0.1.3 notes.
**Files:** Platform QA/release checklists, existing native adapters and manifests.
**Interfaces:** Shared client parity, native activation/download/keyboard, stable
signer/package identity and verified in-place upgrade with retained user data.

- [ ] Build a delta-only OEM/locked/long-session matrix reusing accepted23/24
  evidence; Realme/rental only, no A063.
- [ ] Coordinate installed iPhone PWA keyboard/safe-area/scale checks on a bounded
  rented iPhone; do not claim native iOS/macOS release from web evidence.
- [ ] Finish Windows killed-process WNS and available Win10/11/offline/long-session
  cases while retaining owner-accepted unsigned EXE distribution.
- [ ] For changed embedded clients build the next immutable version, verify
  signer/Firebase/assets, actual upgrade/canary, catalog CAS and public byte hash.

## Task11: Monitoring and Capacity (#6)

**State:** QUEUED after recovery coverage; old permission-only hold is superseded.
**Files:** Existing monitoring, error handling, backup/restore and capacity reports.
**Interfaces:** Secret-free actionable alerts, verified backup age/recovery,
measured resource limits and no speculative platform rewrite.

- [ ] Inventory actual error/uptime/backup-alert gaps and existing reuse options.
- [ ] Implement and prove a controlled alert plus recovery/retirement, with
  explicit redaction and no duplicate noisy notifications.
- [ ] Change capacity/storage only for measured limits; document rollback.

## Task12: Remaining Optional Product Scope (#24)

**State:** QUEUED behind core reliability, not silently removed from owner scope.
**Files/Interfaces:** Existing optional cosmetics/paid-feature proposal; revalidate
commercial/provider constraints before implementing its independently testable
slice. No unrequested purchase, financial commitment or fabricated entitlement.

- [ ] Reconcile requested optional scope with the accepted product design.
- [ ] Implement reversible non-commercial pieces; identify genuine external
  owner/provider decisions rather than presenting them as completed.

## Per-Slice Release and Continuity

- [ ] Reproduce a real failure, add a negative control, implement a narrow repair,
  and run affected checks. Use a fresh reviewer for high-risk contract changes.
- [ ] For SQL retain actual backup/transaction/self-check/rollback proof; for UI
  inspect rendered pixels; for device/provider boundaries use actual acceptance.
- [ ] Commit only owned paths; inspect outgoing commits/imports and deploy. Verify
  exact image/content or immutable native artifact/catalog/readback and rollback.
- [ ] Update the owning tracker item and one short HANDOVER resume; link detailed
  reports. Move immediately to the next ready task, not a new approval ritual.
- [ ] Finish the goal only when all agreed items are genuinely closed or their
  explicit external dependency is accurately reported to the owner.
