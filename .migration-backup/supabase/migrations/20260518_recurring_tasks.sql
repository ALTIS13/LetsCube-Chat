-- Recurring tasks with location routing.
-- Proposal only. Do not apply automatically from Codex.
--
-- Production note:
--   task_recurrence_run_due() creates due occurrences. A scheduler still
--   must call it periodically (Supabase Scheduled Edge Function, pg_cron,
--   external cron, or an explicit admin maintenance action). The frontend
--   must not pretend recurring tasks run automatically until that scheduler
--   is configured.

begin;

-- ---------------------------------------------------------------------
-- 1. Schema
-- ---------------------------------------------------------------------

create table if not exists public.task_recurrences (
  id uuid primary key default gen_random_uuid(),
  template_task_id uuid not null references public.tasks(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  frequency text not null check (frequency in ('daily', 'weekly', 'monthly', 'yearly', 'custom')),
  interval_count int not null default 1 check (interval_count > 0),
  by_weekday int[] null,
  by_monthday int null check (by_monthday is null or by_monthday between 1 and 31),
  starts_at timestamptz not null,
  next_run_at timestamptz null,
  last_run_at timestamptz null,
  end_at timestamptz null,
  max_occurrences int null check (max_occurrences is null or max_occurrences > 0),
  occurrences_created int not null default 0 check (occurrences_created >= 0),
  paused_at timestamptz null,
  stopped_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_recurrences_weekdays_valid check (
    by_weekday is null
    or (
      cardinality(by_weekday) between 1 and 7
      and by_weekday <@ array[1,2,3,4,5,6,7]
    )
  )
);

alter table public.tasks
  add column if not exists recurrence_id uuid null references public.task_recurrences(id) on delete set null,
  add column if not exists recurrence_template_task_id uuid null references public.tasks(id) on delete set null,
  add column if not exists recurrence_scheduled_for timestamptz null;

create unique index if not exists tasks_recurrence_occurrence_unique_idx
  on public.tasks (recurrence_id, recurrence_scheduled_for)
  where recurrence_id is not null and recurrence_scheduled_for is not null;

create index if not exists idx_task_recurrences_template_task
  on public.task_recurrences (template_task_id);
create index if not exists idx_task_recurrences_next_run
  on public.task_recurrences (next_run_at)
  where next_run_at is not null and paused_at is null and stopped_at is null;
create index if not exists idx_tasks_recurrence
  on public.tasks (recurrence_id, recurrence_scheduled_for);
create index if not exists idx_tasks_recurrence_template
  on public.tasks (recurrence_template_task_id);

create table if not exists public.task_recurrence_events (
  id uuid primary key default gen_random_uuid(),
  recurrence_id uuid not null references public.task_recurrences(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  kind text not null check (kind in ('created_occurrence', 'paused', 'resumed', 'stopped', 'updated', 'skipped', 'failed')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_task_recurrence_events_recurrence
  on public.task_recurrence_events (recurrence_id, created_at desc);

alter table public.task_recurrences enable row level security;
alter table public.task_recurrence_events enable row level security;

alter table public.task_recurrences replica identity full;
alter table public.task_recurrence_events replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
        from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'task_recurrences'
    ) then
      alter publication supabase_realtime add table public.task_recurrences;
    end if;
    if not exists (
      select 1
        from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'task_recurrence_events'
    ) then
      alter publication supabase_realtime add table public.task_recurrence_events;
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------

create or replace function public._task_recurrence_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_task_recurrences_touch on public.task_recurrences;
create trigger trg_task_recurrences_touch
  before update on public.task_recurrences
  for each row execute function public._task_recurrence_touch();

create or replace function public._task_recurrence_can_manage(p_task public.tasks)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null or public.is_banned(v_caller) then
    return false;
  end if;

  if public.has_permission(v_caller, 'system.manage')
     or public.has_permission(v_caller, 'tasks.manage_all_locations') then
    return true;
  end if;

  if coalesce(p_task.created_for_admin, false) then
    if p_task.location_id is not null then
      return public.has_location_permission(v_caller, p_task.location_id, 'tasks.manage_admin_tasks');
    end if;
    return public.has_permission(v_caller, 'tasks.manage_admin_tasks');
  end if;

  if p_task.location_id is not null
     and public.has_location_permission(v_caller, p_task.location_id, 'tasks.manage') then
    return true;
  end if;

  if public.has_permission(v_caller, 'tasks.manage')
     and (p_task.created_by = v_caller or p_task.assignee_id = v_caller or p_task.location_id is null) then
    return true;
  end if;

  return false;
end $$;

create or replace function public._task_recurrence_visible_to_current_user(p_recurrence_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(exists (
    select 1
      from public.task_recurrences r
      join public.tasks t on t.id = r.template_task_id
     where r.id = p_recurrence_id
       and public._task_visible_to_current_user_v3(
         t.assignee_id, t.created_by, t.chat_id, t.visibility, t.assignment_scope,
         t.location_id, t.target_role, t.route_admin_id, t.created_for_admin
       )
  ), false)
$$;

create or replace function public._task_recurrence_next_run_after(
  p_frequency text,
  p_interval_count int,
  p_by_weekday int[],
  p_by_monthday int,
  p_after timestamptz,
  p_starts_at timestamptz
)
returns timestamptz
language plpgsql
stable
set search_path = public
as $$
declare
  v_interval int := greatest(1, coalesce(p_interval_count, 1));
  v_anchor_day date := p_starts_at::date;
  v_anchor_week date := date_trunc('week', p_starts_at)::date;
  v_anchor_time interval := p_starts_at - date_trunc('day', p_starts_at);
  v_day date;
  v_candidate timestamptz;
  v_weekdays int[] := coalesce(p_by_weekday, array[extract(isodow from p_starts_at)::int]);
  v_i int;
  v_month_start timestamptz;
  v_daynum int;
  v_last_day int;
  v_month_num int;
begin
  if p_frequency in ('daily', 'custom') then
    for v_i in 0..36500 loop
      v_day := (date_trunc('day', p_after)::date + v_i);
      if v_day >= v_anchor_day
         and ((v_day - v_anchor_day) % v_interval = 0) then
        v_candidate := v_day::timestamptz + v_anchor_time;
        if v_candidate > p_after then
          return v_candidate;
        end if;
      end if;
    end loop;
  elsif p_frequency = 'weekly' then
    for v_i in 0..36500 loop
      v_day := (date_trunc('day', p_after)::date + v_i);
      if v_day >= v_anchor_day
         and extract(isodow from v_day)::int = any(v_weekdays)
         and (((v_day - v_anchor_week) / 7) % v_interval = 0) then
        v_candidate := v_day::timestamptz + v_anchor_time;
        if v_candidate > p_after then
          return v_candidate;
        end if;
      end if;
    end loop;
  elsif p_frequency = 'monthly' then
    v_daynum := coalesce(p_by_monthday, extract(day from p_starts_at)::int);
    for v_i in 0..1200 loop
      v_month_start := date_trunc('month', p_starts_at) + make_interval(months => v_i * v_interval);
      v_last_day := extract(day from (date_trunc('month', v_month_start) + interval '1 month' - interval '1 day'))::int;
      v_candidate := date_trunc('month', v_month_start)
        + make_interval(days => least(v_daynum, v_last_day) - 1)
        + v_anchor_time;
      if v_candidate > p_after then
        return v_candidate;
      end if;
    end loop;
  elsif p_frequency = 'yearly' then
    v_month_num := extract(month from p_starts_at)::int;
    v_daynum := extract(day from p_starts_at)::int;
    for v_i in 0..200 loop
      v_month_start := date_trunc('year', p_starts_at)
        + make_interval(years => v_i * v_interval)
        + make_interval(months => v_month_num - 1);
      v_last_day := extract(day from (date_trunc('month', v_month_start) + interval '1 month' - interval '1 day'))::int;
      v_candidate := date_trunc('month', v_month_start)
        + make_interval(days => least(v_daynum, v_last_day) - 1)
        + v_anchor_time;
      if v_candidate > p_after then
        return v_candidate;
      end if;
    end loop;
  end if;

  return null;
end $$;

create or replace function public._task_recurrence_initial_next_run(
  p_frequency text,
  p_interval_count int,
  p_by_weekday int[],
  p_by_monthday int,
  p_starts_at timestamptz
)
returns timestamptz
language sql
stable
set search_path = public
as $$
  select case
    when p_starts_at >= now() then p_starts_at
    else public._task_recurrence_next_run_after(
      p_frequency, p_interval_count, p_by_weekday, p_by_monthday, now(), p_starts_at
    )
  end
$$;

create or replace function public._task_recurrence_validate(
  p_frequency text,
  p_interval_count int,
  p_by_weekday int[],
  p_by_monthday int,
  p_starts_at timestamptz,
  p_end_at timestamptz,
  p_max_occurrences int
)
returns void
language plpgsql
stable
set search_path = public
as $$
begin
  if p_frequency not in ('daily', 'weekly', 'monthly', 'yearly', 'custom') then
    raise exception 'invalid_recurrence_frequency' using errcode = '22023';
  end if;
  if coalesce(p_interval_count, 0) < 1 then
    raise exception 'recurrence_interval_required' using errcode = '22023';
  end if;
  if p_starts_at is null then
    raise exception 'recurrence_starts_at_required' using errcode = '22023';
  end if;
  if p_end_at is not null and p_end_at <= p_starts_at then
    raise exception 'recurrence_end_before_start' using errcode = '22023';
  end if;
  if p_max_occurrences is not null and p_max_occurrences < 1 then
    raise exception 'recurrence_max_occurrences_required' using errcode = '22023';
  end if;
  if p_frequency = 'weekly'
     and p_by_weekday is not null
     and exists (select 1 from unnest(p_by_weekday) as d(day) where d.day < 1 or d.day > 7) then
    raise exception 'recurrence_weekday_invalid' using errcode = '22023';
  end if;
  if p_frequency = 'monthly'
     and p_by_monthday is not null
     and (p_by_monthday < 1 or p_by_monthday > 31) then
    raise exception 'recurrence_monthday_invalid' using errcode = '22023';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------

drop policy if exists "task_recurrences select scoped" on public.task_recurrences;
drop policy if exists "task_recurrences insert blocked" on public.task_recurrences;
drop policy if exists "task_recurrences update blocked" on public.task_recurrences;
drop policy if exists "task_recurrences delete blocked" on public.task_recurrences;
create policy "task_recurrences select scoped"
  on public.task_recurrences for select to authenticated
  using (public._task_recurrence_visible_to_current_user(id));
create policy "task_recurrences insert blocked"
  on public.task_recurrences for insert to authenticated with check (false);
create policy "task_recurrences update blocked"
  on public.task_recurrences for update to authenticated using (false) with check (false);
create policy "task_recurrences delete blocked"
  on public.task_recurrences for delete to authenticated using (false);

drop policy if exists "task_recurrence_events select scoped" on public.task_recurrence_events;
drop policy if exists "task_recurrence_events insert blocked" on public.task_recurrence_events;
drop policy if exists "task_recurrence_events update blocked" on public.task_recurrence_events;
drop policy if exists "task_recurrence_events delete blocked" on public.task_recurrence_events;
create policy "task_recurrence_events select scoped"
  on public.task_recurrence_events for select to authenticated
  using (public._task_recurrence_visible_to_current_user(recurrence_id));
create policy "task_recurrence_events insert blocked"
  on public.task_recurrence_events for insert to authenticated with check (false);
create policy "task_recurrence_events update blocked"
  on public.task_recurrence_events for update to authenticated using (false) with check (false);
create policy "task_recurrence_events delete blocked"
  on public.task_recurrence_events for delete to authenticated using (false);

revoke all on public.task_recurrences from public, anon, authenticated;
revoke all on public.task_recurrence_events from public, anon, authenticated;
grant select on public.task_recurrences to authenticated;
grant select on public.task_recurrence_events to authenticated;

-- ---------------------------------------------------------------------
-- 4. RPC
-- ---------------------------------------------------------------------

create or replace function public.task_recurrence_create(
  p_template_task_id uuid,
  p_frequency text,
  p_interval_count int,
  p_by_weekday int[] default null,
  p_by_monthday int default null,
  p_starts_at timestamptz default null,
  p_end_at timestamptz default null,
  p_max_occurrences int default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_task public.tasks%rowtype;
  v_recurrence_id uuid;
  v_next_run_at timestamptz;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_task from public.tasks where id = p_template_task_id for update;
  if not found then
    raise exception 'task_not_found' using errcode = 'P0002';
  end if;
  if not public._task_recurrence_can_manage(v_task) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_task.recurrence_template_task_id is not null then
    raise exception 'cannot_recur_generated_occurrence' using errcode = '22023';
  end if;
  if exists (
    select 1
      from public.task_recurrences r
     where r.template_task_id = p_template_task_id
       and r.stopped_at is null
  ) then
    raise exception 'task_already_has_active_recurrence' using errcode = '23505';
  end if;

  perform public._task_recurrence_validate(
    p_frequency, p_interval_count, p_by_weekday, p_by_monthday,
    p_starts_at, p_end_at, p_max_occurrences
  );

  v_next_run_at := public._task_recurrence_initial_next_run(
    p_frequency, p_interval_count, p_by_weekday, p_by_monthday, p_starts_at
  );
  if p_end_at is not null and v_next_run_at is not null and v_next_run_at > p_end_at then
    v_next_run_at := null;
  end if;

  insert into public.task_recurrences (
    template_task_id, created_by, frequency, interval_count, by_weekday, by_monthday,
    starts_at, next_run_at, end_at, max_occurrences
  )
  values (
    p_template_task_id, v_caller, p_frequency, greatest(1, p_interval_count),
    case when p_frequency = 'weekly' then p_by_weekday else null end,
    case when p_frequency = 'monthly' then p_by_monthday else null end,
    p_starts_at, v_next_run_at, p_end_at, p_max_occurrences
  )
  returning id into v_recurrence_id;

  update public.tasks
     set recurrence_id = v_recurrence_id,
         recurrence_template_task_id = null,
         recurrence_scheduled_for = null,
         updated_at = now()
   where id = p_template_task_id;

  insert into public.task_recurrence_events (recurrence_id, actor_id, kind, payload)
  values (
    v_recurrence_id,
    v_caller,
    'updated',
    jsonb_build_object('action', 'created', 'next_run_at', v_next_run_at)
  );

  return v_recurrence_id;
end $$;

create or replace function public.task_recurrence_update(
  p_recurrence_id uuid,
  p_frequency text,
  p_interval_count int,
  p_by_weekday int[] default null,
  p_by_monthday int default null,
  p_next_run_at timestamptz default null,
  p_end_at timestamptz default null,
  p_max_occurrences int default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_rec public.task_recurrences%rowtype;
  v_task public.tasks%rowtype;
  v_next_run_at timestamptz;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_rec from public.task_recurrences where id = p_recurrence_id for update;
  if not found then
    raise exception 'recurrence_not_found' using errcode = 'P0002';
  end if;
  select * into v_task from public.tasks where id = v_rec.template_task_id for update;
  if not found or not public._task_recurrence_can_manage(v_task) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform public._task_recurrence_validate(
    p_frequency, p_interval_count, p_by_weekday, p_by_monthday,
    v_rec.starts_at, p_end_at, p_max_occurrences
  );

  v_next_run_at := coalesce(
    p_next_run_at,
    public._task_recurrence_initial_next_run(
      p_frequency, p_interval_count, p_by_weekday, p_by_monthday, v_rec.starts_at
    )
  );
  if p_end_at is not null and v_next_run_at is not null and v_next_run_at > p_end_at then
    v_next_run_at := null;
  end if;

  update public.task_recurrences
     set frequency = p_frequency,
         interval_count = greatest(1, p_interval_count),
         by_weekday = case when p_frequency = 'weekly' then p_by_weekday else null end,
         by_monthday = case when p_frequency = 'monthly' then p_by_monthday else null end,
         next_run_at = case when stopped_at is null then v_next_run_at else next_run_at end,
         end_at = p_end_at,
         max_occurrences = p_max_occurrences
   where id = p_recurrence_id;

  insert into public.task_recurrence_events (recurrence_id, actor_id, kind, payload)
  values (p_recurrence_id, v_caller, 'updated', jsonb_build_object('next_run_at', v_next_run_at));
end $$;

create or replace function public.task_recurrence_pause(p_recurrence_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_rec public.task_recurrences%rowtype;
  v_task public.tasks%rowtype;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select * into v_rec from public.task_recurrences where id = p_recurrence_id for update;
  if not found then raise exception 'recurrence_not_found' using errcode = 'P0002'; end if;
  select * into v_task from public.tasks where id = v_rec.template_task_id;
  if not found or not public._task_recurrence_can_manage(v_task) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.task_recurrences
     set paused_at = coalesce(paused_at, now())
   where id = p_recurrence_id
     and stopped_at is null;
  insert into public.task_recurrence_events (recurrence_id, actor_id, kind)
  values (p_recurrence_id, v_caller, 'paused');
end $$;

create or replace function public.task_recurrence_resume(p_recurrence_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_rec public.task_recurrences%rowtype;
  v_task public.tasks%rowtype;
  v_next_run_at timestamptz;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select * into v_rec from public.task_recurrences where id = p_recurrence_id for update;
  if not found then raise exception 'recurrence_not_found' using errcode = 'P0002'; end if;
  select * into v_task from public.tasks where id = v_rec.template_task_id;
  if not found or not public._task_recurrence_can_manage(v_task) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_rec.stopped_at is not null then
    raise exception 'recurrence_stopped' using errcode = '22023';
  end if;
  v_next_run_at := coalesce(
    v_rec.next_run_at,
    public._task_recurrence_initial_next_run(
      v_rec.frequency, v_rec.interval_count, v_rec.by_weekday, v_rec.by_monthday, v_rec.starts_at
    )
  );
  update public.task_recurrences
     set paused_at = null,
         next_run_at = v_next_run_at
   where id = p_recurrence_id;
  insert into public.task_recurrence_events (recurrence_id, actor_id, kind, payload)
  values (p_recurrence_id, v_caller, 'resumed', jsonb_build_object('next_run_at', v_next_run_at));
end $$;

create or replace function public.task_recurrence_stop(p_recurrence_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_rec public.task_recurrences%rowtype;
  v_task public.tasks%rowtype;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select * into v_rec from public.task_recurrences where id = p_recurrence_id for update;
  if not found then raise exception 'recurrence_not_found' using errcode = 'P0002'; end if;
  select * into v_task from public.tasks where id = v_rec.template_task_id;
  if not found or not public._task_recurrence_can_manage(v_task) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.task_recurrences
     set stopped_at = coalesce(stopped_at, now()),
         paused_at = null,
         next_run_at = null
   where id = p_recurrence_id;
  insert into public.task_recurrence_events (recurrence_id, actor_id, kind)
  values (p_recurrence_id, v_caller, 'stopped');
end $$;

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
    select * into v_template from public.tasks where id = v_rec.template_task_id;
    if not found then
      update public.task_recurrences
         set stopped_at = coalesce(stopped_at, now()),
             next_run_at = null
       where id = v_rec.id;
      insert into public.task_recurrence_events (recurrence_id, actor_id, kind, payload)
      values (v_rec.id, v_caller, 'failed', jsonb_build_object('reason', 'template_missing'));
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
end $$;

-- ---------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------

revoke all on function public._task_recurrence_touch() from public, anon, authenticated;
revoke all on function public._task_recurrence_can_manage(public.tasks) from public, anon, authenticated;
revoke all on function public._task_recurrence_visible_to_current_user(uuid) from public, anon;
revoke all on function public._task_recurrence_next_run_after(text, int, int[], int, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public._task_recurrence_initial_next_run(text, int, int[], int, timestamptz) from public, anon, authenticated;
revoke all on function public._task_recurrence_validate(text, int, int[], int, timestamptz, timestamptz, int) from public, anon, authenticated;

revoke all on function public.task_recurrence_create(uuid, text, int, int[], int, timestamptz, timestamptz, int) from public, anon;
revoke all on function public.task_recurrence_update(uuid, text, int, int[], int, timestamptz, timestamptz, int) from public, anon;
revoke all on function public.task_recurrence_pause(uuid) from public, anon;
revoke all on function public.task_recurrence_resume(uuid) from public, anon;
revoke all on function public.task_recurrence_stop(uuid) from public, anon;
revoke all on function public.task_recurrence_run_due(int) from public, anon;

grant execute on function public._task_recurrence_visible_to_current_user(uuid) to authenticated;
grant execute on function public.task_recurrence_create(uuid, text, int, int[], int, timestamptz, timestamptz, int) to authenticated;
grant execute on function public.task_recurrence_update(uuid, text, int, int[], int, timestamptz, timestamptz, int) to authenticated;
grant execute on function public.task_recurrence_pause(uuid) to authenticated;
grant execute on function public.task_recurrence_resume(uuid) to authenticated;
grant execute on function public.task_recurrence_stop(uuid) to authenticated;
grant execute on function public.task_recurrence_run_due(int) to authenticated;

commit;

-- Verify after manual application:
--
-- select table_name from information_schema.tables
--  where table_schema = 'public'
--    and table_name in ('task_recurrences', 'task_recurrence_events');
--
-- select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public'
--    and proname like 'task_recurrence_%'
--  order by proname;
--
-- select column_name from information_schema.columns
--  where table_schema = 'public'
--    and table_name = 'tasks'
--    and column_name in ('recurrence_id', 'recurrence_template_task_id', 'recurrence_scheduled_for');
