-- Dynamic roles, permissions, tech_admin, and role display foundation.
--
-- Proposal only. Do not apply automatically from Codex.
-- Apply manually in Supabase SQL Editor after review, then regenerate frontend
-- database types if this project starts using generated types.
--
-- This migration keeps public.profiles.role as the legacy fallback source of
-- truth during rollout. The new tables become the gradual source of truth for
-- custom roles and permissions without breaking task_create_v2/v3, location
-- routing, group invites, or existing RLS.

-- ---------------------------------------------------------------------
-- 1. Core roles / permissions model
-- ---------------------------------------------------------------------
create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text null,
  scope text not null,
  is_system boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roles_key_check check (key ~ '^[a-z][a-z0-9_]{1,48}$'),
  constraint roles_name_not_blank check (length(btrim(name)) > 0),
  constraint roles_scope_check check (scope in ('global', 'location', 'chat'))
);

create table if not exists public.permissions (
  key text primary key,
  name text not null,
  description text null,
  category text null,
  constraint permissions_key_check check (key ~ '^[a-z][a-z0-9_.]{1,80}$'),
  constraint permissions_name_not_blank check (length(btrim(name)) > 0)
);

create table if not exists public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  primary key (role_id, permission_key)
);

create table if not exists public.user_global_roles (
  user_id uuid not null references public.profiles(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  assigned_by uuid null references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

alter table public.location_members
  add column if not exists role_id uuid null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'location_members_role_id_fkey'
      and conrelid = 'public.location_members'::regclass
  ) then
    alter table public.location_members
      add constraint location_members_role_id_fkey
      foreign key (role_id) references public.roles(id) on delete set null;
  end if;
end $$;

create index if not exists idx_roles_scope_active on public.roles (scope, is_active, key);
create index if not exists idx_role_permissions_permission on public.role_permissions (permission_key);
create index if not exists idx_user_global_roles_role on public.user_global_roles (role_id);
create index if not exists idx_location_members_role_id on public.location_members (role_id);

create or replace function public._roles_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_roles_touch_updated_at on public.roles;
create trigger trg_roles_touch_updated_at
  before update on public.roles
  for each row execute function public._roles_touch_updated_at();

-- ---------------------------------------------------------------------
-- 2. System roles and permissions seed
-- ---------------------------------------------------------------------
insert into public.roles (key, name, description, scope, is_system, is_active)
values
  ('owner', 'Владелец', 'Полный бизнес-доступ ко всем клубам и пользователям.', 'global', true, true),
  ('tech_admin', 'Тех. администратор', 'Полный технический доступ к настройкам, ролям, правам и данным.', 'global', true, true),
  ('admin', 'Администратор', 'Административный доступ по legacy-модели.', 'global', true, true),
  ('manager', 'Менеджер', 'Операционный доступ менеджера.', 'global', true, true),
  ('user', 'Пользователь', 'Базовая пользовательская роль.', 'global', true, true),
  ('location_owner', 'Владелец клуба', 'Управляет отдельной локацией.', 'location', true, true),
  ('location_admin', 'Администратор клуба', 'Управляет задачами и сотрудниками своей локации.', 'location', true, true),
  ('location_manager', 'Менеджер клуба', 'Помогает управлять задачами локации.', 'location', true, true),
  ('location_staff', 'Работник клуба', 'Получает задачи своей локации.', 'location', true, true),
  ('location_client', 'Клиент клуба', 'Минимальный доступ в рамках локации.', 'location', true, true),
  ('chat_owner', 'Владелец чата', 'Владелец группового чата.', 'chat', true, true),
  ('chat_admin', 'Администратор чата', 'Администратор группового чата.', 'chat', true, true),
  ('chat_member', 'Участник', 'Обычный участник чата.', 'chat', true, true)
on conflict (key) do update
  set name = excluded.name,
      description = excluded.description,
      scope = excluded.scope,
      is_system = true,
      is_active = true;

insert into public.permissions (key, name, description, category)
values
  ('system.manage', 'Управление системой', 'Технические настройки и аварийное обслуживание.', 'system'),
  ('roles.view', 'Просмотр ролей', 'Просмотр ролей, прав и назначений.', 'system'),
  ('roles.manage', 'Управление ролями', 'Создание и изменение ролей.', 'system'),
  ('permissions.manage', 'Управление правами', 'Назначение permissions ролям.', 'system'),
  ('audit.view', 'Просмотр аудита', 'Доступ к журналу аудита.', 'system'),
  ('users.view', 'Просмотр пользователей', 'Просмотр пользователей и профилей.', 'users'),
  ('users.manage', 'Управление пользователями', 'Редактирование пользователей и санкций.', 'users'),
  ('users.assign_roles', 'Назначение ролей', 'Назначение глобальных и location ролей.', 'users'),
  ('locations.view', 'Просмотр локаций', 'Просмотр клубов и своих назначений.', 'locations'),
  ('locations.manage', 'Управление локациями', 'Создание и изменение клубов.', 'locations'),
  ('location_members.view', 'Просмотр сотрудников локаций', 'Просмотр назначений сотрудников.', 'locations'),
  ('location_members.manage', 'Управление сотрудниками локаций', 'Назначение сотрудников и primary admin.', 'locations'),
  ('tasks.view', 'Просмотр задач', 'Базовый доступ к задачам.', 'tasks'),
  ('tasks.create', 'Создание задач', 'Создание задач в доступной области.', 'tasks'),
  ('tasks.assign', 'Назначение задач', 'Назначение задач пользователям и пулам.', 'tasks'),
  ('tasks.manage', 'Управление задачами', 'Редактирование и администрирование задач.', 'tasks'),
  ('tasks.view_admin_tasks', 'Просмотр задач администраторов', 'Доступ к owner→admin задачам.', 'tasks'),
  ('tasks.manage_admin_tasks', 'Управление задачами администраторов', 'Создание и изменение admin-only задач.', 'tasks'),
  ('tasks.view_all_locations', 'Просмотр задач всех локаций', 'Глобальный просмотр задач.', 'tasks'),
  ('tasks.manage_all_locations', 'Управление задачами всех локаций', 'Глобальное управление задачами.', 'tasks'),
  ('chats.invite', 'Приглашение в чаты', 'Отправка приглашений по политике чата.', 'chats'),
  ('chats.invite_any', 'Приглашение вне политики', 'Отправка приглашений независимо от политики чата.', 'chats'),
  ('chats.manage_invites', 'Управление приглашениями', 'Отмена, повторные приглашения и история.', 'chats'),
  ('chats.moderate', 'Модерация чатов', 'Модерация групповых чатов.', 'chats'),
  ('chats.manage_roles', 'Управление ролями чата', 'Повышение и понижение участников чата.', 'chats'),
  ('media.moderate', 'Модерация медиа', 'Модерация пользовательских вложений.', 'media'),
  ('folders.manage_shared', 'Управление общими папками', 'Настройка общих папок.', 'folders')
on conflict (key) do update
  set name = excluded.name,
      description = excluded.description,
      category = excluded.category;

with role_seed(role_key, permission_key) as (
  -- owner and tech_admin get every permission.
  select 'owner', key from public.permissions
  union all
  select 'tech_admin', key from public.permissions
  union all
  values
    ('admin', 'roles.view'),
    ('admin', 'users.view'),
    ('admin', 'users.manage'),
    ('admin', 'users.assign_roles'),
    ('admin', 'locations.view'),
    ('admin', 'locations.manage'),
    ('admin', 'location_members.view'),
    ('admin', 'location_members.manage'),
    ('admin', 'tasks.view'),
    ('admin', 'tasks.create'),
    ('admin', 'tasks.assign'),
    ('admin', 'tasks.manage'),
    ('admin', 'tasks.view_admin_tasks'),
    ('admin', 'tasks.manage_admin_tasks'),
    ('admin', 'tasks.view_all_locations'),
    ('admin', 'tasks.manage_all_locations'),
    ('admin', 'chats.invite'),
    ('admin', 'chats.invite_any'),
    ('admin', 'chats.manage_invites'),
    ('admin', 'chats.moderate'),
    ('admin', 'chats.manage_roles'),
    ('admin', 'audit.view'),
    ('manager', 'users.view'),
    ('manager', 'locations.view'),
    ('manager', 'location_members.view'),
    ('manager', 'tasks.view'),
    ('manager', 'tasks.create'),
    ('manager', 'tasks.assign'),
    ('manager', 'tasks.manage'),
    ('manager', 'chats.invite'),
    ('user', 'tasks.view'),
    ('user', 'chats.invite'),
    ('location_owner', 'locations.view'),
    ('location_owner', 'location_members.view'),
    ('location_owner', 'location_members.manage'),
    ('location_owner', 'tasks.view'),
    ('location_owner', 'tasks.create'),
    ('location_owner', 'tasks.assign'),
    ('location_owner', 'tasks.manage'),
    ('location_owner', 'tasks.view_admin_tasks'),
    ('location_owner', 'tasks.manage_admin_tasks'),
    ('location_admin', 'locations.view'),
    ('location_admin', 'location_members.view'),
    ('location_admin', 'location_members.manage'),
    ('location_admin', 'tasks.view'),
    ('location_admin', 'tasks.create'),
    ('location_admin', 'tasks.assign'),
    ('location_admin', 'tasks.manage'),
    ('location_admin', 'tasks.view_admin_tasks'),
    ('location_manager', 'locations.view'),
    ('location_manager', 'location_members.view'),
    ('location_manager', 'tasks.view'),
    ('location_manager', 'tasks.create'),
    ('location_manager', 'tasks.assign'),
    ('location_staff', 'locations.view'),
    ('location_staff', 'tasks.view'),
    ('location_client', 'locations.view'),
    ('chat_owner', 'chats.invite'),
    ('chat_owner', 'chats.manage_invites'),
    ('chat_owner', 'chats.moderate'),
    ('chat_owner', 'chats.manage_roles'),
    ('chat_admin', 'chats.invite'),
    ('chat_admin', 'chats.manage_invites'),
    ('chat_admin', 'chats.moderate'),
    ('chat_member', 'chats.invite')
)
insert into public.role_permissions (role_id, permission_key)
select r.id, s.permission_key
  from role_seed s
  join public.roles r on r.key = s.role_key
on conflict do nothing;

-- Bootstrap legacy rows into the new model. This does not remove
-- profiles.role; it only gives the new UI something explicit to display.
insert into public.user_global_roles (user_id, role_id, assigned_by)
select p.id, r.id, null
  from public.profiles p
  join public.roles r on r.key = p.role::text and r.scope = 'global'
on conflict do nothing;

-- Give the earliest legacy admin owner+tech_admin bootstrap access if the
-- dynamic system has no critical assignments yet. Review after applying.
with first_admin as (
  select id
    from public.profiles
   where role = 'admin'::public.app_role
   order by created_at asc
   limit 1
), critical_roles as (
  select id, key from public.roles where key in ('owner', 'tech_admin')
)
insert into public.user_global_roles (user_id, role_id, assigned_by)
select first_admin.id, critical_roles.id, null
  from first_admin, critical_roles
 where not exists (
   select 1
     from public.user_global_roles ugr
     join public.roles r on r.id = ugr.role_id
    where r.key = critical_roles.key
 )
on conflict do nothing;

update public.location_members lm
   set role_id = r.id
  from public.roles r
 where lm.role_id is null
   and r.scope = 'location'
   and r.key = case lm.role
     when 'owner' then 'location_owner'
     when 'admin' then 'location_admin'
     when 'manager' then 'location_manager'
     else 'location_staff'
   end;

-- ---------------------------------------------------------------------
-- 3. Permission helpers with legacy fallback
-- ---------------------------------------------------------------------
create or replace function public._legacy_role_has_permission(
  p_role public.app_role,
  p_permission_key text
)
returns boolean
language sql
stable
set search_path = public
as $$
  select case
    when p_role = 'admin'::public.app_role then p_permission_key in (
      'roles.view',
      'users.view', 'users.manage', 'users.assign_roles',
      'locations.view', 'locations.manage',
      'location_members.view', 'location_members.manage',
      'tasks.view', 'tasks.create', 'tasks.assign', 'tasks.manage',
      'tasks.view_admin_tasks', 'tasks.manage_admin_tasks',
      'tasks.view_all_locations', 'tasks.manage_all_locations',
      'chats.invite', 'chats.invite_any', 'chats.manage_invites',
      'chats.moderate', 'chats.manage_roles',
      'audit.view',
      'folders.manage_shared'
    )
    when p_role = 'manager'::public.app_role then p_permission_key in (
      'users.view',
      'locations.view', 'location_members.view',
      'tasks.view', 'tasks.create', 'tasks.assign', 'tasks.manage',
      'chats.invite'
    )
    else p_permission_key in ('tasks.view', 'chats.invite')
  end
$$;

create or replace function public.has_global_role(p_user_id uuid, p_role_key text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(exists (
    select 1
      from public.user_global_roles ugr
      join public.roles r on r.id = ugr.role_id
     where ugr.user_id = p_user_id
       and r.scope = 'global'
       and r.key = p_role_key
       and r.is_active
  ), false)
  or coalesce(exists (
    select 1
      from public.profiles p
     where p.id = p_user_id
       and p.role::text = p_role_key
       and p_role_key in ('admin', 'manager', 'user')
  ), false)
$$;

create or replace function public.has_permission(p_user_id uuid, p_permission_key text)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_legacy_role public.app_role;
begin
  if p_user_id is null then
    return false;
  end if;

  if public.has_global_role(p_user_id, 'owner') or public.has_global_role(p_user_id, 'tech_admin') then
    return true;
  end if;

  if exists (
    select 1
      from public.user_global_roles ugr
      join public.roles r on r.id = ugr.role_id
      join public.role_permissions rp on rp.role_id = r.id
     where ugr.user_id = p_user_id
       and r.scope = 'global'
       and r.is_active
       and rp.permission_key = p_permission_key
  ) then
    return true;
  end if;

  select role into v_legacy_role from public.profiles where id = p_user_id;
  return coalesce(public._legacy_role_has_permission(v_legacy_role, p_permission_key), false);
end $$;

create or replace function public.has_location_role(
  p_user_id uuid,
  p_location_id uuid,
  p_role_key text
)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(exists (
    select 1
      from public.location_members lm
      left join public.roles r on r.id = lm.role_id
     where lm.user_id = p_user_id
       and lm.location_id = p_location_id
       and (
         r.key = p_role_key
         or case lm.role
           when 'owner' then 'location_owner'
           when 'admin' then 'location_admin'
           when 'manager' then 'location_manager'
           else 'location_staff'
         end = p_role_key
       )
  ), false)
$$;

create or replace function public.has_location_permission(
  p_user_id uuid,
  p_location_id uuid,
  p_permission_key text
)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.has_permission(p_user_id, p_permission_key)
      or exists (
        select 1
          from public.location_members lm
          join public.roles r on r.id = lm.role_id
          join public.role_permissions rp on rp.role_id = r.id
         where lm.user_id = p_user_id
           and lm.location_id = p_location_id
           and r.scope = 'location'
           and r.is_active
           and rp.permission_key = p_permission_key
      )
$$;

revoke all on function public._legacy_role_has_permission(public.app_role, text) from public, anon, authenticated;
revoke all on function public.has_global_role(uuid, text) from public, anon;
revoke all on function public.has_permission(uuid, text) from public, anon;
revoke all on function public.has_location_role(uuid, uuid, text) from public, anon;
revoke all on function public.has_location_permission(uuid, uuid, text) from public, anon;
grant execute on function public.has_global_role(uuid, text) to authenticated;
grant execute on function public.has_permission(uuid, text) to authenticated;
grant execute on function public.has_location_role(uuid, uuid, text) to authenticated;
grant execute on function public.has_location_permission(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_global_roles enable row level security;

drop policy if exists "roles select scoped" on public.roles;
drop policy if exists "roles insert blocked" on public.roles;
drop policy if exists "roles update blocked" on public.roles;
drop policy if exists "roles delete blocked" on public.roles;
create policy "roles select scoped"
  on public.roles for select to authenticated
  using (
    public.has_permission(auth.uid(), 'roles.view')
    or exists (
      select 1 from public.user_global_roles ugr
       where ugr.user_id = auth.uid() and ugr.role_id = roles.id
    )
    or exists (
      select 1 from public.location_members lm
       where lm.user_id = auth.uid() and lm.role_id = roles.id
    )
  );
create policy "roles insert blocked" on public.roles for insert to authenticated with check (false);
create policy "roles update blocked" on public.roles for update to authenticated using (false) with check (false);
create policy "roles delete blocked" on public.roles for delete to authenticated using (false);

drop policy if exists "permissions select scoped" on public.permissions;
drop policy if exists "permissions insert blocked" on public.permissions;
drop policy if exists "permissions update blocked" on public.permissions;
drop policy if exists "permissions delete blocked" on public.permissions;
create policy "permissions select scoped"
  on public.permissions for select to authenticated
  using (public.has_permission(auth.uid(), 'roles.view'));
create policy "permissions insert blocked" on public.permissions for insert to authenticated with check (false);
create policy "permissions update blocked" on public.permissions for update to authenticated using (false) with check (false);
create policy "permissions delete blocked" on public.permissions for delete to authenticated using (false);

drop policy if exists "role_permissions select scoped" on public.role_permissions;
drop policy if exists "role_permissions insert blocked" on public.role_permissions;
drop policy if exists "role_permissions update blocked" on public.role_permissions;
drop policy if exists "role_permissions delete blocked" on public.role_permissions;
create policy "role_permissions select scoped"
  on public.role_permissions for select to authenticated
  using (public.has_permission(auth.uid(), 'roles.view'));
create policy "role_permissions insert blocked" on public.role_permissions for insert to authenticated with check (false);
create policy "role_permissions update blocked" on public.role_permissions for update to authenticated using (false) with check (false);
create policy "role_permissions delete blocked" on public.role_permissions for delete to authenticated using (false);

drop policy if exists "user_global_roles select scoped" on public.user_global_roles;
drop policy if exists "user_global_roles insert blocked" on public.user_global_roles;
drop policy if exists "user_global_roles update blocked" on public.user_global_roles;
drop policy if exists "user_global_roles delete blocked" on public.user_global_roles;
create policy "user_global_roles select scoped"
  on public.user_global_roles for select to authenticated
  using (user_id = auth.uid() or public.has_permission(auth.uid(), 'users.assign_roles'));
create policy "user_global_roles insert blocked" on public.user_global_roles for insert to authenticated with check (false);
create policy "user_global_roles update blocked" on public.user_global_roles for update to authenticated using (false) with check (false);
create policy "user_global_roles delete blocked" on public.user_global_roles for delete to authenticated using (false);

grant select on public.roles to authenticated;
grant select on public.permissions to authenticated;
grant select on public.role_permissions to authenticated;
grant select on public.user_global_roles to authenticated;

-- ---------------------------------------------------------------------
-- 5. Role management RPC
-- ---------------------------------------------------------------------
create or replace function public._require_permission(p_permission_key text)
returns void
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if public.is_banned(auth.uid()) then
    raise exception 'banned' using errcode = '42501';
  end if;
  if not public.has_permission(auth.uid(), p_permission_key) then
    raise exception 'insufficient_permission' using errcode = '42501';
  end if;
end $$;

create or replace function public._critical_role_count(p_role_key text)
returns integer
language sql
security definer
stable
set search_path = public
as $$
  select count(*)::integer
    from public.user_global_roles ugr
    join public.roles r on r.id = ugr.role_id
   where r.key = p_role_key
     and r.scope = 'global'
     and r.is_active
$$;

revoke all on function public._require_permission(text) from public, anon, authenticated;
revoke all on function public._critical_role_count(text) from public, anon, authenticated;

create or replace function public.role_create(
  p_key text,
  p_name text,
  p_description text default null,
  p_scope text default 'global'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public._require_permission('roles.manage');
  if p_scope not in ('global', 'location', 'chat') then
    raise exception 'invalid_scope' using errcode = '22023';
  end if;
  if p_key is null or p_key !~ '^[a-z][a-z0-9_]{1,48}$' then
    raise exception 'invalid_role_key' using errcode = '22023';
  end if;
  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'role_name_required' using errcode = '22023';
  end if;

  insert into public.roles (key, name, description, scope, is_system, is_active)
  values (btrim(p_key), btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), p_scope, false, true)
  returning id into v_id;

  insert into public.audit_logs (actor_id, action, target_kind, target_id, diff)
  values (auth.uid(), 'role_created', 'role', v_id, jsonb_build_object('key', p_key, 'scope', p_scope));

  return v_id;
end $$;

create or replace function public.role_update(
  p_role_id uuid,
  p_name text,
  p_description text default null,
  p_is_active boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.roles%rowtype;
begin
  perform public._require_permission('roles.manage');
  select * into v_role from public.roles where id = p_role_id for update;
  if not found then
    raise exception 'role_not_found' using errcode = 'P0002';
  end if;
  if v_role.is_system and coalesce(p_is_active, true) = false then
    raise exception 'system_role_protected' using errcode = '42501';
  end if;
  if v_role.key in ('owner', 'tech_admin')
     and coalesce(p_is_active, true) = false
     and public._critical_role_count(v_role.key) <= 1 then
    raise exception 'last_%', v_role.key using errcode = '42501';
  end if;

  update public.roles
     set name = btrim(p_name),
         description = nullif(btrim(coalesce(p_description, '')), ''),
         is_active = case when is_system then true else coalesce(p_is_active, true) end
   where id = p_role_id;

  insert into public.audit_logs (actor_id, action, target_kind, target_id, diff)
  values (auth.uid(), 'role_updated', 'role', p_role_id, jsonb_build_object('name', p_name, 'is_active', p_is_active));
end $$;

create or replace function public.role_set_permissions(
  p_role_id uuid,
  p_permission_keys text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.roles%rowtype;
  v_missing text;
begin
  perform public._require_permission('permissions.manage');
  select * into v_role from public.roles where id = p_role_id for update;
  if not found then
    raise exception 'role_not_found' using errcode = 'P0002';
  end if;
  if v_role.key in ('owner', 'tech_admin') then
    -- Keep critical roles full-access. Their permissions are informational.
    delete from public.role_permissions where role_id = p_role_id;
    insert into public.role_permissions (role_id, permission_key)
    select p_role_id, key from public.permissions
    on conflict do nothing;
    return;
  end if;

  select key into v_missing
    from unnest(coalesce(p_permission_keys, array[]::text[])) key
   where not exists (select 1 from public.permissions p where p.key = key)
   limit 1;
  if v_missing is not null then
    raise exception 'invalid_permission' using errcode = '22023';
  end if;

  delete from public.role_permissions where role_id = p_role_id;
  insert into public.role_permissions (role_id, permission_key)
  select p_role_id, key
    from unnest(coalesce(p_permission_keys, array[]::text[])) key
  on conflict do nothing;

  insert into public.audit_logs (actor_id, action, target_kind, target_id, diff)
  values (auth.uid(), 'role_permissions_updated', 'role', p_role_id, jsonb_build_object('count', coalesce(array_length(p_permission_keys, 1), 0)));
end $$;

create or replace function public.role_delete_or_archive(p_role_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.roles%rowtype;
begin
  perform public._require_permission('roles.manage');
  select * into v_role from public.roles where id = p_role_id for update;
  if not found then
    raise exception 'role_not_found' using errcode = 'P0002';
  end if;
  if v_role.is_system then
    raise exception 'system_role_protected' using errcode = '42501';
  end if;
  update public.roles set is_active = false where id = p_role_id;
  insert into public.audit_logs (actor_id, action, target_kind, target_id, diff)
  values (auth.uid(), 'role_archived', 'role', p_role_id, '{}'::jsonb);
end $$;

create or replace function public.user_assign_global_role(p_user_id uuid, p_role_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.roles%rowtype;
begin
  perform public._require_permission('users.assign_roles');
  select * into v_role from public.roles where id = p_role_id and scope = 'global' and is_active;
  if not found then
    raise exception 'role_not_found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;

  insert into public.user_global_roles (user_id, role_id, assigned_by)
  values (p_user_id, p_role_id, auth.uid())
  on conflict do nothing;

  insert into public.audit_logs (actor_id, action, target_kind, target_id, diff)
  values (auth.uid(), 'user_global_role_assigned', 'profile', p_user_id, jsonb_build_object('role_key', v_role.key));
end $$;

create or replace function public.user_remove_global_role(p_user_id uuid, p_role_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.roles%rowtype;
begin
  perform public._require_permission('users.assign_roles');
  select * into v_role from public.roles where id = p_role_id and scope = 'global';
  if not found then
    raise exception 'role_not_found' using errcode = 'P0002';
  end if;
  if v_role.key in ('owner', 'tech_admin') and public._critical_role_count(v_role.key) <= 1 then
    raise exception 'last_%', v_role.key using errcode = '42501';
  end if;

  delete from public.user_global_roles
   where user_id = p_user_id
     and role_id = p_role_id;

  insert into public.audit_logs (actor_id, action, target_kind, target_id, diff)
  values (auth.uid(), 'user_global_role_removed', 'profile', p_user_id, jsonb_build_object('role_key', v_role.key));
end $$;

create or replace function public.location_member_assign_role(
  p_location_id uuid,
  p_user_id uuid,
  p_role_id uuid,
  p_primary_admin_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.roles%rowtype;
  v_legacy_role text;
begin
  perform public._require_permission('location_members.manage');
  select * into v_role
    from public.roles
   where id = p_role_id
     and scope = 'location'
     and is_active;
  if not found then
    raise exception 'role_not_found' using errcode = 'P0002';
  end if;

  v_legacy_role := case v_role.key
    when 'location_owner' then 'owner'
    when 'location_admin' then 'admin'
    when 'location_manager' then 'manager'
    else 'staff'
  end;

  if v_legacy_role = 'staff' then
    perform public._location_assert_admin_member(p_location_id, p_primary_admin_id);
  else
    p_primary_admin_id := null;
  end if;

  insert into public.location_members (location_id, user_id, role, role_id, primary_admin_id)
  values (p_location_id, p_user_id, v_legacy_role, p_role_id, p_primary_admin_id)
  on conflict (location_id, user_id) do update
    set role = excluded.role,
        role_id = excluded.role_id,
        primary_admin_id = excluded.primary_admin_id,
        updated_at = now();

  insert into public.audit_logs (actor_id, action, target_kind, target_id, diff)
  values (auth.uid(), 'location_member_role_assigned', 'profile', p_user_id, jsonb_build_object(
    'location_id', p_location_id,
    'role_key', v_role.key,
    'primary_admin_id', p_primary_admin_id
  ));
end $$;

revoke all on function public.role_create(text, text, text, text) from public, anon;
revoke all on function public.role_update(uuid, text, text, boolean) from public, anon;
revoke all on function public.role_set_permissions(uuid, text[]) from public, anon;
revoke all on function public.role_delete_or_archive(uuid) from public, anon;
revoke all on function public.user_assign_global_role(uuid, uuid) from public, anon;
revoke all on function public.user_remove_global_role(uuid, uuid) from public, anon;
revoke all on function public.location_member_assign_role(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.role_create(text, text, text, text) to authenticated;
grant execute on function public.role_update(uuid, text, text, boolean) to authenticated;
grant execute on function public.role_set_permissions(uuid, text[]) to authenticated;
grant execute on function public.role_delete_or_archive(uuid) to authenticated;
grant execute on function public.user_assign_global_role(uuid, uuid) to authenticated;
grant execute on function public.user_remove_global_role(uuid, uuid) to authenticated;
grant execute on function public.location_member_assign_role(uuid, uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Apply permissions to existing task routing and invite semantics
-- ---------------------------------------------------------------------
create or replace function public.is_location_admin(p_location_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(public.has_permission(p_user_id, 'locations.manage'), false)
      or coalesce(public.has_location_permission(p_user_id, p_location_id, 'location_members.manage'), false)
      or exists (
        select 1
          from public.location_members lm
         where lm.location_id = p_location_id
           and lm.user_id = p_user_id
           and lm.role in ('owner', 'admin', 'manager')
      )
$$;

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

  if public.has_permission(v_caller, 'tasks.view_all_locations') then
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
      return public.has_location_permission(v_caller, p_location_id, 'tasks.view_admin_tasks');
    end if;
    return public.has_permission(v_caller, 'tasks.view_admin_tasks');
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

  if public.has_location_permission(v_caller, p_location_id, 'tasks.manage')
     or v_location_role in ('owner', 'admin', 'manager') then
    return true;
  end if;

  if p_assignment_scope = 'staff_pool'::public.task_assignment_scope
     or p_target_role = 'staff' then
    return true;
  end if;

  return false;
end $$;

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
    if p_created_for_admin or p_route_admin_id is not null then
      raise exception 'Нужно выбрать локацию' using errcode = '22023';
    end if;
    return;
  end if;

  if not exists (select 1 from public.locations where id = p_location_id and is_active) then
    raise exception 'Локация недоступна' using errcode = 'P0002';
  end if;

  if not public.has_permission(v_caller, 'tasks.manage_all_locations')
     and not public.has_location_permission(v_caller, p_location_id, 'tasks.create') then
    raise exception 'Недостаточно прав' using errcode = '42501';
  end if;

  if p_created_for_admin
     and not public.has_permission(v_caller, 'tasks.manage_admin_tasks')
     and not public.has_location_permission(v_caller, p_location_id, 'tasks.manage_admin_tasks') then
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

-- group_invite_create keeps the same signature and return type. Only the
-- permission check changes:
--   * chats.invite_any bypasses invite_policy.
--   * members_can_invite still allows regular members to send invites.
--   * chats.manage_invites remains required for cancel/history management.
-- If this file is applied, replace only the permission block in the current
-- function body or re-create it with the current production body and this
-- condition before creating the invite:
--
--   if public.has_permission(v_caller, 'chats.invite_any') then
--     null;
--   elsif v_policy = 'members_can_invite' then
--     if not exists (select 1 from public.chat_members where chat_id = p_chat_id and user_id = v_caller)
--        and not public.has_permission(v_caller, 'chats.invite') then
--       raise exception 'group_invite_member_required' using errcode = '42501';
--     end if;
--   else
--     if not public.is_chat_admin(p_chat_id)
--        and not public.has_permission(v_caller, 'chats.invite_any') then
--       raise exception 'group_invite_admin_required' using errcode = '42501';
--     end if;
--   end if;

-- ---------------------------------------------------------------------
-- 7. Realtime exposure
-- ---------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.roles;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.role_permissions;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.user_global_roles;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
