-- Unified review authority for task_confirm, task_reject and the visible actions.
-- Rollback: 20261105151615_task_owner_self_review.rollback.sql.
-- Before-state schema backup and exact original function definitions are required.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

insert into public.permissions(key, name, description, category)
values ('tasks.review_own', 'Проверка собственных задач',
        'Подтверждение и отклонение задач, в которых пользователь является исполнителем или соисполнителем. Требуется право проверки задачи.', 'tasks')
on conflict (key) do nothing;

-- Root roles already receive every permission through has_permission. Explicit
-- catalogue grants make this capability visible to the role editor as well.
insert into public.role_permissions(role_id, permission_key)
select id, 'tasks.review_own' from public.roles
where key in ('owner', 'tech_admin') and scope = 'global' and is_active
on conflict do nothing;

create or replace function public._task_review_policy(p_task public.tasks, p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $fn$
declare
  v_participant boolean;
  v_own boolean;
  v_reviewer boolean;
begin
  if p_user is null or p_user is distinct from auth.uid()
     or p_task.id is null or p_task.deleted_at is not null
     or public.is_banned(p_user) then
    return jsonb_build_object('can_review', false, 'can_review_own', false,
                             'is_participant', false, 'reason', 'unavailable');
  end if;
  if not (public._task_visible_to_current_user_v3(
      p_task.assignee_id, p_task.created_by, p_task.chat_id, p_task.visibility,
      p_task.assignment_scope, p_task.location_id, p_task.target_role,
      p_task.route_admin_id, p_task.created_for_admin)
      or public._task_coassigned_to_me(p_task.id)) then
    return jsonb_build_object('can_review', false, 'can_review_own', false,
                             'is_participant', false, 'reason', 'unavailable');
  end if;
  v_reviewer := public.is_manager_or_admin(p_user)
      or public.has_permission(p_user, 'tasks.manage')
      or (p_task.location_id is not null
          and public.has_location_permission(p_user, p_task.location_id, 'tasks.manage'));
  if not coalesce(v_reviewer, false) then
    return jsonb_build_object('can_review', false, 'can_review_own', false,
                             'is_participant', false, 'reason', 'unavailable');
  end if;
  v_participant := coalesce(p_task.assignee_id = p_user, false)
                   or public._task_coassigned_to_me(p_task.id);
  v_own := public.has_permission(p_user, 'tasks.review_own');
  return jsonb_build_object(
    'can_review', p_task.status = 'waiting_confirmation' and (not v_participant or v_own),
    'can_review_own', v_own, 'is_participant', v_participant,
    'reason', case when p_task.status <> 'waiting_confirmation' then 'status'
                   when v_participant and not v_own then 'self_review' else 'ready' end);
end $fn$;
revoke all on function public._task_review_policy(public.tasks, uuid) from public, anon, authenticated;
grant execute on function public._task_review_policy(public.tasks, uuid) to postgres;

create or replace function public.task_review_access(p_task_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $fn$
declare v_task public.tasks%rowtype;
begin
  select * into v_task from public.tasks where id = p_task_id;
  return public._task_review_policy(v_task, auth.uid());
end $fn$;
revoke all on function public.task_review_access(uuid) from public, anon;
grant execute on function public.task_review_access(uuid) to authenticated, service_role;

create or replace function public.task_confirm(p_task_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = ''
as $fn$
declare
  caller uuid := auth.uid();
  cur public.tasks%rowtype;
  access jsonb;
  payload jsonb;
begin
  if caller is null then raise exception 'Требуется аутентификация' using errcode = '42501'; end if;
  if public.is_banned(caller) then raise exception 'Пользователь заблокирован' using errcode = '42501'; end if;
  select * into cur from public.tasks where id = p_task_id for update;
  if not found then raise exception 'Задача не найдена' using errcode = 'P0002'; end if;
  access := public._task_review_policy(cur, caller);
  if not (access->>'can_review')::boolean then
    if access->>'reason' = 'self_review' then
      raise exception 'Нельзя подтверждать собственную задачу' using errcode = '42501';
    elsif access->>'reason' = 'status' then
      raise exception 'Подтверждать можно только задачу со статусом «На подтверждении»' using errcode = '22023';
    end if;
    raise exception 'Недостаточно прав для проверки задачи' using errcode = '42501';
  end if;
  payload := case when p_note is null or length(btrim(p_note)) = 0
                  then '{}'::jsonb else jsonb_build_object('note', btrim(p_note)) end;
  if (access->>'is_participant')::boolean then
    payload := payload || jsonb_build_object('self_review', true, 'permission', 'tasks.review_own');
  end if;
  update public.tasks set status = 'confirmed' where id = p_task_id;
  perform public.task_append_event(p_task_id, 'confirm', payload);
end $fn$;

create or replace function public.task_reject(p_task_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $fn$
declare
  caller uuid := auth.uid();
  cur public.tasks%rowtype;
  access jsonb;
  payload jsonb;
begin
  if caller is null then raise exception 'Требуется аутентификация' using errcode = '42501'; end if;
  if public.is_banned(caller) then raise exception 'Пользователь заблокирован' using errcode = '42501'; end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'Укажите причину отклонения' using errcode = '22023';
  end if;
  select * into cur from public.tasks where id = p_task_id for update;
  if not found then raise exception 'Задача не найдена' using errcode = 'P0002'; end if;
  access := public._task_review_policy(cur, caller);
  if not (access->>'can_review')::boolean then
    if access->>'reason' = 'self_review' then
      raise exception 'Нельзя отклонять собственную задачу' using errcode = '42501';
    elsif access->>'reason' = 'status' then
      raise exception 'Отклонять можно только задачу со статусом «На подтверждении»' using errcode = '22023';
    end if;
    raise exception 'Недостаточно прав для проверки задачи' using errcode = '42501';
  end if;
  payload := jsonb_build_object('reason', btrim(p_reason));
  if (access->>'is_participant')::boolean then
    payload := payload || jsonb_build_object('self_review', true, 'permission', 'tasks.review_own');
  end if;
  update public.tasks set status = 'rejected' where id = p_task_id;
  perform public.task_append_event(p_task_id, 'reject', payload);
end $fn$;

do $check$
begin
  if not exists (select 1 from public.permissions where key = 'tasks.review_own')
     or has_function_privilege('anon', 'public.task_review_access(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.task_review_access(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public._task_review_policy(public.tasks,uuid)', 'execute')
     or not (select relrowsecurity from pg_class where oid = 'public.tasks'::regclass) then
    raise exception 'task_review_access_contract_invalid';
  end if;
  if position('public._task_review_policy' in pg_get_functiondef('public.task_confirm(uuid,text)'::regprocedure)) = 0
     or position('public._task_review_policy' in pg_get_functiondef('public.task_reject(uuid,text)'::regprocedure)) = 0 then
    raise exception 'task_review_authority_not_shared';
  end if;
end $check$;
commit;
