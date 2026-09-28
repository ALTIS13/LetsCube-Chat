-- Tracker item 68: a task runs from a date to a date. A tester, 2026-09-28:
-- «не хватает возможности выбрать промежуток… есть задачи которые идут месяц».
-- Approved by the owner on 2026-09-28 with the rest of
-- docs/operations/2026-09-28-database-proposals.md.
--
-- The column and the check are additive; the two functions are new versions
-- beside v3, which is untouched, so every client that calls v3 — the installed
-- Android bundle among them — goes on working and simply never sets a start.
-- v4 does everything v3 does by calling it, and adds only the start.
--
-- Rollback: 20260928170000_task_period.rollback.sql.
begin;

alter table public.tasks add column starts_at timestamptz;

alter table public.tasks add constraint tasks_period_order
  check (starts_at is null or due_at is null or starts_at <= due_at);

create function public.task_create_v4(
  p_title text,
  p_description text default null,
  p_assignee_id uuid default null,
  p_priority public.task_priority default 'normal',
  p_due_at timestamptz default null,
  p_chat_id uuid default null,
  p_visibility public.task_visibility default 'staff',
  p_assignment_scope public.task_assignment_scope default 'user',
  p_location_id uuid default null,
  p_target_role text default null,
  p_route_admin_id uuid default null,
  p_created_for_admin boolean default false,
  p_starts_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
begin
  if p_starts_at is not null and p_due_at is not null and p_starts_at > p_due_at then
    raise exception 'task_starts_after_due' using errcode = '22023';
  end if;
  -- Everything v3 checks — the caller, the routing, the assignment — and
  -- writes, including its event and its notification.
  v_id := public.task_create_v3(
    p_title, p_description, p_assignee_id, p_priority, p_due_at, p_chat_id,
    p_visibility, p_assignment_scope, p_location_id, p_target_role,
    p_route_admin_id, p_created_for_admin
  );
  if p_starts_at is not null then
    update public.tasks set starts_at = p_starts_at where id = v_id;
  end if;
  return v_id;
end $$;

create function public.task_update_v4(
  p_task_id uuid,
  p_title text,
  p_description text,
  p_priority public.task_priority,
  p_due_at timestamptz,
  p_assignee_id uuid,
  p_chat_id uuid,
  p_visibility public.task_visibility,
  p_assignment_scope public.task_assignment_scope,
  p_location_id uuid default null,
  p_target_role text default null,
  p_route_admin_id uuid default null,
  p_created_for_admin boolean default false,
  p_starts_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_starts_at is not null and p_due_at is not null and p_starts_at > p_due_at then
    raise exception 'task_starts_after_due' using errcode = '22023';
  end if;
  -- The old start is set aside before v3 writes the new due date, which the
  -- check would otherwise measure against it: moving a period earlier would
  -- fail on its own old start. v3 refusing the caller undoes this with the
  -- rest of the call.
  update public.tasks set starts_at = null where id = p_task_id and starts_at is not null;
  perform public.task_update_v3(
    p_task_id, p_title, p_description, p_priority, p_due_at, p_assignee_id,
    p_chat_id, p_visibility, p_assignment_scope, p_location_id, p_target_role,
    p_route_admin_id, p_created_for_admin
  );
  update public.tasks set starts_at = p_starts_at where id = p_task_id;
end $$;

-- As v3 is granted: the signed-in and the service, nobody else.
revoke all on function public.task_create_v4(text, text, uuid, public.task_priority, timestamptz, uuid, public.task_visibility, public.task_assignment_scope, uuid, text, uuid, boolean, timestamptz) from public, anon;
revoke all on function public.task_update_v4(uuid, text, text, public.task_priority, timestamptz, uuid, uuid, public.task_visibility, public.task_assignment_scope, uuid, text, uuid, boolean, timestamptz) from public, anon;
grant execute on function public.task_create_v4(text, text, uuid, public.task_priority, timestamptz, uuid, public.task_visibility, public.task_assignment_scope, uuid, text, uuid, boolean, timestamptz) to authenticated, service_role;
grant execute on function public.task_update_v4(uuid, text, text, public.task_priority, timestamptz, uuid, uuid, public.task_visibility, public.task_assignment_scope, uuid, text, uuid, boolean, timestamptz) to authenticated, service_role;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'tasks' and column_name = 'starts_at'
  )
    or not exists (select 1 from pg_constraint where conname = 'tasks_period_order' and conrelid = 'public.tasks'::regclass)
    or not pg_catalog.has_function_privilege('authenticated', 'public.task_create_v4(text, text, uuid, public.task_priority, timestamptz, uuid, public.task_visibility, public.task_assignment_scope, uuid, text, uuid, boolean, timestamptz)', 'EXECUTE')
    or not pg_catalog.has_function_privilege('authenticated', 'public.task_update_v4(uuid, text, text, public.task_priority, timestamptz, uuid, uuid, public.task_visibility, public.task_assignment_scope, uuid, text, uuid, boolean, timestamptz)', 'EXECUTE')
    or pg_catalog.has_function_privilege('anon', 'public.task_create_v4(text, text, uuid, public.task_priority, timestamptz, uuid, public.task_visibility, public.task_assignment_scope, uuid, text, uuid, boolean, timestamptz)', 'EXECUTE')
    or pg_catalog.has_function_privilege('anon', 'public.task_update_v4(uuid, text, text, public.task_priority, timestamptz, uuid, uuid, public.task_visibility, public.task_assignment_scope, uuid, text, uuid, boolean, timestamptz)', 'EXECUTE')
  then
    raise exception 'task_period_migration_incomplete';
  end if;
end;
$$;

commit;
