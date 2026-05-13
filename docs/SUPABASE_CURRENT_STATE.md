# Текущее состояние Supabase

Синхронизировано через read-only MCP `supabase_kub_readonly` 2026-05-05.

Project ref: `nhogbeojfnbjcfipitrh`.

Этот документ - снимок фактического production-like проекта. Он не заменяет миграции. Не применять SQL через MCP; если нужен фикс БД, создать idempotent migration в `.migration-backup/supabase/migrations/` и приложить verify SQL/manual QA.

## Public Schema

В `public` найдено 17 base tables. RLS включен на всех:

- `profiles` - 4 rows, пользователи/профили, `role app_role`.
- `chats` - 12 rows, private/group/channel chats, `is_forum`.
- `chat_members` - membership/roles, `last_read_at`, per-user `hidden_at`, `cleared_at`, `pinned`, `pinned_at`, `pinned_order`.
- `messages` - 163 rows, сообщения, media/reply/forward/topic fields.
- `reactions` - 5 rows, реакции на сообщения.
- `folders` - 4 rows, personal/shared/system folders.
- `folder_chats` - 3 rows, связи папок и чатов.
- `push_subscriptions` - 0 rows, browser push subscriptions.
- `topics` - 6 rows, forum topics.
- `bans` - 0 rows, sanctions.
- `mutes` - 0 rows, chat/global mutes.
- `tasks` - 4 rows, задачи.
- `task_events` - 19 rows, immutable task history.
- `profile_contacts` - 4 rows, телефоны вне `profiles`.
- `notifications` - 18 rows, in-app notifications.
- `notifications_push_outbox` - 0 rows, server-side push queue.
- `audit_logs` - 30 rows, admin audit trail.

Public views не найдены.

## Enums

- `app_role`: `admin`, `manager`, `user`.
- `chat_member_role`: `owner`, `admin`, `member`.
- `folder_scope`: `personal`, `shared`, `system`.
- `task_priority`: `low`, `normal`, `high`, `urgent`.
- `task_status`: `new`, `assigned`, `accepted`, `in_progress`, `waiting_confirmation`, `confirmed`, `rejected`, `cancelled`.
- `task_visibility`: `staff`, `private`, `chat`.
- `task_assignment_scope`: `user`, `manager_pool`, `staff_pool`.

## RLS

RLS включен на всех user-facing таблицах. Policy counts:

- `audit_logs`: 1.
- `bans`: 4.
- `chat_members`: 8, из них 4 restrictive.
- `chats`: 8, из них 4 restrictive.
- `folder_chats`: 7, из них 4 restrictive.
- `folders`: 8, из них 4 restrictive.
- `messages`: 8, из них 5 restrictive.
- `mutes`: 4.
- `notifications`: 1.
- `profile_contacts`: 4, из них 1 restrictive.
- `profiles`: 9, из них 4 restrictive.
- `push_subscriptions`: 4, из них 3 restrictive.
- `reactions`: 7, из них 4 restrictive.
- `task_events`: 4.
- `tasks`: 4.
- `topics`: 6, из них 4 restrictive.

Особенность: `notifications_push_outbox` имеет RLS enabled, но policies отсутствуют. Это совпадает с server-side-only очередью, но Supabase Security Advisor помечает это как `INFO`.

## RPC / Functions

Основные public RPC, вызываемые frontend:

- Chat: `open_or_create_private_chat`.
- Notifications: `notifications_mark_read`, `notifications_mark_all_read`.
- Phone/contact: `profile_phone_mark_verified`.
- Tasks: `task_create`, `task_create_v2`, `task_assign`, `task_claim`, `task_accept`, `task_start`, `task_send_for_confirmation`, `task_confirm`, `task_reject`, `task_cancel`, `task_comment`, `task_return_to_work`, `task_update`, `task_update_v2`.
- Admin/support: `admin_user_emails`.

Основные helper functions:

