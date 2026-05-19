# QA Results

2026-05-16 Supabase generated database types:

- Ran `pnpm.cmd supabase:typegen` with `SUPABASE_PROJECT_REF=nhogbeojfnbjcfipitrh`; generated `artifacts/kub/src/types/database.generated.ts`.
- Generated types contain the expected public `Database` type, current public tables, functions/RPC, and enums. Key applied areas present: `locations`, `location_members`, `roles`, `permissions`, `role_permissions`, `user_global_roles`, `task_recurrences`, task soft-delete fields/RPC, and group invite RPC.
- Secret scan on `database.generated.ts` found no `service_role`, Supabase access token, QA email, or QA password strings.
- The generated file is not wired into app imports yet. Existing `artifacts/kub/src/types/database.ts` remains the active compatibility type file.
- Comparison against the manual file found one generated-only table, `notifications_push_outbox`, which is intentionally server-side; generated `messages` also includes `media_bucket` and `media_path`, which the manual file does not currently model. Generated RPCs include additional internal helper functions not represented in the manual app-facing type file. Enums matched.

2026-05-16 core QA tooling and Supabase typegen:

- Added root tooling scripts for Supabase typegen, Playwright e2e, RLS/RPC smoke, and scoped Biome lint/format.
- Supabase CLI is installed under the user's Scoop directory (`~/scoop/shims/supabase.exe`) at version `2.98.2`, but the current Codex terminal PATH does not include the Scoop shims path. Typegen script searches the common Scoop paths as a fallback and otherwise prints a friendly setup error.
- No SQL was applied. No Supabase tokens or QA passwords were printed.
- Playwright config now defines desktop viewports `3840x2160`, `1920x1080`, `1440x900` and mobile viewports `390x844`, `412x915`, with failure screenshots/video/trace under ignored `output/playwright-test` and `output/playwright-report`.
- Authenticated smoke tests read QA credentials from env or `~/.kub-messenger-qa.env` without logging the password.
- RLS/RPC smoke script uses anon + authenticated user session only, probes selected RPCs with safe fake UUIDs where possible, and does not use `service_role`.
- Validation passed: `git diff --check`, `pnpm.cmd --filter @workspace/kub run typecheck`, `PORT=5173 BASE_PATH=/ pnpm.cmd --filter @workspace/kub run build`, `pnpm.cmd format:check`, and `pnpm.cmd lint`. Build still emits the existing Vite sourcemap/dynamic-import/chunk-size warnings.
- Playwright smoke ran against `https://kub.apollot.ru` with viewports `1440x900`, `1920x1080`, `3840x2160`, `390x844`, `412x915`; all 5 projects passed with console errors 0.
- `pnpm.cmd supabase:typegen` was tested without `SUPABASE_PROJECT_REF` and stopped with the intended friendly error; no generated database file was written in this pass.
- `pnpm.cmd rls:smoke` was tested without Supabase URL/key env and skipped safely.

2026-05-16 owner / tech_admin task soft delete:

- Created proposal-only SQL at `.migration-backup/supabase/migrations/20260521_task_soft_delete_owner_tech_admin.sql`; SQL was not applied automatically.
- Proposed model adds `tasks.deleted_at`, `tasks.deleted_by`, `tasks.delete_reason`, `task_soft_delete`, `task_restore`, `task_bulk_soft_delete`, `tasks.delete`, `tasks.restore`, `tasks.bulk_delete`, task-event kinds `soft_delete`/`restore`, audit writes and recurrence generator protection for deleted templates.
- Frontend uses only RPC calls for task removal. No direct `delete()` against `public.tasks` was added.
- Normal task lists hide deleted tasks by default; users with global cleanup permissions can enable `Показать удалённые`. Deleted rows show a `Удалена` badge and task actions/comments are disabled.
- TasksPage adds owner/tech cleanup affordances: visible-task selection, selected count, bulk soft-delete modal with optional reason, and partial-success messaging. Task detail adds a single-task delete action behind the same permission gate.
- Authenticated Playwright QA ran against local UI `http://127.0.0.1:5173` with viewports 3840x2160, 1920x1080, 1440x900, 390x844 and 412x915. Screenshots and JSON summary are in `output/playwright/task-soft-delete/` (ignored from git): `desktop-3840x2160-tasks.png`, `desktop-1920x1080-tasks.png`, `desktop-1440x900-tasks.png`, `mobile-390x844-tasks.png`, `mobile-412x915-tasks.png`, `qa-result.json`.
- QA result: `/tasks` loaded on all required desktop/mobile viewports with console errors 0 and unexpected failed requests 0. Safe authenticated API smoke against `task_soft_delete` with a fake UUID returned 404, confirming the new soft-delete migration is not applied yet.
- QA limitation: the available QA account did not have owner/tech_admin cleanup permissions, so delete buttons and `Показать удалённые` were correctly absent for that account. Owner/tech_admin delete UI and actual soft-delete/restore behavior require manual verification after applying the migration with an owner/tech_admin account.

Снимок аудита: 2026-05-05. Test domain: `https://kub.apollot.ru` временный; домен нельзя хардкодить в source code.

## Passed

- Supabase MCP read-only подключение работает для проекта `nhogbeojfnbjcfipitrh`.
- В `public` найдено 17 таблиц, RLS включен на user-facing таблицах.
- Realtime publication содержит `bans`, `chat_members`, `chats`, `folder_chats`, `folders`, `messages`, `mutes`, `notifications`, `profiles`, `reactions`, `task_events`, `tasks`, `topics`.
- `tasks` и `task_events` используют direct write block policies; mutations идут через SECURITY DEFINER RPC.
- Sidebar source уже содержит `min-w-0`, fixed 36px icon buttons и profile menu с admin entry.
- Auth callback в frontend доменно-агностичный: redirect строится от текущего origin, не от hardcoded `kub.apollot.ru`.
- Heartbeat source использует singleton/refcount и throttle; `useChats`, `useTasks`, `useNotifications` уже имеют стабильные channel names и debounced refetch.

## Failed

- Auth logs за последние 24 часа все еще показывают `referer=tg.letscube.ru`. Это не доказывает hardcode в source code, но означает, что Supabase Auth URL/settings нужно держать под контролем при смене домена.
- Supabase Auth logs показывали SMS-provider setup error на `/user` при phone update. Это отдельный Supabase Auth/SMS configuration вопрос, не frontend secret/frontend privilege проблема.

## Applied In Production Supabase

- Task privacy/assignment уже применены: `tasks.visibility`, `tasks.assignment_scope`, `task_create_v2`, `task_update_v2`, `task_claim`, RLS `tasks select with visibility`.
- Storage `media` уже переведен на scoped policies: `media authenticated scoped read`, `insert`, `update`, `delete`.
- Folders policy cleanup уже применен: legacy `folders`/`folder_chats` `*_own` policies отсутствуют, остались scope-aware policies и restrictive banned-user guards.
- User manually applied `.migration-backup/supabase/migrations/20260507_message_hide_for_me.sql`; read-only MCP confirmed `message_hidden_for_users`, authenticated-only RLS policies and `hide_message_for_me` / `unhide_message_for_me` RPC.
- User manually applied `.migration-backup/supabase/migrations/20260507_message_hide_for_me_grants_hardening.sql`; read-only MCP confirmed `anon`/`PUBLIC` table/function grants are absent and authenticated access remains.
- User manually applied `.migration-backup/supabase/migrations/20260508_messages_client_message_id.sql`; read-only MCP confirmed `messages.client_message_id`, `messages.client_sent_at`, server `created_at default now()` and the idempotency lookup/unique indexes.

## Needs Manual Verification

- Browser QA на `https://kub.apollot.ru`:
  - login/logout/session restore;
  - direct refresh `/admin`, `/tasks`, `/auth/callback`;
  - sidebar profile menu на desktop и admin panel entry;
  - notifications popover;
  - tasks page/admin/audit;
  - folders create/edit/delete/add/remove chat;
  - voice recording/send/playback;
  - themes light/dark/system;
  - responsive 390px, 768px, 1280px.
- Network QA:
  - idle 2 минуты без request storm;
  - heartbeat примерно не чаще штатного интервала;
  - realtime websocket остается подключенным;
  - нет повторяющихся `Failed to fetch` / `ERR_INSUFFICIENT_RESOURCES`.
- Email confirmation UX:
  - успешная ссылка ведет на текущий `/auth/callback`;
  - expired/invalid link показывает дружелюбное сообщение, а не raw Supabase JSON.

## Needs DB Migration

- No pending DB migration for message hide-for-me or delivery receipts after the user's 2026-05-07 manual applies. Future group read-count/all-delivered UX would need a separate schema design.

## Needs UX Polish

- Chat list search сейчас ищет по названию чата и last message text, но не по всем сообщениям.
- In-chat search работает только по загруженным сообщениям текущего чата, не по всей истории.
- Нет глобальной search/command palette.
- Task filters пока не знают о pool/unassigned/visibility; SQL уже применен, следующий этап - frontend alignment на `task_create_v2`, `task_update_v2`, `task_claim`.
- Chat overview в `useChats` все еще делает per-chat last-message/unread enrichment; при росте количества чатов стоит вынести это в RLS-safe RPC/view отдельной миграцией.

## Browser QA Notes

Safe QA note: Live QA should use the Codex/QA browser session or QA credentials from a secure environment; never store secrets in the repo and do not depend on the user's mouse/manual browser.

2026-05-13 desktop tab-return refresh/reinit diagnosis:

- Playwright live probe on `https://kub.apollot.ru` before the auth-listener patch classified the reproducible automated tab-switch path as not a browser document reload: document navigation requests `0`, main-frame navigations `0`, `beforeunload/pagehide` `0`, `window.__kubNoReloadMarker` survived, composer draft survived, and staged attachment survived.
- Code diagnosis found the remaining real-desktop risk in `useUser`: Supabase can emit `SIGNED_IN` again when a hidden tab is focused; the old handler treated every `SIGNED_IN` as a blocking profile load, rendered `LoadingScreen`, and could remount `MainLayout/ChatWindow` even when the same user was already loaded.
- Patch behavior: same-user auth events refresh the profile/realtime token silently; only a user identity change blocks the UI with the loading screen.
- Live deploy QA after the updated bundle reached `https://kub.apollot.ru`: the same probe kept `window.__kubNoReloadMarker`, composer value `TAB_RETURN_TEST_*`, and staged attachment count `1` after a second-tab `bringToFront` switch plus supplemental focus/visibility events. Document navigation requests `0`, main-frame navigations `0`, `beforeunload/pagehide` `0`, `LoadingScreen` hits `0`, textarea disappearance hits `0`, console errors `0`, failed requests `0`.
- Playwright probe artifacts:
  - `output/playwright/desktop-tab-return/desktop-3840x2160.png`
  - `output/playwright/desktop-tab-return/desktop-1920x1080.png`
  - `output/playwright/desktop-tab-return/desktop-1440x900.png`
  - `output/playwright/desktop-tab-return/mobile-390x844.png`
  - `output/playwright/desktop-tab-return/mobile-412x915.png`
  - `output/playwright/desktop-tab-return/summary.json`

2026-05-13 mobile keyboard inset / tab return polish:

