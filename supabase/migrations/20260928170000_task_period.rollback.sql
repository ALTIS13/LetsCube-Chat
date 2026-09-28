-- Rollback of 20260928170000_task_period.sql. The client falls back to
-- nothing: revert the web client first (it calls v4), then run this.
-- Dropping the column loses every start written since; read them first:
--   select id, starts_at from public.tasks where starts_at is not null;
begin;

drop function if exists public.task_update_v4(uuid, text, text, public.task_priority, timestamptz, uuid, uuid, public.task_visibility, public.task_assignment_scope, uuid, text, uuid, boolean, timestamptz);
drop function if exists public.task_create_v4(text, text, uuid, public.task_priority, timestamptz, uuid, public.task_visibility, public.task_assignment_scope, uuid, text, uuid, boolean, timestamptz);
alter table public.tasks drop constraint if exists tasks_period_order;
alter table public.tasks drop column if exists starts_at;

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'tasks' and column_name = 'starts_at'
  ) then
    raise exception 'task_period_rollback_incomplete';
  end if;
end;
$$;

commit;
