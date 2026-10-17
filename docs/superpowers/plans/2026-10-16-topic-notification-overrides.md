# Topic Notification Overrides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The coordinator owns assignment and integration; this plan does not dispatch workers or authorize effects.

**Goal:** Complete item77 end to end: an account can inherit, enable or disable alerts for one canonical topic without changing another account, the notification feed or read state.

**Architecture:** Persist revisioned account/chat/topic overrides behind an authenticated CAS RPC. One trusted, message-derived policy governs enqueue, fresh delivery checks, albums, native preview lookup and client alert presentation; cached UI state never grants delivery authority. Ship the consumers and durable suppression together, not a standalone resolver or local bell switch.

**Tech Stack:** Existing PostgreSQL/PostgREST/Supabase, TypeScript/React/Zustand, Web Push/FCM and Tauri adapters; no new framework.

**Spec:** Item77 in [the tracker](../../PRODUCTION_PRIORITY_TRACKER.md), [sanitized intake](../../operations/2026-10-03-tester-feedback.md), and the owner's explicit contract in this assignment. Planning source: `a07c5ae643fc321697094284ef3a06c9e1e28851`, main-based worktree `C:/Users/maksi/.codex/worktrees/android-current-20261015/LetsCube-Chat`. D366 publication is separately accepted. This document does not close item77.

## Execution Status, 2026-10-17

Accepted source is not production/device acceptance. Reuse the linked evidence;
do not restart completed RED/GREEN work. Checkboxes below describe the original
full requirements; cross-task requirements remain open until their consumers pass.

| Task | Current checkpoint |
| --- | --- |
| 1 | Source verified, d7869991. |
| 2 | CAS/RLS source and actual PG17 concurrency verified,84294a19; canonical migration/full-schema runtime remain open. |
| 3 | Terminal suppression and structural lock repair source accepted,30d8dd80; final integrated PG17 suite170/170 includes the changed source and native/album binding. Full-schema/runtime remains open. |
| 4 | Native/album bindingbdb346f4 plus prior maintained single/legacy/preparation reviewed; affected dispatcher220/220 and integrated PG17 suite170/170, zero skips. Actual provider/OS release gates remain open. |
| 5 | State8016c799 and reviewed presentation4fc8e3af verified,155/155 and181/181; source requires the additive SQL, not a standalone release. |
| 6 | Immutable R4 capture and actual source/archive4817-statement AST equality pass. Reviewed restorer2 (15/15) passes actual logical catalog/ALL14 schema ACLs/data/sequences/controls; three DDL files transferred byte-identically. Local RESTORE2_SCHEMA_AST_DIFFERENCE refuses final recovery acceptance; exact network-none clone held for bounded diagnosis. Seed/transport source work proceeds independently, no remote execution. Physical backup stays hard-refused. V2 client320/320, SQL/producer9/9, lifecycle73/73 and assembled source418/418 stand. Guarded assembly32/32 and HTTP admission48/48 are source-only; HTTP/Realtime/delivery/rollback and production acceptance remain open. |
| 7 | Compact componentf5e44185 passed25/25 and fictional20-state1440/390 light/dark pixels. No header mount, fullstack visual acceptance, reachable production toggle or native release for item77. Full Task6 gate still precedes release acceptance. |

Detailed failures, evidence and limitations: [execution record](../../operations/2026-10-16-topic-notification-overrides.md).

## Global Constraints