- Roles/access: `is_admin`, `is_manager_or_admin`, `is_banned`, `is_muted`.
- Chat membership: `get_my_chat_ids`, `is_chat_member`, `is_chat_admin`, `is_chat_owner`, `chat_role_of`.
- Shared folders: `can_see_shared_folder`.
- Task internals: `_task_transition`, `_task_assert_can_assign_to`, `_task_assert_visibility_assignment`, `_task_visible_to_current_user`, `task_append_event`.
- Notifications internals: `_notify`, `_notification_push_payload`, `_enqueue_push_after_notification_insert`, `_notify_*`.
- Audit internals: `_audit`, `_audit_*`.
- Contact internals: `_normalize_phone_e164`, `_guard_profile_contacts`, `_ensure_profile_contacts`.

Большинство privileged helper/RPC functions являются `SECURITY DEFINER`. Это ожидаемо для RPC workflows, но advisors требуют отдельной проверки `EXECUTE` grants.

## Triggers

Найдены trigger groups:

- `chats`: auto-add creator as owner.
- `chat_members`: audit membership changes, enforce member update/delete, notify on insert.
- `profiles`: bootstrap first admin, prevent demoting last admin, enforce role matrix, audit role changes, ensure contact row.
- `bans` / `mutes`: enforce sanction matrix, audit insert/delete, notify on insert.
- `tasks`: notify insert/update, audit status changes.
- `messages`: audit admin delete via soft-delete update.

Applied manually on 2026-05-06:

- `20260506_chat_history_private_hide_permissions.sql`: added per-user chat hide/clear columns and RPC `clear_chat_for_me`, `hide_private_chat`, `unhide_private_chat`; tightened `messages` UPDATE banned guard to restrictive.
- `20260506_chat_pins.sql`: added per-user chat pin columns and RPC `pin_chat`, `unpin_chat`.
- `20260506_admin_avatar_management.sql`: extended `_kub_media_path_allowed` so admins can upload profile avatars under `avatars/{target_user_id}/...` for non-admin users; users remain scoped to their own avatar path.
- `folders`: audit folder delete.
- `profile_contacts`: guard insert/update.
- `notifications`: enqueue push outbox rows after notification insert.

## Realtime

`supabase_realtime` publication contains public tables:

- `bans`, `chat_members`, `chats`, `folder_chats`, `folders`, `messages`, `mutes`, `notifications`, `profiles`, `reactions`, `task_events`, `tasks`, `topics`.
- `group_invites` was added to `supabase_realtime` by the manually applied 20260509 group invites migration.

Replica identity FULL is enabled on:

- `chat_members`, `messages`, `tasks`, `task_events`.

Realtime logs за последние 24 часа показывают штатные initialization/stream replication/tenant shutdown messages без явной постоянной ошибки.

## Storage

Storage bucket:

- `media`: public bucket.

Storage policies:

- `media authenticated scoped read` on `storage.objects`.
- `media authenticated scoped insert` on `storage.objects`.
- `media authenticated scoped update` on `storage.objects`.
- `media authenticated scoped delete` on `storage.objects`.

Bucket остается public, чтобы существующие public object URLs продолжали рендериться, но authenticated list/upload/update/delete теперь ограничены helper-функцией `_kub_media_path_allowed(name)`. Broad policies `Anyone can view media` и `Authenticated users can upload media` в production Supabase отсутствуют.

## Edge Functions

Supabase Edge Functions не найдены.

## Migration Tracking

MCP `_list_migrations` вернул пустой список. Значит проект не использует Supabase-managed migration history или текущие изменения применялись вручную через SQL Editor.

Repo хранит manual/idempotent SQL в `.migration-backup/supabase/migrations/`. Этот каталог остается источником SQL-памяти проекта, но не является Supabase CLI migration ledger.

## Advisors

Security Advisor:

- `notifications_push_outbox`: RLS enabled, no policy.
- Несколько functions без fixed `search_path`, включая `prevent_demoting_last_admin`, `_notification_push_payload`, `_normalize_phone_e164`, `handle_new_user`, `get_my_chat_ids`.
- Много `SECURITY DEFINER` functions callable by `anon`/`authenticated`, включая internal trigger helpers и intended RPC.
- Public storage bucket `media` больше не имеет broad authenticated listing/upload policy; read/write policies path-scoped.
- Auth leaked password protection disabled.

