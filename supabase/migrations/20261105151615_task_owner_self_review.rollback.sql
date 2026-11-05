-- Exact before-state function bodies from the read-only production catalogue.
-- Rollback for 20261105151615_task_owner_self_review.sql.
begin;
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

drop function public.task_review_access(uuid);
drop function public._task_review_policy(public.tasks,uuid);
delete from public.role_permissions where permission_key='tasks.review_own';
delete from public.permissions where key='tasks.review_own';
commit;