- Scope is account + chat + canonical text topic, not Android OS channels, voice channels or a new conversation type.
- `messages.topic_id IS NULL` and a same-chat `topics.is_general` row mean the same `general` scope. A missing, foreign or unknown topic is not general. Reuse `channelKeyForTopic`'s valid-input convention: `general` or the topic UUID, without a new prefix.
- `inherit` uses parent mute; `disabled` denies; `enabled` bypasses only parent permanent/timed mute. It never bypasses DND, global/category preferences, OS permission, sender blocks, access/privacy, read/self-message exclusions or preview consent/session/card gates. Mentions do not bypass `disabled`.
- Muting changes alert eligibility, not feed retention, unread counts or read marks. Never delete notifications, mark them read, or change membership/history to silence a scope.
- CAS uses `expected_revision`; account identity comes only from the server's authenticated principal. No optimistic state, localStorage or caller-supplied topic/sender payload is delivery authority.
- No DB, provider, browser, device, build or deployment action was performed to write this plan. Later SQL/release steps require the existing verified-backup/rehearsal/rollback procedure, not a new routine approval gate. Preserve unrelated sidebar/search/version work.

## Review Focus

1. General aliases, archived/deleted topics and foreign UUIDs must not create a second preference or silently enable general alerts (Tasks1-2).
2. Two devices writing from revision0, ABA back to inherit and late same-UID/new-session responses must not overwrite newer state (Tasks2,5).
3. Disable while an outbox/album/Windows operation is pending must survive later enable; claims or reconnect must not replay the old alert (Tasks3-5).
4. Enabled children must not bypass global/privacy/preview gates, including denied or unavailable reads (Tasks1,3-5).
5. An old dispatcher, old installed alert consumer or rollback must not silently ignore child-disabled state (Tasks4,6-7).

## Existing Source Map

All paths below are repository-relative. Existing SQL is evidence/input, not a file to rewrite retroactively.

| Existing files / symbols | Boundary to change or preserve |
| --- | --- |
| `artifacts/kub/src/hooks/useChatMute.ts:53`, `lib/chatMute.ts:94`, `store/app.store.ts:659` | Chat-only read, parent mute decision and optimistic parent writes; do not reuse those writes as child delivery authority. |
| `artifacts/kub/src/types/database.ts:597`, `hooks/useTopics.ts:122`, `lib/channelUnread.ts:25` | Same-chat topics, archived history, null/general canonicalization. |
| `artifacts/kub/src/hooks/useNotifications.ts:135,270,333,604` | Windows asynchronous presentation, reconnect scan, sound and chat-wide feed filtering currently share mute decisions; separate feed from alerts. |
| `artifacts/kub/src/hooks/useCallSound.ts:85`, `lib/platform/desktopNotifications.ts` | Preserve DND/audio/ringing/open-chat/OS-toast rules and exact Windows identities/serialized cleanup. |
| `supabase/migrations/20261001180000_member_mentions.sql:393,465-573` | Authoritative visibility, message enqueue and Web/native/album rechecks; preserve mention validation and recipient/message binding. |
| `.migration-backup/supabase/migrations/20260527_push_notifications_foundation.sql:197`, `supabase/migrations/20261001213205_presence_push_quiet.sql:42` | Historical parent/global/category gate plus later DND patch; reconstruct the current composed function, not the old foundation alone. |
| `supabase/migrations/20260926091149_album_push_activate.sql:46`, `20260926085544_album_push_outbox.sql:85,288` | Actual enqueue and album membership/recheck/suppression semantics, including incomplete groups. |
| `supabase/migrations/20261007210924_native_message_preview.sql:198` | Preview joins actual message/recipient/device and calls `_notification_push_allowed`; retain its exact privacy/consent contract. |
| `supabase/functions/send-push-notifications/{index,album-dispatch}.ts` | Maintained claim/recheck/provider/ACK path and fail-closed unknown responses. |
| `artifacts/api-server/src/workers/pushDispatcher.ts:94-174`, `src/index.ts:31` | Legacy opt-in worker sends directly and ignores suppression/claims. Default production ownership is cron/Edge; actual live opt-in state was not inspected. |

## Task1: Pin Policy and Canonical Scope Against Actual Inputs

**Create:** `artifacts/kub/src/lib/topicNotificationPreferences.ts`, `tests/unit/topic-notification-preferences.test.mts`. **Reference:** existing topic, mute and channel-unread modules above; do not replace parent-mute contracts.

