-- Task soft delete for owner / tech_admin cleanup.
--
-- Proposal only. Do not apply automatically from Codex.
--
-- Goals:
-- - hide removed tasks from normal lists without hard-deleting task history;
-- - keep task_events, audit_logs, notifications and recurrence history intact;
-- - allow only owner / tech_admin / explicit task-delete permissions;
-- - keep staff/client/location_staff from deleting tasks by default;
-- - prevent active recurring templates from being deleted accidentally.

begin;

-- ---------------------------------------------------------------------
-- 1. Soft-delete columns and task-event kinds.
-- ---------------------------------------------------------------------
alter table public.tasks
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id) on delete set null,
  add column if not exists delete_reason text;

create index if not exists idx_tasks_deleted_at on public.tasks(deleted_at);
create index if not exists idx_tasks_deleted_by on public.tasks(deleted_by);

alter table public.task_events drop constraint if exists task_events_kind_check;
alter table public.task_events
  add constraint task_events_kind_check
  check (kind in (
    'create','assign','accept','start','send_for_confirmation',
    'confirm','reject','cancel','comment','update','return_to_work',
    'soft_delete','restore'
  ));

-- ---------------------------------------------------------------------
-- 2. Dynamic permissions. Owner and tech_admin still have all access via
--    has_permission, but seeding explicit rows makes the roles UI readable.
-- ---------------------------------------------------------------------
insert into public.permissions (key, name, description, category)
values
  ('tasks.delete', 'Удаление задач', 'Скрывать ненужные задачи из обычных списков без потери истории.', 'tasks'),
  ('tasks.restore', 'Восстановление задач', 'Возвращать ошибочно удалённые задачи в рабочие списки.', 'tasks'),
  ('tasks.bulk_delete', 'Массовое удаление задач', 'Удалять несколько задач за одно действие.', 'tasks')
on conflict (key) do update
  set name = excluded.name,
      description = excluded.description,
      category = excluded.category;

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
  from public.roles r
 cross join public.permissions p
 where r.key in ('owner', 'tech_admin')
   and p.key in ('tasks.delete', 'tasks.restore', 'tasks.bulk_delete')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 3. Visibility helper. Deleted tasks are visible only to global cleanup
--    roles/permissions; regular staff/client users cannot discover them.
-- ---------------------------------------------------------------------
create or replace function public._task_deleted_visible_to_current_user()
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

  return public.has_permission(v_caller, 'system.manage')
      or public.has_permission(v_caller, 'tasks.manage_all_locations')
      or public.has_permission(v_caller, 'tasks.restore');
end
$$;

revoke all on function public._task_deleted_visible_to_current_user() from public, anon;
grant execute on function public._task_deleted_visible_to_current_user() to authenticated;

