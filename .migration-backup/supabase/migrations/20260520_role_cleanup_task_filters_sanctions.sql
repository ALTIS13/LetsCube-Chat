-- Proposal only. Do not apply automatically from Codex.
-- Purpose:
--   1. Make dynamic roles/permissions the primary authorization model.
--   2. Keep profiles.role only as an idempotent fallback/backfill source.
--   3. Stop treating global user/client as task staff.
--   4. Let location_staff see only allowed tasks in their own location without
--      any global elevated role.
--   5. Delete unused custom roles and archive used custom roles.
--   6. Enrich new ban/mute audit entries with target and sanction details.

begin;

-- ---------------------------------------------------------------------
-- 1. Baseline permissions: global user/client is chat/profile baseline,
--    not a task worker role. Location staff gets view-only task access
--    scoped by location membership.
-- ---------------------------------------------------------------------
delete from public.role_permissions rp
using public.roles r
where rp.role_id = r.id
  and r.scope = 'global'
  and r.key = 'user'
  and rp.permission_key like 'tasks.%';

insert into public.role_permissions (role_id, permission_key)
select r.id, p.permission_key
  from public.roles r
 cross join (values
   ('locations.view'),
   ('tasks.view')
 ) as p(permission_key)
 where r.scope = 'location'
   and r.key = 'location_staff'
on conflict do nothing;

delete from public.role_permissions rp
using public.roles r
where rp.role_id = r.id
  and r.scope = 'location'
  and r.key = 'location_staff'
  and rp.permission_key in (
    'tasks.create',
    'tasks.assign',
    'tasks.manage',
    'tasks.view_admin_tasks',
    'tasks.manage_admin_tasks',
    'tasks.view_all_locations',
    'tasks.manage_all_locations'
  );

-- ---------------------------------------------------------------------
-- 2. Idempotent backfill from legacy profiles.role and location_members.role.
-- ---------------------------------------------------------------------
insert into public.user_global_roles (user_id, role_id, assigned_by)
select p.id, r.id, null
  from public.profiles p
  join public.roles r
    on r.scope = 'global'
   and r.key = 'admin'
 where p.role = 'admin'::public.app_role
   and not exists (
     select 1
       from public.user_global_roles ugr
       join public.roles existing on existing.id = ugr.role_id
      where ugr.user_id = p.id
        and existing.scope = 'global'
        and existing.key in ('owner', 'tech_admin', 'admin')
   )
on conflict do nothing;

insert into public.user_global_roles (user_id, role_id, assigned_by)
select p.id, r.id, null
  from public.profiles p
  join public.roles r
    on r.scope = 'global'
   and r.key = 'manager'
 where p.role = 'manager'::public.app_role
   and not exists (
     select 1
       from public.user_global_roles ugr
       join public.roles existing on existing.id = ugr.role_id
      where ugr.user_id = p.id
        and existing.scope = 'global'
        and existing.key in ('owner', 'tech_admin', 'admin', 'manager')
   )
on conflict do nothing;

insert into public.user_global_roles (user_id, role_id, assigned_by)
select p.id, r.id, null
  from public.profiles p
  join public.roles r
    on r.scope = 'global'
   and r.key = 'user'
 where p.role = 'user'::public.app_role
   and not exists (
     select 1
       from public.user_global_roles ugr
      where ugr.user_id = p.id
        and ugr.role_id = r.id
   )
on conflict do nothing;

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
     when 'client' then 'location_client'
     else 'location_staff'
   end;

-- ---------------------------------------------------------------------
-- 3. Permission helpers. Legacy normal user no longer grants task access.
-- ---------------------------------------------------------------------
create or replace function public._legacy_role_has_permission(
  p_role public.app_role,
  p_permission_key text
)
returns boolean
language sql
stable
set search_path = public
as $$
  select case
    when p_role = 'admin'::public.app_role then p_permission_key in (
      'roles.view',
      'users.view', 'users.manage', 'users.assign_roles',
      'locations.view', 'locations.manage',
      'location_members.view', 'location_members.manage',
      'tasks.view', 'tasks.create', 'tasks.assign', 'tasks.manage',
      'tasks.view_admin_tasks', 'tasks.manage_admin_tasks',
      'tasks.view_all_locations', 'tasks.manage_all_locations',
      'chats.invite', 'chats.invite_any', 'chats.manage_invites',
      'chats.moderate', 'chats.manage_roles',
      'audit.view',
      'folders.manage_shared'
    )
    when p_role = 'manager'::public.app_role then p_permission_key in (
      'users.view',
      'locations.view', 'location_members.view',
      'tasks.view', 'tasks.create', 'tasks.assign', 'tasks.manage',
      'chats.invite'
    )
    else p_permission_key in ('chats.invite')
  end
$$;