**Interfaces:** `TopicNotificationMode = 'inherit' | 'enabled' | 'disabled'`; `resolveTopicAlert(mode, parentMuted, restrictionsAllowed): boolean`. Restrictions are the conjunction of independent gates, never inferred from a cached topic. Canonicalization returns `general | UUID | unavailable`, requiring a successful same-chat topic snapshot for non-null IDs.

- [ ] Add literal policy cases: `(enabled,true,true) => true`, `(disabled,false,true) => false`, `(inherit,true,true) => false`, and every mode with restrictions false => false. Cover null/general equivalence, foreign/missing topic refusal, another chat/account and mentions.
- [ ] Run `node --test tests/unit/topic-notification-preferences.test.mts`; establish RED against the absent contract/actual current consumers, with an unchanged parent-mute positive control. Implement the small pure decision and make GREEN; omission of each precedence/canonicalization rule must fail a literal assertion. This helper alone is not a launchable feature.

## Task2: Durable CAS, Own-Row RLS and a Trusted Message Resolver

**Create:** `docs/proposals/2026-10-16-topic-notification-overrides.sql`, its `.rollback.sql`, `tests/server/topic-notification-overrides-db.test.mjs`, `tests/server/topic-notification-overrides-concurrency.test.mjs`. Register the reviewed proposal as a newly timestamped canonical migration at implementation, with byte-identical `.migration-backup/supabase/migrations/` copies; record the generated filenames in the evidence. **Modify:** generated types in `artifacts/kub/src/types/database.ts`.

**Interfaces:**
- `public.topic_notification_preferences`: `(user_id,chat_id,scope_key)` unique; `mode`, server-owned monotonic `revision`, server time. Follow existing account/chat FK identities. Keep an explicit `inherit` row after reset, not DELETE/revision0 ABA. Revisions must remain safe for the chosen JSON/TS representation; reject exhaustion without effects.
- `topic_notification_preferences_read(p_chat_id uuid)` returns current own canonical rows. A successful absent row means `inherit,revision0`; failed/denied reads mean unavailable, not an enabled default.
- `topic_notification_preference_set(p_chat_id uuid,p_topic_id uuid,p_mode text,p_expected_revision bigint)` derives `auth.uid()`, canonicalizes against actual topics and verifies current access. Return `{status:'applied'|'conflict',scope_key,mode,revision}`; a conflict returns current own state, changes nothing and never silently retries. Invalid/access-refused requests fail without exposing foreign rows.
- `private.message_topic_alert_allowed(p_recipient_id uuid,p_message_id uuid) returns boolean` resolves chat/topic/sender from `messages` and current topic/access rows, not payload claims. Replace only the message branch's parent-mute decision inside `_notification_push_allowed`; keep all other gates and non-message behavior.

- [ ] Write RED against actual current SQL: parent muted + child enabled still refuses; no persisted child-disabled/CAS contract exists. Preserve actual visibility/global/DND positive and negative controls. Use existing PGlite tests for quick checks, but do not stub `_notification_push_allowed` to true as fullstack proof.
- [ ] Implement own-row SELECT RLS, including `user_id=auth.uid()` plus current access. No public/direct client INSERT/UPDATE/DELETE privilege; authenticated RPC only, fixed search path, narrow grants and server-derived ownership. Archived/deleted/foreign topics cannot be selected or written as a different scope; retain their preference data and refuse alerts rather than remapping it to general.
- [ ] Serialize first writes, parent preference changes and message admission on the same account/chat barrier, including absent child rows. Keep a documented deterministic recipient/lock order compatible with existing membership locks. Cover concurrent revision0 creation, stale CAS, rollback on failure, disabled->inherit ABA, parent timed-mute expiry, membership removal/rejoin, topic archive/delete and message-topic edits with real two-session transactions.
- [ ] Run `node --test tests/server/topic-notification-overrides-db.test.mjs tests/server/topic-notification-overrides-concurrency.test.mjs`. The concurrency runner must require an explicitly isolated PG17 target and fail/refuse without it, never fall back to production configuration or report skipped cases as acceptance. Prove SQL/catalog/grant/owner/RLS and literal omission controls before the next task is accepted.

