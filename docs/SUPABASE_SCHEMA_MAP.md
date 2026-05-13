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
- `role chat_member_role`, `joined_at`, `last_read_at`, `last_delivered_at`.
- Per-user local state: `hidden_at`, `cleared_at`, `pinned`, `pinned_at`, `pinned_order`.

`messages`:

- `id`, `chat_id`, `user_id`, `content`, `type`.
- Media/relation fields: `media_url`, `reply_to_id`, `forwarded_from_id`.
- Moderation/status: `edited_at`, `deleted_at`, `pinned`.
- `created_at`, `topic_id`.
- Send idempotency fields: `client_message_id uuid null`, `client_sent_at timestamptz null`.
- `created_at` is server-owned (`default now()`) and remains the persisted ordering/receipt timestamp. `client_sent_at` is diagnostic/pending-only context, not a canonical send time.

`message_hidden_for_users`:

- Composite PK: `message_id`, `user_id`.
- `hidden_at timestamptz`.
- Per-user local message hide state for "Удалить у себя"; hiding a row here does not soft-delete `messages` and does not remove Storage objects.
- RLS: authenticated users can read/insert/delete only their own hide rows.
- RPC: `hide_message_for_me(p_message_id)`, `unhide_message_for_me(p_message_id)`.

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
- `visibility task_visibility`, default `staff`; values: `staff`, `private`, `chat`.
- `assignment_scope task_assignment_scope`, default `user`; values: `user`, `manager_pool`, `staff_pool`.

`task_events`:

- `id`, `task_id`, `actor_id`, `kind`, `payload`, `created_at`.
- `kind` values: `create`, `assign`, `accept`, `start`, `send_for_confirmation`, `confirm`, `reject`, `cancel`, `comment`, `update`, `return_to_work`.

Task RPC:

- `task_create`.
- `task_create_v2`.
- `task_assign`.
- `task_claim`.
- `task_accept`.
- `task_start`.
- `task_send_for_confirmation`.
- `task_confirm`.
- `task_reject`.
- `task_cancel`.
- `task_comment`.
- `task_return_to_work`.
- `task_update`.
- `task_update_v2`.

Important behavior:

- Frontend reads `tasks`/`task_events`, but mutations go through RPC.
- `task_create_v2` / `task_update_v2` are the privacy-aware create/edit RPCs.
- `task_claim` lets eligible staff claim `manager_pool` / `staff_pool` tasks.
- Direct insert/update/delete policies are blocked for authenticated clients.
- `tasks` and `task_events` select policies use `_task_visible_to_current_user(...)`.
- `tasks` and `task_events` use replica identity FULL for realtime updates.

Planned locations/task-routing extension, proposal only as of 2026-05-10:

- New table `locations`: club/location catalog with name, optional description/address, active flag and creator.
- New table `location_members`: per-location user role (`owner`, `admin`, `manager`, `staff`), optional `primary_admin_id` for staff routing, and membership timestamps.
- Planned `tasks` columns: `location_id`, `target_role`, `route_admin_id`, `created_for_admin`.
- Planned RPC: `location_create`, `location_update`, `location_archive`, `location_member_assign`, `location_member_remove`, `location_member_set_primary_admin`, `task_create_v3`, `task_update_v3`.
- Planned RLS: global admin sees all; location admin sees own location/tasks/workers; staff sees personal tasks, own-location staff pool tasks and chat-visible tasks, but not `created_for_admin` tasks.
- Planned notifications: routed staff/admin task notifications should use location membership and must not notify staff about owner-to-admin tasks.

SQL proposal: `.migration-backup/supabase/migrations/20260513_locations_task_routing.sql`. It is not applied automatically.

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

Notification kinds handled by the current frontend:

- Task: `task_assigned`, `task_waiting_confirmation`, `task_confirmed`, `task_rejected`.
- Chat: `chat_added`.
- Group invitation: `group_invite` (manual group-invites migration applied by user on 2026-05-10).
- System: `mute_issued`, `ban_issued`, unknown/fallback kinds.

`group_invite` notification payload proposal:

- `invite_id uuid`.
- `chat_id uuid`.
- `chat_name text`.
- `inviter_id uuid`.
- `inviter_name text`.
- `inviter_avatar_url text null`.
- `status`: `pending`, `accepted`, `declined`, `cancelled`, `expired`.
- `expires_at timestamptz null`.

### Group Invites

The user manually applied `.migration-backup/supabase/migrations/20260509_group_invites.sql`.
The 2026-05-10 read-only Supabase MCP check confirmed `public.group_invites` exists with RLS enabled.
The available read-only MCP table introspection does not expose function definitions, so RPC presence is validated through authenticated frontend/RPC QA rather than by applying SQL.

- `.migration-backup/supabase/migrations/20260509_group_invites.sql`.

`group_invites`:

- `id uuid` PK.
- `chat_id uuid` FK `chats(id)` on delete cascade.
- `inviter_id uuid` FK `profiles(id)`.
- `invitee_id uuid` FK `profiles(id)`.
- `status text`: `pending`, `accepted`, `declined`, `cancelled`, `expired`.
- `created_at`, `expires_at`, `responded_at`.
- Unique pending invite per `(chat_id, invitee_id)`.

Expected RPC:

- `group_invite_create(p_chat_id uuid, p_invitee_id uuid)` - owner/admin creates or reuses a pending invite and sends a `group_invite` notification.
- `group_invite_accept(p_invite_id uuid)` - invitee accepts, RPC inserts `chat_members` with role `member`, updates invite/notification, returns `chat_id`.
- `group_invite_decline(p_invite_id uuid)` - invitee declines and updates invite/notification.
- `group_invite_cancel(p_invite_id uuid)` - inviter or chat owner/admin cancels a pending invite.

2026-05-10 frontend alignment:

- Group info now reads scoped `group_invites` for owner/admin views and shows pending, declined, accepted, cancelled and expired statuses next to the members list.
- `group_invites` is realtime-enabled by the 20260509 migration; the group info panel subscribes to current-chat `chat_members` and `group_invites` changes and refetches the scoped lists after each event.
- Declined/cancelled/expired invitees can be invited again through `group_invite_create`; pending and already-member users are disabled in the invite modal.
- New proposal only, not applied automatically: `.migration-backup/supabase/migrations/20260510_group_invite_join_system_messages.sql`. It preserves the existing accept checks and adds one persistent `messages.type = 'system'` row: `<display_name> присоединился к группе`.
- Newer proposal only, not applied automatically: `.migration-backup/supabase/migrations/20260511_invite_accept_read_baseline_and_system_notice.sql`. It supersedes the 20260510 proposal, sets `chat_members.joined_at`, `last_read_at` and `last_delivered_at` to the accept timestamp on invite accept, and stores the join notice as `messages.type = 'system'` with `user_id = null`.

Important behavior:

- Frontend must not insert directly into `chat_members` for existing group invites.
- Frontend must not use service role.
- Until the migration is manually applied, the app shows a friendly "Приглашения требуют обновления базы данных." fallback.

### Storage

Bucket `media`:

- Public bucket.
- Public object URLs continue to render existing media.
- Authenticated storage policies are path-scoped:
  `media authenticated scoped read`, `insert`, `update`, `delete`.
- Upload/update/delete are constrained by `_kub_media_path_allowed(name)`.

Broad `Anyone can view media` and `Authenticated users can upload media` policies are no longer present in production Supabase.

## Realtime

Realtime-enabled public tables:

- `bans`.
- `chat_members`.
- `chats`.
- `folder_chats`.
- `folders`.
- `messages`.
- `group_invites`.
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
- `20260505_tasks_visibility_and_assignment.sql` - applied in production Supabase as of 2026-05-05; adds task privacy and pool assignment.
- `20260505_media_storage_path_policies.sql` - applied in production Supabase as of 2026-05-05; hardens `media` storage paths.
- `20260505_folders_policy_cleanup.sql` - applied in production Supabase as of 2026-05-05; legacy `folders`/`folder_chats` `*_own` policies are absent.
- `20260506_chat_history_private_hide_permissions.sql` - applied in production Supabase as of 2026-05-06; adds per-user chat hide/clear RPC and columns.
- `20260506_chat_pins.sql` - applied in production Supabase as of 2026-05-06; adds per-user pinned chats and RPC.
- `20260507_message_hide_for_me.sql` - applied in production Supabase as of 2026-05-07; adds per-user message hide table and RPC.
- `20260507_message_hide_for_me_grants_hardening.sql` - applied manually in production Supabase as of 2026-05-07; read-only MCP confirmed `anon`/`PUBLIC` grants are absent and authenticated access remains.
- `20260507_message_delivery_receipts.sql` - applied manually in production Supabase as of 2026-05-07; adds `chat_members.last_delivered_at` and `mark_chat_delivered` / `mark_chat_read` RPC for honest private-chat delivered/read receipts.
- `20260508_messages_client_message_id.sql` - applied manually in production Supabase as of 2026-05-08; adds message send idempotency columns and partial indexes for safe retry.
- `20260508_chat_pinned_order.sql` - applied manually in production Supabase as of 2026-05-08; adds per-user `chat_members.pinned_order` and `set_pinned_chat_order(uuid[])`.
- `20260506_admin_avatar_management.sql` - applied in production Supabase as of 2026-05-06; allows admins to upload avatars for non-admin users through the scoped media path helper.
- `20260506_secure_chat_media_access.sql` - applied in production Supabase as of 2026-05-06; adds private `chat-media` bucket, chat-member storage policies and `messages.media_bucket` / `messages.media_path`.
- `20260506_entity_name_constraints.sql` - applied manually in production Supabase as of 2026-05-06; DB-level max length checks for `chats.name`, `folders.name` and `topics.name` are active.
- `20260512_group_invite_reinvite_and_policy.sql` - proposal only, not applied automatically. Adds `chats.invite_policy` (`owner_admin_only` / `members_can_invite`) and updates invite RPC behavior so historical accepted/declined/cancelled/expired invites do not block reinviting users who are no longer current `chat_members`.
- `20260513_locations_task_routing.sql` - applied manually by the user on 2026-05-10. Adds `locations`, `location_members`, task routing fields and `task_create_v3` / `task_update_v3`.
- `20260514_dynamic_roles_permissions.sql` - proposal only, not applied automatically. Adds dynamic `roles`, `permissions`, `role_permissions`, `user_global_roles`, `location_members.role_id`, permission helper functions, protected role-management RPC and permission-aware routing/invite hooks.

## Pending Group Invite Policy Proposal

`20260512_group_invite_reinvite_and_policy.sql` keeps `chat_members` as the authoritative current-membership table. A historical `group_invites.status = 'accepted'` row is no longer enough to block a new invite if the user was removed from the group.

The proposal updates:

- `public.chats.invite_policy text not null default 'owner_admin_only'`.
- `public.group_invite_create(p_chat_id uuid, p_invitee_id uuid)`:
  - rejects current members;
  - returns an existing pending invite;
  - creates a fresh pending invite and `group_invite` notification for removed/former users;
  - allows all current members to invite only when `invite_policy = 'members_can_invite'`.
- `public.group_invite_cancel(p_invite_id uuid)`:
  - remains owner/admin only, so ordinary members in common groups can invite but cannot manage invitations.

Supabase MCP migration ledger is empty; do not rely on Supabase CLI migration history for this project.

## Pending Dynamic Roles / Permissions Proposal

`20260514_dynamic_roles_permissions.sql` keeps `profiles.role` as a legacy global fallback while adding a gradual dynamic role system:

- `public.roles`: dynamic role catalog with `key`, `name`, `description`, `scope` (`global`, `location`, `chat`), `is_system`, `is_active`.
- `public.permissions`: permission catalog grouped by category.
- `public.role_permissions`: many-to-many role to permission grants.
- `public.user_global_roles`: global role assignments for users.
- `public.location_members.role_id`: optional dynamic role link while preserving the existing `location_members.role` text fallback.

