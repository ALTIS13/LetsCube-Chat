-- Tracker item 67: a task taken by several people together. A tester,
-- 2026-09-28: «есть задачи которые два человека ведут параллельно». Approved by
-- the owner on 2026-09-28 with the rest of
-- docs/operations/2026-09-28-database-proposals.md (entry 6).
--
-- The proposal called it a project, because `assignee_id` is read by 28
-- functions and 4 policies. It is built as one person responsible and
-- co-executors beside them, rather than by turning the assignee into a set,
-- for a reason of its own: `assignee_id` keeps every meaning it has — the one
-- a reminder «Исполнителю» reaches, the one a pool claim fills, the one a
-- recurrence copies, the one the installed Android bundle reads — so none of
-- those changes, and `task_coassignees` adds the others. What the tester asked
-- for is two people doing the work, and a co-executor may do what the work
-- needs: see the task, move it along its statuses, comment, tick the
-- checklist, set reminders; and, like the assignee, not confirm or reject it.
--
-- * `_task_coassigned_to_me(task)`, SECURITY DEFINER, answers for the caller
--   only, so the policies can ask it without reaching the table's own policy
--   and nobody can probe another account.
-- * The read policies on `tasks`, `task_events` and `task_checklist_items` add
--   it beside the task's own visibility.
-- * Six functions change by the lines that name the assignee: the status
--   transitions, commenting, confirming and rejecting, ticking a checklist
--   point, and holding a reminder. `_task_transition` now also compares with
--   IS DISTINCT FROM: `<>` against a null assignee let anybody through.
-- * `task_set_coassignees(task, people)` sets the whole list, by those who may
--   edit the task, on a task assigned to a person and still open: at most 10,
--   never the assignee, nobody banned, and on a location's task only its
--   members. Each person added is told as an assignee is told; the change is
--   written to the task's history as an update.
-- * A co-executor made the assignee leaves the co-executors; a task confirmed or
--   rejected tells its co-executors as it tells its assignee.
--
-- Rollback: 20260929100000_task_coassignees.rollback.sql.
begin;

create table public.task_coassignees (
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  added_by uuid references public.profiles(id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

create index task_coassignees_user_idx on public.task_coassignees (user_id);
create index task_coassignees_added_by_idx on public.task_coassignees (added_by) where added_by is not null;

alter table public.task_coassignees enable row level security;

create function public._task_coassigned_to_me(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1 from public.task_coassignees as co
     where co.task_id = p_task_id and co.user_id = auth.uid()
  );
$$;

revoke all on function public._task_coassigned_to_me(uuid) from public, anon;
grant execute on function public._task_coassigned_to_me(uuid) to authenticated, service_role;

-- Who reads a co-executor row is who reads its task, through the task's own
-- policy; the task's policy asks the function above, not this table.
create policy "task_coassignees select scoped" on public.task_coassignees
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.tasks as t where t.id = task_coassignees.task_id)
  );

create policy "block banned reads" on public.task_coassignees
  as restrictive
  for select to authenticated
  using (not public.is_banned(auth.uid()));

revoke all on public.task_coassignees from public, anon, authenticated;
grant select on public.task_coassignees to authenticated;

alter policy "tasks select scoped" on public.tasks using (((deleted_at IS NULL) OR _task_deleted_visible_to_current_user()) AND (_task_visible_to_current_user_v3(assignee_id, created_by, chat_id, visibility, assignment_scope, location_id, target_role, route_admin_id, created_for_admin) OR _task_coassigned_to_me(id)));
alter policy "task_events select scoped" on public.task_events using (EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_events.task_id AND ((t.deleted_at IS NULL) OR _task_deleted_visible_to_current_user()) AND (_task_visible_to_current_user_v3(t.assignee_id, t.created_by, t.chat_id, t.visibility, t.assignment_scope, t.location_id, t.target_role, t.route_admin_id, t.created_for_admin) OR _task_coassigned_to_me(t.id))));
alter policy "task_checklist_items select scoped" on public.task_checklist_items using (EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_checklist_items.task_id AND ((t.deleted_at IS NULL) OR _task_deleted_visible_to_current_user()) AND (_task_visible_to_current_user_v3(t.assignee_id, t.created_by, t.chat_id, t.visibility, t.assignment_scope, t.location_id, t.target_role, t.route_admin_id, t.created_for_admin) OR _task_coassigned_to_me(t.id))));

