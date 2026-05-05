# Текущее состояние Supabase

Синхронизировано через read-only MCP `supabase_kub_readonly` 2026-05-05.

Project ref: `nhogbeojfnbjcfipitrh`.

Этот документ - снимок фактического production-like проекта. Он не заменяет миграции. Не применять SQL через MCP; если нужен фикс БД, создать idempotent migration в `.migration-backup/supabase/migrations/` и приложить verify SQL/manual QA.

## Public Schema

В `public` найдено 17 base tables. RLS включен на всех:

- `profiles` - 4 rows, пользователи/профили, `role app_role`.
- `chats` - 12 rows, private/group/channel chats, `is_forum`.
- `chat_members` - 11 rows, membership/roles, `last_read_at`.
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
- `folders`: audit folder delete.
- `profile_contacts`: guard insert/update.
- `notifications`: enqueue push outbox rows after notification insert.

## Realtime

`supabase_realtime` publication contains public tables:

- `bans`, `chat_members`, `chats`, `folder_chats`, `folders`, `messages`, `mutes`, `notifications`, `profiles`, `reactions`, `task_events`, `tasks`, `topics`.

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