- Local Playwright QA used `http://127.0.0.1:5173` production preview with the current local JS bundle. Because the Windows build still emits the known small Tailwind CSS bundle, visual local QA injected the current live production CSS as a stylesheet shim; screenshots below are ignored artifacts under `output/playwright`.
- Viewports checked locally with Playwright: `3840x2160`, `1920x1080`, `1440x900`, `390x844`, `412x915`.
- Screenshot evidence:
  - `output/playwright/mobile-keyboard-inset/desktop-3840-open-chat.png`
  - `output/playwright/mobile-keyboard-inset/mobile-390-keyboard-closed.png`
  - `output/playwright/mobile-keyboard-inset/mobile-390-input-focused.png`
  - `output/playwright/mobile-keyboard-inset/mobile-390-multiline.png`
  - `output/playwright/mobile-keyboard-inset/mobile-390-staged-attachment.png`
- Mobile `390x844` local metrics after staged attachment/tab-return simulation: composer height `166px`, scroller bottom equals composer top, `scrollGap = 0`, MessageList padding-bottom `24px`, `--kub-keyboard-inset = 0px`, `--kub-message-list-bottom-inset = 0px`, visual gap between last message and composer `26px`, horizontal overflow `0`.
- Tab-return local QA: a draft marker, composer text, and staged attachment survived the simulated tab switch/visibility return; no document reload marker loss was observed.
- Local console errors `0`, failed requests `0`. Headed browser on the physical 4K monitor was not used to avoid interfering with the user's workspace; screenshots were taken with Playwright-controlled viewports.
- Live deploy QA after Coolify updated the bundle (`https://kub.apollot.ru` contained `preserveActiveChat` and the focus-gated keyboard threshold code): Playwright checked `3840x2160`, `1920x1080`, `1440x900`, `390x844`, `412x915` without a CSS shim. Live metrics matched the local result: mobile `390x844` staged state had composer height `166px`, MessageList padding-bottom `24px`, `--kub-keyboard-inset = 0px`, `--kub-message-list-bottom-inset = 0px`, visual gap `26px`, horizontal overflow `0`; tab-return marker/text/staged attachment survived. Console errors `0`, failed requests `0`.

2026-05-13 mobile chat bottom overlap polish:

- Local Windows production build currently emits a small Tailwind CSS bundle without generated utility classes, while the live Linux/Coolify bundle contains the expected utilities. For local screenshot QA of the current JS bundle, Playwright used `http://127.0.0.1:5173` production preview with the current live production CSS stylesheet injected as a visual QA shim.
- Viewports checked with Playwright: `3840x2160`, `1920x1080`, `1440x900`, `390x844`, `412x915`.
- Screenshot evidence:
  - `output/playwright/mobile-bottom-overlap-desktop-3840-open-chat.png`
  - `output/playwright/mobile-bottom-overlap-mobile-390-open-chat.png`
  - `output/playwright/mobile-bottom-overlap-mobile-390-focused-multiline.png`
  - `output/playwright/mobile-bottom-overlap-mobile-390-staged-attachment.png`
- Mobile metrics at `390x844`: composer height tracked `70px` on open, `118px` with multiline draft, and `214px` with staged attachment; MessageList padding-bottom tracked `94px`, `142px`, and `238px`; `scrollGap = 0`; document horizontal overflow was `0`.
- Mobile metrics at `412x915` with staged attachment: composer height `214px`, MessageList padding-bottom `238px`, `scrollGap = 0`, horizontal overflow `0`.
- Desktop metrics at `3840x2160`, `1920x1080`, `1440x900`: scroller bottom and composer top aligned; `scrollGap = 0`; horizontal overflow `0`.
- Headed browser on the physical 4K monitor was not used to avoid interfering with the user's workspace; screenshot QA was done with Playwright-controlled browser viewports.
- Live deploy QA after Coolify updated the bundle (`https://kub.apollot.ru` contained the new `--kub-composer-height` / `--kub-message-list-bottom-inset` code): Playwright checked `3840x2160`, `1920x1080`, `1440x900`, `390x844`, `412x915`; console errors `0`, failed requests `0`.
- Live screenshot artifacts:
  - `output/playwright/mobile-bottom-overlap/desktop-3840-open-chat.png`
  - `output/playwright/mobile-bottom-overlap/mobile-390-open-chat.png`
  - `output/playwright/mobile-bottom-overlap/mobile-390-focused-multiline.png`
  - `output/playwright/mobile-bottom-overlap/mobile-390-staged-attachment.png`

2026-05-10 admin users bulk roles / location QoL note:

- Users panel now has selection, visible-row select/clear, global-role and location bulk actions, and location/global-role/status filters.
- Mobile admin content received `min-h-0`/bottom padding so long users lists and sticky bulk controls can scroll to the end on 390/412px viewports.
- Bulk role assignment uses existing `user_assign_global_role` / `user_remove_global_role` RPC per selected user; bulk location assignment uses existing `location_member_assign_role` or `location_member_assign` per selected user.
- New SQL was not applied automatically. Proposal `.migration-backup/supabase/migrations/20260516_dynamic_roles_default_user_baseline.sql` adds an idempotent default dynamic `user` role trigger/backfill for newly registered normal users.

2026-05-09 notifications/group-invites stage note:

- Live/authenticated QA must use the Codex/QA browser session or local QA credentials kept outside the repo.
- Do not store QA passwords, auth tokens, cookies or service-role keys in docs, `.env.example`, README or committed source.
- Group invites required manual application of `.migration-backup/supabase/migrations/20260509_group_invites.sql`; the user later applied it on 2026-05-10, while the frontend keeps the migration-required fallback for other environments.
- SQL was not applied automatically during this stage.

2026-05-05 logged-in Browser QA на `https://kub.apollot.ru`:

- Sidebar/profile menu на desktop работает; пункт `Админ-панель` доступен из меню профиля.
- Sidebar search/notification/new chat icons проверены на 390px, 768px и 1280px; document horizontal overflow не обнаружен.
- Notification bell открывается и не выталкивает layout за пределы sidebar.
- Direct refresh `/admin` проходит, dashboard и audit tab открываются без console errors.
- `/tasks` открывается, текущий task UI еще не выровнен под `visibility`/`assignment_scope`/`task_claim`.
- Network на admin dashboard показал лишние повторные metric count-запросы от realtime `profiles` updates; frontend fix убрал `profiles` realtime trigger для dashboard и добавил overlapping-load guard.
- Скриншоты не коммитить; локальные browser artifacts остаются untracked.
- Replit overlay/banners checked: production `kub.apollot.ru` не должен показывать Replit preview UI; `IframeAuthBanner` ограничен Replit iframe-контекстом, а Replit runtime overlay отключен для production build.

## Phase 2 Task V2 Inspection

2026-05-05 Supabase MCP read-only подтвердил, что production Supabase уже готов для task v2:

- `tasks.visibility task_visibility not null default 'staff'`.
- `tasks.assignment_scope task_assignment_scope not null default 'user'`.
- enums `task_visibility = staff/private/chat` и `task_assignment_scope = user/manager_pool/staff_pool`.
- RPC `task_create_v2`, `task_update_v2`, `task_claim`.
- RLS `tasks select with visibility` и `task_events select with visibility`.
- Direct writes to `tasks` / `task_events` blocked; mutations go through RPC.
- Realtime publication includes `tasks` and `task_events`.

Repo state:

- `artifacts/kub/src/types/database.ts` already contains task v2 columns, enums and RPC types.
- `docs/SUPABASE_SCHEMA_MAP.md` and `docs/SUPABASE_CURRENT_STATE.md` already describe task v2 as applied.
- `docs/SUPABASE_MIGRATION_RULES.md` was updated so the 20260505 task/storage/folders SQL files are no longer marked as pending.

Frontend gap:

- `TaskFormModal` still calls compatible old RPC `task_create` / `task_update`.
- `TaskAssignModal` still calls `task_assign`.
- `task_claim` is not used in UI yet.
- Task cards/details do not yet show `visibility` / `assignment_scope` badges.
- Task filters do not yet expose pool/private/staff/chat views.

Next safe task UI alignment:

1. Read-only UI badges for task `visibility` and `assignment_scope`.
2. Add `task_claim` button for eligible staff pool tasks.
3. Add staff-friendly task filters for my/available/waiting/all/private/chat.
4. Move create/edit to `task_create_v2` / `task_update_v2` with client-side guards while keeping RLS/RPC as source of truth.

## Phase 3 Task Claim And Replit Overlay

- `task_claim` frontend action added for eligible pool tasks: staff/admin/manager role, `status = new`, `assignment_scope != user`, no `assignee_id`.
- Backend RPC/RLS remain the source of truth; SQL was not changed or applied.
- Existing create/edit/assign workflow remains on compatible `task_create`, `task_update`, `task_assign` in this phase.
- Browser QA on current data needs a real pool task to click the claim path. Existing visible tasks may not include pool tasks.
- Replit overlay/banners checked in source: production build should not include Replit runtime overlay, and iframe auth banner should only show in Replit iframe context.

## Phase 4 Task Notification UX

- Supabase read-only inspection confirmed task notification payload already contains `task_id`; no migration is required for task deep links.
- Current issue reproduced in browser: clicking a task notification opened `/tasks` only, leaving the user on the default tab instead of opening the task.
- Frontend now uses `/tasks?task=<task_id>` for task notifications, and `/tasks?task=<id>` opens `TaskDetailModal` directly after refresh.
- If RLS hides the task or the task was deleted, the modal shows: `Задача недоступна или была удалена.`
- Non-staff users no longer see the task cancel action in `TaskDetailModal`; RPC/RLS remain the source of truth.
- Staff task tabs now include `Доступные` for unassigned `manager_pool` / `staff_pool` tasks with `status = new`.

## Roles And Permissions Foundation

- Supabase read-only audit confirmed current authorization is still based on `profiles.role`, `app_role`, `is_admin()` and `is_manager_or_admin()`.
- Dynamic roles should be introduced as a staged compatibility layer, not by replacing existing RLS/RPC at once.
- Added planning docs and SQL proposal only; production DB was not changed.
- Manual SQL proposal: `.migration-backup/supabase/migrations/20260505_roles_permissions_foundation.sql`.

## Production UI Consistency Audit

2026-05-05 Browser QA checked the live UI on `https://kub.apollot.ru` without hardcoding the domain in source code.

- Viewports checked: 390x844, 768x1024, 1280x720, 1920x1080, 3840x2160.
- Routes checked: `/`, `/tasks`, `/admin`, `/admin/users`, `/admin/bans`, `/admin/audit`; logged-in `/login` and `/register` redirect back to the app as expected.
- Areas checked: sidebar, chat list/search, notification bell, profile/settings modal, chat window/message input, task cards/detail modal/actions, admin dashboard, users, bans/mutes, audit expanded details.
- Automated viewport audit found no document-level horizontal overflow on the checked routes.
- Notification popover, profile menu, task detail modal and admin user action menu stay inside the mobile viewport.
- Mobile audit expanded details were visually too narrow because the desktop left offset and label/value row layout were reused on 390px. The audit detail panel is now full-width on mobile, while desktop keeps the indented layout.
- Screenshots are stored under `output/playwright/` and are not intended for commit.

## Task UX Hardening

2026-05-05 frontend-only task UX pass:

- SQL/RLS/RPC were not changed.
- Task detail now shows contextual callouts for `waiting_confirmation`, rejected reason from `task_events.payload.reason`, and available pool tasks.
- Task actions are visually grouped into a bordered action area; assignment/edit remain secondary, and cancel is styled as a destructive action instead of competing with the primary CTA.
- The comment send icon-only button now has an explicit `aria-label`.
- Task cards wrap assignee/update/due metadata safely on mobile instead of forcing a single crowded row.