## Task3: Terminal Suppression Across Enqueue, Recheck, Album and Preview

**Modify through the new migration:** `enqueue_message_notifications`, `_enqueue_push_after_notification_insert`, `_notification_push_allowed`, `push_outbox_delivery_recheck`, `native_push_outbox_delivery_recheck`, `album_push_enqueue`, `album_push_recheck`, `native_message_notification_preview`. **Create:** `tests/server/topic-notification-delivery-db.test.mjs`.

**Interfaces:** add a server-only, monotonic `notifications.alert_suppressed_at` marker for message alerts; it cannot be cleared by enable, retry, claim or client writes. Preserve feed rows/read state. Add `message_notification_alert_decisions(p_notification_ids uuid[])` for the current authenticated recipient, bounded to100 IDs, returning only own IDs plus `allowed`, canonical scope and revision; foreign/malformed rows never produce allow. Unknown transport/schema results are not permission.

- [ ] Establish RED with real notification/message producers: enqueue while disabled, disable an already claimed single push, and disable an incomplete album then re-enable before its final part/retry. Assert literal zero provider-eligible results after suppression and unchanged notification/read rows.
- [ ] In the same mutation/admission transaction, stamp denied notifications and retire matching pending Web/native outboxes using their existing terminal suppression conventions, clearing their claims. Parent changes must recompute effective child policy, not suppress a child that remains explicitly enabled. Recheck the durable marker plus current trusted policy at all listed boundaries.
- [ ] For albums, examine each actual member's current message scope. Never route through a disabled member or reuse a stale payload. Keep eligible members deliverable; when none remain, preference denial is terminal even for an incomplete group, not its current delayed retry. Later parts cannot revive the suppressed target. Message/topic changes must not carry old admission into another scope.
- [ ] Native preview must still return the existing exact response/empty refusal, with current consent/session/device/read/card gates intact. Empty preview is not proof that native generic presentation was cancelled; do not alter provider privacy text or claim recall of a previously accepted FCM.
- [ ] Make `node --test tests/server/topic-notification-delivery-db.test.mjs` GREEN. Kill omissions of enqueue/recheck/partial-album/terminal-marker checks; include sender blocks, hidden/cleared messages, bans, access loss, DND/global/category false and read/self exclusions. No backlog replay on re-enable, reconnect or later subscription registration.

## Task4: Every Dispatcher Uses Fresh Checks, Including Legacy Opt-In

**Modify:** `supabase/functions/send-push-notifications/{index,album-dispatch}.ts` only where needed for the new denial contract; `artifacts/api-server/src/workers/pushDispatcher.ts`. **Create:** `tests/unit/topic-notification-dispatch.test.mjs`. **Extend affected tests:** `tests/unit/album-push-{dispatch,edge}.test.mjs`.

- [ ] Compile/import actual Edge and legacy worker paths with controlled provider ports. Hold delivery before its final recheck; disable, release, and require zero Web Push/FCM calls. Unknown/error/claim-lost results must not send. Preserve allowed single/album positive controls and exact token-bound ACKs.
- [ ] Replace legacy raw pending SELECT/direct send with the maintained `push_outbox_claim` -> `push_outbox_delivery_recheck` -> token-bound completion protocol. Respect suppressed rows, recipient/subscription ownership and existing retry bounds; opt-in must not bypass policy or race unclaimed cron delivery. Keep the production default opt-in setting unchanged.
- [ ] Run `node --test tests/unit/topic-notification-dispatch.test.mjs tests/unit/album-push-dispatch.test.mjs tests/unit/album-push-edge.test.mjs`; prove GREEN and literal bypass mutants. Distinguish final-check-before-provider ordering from impossible recall of a provider request already in flight; record that residual race honestly.

