-- Rollback of 20260928180000_task_checklist.sql. Revert the web client first
-- (it reads the table and calls the functions). Dropping the table loses every
-- checklist written since; read them first:
--   select task_id, position, text, done from public.task_checklist_items order by task_id, position;
begin;

alter publication supabase_realtime drop table public.task_checklist_items;
drop function if exists public.task_checklist_remove(uuid);
drop function if exists public.task_checklist_set_done(uuid, boolean);
drop function if exists public.task_checklist_rename(uuid, text);
drop function if exists public.task_checklist_add(uuid, text);
drop function if exists public._task_checklist_assert_can_change(public.tasks, boolean);
drop table if exists public.task_checklist_items;

do $$
begin
  if to_regclass('public.task_checklist_items') is not null then
    raise exception 'task_checklist_rollback_incomplete';
  end if;
end;
$$;

commit;