## Messenger Keyboard And Search UX

2026-05-05 frontend-only messenger UX pass:

- SQL/RLS/RPC were not changed.
- `Ctrl+K` / `Cmd+K` focuses the existing chat search; on mobile it first returns from the open chat to the chat list.
- `Escape` closes the profile menu and notification popover; on mobile it returns from an open chat to the chat list when focus is not inside an input/textarea.
- Message input keeps Enter-to-send and Shift+Enter newline behavior, but now avoids sending while IME composition is active and does not send while upload is in progress.
- Message input `Escape` closes emoji/attachment popovers without clearing typed text.
- Chat notifications already navigate to the target chat when payload contains `chat_id`; task notifications continue to use `/tasks?task=<id>`.

## Supabase Password Recovery Flow

2026-05-06 frontend-only hotfix:

- Supabase recovery links intentionally create a temporary authenticated session.
- The app must not treat `PASSWORD_RECOVERY` as a normal login; it must show the password update form first.
- Recovery is now detected by `/auth/callback?type=recovery`, `#type=recovery`, and the Supabase `PASSWORD_RECOVERY` auth event.
- While recovery state is active, the user stays on the password update screen even if Supabase has already established a session.
- After successful `supabase.auth.updateUser({ password })`, the app clears recovery state, signs the user out, and returns to `/login?password_reset=1`.
- Invalid/expired recovery links show a friendly Russian message instead of raw Supabase output.
- Confirmation email flow remains separate: non-recovery auth callback can still complete login/confirmation normally.

## Chat Safety And Task Roadmap Notes

2026-05-06 avatar/profile and chat safety pass:

- Own avatar/profile editing remains in `SettingsModal`; other users' avatars are not edited from normal user profile surfaces.
- Group/channel avatar editing is only shown for chat owner/admin; private chats and `Избранное` do not show chat avatar/name edit controls.
- Direct global `Очистить историю` was removed from chat header/info UI because production DB does not yet have a safe per-user clear/hide model.
- Manual SQL proposal prepared, not applied: `.migration-backup/supabase/migrations/20260506_chat_history_private_hide_permissions.sql`.
- Manual SQL proposal prepared, not applied: `.migration-backup/supabase/migrations/20260506_chat_pins.sql`.
- Until those proposals are applied and frontend-aligned, private chat deletion is intentionally not exposed as a destructive global delete.
- `Избранное` is sorted above regular chats in frontend as a system-like saved space.

2026-05-06 follow-up:

- User manually applied `.migration-backup/supabase/migrations/20260506_chat_history_private_hide_permissions.sql`.
- User manually applied `.migration-backup/supabase/migrations/20260506_chat_pins.sql`.
- Supabase read-only check confirmed `chat_members.hidden_at`, `chat_members.cleared_at`, `chat_members.pinned`, `chat_members.pinned_at` and RPC `clear_chat_for_me`, `hide_private_chat`, `unhide_private_chat`, `pin_chat`, `unpin_chat`.
- Frontend alignment is enabled for local chat clear, private chat hide, and per-user chat pin/unpin.
- User manually applied `.migration-backup/supabase/migrations/20260506_admin_avatar_management.sql`.
- Supabase read-only check confirmed `_kub_media_path_allowed` now permits admin-managed uploads to `avatars/{target_user_id}/...` for non-admin profile rows, while users keep only their own avatar path.
- Frontend admin profile preview now exposes upload/reset avatar controls for ordinary users only. Manager/admin-to-admin avatar management remains hidden and backend-controlled.
- `Очистить историю у себя` is documented and worded as a local hide: messages and attachments disappear only for the current user; Storage files are not deleted.
- Destructive "delete my media from chat" remains planned only. It needs a separate RPC design because one participant must not delete media still visible to another participant.
- Chat media panel now renders gallery media lazily in small batches with lazy images and non-preloaded video previews.

2026-05-06 production bugfix follow-up:

- Hidden private chats are reactivated from the frontend via existing `unhide_private_chat` RPC when a new message makes them visible again or when the user starts the same private chat again.
- Media gallery clicks now use the in-app `MediaViewer`; video previews stay lightweight and do not preload the video file in the grid.
- Avatar uploads are limited in frontend validation to JPG, PNG, WebP and GIF up to 2 MB. The shared `media` bucket currently has no global `file_size_limit`; do not set a bucket-wide 2 MB limit because the bucket also stores voice/messages/files.
- Profile bootstrap now keeps the app on the loading screen until the authenticated user's `profiles` row is loaded or created, avoiding a half-broken UI with `currentUser = null`.
- Message pin/unpin actions are exposed to authenticated chat viewers and backend RPC remains the source of truth; this avoids hiding pin controls while membership role data is still catching up.

Recurring tasks roadmap note:

- Future task-system phase should add recurring tasks: daily, weekly, monthly, yearly, custom interval, `next_run_at`, auto-create next occurrence, stop recurrence, reuse `visibility` / `assignment_scope`, and history of occurrences.

2026-05-06 production data consistency follow-up:

- Supabase read-only audit confirmed the current `media` Storage bucket is public. This is acceptable only for avatars, not for private/group chat media.
- Added `docs/MEDIA_SECURITY_PLAN.md` and migration proposal `.migration-backup/supabase/migrations/20260506_secure_chat_media_access.sql` for a private `chat-media` bucket and `messages.media_bucket` / `messages.media_path` rollout.
- Message timeline initial fetch now loads the newest 100 visible messages, then sorts them ascending in the store. This fixes the case where a just-sent message appeared realtime/sidebar but disappeared from the active chat after refresh in long chats.
- Pinned messages and media gallery now re-check current `chat_members.cleared_at` before rendering local cleared history, so old pinned/media entries should not flash back after local clear/hide.
- Media gallery now fetches media from DB in pages and filters by `cleared_at`; image/video clicks still use the in-app viewer.
- Added a non-destructive app update banner that detects a new Vite entry bundle on interval/visibility return and asks the user to refresh instead of forcing a full page reload.

2026-05-06 chat consistency follow-up:

- User manually applied `.migration-backup/supabase/migrations/20260506_secure_chat_media_access.sql`; Supabase read-only check confirmed private `chat-media`, chat media policies and `messages.media_bucket` / `messages.media_path`.
- Legacy `media` bucket remains public for avatars/old media compatibility. Full security still requires moving new message uploads and legacy media reads to `chat-media` signed URLs.
- Chat preview now filters last message/unread counts by current user's `chat_members.cleared_at`.
- Chat search ignores soft-deleted message placeholders.
- Topic-aware text/media/voice sends now include `topic_id`; when topics are disabled the message hook no longer filters out topic messages.
- Frontend name limits were added for group/chat/folder/topic names. `.migration-backup/supabase/migrations/20260506_entity_name_constraints.sql` was applied manually on 2026-05-06; read-only MCP confirmed active checks on `chats.name`, `folders.name` and `topics.name`.

2026-05-06 messenger polish follow-up:

- `rg` is installed and available in PATH (`ripgrep 15.1.0`); use it as the primary project search tool.
- Forum chats now expose a frontend pseudo-topic `Общие` for legacy/general messages with `messages.topic_id IS NULL`; database `topics.is_general` rows are treated as part of that general stream for compatibility.
- Bulk message selection is entered from the message action menu (`Выбрать сообщения`) instead of a persistent toolbar button.
- Media gallery uses lightweight placeholder tiles for image/GIF/video batches; full media is loaded only when opened in the in-app viewer. Real thumbnail generation remains a future media pipeline task.
- App update prompt no longer has a permanent skip action. `Напомнить позже` snoozes briefly; fatal chunk-load errors show a blocking reload prompt.

2026-05-06 production stability follow-up:

- Mobile bulk delete selection was adjusted: selection starts from the message action menu, the action menu closes immediately, and deletion uses an in-app two-step toolbar confirmation instead of a native browser confirm.
- Long text messages and long URLs now use `overflow-wrap:anywhere` / `break-word` so message bubbles do not stretch the chat horizontally.
- Typing broadcasts are scoped by active chat/topic and cleared on chat/topic switch to prevent stale typing indicators from leaking into another chat.
- Profile bootstrap now exposes a retryable loading error state instead of leaving users on an unexplained spinner forever.
- Media gallery now shows lazy real previews for static image items on the current page; GIF/video remain lightweight placeholders until opened in the in-app viewer.
- Root `docker-compose.yml` now has an nginx healthcheck for Coolify/container readiness; docs deploy compose files already had healthchecks.
- App update banner now also reports temporary server connection instability, which can happen during redeploy, without forcing an automatic reload.

2026-05-06 message layout / realtime follow-up:

- Native browser `confirm` / `alert` / `prompt` scan remains clean in `artifacts/kub/src`.
- Chat list media previews now use semantic labels (`Фото`, `GIF`, `Видео`, `Голосовое`, `Файл`) instead of raw media URLs.
- Muted chat state is still local per-device (`ng_muted` in localStorage); the UI now uses a larger bell-off indicator. A DB-backed per-user preference can be added later if cross-device mute sync is required.
- Active chat message sync has a fallback: sidebar message realtime events dispatch a debounced active-chat refetch/merge event so the open MessageList does not miss rows that already appeared in the chat preview.

2026-05-07 message hide-for-me frontend follow-up:

- Frontend now exposes `Удалить у себя` for visible messages and keeps `Удалить для всех` separate for own non-saved-chat messages.
- Bulk selection can hide any selected visible messages locally; global bulk delete is offered only when all selected messages are own messages in a non-saved chat.
- Active MessageList, pinned messages, in-chat search, media gallery and chat preview now filter out rows present in `message_hidden_for_users` for the current user.
- `20260507_message_hide_for_me.sql` and `20260507_message_hide_for_me_grants_hardening.sql` are no longer pending.

2026-05-07 message receipts / reactions follow-up:

- Bubble and chat-list preview both use `getMessageDeliveryState`. Current honest states are: sending, sent, failed and private-chat read via the other member's `last_read_at`; saved chats show no checkmarks and group chats do not show fake read state.
- `20260507_message_delivery_receipts.sql` is now applied. Read-only MCP confirmed `chat_members.last_delivered_at`, `mark_chat_delivered(p_chat_id uuid)` and `mark_chat_read(p_chat_id uuid)` with authenticated-only execute grants.
- Bubble and chat-list preview now support private-chat delivered state via the other member's `last_delivered_at`; saved chats still show no checkmarks and group chats still do not show fake read/delivered state.
- Desktop message action menu now includes the same quick reaction row as the mobile long-press sheet.

2026-05-07 receipt sync / bubble rhythm follow-up:

- Sender-side receipt sync now uses one stable `chat-members:receipts:{userId}` subscription in `useChats` for RLS-visible `chat_members` UPDATE rows. It patches affected chat members in store instead of refetching all chats, so inactive chat preview can move from sent to delivered/read.
- The older active-chat-only receipt path was the reason sender checkmarks updated after entering the chat; active bubbles and preview now read the same store member receipt state.
- Text bubbles without reactions render footer meta inline at the end of the text flow; reaction bubbles keep the compact bottom meta row.
- Link bubbles no longer force a wide desktop width; they use fit-content with responsive max-width and URL wrapping.

2026-05-08 reliable send follow-up:

- Text, location, media, voice and forwarded message inserts now include `client_message_id` and `client_sent_at`, but do not send client `created_at`.
- Message bubbles stay pending until the DB insert returns/fetches the server row; the server `created_at` replaces the local pending timestamp after acknowledgement.
- Retry reuses the same `client_message_id` and fetches an existing row on duplicate/unknown responses, preventing duplicate messages after network timeouts.

