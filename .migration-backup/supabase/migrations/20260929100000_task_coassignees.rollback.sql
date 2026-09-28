-- Rollback of 20260929100000_task_coassignees.sql. Revert the web client first
-- (it reads the table and calls the function). Dropping the table forgets who
-- was a co-executor of what; read it first:
--   select task_id, user_id from public.task_coassignees;
-- The six functions and three policies go back to production's text as it was.
begin;

drop trigger if exists trg_notify_task_coassignees_after_update on public.tasks;
drop trigger if exists trg_task_assignee_leaves_coassignees on public.tasks;
drop function if exists public._notify_task_coassignees_after_update();
drop function if exists public._task_assignee_leaves_coassignees();
drop function if exists public.task_set_coassignees(uuid, uuid[]);

alter policy "tasks select scoped" on public.tasks using (((deleted_at IS NULL) OR _task_deleted_visible_to_current_user()) AND _task_visible_to_current_user_v3(assignee_id, created_by, chat_id, visibility, assignment_scope, location_id, target_role, route_admin_id, created_for_admin));
alter policy "task_events select scoped" on public.task_events using (EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_events.task_id AND ((t.deleted_at IS NULL) OR _task_deleted_visible_to_current_user()) AND _task_visible_to_current_user_v3(t.assignee_id, t.created_by, t.chat_id, t.visibility, t.assignment_scope, t.location_id, t.target_role, t.route_admin_id, t.created_for_admin)));
alter policy "task_checklist_items select scoped" on public.task_checklist_items using (EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_checklist_items.task_id AND ((t.deleted_at IS NULL) OR _task_deleted_visible_to_current_user()) AND _task_visible_to_current_user_v3(t.assignee_id, t.created_by, t.chat_id, t.visibility, t.assignment_scope, t.location_id, t.target_role, t.route_admin_id, t.created_for_admin)));

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

  if p_assignee_only and cur.assignee_id <> caller then
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
  if cur.assignee_id = caller then
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
  if cur.assignee_id = caller then
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
     or (p_ticking and v_caller is not distinct from p_task.assignee_id) then
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
       or public.is_manager_or_admin(p_user)
       or (p_task.location_id is not null and public.is_location_admin(p_task.location_id, p_user))
     );
end $function$;

drop table if exists public.task_coassignees;
drop function if exists public._task_coassigned_to_me(uuid);

do $$
begin
  if to_regclass('public.task_coassignees') is not null
     or position('_task_coassigned_to_me' in (select pg_get_expr(polqual, polrelid) from pg_policy where polrelid = 'public.tasks'::regclass and polname = 'tasks select scoped')) > 0 then
    raise exception 'task_coassignees_rollback_incomplete';
  end if;
end;
$$;

commit;
