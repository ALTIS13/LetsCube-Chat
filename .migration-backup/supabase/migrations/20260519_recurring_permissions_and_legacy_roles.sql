-- Proposal only. Do not apply automatically from Codex.
-- Purpose:
--   1. Harden recurring task management so ordinary staff/client users cannot
--      pause, resume, stop, or update recurrences just because they created or
--      were assigned the template task.
--   2. Keep dynamic roles as the primary role model while preserving
--      profiles.role as an idempotent fallback/backfill source.

begin;

-- Existing task_recurrence_* RPCs call this helper before changing a
-- recurrence. The previous version also allowed a caller with tasks.manage
-- when they were creator/assignee, which is too broad for recurring schedules.
create or replace function public._task_recurrence_can_manage(p_task public.tasks)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null or public.is_banned(v_caller) then
    return false;
  end if;

  -- Owner/tech_admin are covered by has_permission('system.manage').
  -- Global all-location task managers can manage every recurrence.
  if public.has_permission(v_caller, 'system.manage')
     or public.has_permission(v_caller, 'tasks.manage_all_locations') then
    return true;
  end if;

  -- Admin-only tasks require explicit admin-task management, either global or
  -- in the task location. Plain tasks.manage is intentionally not enough.
  if coalesce(p_task.created_for_admin, false) then
    return public.has_permission(v_caller, 'tasks.manage_admin_tasks')
       or (
         p_task.location_id is not null
         and public.has_location_permission(v_caller, p_task.location_id, 'tasks.manage_admin_tasks')
       );
  end if;

  -- Location tasks are managed by users who have task management in that
  -- location. A global manager without all-location permission does not get
  -- cross-location recurrence control.
  if p_task.location_id is not null then
    return public.has_location_permission(v_caller, p_task.location_id, 'tasks.manage');
  end if;

  -- Global/no-location recurrences still require global task management.
  return public.has_permission(v_caller, 'tasks.manage');
end
$$;

-- Idempotent dynamic-role backfill from legacy profiles.role. This does not
-- remove profiles.role; it only ensures old accounts are represented in the
-- dynamic model.
insert into public.user_global_roles (user_id, role_id, assigned_by)
select p.id, r.id, null
  from public.profiles p
  join public.roles r
    on r.scope = 'global'
   and r.key = case p.role
     when 'admin' then 'admin'
     when 'manager' then 'manager'
     else 'user'
   end
 where not exists (
   select 1
     from public.user_global_roles existing
    where existing.user_id = p.id
      and existing.role_id = r.id
 );

-- Idempotent location role_id backfill from legacy location_members.role.
update public.location_members lm
   set role_id = r.id,
       updated_at = now()
  from public.roles r
 where lm.role_id is null
   and r.scope = 'location'
   and r.key = case lm.role
     when 'owner' then 'location_owner'
     when 'admin' then 'location_admin'
     when 'manager' then 'location_manager'
     else 'location_staff'
   end;

commit;