2026-05-08 chat actions/profile/group receipts follow-up:

- Chat list `Открыть профиль` / group info actions now open a separate preview modal/sheet without changing `selectedChatId`; the chat opens only from the explicit `Открыть чат` button.
- Mobile chat long-press suppresses the touch `contextmenu` path, so only the bottom action sheet should appear.
- Supabase read-only check confirmed `chat_members.last_read_at` is visible to chat members through existing RLS and `chat_members` is in realtime; group own-message read counts and the `Кто прочитал` modal use that data without faking private receipt states.
- User manually applied `.migration-backup/supabase/migrations/20260508_chat_pinned_order.sql`; read-only MCP confirmed `chat_members.pinned_order`, `set_pinned_chat_order(uuid[])`, authenticated-only execute grants and no anon/PUBLIC execute access.

2026-05-08 pinned/profile/group receipt polish:

- Group own-message footer now uses a compact `✓ count/total` read indicator instead of appending a second loose read badge after the sent check; full names remain in the `Кто прочитал` modal.
- Pinned chat order UI is enabled through context menu / mobile sheet `Переместить выше` and `Переместить ниже`; saved chat remains above all pinned chats.
- Mini-profile preview no longer shows service copy about preview mode and now displays profile `bio` plus a localized app role label when available.

2026-05-08 bubble/footer/group preview/pinned drag polish:

- Message bubble meta now uses measured Telegram-like placement for text/link/reply cases: meta stays inline when it fits the measured last text line and falls back to a compact next-line-end row only when needed. Reactions render below the text+meta group, while float/absolute text footer, artificial spacer/wbr, and large padding reserve are not used for ordinary text bubbles.
- Chat-list preview now derives own group-message read count from the same `chat_members.last_read_at` member data as in-chat receipts; online status is not used as read state.
- Desktop pinned chat drag reorder is enabled through a lightweight handle and still persists through `set_pinned_chat_order(uuid[])`; context-menu and mobile sheet move up/down actions remain the fallback.

2026-05-08 anchored bubble meta / compact reactions follow-up:

- Text meta no longer uses "fits last line" as the only Telegram-like rule. Inline meta is limited to simple single-line text; wrapped multiline text, long URLs/tokens and reply/compound bubbles use anchored bottom-right meta inside the bubble.
- Anchored meta uses a measured final-line tail reserve only when the last text line would run under the footer; it does not apply global right/bottom padding and reactions do not participate in the text/meta placement decision.
- Reactions are rendered as a secondary compact layer below text+meta: the default row shows up to two reaction chips plus `+N`, with the overflow list shown as an overlay on hover/focus or by tapping `+N`.

2026-05-09 final message bubble polish:

- Anchored text meta no longer inserts an inline tail spacer for long CAPS / long-token messages. If the final text line would collide with the footer, the footer uses a compact bottom-end flow row; otherwise it stays anchored over the natural free corner.
- Location messages that match `📍 Местоположение: https://maps.google.com/?q=lat,lng` are displayed as rounded coordinates while preserving the original map href; ordinary Google and non-map URLs still use the regular formatter.
- Very short messages with multiple reactions now default to one visible reaction chip plus `+N`, so the reaction layer does not widen the core text+meta bubble.

2026-05-09 final bubble geometry follow-up:

- `+N` reaction overflow now opens in a fixed portal popover anchored to the `+N` chip instead of expanding inline inside the bubble, so hidden reactions do not shift message geometry or render under neighboring messages.
- Location messages are classified as compact short text before URL layout is chosen. Desktop keeps the full `📍 Местоположение:` label, while narrow/mobile viewports use the shorter `📍` label; both preserve the original Google Maps href.
- Anchored multiline/long-token text meta keeps Telegram-like behavior: it remains bottom-right when the final text line leaves room, and uses a compact measured bottom-end slot only when the final line would collide with the footer.

2026-05-10 notifications bounds / group invites follow-up:

- User manually applied `.migration-backup/supabase/migrations/20260509_group_invites.sql`.
- Read-only Supabase MCP confirmed `public.group_invites` exists with RLS enabled and expected FKs to `chats`/`profiles`; available MCP table introspection does not expose RPC definitions, so RPC behavior is verified through authenticated app QA.
- Notification popover QA should use the Codex/QA browser session or secure local QA credentials; never store secrets in repo/docs and do not depend on the user's mouse.

2026-05-10 group invite status/live update follow-up:

- Group info now has an owner/admin invite-status section backed by `public.group_invites`.
- The invite modal reads all latest invite statuses for the current chat: pending users are disabled, members are disabled, declined/cancelled/expired users can be invited again.
- Chat info subscribes to current-chat `chat_members` and `group_invites` realtime changes and refetches both lists after changes; action handlers also refetch after invite/cancel/remove/role changes.
- No SQL was applied automatically. Manual proposal pending: `.migration-backup/supabase/migrations/20260510_group_invite_join_system_messages.sql` for persistent join system messages after invite accept.

2026-05-10 invite unread / role / system notice follow-up:

- Frontend chat unread calculation now uses an effective baseline from `last_read_at`, `joined_at` and `cleared_at`, so accepted invitees do not inherit unread counts from pre-join history when `last_read_at` is still null.
- Chat list/store comparison now includes `chat_members.role`, allowing current-user admin/owner role changes to update role-gated UI after realtime/refetch without a full page refresh.
- System messages render as centered micro-notices outside `MessageBubble`; they do not show avatar, delivery checks, reactions, reply controls or normal user bubble styling.
- No SQL was applied automatically. New manual proposal pending: `.migration-backup/supabase/migrations/20260511_invite_accept_read_baseline_and_system_notice.sql`.

2026-05-10 reinvite / invite policy follow-up:

- Historical accepted invites are now treated as history unless the invitee is still present in `chat_members`; removed ex-members become inviteable again in both the invite modal and owner/admin invite status list.
- Invite UI uses friendly status/error copy only. Technical RPC names, raw payloads, UUIDs, PostgreSQL codes and stack details remain console-only diagnostics.
- Group info includes a gated "Кто может приглашать" setting. Until the manual DB proposal is applied, the UI falls back to `owner_admin_only` and shows a friendly migration-required note instead of breaking.
- No SQL was applied automatically. New manual proposal pending: `.migration-backup/supabase/migrations/20260512_group_invite_reinvite_and_policy.sql`.

2026-05-10 microphone self-monitoring follow-up:

- Mic test lives in `artifacts/kub/src/components/sidebar/AudioSettingsSection.tsx`; voice-message recording remains isolated in `artifacts/kub/src/hooks/useVoiceRecorder.ts` and `artifacts/kub/src/components/chat/VoiceRecorder.tsx`.
- Mic test now has an explicit "Прослушивать себя" toggle. It is off by default, enabled only while the mic test is active, and creates a local-only `AudioContext -> MediaStreamSource -> GainNode -> destination` monitoring path.
- Stopping the mic test, closing settings, disabling the toggle, or losing the mic stream disconnects monitoring nodes and closes the owned AudioContext. The mic test stream remains separate from normal voice-message recording and is not sent to chat.

2026-05-10 microphone self-monitoring quality follow-up:

- Mic test adds a local-only processing mode selector: "Чистый голос" requests browser echo cancellation, noise suppression, auto gain, mono input and 48 kHz / 16-bit ideals; "Без обработки" requests those processing constraints off.
- If advanced constraints are not supported, mic test falls back to simpler constraints and then `{ audio: true }`, showing friendly fallback copy instead of raw DOM errors.
- Self-monitoring has an app-only "Громкость прослушивания" GainNode control with 80% default; it does not change system volume and does not affect voice-message recording.

2026-05-10 staged attachments follow-up:

- The chat composer/send pipeline is split between `artifacts/kub/src/components/chat/MessageInput.tsx`, `artifacts/kub/src/components/chat/ChatWindow.tsx` and `artifacts/kub/src/hooks/useMessages.ts`.
- Existing media messages use the single-row `messages.media_url` model, so staged multi-file sends are sent sequentially as separate `image` / `video` / `audio` / `file` messages. No multi-attachment schema migration was added.
- File picker, drag-and-drop and clipboard files now create local staged attachments first. Upload to the existing `media` storage bucket starts only after Send; successful attachments are removed from the tray only after `sendMediaMessage` returns the DB-acknowledged row through the existing `client_message_id` path.

2026-05-10 staged voice follow-up:

- Voice recording now uses the staged attachment model: stopping the recorder creates a local `voice` preview item with an object URL, duration and stable `clientMessageId`; upload and message insert still happen only after Send.
- Recorded voice is sent as the existing `audio` message type through the same media bucket and `sendMediaMessage` DB-ack path. Typed text with a staged voice is sent as a separate text message first, so the voice bubble keeps the existing voice/audio rendering.
- The recorder and mic self-monitoring remain separate. Voice recording does not enable live monitoring, and deleting/sending a staged voice revokes the local preview URL.

2026-05-10 locations / task routing foundation:

- Read-only Supabase MCP confirmed that `locations`, `location_members` and the routing columns on `tasks` are not yet present in the live schema.
- New SQL was not applied automatically. Manual proposal: `.migration-backup/supabase/migrations/20260513_locations_task_routing.sql`.
- Frontend fallback expectation: `/admin/locations` must show “Локации требуют обновления базы данных.” until the migration is applied, while existing task create/update flows continue to work through the current task RPC.
- After applying the migration manually, QA should cover location creation, location member assignment, primary admin routing, owner-to-admin tasks, staff-only visibility, location filters and task notifications.
- Live QA should use the Codex/QA browser session or QA credentials from secure environment; do not rely on user mouse/manual browser.

2026-05-10 dynamic roles / permissions foundation:

- User manually applied `.migration-backup/supabase/migrations/20260513_locations_task_routing.sql`; read-only Supabase MCP confirmed the locations/task routing schema and RPC are present.
- Dynamic roles schema is not applied yet: `roles`, `permissions`, `role_permissions`, `user_global_roles` and `location_members.role_id` are absent.
- New SQL was not applied automatically. Manual proposal: `.migration-backup/supabase/migrations/20260514_dynamic_roles_permissions.sql`.
- Frontend fallback expectation: `/admin/roles` must show “Роли и права требуют обновления базы данных.” until the migration is applied. Existing profiles, locations and tasks must keep working through legacy `profiles.role` / `location_members.role`.
- After applying the migration manually, QA should cover custom role create/edit, permission assignment, global role assignment/removal, location dynamic role assignment, profile/mini-profile role display, last owner/tech_admin protection, admin-only task visibility and group invite permissions.
- Authenticated local Playwright QA covered `/admin/roles` fallback at desktop and mobile widths, `/admin/locations` after the applied routing migration, admin user profile role summary, private chat profile role summary, and the main chat shell. With the dynamic roles probe disabled while migration is absent, normal fallback pages produced no console errors.

2026-05-10 roles / permissions activation follow-up:

- Read-only Supabase MCP against the live app project ref `nhogbeojfnbjcfipitrh` did not find `public.roles`, `public.permissions`, `public.role_permissions`, `public.user_global_roles`, `location_members.role_id` or the role-management RPCs yet, so the applied dynamic roles migration is not confirmed on the live project.
- Frontend schema detection no longer stays disabled just because an older browser session cached the pre-migration fallback. Dynamic roles probing is enabled by default, records an explicit local `0` only after a missing-schema response, and `/admin/roles` auto-probes once on open.
- Fallback states now separate missing schema from permission denial: missing migration shows the database-update message, while protected/denied access shows a friendly insufficient-permissions state.