## Task5: Account/Reconnect State, Sound and Windows Without Feed Loss

**Create:** `artifacts/kub/src/hooks/useTopicNotificationPreferences.ts`, `tests/unit/topic-notification-owner.test.mjs`, `tests/unit/topic-notification-presentation.test.mjs`. **Modify:** `store/app.store.ts`, `hooks/useNotifications.ts`; reuse `useChatMute.ts` ownership patterns without weakening parent writes, `useCallSound.ts` and the Windows adapter/queue.

**Interfaces:** `useTopicNotificationPreferences(chatId)` exposes confirmed rows, loading/unavailable and CAS `setMode(topicId,mode,expectedRevision)`. Cache is display-only. An alert attempt captures `(UID,accountEpoch,mount/action generation)` and obtains current `message_notification_alert_decisions`; missing/failed authority never becomes allow.

- [ ] Mounted actual-hook RED: disabled topic still sounds/toasts today; a muted parent drops an explicitly enabled child; reconnect can present an old feed row. Verify feed/unread/read-state positives independently of alert calls.
- [ ] Add account-owned preference reads/realtime/reconnect reconciliation; dedupe within the same epoch, invalidate trust across loss, and reject delayed old-session reads/CAS ACKs even for the same UID. Pending writes show pending, not confirmed enable; conflicts restore server state without automatic overwrite. Do not build a new generic cache framework.
- [ ] Always merge legitimate notification feed rows. Replace chat-only early returns/filtering with a separate message alert gate; a scoped mute must not remove feed/read information. Sound retains current DND/audio/open-chat/ringing rules. Windows checks the owner and fresh server decision after foreground/native-loader awaits and before its serialized notify; retain exact-card replacement/read cleanup. Non-message notifications keep existing behavior.
- [ ] Suppressed notification IDs are terminal on reconnect, not eligible just because preferences later allow; use the durable server marker rather than an unbounded client UUID set. Run `node --test tests/unit/topic-notification-owner.test.mjs tests/unit/topic-notification-presentation.test.mjs`; kill stale-account, optimistic-allow, final-Windows-check and reconnect-replay omissions.

## Task6: Fullstack Acceptance, Safe Migration and Enforcement-Preserving Rollback

**Create:** `tests/server/topic-notification-overrides-fullstack.test.mjs` and `docs/operations/2026-10-16-topic-notification-overrides.md`; implementation evidence records the exact source/migration/artifact pins. Update tracker/HANDOVER only to match completed proof.

- [ ] Rehearse against an isolated full-schema PG17/PostgREST copy: real authenticated CAS/read -> actual message/album producers -> maintained claim/recheck -> actual Edge/legacy code with controlled provider endpoints -> actual client sound/Windows ports. No fake policy replacing the trusted resolver. Run `node --test tests/server/topic-notification-overrides-fullstack.test.mjs`; cover two accounts/devices, general aliases, stale CAS, all independent restrictions, partial albums, claim races, reconnect, rollback and unchanged feed/read state.
- [ ] Before any production SQL: verify exact schema/function/policy/trigger prestate, fresh backup plus restore proof; review locks/grants/RLS and transaction timeout; canonical/mirror bytes must match. Apply once in one transaction with raising self-checks for exact signatures, owners, search paths, ACLs, enabled triggers and semantic policy controls. Drift or missing dependencies must abort, not silently skip a patch. No old SQL reapply.
- [ ] Rollback is a retained-data compatibility mode, not DROP/restore-old-functions: keep override rows/revisions and monotonic suppression, retain child-disabled enforcement in enqueue/recheck/album/preview/client paths, and stop the enabled-child parent bypass if necessary. Prebuild/test an enforcement-compatible web/native rollback candidate; an old client that ignores overrides is not a safe rollback. Freeze new override writes during rollback if the compatible setter is unavailable. Prove disabled data still denies and old pending alerts cannot revive.
- [ ] Validate affected existing mute/notification/native-preview contracts once for changed inputs, kub typecheck and API build. Reuse Stable22/D366 evidence where unchanged. Require genuine source RED/GREEN and compiled literal mutants, not only query-shape/own-implementation assertions.
- [ ] Only then perform separately scoped owned fullstack delivery acceptance: Web Push, FCM/preview and client sound/Windows, parent-muted child-enabled plus inverse, unrelated account/topic positives, safe pending-disable race and retained read routing. Controlled provider acceptance does not establish OS delivery. Bind actual cleanup and artifact/runtime parity; do not replay unchanged native Auth/choice tests or claim universal OEM/lock behavior.