drop policy if exists "tasks select" on public.tasks;
drop policy if exists "tasks select for participants" on public.tasks;
drop policy if exists "tasks select with visibility" on public.tasks;
drop policy if exists "tasks select scoped" on public.tasks;
create policy "tasks select scoped"
  on public.tasks for select
  to authenticated
  using (
    (deleted_at is null or public._task_deleted_visible_to_current_user())
    and public._task_visible_to_current_user_v3(
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
         and (t.deleted_at is null or public._task_deleted_visible_to_current_user())
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

-- ---------------------------------------------------------------------
-- 4. Server-side permission helpers and RPCs.
-- ---------------------------------------------------------------------
create or replace function public._task_can_soft_delete(p_task public.tasks)
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
     or public.has_permission(v_caller, 'tasks.manage_all_locations')
     or public.has_permission(v_caller, 'tasks.delete') then
    return true;
  end if;

  -- Location admins/staff do not get deletion by default. This only works
  -- when a custom location role is explicitly granted tasks.delete.
  return p_task.location_id is not null
     and public.has_location_permission(v_caller, p_task.location_id, 'tasks.delete');
end
$$;

create or replace function public._task_can_restore(p_task public.tasks)
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
     or public.has_permission(v_caller, 'tasks.manage_all_locations')
     or public.has_permission(v_caller, 'tasks.restore') then
    return true;
  end if;

  return p_task.location_id is not null
     and public.has_location_permission(v_caller, p_task.location_id, 'tasks.restore');
end
$$;

revoke all on function public._task_can_soft_delete(public.tasks) from public, anon;
revoke all on function public._task_can_restore(public.tasks) from public, anon;
grant execute on function public._task_can_soft_delete(public.tasks) to authenticated;
grant execute on function public._task_can_restore(public.tasks) to authenticated;

create or replace function public.task_soft_delete(
  p_task_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.tasks%rowtype;
  v_rec public.task_recurrences%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into v_task
    from public.tasks
   where id = p_task_id
   for update;

  if not found then
    raise exception 'task_not_found' using errcode = 'P0002';
  end if;

  if v_task.deleted_at is not null then
    raise exception 'task_already_deleted' using errcode = 'P0001';
  end if;

  if not public._task_can_soft_delete(v_task) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_task.recurrence_id is not null
     and v_task.recurrence_template_task_id is null then
    select * into v_rec
      from public.task_recurrences
     where id = v_task.recurrence_id
     for update;

    if found and v_rec.stopped_at is null then
      raise exception 'active_recurrence_template_delete_blocked' using errcode = 'P0001';
    end if;
  end if;

  update public.tasks
     set deleted_at = now(),
         deleted_by = auth.uid(),
         delete_reason = v_reason,
         updated_at = now()
   where id = p_task_id;

  perform public.task_append_event(
    p_task_id,
    'soft_delete',
    jsonb_build_object('reason', v_reason)
  );

  if to_regprocedure('public._audit(text,text,uuid,jsonb)') is not null then
    perform public._audit(
      'task.delete',
      'task',
      p_task_id,
      jsonb_build_object(
        'reason', v_reason,
        'title', v_task.title,
        'status', v_task.status::text,
        'location_id', v_task.location_id,
        'assignee_id', v_task.assignee_id,
        'recurrence_id', v_task.recurrence_id,
        'recurrence_template_task_id', v_task.recurrence_template_task_id
      )
    );
  end if;
end
$$;

create or replace function public.task_restore(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.tasks%rowtype;
begin
  select * into v_task
    from public.tasks
   where id = p_task_id
   for update;

  if not found then
    raise exception 'task_not_found' using errcode = 'P0002';
  end if;

  if not public._task_can_restore(v_task) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_task.deleted_at is null then
    return;
  end if;

  update public.tasks
     set deleted_at = null,
         deleted_by = null,
         delete_reason = null,
         updated_at = now()
   where id = p_task_id;

  perform public.task_append_event(
    p_task_id,
    'restore',
    jsonb_build_object('deleted_at', v_task.deleted_at, 'reason', v_task.delete_reason)
  );

  if to_regprocedure('public._audit(text,text,uuid,jsonb)') is not null then
    perform public._audit(
      'task.restore',
      'task',
      p_task_id,
      jsonb_build_object(
        'title', v_task.title,
        'deleted_at', v_task.deleted_at,
        'deleted_by', v_task.deleted_by,
        'reason', v_task.delete_reason
      )
    );
  end if;
end
$$;

create or replace function public.task_bulk_soft_delete(
  p_task_ids uuid[],
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task_id uuid;
  v_deleted uuid[] := array[]::uuid[];
  v_failed jsonb := '[]'::jsonb;
begin
  if p_task_ids is null or array_length(p_task_ids, 1) is null then
    return jsonb_build_object(
      'deleted_count', 0,
      'failed_count', 0,
      'deleted_ids', '[]'::jsonb,
      'failed', '[]'::jsonb
    );
  end if;

  foreach v_task_id in array p_task_ids loop
    begin
      perform public.task_soft_delete(v_task_id, p_reason);
      v_deleted := array_append(v_deleted, v_task_id);
    exception when others then
      v_failed := v_failed || jsonb_build_array(jsonb_build_object(
        'task_id', v_task_id,
        'code', sqlstate,
        'message', sqlerrm
      ));
    end;
  end loop;

  return jsonb_build_object(
    'deleted_count', cardinality(v_deleted),
    'failed_count', jsonb_array_length(v_failed),
    'deleted_ids', to_jsonb(v_deleted),
    'failed', v_failed
  );
end
$$;

revoke all on function public.task_soft_delete(uuid, text) from public, anon;
revoke all on function public.task_restore(uuid) from public, anon;
revoke all on function public.task_bulk_soft_delete(uuid[], text) from public, anon;
grant execute on function public.task_soft_delete(uuid, text) to authenticated;
grant execute on function public.task_restore(uuid) to authenticated;
grant execute on function public.task_bulk_soft_delete(uuid[], text) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Recurrence generator: deleted templates never create occurrences.
-- ---------------------------------------------------------------------
create or replace function public.task_recurrence_run_due(p_limit int default 50)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_rec public.task_recurrences%rowtype;
  v_template public.tasks%rowtype;
  v_task_id uuid;
  v_status public.task_status;
  v_scheduled_for timestamptz;
  v_next_run_at timestamptz;
  v_created int := 0;
  v_inserted boolean;
begin
  if v_caller is not null
     and not public.has_permission(v_caller, 'tasks.manage_all_locations')
     and not public.has_permission(v_caller, 'system.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  for v_rec in
    select *
      from public.task_recurrences
     where stopped_at is null
       and paused_at is null
       and next_run_at is not null
       and next_run_at <= now()
       and (end_at is null or next_run_at <= end_at)
       and (max_occurrences is null or occurrences_created < max_occurrences)
     order by next_run_at asc
     limit greatest(1, least(coalesce(p_limit, 50), 500))
     for update skip locked
  loop
    select * into v_template
      from public.tasks
     where id = v_rec.template_task_id
       and deleted_at is null;

    if not found then
      update public.task_recurrences
         set stopped_at = coalesce(stopped_at, now()),
             next_run_at = null
       where id = v_rec.id;
      insert into public.task_recurrence_events (recurrence_id, actor_id, kind, payload)
      values (v_rec.id, v_caller, 'failed', jsonb_build_object('reason', 'template_missing_or_deleted'));
      continue;
    end if;

    v_scheduled_for := v_rec.next_run_at;
    v_status := case
      when v_template.assignment_scope <> 'user'::public.task_assignment_scope then 'new'::public.task_status
      when v_template.assignee_id is null then 'new'::public.task_status
      else 'assigned'::public.task_status
    end;

    v_task_id := null;
    v_inserted := false;

    insert into public.tasks (
      title, description, priority, status, created_by,
      assignee_id, chat_id, due_at, visibility, assignment_scope,
      location_id, target_role, route_admin_id, created_for_admin,
      recurrence_id, recurrence_template_task_id, recurrence_scheduled_for
    )
    select
      v_template.title,
      v_template.description,
      v_template.priority,
      v_status,
      v_template.created_by,
      v_template.assignee_id,
      v_template.chat_id,
      v_scheduled_for,
      v_template.visibility,
      v_template.assignment_scope,
      v_template.location_id,
      v_template.target_role,
      v_template.route_admin_id,
      v_template.created_for_admin,
      v_rec.id,
      v_template.id,
      v_scheduled_for
    where not exists (
      select 1
        from public.tasks t
       where t.recurrence_id = v_rec.id
         and t.recurrence_scheduled_for = v_scheduled_for
    )
    returning id into v_task_id;

    if v_task_id is not null then
      v_inserted := true;
      v_created := v_created + 1;
      perform public.task_append_event(
        v_task_id,
        'create',
        jsonb_build_object(
          'recurrence_id', v_rec.id,
          'template_task_id', v_template.id,
          'scheduled_for', v_scheduled_for
        )
      );
      insert into public.task_recurrence_events (recurrence_id, task_id, actor_id, kind, payload)
      values (
        v_rec.id,
        v_task_id,
        v_caller,
        'created_occurrence',
        jsonb_build_object('scheduled_for', v_scheduled_for)
      );
    else
      select t.id into v_task_id
        from public.tasks t
       where t.recurrence_id = v_rec.id
         and t.recurrence_scheduled_for = v_scheduled_for
       limit 1;
    end if;

    v_next_run_at := public._task_recurrence_next_run_after(
      v_rec.frequency,
      v_rec.interval_count,
      v_rec.by_weekday,
      v_rec.by_monthday,
      v_scheduled_for,
      v_rec.starts_at
    );
    if v_rec.end_at is not null and v_next_run_at is not null and v_next_run_at > v_rec.end_at then
      v_next_run_at := null;
    end if;
    if v_rec.max_occurrences is not null
       and (v_rec.occurrences_created + case when v_inserted then 1 else 0 end) >= v_rec.max_occurrences then
      v_next_run_at := null;
    end if;

    update public.task_recurrences
       set last_run_at = v_scheduled_for,
           next_run_at = v_next_run_at,
           occurrences_created = occurrences_created + case when v_inserted then 1 else 0 end,
           stopped_at = case when v_next_run_at is null then coalesce(stopped_at, now()) else stopped_at end
     where id = v_rec.id;
  end loop;

  return v_created;
end
$$;

revoke all on function public.task_recurrence_run_due(int) from public, anon;
grant execute on function public.task_recurrence_run_due(int) to authenticated;

commit;

-- Verify after manual application:
--
-- select column_name from information_schema.columns
--  where table_schema = 'public'
--    and table_name = 'tasks'
--    and column_name in ('deleted_at', 'deleted_by', 'delete_reason');
--
-- select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public'
--    and proname in ('task_soft_delete', 'task_restore', 'task_bulk_soft_delete');
--
-- select key from public.permissions
--  where key in ('tasks.delete', 'tasks.restore', 'tasks.bulk_delete')
--  order by key;