Seeded system roles:

- Global: `owner`, `tech_admin`, `admin`, `manager`, `user`.
- Location: `location_owner`, `location_admin`, `location_manager`, `location_staff`, `location_client`.
- Chat: `chat_owner`, `chat_admin`, `chat_member`.

Important security proposal:

- `owner` and `tech_admin` receive every permission by default.
- The first legacy `profiles.role = admin` user is bootstrapped as owner + tech_admin only if there is no critical dynamic assignment yet.
- RPCs block removing/deactivating the last owner or tech_admin.
- Dynamic role changes are logged to `audit_logs`.
- RLS/RPC helpers include `has_global_role`, `has_permission`, `has_location_role`, `has_location_permission`.

Frontend behavior before applying this migration:

- `/admin/roles` shows a friendly disabled state.
- Profile and mini-profile role display falls back to `profiles.role` and location text roles.
- Existing locations/task routing and invites remain on their current permissions.
- 2026-05-10 activation follow-up: the live project ref still did not expose the dynamic role tables/RPC through read-only MCP. The frontend now probes the schema by default and stores an explicit local disabled state only after a missing-schema response, so old fallback cache does not block the UI after the migration is applied later.

## Applied Dynamic Roles / Permissions State

The user manually applied `.migration-backup/supabase/migrations/20260514_dynamic_roles_permissions.sql` on 2026-05-10.

Read-only Supabase MCP confirmed:

- `public.roles`, `public.permissions`, `public.role_permissions`, `public.user_global_roles` exist with RLS enabled.
- `public.location_members.role_id` exists and references `public.roles(id)`.
- Expected seeded system roles are present: `owner`, `tech_admin`, `admin`, `manager`, `user`, location roles and chat roles.
- Expected seeded permissions are present, including role, user, location, task and chat invite permissions.
- Role helper and management RPC exist and are `security definer`; dangerous management execute grants are authenticated-only.

Security note:

- RLS currently protects role data, but table-level grants are broader than least privilege. New proposal only, not applied automatically: `.migration-backup/supabase/migrations/20260515_dynamic_roles_grants_hardening.sql`.
- The same proposal hardens `user_assign_global_role` / `user_remove_global_role` so owner/tech_admin assignment requires an existing owner/tech_admin and callers with only `users.assign_roles` cannot escalate themselves.
- Current `group_invite_create` still relies on chat membership and `invite_policy`; dynamic invite permissions are seeded for future enforcement but not wired into that RPC yet.

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

## 2026-05-13 Recurring Tasks Extension Proposal

Current live schema still has only ordinary task rows plus location-routing columns. The recurring extension is proposal-only until `.migration-backup/supabase/migrations/20260518_recurring_tasks.sql` is applied manually.

Planned tables:

- `task_recurrences`: recurrence settings tied to a template task, with `frequency`, `interval_count`, optional `by_weekday` / `by_monthday`, `starts_at`, `next_run_at`, `last_run_at`, `end_at`, `max_occurrences`, `occurrences_created`, `paused_at` and `stopped_at`.
- `task_recurrence_events`: audit/history of recurrence lifecycle events and generated occurrences.

Planned `tasks` columns:

- `recurrence_id`: recurrence that owns a template task or generated occurrence.
- `recurrence_template_task_id`: source task for generated occurrences.
- `recurrence_scheduled_for`: scheduled timestamp for the occurrence. A partial unique index on `(recurrence_id, recurrence_scheduled_for)` prevents duplicate generated tasks.

Planned RPC:

- `task_recurrence_create`, `task_recurrence_update`, `task_recurrence_pause`, `task_recurrence_resume`, `task_recurrence_stop`, `task_recurrence_run_due`.

Security model:

- Recurrence visibility delegates to the existing location-aware task visibility helper.
- Management requires task-management permissions, global owner/tech_admin permission, or matching location task permission.
- Generated occurrences copy task routing fields (`location_id`, `target_role`, `route_admin_id`, `created_for_admin`) and assignment fields, so staff/admin visibility does not broaden during recurrence.
