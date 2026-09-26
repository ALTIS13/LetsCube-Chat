# Bot Viewer Interface V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give one participant a short-lived, bot-controlled private status/action panel after pressing a bot button in a shared chat.

**Architecture:** Store the panel outside `public.messages` in a private table. Bot-token methods derive its viewer and source from an actual callback update; actor-only RPCs read, press and dismiss it. Existing bot update delivery is reused, with a marker that causes poll/webhook preparation to recheck panel validity.

**Tech Stack:** PostgreSQL/PLpgSQL, self-hosted Supabase PostgREST, Express/Zod Bot Gateway, React/TypeScript, Node tests, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-26-bot-viewer-interface-design.md`

## Global Constraints

- Never store private panel state in `public.messages` or publish its table through Realtime.
- No direct client/service-role table grants; all access goes through audited functions.
- The existing callback buttons, shared inline text input and installed Android keyboard shape must continue working.
- No production SQL without a verified backup, byte-identical migration copy, rollback, transactional rehearsal and self-check.
- Do not publish a native release for this web/backend feature.

## Review Focus

- A stale callback or guessed ID must not create a panel for another account; Task 1 tests bot/actor/source derivation.
- ACK cleanup of the source update must not destroy a still-valid creation grant, while expiry must; Task 1 tests both.
- A hide/rejoin or bot removal/re-add must not revive a panel; Task 1 tests irreversible revocation.
- A queued private button press must not reach polling or webhook delivery after closure; Task 2 tests both paths.
- A token rotated after gateway authentication must be denied at the writer, and its existing panels revoked; Tasks 1 and 3 test the race.
- Concurrent edit, press and close must not accept stale versions or send unexpected callbacks; Tasks 1-2 test locks and CAS.
- A delayed bot response or account switch must not flash private content to the wrong user; Task 4 tests transition timing.

---

### Task 1: Private panel storage and actor access

**Files:** Create `supabase/migrations/20260926193000_bot_viewer_interface.sql`, its `.migration-backup` copy and rollback; create `tests/server/bot-viewer-interface-smoke.sql`; modify `artifacts/api-server/src/bot/webhookWorker.ts` and its focused cleanup test.

**Interfaces:** Produce `public.bot_viewer_interface_set_internal(uuid,uuid,uuid,jsonb,text,text)`, `public.bot_viewer_interface_edit_internal(uuid,uuid,uuid,integer,jsonb,text,text)`, `public.bot_viewer_interface_close_internal(uuid,uuid,uuid,integer,text,text)` for service-role gateway calls; `public.bot_viewer_interfaces_for_actor(uuid)` and `public.bot_viewer_interface_dismiss(uuid,integer)` for authenticated clients. The bot ID and authenticated token ID are the first two internal arguments; actor identity always comes from `auth.uid()`.

- [ ] Write SQL assertions for an exact callback, wrong bot, wrong actor, expired grant, ACK-cleaned source update, unknown source, revoked token, no direct table read and bounded state; verify they fail before the migration.
- [ ] Add the callback issuance-grant table/trigger, private panel table, strict state validator, role grants, fixed TTL, capacity limits and create/edit/close functions with per-bot idempotency and expected-version CAS. Extend the existing `private.bot_operation_idempotency.method` CHECK for the three new method names with a prestate guard; do not bypass its fingerprint rule.
- [ ] Add actor read/dismiss functions and irreversible revocation on viewer hide/leave, source deletion and bot suspension. Include membership-epoch checks on every path. Add a bounded service-role cleanup RPC to the hourly worker and test its cutoff.
- [ ] Rehearse migration plus smoke in a transaction ending in `ROLLBACK`; verify repeat apply and rollback on an isolated schema copy.
- [ ] Commit only the reviewed SQL and its tests; do not apply to production until Tasks 2-4 and release gates pass.

### Task 2: Private button press and delivery revocation

**Files:** Extend the migration and SQL smoke from Task 1; add focused bot delivery tests in `tests/server/`.

**Interfaces:** Produce `public.bot_viewer_interface_press(uuid,integer,text) -> uuid`. Extend `private.bot_update_still_visible(uuid,text,jsonb)` for callback updates carrying `viewer_interface_id`; do not change unmarked updates.

- [ ] Write failing tests for forged/stale button keys, concurrent close, bot epoch changes, token rotation, expiry and queued press revoked before both `bot_updates_poll_internal` and `bot_delivery_prepare_internal`.
- [ ] Resolve callback data only from the locked stored panel, call existing `bot_update_enqueue_internal`, then mark that queued callback payload with the panel ID in the same transaction.
- [ ] Recheck the marked panel in the shared delivery guard and prove both polling and webhook preparation drop invalidated updates; verify unmarked callbacks still pass.
- [ ] Rehearse the final migration and rollback with the Task 1 tests; commit the reviewed correction.

### Task 3: Bot Gateway methods and public documentation

**Files:** Modify `artifacts/api-server/src/bot/schemas.ts`, `methods/`, `repository.ts`, method router/registry, `artifacts/kub/src/content/botApiDocs.ts`, `artifacts/kub/src/pages/public/BotDocsPage.tsx`; extend `tests/unit/bot-api-schemas.test.mts` and focused method tests.

**Interfaces:** Expose `setViewerInterface`, `editViewerInterface`, `closeViewerInterface` with the spec's bounded state, callback/interface IDs, idempotency keys and expected version. Return only ID/version/expiry, not viewer identifiers or raw callback data.

- [ ] Write red schema and route tests for valid calls, extra keys, oversize state, wrong bot, idempotent retry, CAS conflict and token revoked between gateway authentication and writer RPC.
- [ ] Add Zod shapes and repository RPC calls following existing `answerCallbackQuery` patterns; return safe errors without raw DB detail.
- [ ] Document visibility, 15-minute TTL, old-client fallback and that shared inline text is not private.
- [ ] Run API typecheck/build and focused unit tests; commit the API/docs slice.

### Task 4: Actor-only client panel

**Files:** Create `artifacts/kub/src/lib/botViewerInterface.ts` and `artifacts/kub/src/components/chat/BotViewerPanel.tsx`; modify `BotInlineKeyboard.tsx`/`ChatWindow.tsx`; add unit parser tests and `tests/e2e/bot-viewer-interface.spec.ts`.

**Interfaces:** Read active panels for the current `chatId` and current account only; press/dismiss via actor RPC. A successful original shared callback triggers an immediate refresh, with bounded follow-up polling for a late bot response.

- [ ] Write red browser cases for A/B account isolation, group visibility, slow response, refresh/reconnect, expiry, close, account switch, keyboard navigation and 390/1440 layout in both themes.
- [ ] Parse the RPC response strictly and render a stable, accessible panel outside message history. Keep failed/late requests neutral; no optimistic private panel or automatic action retry.
- [ ] Suppress an old-client fallback toast only when this client actually received the panel; retain existing callback feedback otherwise.
- [ ] Run unit/typecheck, complete bot-surface Playwright desktop/mobile Chromium and WebKit, and inspect screenshots before committing.

### Task 5: Release and controlled canary

**Files:** Update `docs/PRODUCTION_PRIORITY_TRACKER.md`, `docs/HANDOVER.md`, `docs/QA_RESULTS.md` and a dated operations report.

- [ ] Check the exact production schema/function prestate, backups, checksums and restore list; apply the migration once with self-check, then rerun actor-isolation SQL smoke with rollback.
- [ ] Push only reviewed commits after checking `origin/main..HEAD`; verify web, worker, mail bridge and manually triggered Bot Gateway by healthy image tags and public bundle marker.
- [ ] With an isolated QA bot and two QA accounts, prove A sees/presses the panel, B cannot read it, bot gets the marked callback, edit/close/expiry revoke it, and cleanup restores QA prestate.
- [ ] Record what is source/fixture versus live proof. Leave the feature unannounced or disabled if actor isolation, delivery revocation or old-client fallback fails.