## Task7: Reachable Topic Control, Synthetic UI and Release Closure

**Create:** `artifacts/kub/src/components/chat/TopicNotificationControl.tsx`, `tests/e2e/topic-notification-overrides.spec.ts`. **Modify:** `artifacts/kub/src/components/chat/ChatHeader.tsx` to mount it for the current canonical text topic; add explicit topic context from `ChatWindow.tsx` if the header does not already receive a verified scope. Keep the parent mute control distinct. Complete Task6's actual fullstack gate before visual acceptance; source wiring alone remains unlaunched.

- [ ] Use the existing menu/segmented-control vocabulary for inherit/enabled/disabled, with confirmed state, pending, conflict and retryable error. General aliases share one control/state. No control for an unknown/foreign/archived scope. No restyling or OS-channel terminology.
- [ ] In a strict fictional fixture, show parent-muted + child-enabled and its inverse, CAS conflict, network refusal and account replacement. Set `KUB_QA_ALLOW_MUTATIONS=0` explicitly for every invocation; abort unknown requests and do not load real configuration/personal data.
- [ ] Run `pnpm.cmd exec playwright test tests/e2e/topic-notification-overrides.spec.ts --project=chromium-desktop-1440 --project=chromium-mobile-390 --workers=1` under that isolation. Inspect exact1440/390 light/dark pixels, fit, focus, control labels and parent/child distinction; no production screenshots/traces/video. This is UI proof, not fullstack delivery proof.
- [ ] Publish no local-only control or resolver-only release. Include every required migration/dispatcher/client consumer in the candidate and compatible rollback; verify deployment by actual image and public/container asset parity. Item77 remains open until the intended supported-client matrix and real delivery gates are accepted.

## Unresolved Facts / Execution Inputs

- No live schema, worker environment or database was inspected for this plan. Confirm composed function bodies (mentions + DND + binding patches), current constraints/triggers and legacy opt-in state before choosing exact migration anchors; abort drift rather than trusting historical SQL alone.
- Confirm general-topic uniqueness/reclassification and topic-delete FK behavior in the isolated schema. Do not assume deletion becomes null/general; Task2 must pin the real behavior without weakening history/access semantics.
- Existing Stable22/older Windows documents do not implement these new client alert checks. Server suppression alone cannot stop an old foreground realtime consumer sounding a retained feed row. Account-wide compatibility/rollout remains unproved until those consumers are upgraded or a tested compatibility boundary excludes them; do not relabel source tests as that proof.
- A native preview refusal currently permits generic fallback. It is not a topic-mute recall mechanism. Already provider-accepted/in-flight cards are outside the pending-outbox guarantee; any stronger post-provider requirement needs an explicit tested native admission/cancellation delta, not a boolean waiver or a changed preview parser.
- Approved semantics above are fixed; reference-client UI details can be dated in the existing reference record without reopening owner selection. The actual isolated PG17/PostgREST and owned delivery fixture inputs/receipts must be provided at execution, never guessed from private history.
