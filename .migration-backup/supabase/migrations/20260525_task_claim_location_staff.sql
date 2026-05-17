-- Proposal only. Do not apply automatically from Codex.
-- Fix location staff claim for staff_pool tasks while keeping management,
-- recurring lifecycle, soft delete, and admin-only task controls separate.

begin;

insert into public.permissions (key, name, description, category)
values (
  'tasks.claim',
  'Принятие задач',
  'Взятие доступных задач из пула своей локации.',
  'tasks'
)
on conflict (key) do update
  set name = excluded.name,
      description = excluded.description,
      category = excluded.category;

with role_seed(role_key, permission_key) as (
  values
    ('owner', 'tasks.claim'),
    ('tech_admin', 'tasks.claim'),
    ('admin', 'tasks.claim'),
    ('manager', 'tasks.claim'),
    ('location_owner', 'tasks.claim'),
    ('location_admin', 'tasks.claim'),
    ('location_manager', 'tasks.claim'),
    ('location_staff', 'tasks.claim')
)
insert into public.role_permissions (role_id, permission_key)
select r.id, s.permission_key
  from role_seed s
  join public.roles r on r.key = s.role_key
on conflict do nothing;

create or replace function public.task_claim(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_task public.tasks%rowtype;
  v_has_global_claim boolean := false;
  v_has_location_claim boolean := false;
  v_can_claim_manager_pool boolean := false;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if public.is_banned(v_caller) then
    raise exception 'banned' using errcode = '42501';
  end if;

  select *
    into v_task
    from public.tasks
   where id = p_task_id
   for update;

  if not found then
    raise exception 'task_not_found' using errcode = 'P0002';
  end if;

  if v_task.deleted_at is not null then
    raise exception 'task_deleted' using errcode = '22023';
  end if;

  if coalesce(v_task.created_for_admin, false) then
    raise exception 'task_admin_only' using errcode = '42501';
  end if;

  if v_task.status <> 'new'::public.task_status then
    raise exception 'only_new_pool_tasks_can_be_claimed' using errcode = '22023';
  end if;

  if v_task.assignee_id is not null then
    raise exception 'task_already_assigned' using errcode = '22023';
  end if;

  if v_task.assignment_scope = 'user'::public.task_assignment_scope then
    raise exception 'task_is_not_pool_assigned' using errcode = '22023';
  end if;

  if not public._task_visible_to_current_user_v3(
    v_task.assignee_id,
    v_task.created_by,
    v_task.chat_id,
    v_task.visibility,
    v_task.assignment_scope,
    v_task.location_id,
    v_task.target_role,
    v_task.route_admin_id,
    v_task.created_for_admin
  ) then
    raise exception 'task_unavailable' using errcode = '42501';
  end if;

  v_has_global_claim :=
    public.has_permission(v_caller, 'system.manage')
    or public.has_permission(v_caller, 'tasks.manage_all_locations')
    or public.has_permission(v_caller, 'tasks.claim');

  if v_task.location_id is not null then
    v_has_location_claim := public.has_location_permission(v_caller, v_task.location_id, 'tasks.claim');
    v_can_claim_manager_pool :=
      v_has_global_claim
      or public.has_location_permission(v_caller, v_task.location_id, 'tasks.manage')
      or public.has_location_permission(v_caller, v_task.location_id, 'tasks.assign')
      or public.has_location_permission(v_caller, v_task.location_id, 'tasks.create');
  else
    v_can_claim_manager_pool := v_has_global_claim;
  end if;

  if v_task.assignment_scope = 'staff_pool'::public.task_assignment_scope then
    if not (v_has_global_claim or v_has_location_claim) then
      raise exception 'only_staff_can_claim_pool_tasks' using errcode = '42501';
    end if;
  elsif v_task.assignment_scope = 'manager_pool'::public.task_assignment_scope then
    if not v_can_claim_manager_pool then
      raise exception 'only_staff_can_claim_pool_tasks' using errcode = '42501';
    end if;
  else
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

commit;
