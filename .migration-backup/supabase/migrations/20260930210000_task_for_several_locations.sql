/**
 * One task, sent to several locations — tracker item 72 (2026-09-30).
 *
 * A tester, 2026-09-28: «задачам еще нужна возможность выбрать сразу несколько
 * локаций». A task carries one `location_id` and is routed within it, so
 * «several locations» is one task per location, each reaching its own
 * people — the shape the recurrence already has («Повтор создаёт отдельные
 * задачи с теми же локацией…»).
 *
 * Only for the two routes that name nobody, «Любому работнику локации»
 * (`staff_pool`) and «Любому менеджеру локации» (`manager_pool`): a route to a
 * manager, an administrator or the owner names a person, and a person works at
 * one location.
 *
 * Every task goes through `task_create_v4`, so every check it makes — the
 * caller's rights at that location, the routing, the event and the
 * notification — is made for each location. One transaction: a refusal at the
 * third location leaves none made. A repeat, when asked for, is made for each
 * task by `task_recurrence_create`, inside the same transaction.
 *
 * Rollback: 20260930210000_task_for_several_locations.rollback.sql
 */
begin;
set local lock_timeout = '5s';

create or replace function public.task_create_for_locations(
  p_location_ids uuid[],
  p_title text,
  p_description text default null,
  p_priority public.task_priority default 'normal',
  p_due_at timestamptz default null,
  p_chat_id uuid default null,
  p_visibility public.task_visibility default 'staff',
  p_assignment_scope public.task_assignment_scope default 'staff_pool',
  p_target_role text default null,
  p_starts_at timestamptz default null,
  p_frequency text default null,
  p_interval_count integer default null,
  p_by_weekday integer[] default null,
  p_by_monthday integer default null,
  p_recurrence_starts_at timestamptz default null,
  p_end_at timestamptz default null,
  p_max_occurrences integer default null
)
returns uuid[]
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ids uuid[] := '{}';
  v_done uuid[] := '{}';
  v_location uuid;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_assignment_scope not in ('staff_pool', 'manager_pool') then
    raise exception 'task_locations_need_a_pool' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_location_ids), 0) = 0 then
    raise exception 'task_location_required' using errcode = '22023';
  end if;
  if (select count(distinct location) from unnest(p_location_ids) as location where location is not null) > 50 then
    raise exception 'task_too_many_locations' using errcode = '54000';
  end if;

  -- In the order the reader chose them, each location once.
  foreach v_location in array p_location_ids loop
    continue when v_location is null or v_location = any (v_done);
    v_id := public.task_create_v4(
      p_title, p_description, null, p_priority, p_due_at, p_chat_id,
      p_visibility, p_assignment_scope, v_location, p_target_role,
      null, false, p_starts_at
    );
    if p_frequency is not null then
      perform public.task_recurrence_create(
        v_id, p_frequency, p_interval_count, p_by_weekday, p_by_monthday,
        p_recurrence_starts_at, p_end_at, p_max_occurrences
      );
    end if;
    v_ids := v_ids || v_id;
    v_done := v_done || v_location;
  end loop;

  if cardinality(v_ids) = 0 then
    raise exception 'task_location_required' using errcode = '22023';
  end if;
  return v_ids;
end
$$;

revoke all on function public.task_create_for_locations(
  uuid[], text, text, public.task_priority, timestamptz, uuid, public.task_visibility,
  public.task_assignment_scope, text, timestamptz, text, integer, integer[], integer,
  timestamptz, timestamptz, integer
) from public, anon;
grant execute on function public.task_create_for_locations(
  uuid[], text, text, public.task_priority, timestamptz, uuid, public.task_visibility,
  public.task_assignment_scope, text, timestamptz, text, integer, integer[], integer,
  timestamptz, timestamptz, integer
) to authenticated;

do $$
begin
  if to_regprocedure('public.task_create_for_locations(uuid[], text, text, public.task_priority, timestamptz, uuid, public.task_visibility, public.task_assignment_scope, text, timestamptz, text, integer, integer[], integer, timestamptz, timestamptz, integer)') is null
     or has_function_privilege('anon', 'public.task_create_for_locations(uuid[], text, text, public.task_priority, timestamptz, uuid, public.task_visibility, public.task_assignment_scope, text, timestamptz, text, integer, integer[], integer, timestamptz, timestamptz, integer)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.task_create_for_locations(uuid[], text, text, public.task_priority, timestamptz, uuid, public.task_visibility, public.task_assignment_scope, text, timestamptz, text, integer, integer[], integer, timestamptz, timestamptz, integer)', 'EXECUTE') then
    raise exception 'task_for_several_locations_migration_incomplete';
  end if;
end;
$$;

commit;
