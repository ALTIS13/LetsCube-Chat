-- =====================================================================
-- KUB tasks: visibility + pool assignment model
-- =====================================================================
-- Idempotent migration proposal. Apply manually in Supabase SQL Editor.
--
-- Why:
--   Current production schema has no explicit task privacy model. A linked
--   chat task is visible to every member of that chat through RLS, which is
--   too broad for staff work. This migration adds privacy-first visibility
--   and optional staff/manager pool assignment without disabling RLS.
--
-- Safe default:
--   Existing tasks are backfilled to visibility='staff'. This intentionally
--   stops ordinary chat members from seeing old linked tasks unless staff
--   explicitly changes a task to visibility='chat' through the new RPC.
--
-- Do not apply through MCP. The user applies this SQL manually.
-- =====================================================================

set search_path = public;

-- ---------------------------------------------------------------------
-- 1. Enums / columns / indexes
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'task_visibility'
  ) then
    create type public.task_visibility as enum ('staff', 'private', 'chat');
  end if;

  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'task_assignment_scope'
  ) then
    create type public.task_assignment_scope as enum ('user', 'manager_pool', 'staff_pool');
  end if;
end $$;

alter table public.tasks
  add column if not exists visibility public.task_visibility not null default 'staff';

alter table public.tasks
  add column if not exists assignment_scope public.task_assignment_scope not null default 'user';

update public.tasks
   set visibility = 'staff'::public.task_visibility
 where visibility is null;

update public.tasks
   set assignment_scope = 'user'::public.task_assignment_scope
 where assignment_scope is null;

create index if not exists idx_tasks_visibility
  on public.tasks (visibility);

create index if not exists idx_tasks_assignment_scope_status
  on public.tasks (assignment_scope, status);

create index if not exists idx_tasks_chat_visibility
  on public.tasks (chat_id, visibility);

-- Already present in the current DB, but kept for idempotent apply.
create index if not exists idx_tasks_assignee_status
  on public.tasks (assignee_id, status);

create index if not exists idx_tasks_creator_status
  on public.tasks (created_by, status);

-- ---------------------------------------------------------------------
-- 2. Visibility helper used by RLS and RPCs
-- ---------------------------------------------------------------------
create or replace function public._task_visible_to_current_user(
  p_assignee_id uuid,
  p_created_by uuid,
  p_chat_id uuid,
  p_visibility public.task_visibility,
  p_assignment_scope public.task_assignment_scope
)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    return false;
  end if;
  if public.is_banned(v_caller) then
    return false;
  end if;
  if public.is_admin(v_caller) then
    return true;
  end if;
  if p_assignee_id = v_caller or p_created_by = v_caller then
    return true;
  end if;

  -- Current role model has admin/manager/user only, so both pools are
  -- staff-only and map to manager/admin eligibility for now.
  if p_assignment_scope in ('manager_pool', 'staff_pool')
     and public.is_manager_or_admin(v_caller) then
    return true;
  end if;

  if p_visibility = 'staff'::public.task_visibility then
    return public.is_manager_or_admin(v_caller);
  end if;

  if p_visibility = 'chat'::public.task_visibility then
    return public.is_manager_or_admin(v_caller)
      or (p_chat_id is not null and public.is_chat_member(p_chat_id));
  end if;

  -- private: creator, assignee and admin only.
  return false;
end $$;

revoke all on function public._task_visible_to_current_user(
  uuid, uuid, uuid, public.task_visibility, public.task_assignment_scope
) from public, anon;
grant execute on function public._task_visible_to_current_user(
  uuid, uuid, uuid, public.task_visibility, public.task_assignment_scope
) to authenticated;

-- ---------------------------------------------------------------------
-- 3. RLS policies
-- ---------------------------------------------------------------------
alter table public.tasks enable row level security;

drop policy if exists "tasks select" on public.tasks;
drop policy if exists "tasks select for participants" on public.tasks;
drop policy if exists "tasks select with visibility" on public.tasks;
drop policy if exists "tasks insert blocked" on public.tasks;
drop policy if exists "tasks update blocked" on public.tasks;
drop policy if exists "tasks delete blocked" on public.tasks;