Performance Advisor:

- Несколько unindexed foreign keys.
- RLS policies с `auth.uid()` / helper calls без initplan optimization.
- Multiple permissive policies на некоторых таблицах/ролях, особенно `profiles`, `bans`, `mutes`, `topics`. По `folders`/`folder_chats` read-only MCP подтвердил cleanup: legacy `*_own` policies отсутствуют.

Это кандидаты для отдельной SQL hardening/performance migration, но текущая задача SQL не меняет.

## Logs

Postgres logs за последние 24 часа в основном содержат connection/checkpoint messages. Ошибки, связанные с этим read-only audit:

- `column reference "pubname" is ambiguous` - первая диагностическая query была исправлена.
- `relation "supabase_migrations.schema_migrations" does not exist` - подтверждает отсутствие Supabase CLI migration ledger.

Auth logs показывают успешные login/token/verify events и старый `referer=tg.letscube.ru` в части событий. Это не source-code hardcode proof, но означает, что Supabase Auth URL settings/email redirects нужно держать под контролем при смене домена.

## Repo Comparison

Совпадает:

- Основные таблицы, enums, task RPC, notifications, audit, phone privacy, folders/shared folders, roles/admin, bans/mutes и topics покрыты migration backup files.
- Production Supabase уже содержит `tasks.visibility`, `tasks.assignment_scope`, `task_create_v2`, `task_update_v2`, `task_claim` и scoped storage policies.
- Frontend database types содержат все user-facing tables кроме server-only `notifications_push_outbox`; task privacy types синхронизированы с production schema.
- `SUPABASE_SERVICE_ROLE_KEY` не нужен frontend; push outbox обслуживается optional server-side worker.

Отличается / было не задокументировано:

- Supabase migration ledger пустой, хотя в repo есть manual migrations.
- `notifications_push_outbox` отсутствует в frontend `database.ts`; это приемлемо как server-side-only table, но должно быть известно агентам.
- Frontend task UI пока использует совместимые старые RPC `task_create`, `task_update`, `task_assign`; UI alignment на `task_create_v2`, `task_update_v2`, `task_claim` остается отдельным этапом.

## Нужно ли Сейчас Мигрировать

Нет для task privacy/storage hardening: production Supabase уже содержит task visibility/assignment schema и scoped storage policies. SQL через MCP не применялся.

# Stabilization SQL State

2026-05-05 read-only MCP sync подтвердил состояние migration-файлов:

- `.migration-backup/supabase/migrations/20260505_tasks_visibility_and_assignment.sql` - уже применена в production Supabase; explicit task visibility/assignment scope, RLS и новые RPC `task_create_v2`, `task_update_v2`, `task_claim`.
- `.migration-backup/supabase/migrations/20260505_media_storage_path_policies.sql` - уже применена в production Supabase; path ownership policies для bucket `media`.
- `.migration-backup/supabase/migrations/20260505_folders_policy_cleanup.sql` - уже применена в production Supabase; legacy permissive `*_own` policies для `folders`/`folder_chats` отсутствуют.

Frontend task UI можно выравнивать под новые task columns/RPC отдельным подтвержденным этапом; источник прав остается RLS/RPC.

# Locations / Task Routing Snapshot

2026-05-10 read-only Supabase MCP check for the locations/task-routing stage:

- `public.locations` отсутствует.
- `public.location_members` отсутствует.
- `public.tasks` пока содержит только текущие task-поля: `visibility` и `assignment_scope` уже есть, но `location_id`, `target_role`, `route_admin_id`, `created_for_admin` отсутствуют.
- Текущие task RPC: `task_create`, `task_create_v2`, `task_update`, `task_update_v2` и transition RPC остаются рабочими.
- Текущая task RLS использует `_task_visible_to_current_user(...)`; она ещё не учитывает локации, primary admin или admin-only задачи.
- Текущие task notification triggers уведомляют прямого `assignee_id` и status transitions; location-aware fan-out ещё требует SQL.

Новый SQL не применялся автоматически. Proposal создан в:

