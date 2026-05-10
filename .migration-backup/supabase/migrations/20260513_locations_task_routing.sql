-- Locations and task routing foundation.
--
-- Proposal only. Do not apply automatically from Codex.
-- Apply manually in Supabase SQL Editor after review, then regenerate frontend
-- database types if this project starts using generated types.

-- ---------------------------------------------------------------------
-- 1. Location model
-- ---------------------------------------------------------------------
create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text null,
  address text null,
  is_active boolean not null default true,
  created_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint locations_name_not_blank check (length(btrim(name)) > 0)
);

create table if not exists public.location_members (
  location_id uuid not null references public.locations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null,
  primary_admin_id uuid null references public.profiles(id) on delete set null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (location_id, user_id),
  constraint location_members_role_check check (role in ('owner', 'admin', 'manager', 'staff')),
  constraint location_members_no_self_primary_admin check (
    primary_admin_id is null or primary_admin_id <> user_id
  )
);

create index if not exists idx_locations_active_name
  on public.locations (is_active, name);
create index if not exists idx_location_members_user
  on public.location_members (user_id);
create index if not exists idx_location_members_location_role
  on public.location_members (location_id, role);
create index if not exists idx_location_members_primary_admin
  on public.location_members (primary_admin_id);

create or replace function public._locations_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_locations_touch_updated_at on public.locations;
create trigger trg_locations_touch_updated_at
  before update on public.locations
  for each row execute function public._locations_touch_updated_at();

drop trigger if exists trg_location_members_touch_updated_at on public.location_members;
create trigger trg_location_members_touch_updated_at
  before update on public.location_members
  for each row execute function public._locations_touch_updated_at();

-- ---------------------------------------------------------------------
-- 2. Helper functions
-- ---------------------------------------------------------------------
create or replace function public.location_role_of(p_location_id uuid, p_user_id uuid default auth.uid())
returns text
language sql
security definer
stable
set search_path = public
as $$
  select lm.role
    from public.location_members lm
   where lm.location_id = p_location_id
     and lm.user_id = p_user_id
   limit 1
$$;

revoke all on function public.location_role_of(uuid, uuid) from public, anon;
grant execute on function public.location_role_of(uuid, uuid) to authenticated;