create policy "tasks select with visibility"
  on public.tasks for select
  to authenticated
  using (
    public._task_visible_to_current_user(
      assignee_id,
      created_by,
      chat_id,
      visibility,
      assignment_scope
    )
  );

create policy "tasks insert blocked" on public.tasks
  for insert to authenticated with check (false);
create policy "tasks update blocked" on public.tasks
  for update to authenticated using (false) with check (false);
create policy "tasks delete blocked" on public.tasks
  for delete to authenticated using (false);

alter table public.task_events enable row level security;

drop policy if exists "task_events select" on public.task_events;
drop policy if exists "task_events select for participants" on public.task_events;
drop policy if exists "task_events select with visibility" on public.task_events;
drop policy if exists "task_events insert blocked" on public.task_events;
drop policy if exists "task_events update blocked" on public.task_events;
drop policy if exists "task_events delete blocked" on public.task_events;

create policy "task_events select with visibility"
  on public.task_events for select
  to authenticated
  using (
    exists (
      select 1
        from public.tasks t
       where t.id = task_events.task_id
         and public._task_visible_to_current_user(
           t.assignee_id,
           t.created_by,
           t.chat_id,
           t.visibility,
           t.assignment_scope
         )
    )
  );

create policy "task_events insert blocked" on public.task_events
  for insert to authenticated with check (false);
create policy "task_events update blocked" on public.task_events
  for update to authenticated using (false) with check (false);
create policy "task_events delete blocked" on public.task_events
  for delete to authenticated using (false);

grant select on public.tasks to authenticated;
grant select on public.task_events to authenticated;

-- ---------------------------------------------------------------------
-- 4. Validation helper for the new RPCs
-- ---------------------------------------------------------------------
create or replace function public._task_assert_visibility_assignment(
  p_visibility public.task_visibility,
  p_assignment_scope public.task_assignment_scope,
  p_assignee_id uuid,
  p_chat_id uuid
)
returns void
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if p_visibility is null then
    raise exception 'visibility_required' using errcode = '22023';
  end if;
  if p_assignment_scope is null then
    raise exception 'assignment_scope_required' using errcode = '22023';
  end if;
  if p_visibility = 'chat'::public.task_visibility and p_chat_id is null then
    raise exception 'chat_visibility_requires_chat' using errcode = '22023';
  end if;
  if p_visibility = 'private'::public.task_visibility
     and p_assignment_scope <> 'user'::public.task_assignment_scope then
    raise exception 'private_tasks_cannot_use_pool_assignment' using errcode = '22023';
  end if;
  if p_assignment_scope <> 'user'::public.task_assignment_scope
     and p_assignee_id is not null then
    raise exception 'pool_assignment_requires_empty_assignee' using errcode = '22023';
  end if;
end $$;