create or replace function public.has_location_role(
  p_user_id uuid,
  p_location_id uuid,
  p_role_key text
)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(exists (
    select 1
      from public.location_members lm
      left join public.roles assigned on assigned.id = lm.role_id
     where lm.user_id = p_user_id
       and lm.location_id = p_location_id
       and coalesce(
         assigned.key,
         case lm.role
           when 'owner' then 'location_owner'
           when 'admin' then 'location_admin'
           when 'manager' then 'location_manager'
           when 'client' then 'location_client'
           else 'location_staff'
         end
       ) = p_role_key
  ), false)
$$;

create or replace function public.has_location_permission(
  p_user_id uuid,
  p_location_id uuid,
  p_permission_key text
)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(public.has_permission(p_user_id, p_permission_key), false)
      or coalesce(exists (
        select 1
          from public.location_members lm
          left join public.roles assigned
            on assigned.id = lm.role_id
           and assigned.scope = 'location'
          join public.roles effective
            on effective.scope = 'location'
           and effective.is_active
           and effective.key = coalesce(
             assigned.key,
             case lm.role
               when 'owner' then 'location_owner'
               when 'admin' then 'location_admin'
               when 'manager' then 'location_manager'
               when 'client' then 'location_client'
               else 'location_staff'
             end
           )
          join public.role_permissions rp
            on rp.role_id = effective.id
           and rp.permission_key = p_permission_key
         where lm.user_id = p_user_id
           and lm.location_id = p_location_id
      ), false)
$$;