- `.migration-backup/supabase/migrations/20260513_locations_task_routing.sql`

Frontend должен работать без этой migration: раздел `Локации` показывает friendly disabled state, а существующее создание/обновление задач продолжает использовать старые RPC без routing-полей.

2026-05-10 follow-up:

- Пользователь вручную применил `.migration-backup/supabase/migrations/20260513_locations_task_routing.sql`.
- Read-only Supabase MCP подтвердил `public.locations`, `public.location_members`, `tasks.location_id`, `tasks.target_role`, `tasks.route_admin_id`, `tasks.created_for_admin`, `task_create_v3` и `task_update_v3`.
- Текущие роли всё ещё живут в legacy `profiles.role app_role` (`admin`, `manager`, `user`), `location_members.role text` (`owner`, `admin`, `manager`, `staff`) и `chat_members.role`.
- Dynamic roles tables пока отсутствуют: `public.roles`, `public.permissions`, `public.role_permissions`, `public.user_global_roles` не найдены; `location_members.role_id` ещё отсутствует.
- Новый SQL не применялся автоматически. Manual proposal: `.migration-backup/supabase/migrations/20260514_dynamic_roles_permissions.sql`.
- Frontend fallback expectation: `/admin/roles` показывает “Роли и права требуют обновления базы данных.” до применения migration, profile/mini-profile остаются на legacy role labels, locations/tasks продолжают работать.
- 2026-05-10 activation follow-up: read-only MCP against the live app project ref still does not expose the dynamic role tables/RPC, so the role migration is not confirmed on that project. Frontend detection now auto-probes instead of staying stuck in a cached disabled state after the migration is later applied.

## 2026-05-09 Notifications And Group Invites State

Read-only Supabase MCP sync for project `nhogbeojfnbjcfipitrh` confirmed the current production-like schema before the notifications redesign:

- `public.notifications` exists with columns `id`, `user_id`, `kind text`, `payload jsonb`, `read_at`, `created_at`; RLS is enabled and users read only own rows.
- Existing notification RPCs: `notifications_mark_read(p_id uuid)` and `notifications_mark_all_read()`.
- Existing notification kinds in frontend/server contract: `task_assigned`, `task_waiting_confirmation`, `task_confirmed`, `task_rejected`, `chat_added`, `mute_issued`, `ban_issued`.
- `public.chats` supports `private`, `group`, `channel` and `is_forum`.
- `public.chat_members` stores `owner`, `admin`, `member`, read/delivery watermarks and per-user pinned/hidden state.
- `public.group_invites` did not exist yet in this 2026-05-09 pre-application check.

No SQL was applied automatically. A manual/idempotent proposal was added:

- `.migration-backup/supabase/migrations/20260509_group_invites.sql`.

The migration adds `public.group_invites`, scoped RLS, indexes, `group_invite_create`, `group_invite_accept`, `group_invite_decline`, `group_invite_cancel`, and `group_invite` notification payload support. Frontend code keeps a graceful fallback for environments where this SQL is not applied.

2026-05-10 follow-up:

- The user manually applied `.migration-backup/supabase/migrations/20260509_group_invites.sql`.
- Read-only Supabase MCP on 2026-05-10 confirmed `public.group_invites` exists, RLS is enabled, and FKs to `chats`/`profiles` are present.
- `public.messages.type` already allows `system`, so a backend-created join notice can be stored without changing frontend message schema.
- New proposal only, not applied automatically: `.migration-backup/supabase/migrations/20260510_group_invite_join_system_messages.sql`. It replaces `group_invite_accept(p_invite_id uuid)` so accepting an invite inserts a persistent `type='system'` message after the membership row is created.
- Read-only Supabase MCP table introspection confirmed `public.group_invites` exists, RLS is enabled, and the expected columns/FKs are present (`chat_id`, `inviter_id`, `invitee_id`, `status`, `created_at`, `expires_at`, `responded_at`).
- `_list_migrations` remains empty, so the project still appears to use manual SQL history rather than Supabase CLI migration ledger.
- The available read-only MCP tools do not expose RPC/function definitions; invite RPCs should be verified through authenticated app/RPC QA. No SQL was applied by Codex.
- 2026-05-10 follow-up: read-only MCP confirmed `chat_members.joined_at`, `last_read_at`, `last_delivered_at` and nullable `messages.user_id`; `messages.type` includes `system`.
- New proposal only, not applied automatically: `.migration-backup/supabase/migrations/20260511_invite_accept_read_baseline_and_system_notice.sql`. It supersedes the previous join-message proposal, sets accepted invite members' read/delivery baseline to the accept timestamp, and inserts the join notice as `messages.type = 'system'` with `user_id = null`.
- 2026-05-10 follow-up: the user manually applied `.migration-backup/supabase/migrations/20260511_invite_accept_read_baseline_and_system_notice.sql`.
- New proposal only, not applied automatically: `.migration-backup/supabase/migrations/20260512_group_invite_reinvite_and_policy.sql`. It adds `chats.invite_policy`, keeps current `chat_members` membership as the source of truth over historical accepted invites, lets removed ex-members receive a fresh pending invite/notification, and separates `owner_admin_only` from `members_can_invite` group invite modes.
- Read-only Supabase MCP on 2026-05-10 confirmed the invite RPCs exist and `chat_members` has the accepted-invite baseline columns from the previous migration; `chats.invite_policy` is not present yet, so the 20260512 proposal still requires manual application before common-group invite mode is active.

## 2026-05-06 Media And Name State

- `.migration-backup/supabase/migrations/20260506_secure_chat_media_access.sql` was applied manually by the user.
- Read-only MCP check confirmed private bucket `chat-media`, chat-member Storage policies and `messages.media_bucket` / `messages.media_path`.
- Legacy bucket `media` remains public for avatars and old media compatibility; frontend migration to signed `chat-media` URLs remains a separate compatibility step.
- `.migration-backup/supabase/migrations/20260506_entity_name_constraints.sql` was applied manually on 2026-05-06; read-only MCP confirmed DB-level max length checks for `chats.name`, `folders.name` and `topics.name`.

## 2026-05-07 Message Hide For Me State

- `.migration-backup/supabase/migrations/20260507_message_hide_for_me.sql` was applied manually by the user.
- Read-only MCP confirmed `public.message_hidden_for_users(message_id, user_id, hidden_at)` exists and has RLS enabled.
- Policies are authenticated-only and scope `select`, `insert` and `delete` to `auth.uid()` rows; insert additionally checks that the message is visible to the current chat member.
- RPC `hide_message_for_me(p_message_id uuid)` and `unhide_message_for_me(p_message_id uuid)` exist as `SECURITY INVOKER` functions.
- Frontend alignment is enabled: local message hide can now remove a message only for the current user without deleting the global `messages` row or Storage media.
- `.migration-backup/supabase/migrations/20260507_message_hide_for_me_grants_hardening.sql` was applied manually by the user.
- Read-only MCP confirmed `anon`/`PUBLIC` table/function grants are absent for `message_hidden_for_users`, `hide_message_for_me` and `unhide_message_for_me`; `authenticated` keeps `select/insert/delete` table access and RPC `execute`.

## 2026-05-07 Message Receipt State

- Read-only MCP confirmed `messages` has no `status`, `delivered_at` or `read_at` columns.
- `.migration-backup/supabase/migrations/20260507_message_delivery_receipts.sql` was applied manually by the user.
- Read-only MCP confirmed `chat_members.last_read_at` and `chat_members.last_delivered_at` exist as nullable `timestamptz` columns.
- RPC `mark_chat_delivered(p_chat_id uuid)` and `mark_chat_read(p_chat_id uuid)` exist as `SECURITY INVOKER` functions. `authenticated` has `EXECUTE`; `anon`/`PUBLIC` grants are absent.
- `chat_members` remains in the `supabase_realtime` publication, so member receipt updates can update checkmarks without refresh.
- Frontend delivered-flow is enabled for private chats only. Group chats still do not show fake read/delivered state because there is no group read-count/all-delivered model.
- Sender-side receipt updates are consumed through one stable `chat-members:receipts:{userId}` frontend subscription to RLS-visible `chat_members` updates; no per-chat list subscriptions are required.