revoke all on function public._task_assert_visibility_assignment(
  public.task_visibility, public.task_assignment_scope, uuid, uuid
) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. New RPCs. Old task_create/task_update stay for compatibility.
-- ---------------------------------------------------------------------
create or replace function public.task_create_v2(
  p_title text,
  p_description text default null,
  p_assignee_id uuid default null,
  p_priority public.task_priority default 'normal',
  p_due_at timestamptz default null,
  p_chat_id uuid default null,
  p_visibility public.task_visibility default 'staff',
  p_assignment_scope public.task_assignment_scope default 'user'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_new_id uuid;
  v_start_status public.task_status;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if public.is_banned(v_caller) then
    raise exception 'banned' using errcode = '42501';
  end if;
  if not public.is_manager_or_admin(v_caller) then
    raise exception 'only_staff_can_create_tasks' using errcode = '42501';
  end if;
  if p_title is null or length(btrim(p_title)) = 0 then
    raise exception 'title_required' using errcode = '22023';
  end if;
  if p_chat_id is not null
     and not exists (select 1 from public.chats where id = p_chat_id) then
    raise exception 'chat_not_found' using errcode = 'P0002';
  end if;

  perform public._task_assert_visibility_assignment(
    p_visibility, p_assignment_scope, p_assignee_id, p_chat_id
  );
  perform public._task_assert_can_assign_to(p_assignee_id);

  v_start_status := case
    when p_assignment_scope <> 'user'::public.task_assignment_scope then 'new'::public.task_status
    when p_assignee_id is null then 'new'::public.task_status
    else 'assigned'::public.task_status
  end;

  insert into public.tasks (
    title, description, priority, status, created_by,
    assignee_id, chat_id, due_at, visibility, assignment_scope
  )
  values (
    btrim(p_title),
    nullif(btrim(coalesce(p_description, '')), ''),
    p_priority,
    v_start_status,
    v_caller,
    p_assignee_id,
    p_chat_id,
    p_due_at,
    p_visibility,
    p_assignment_scope
  )
  returning id into v_new_id;

  perform public.task_append_event(
    v_new_id,
    'create',
    jsonb_build_object(
      'priority', p_priority::text,
      'assignee_id', p_assignee_id,
      'chat_id', p_chat_id,
      'due_at', p_due_at,
      'visibility', p_visibility::text,
      'assignment_scope', p_assignment_scope::text
    )
  );

  return v_new_id;
end $$;

revoke all on function public.task_create_v2(
  text, text, uuid, public.task_priority, timestamptz, uuid,
  public.task_visibility, public.task_assignment_scope
) from public, anon;
grant execute on function public.task_create_v2(
  text, text, uuid, public.task_priority, timestamptz, uuid,
  public.task_visibility, public.task_assignment_scope
) to authenticated;

create or replace function public.task_update_v2(
  p_task_id uuid,
  p_title text,
  p_description text,
  p_priority public.task_priority,
  p_due_at timestamptz,
  p_assignee_id uuid,
  p_chat_id uuid,
  p_visibility public.task_visibility,
  p_assignment_scope public.task_assignment_scope
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_task public.tasks%rowtype;
  v_new_status public.task_status;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if public.is_banned(v_caller) then
    raise exception 'banned' using errcode = '42501';
  end if;
  if p_title is null or length(btrim(p_title)) = 0 then
    raise exception 'title_required' using errcode = '22023';
  end if;
  if p_priority is null then
    raise exception 'priority_required' using errcode = '22023';
  end if;

  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'task_not_found' using errcode = 'P0002';
  end if;
  if v_task.status in ('confirmed', 'cancelled') then
    raise exception 'task_locked: status=%', v_task.status using errcode = '22023';
  end if;
  if v_caller <> v_task.created_by
     and not public.is_manager_or_admin(v_caller) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_chat_id is not null
     and not exists (select 1 from public.chats where id = p_chat_id) then
    raise exception 'chat_not_found' using errcode = 'P0002';
  end if;

  perform public._task_assert_visibility_assignment(
    p_visibility, p_assignment_scope, p_assignee_id, p_chat_id
  );
  perform public._task_assert_can_assign_to(p_assignee_id);

  v_new_status := v_task.status;
  if p_assignment_scope <> v_task.assignment_scope
     or p_assignee_id is distinct from v_task.assignee_id then
    if v_task.status not in ('new', 'assigned') then
      raise exception 'assignment_change_not_allowed_for_status: %', v_task.status
        using errcode = '22023';
    end if;
    if p_assignment_scope <> 'user'::public.task_assignment_scope then
      v_new_status := 'new'::public.task_status;
    elsif p_assignee_id is null then
      v_new_status := 'new'::public.task_status;
    else
      v_new_status := 'assigned'::public.task_status;
    end if;
  end if;

  update public.tasks set
    title = btrim(p_title),
    description = nullif(btrim(coalesce(p_description, '')), ''),
    priority = p_priority,
    due_at = p_due_at,
    assignee_id = p_assignee_id,
    chat_id = p_chat_id,
    visibility = p_visibility,
    assignment_scope = p_assignment_scope,
    status = v_new_status,
    updated_at = now()
  where id = p_task_id;

  insert into public.task_events (task_id, actor_id, kind, payload)
  values (
    p_task_id,
    v_caller,
    'update',
    jsonb_build_object(
      'title', p_title,
      'priority', p_priority::text,
      'due_at', p_due_at,
      'assignee_id', p_assignee_id,
      'chat_id', p_chat_id,
      'visibility', p_visibility::text,
      'assignment_scope', p_assignment_scope::text,
      'status', v_new_status::text
    )
  );
end $$;

revoke all on function public.task_update_v2(
  uuid, text, text, public.task_priority, timestamptz, uuid, uuid,
  public.task_visibility, public.task_assignment_scope
) from public, anon;
grant execute on function public.task_update_v2(
  uuid, text, text, public.task_priority, timestamptz, uuid, uuid,
  public.task_visibility, public.task_assignment_scope
) to authenticated;

create or replace function public.task_claim(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_task public.tasks%rowtype;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if public.is_banned(v_caller) then
    raise exception 'banned' using errcode = '42501';
  end if;
  if not public.is_manager_or_admin(v_caller) then
    raise exception 'only_staff_can_claim_pool_tasks' using errcode = '42501';
  end if;

  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'task_not_found' using errcode = 'P0002';
  end if;
  if v_task.status <> 'new'::public.task_status then
    raise exception 'only_new_pool_tasks_can_be_claimed' using errcode = '22023';
  end if;
  if v_task.assignee_id is not null
     or v_task.assignment_scope = 'user'::public.task_assignment_scope then
    raise exception 'task_is_not_pool_assigned' using errcode = '22023';
  end if;

  update public.tasks
     set assignee_id = v_caller,
         assignment_scope = 'user'::public.task_assignment_scope,
         status = 'accepted'::public.task_status,
         updated_at = now()
   where id = p_task_id;

  perform public.task_append_event(
    p_task_id,
    'accept',
    jsonb_build_object(
      'previous_assignment_scope', v_task.assignment_scope::text,
      'assignee_id', v_caller
    )
  );
end $$;

revoke all on function public.task_claim(uuid) from public, anon;
grant execute on function public.task_claim(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Re-tighten task_comment so comments follow the new visibility model
-- ---------------------------------------------------------------------
create or replace function public.task_comment(
  p_task_id uuid,
  p_text text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_task public.tasks%rowtype;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if public.is_banned(v_caller) then
    raise exception 'banned' using errcode = '42501';
  end if;
  if p_text is null or length(btrim(p_text)) = 0 then
    raise exception 'comment_required' using errcode = '22023';
  end if;

  select * into v_task from public.tasks where id = p_task_id;
  if not found then
    raise exception 'task_not_found' using errcode = 'P0002';
  end if;
  if not public._task_visible_to_current_user(
    v_task.assignee_id,
    v_task.created_by,
    v_task.chat_id,
    v_task.visibility,
    v_task.assignment_scope
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform public.task_append_event(
    p_task_id,
    'comment',
    jsonb_build_object('text', btrim(p_text))
  );
end $$;

revoke all on function public.task_comment(uuid, text) from public, anon;
grant execute on function public.task_comment(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 7. Verify SQL
-- ---------------------------------------------------------------------
-- Run after applying:
--
-- select column_name, udt_name, column_default
-- from information_schema.columns
-- where table_schema = 'public'
--   and table_name = 'tasks'
--   and column_name in ('visibility', 'assignment_scope')
-- order by column_name;
--
-- select t.typname as enum_name, array_agg(e.enumlabel order by e.enumsortorder) as values
-- from pg_type t
-- join pg_namespace n on n.oid = t.typnamespace
-- join pg_enum e on e.enumtypid = t.oid
-- where n.nspname = 'public'
--   and t.typname in ('task_visibility', 'task_assignment_scope')
-- group by t.typname
-- order by t.typname;
--
-- select policyname, cmd, roles, qual, with_check
-- from pg_policies
-- where schemaname = 'public'
--   and tablename in ('tasks', 'task_events')
-- order by tablename, policyname;
--
-- select proname, pg_get_function_arguments(oid)
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and proname in ('task_create_v2', 'task_update_v2', 'task_claim');

-- ---------------------------------------------------------------------
-- 8. Manual QA
-- ---------------------------------------------------------------------
-- 1. Admin creates staff task with no assignee: admin/manager sees it,
--    ordinary user does not.
-- 2. Admin creates private task assigned to a user: creator, assignee,
--    admin see it; unrelated manager/user does not.
-- 3. Admin creates chat task linked to a chat: linked chat members see it;
--    users outside the chat do not.
-- 4. Admin creates staff_pool and manager_pool tasks: admin/manager sees
--    pool queue; ordinary user does not.
-- 5. Manager claims pool task: task becomes accepted and assigned to them.
-- 6. Manager cannot assign a task to an admin; admin can assign anyone.
-- 7. Old task_create/task_update still work until frontend is switched.