create or replace function public.is_location_admin(p_location_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(public.is_admin(p_user_id), false)
      or exists (
        select 1
          from public.location_members lm
         where lm.location_id = p_location_id
           and lm.user_id = p_user_id
           and lm.role in ('owner', 'admin', 'manager')
      )
$$;

revoke all on function public.is_location_admin(uuid, uuid) from public, anon;
grant execute on function public.is_location_admin(uuid, uuid) to authenticated;

create or replace function public._location_assert_admin_member(
  p_location_id uuid,
  p_admin_id uuid
)
returns void
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if p_admin_id is null then
    return;
  end if;

  if not exists (
    select 1
      from public.location_members lm
     where lm.location_id = p_location_id
       and lm.user_id = p_admin_id
       and lm.role in ('owner', 'admin', 'manager')
  ) then
    raise exception 'Администратор не назначен на эту локацию' using errcode = '42501';
  end if;
end $$;

revoke all on function public._location_assert_admin_member(uuid, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. RLS for locations
-- ---------------------------------------------------------------------
alter table public.locations enable row level security;
alter table public.location_members enable row level security;

drop policy if exists "locations select scoped" on public.locations;
drop policy if exists "locations insert blocked" on public.locations;
drop policy if exists "locations update blocked" on public.locations;
drop policy if exists "locations delete blocked" on public.locations;

create policy "locations select scoped"
  on public.locations for select
  to authenticated
  using (
    public.is_admin(auth.uid())
    or exists (
      select 1
        from public.location_members lm
       where lm.location_id = locations.id
         and lm.user_id = auth.uid()
    )
  );

create policy "locations insert blocked"
  on public.locations for insert to authenticated with check (false);
create policy "locations update blocked"
  on public.locations for update to authenticated using (false) with check (false);
create policy "locations delete blocked"
  on public.locations for delete to authenticated using (false);

drop policy if exists "location_members select scoped" on public.location_members;
drop policy if exists "location_members insert blocked" on public.location_members;
drop policy if exists "location_members update blocked" on public.location_members;
drop policy if exists "location_members delete blocked" on public.location_members;

create policy "location_members select scoped"
  on public.location_members for select
  to authenticated
  using (
    public.is_admin(auth.uid())
    or user_id = auth.uid()
    or public.is_location_admin(location_id, auth.uid())
  );

create policy "location_members insert blocked"
  on public.location_members for insert to authenticated with check (false);
create policy "location_members update blocked"
  on public.location_members for update to authenticated using (false) with check (false);
create policy "location_members delete blocked"
  on public.location_members for delete to authenticated using (false);

grant select on public.locations to authenticated;
grant select on public.location_members to authenticated;

-- ---------------------------------------------------------------------
-- 4. Location management RPC
-- ---------------------------------------------------------------------
create or replace function public.location_create(
  p_name text,
  p_description text default null,
  p_address text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_id uuid;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if public.is_banned(v_caller) then
    raise exception 'banned' using errcode = '42501';
  end if;
  if not public.is_admin(v_caller) then
    raise exception 'Недостаточно прав' using errcode = '42501';
  end if;
  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'Нужно указать название локации' using errcode = '22023';
  end if;

  insert into public.locations (name, description, address, created_by)
  values (
    btrim(p_name),
    nullif(btrim(coalesce(p_description, '')), ''),
    nullif(btrim(coalesce(p_address, '')), ''),
    v_caller
  )
  returning id into v_id;

  insert into public.location_members (location_id, user_id, role, is_primary)
  values (v_id, v_caller, 'owner', true)
  on conflict (location_id, user_id) do update
    set role = 'owner',
        is_primary = true,
        updated_at = now();

  return v_id;
end $$;

create or replace function public.location_update(
  p_location_id uuid,
  p_name text,
  p_description text default null,
  p_address text default null,
  p_is_active boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not public.is_admin(v_caller) then
    raise exception 'Недостаточно прав' using errcode = '42501';
  end if;
  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'Нужно указать название локации' using errcode = '22023';
  end if;

  update public.locations
     set name = btrim(p_name),
         description = nullif(btrim(coalesce(p_description, '')), ''),
         address = nullif(btrim(coalesce(p_address, '')), ''),
         is_active = coalesce(p_is_active, true)
   where id = p_location_id;

  if not found then
    raise exception 'Локация недоступна' using errcode = 'P0002';
  end if;
end $$;

create or replace function public.location_archive(p_location_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.location_update(
    p_location_id,
    (select name from public.locations where id = p_location_id),
    (select description from public.locations where id = p_location_id),
    (select address from public.locations where id = p_location_id),
    false
  );
end $$;

create or replace function public.location_member_assign(
  p_location_id uuid,
  p_user_id uuid,
  p_role text,
  p_primary_admin_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not public.is_admin(v_caller) then
    raise exception 'Недостаточно прав' using errcode = '42501';
  end if;
  if p_role not in ('owner', 'admin', 'manager', 'staff') then
    raise exception 'Неверная роль локации' using errcode = '22023';
  end if;
  if not exists (select 1 from public.locations where id = p_location_id and is_active) then
    raise exception 'Локация недоступна' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'Пользователь не найден' using errcode = 'P0002';
  end if;
  perform public._location_assert_admin_member(p_location_id, p_primary_admin_id);

  insert into public.location_members (location_id, user_id, role, primary_admin_id, is_primary)
  values (p_location_id, p_user_id, p_role, p_primary_admin_id, false)
  on conflict (location_id, user_id) do update
    set role = excluded.role,
        primary_admin_id = excluded.primary_admin_id,
        updated_at = now();
end $$;

create or replace function public.location_member_remove(
  p_location_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not public.is_admin(v_caller) then
    raise exception 'Недостаточно прав' using errcode = '42501';
  end if;
  delete from public.location_members
   where location_id = p_location_id
     and user_id = p_user_id;
end $$;

create or replace function public.location_member_set_primary_admin(
  p_location_id uuid,
  p_user_id uuid,
  p_admin_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not public.is_admin(v_caller) then
    raise exception 'Недостаточно прав' using errcode = '42501';
  end if;
  perform public._location_assert_admin_member(p_location_id, p_admin_id);

  update public.location_members
     set primary_admin_id = p_admin_id,
         updated_at = now()
   where location_id = p_location_id
     and user_id = p_user_id;

  if not found then
    raise exception 'Пользователь не относится к этой локации' using errcode = 'P0002';
  end if;
end $$;

revoke all on function public.location_create(text, text, text) from public, anon;
revoke all on function public.location_update(uuid, text, text, text, boolean) from public, anon;
revoke all on function public.location_archive(uuid) from public, anon;
revoke all on function public.location_member_assign(uuid, uuid, text, uuid) from public, anon;
revoke all on function public.location_member_remove(uuid, uuid) from public, anon;
revoke all on function public.location_member_set_primary_admin(uuid, uuid, uuid) from public, anon;
grant execute on function public.location_create(text, text, text) to authenticated;
grant execute on function public.location_update(uuid, text, text, text, boolean) to authenticated;
grant execute on function public.location_archive(uuid) to authenticated;
grant execute on function public.location_member_assign(uuid, uuid, text, uuid) to authenticated;
grant execute on function public.location_member_remove(uuid, uuid) to authenticated;
grant execute on function public.location_member_set_primary_admin(uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Task routing columns
-- ---------------------------------------------------------------------
alter table public.tasks
  add column if not exists location_id uuid null references public.locations(id) on delete set null;

alter table public.tasks
  add column if not exists target_role text null;

alter table public.tasks
  add column if not exists route_admin_id uuid null references public.profiles(id) on delete set null;

alter table public.tasks
  add column if not exists created_for_admin boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'tasks_target_role_check'
       and conrelid = 'public.tasks'::regclass
  ) then
    alter table public.tasks
      add constraint tasks_target_role_check
      check (target_role is null or target_role in ('staff', 'admin', 'manager', 'owner'));
  end if;
end $$;

create index if not exists idx_tasks_location_status
  on public.tasks (location_id, status, updated_at desc);
create index if not exists idx_tasks_route_admin
  on public.tasks (route_admin_id, updated_at desc);
create index if not exists idx_tasks_location_target_role
  on public.tasks (location_id, target_role, assignment_scope);
create index if not exists idx_tasks_created_for_admin
  on public.tasks (created_for_admin) where created_for_admin;

-- ---------------------------------------------------------------------
-- 6. Location-aware task visibility
-- ---------------------------------------------------------------------
create or replace function public._task_visible_to_current_user_v3(
  p_assignee_id uuid,
  p_created_by uuid,
  p_chat_id uuid,
  p_visibility public.task_visibility,
  p_assignment_scope public.task_assignment_scope,
  p_location_id uuid,
  p_target_role text,
  p_route_admin_id uuid,
  p_created_for_admin boolean
)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_location_role text;
begin
  if v_caller is null or public.is_banned(v_caller) then
    return false;
  end if;

  if public.is_admin(v_caller) then
    return true;
  end if;

  if p_created_by = v_caller or p_assignee_id = v_caller then
    return true;
  end if;

  if coalesce(p_created_for_admin, false) then
    if p_route_admin_id = v_caller then
      return true;
    end if;
    if p_location_id is not null then
      select lm.role into v_location_role
        from public.location_members lm
       where lm.location_id = p_location_id
         and lm.user_id = v_caller
       limit 1;
      return v_location_role in ('owner', 'admin', 'manager')
         and (p_route_admin_id is null or p_route_admin_id = v_caller);
    end if;
    return public.is_manager_or_admin(v_caller);
  end if;

  if p_visibility = 'chat'::public.task_visibility
     and p_chat_id is not null
     and public.is_chat_member(p_chat_id) then
    return true;
  end if;

  if p_location_id is null then
    return public._task_visible_to_current_user(
      p_assignee_id, p_created_by, p_chat_id, p_visibility, p_assignment_scope
    );
  end if;

  select lm.role into v_location_role
    from public.location_members lm
   where lm.location_id = p_location_id
     and lm.user_id = v_caller
   limit 1;

  if v_location_role is null then
    return false;
  end if;

  if v_location_role in ('owner', 'admin', 'manager') then
    return true;
  end if;

  if p_assignment_scope = 'staff_pool'::public.task_assignment_scope
     or p_target_role = 'staff' then
    return true;
  end if;

  return false;
end $$;

revoke all on function public._task_visible_to_current_user_v3(
  uuid, uuid, uuid, public.task_visibility, public.task_assignment_scope,
  uuid, text, uuid, boolean
) from public, anon;
grant execute on function public._task_visible_to_current_user_v3(
  uuid, uuid, uuid, public.task_visibility, public.task_assignment_scope,
  uuid, text, uuid, boolean
) to authenticated;

drop policy if exists "tasks select for participants" on public.tasks;
drop policy if exists "tasks select scoped" on public.tasks;
drop policy if exists "task_events select for participants" on public.task_events;
drop policy if exists "task_events select scoped" on public.task_events;

create policy "tasks select scoped"
  on public.tasks for select
  to authenticated
  using (
    public._task_visible_to_current_user_v3(
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

create policy "task_events select scoped"
  on public.task_events for select
  to authenticated
  using (
    exists (
      select 1
        from public.tasks t
       where t.id = task_events.task_id
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
-- 7. Task routing validation and v3 RPC
-- ---------------------------------------------------------------------
create or replace function public._task_assert_location_routing(
  p_location_id uuid,
  p_assignee_id uuid,
  p_assignment_scope public.task_assignment_scope,
  p_target_role text,
  p_route_admin_id uuid,
  p_created_for_admin boolean
)
returns void
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_location_role text;
begin
  if p_target_role is not null
     and p_target_role not in ('staff', 'admin', 'manager', 'owner') then
    raise exception 'Неверная роль получателя' using errcode = '22023';
  end if;

  if p_created_for_admin
     and coalesce(p_target_role, 'admin') not in ('admin', 'manager', 'owner') then
    raise exception 'Задача для администратора должна быть адресована администратору'
      using errcode = '22023';
  end if;

  if p_location_id is null then
    if p_created_for_admin then
      raise exception 'Нужно выбрать локацию' using errcode = '22023';
    end if;
    if p_route_admin_id is not null then
      raise exception 'Нужно выбрать локацию' using errcode = '22023';
    end if;
    return;
  end if;

  if not exists (select 1 from public.locations where id = p_location_id and is_active) then
    raise exception 'Локация недоступна' using errcode = 'P0002';
  end if;

  select lm.role into v_location_role
    from public.location_members lm
   where lm.location_id = p_location_id
     and lm.user_id = v_caller
   limit 1;

  if not public.is_admin(v_caller)
     and v_location_role not in ('owner', 'admin', 'manager') then
    raise exception 'Недостаточно прав' using errcode = '42501';
  end if;

  if p_created_for_admin and not public.is_admin(v_caller) then
    raise exception 'Недостаточно прав' using errcode = '42501';
  end if;

  if p_assignee_id is not null
     and not exists (
       select 1 from public.location_members lm
        where lm.location_id = p_location_id
          and lm.user_id = p_assignee_id
     ) then
    raise exception 'Пользователь не относится к этой локации' using errcode = '42501';
  end if;

  perform public._location_assert_admin_member(p_location_id, p_route_admin_id);

  if p_assignment_scope = 'staff_pool'::public.task_assignment_scope
     and coalesce(p_target_role, 'staff') <> 'staff' then
    raise exception 'Пул работников должен быть адресован работникам' using errcode = '22023';
  end if;
end $$;

revoke all on function public._task_assert_location_routing(
  uuid, uuid, public.task_assignment_scope, text, uuid, boolean
) from public, anon, authenticated;

create or replace function public.task_create_v3(
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
  p_created_for_admin boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_new_id uuid;
  v_start_status public.task_status;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if public.is_banned(v_caller) then
    raise exception 'banned' using errcode = '42501';
  end if;
  if not public.is_manager_or_admin(v_caller)
     and not (p_location_id is not null and public.is_location_admin(p_location_id, v_caller)) then
    raise exception 'only_staff_can_create_tasks' using errcode = '42501';
  end if;
  if p_title is null or length(btrim(p_title)) = 0 then
    raise exception 'title_required' using errcode = '22023';
  end if;
  if p_chat_id is not null
     and not exists (select 1 from public.chats where id = p_chat_id) then
    raise exception 'chat_not_found' using errcode = 'P0002';
  end if;

  perform public._task_assert_visibility_assignment(
    p_visibility, p_assignment_scope, p_assignee_id, p_chat_id
  );
  perform public._task_assert_can_assign_to(p_assignee_id);
  perform public._task_assert_location_routing(
    p_location_id, p_assignee_id, p_assignment_scope,
    p_target_role, p_route_admin_id, coalesce(p_created_for_admin, false)
  );

  v_start_status := case
    when p_assignment_scope <> 'user'::public.task_assignment_scope then 'new'::public.task_status
    when p_assignee_id is null then 'new'::public.task_status
    else 'assigned'::public.task_status
  end;

  insert into public.tasks (
    title, description, priority, status, created_by,
    assignee_id, chat_id, due_at, visibility, assignment_scope,
    location_id, target_role, route_admin_id, created_for_admin
  )
  values (
    btrim(p_title),
    nullif(btrim(coalesce(p_description, '')), ''),
    p_priority,
    v_start_status,
    v_caller,
    p_assignee_id,
    p_chat_id,
    p_due_at,
    p_visibility,
    p_assignment_scope,
    p_location_id,
    p_target_role,
    p_route_admin_id,
    coalesce(p_created_for_admin, false)
  )
  returning id into v_new_id;

  perform public.task_append_event(
    v_new_id,
    'create',
    jsonb_build_object(
      'priority', p_priority::text,
      'assignee_id', p_assignee_id,
      'chat_id', p_chat_id,
      'due_at', p_due_at,
      'visibility', p_visibility::text,
      'assignment_scope', p_assignment_scope::text,
      'location_id', p_location_id,
      'target_role', p_target_role,
      'route_admin_id', p_route_admin_id,
      'created_for_admin', coalesce(p_created_for_admin, false)
    )
  );

  return v_new_id;
end $$;

create or replace function public.task_update_v3(
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
  p_created_for_admin boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_task public.tasks%rowtype;
  v_new_status public.task_status;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if public.is_banned(v_caller) then
    raise exception 'banned' using errcode = '42501';
  end if;
  if p_title is null or length(btrim(p_title)) = 0 then
    raise exception 'title_required' using errcode = '22023';
  end if;
  if p_priority is null then
    raise exception 'priority_required' using errcode = '22023';
  end if;

  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'task_not_found' using errcode = 'P0002';
  end if;
  if v_task.status in ('confirmed', 'cancelled') then
    raise exception 'task_locked: status=%', v_task.status using errcode = '22023';
  end if;
  if v_caller <> v_task.created_by
     and not public.is_manager_or_admin(v_caller)
     and not (
       coalesce(p_location_id, v_task.location_id) is not null
       and public.is_location_admin(coalesce(p_location_id, v_task.location_id), v_caller)
     ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_chat_id is not null
     and not exists (select 1 from public.chats where id = p_chat_id) then
    raise exception 'chat_not_found' using errcode = 'P0002';
  end if;

  perform public._task_assert_visibility_assignment(
    p_visibility, p_assignment_scope, p_assignee_id, p_chat_id
  );
  perform public._task_assert_can_assign_to(p_assignee_id);
  perform public._task_assert_location_routing(
    p_location_id, p_assignee_id, p_assignment_scope,
    p_target_role, p_route_admin_id, coalesce(p_created_for_admin, false)
  );

  v_new_status := v_task.status;
  if p_assignment_scope <> v_task.assignment_scope
     or p_assignee_id is distinct from v_task.assignee_id then
    if v_task.status not in ('new', 'assigned') then
      raise exception 'assignment_change_not_allowed_for_status: %', v_task.status
        using errcode = '22023';
    end if;
    if p_assignment_scope <> 'user'::public.task_assignment_scope then
      v_new_status := 'new'::public.task_status;
    elsif p_assignee_id is null then
      v_new_status := 'new'::public.task_status;
    else
      v_new_status := 'assigned'::public.task_status;
    end if;
  end if;

  update public.tasks
     set title = btrim(p_title),
         description = nullif(btrim(coalesce(p_description, '')), ''),
         priority = p_priority,
         due_at = p_due_at,
         assignee_id = p_assignee_id,
         chat_id = p_chat_id,
         visibility = p_visibility,
         assignment_scope = p_assignment_scope,
         status = v_new_status,
         location_id = p_location_id,
         target_role = p_target_role,
         route_admin_id = p_route_admin_id,
         created_for_admin = coalesce(p_created_for_admin, false),
         updated_at = now()
   where id = p_task_id;

  insert into public.task_events (task_id, actor_id, kind, payload)
  values (
    p_task_id,
    auth.uid(),
    'update',
    jsonb_build_object(
      'location_id', p_location_id,
      'target_role', p_target_role,
      'route_admin_id', p_route_admin_id,
      'created_for_admin', coalesce(p_created_for_admin, false),
      'status', v_new_status::text
    )
  );
end $$;

revoke all on function public.task_create_v3(
  text, text, uuid, public.task_priority, timestamptz, uuid,
  public.task_visibility, public.task_assignment_scope,
  uuid, text, uuid, boolean
) from public, anon;
grant execute on function public.task_create_v3(
  text, text, uuid, public.task_priority, timestamptz, uuid,
  public.task_visibility, public.task_assignment_scope,
  uuid, text, uuid, boolean
) to authenticated;

revoke all on function public.task_update_v3(
  uuid, text, text, public.task_priority, timestamptz, uuid, uuid,
  public.task_visibility, public.task_assignment_scope,
  uuid, text, uuid, boolean
) from public, anon;
grant execute on function public.task_update_v3(
  uuid, text, text, public.task_priority, timestamptz, uuid, uuid,
  public.task_visibility, public.task_assignment_scope,
  uuid, text, uuid, boolean
) to authenticated;

-- ---------------------------------------------------------------------
-- 8. Location-aware task notifications
-- ---------------------------------------------------------------------
create or replace function public._notify_tasks_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_rec record;
begin
  if new.assignee_id is not null
     and new.assignee_id is distinct from v_actor then
    perform public._notify(
      new.assignee_id,
      'task_assigned',
      jsonb_build_object(
        'task_id', new.id,
        'title', new.title,
        'priority', new.priority::text,
        'actor_id', v_actor,
        'location_id', new.location_id,
        'created_for_admin', new.created_for_admin
      )
    );
  end if;

  if new.created_for_admin
     and new.route_admin_id is not null
     and new.route_admin_id is distinct from v_actor
     and new.route_admin_id is distinct from new.assignee_id then
    perform public._notify(
      new.route_admin_id,
      'task_assigned',
      jsonb_build_object(
        'task_id', new.id,
        'title', new.title,
        'priority', new.priority::text,
        'actor_id', v_actor,
        'location_id', new.location_id,
        'target_role', new.target_role,
        'created_for_admin', true
      )
    );
  end if;

  if new.location_id is not null
     and new.assignee_id is null
     and not new.created_for_admin
     and new.assignment_scope = 'staff_pool'::public.task_assignment_scope then
    for v_rec in
      select lm.user_id
        from public.location_members lm
       where lm.location_id = new.location_id
         and lm.role in ('staff', 'manager', 'admin', 'owner')
         and lm.user_id is distinct from v_actor
    loop
      perform public._notify(
        v_rec.user_id,
        'task_assigned',
        jsonb_build_object(
          'task_id', new.id,
          'title', new.title,
          'priority', new.priority::text,
          'actor_id', v_actor,
          'location_id', new.location_id,
          'assignment_scope', new.assignment_scope::text
        )
      );
    end loop;
  end if;

  return null;
end $$;

-- Keep the existing update trigger semantics; only the insert path needs
-- routing fan-out at this foundation stage.
drop trigger if exists trg_notify_tasks_after_insert on public.tasks;
create trigger trg_notify_tasks_after_insert
  after insert on public.tasks
  for each row execute function public._notify_tasks_after_insert();

-- ---------------------------------------------------------------------
-- 9. Realtime
-- ---------------------------------------------------------------------
do $$
begin
  begin
    alter publication supabase_realtime add table public.locations;
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.location_members;
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;
end $$;

alter table public.locations replica identity full;
alter table public.location_members replica identity full;

-- ---------------------------------------------------------------------
-- Verify after manual apply
-- ---------------------------------------------------------------------
-- select to_regclass('public.locations') as locations,
--        to_regclass('public.location_members') as location_members;
--
-- select proname
--   from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public'
--    and proname in (
--      'location_create',
--      'location_update',
--      'location_archive',
--      'location_member_assign',
--      'location_member_remove',
--      'location_member_set_primary_admin',
--      'task_create_v3',
--      'task_update_v3'
--    )
--  order by proname;
--
-- select column_name
--   from information_schema.columns
--  where table_schema = 'public'
--    and table_name = 'tasks'
--    and column_name in ('location_id', 'target_role', 'route_admin_id', 'created_for_admin')
--  order by column_name;
