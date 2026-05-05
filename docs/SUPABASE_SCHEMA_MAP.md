# Карта Supabase Schema

Синхронизировано через read-only MCP `supabase_kub_readonly` 2026-05-05.

## Домены Данных

### Auth / Profiles

`auth.users` является источником identity. `public.profiles.id` ссылается на `auth.users.id`.

`profiles`:

- `id uuid` PK/FK auth user.
- `username text unique`, `full_name`, `avatar_url`, `bio`.
- `online_at`, `created_at`, `updated_at`.
- `role app_role`, default `user`.

`profile_contacts`:

- `user_id uuid` PK/FK `profiles.id`.
- `phone`, `phone_verified`, `updated_at`.
- Телефон намеренно вынесен из `profiles`; owner/staff read, owner update.

Role helpers:

- `is_admin(uid)`.
- `is_manager_or_admin(uid)`.
- `admin_user_emails(uids uuid[])`.

### Chats / Messages

`chats`:

- `id`, `type` (`private`, `group`, `channel`), `name`, `description`, `avatar_url`.
- `created_by`, timestamps, `is_forum`.

`chat_members`:

- Composite PK: `chat_id`, `user_id`.
- `role chat_member_role`, `joined_at`, `last_read_at`.

`messages`:

- `id`, `chat_id`, `user_id`, `content`, `type`.
- Media/relation fields: `media_url`, `reply_to_id`, `forwarded_from_id`.
- Moderation/status: `edited_at`, `deleted_at`, `pinned`.
- `created_at`, `topic_id`.

`reactions`:

- `message_id`, `user_id`, `emoji`.
- Unique: `message_id`, `user_id`, `emoji`.

Chat RPC/helpers:

- `open_or_create_private_chat(target_user_id)`.
- `get_my_chat_ids()`.
- `is_chat_member(cid)`, `is_chat_admin(cid)`, `is_chat_owner(cid)`, `chat_role_of(cid)`.

Important behavior:

- Frontend must not directly create `type='private'` chats; use `open_or_create_private_chat`.
- Chat creator is added as owner by trigger.
- Chat owner/admin rules are enforced by RLS and triggers.

### Topics

`topics`:

- `id`, `chat_id`, `name`, `emoji`.
- `is_general`, `position`, `archived`.
- `created_by`, timestamps.

Indexes:

- `idx_topics_chat(chat_id, position)`.
- `uniq_topics_general(chat_id) where is_general`.

Topics are realtime-enabled.

### Folders

`folders`:

- `id`, `user_id`, `name`, `emoji`, `position`, `created_at`.
- `scope folder_scope`: `personal`, `shared`, `system`.
- `created_by`.

`folder_chats`:

- Composite PK: `folder_id`, `chat_id`.

Access helpers:

- `can_see_shared_folder(fid)`.

Important behavior:

- Personal folders are owner-scoped.
- Shared folders are visible/manageable according to staff/creator/membership rules.
- System folders are admin-controlled.

### Tasks

`tasks`:

- `id`, `title`, `description`.
- `priority task_priority`.
- `status task_status`.
- `created_by`, `assignee_id`, `chat_id`.
- `due_at`, timestamps.

`task_events`:

- `id`, `task_id`, `actor_id`, `kind`, `payload`, `created_at`.
- `kind` values: `create`, `assign`, `accept`, `start`, `send_for_confirmation`, `confirm`, `reject`, `cancel`, `comment`, `update`, `return_to_work`.

Task RPC:

- `task_create`.
- `task_assign`.
- `task_accept`.
- `task_start`.
- `task_send_for_confirmation`.
- `task_confirm`.
- `task_reject`.
- `task_cancel`.
- `task_comment`.
- `task_return_to_work`.
- `task_update`.

Important behavior:

- Frontend reads `tasks`/`task_events`, but mutations go through RPC.
- Direct insert/update/delete policies are blocked for authenticated clients.
- `tasks` and `task_events` use replica identity FULL for realtime updates.

### Admin / Sanctions / Audit

`bans`:

- `id`, `user_id`, `reason`, `expires_at`, `issued_by`, `created_at`.

`mutes`:

- `id`, `user_id`, optional `chat_id`, `reason`, `expires_at`, `issued_by`, `created_at`.

Sanction helpers:

- `is_banned(uid)`.
- `is_muted(uid, cid)`.

`audit_logs`:

- `id`, `actor_id`, `action`, `target_kind`, `target_id`, `diff`, `created_at`.
- Admin-only read by RLS.
- Inserted by audit triggers/functions.

Important behavior:

- Managers/admins can manage sanctions, but role/sanction matrix must protect admins.
- Last admin protection is enforced by trigger.
- Audit logs should remain append-only from client perspective.

### Notifications / Push

`notifications`:

- `id`, `user_id`, `kind`, `payload`, `read_at`, `created_at`.
- Owner reads own notifications.

Notification RPC:

- `notifications_mark_read(p_id)`.
- `notifications_mark_all_read()`.

`push_subscriptions`:

- `id`, `user_id`, `endpoint`, `p256dh`, `auth`, `user_agent`, timestamps.
- Users manage own subscriptions.

`notifications_push_outbox`:

- `id`, `notification_id`, `subscription_id`, `user_id`, `payload`.
- `created_at`, `sent_at`, `attempt_count`, `last_error`.
- Server-side-only queue for optional `artifacts/api-server` push dispatcher.
- RLS enabled, no public policies.

Important behavior:

- In-app notification bell does not require push worker.
- Push worker must use server-side env only; never expose service role to frontend.

### Storage

Bucket `media`:

- Public bucket.
- Broad SELECT policy permits public reads/listing.
- Authenticated users can upload.

Production hardening candidate: decide whether broad listing is acceptable for KUB media.

## Realtime

Realtime-enabled public tables:

- `bans`.
- `chat_members`.
- `chats`.
- `folder_chats`.
- `folders`.
- `messages`.
- `mutes`.
- `notifications`.
- `profiles`.
- `reactions`.
- `task_events`.
- `tasks`.
- `topics`.

Replica identity FULL:

- `chat_members`.
- `messages`.
- `tasks`.
- `task_events`.

## Migration Files In Repo

Manual/idempotent migrations are stored in `.migration-backup/supabase/migrations/`:

- `20260427_chats_update_policy.sql`.
- `20260427_folders_rls.sql`.
- `20260427_push_subscriptions.sql`.
- `20260427_topics.sql`.
- `20260504_chats_membership_hardening.sql`.
- `20260504_folders_shared.sql`.
- `20260504_notifications.sql`.
- `20260504_phone_privacy.sql`.
- `20260504_roles_admin.sql`.
- `20260504_tasks_system.sql`.
- `20260504_tasks_update_and_chat_lockdown.sql`.
- `20260505_audit_logs.sql`.

Supabase MCP migration ledger is empty; do not rely on Supabase CLI migration history for this project.

## Common Schema Checks

Use read-only SQL only through MCP:

```sql
select schemaname, tablename, policyname, permissive, roles, cmd
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

select t.typname as enum_name, array_agg(e.enumlabel order by e.enumsortorder) as values
from pg_type t
join pg_namespace n on n.oid = t.typnamespace
join pg_enum e on e.enumtypid = t.oid
where n.nspname = 'public'
group by t.typname
order by t.typname;

select pt.pubname, pt.schemaname, pt.tablename
from pg_publication_tables pt
where pt.pubname = 'supabase_realtime'
order by pt.schemaname, pt.tablename;
```

Do not run DDL through MCP. For any schema fix, create a new idempotent migration file and ask the user to apply it manually in Supabase SQL Editor.