revoke all on function public._legacy_role_has_permission(public.app_role, text) from public, anon, authenticated;
revoke all on function public.has_location_role(uuid, uuid, text) from public, anon;
revoke all on function public.has_location_permission(uuid, uuid, text) from public, anon;
grant execute on function public.has_location_role(uuid, uuid, text) to authenticated;
grant execute on function public.has_location_permission(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Location-aware task visibility. Location staff can view staff-visible
--    tasks in their own location; clients do not get task visibility unless
--    assigned personally or included by chat visibility.
-- ---------------------------------------------------------------------
create or replace function public._task_visible_to_current_user_v3(
  p_assignee_id uuid,
  p_created_by uuid,
  p_chat_id uuid,
  p_visibility public.task_visibility,
  p_assignment_scope public.task_assignment_scope,
  p_location_id uuid,
  p_target_role text,
  p_route_admin_id uuid,
  p_created_for_admin boolean
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
  if v_caller is null or public.is_banned(v_caller) then
    return false;
  end if;

  if public.has_permission(v_caller, 'tasks.view_all_locations') then
    return true;
  end if;

  if p_created_by = v_caller or p_assignee_id = v_caller then
    return true;
  end if;

  if coalesce(p_created_for_admin, false) then
    if p_route_admin_id = v_caller then
      return true;
    end if;
    if p_location_id is not null then
      return public.has_location_permission(v_caller, p_location_id, 'tasks.view_admin_tasks');
    end if;
    return public.has_permission(v_caller, 'tasks.view_admin_tasks');
  end if;

  if p_visibility = 'chat'::public.task_visibility
     and p_chat_id is not null
     and public.is_chat_member(p_chat_id) then
    return true;
  end if;

  if p_location_id is null then
    return public.has_permission(v_caller, 'tasks.manage')
        or (
          public.has_permission(v_caller, 'tasks.view')
          and p_visibility <> 'private'::public.task_visibility
        );
  end if;

  if public.has_location_permission(v_caller, p_location_id, 'tasks.manage') then
    return true;
  end if;

  if not public.has_location_permission(v_caller, p_location_id, 'tasks.view') then
    return false;
  end if;

  if p_visibility = 'private'::public.task_visibility then
    return false;
  end if;

  if p_assignment_scope = 'manager_pool'::public.task_assignment_scope
     or p_target_role in ('admin', 'manager', 'owner') then
    return public.has_location_permission(v_caller, p_location_id, 'tasks.assign')
        or public.has_location_permission(v_caller, p_location_id, 'tasks.create');
  end if;

  return p_assignment_scope = 'staff_pool'::public.task_assignment_scope
      or p_target_role is null
      or p_target_role = 'staff'
      or p_visibility = 'staff'::public.task_visibility;
end $$;

revoke all on function public._task_visible_to_current_user_v3(
  uuid, uuid, uuid, public.task_visibility, public.task_assignment_scope,
  uuid, text, uuid, boolean
) from public, anon;
grant execute on function public._task_visible_to_current_user_v3(
  uuid, uuid, uuid, public.task_visibility, public.task_assignment_scope,
  uuid, text, uuid, boolean
) to authenticated;

drop policy if exists "tasks select" on public.tasks;
drop policy if exists "tasks select for participants" on public.tasks;
drop policy if exists "tasks select with visibility" on public.tasks;
drop policy if exists "tasks select scoped" on public.tasks;
create policy "tasks select scoped"
  on public.tasks for select
  to authenticated
  using (
    public._task_visible_to_current_user_v3(
      assignee_id,
      created_by,
      chat_id,
      visibility,
      assignment_scope,
      location_id,
      target_role,
      route_admin_id,
      created_for_admin
    )
  );

drop policy if exists "task_events select" on public.task_events;
drop policy if exists "task_events select for participants" on public.task_events;
drop policy if exists "task_events select with visibility" on public.task_events;
drop policy if exists "task_events select scoped" on public.task_events;
create policy "task_events select scoped"
  on public.task_events for select
  to authenticated
  using (
    exists (
      select 1
        from public.tasks t
       where t.id = task_events.task_id
         and public._task_visible_to_current_user_v3(
           t.assignee_id,
           t.created_by,
           t.chat_id,
           t.visibility,
           t.assignment_scope,
           t.location_id,
           t.target_role,
           t.route_admin_id,
           t.created_for_admin
         )
    )
  );

-- Recurring management mirrors the hardened 20260519 helper and is repeated
-- here so this proposal remains self-contained for environments that have not
-- yet applied that patch.
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

  if public.has_permission(v_caller, 'system.manage')
     or public.has_permission(v_caller, 'tasks.manage_all_locations') then
    return true;
  end if;

  if coalesce(p_task.created_for_admin, false) then
    return public.has_permission(v_caller, 'tasks.manage_admin_tasks')
       or (
         p_task.location_id is not null
         and public.has_location_permission(v_caller, p_task.location_id, 'tasks.manage_admin_tasks')
       );
  end if;

  if p_task.location_id is not null then
    return public.has_location_permission(v_caller, p_task.location_id, 'tasks.manage');
  end if;

  return public.has_permission(v_caller, 'tasks.manage');
end
$$;

revoke all on function public._task_recurrence_can_manage(public.tasks) from public, anon;
grant execute on function public._task_recurrence_can_manage(public.tasks) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Role deletion/archive. Unused custom roles are deleted; used custom
--    roles are archived. System roles remain protected.
-- ---------------------------------------------------------------------
create or replace function public.role_delete_or_archive(p_role_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.roles%rowtype;
  v_usage_count integer := 0;
begin
  perform public._require_permission('roles.manage');

  select * into v_role from public.roles where id = p_role_id for update;
  if not found then
    raise exception 'role_not_found' using errcode = 'P0002';
  end if;
  if v_role.is_system then
    raise exception 'system_role_protected' using errcode = '42501';
  end if;

  select
    (select count(*) from public.user_global_roles where role_id = p_role_id)
    + (select count(*) from public.location_members where role_id = p_role_id)
    into v_usage_count;

  if v_usage_count = 0 then
    delete from public.roles where id = p_role_id;
    insert into public.audit_logs (actor_id, action, target_kind, target_id, diff)
    values (
      auth.uid(),
      'role_deleted',
      'role',
      p_role_id,
      jsonb_build_object('role_key', v_role.key, 'name', v_role.name, 'scope', v_role.scope)
    );
  else
    update public.roles
       set is_active = false,
           updated_at = now()
     where id = p_role_id;
    insert into public.audit_logs (actor_id, action, target_kind, target_id, diff)
    values (
      auth.uid(),
      'role_archived',
      'role',
      p_role_id,
      jsonb_build_object(
        'role_key', v_role.key,
        'name', v_role.name,
        'scope', v_role.scope,
        'usage_count', v_usage_count
      )
    );
  end if;
end $$;

revoke all on function public.role_delete_or_archive(uuid) from public, anon;
grant execute on function public.role_delete_or_archive(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Audit/read policy and richer new sanction payloads.
-- ---------------------------------------------------------------------
drop policy if exists "admins read audit_logs" on public.audit_logs;
drop policy if exists "audit_logs select by permission" on public.audit_logs;
create policy "audit_logs select by permission"
  on public.audit_logs for select
  to authenticated
  using (public.has_permission(auth.uid(), 'audit.view'));

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
      'ban_id',         new.id,
      'target_user_id', new.user_id,
      'reason',         new.reason,
      'expires_at',     new.expires_at,
      'status',         case when new.expires_at is not null and new.expires_at <= now() then 'expired' else 'active' end
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
      'ban_id',         old.id,
      'target_user_id', old.user_id,
      'reason',         old.reason,
      'expires_at',     old.expires_at,
      'status',         'lifted'
    )
  );
  return null;
end $$;

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
      'mute_id',        new.id,
      'target_user_id', new.user_id,
      'chat_id',        new.chat_id,
      'reason',         new.reason,
      'expires_at',     new.expires_at,
      'status',         case when new.expires_at is not null and new.expires_at <= now() then 'expired' else 'active' end
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
      'mute_id',        old.id,
      'target_user_id', old.user_id,
      'chat_id',        old.chat_id,
      'reason',         old.reason,
      'expires_at',     old.expires_at,
      'status',         'lifted'
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

drop trigger if exists trg_audit_mutes_insert on public.mutes;
create trigger trg_audit_mutes_insert
  after insert on public.mutes
  for each row execute function public._audit_mutes_after_insert();

drop trigger if exists trg_audit_mutes_delete on public.mutes;
create trigger trg_audit_mutes_delete
  after delete on public.mutes
  for each row execute function public._audit_mutes_after_delete();

commit;
