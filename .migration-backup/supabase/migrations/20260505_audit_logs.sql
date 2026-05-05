-- Audit Log (Task #33)
--
-- Append-only history of staff-affecting events (role changes, sanctions,
-- group membership, folder deletions, task transitions, admin message
-- deletions).  Read by admins only; no client may write — every row is
-- inserted by SECURITY DEFINER triggers.  No UPDATE / DELETE policy at
-- all, so even admins cannot tamper with the log.
--
-- Depends on: 20260504_roles_admin.sql (`is_admin`, `bans`, `mutes`,
-- `app_role`), 20260504_tasks_system.sql (`tasks`, `task_status`),
-- 20260504_chats_membership_hardening.sql (`chat_members`),
-- 20260427_folders_rls.sql / 20260504_folders_shared.sql (`folders`).
-- Idempotent.

-- ── 1. table + indexes ────────────────────────────────────────────────────
create table if not exists public.audit_logs (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid references public.profiles(id) on delete set null,
  action       text not null,
  target_kind  text not null,
  target_id    uuid,
  diff         jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists idx_audit_logs_created_at
  on public.audit_logs (created_at desc);

create index if not exists idx_audit_logs_actor_created
  on public.audit_logs (actor_id, created_at desc);

create index if not exists idx_audit_logs_action_created
  on public.audit_logs (action, created_at desc);

-- ── 2. RLS ────────────────────────────────────────────────────────────────
-- Admin-only SELECT; no INSERT / UPDATE / DELETE policies at all so:
--   • clients cannot fabricate or alter rows;
--   • only SECURITY DEFINER trigger functions (bypass RLS) can write;
--   • no row can ever be deleted via PostgREST, even by an admin.
alter table public.audit_logs enable row level security;

drop policy if exists "admins read audit_logs" on public.audit_logs;
create policy "admins read audit_logs"
  on public.audit_logs for select
  using (public.is_admin(auth.uid()));

revoke insert, update, delete on public.audit_logs from anon, authenticated;

-- ── 3. internal writer ────────────────────────────────────────────────────
create or replace function public._audit(
  p_action      text,
  p_target_kind text,
  p_target_id   uuid,
  p_diff        jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs (actor_id, action, target_kind, target_id, diff)
  values (auth.uid(), p_action, p_target_kind, p_target_id, coalesce(p_diff, '{}'::jsonb));
end $$;

revoke all on function public._audit(text, text, uuid, jsonb) from public;
revoke all on function public._audit(text, text, uuid, jsonb) from authenticated, anon;

-- ── 4. profiles.role changes ──────────────────────────────────────────────
create or replace function public._audit_profile_role_after_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role then
    perform public._audit(
      'role_change',
      'profile',
      new.id,
      jsonb_build_object(
        'from', old.role::text,
        'to',   new.role::text
      )
    );
  end if;
  return null;
end $$;

drop trigger if exists trg_audit_profile_role on public.profiles;
create trigger trg_audit_profile_role
  after update of role on public.profiles
  for each row execute function public._audit_profile_role_after_update();

-- ── 5. bans (issue + lift) ────────────────────────────────────────────────
create or replace function public._audit_bans_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._audit(
    'ban_issued',
    'profile',
    new.user_id,
    jsonb_build_object(
      'ban_id',     new.id,
      'reason',     new.reason,
      'expires_at', new.expires_at
    )
  );
  return null;
end $$;

create or replace function public._audit_bans_after_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._audit(
    'ban_lifted',
    'profile',
    old.user_id,
    jsonb_build_object(
      'ban_id',     old.id,
      'reason',     old.reason,
      'expires_at', old.expires_at
    )
  );
  return null;
end $$;

drop trigger if exists trg_audit_bans_insert on public.bans;
create trigger trg_audit_bans_insert
  after insert on public.bans
  for each row execute function public._audit_bans_after_insert();

drop trigger if exists trg_audit_bans_delete on public.bans;
create trigger trg_audit_bans_delete
  after delete on public.bans
  for each row execute function public._audit_bans_after_delete();

-- ── 6. mutes (issue + lift) ───────────────────────────────────────────────
create or replace function public._audit_mutes_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._audit(
    'mute_issued',
    'profile',
    new.user_id,
    jsonb_build_object(
      'mute_id',    new.id,
      'chat_id',    new.chat_id,
      'reason',     new.reason,
      'expires_at', new.expires_at
    )
  );
  return null;
end $$;

create or replace function public._audit_mutes_after_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._audit(
    'mute_lifted',
    'profile',
    old.user_id,
    jsonb_build_object(
      'mute_id',    old.id,
      'chat_id',    old.chat_id,
      'reason',     old.reason,
      'expires_at', old.expires_at
    )
  );
  return null;
end $$;

drop trigger if exists trg_audit_mutes_insert on public.mutes;
create trigger trg_audit_mutes_insert
  after insert on public.mutes
  for each row execute function public._audit_mutes_after_insert();

drop trigger if exists trg_audit_mutes_delete on public.mutes;
create trigger trg_audit_mutes_delete
  after delete on public.mutes
  for each row execute function public._audit_mutes_after_delete();

-- ── 7. chat_members (added / role changed / removed) ──────────────────────
-- Self-actions (a user joining or leaving their own row) are still audited;
-- they're rare and useful for forensic timelines.  Auto-owner inserts from
-- `add_chat_creator_as_owner` are skipped because that runs server-side and
-- the actor is the same as the new member being added.
create or replace function public._audit_chat_members_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  creator uuid;
begin
  select created_by into creator from public.chats where id = new.chat_id;
  if creator is not distinct from new.user_id then
    -- This is the auto-owner row written by add_chat_creator_as_owner —
    -- nothing meaningful to audit (we already log chat creation implicitly
    -- via owner = creator).
    return null;
  end if;
  perform public._audit(
    'chat_member_added',
    'chat',
    new.chat_id,
    jsonb_build_object(
      'user_id', new.user_id,
      'role',    new.role::text
    )
  );
  return null;
end $$;

create or replace function public._audit_chat_members_after_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role then
    perform public._audit(
      'chat_member_role_changed',
      'chat',
      new.chat_id,
      jsonb_build_object(
        'user_id', new.user_id,
        'from',    old.role::text,
        'to',      new.role::text
      )
    );
  end if;
  return null;
end $$;

create or replace function public._audit_chat_members_after_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._audit(
    'chat_member_removed',
    'chat',
    old.chat_id,
    jsonb_build_object(
      'user_id', old.user_id,
      'role',    old.role::text
    )
  );
  return null;
end $$;

drop trigger if exists trg_audit_chat_members_insert on public.chat_members;
create trigger trg_audit_chat_members_insert
  after insert on public.chat_members
  for each row execute function public._audit_chat_members_after_insert();

drop trigger if exists trg_audit_chat_members_update on public.chat_members;
create trigger trg_audit_chat_members_update
  after update of role on public.chat_members
  for each row execute function public._audit_chat_members_after_update();

drop trigger if exists trg_audit_chat_members_delete on public.chat_members;
create trigger trg_audit_chat_members_delete
  after delete on public.chat_members
  for each row execute function public._audit_chat_members_after_delete();

-- ── 8. folders (deletion) ─────────────────────────────────────────────────
-- Personal folder deletes (scope='personal') are noise; we only audit
-- shared / system folder deletions, which are the ones that affect other
-- users.
create or replace function public._audit_folders_after_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.scope in ('shared', 'system') then
    perform public._audit(
      'folder_deleted',
      'folder',
      old.id,
      jsonb_build_object(
        'name',  old.name,
        'scope', old.scope::text,
        'owner', old.user_id
      )
    );
  end if;
  return null;
end $$;

drop trigger if exists trg_audit_folders_delete on public.folders;
create trigger trg_audit_folders_delete
  after delete on public.folders
  for each row execute function public._audit_folders_after_delete();

-- ── 9. tasks (status transitions) ─────────────────────────────────────────
create or replace function public._audit_tasks_status_after_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    perform public._audit(
      'task_status_change',
      'task',
      new.id,
      jsonb_build_object(
        'from',  old.status::text,
        'to',    new.status::text,
        'title', new.title
      )
    );
  end if;
  return null;
end $$;

drop trigger if exists trg_audit_tasks_status on public.tasks;
create trigger trg_audit_tasks_status
  after update of status on public.tasks
  for each row execute function public._audit_tasks_status_after_update();

-- ── 10. messages (admin / manager deletions of someone else's message) ───
-- Self-deletions (a user removing their own message) are not audited.
-- We log a row only when staff (admin or manager) soft-deletes a message
-- that belongs to another user (deleted_at goes from NULL → non-NULL).
create or replace function public._audit_messages_admin_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
begin
  if old.deleted_at is null
     and new.deleted_at is not null
     and caller is not null
     and caller is distinct from new.user_id
     and public.is_manager_or_admin(caller)
  then
    perform public._audit(
      'message_deleted_by_staff',
      'message',
      new.id,
      jsonb_build_object(
        'chat_id', new.chat_id,
        'author',  new.user_id,
        'type',    new.type
      )
    );
  end if;
  return null;
end $$;

drop trigger if exists trg_audit_messages_admin_delete on public.messages;
create trigger trg_audit_messages_admin_delete
  after update of deleted_at on public.messages
  for each row execute function public._audit_messages_admin_delete();
