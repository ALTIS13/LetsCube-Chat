# Supabase Integration Audit

This file records the current frontend/Supabase safety assumptions for KUB. It is not a replacement for reviewing RLS policies in the Supabase dashboard before production.

## Current Frontend Findings

- Private chat creation uses the `open_or_create_private_chat` RPC in `artifacts/kub/src/hooks/useCreateChat.ts`.
- The frontend does not directly create `type='private'` chats.
- Group chat and Saved Messages creation use direct `chats` inserts for `type='group'`.
- Task mutations use RPCs:
  - `task_create`
  - `task_assign`
  - `task_accept`
  - `task_start`
  - `task_send_for_confirmation`
  - `task_confirm`
  - `task_reject`
  - `task_cancel`
  - `task_comment`
  - `task_return_to_work`
  - `task_update`
- Direct `tasks` table access in frontend is read-only list/detail loading.
- No `SUPABASE_SERVICE_ROLE_KEY` is used by the frontend.
- Notification reads are scoped by `user_id`; mark-read flows use notification RPCs.
- Audit log reads are in admin UI and rely on RLS/server policies for access control.

## Migration Apply Order

Apply migrations in filename order:

1. `.migration-backup/supabase/migrations/20260427_chats_update_policy.sql`
2. `.migration-backup/supabase/migrations/20260427_folders_rls.sql`
3. `.migration-backup/supabase/migrations/20260427_push_subscriptions.sql`
4. `.migration-backup/supabase/migrations/20260427_topics.sql`
5. `.migration-backup/supabase/migrations/20260504_chats_membership_hardening.sql`
6. `.migration-backup/supabase/migrations/20260504_folders_shared.sql`
7. `.migration-backup/supabase/migrations/20260504_notifications.sql`
8. `.migration-backup/supabase/migrations/20260504_phone_privacy.sql`
9. `.migration-backup/supabase/migrations/20260504_roles_admin.sql`
10. `.migration-backup/supabase/migrations/20260504_tasks_system.sql`
11. `.migration-backup/supabase/migrations/20260504_tasks_update_and_chat_lockdown.sql`
12. `.migration-backup/supabase/migrations/20260505_audit_logs.sql`

## Manual Production Checks

- RLS must remain enabled on user-facing tables.
- Managers must not be able to manage admins.
- Last admin protection must remain active.
- Last chat owner protection must remain active.
- Banned/muted restrictions must remain active.
- `audit_logs` should be append-only and admin-only.
- Phone/contact data must not be readable by users outside the intended privacy policy.
- Realtime must be enabled only for the tables the app needs.

## SQL Change Policy

No SQL changes were introduced by this hardening pass. If a future fix requires SQL, create a new migration file and review the exact SQL before applying it to production.