2026-05-10 dynamic roles / permissions polish:

- User confirmed `.migration-backup/supabase/migrations/20260514_dynamic_roles_permissions.sql` was applied. Read-only Supabase MCP confirmed dynamic role tables, `location_members.role_id`, seeded roles/permissions, helper functions and role-management RPC on project ref `nhogbeojfnbjcfipitrh`.
- `/admin/roles` was polished for non-technical admins: role-vs-permission helper copy, scope explanations, system-role warnings, friendly permission categories, readable permission labels/descriptions and technical keys moved to secondary text.
- Dynamic global roles are now considered by admin/manager role hooks, and the admin users list shows dynamic global role labels before legacy `profiles.role` fallback labels.
- Security review found RLS policies protecting role tables and authenticated-only role-management RPC grants. A grants-hardening proposal was added, not applied automatically: `.migration-backup/supabase/migrations/20260515_dynamic_roles_grants_hardening.sql`.
- Remaining schema integration risk: `group_invite_create` currently does not enforce seeded dynamic invite permissions such as `chats.invite_any`; invite flow still uses the existing chat admin/member policy.
- Polish QA found that the current QA admin account can view roles but does not have `roles.manage`; `/admin/roles` now presents a clear read-only state and disables create/edit/permission changes instead of letting a 403 surface after click.
- Security review also found that `user_assign_global_role` should additionally protect owner/tech_admin assignment and self-escalation for callers that only have `users.assign_roles`. The same proposal file now includes this RPC hardening; SQL was not applied automatically.

2026-05-10 admin users bulk roles/location QoL:

- Admin users panel now has mobile-safe scrolling through the admin layout content scroller (`min-h-0`, `overflow-y-auto`, extra bottom padding) and a UsersTab bottom padding so bulk controls do not cover the last rows on mobile.
- UsersTab adds visible-row selection, per-user checkboxes, a sticky bulk toolbar, global role assignment/removal, location assignment, location role assignment and primary-admin assignment. Bulk actions use the existing per-user RPCs and report partial success with friendly errors; no service role or direct table writes are used.
- Users can be filtered by search, global role, location, location role, primary admin and status. Rows now show friendly dynamic global role labels, location badges and primary-admin labels with legacy role fallback.
- Read-only Supabase MCP confirmed the live dynamic roles schema is present; `user` already has `tasks.view` and `chats.invite`, and existing legacy `profiles.role = user` profiles have dynamic global role coverage. A default-role trigger for future profiles is not present yet.
- SQL was not applied automatically. Manual proposal for future default-role/backfill safety: `.migration-backup/supabase/migrations/20260516_dynamic_roles_default_user_baseline.sql`.

2026-05-13 recurring tasks with routing:

- Read-only Supabase MCP confirmed current task infrastructure: `tasks`, `task_events`, task enums, `task_create_v2`, `task_update_v2`, `task_create_v3`, `task_update_v3`, `locations`, `location_members`, dynamic role/permission helpers and routing fields on `tasks`.
- Read-only Supabase MCP confirmed recurring-task infrastructure is not applied yet: `task_recurrences`, `task_recurrence_events` and `task_recurrence_*` RPC are absent.
- SQL was not applied automatically. Manual proposal created at `.migration-backup/supabase/migrations/20260518_recurring_tasks.sql`.
- Frontend task form now contains a “Повторение” section. With the migration missing it shows the friendly database-update state and keeps normal task create/update available.
- Recurring design copies location routing and visibility fields into generated occurrences: `location_id`, `target_role`, `route_admin_id`, `created_for_admin`, `visibility`, `assignment_scope`, `assignee_id`, `chat_id` and `priority`.
- Production still needs a scheduler/cron/Edge Function to call `task_recurrence_run_due()`. The frontend does not claim recurring tasks execute automatically while that scheduler is absent.
- Local authenticated Playwright QA ran against `http://127.0.0.1:5173` with viewports 3840x2160, 1920x1080, 1440x900, 390x844 and 412x915. Screenshots and summary are in `output/playwright/recurring-tasks/` (ignored from git). Result: fallback visible, no raw technical UI, no ErrorBoundary, no horizontal overflow, existing task create/edit smoke passed. App console errors after filtering the expected missing-schema network probe: 0; unexpected failed requests: 0.

2026-05-14 recurring permissions / roles / filters polish:

- Read-only Supabase MCP confirmed the recurring tasks schema and RPCs are now present on project ref `nhogbeojfnbjcfipitrh`.
- MCP inspection found `_task_recurrence_can_manage(public.tasks)` still allows `tasks.manage` for creator/assignee or no-location templates. A manual hardening proposal was created at `.migration-backup/supabase/migrations/20260519_recurring_permissions_and_legacy_roles.sql`; SQL was not applied automatically.
- Frontend recurring lifecycle buttons now use `has_permission` / `has_location_permission` through the shared permission hook. Visible task badges remain available to assignees, but pause/resume/stop requires explicit recurrence-management authority.
- `/tasks` now gates task visibility through dynamic task permissions (`tasks.view`, `tasks.view_admin_tasks`, `tasks.view_all_locations`, `tasks.manage*`) instead of treating legacy admin/manager as the primary model. `profiles.role` remains fallback only.
- `/admin/users` no longer exposes direct legacy role mutation actions (`profiles.role = admin/manager/user`) as primary UI. Global and location role management is through dynamic role RPCs and role IDs; legacy labels remain fallback display only.
- Bans/mutes expired filtering now loads recent sanctions once and applies the active/expired toggle on the client, with expired rows marked by the existing “истёк” badge.
- UsersTab realtime refresh was moved to background loading for profile events and avoids reloading dynamic roles/routing redundantly from the same tab subscription; this should remove visible loading flicker while preserving live updates through the dedicated hooks.
- Local authenticated Playwright QA ran against `http://127.0.0.1:5173` with viewports 3840x2160, 1920x1080, 1440x900, 390x844 and 412x915. Screenshots and JSON summary are in `output/qa-recurring-polish/` (ignored from git): `desktop-3840-users.png`, `desktop-1920-users.png`, `desktop-1440-users.png`, `desktop-1440-bans.png`, `desktop-1440-tasks.png`, `desktop-1440-roles.png`, `mobile-390-users.png`, `mobile-412-users.png`, `mobile-390-tasks.png`, `mobile-412-tasks.png`, `qa-summary.json`.
- QA result: login succeeded through UI, UsersTab stayed stable during a 60s wait with no loading flicker, recurring task badge was visible and pause/resume/stop controls were not shown for the current non-owner QA account, bans expired toggle changed the visible list, mobile users/tasks had no horizontal overflow after the task filter width fix, console errors were 0 and unexpected failed requests were 0.
- QA limitation: the available QA account is shown by the app as manager-level, so tech_admin/owner-only recurrence-management controls and role-management page access were not live-verified with that account in this pass. The visible `Maxim Kozlov` text in `/tasks` came from live chat/user data, not a source-code task-filter hardcode; source scan found no `Maxim/Kozlov` dependency outside unrelated Russian "Максимум" file-size copy.

2026-05-14 role cleanup / filters / sanctions polish:

- Created proposal-only SQL at `.migration-backup/supabase/migrations/20260520_role_cleanup_task_filters_sanctions.sql`; SQL was not applied automatically.
- Frontend task access now combines global dynamic task permissions with location-scoped permissions from the current user's memberships. Client/global user fallback no longer grants task access in the frontend helpers.
- `/tasks` filters now derive available locations and admin/staff filter availability from the current user and their dynamic/location permissions, not from a specific user name or QA fixture.
- `/admin/roles` now distinguishes custom role deletion vs archive: unused custom roles show “Удалить роль”, used/unknown roles show “Отключить роль”, and the action is protected by an app dialog instead of `window.confirm`.
- `/admin/users` reduces flicker by comparing row/state/contact signatures before replacing state during background refresh; filters and selection are preserved.
- Bans/mutes now expose a paginated sanctions history when “Показать истёкшие” is enabled. Audit rows hydrate target profiles/chats and render actor/action/target/reason/expiry without raw JSON as the primary UI.
- Validation completed: `git diff --check`, `pnpm.cmd --filter @workspace/kub run typecheck`, and `PORT=5173 BASE_PATH=/ pnpm.cmd --filter @workspace/kub run build` passed. Build emitted the existing Vite sourcemap/chunk-size warnings.
- Authenticated Playwright QA ran against local UI `http://127.0.0.1:5173` with viewports 3840x2160, 1920x1080, 1440x900, 390x844 and 412x915. Screenshots and summary are in `output/qa-role-cleanup/` (ignored from git): `users-*.png`, `tasks-*.png`, `roles-*.png`, `bans-*.png`, `qa-summary.json`.
- QA result: login through UI succeeded, `/admin/users` opened by dynamic permissions and stayed stable during the 60s 1440x900 wait with `loadingHits=0`, `/admin/roles` showed system-role/delete/archive copy, `/admin/bans` showed sanctions history after “Показать истёкшие”, `/tasks` loaded without recurrence management controls for the current account, desktop/mobile had no horizontal overflow, console errors were 0 and unexpected failed requests were 0.
- QA limitation: only the available QA account was used. Separate staff/client accounts without admin permissions were not available in this pass, so multi-account RLS visibility for “location_staff without global role” and custom-role deletion after the new SQL proposal is applied still need manual verification.

2026-05-16 location_staff task access verification:

- Read-only Supabase MCP confirmed the current live schema on project ref `nhogbeojfnbjcfipitrh`: `roles`, `permissions`, `role_permissions`, `user_global_roles`, `locations`, `location_members`, `tasks`, `task_recurrences`, `task_events`, and `tasks.deleted_at/deleted_by/delete_reason` are present with RLS enabled.
- Read-only SQL inspection confirmed `location_staff` is an active system location role with only `tasks.view`; `location_client` has no task permissions; global `user` has no task permissions; `owner` and `tech_admin` include task view/manage/delete/restore permissions.
- Read-only SQL inspection confirmed `has_location_permission(p_user_id, p_location_id, p_permission_key)` resolves `location_members.role_id` first and falls back from legacy `location_members.role` to `location_owner/location_admin/location_manager/location_staff/location_client`. `_task_visible_to_current_user_v3` allows location-scoped staff-visible tasks through `has_location_permission(..., 'tasks.view')` and blocks `created_for_admin` unless the user has admin-task visibility.
- Frontend fix: `useTaskRouting` now always merges the current user's own `location_members` rows into the routing state. This avoids hiding task access when RLS limits the all-members query but still allows the user's own membership row.
- Frontend fix: mobile `BottomNav` now shows a `Задачи` tab when `useTaskAccessGate()` allows tasks. Client/default users without global task permissions or task-capable location membership still do not get that tab.
- Authenticated API smoke with the configured QA account is saved at `output/location-staff-task-access/authenticated-api-summary.json` (ignored from git). That account currently has no location membership and no global task permissions, so it is a client-baseline negative check, not a pure `location_staff` UI account.
- Local authenticated Playwright QA ran against `http://127.0.0.1:5173` on 3840x2160, 1920x1080, 1440x900, 390x844 and 412x915 via `pnpm.cmd e2e:smoke`. Result: 5/5 passed, no ErrorBoundary, no unexpected console errors in the smoke test, `/tasks` renders a friendly no-access state for the current baseline account.
- QA limitation: no separate staff/client credentials are available in `C:\Users\maksi\.kub-messenger-qa.env`, and current live `location_members` data contains `location_owner` rows only. Full UI proof for a pure `location_staff` user without global manager/admin must be checked manually with a staff fixture/account after deployment.