## 2026-05-08 Message Send Idempotency State

- `.migration-backup/supabase/migrations/20260508_messages_client_message_id.sql` was applied manually by the user.
- Read-only MCP confirmed `messages.created_at timestamptz not null default now()`.
- Read-only MCP confirmed `messages.client_message_id uuid null` and `messages.client_sent_at timestamptz null`.
- Read-only MCP confirmed partial indexes:
  - `messages_client_message_id_unique_idx` on `(chat_id, user_id, client_message_id)` where `client_message_id is not null`.
  - `messages_client_message_lookup_idx` on `(user_id, client_message_id)` where `client_message_id is not null`.
- Frontend alignment is enabled: text, location, media, voice and forwarded messages can use a client-generated idempotency key while persisted ordering remains based on server `created_at`.

## 2026-05-08 Pinned Chat Order State

- `.migration-backup/supabase/migrations/20260508_chat_pinned_order.sql` was applied manually by the user.
- Read-only MCP confirmed `chat_members.pinned_order integer null`.
- Read-only MCP confirmed `set_pinned_chat_order(p_chat_ids uuid[])`, updated `pin_chat(p_chat_id uuid)` and updated `unpin_chat(p_chat_id uuid)`.
- `authenticated` has `EXECUTE`; `anon`/`PUBLIC` execute grants are absent for pinned order RPC.
- Frontend pinned-chat reorder UI is enabled with per-user move up/down actions; saved chat remains sorted above pinned chats.

## 2026-05-10 Dynamic Roles Applied State

- The user manually applied `.migration-backup/supabase/migrations/20260514_dynamic_roles_permissions.sql`.
- Read-only Supabase MCP confirmed `public.roles`, `public.permissions`, `public.role_permissions`, `public.user_global_roles`, `location_members.role_id`, seeded system roles, seeded permissions, helper functions and role-management RPCs on project ref `nhogbeojfnbjcfipitrh`.
- `profiles.role`, `location_members.role text` and `chat_members.role` remain legacy/fallback fields. Dynamic global roles and `location_members.role_id` should be preferred in UI when available, without duplicating legacy labels.
- RLS policies protect role/permission data and dangerous management RPCs are authenticated-only. A hardening proposal was added but not applied automatically: `.migration-backup/supabase/migrations/20260515_dynamic_roles_grants_hardening.sql`.
- The hardening proposal also blocks owner/tech_admin assignment by non-critical callers and blocks self-escalation when a caller only has `users.assign_roles`.
- Current `group_invite_create` still uses chat membership and `invite_policy`; dynamic permissions such as `chats.invite_any` are seeded but not yet enforced by that RPC.

## 2026-05-13 Recurring Tasks Proposal State

- Read-only Supabase MCP confirmed the current task foundation is present on project ref `nhogbeojfnbjcfipitrh`: `tasks`, `task_events`, task enums, `task_create_v2`, `task_update_v2`, `task_create_v3`, `task_update_v3`, location routing fields (`location_id`, `target_role`, `route_admin_id`, `created_for_admin`) and dynamic permission helpers.
- Read-only MCP confirmed recurring-task schema is not present yet: no `public.task_recurrences`, no `public.task_recurrence_events`, and no `task_recurrence_*` RPC functions.
- New SQL was not applied automatically. Manual proposal: `.migration-backup/supabase/migrations/20260518_recurring_tasks.sql`.
- The proposal adds separate recurrence templates and generated task occurrences. Occurrences copy `visibility`, `assignment_scope`, `assignee_id`, `chat_id`, `location_id`, `target_role`, `route_admin_id`, `created_for_admin` and `priority`, so location/admin-only routing is preserved.
- Production recurring execution still needs a scheduler to call `task_recurrence_run_due()`: Supabase Scheduled Edge Function, `pg_cron`, external cron, or an explicit admin maintenance action.
- Frontend fallback expectation: until the migration is applied, the task form shows a friendly database-update message in the “Повторение” section while existing task create/update flows keep using the current task RPC.
