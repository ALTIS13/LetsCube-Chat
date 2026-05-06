# QA Results

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
- Supabase Auth logs показывают ошибки `missing Twilio account SID` на `/user` при phone update. Это отдельный Supabase Auth/SMS configuration вопрос, не frontend service_role проблема.

## Applied In Production Supabase

- Task privacy/assignment уже применены: `tasks.visibility`, `tasks.assignment_scope`, `task_create_v2`, `task_update_v2`, `task_claim`, RLS `tasks select with visibility`.
- Storage `media` уже переведен на scoped policies: `media authenticated scoped read`, `insert`, `update`, `delete`.
- Folders policy cleanup уже применен: legacy `folders`/`folder_chats` `*_own` policies отсутствуют, остались scope-aware policies и restrictive banned-user guards.

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

- На текущем read-only MCP snapshot новых обязательных SQL-миграций не найдено. Следующие DB изменения нужны только после отдельного подтвержденного этапа.

## Needs UX Polish

- Chat list search сейчас ищет по названию чата и last message text, но не по всем сообщениям.
- In-chat search работает только по загруженным сообщениям текущего чата, не по всей истории.
- Нет глобальной search/command palette.
- Task filters пока не знают о pool/unassigned/visibility; SQL уже применен, следующий этап - frontend alignment на `task_create_v2`, `task_update_v2`, `task_claim`.
- Chat overview в `useChats` все еще делает per-chat last-message/unread enrichment; при росте количества чатов стоит вынести это в RLS-safe RPC/view отдельной миграцией.

## Browser QA Notes

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

Recurring tasks roadmap note:

- Future task-system phase should add recurring tasks: daily, weekly, monthly, yearly, custom interval, `next_run_at`, auto-create next occurrence, stop recurrence, reuse `visibility` / `assignment_scope`, and history of occurrences.