2026-05-17 TaskFormModal v2 / unified bulk selection polish:

- Frontend-only polish; SQL was not changed or applied. TaskFormModal now uses a wider mobile-safe modal, keeps recurrence compact, explains scheduler requirements to admins, validates location/routing/chat/admin-only combinations before RPC, and hides admin-only task controls unless the current user has admin-task management permissions.
- Bulk selection now uses one shared visual control for tasks and admin users. Selected task cards/list rows and selected user rows get the same cyan-tinted border/background state; actions remain app-dialog/RPC based and do not use `window.confirm`.
- Validation completed: `git diff --check`, `pnpm.cmd --filter @workspace/kub run typecheck`, `PORT=5173 BASE_PATH=/ pnpm.cmd --filter @workspace/kub run build`, and `pnpm.cmd e2e:smoke` passed. Build still emits the existing Vite sourcemap/chunk-size warnings.
- Local Playwright smoke ran against `http://127.0.0.1:5173` on 3840x2160, 1920x1080, 1440x900, 390x844 and 412x915. Result: 5/5 passed, no ErrorBoundary and no console errors in the smoke test.
- Additional local Playwright UI pass opened `/tasks` and `/admin/users` on all five required viewports with the configured QA credentials. Current QA credentials are baseline/non-admin for these routes, so create-task, task bulk delete and users bulk toolbar controls were correctly not visible; no horizontal overflow or ErrorBoundary appeared. Because this account cannot access the owner/admin-only UI, TaskFormModal create flow and users bulk role/location actions still need manual verification with an owner/tech_admin/admin fixture after deploy.

2026-05-17 production UI polish pass:

- Frontend-only polish; SQL was not changed or applied. Source UI copy was cleaned for role/location labels, role-management critical-role copy, user search placeholder text, audit UUID display and bans/mutes missing-profile fallbacks.
- Mini-profile/profile polish: compact role summary now shows friendly dynamic/global role badges, first location role, `+N` club count with Russian pluralization, expandable club list and primary admin label for staff memberships. Private chat profile preview gained a copy-username action.
- Audio settings polish: device selection, voice-processing mode, browser processing toggles, mic test/self-monitoring and gain controls are grouped into clearer production copy. Functionality remains local to audio settings and does not change staged voice recording.
- Production-like Playwright screenshot QA ran against local `http://127.0.0.1:5173` with tech-admin and client QA sessions. Browser contexts were created by Playwright and closed by the scripts; user mouse/main browser were not used.
- Screenshot artifacts are ignored from git and stored in `output/qa-production-ui-polish/`. Key paths: `tech-desktop-3840-chat-main-loaded.png`, `tech-desktop-1440-mini-profile-context.png`, `tech-desktop-1440-audio-settings.png`, `tech-mobile-390-audio-settings-sound-section.png`, `tech-mobile-390-admin-users.png`, `client-mobile-390-mini-profile.png`, `client-desktop-1440-tasks-page.png`, `qa-summary.json`.
- Screenshot QA result: 48 screenshots recorded, console errors 0, unexpected request failures 0. Existing QA database content still contains test chat names/messages; those are live data, not source-code labels.
- Validation completed: `git diff --check`, `pnpm.cmd --filter @workspace/kub run typecheck`, `PORT=5173 BASE_PATH=/ pnpm.cmd --filter @workspace/kub run build`, and `pnpm.cmd e2e:smoke` passed. Build still emits the existing Vite sourcemap/chunk-size warnings.

2026-05-17 long-session realtime/background sync hardening:

- Frontend-only hardening; SQL was not changed or applied. Added `tests/e2e/long-session.spec.ts` and `pnpm.cmd e2e:long-session` for a dedicated long-session browser proof outside the default smoke suite.
- Realtime/focus map reviewed:
  - `useChats`: `chats:user:{userId}`, `chat-members:receipts:{userId}`, `chat-members:user:{userId}`, `visibilitychange`, app refresh event, now also `online` reconnect refetch.
  - `useMessages`: `messages:chat:{chatId}:typing`, `messages:chat:{chatId}`, `reactions:chat:{chatId}`, `profiles:chat:{chatId}`, `visibilitychange`, now also `online` background message refetch.
  - `useUser`: ref-counted `profile-self:{userId}` channel and Supabase auth listener; same-user `SIGNED_IN` / token refresh stays silent.
  - `useNotifications`, `useTasks`, `useTask`, `useRecurringTasks`, `useFolders`, `useTopics`, bans/mutes/admin panels: channel cleanup exists on unmount/change; refetches are debounced.
  - `useDynamicRoles` and `useTaskRouting`: random per-hook channel names remain stable for each mount and cleanup on unmount; realtime refresh now runs as background refresh and state arrays are replaced only when signatures change.
- Dev-only instrumentation now exposes `window.__kubDevInstrumentation` with metadata-only counters: cumulative fetches, active realtime channels, duplicate channel counts, active mounts and heartbeat counters. No tokens, payloads, messages, profile data or secrets are captured.
- Background refresh state preservation:
  - Dynamic roles and task routing no longer set full `loading=true` during realtime refresh, and background errors keep the current data instead of clearing UI.
  - Chats refetch on tab return/online with `preserveActiveChat: true`.
  - Active message history refetches on reconnect in background so composer draft/staged state is not touched.
  - Reaction fallback refetch is now background-only, avoiding visible loading flicker.
- Network hardening: unread counters in `useChats` no longer use Supabase `head: true` requests. They keep exact counts with a tiny `GET ... limit(1)` query, which removed Chromium/Playwright `net::ERR_ABORTED` artifacts during background transitions.
- Local Playwright QA ran against `http://127.0.0.1:5173`. Dev server was started from the local workspace with public Supabase config extracted from the live bundle without printing values; QA credentials stayed in the local env file.
- `pnpm.cmd e2e:long-session` result: 1/1 passed on 1440x900. The test kept the app open for about 2.4 minutes, typed a draft marker, set a window reload marker, switched to a second Playwright page and back, simulated offline/online, and verified: draft marker preserved, window marker preserved, no main-frame reload, no password/login screen, no ErrorBoundary, duplicate realtime channels `{}`, request count below threshold, failed requests 0, console/page errors 0.
- `pnpm.cmd e2e:smoke` result: 5/5 passed on 1440x900, 1920x1080, 3840x2160, 390x844 and 412x915. Smoke opened the shell, notifications and tasks route without console errors.
- Guard scans completed: no credentials matches, no `service_role` frontend matches, no `window.confirm/alert/prompt`, no forbidden pnpm PowerShell wrapper references. Reload scan still finds only existing explicit/manual paths: ErrorBoundary refresh button, app-update button, iframe open-current-page action and safe link formatting.

2026-05-17 recurring scheduler setup:
- Production scheduler strategy is now documented as Supabase Edge Function + Supabase Cron. Function source: `supabase/functions/recurring-tasks-run-due/index.ts`.
- Manual scheduler SQL proposal created at `.migration-backup/supabase/migrations/20260524_recurring_scheduler_edge_function.sql`. SQL was not applied automatically and the function was not deployed automatically.
- The Edge Function requires a scheduler token and backend-only Supabase secret key in Supabase Edge runtime. No secret values were committed.
- `rls:smoke` now probes `task_recurrence_run_due`: owner/tech_admin execution is skipped by default unless `KUB_QA_ALLOW_MUTATIONS=1`; `location_admin`, `location_staff`, and `client` are expected to be denied.
- Multi-account applied-flow QA remains non-mutating by default. Routing-field copy and notification delivery for generated occurrences still require fixture-backed mutation QA after the scheduler is deployed.
- Validation completed: `git diff --check`, `node --check scripts/rls-smoke.mjs`, `pnpm.cmd exec biome check scripts/rls-smoke.mjs supabase/functions/recurring-tasks-run-due/index.ts`, `pnpm.cmd --filter @workspace/kub run typecheck`, `PORT=5173 BASE_PATH=/ pnpm.cmd --filter @workspace/kub run build`, `pnpm.cmd e2e:smoke`, `pnpm.cmd exec playwright test tests/e2e/roles-visibility.spec.ts`, and `pnpm.cmd rls:smoke` passed. Build still emits the existing Vite sourcemap/chunk-size warnings.

2026-05-17 deployed recurring scheduler read-only verification:
- Supabase MCP read-only SQL confirmed `cron.job` has active job `kub-recurring-tasks-run-due` with schedule `*/5 * * * *`.
- Supabase Edge Function list confirmed `recurring-tasks-run-due` is `ACTIVE`.
- Latest `net._http_response` rows showed HTTP `200` at `2026-05-17 18:25`, `18:30` and `18:35` UTC. Earlier `401` rows were from before the scheduler token was fixed.
- `public.task_recurrences` due count was `0`, so there was no due recurrence available for creation during the read-only check.
- Local `KUB_QA_ALLOW_MUTATIONS` was not enabled and no local scheduler token was present, so no QA tasks were created, no occurrences were generated, duplicate prevention was not exercised and cleanup was not needed.
- Applied-flow instructions were added to `docs/RECURRING_SCHEDULER.md` for the next pass with `KUB_QA_ALLOW_MUTATIONS=1`.
- Validation completed: `git diff --check`, credential/service-role/forbidden-wrapper guard scans, `pnpm.cmd rls:smoke` with deployed public Supabase config, `pnpm.cmd --filter @workspace/kub run typecheck`, `PORT=5173 BASE_PATH=/ pnpm.cmd --filter @workspace/kub run build`, `KUB_BASE_URL=https://kub.apollot.ru pnpm.cmd e2e:smoke`, and `KUB_BASE_URL=https://kub.apollot.ru pnpm.cmd exec playwright test tests/e2e/roles-visibility.spec.ts` passed. Build still emits the existing Vite sourcemap/chunk-size warnings.

2026-05-17 deployed recurring scheduler applied-flow verification:
- Local mutation guard was enabled with `KUB_QA_ALLOW_MUTATIONS=1`; passwords/tokens were read only from the local QA env and were not printed.
- Created two temporary authenticated owner QA fixtures in `TestLocationCodex`: one staff-visible staff-pool recurrence and one admin-only recurrence routed to the location-admin QA account.
- Waited for deployed cron/Edge scheduler rather than calling the scheduler token locally. Cron created both due occurrences during the `2026-05-17 19:15:00` UTC run; `net._http_response` latest rows remained HTTP `200`.
- Generated occurrences copied all checked routing/security fields from their templates: `location_id`, `target_role`, `route_admin_id`, `created_for_admin`, `visibility`, `assignment_scope`, `assignee_id`, `chat_id` and `priority`.
- Duplicate prevention was verified by forcing the staff recurrence back to the same `recurrence_scheduled_for` and calling authenticated `task_recurrence_run_due`: return value was `0`, and occurrence count stayed `1 -> 1`.
- Role visibility was verified through authenticated role sessions: location staff saw the staff-visible occurrence, client did not; staff did not see the admin-only occurrence, while location-admin and owner did.
- Notification delivery was verified for the safe QA fixtures: staff-visible occurrence notification was visible to the location-staff QA account and admin-only occurrence notification was visible to the location-admin QA account.
- Cleanup completed through authenticated RPCs: two QA recurrences were stopped and four QA task rows were soft-deleted. Read-only post-check confirmed `open_codex_qa_tasks=0` and `open_codex_qa_recurrences=0`.
- Validation completed: `git diff --check`, credential/service-role/forbidden-wrapper guard scans, deployed `pnpm.cmd rls:smoke` with `KUB_QA_ALLOW_MUTATIONS=1` in process env, `pnpm.cmd --filter @workspace/kub run typecheck`, `PORT=5173 BASE_PATH=/ pnpm.cmd --filter @workspace/kub run build`, `KUB_BASE_URL=https://kub.apollot.ru pnpm.cmd e2e:smoke`, and `KUB_BASE_URL=https://kub.apollot.ru pnpm.cmd exec playwright test tests/e2e/roles-visibility.spec.ts` passed. Build still emits the existing Vite sourcemap/chunk-size warnings.