-- The six functions, each changed only by the lines that name the assignee.
CREATE OR REPLACE FUNCTION public._task_transition(p_task_id uuid, p_kind text, p_from_statuses task_status[], p_to_status task_status, p_assignee_only boolean, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  caller uuid := auth.uid();
  cur    public.tasks%rowtype;
begin
  if caller is null then
    raise exception 'Требуется аутентификация' using errcode = '42501';
  end if;
  if public.is_banned(caller) then
    raise exception 'Пользователь заблокирован' using errcode = '42501';
  end if;

  select * into cur from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'Задача не найдена' using errcode = 'P0002';
  end if;

  if p_assignee_only
     and cur.assignee_id is distinct from caller
     and not public._task_coassigned_to_me(cur.id) then
    raise exception 'Это действие доступно только исполнителю задачи'
      using errcode = '42501';
  end if;

  if not (cur.status = any (p_from_statuses)) then
    raise exception 'Недопустимый переход из статуса %', cur.status
      using errcode = '22023';
  end if;

  update public.tasks
     set status = p_to_status
   where id = p_task_id;

  perform public.task_append_event(p_task_id, p_kind, p_payload);
end $function$;

CREATE OR REPLACE FUNCTION public.task_comment(p_task_id uuid, p_text text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if not (public._task_visible_to_current_user(
    v_task.assignee_id,
    v_task.created_by,
    v_task.chat_id,
    v_task.visibility,
    v_task.assignment_scope
  ) or public._task_coassigned_to_me(v_task.id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform public.task_append_event(
    p_task_id,
    'comment',
    jsonb_build_object('text', btrim(p_text))
  );
end $function$;

CREATE OR REPLACE FUNCTION public.task_confirm(p_task_id uuid, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  caller uuid := auth.uid();
  cur    public.tasks%rowtype;
begin
  if caller is null then
    raise exception 'Требуется аутентификация' using errcode = '42501';
  end if;
  if public.is_banned(caller) then
    raise exception 'Пользователь заблокирован' using errcode = '42501';
  end if;
  if not public.is_manager_or_admin(caller) then
    raise exception 'Подтверждать может только администратор или менеджер'
      using errcode = '42501';
  end if;

  select * into cur from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'Задача не найдена' using errcode = 'P0002';
  end if;
  if cur.status <> 'waiting_confirmation'::public.task_status then
    raise exception 'Подтверждать можно только задачу со статусом «На подтверждении»'
      using errcode = '22023';
  end if;
  if cur.assignee_id = caller or public._task_coassigned_to_me(cur.id) then
    raise exception 'Нельзя подтверждать собственную задачу'
      using errcode = '42501';
  end if;

  update public.tasks
     set status = 'confirmed'::public.task_status
   where id = p_task_id;

  perform public.task_append_event(
    p_task_id, 'confirm',
    case when p_note is null or length(btrim(p_note)) = 0
         then '{}'::jsonb
         else jsonb_build_object('note', btrim(p_note)) end
  );
end $function$;

CREATE OR REPLACE FUNCTION public.task_reject(p_task_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  caller uuid := auth.uid();
  cur    public.tasks%rowtype;
begin
  if caller is null then
    raise exception 'Требуется аутентификация' using errcode = '42501';
  end if;
  if public.is_banned(caller) then
    raise exception 'Пользователь заблокирован' using errcode = '42501';
  end if;
  if not public.is_manager_or_admin(caller) then
    raise exception 'Отклонять может только администратор или менеджер'
      using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'Укажите причину отклонения' using errcode = '22023';
  end if;

  select * into cur from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'Задача не найдена' using errcode = 'P0002';
  end if;
  if cur.status <> 'waiting_confirmation'::public.task_status then
    raise exception 'Отклонять можно только задачу со статусом «На подтверждении»'
      using errcode = '22023';
  end if;
  if cur.assignee_id = caller or public._task_coassigned_to_me(cur.id) then
    raise exception 'Нельзя отклонять собственную задачу'
      using errcode = '42501';
  end if;

  update public.tasks
     set status = 'rejected'::public.task_status
   where id = p_task_id;

  perform public.task_append_event(
    p_task_id, 'reject',
    jsonb_build_object('reason', btrim(p_reason))
  );
end $function$;

CREATE OR REPLACE FUNCTION public._task_checklist_assert_can_change(p_task tasks, p_ticking boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if public.is_banned(v_caller) then
    raise exception 'banned' using errcode = '42501';
  end if;
  if p_task.deleted_at is not null then
    raise exception 'task_not_found' using errcode = 'P0002';
  end if;
  if p_task.status in ('confirmed', 'cancelled') then
    raise exception 'task_locked: status=%', p_task.status using errcode = '22023';
  end if;
  if v_caller is not distinct from p_task.created_by
     or public.is_manager_or_admin(v_caller)
     or (p_task.location_id is not null and public.is_location_admin(p_task.location_id, v_caller))
     or (p_ticking and (v_caller is not distinct from p_task.assignee_id or public._task_coassigned_to_me(p_task.id))) then
    return;
  end if;
  raise exception 'forbidden' using errcode = '42501';
end $function$;

CREATE OR REPLACE FUNCTION public._task_reminder_may_hold(p_task tasks, p_user uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return p_user is not null
     and not public.is_banned(p_user)
     and (
       p_user is not distinct from p_task.created_by
       or p_user is not distinct from p_task.assignee_id
       or exists (select 1 from public.task_coassignees as co where co.task_id = p_task.id and co.user_id = p_user)
       or public.is_manager_or_admin(p_user)
       or (p_task.location_id is not null and public.is_location_admin(p_task.location_id, p_user))
     );
end $function$;


create function public.task_set_coassignees(p_task_id uuid, p_user_ids uuid[])
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
  v_task public.tasks%rowtype;
  v_wanted uuid[];
  v_current uuid[];
  v_added uuid[];
  v_removed uuid[];
  v_user uuid;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if public.is_banned(v_caller) then
    raise exception 'banned' using errcode = '42501';
  end if;
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found or v_task.deleted_at is not null then
    raise exception 'task_not_found' using errcode = 'P0002';
  end if;
  if v_task.status in ('confirmed', 'cancelled') then
    raise exception 'task_locked: status=%', v_task.status using errcode = '22023';
  end if;
  if not (
    v_caller is not distinct from v_task.created_by
    or public.is_manager_or_admin(v_caller)
    or (v_task.location_id is not null and public.is_location_admin(v_task.location_id, v_caller))
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_task.assignment_scope <> 'user'::public.task_assignment_scope then
    raise exception 'coassignees_need_a_person' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct wanted.id), '{}'::uuid[]) into v_wanted
    from unnest(coalesce(p_user_ids, '{}'::uuid[])) as wanted(id)
   where wanted.id is not null
     and wanted.id is distinct from v_task.assignee_id;
  if cardinality(v_wanted) > 10 then
    raise exception 'too_many_coassignees' using errcode = '22023';
  end if;
  foreach v_user in array v_wanted loop
    if not exists (select 1 from public.profiles where id = v_user) or public.is_banned(v_user) then
      raise exception 'coassignee_unavailable' using errcode = '22023';
    end if;
    if v_task.location_id is not null and not exists (
      select 1 from public.location_members as lm
       where lm.location_id = v_task.location_id and lm.user_id = v_user
    ) then
      raise exception 'Пользователь не относится к этой локации' using errcode = '42501';
    end if;
  end loop;

  select coalesce(array_agg(co.user_id), '{}'::uuid[]) into v_current
    from public.task_coassignees as co where co.task_id = p_task_id;
  v_added := array(select unnest(v_wanted) except select unnest(v_current));
  v_removed := array(select unnest(v_current) except select unnest(v_wanted));
  if cardinality(v_added) = 0 and cardinality(v_removed) = 0 then
    return;
  end if;

  delete from public.task_coassignees
   where task_id = p_task_id and user_id = any (v_removed);
  insert into public.task_coassignees (task_id, user_id, added_by)
  select p_task_id, added.id, v_caller from unnest(v_added) as added(id);

  foreach v_user in array v_added loop
    if v_user is distinct from v_caller then
      perform public._notify(
        v_user,
        'task_assigned',
        jsonb_build_object(
          'task_id', v_task.id,
          'title', v_task.title,
          'priority', v_task.priority::text,
          'actor_id', v_caller,
          'coassignee', true
        )
      );
    end if;
  end loop;

  perform public.task_append_event(
    p_task_id,
    'update',
    jsonb_build_object('coassignees', jsonb_build_object('added', to_jsonb(v_added), 'removed', to_jsonb(v_removed)))
  );
end $$;

revoke all on function public.task_set_coassignees(uuid, uuid[]) from public, anon;
grant execute on function public.task_set_coassignees(uuid, uuid[]) to authenticated, service_role;

-- A co-executor made the assignee is the assignee, not both.
create function public._task_assignee_leaves_coassignees()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.assignee_id is not null then
    delete from public.task_coassignees where task_id = new.id and user_id = new.assignee_id;
  end if;
  return null;
end $$;

create trigger trg_task_assignee_leaves_coassignees
  after update of assignee_id on public.tasks
  for each row
  when (new.assignee_id is distinct from old.assignee_id)
  execute function public._task_assignee_leaves_coassignees();

-- Confirmed or rejected: the co-executors are told as the assignee is.
create function public._notify_task_coassignees_after_update()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor uuid := auth.uid();
  v_user uuid;
begin
  if new.status is distinct from old.status and new.status in ('confirmed', 'rejected') then
    for v_user in
      select co.user_id from public.task_coassignees as co
       where co.task_id = new.id and co.user_id is distinct from v_actor
    loop
      perform public._notify(
        v_user,
        'task_' || new.status::text,
        jsonb_build_object('task_id', new.id, 'title', new.title, 'actor_id', v_actor, 'coassignee', true)
      );
    end loop;
  end if;
  return null;
end $$;

create trigger trg_notify_task_coassignees_after_update
  after update of status on public.tasks
  for each row
  execute function public._notify_task_coassignees_after_update();

revoke all on function public._task_assignee_leaves_coassignees() from public, anon, authenticated, service_role;
revoke all on function public._notify_task_coassignees_after_update() from public, anon, authenticated, service_role;

do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.task_coassignees'::regclass)
     or pg_catalog.has_table_privilege('authenticated', 'public.task_coassignees', 'INSERT')
     or pg_catalog.has_table_privilege('authenticated', 'public.task_coassignees', 'DELETE')
     or pg_catalog.has_table_privilege('anon', 'public.task_coassignees', 'SELECT')
     or pg_catalog.has_function_privilege('anon', 'public.task_set_coassignees(uuid, uuid[])', 'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated', 'public.task_set_coassignees(uuid, uuid[])', 'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated', 'public._task_coassigned_to_me(uuid)', 'EXECUTE')
     or position('_task_coassigned_to_me' in (select pg_get_expr(polqual, polrelid) from pg_policy where polrelid = 'public.tasks'::regclass and polname = 'tasks select scoped')) = 0
     or position('_task_coassigned_to_me' in (select pg_get_expr(polqual, polrelid) from pg_policy where polrelid = 'public.task_events'::regclass and polname = 'task_events select scoped')) = 0
     or position('_task_coassigned_to_me' in (select pg_get_expr(polqual, polrelid) from pg_policy where polrelid = 'public.task_checklist_items'::regclass and polname = 'task_checklist_items select scoped')) = 0
     or position('_task_coassigned_to_me' in pg_get_functiondef('public._task_transition(uuid, text, task_status[], task_status, boolean, jsonb)'::regprocedure)) = 0
  then
    raise exception 'task_coassignees_incomplete';
  end if;
end;
$$;

commit;