2026-05-17 global search and command palette:

- Frontend added a global search palette opened by Ctrl+K/Cmd+K and by the mobile search tab. Existing sidebar chat-list search remains local and unchanged.
- Profile search uses the existing `profiles.full_name` and `profiles.username` fields; no separate `nickname` column exists in the current generated/manual types.
- Created proposal-only SQL at `.migration-backup/supabase/migrations/20260522_global_search.sql`; SQL was not applied automatically. The proposal adds `global_search(p_query, p_limit, p_types)` plus trigram indexes for profiles/chats/messages/tasks/locations.
- While the migration is missing, the UI falls back to RLS-visible frontend search: visible chats, loaded messages, profiles by full name/username, visible tasks and locations. The palette shows a friendly note instead of raw PGRST/RPC text.
- Result actions verified locally: user result opens a mini-profile preview, chat result uses `safeOpenChat`, message result opens the chat and requests a message jump/highlight, task result navigates to `/tasks?task=...`, location result opens admin locations only for staff/admin access.
- Added `tests/e2e/global-search.spec.ts`; it verifies Ctrl+K opens the palette, username-style input is accepted, Escape closes the palette and no ErrorBoundary appears. `tests/e2e/helpers/auth.ts` now waits briefly for the login form before deciding the user is already authenticated.
- Local Playwright QA ran against `http://127.0.0.1:5173` with viewports 3840x2160, 1920x1080, 1440x900, 390x844 and 412x915. Screenshots and summary are in `output/qa-global-search/` (ignored from git): `*-palette-open.png`, `*-username-query.png`, `*-mini-profile.png`, `*-chat-list-search.png`, `*-chat-result-opened.png`, `qa-summary.json`.
- QA result: Ctrl+K opened the palette on desktop, the mobile search tab opened the sheet on 390/412 widths, `@te` username query rendered, `Maxim` returned a user result and mini-profile, `TestGroup` returned a chat result and opened via `safeOpenChat`, local chat-list search still accepted `QA`, and all five viewport overflow checks were false.
- Because the SQL proposal is not applied, each fresh browser context can produce one expected missing-RPC `404` probe before fallback is cached in that page. There were no repeated probes/request storm, no unexpected failed requests after filtering that expected probe, and no raw technical error in visible UI.

2026-05-17 sidebar-integrated global search:

- Sidebar search is now the primary desktop global-search entry. Empty query keeps the regular folder tabs and chat list; non-empty query replaces the list area with grouped global results while local chat matches remain immediate and deduped against RPC/fallback chat results.
- Ctrl+K/Cmd+K focuses the existing sidebar search input on desktop when the sidebar is visible. Mobile search still opens the same global-search sheet, now backed by the same shared result renderer and result actions.
- Shared search UI/action layer added for sidebar and palette: result sections/items, empty state, mini-profile preview, command results and navigation actions.
- Existing in-chat search remains separate in `ChatWindow`/`ChatSearchBar`.
- `20260522_global_search.sql` was rechecked after the previous syntax fix; SQL was not applied automatically.
- Playwright QA ran on 3840x2160, 1920x1080, 1440x900, 390x844 and 412x915. Evidence is in ignored `output/qa-sidebar-global-search/`: desktop `*-sidebar-username.png`, `*-sidebar-chat.png`, `*-chat-opened.png`; mobile `*-mobile-sheet-username.png`; `qa-summary.json`.
- QA summary: Ctrl+K focused sidebar search on desktop, sidebar `@te` and `TestGroup` searches rendered without overflow, chat result opened through the normal chat path, mobile search tab opened the global search sheet, console errors 0, unexpected failed requests 0.
## 2026-05-17 — Multi-account QA fixtures foundation

- Added local-only multi-account QA format for owner, tech admin, location admin, location staff, and client in `docs/QA_ACCOUNTS.md`.
- Added ignored Playwright auth-state generation under `output/playwright-auth/` via `pnpm.cmd e2e:auth-states`.
- Added `tests/e2e/roles-visibility.spec.ts` for role-specific UI visibility checks. Role tests skip per role when neither credentials nor storage state are available.
- Extended `pnpm.cmd rls:smoke` to run role-aware authenticated RPC/RLS probes with fake UUIDs by default. Real fixture mutations remain gated for future work by `KUB_QA_ALLOW_MUTATIONS=1`.
- No real credentials are documented here; only local env variable names are listed in workflow docs.

## 2026-05-17 — location_staff staff_pool task claim investigation

- Reproduced with local-only multi-account QA credentials and `KUB_QA_ALLOW_MUTATIONS=1`: owner created a temporary `staff_pool` task in `TestLocationCodex`; `location_staff` could read the task but `task_claim` returned HTTP 403 with `only_staff_can_claim_pool_tasks`.
- Confirmed task fields during reproduction: `status=new`, `assignment_scope=staff_pool`, `assignee_id=null`, `created_for_admin=false`, `target_role=staff`, `location_id=TestLocationCodex`, `deleted_at=null`, `recurrence_id=null`.
- Read-only schema/function inspection found the root cause in backend RPC: live `public.task_claim` still checks legacy `public.is_manager_or_admin(v_caller)` before looking at task location membership. That blocks pure `location_staff` even though task visibility now correctly uses location-scoped permissions.
- Frontend also had a legacy gate: `TaskDetailModal` showed the claim action only through global `useIsManagerOrAdmin()`. It now uses a separate claim permission gate (`tasks.claim`/task-management permissions) with location-scoped checks.
- Created proposal-only migration `.migration-backup/supabase/migrations/20260525_task_claim_location_staff.sql`. SQL was not applied automatically. The proposal adds `tasks.claim`, grants it to owner/tech/admin/manager plus location owner/admin/manager/staff, and replaces `task_claim` so staff can claim only visible, undeleted, unassigned, non-admin `staff_pool` tasks in their own location.
- Updated `scripts/rls-smoke.mjs` with adaptive `tasks.claim` checks. Until the migration is applied, the smoke prints an advisory skip for missing `tasks.claim`; after applying it, `location_staff` must have location `tasks.claim` and `client` must not have global claim permission.
- Temporary QA task from reproduction was soft-deleted through authenticated RPC; no direct DB hacks or service-role access were used.
- Local Playwright QA ran against `http://127.0.0.1:5173` with the required 3840x2160, 1920x1080, 1440x900, 390x844 and 412x915 projects: `pnpm.cmd e2e:smoke` passed 5/5 and `pnpm.cmd exec playwright test tests/e2e/roles-visibility.spec.ts` passed 20/20.
- Validation completed: `git diff --check`, `node --check scripts/rls-smoke.mjs`, `pnpm.cmd exec biome check scripts/rls-smoke.mjs`, `pnpm.cmd --filter @workspace/kub run typecheck`, `cmd /c "set PORT=5173&& set BASE_PATH=/&& pnpm.cmd --filter @workspace/kub run build"`, local Playwright smoke/roles visibility, and `pnpm.cmd rls:smoke` with public Supabase config passed. Build still emits the existing Vite sourcemap/chunk-size warnings.

## 2026-05-18 — Search v2 filters and in-chat full-history search

- Added frontend parser and removable chips for `type:`, `from:`, `in:`, `has:`, `before:` and `after:` filters. Simple text search remains unchanged; `@username` still works as a normal username-prioritized query.
- Sidebar search and Ctrl+K/mobile global search now pass parsed filters into `useGlobalSearch`. Missing `global_search_v2` is treated as an expected fallback path and shows friendly limited-search copy instead of raw RPC/PGRST text.
- In-chat search now calls `search_chat_messages` when available, keeps loaded-message fallback, supports `has:`/date/from filters, current-topic vs all-topic mode, a compact result list, next/prev, and async jump/highlight through `ensureMessageLoaded`.
- Proposal-only SQL created at `.migration-backup/supabase/migrations/20260526_global_search_filters.sql`. SQL was not applied automatically. The proposal adds `global_search_v2(p_query, p_filters, p_limit)` and `search_chat_messages(...)` with authenticated RLS-safe table access.
- Manual Playwright QA used local dev server `http://127.0.0.1:5173` with refreshed multi-account auth states. Checked global/sidebar/mobile search and in-chat search on 3840x2160, 1920x1080, 1440x900, 390x844 and 412x915. In-chat QA opened Saved Messages, opened search inside chat, verified `has:link` and `after:2026-05-01` chips, no horizontal overflow and no unexpected console errors.
- Validation completed: `git diff --check`, `pnpm.cmd --filter @workspace/kub run typecheck`, `cmd /c "set PORT=5173&& set BASE_PATH=/&& pnpm.cmd --filter @workspace/kub run build"`, `pnpm.cmd e2e:smoke`, and `pnpm.cmd exec playwright test tests/e2e/global-search.spec.ts` passed. Build still emits existing sourcemap/chunk-size warnings.

## 2026-05-18 - Search v2 applied migration verification

- After the required search migrations were applied in Supabase, local Playwright QA confirmed the new RPC path is active rather than the fallback path.
- Refreshed multi-account auth states with `pnpm.cmd e2e:auth-states`; owner, tech admin, location admin, location staff and client states were saved under ignored `output/playwright-auth/`.
- Applied-flow browser check ran against `http://127.0.0.1:5173` on 3840x2160, 1920x1080, 1440x900, 390x844 and 412x915. One browser was used sequentially with closed contexts.
- `global_search_v2` returned HTTP 200 on all five viewports for `type:message has:link after:2026-05-01`; the "database update required" fallback copy was absent.
- `search_chat_messages` returned HTTP 200 on desktop 3840x2160, 1920x1080 and 1440x900 from the real in-chat search UI; the loaded-messages fallback copy was absent.
- Validation completed after the applied-flow check: `pnpm.cmd e2e:smoke`, `pnpm.cmd exec playwright test tests/e2e/global-search.spec.ts`, `pnpm.cmd --filter @workspace/kub run typecheck`, and `cmd /c "set PORT=5173&& set BASE_PATH=/&& pnpm.cmd --filter @workspace/kub run build"` passed. Build still emits existing Vite sourcemap/chunk-size warnings.

## 2026-05-18 - Generated database types bridge and drift check

- Fresh typegen ran with `SUPABASE_PROJECT_REF=nhogbeojfnbjcfipitrh`; `artifacts/kub/src/types/database.generated.ts` was updated from the live public schema.
- Secret scan on `database.generated.ts` found no `service_role`, Supabase access token, QA password, or real QA email.
- Added `artifacts/kub/src/types/database.app.ts` as the app-facing bridge between manual `database.ts` and generated `database.generated.ts`; existing imports remain unchanged.
- Added advisory `pnpm.cmd db:types:check`. Current drift: generated-only `messages.media_bucket/media_path`, generated-only app RPC types `global_search_v2` and `search_chat_messages`, and server-side-only `notifications_push_outbox`.
- No UI code was changed. Deployed Playwright smoke ran on the standard five viewports and passed 5/5.
- Validation completed: `git diff --check`, `node --check scripts/check-database-type-drift.mjs`, `pnpm.cmd db:types:check`, `pnpm.cmd --filter @workspace/kub run typecheck`, `cmd /c "set PORT=5173&& set BASE_PATH=/&& pnpm.cmd --filter @workspace/kub run build"`, deployed `KUB_BASE_URL=https://kub.apollot.ru pnpm.cmd e2e:smoke`, and `pnpm.cmd rls:smoke` with public deployed Supabase config passed. Build still emits existing Vite sourcemap/chunk-size warnings.

## 2026-05-18 - PWA baseline and offline shell

- Existing manifest/service worker were hardened for installability and authenticated-app safety. Manifest now uses `KUB Messenger`, `display: standalone`, `orientation: any`, `scope: /`, and 192/512/maskable icon entries.
- Service worker now caches only the app shell, icons, manifest, offline shell and same-origin static assets. Supabase Auth/REST/Realtime/Storage requests, non-GET requests, cross-origin requests and authenticated API responses are not cached.
- Service worker updates are surfaced through the existing app update banner. `skipWaiting` is sent only after explicit user click; `clients.claim()` is not used and focus/visibility does not force reload.
- Added runtime offline/reconnect banner: offline shows `Нет подключения`, online recovery shows `Подключение восстановлено` and hides automatically.
- Settings now expose a browser install action when `beforeinstallprompt` is available, with browser-menu fallback copy when the browser does not emit the prompt.
- Added `docs/PWA_NATIVE_READINESS.md` with installability, caching, update, offline, native packaging and permission/deep-link notes.
- Playwright PWA QA ran locally on 3840x2160, 1920x1080, 1440x900, 390x844 and 412x915. It verified manifest fetch, icon fetches, service worker registration, no auto `skipWaiting`, no `clients.claim`, offline/reconnect banner state, and direct `/tasks`/`/admin` app-shell routes.
- Validation completed: `git diff --check`, `pnpm.cmd --filter @workspace/kub run typecheck`, `cmd /c "set PORT=5173&& set BASE_PATH=/&& pnpm.cmd --filter @workspace/kub run build"`, `pnpm.cmd e2e:smoke`, `pnpm.cmd rls:smoke` with public Supabase config, `pnpm.cmd db:types:check`, and `pnpm.cmd exec playwright test tests/e2e/pwa.spec.ts` passed. Build still emits existing Vite sourcemap/chunk-size warnings.

## 2026-05-18 - Production frontend monitoring foundation

- Added optional Sentry browser monitoring through `@sentry/react`. The SDK initializes only when `VITE_SENTRY_DSN` exists; without it, reporting functions are no-op and the app sends no monitoring network requests.
- Added `artifacts/kub/src/lib/monitoring.ts` with `initMonitoring`, `reportError`, `reportMessage`, user id scoping, breadcrumbs, build metadata, and shared redaction.
- Redaction removes passwords, access/refresh/id tokens, authorization headers, Supabase key shaped values, service-role shaped keys, email addresses, raw message/content/body/text fields, media/signed/public URLs and URL query secrets.
- `AppErrorBoundary` now reports sanitized errors while keeping friendly UI and explicit user actions: `Попробовать снова` and `Обновить страницу`.
- Global `window.error` and `unhandledrejection` reporting is installed at app boot. App-level categories were added for auth callback/password recovery failures, message send failures/timeouts, staged attachment upload/send failures, media playback failures, and PWA registration/update-check failures.
- Settings now show safe build metadata: app version and optional commit short SHA.
- Added `tests/e2e/monitoring.spec.ts`; Playwright QA ran locally on 3840x2160, 1920x1080, 1440x900, 390x844 and 412x915 and verified disabled-by-default behavior plus redaction.
- Validation completed: `git diff --check`, `pnpm.cmd --filter @workspace/kub run typecheck`, `cmd /c "set PORT=5173&& set BASE_PATH=/&& pnpm.cmd --filter @workspace/kub run build"`, `pnpm.cmd e2e:smoke`, `pnpm.cmd exec playwright test tests/e2e/pwa.spec.ts`, `pnpm.cmd exec playwright test tests/e2e/monitoring.spec.ts`, `pnpm.cmd rls:smoke` with public Supabase config, and `pnpm.cmd db:types:check` passed. Build still emits existing Vite sourcemap/chunk-size warnings.

## 2026-05-19 - Push notifications and phone verification foundation

- Added proposal-only push migration `.migration-backup/supabase/migrations/20260527_push_notifications_foundation.sql` for `push_subscriptions`, `notification_preferences`, `chat_notification_preferences`, outbox enqueue hardening, and preference-aware delivery.
- Added proposal-only phone migration `.migration-backup/supabase/migrations/20260528_phone_verification.sql` to add `phone_verified_at` and keep verified state mirrored only after Supabase Auth OTP success.
- Settings now expose push type toggles for messages, tasks and invites, with friendly states for unsupported browsers, blocked permission, missing VAPID public key and missing DB migration.
- Phone settings no longer offer “save without verification”; a changed phone can be persisted only after the OTP verify path succeeds.
- Service worker push handling now sanitizes payloads, uses `Новое уведомление` fallback copy, rejects unsafe notification click URLs, and keeps the existing PWA update/offline behavior.
- Added Edge Function source `supabase/functions/send-push-notifications/index.ts` for outbox delivery; deployment and secrets are manual.
- Added docs `docs/PUSH_NOTIFICATIONS.md` and `docs/PHONE_VERIFICATION.md`.
- Playwright QA ran locally on 3840x2160, 1920x1080, 1440x900, 390x844 and 412x915: `tests/e2e/push-phone-foundation.spec.ts` passed 10/10, `tests/e2e/pwa.spec.ts` passed 5/5, smoke passed 5/5, and roles visibility passed 20/20.
- Validation completed: `git diff --check`, `pnpm.cmd --filter @workspace/kub run typecheck`, `cmd /c "set PORT=5173&& set BASE_PATH=/&& pnpm.cmd --filter @workspace/kub run build"`, `pnpm.cmd e2e:smoke`, `pnpm.cmd rls:smoke` with public Supabase config and mutation probes disabled, `pnpm.cmd db:types:check`, `pnpm.cmd exec playwright test tests/e2e/pwa.spec.ts`, and `pnpm.cmd exec playwright test tests/e2e/push-phone-foundation.spec.ts` passed. Build still emits existing Vite sourcemap/chunk-size warnings.

## 2026-05-19 - Message push notifications and realtime sync hardening

- Read-only Supabase check confirmed `notifications -> notifications_push_outbox` trigger exists, `messages -> notifications` trigger was missing, and existing message notification rows were absent.
- Added proposal-only migration `.migration-backup/supabase/migrations/20260529_message_notifications_for_push.sql` to create `message` notifications from `messages` inserts, skip sender/system rows, use safe media labels, and include `chat_id/message_id/sender_id` payload for preference-aware push delivery.
- Notification bell and service worker now handle message payloads with `message_id`: clicking opens the chat and requests message jump/highlight. Edge Function safe payload now forwards `messageId`.
- Active chat realtime now keeps direct INSERT merge, plus debounced background reconciliation on sidebar realtime signals without a message id, websocket subscribe/error recovery, browser online, and visibility return. Merges still dedupe by `id`/`client_message_id` and sort by server `created_at`.
- Push settings switches were constrained with grid/min-width/shrink rules so toggles stay inside the settings card on mobile.
- Added `tests/e2e/realtime-messages.spec.ts`; it uses owner/client QA auth, gates DB mutations behind `KUB_QA_ALLOW_MUTATIONS=1`, inserts a safe QA private-chat message, verifies reconnect reconciliation without page refresh, dedupe, and server-created ordering.
- Validation completed: `git diff --check`, `pnpm.cmd --filter @workspace/kub run typecheck`, `cmd /c "set PORT=5173&& set BASE_PATH=/&& pnpm.cmd --filter @workspace/kub run build"`, `pnpm.cmd e2e:smoke`, `pnpm.cmd rls:smoke`, `pnpm.cmd db:types:check`, `pnpm.cmd exec playwright test tests/e2e/pwa.spec.ts`, `pnpm.cmd exec playwright test tests/e2e/push-phone-foundation.spec.ts`, and `pnpm.cmd exec playwright test tests/e2e/realtime-messages.spec.ts` passed. Build still emits existing Vite sourcemap/chunk-size warnings; `db:types:check` still reports the known advisory manual/generated drift.

## 2026-05-19 - Push message notification polish and presence consistency

- Read-only Supabase inspection confirmed the applied 20260529 state: `message` notification rows exist, `notifications -> notifications_push_outbox` exists, and `messages -> notifications` exists. Latest outbox rows still had private-message copy shaped as `sender` title plus `sender: preview` body, message tags included the individual `message_id`, and private chat membership inserts still produced `chat_added`.
- Added proposal-only migration `.migration-backup/supabase/migrations/20260530_push_message_notification_polish.sql`. SQL was not applied automatically. The proposal suppresses `chat_added` for private one-to-one chats, adds `chat_type` to message notification payloads, formats private/group message push copy differently, and uses stable `message:chat:<chat_id>` tags.
- Service worker now keeps message push click routing and uses `renotify: false` for message pushes so repeated messages in the same chat can collapse by tag where the browser/OS supports it.
- Notification bell message copy now mirrors the private/group distinction and keeps legacy fallback for existing rows where `chat_type` is absent but `chat_name` equals `sender_name`.
- Push settings rows were tightened again with contained grid rows, mobile full-width action buttons, `min-w-0`, and fixed switch shrink behavior. `tests/e2e/push-phone-foundation.spec.ts` verifies switch bounds on all five required viewports.
- Presence status now goes through shared `getUserPresenceState` / `isUserOnline` helpers and a single `90s` threshold. ChatHeader, sidebar chat rows, and the mini-profile preview use the same timestamp and local timer source.
- Playwright QA used local dev server `http://127.0.0.1:5173` and saved multi-account auth states. `push-phone-foundation.spec.ts`, `pwa.spec.ts`, `smoke.spec.ts`, and `realtime-messages.spec.ts` passed on 3840x2160, 1920x1080, 1440x900, 390x844 and 412x915.
- Realtime multi-account QA verified owner/client private-chat incoming message reconciliation without refresh, no duplicate after a second reconcile, and ordering by server `created_at`.
- Validation completed: `git diff --check`, `pnpm.cmd --filter @workspace/kub run typecheck`, `cmd /c "set PORT=5173&& set BASE_PATH=/&& pnpm.cmd --filter @workspace/kub run build"`, `pnpm.cmd e2e:smoke`, configured `pnpm.cmd rls:smoke`, `pnpm.cmd db:types:check`, `pnpm.cmd exec playwright test tests/e2e/pwa.spec.ts`, `pnpm.cmd exec playwright test tests/e2e/push-phone-foundation.spec.ts`, and `pnpm.cmd exec playwright test tests/e2e/realtime-messages.spec.ts` passed. Build still emits existing Vite sourcemap/chunk-size warnings; `db:types:check` still reports known advisory drift.
