-- KUB roles/permissions foundation.
-- Status: proposal only. Do NOT apply automatically through MCP.
-- Apply manually in Supabase SQL Editor after review.
--
-- Goal:
-- - Add dynamic roles/permissions tables next to existing profiles.role/app_role.
-- - Keep current app_role, is_admin(), is_manager_or_admin(), RLS and RPC behavior intact.
-- - Provide has_permission() for future staged frontend/RPC alignment.

begin;

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text,
  rank integer not null default 0,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roles_key_format check (key ~ '^[a-z][a-z0-9_]*$')
);

create table if not exists public.permissions (
  key text primary key,
  description text not null,
  category text not null,
  created_at timestamptz not null default now(),
  constraint permissions_key_format check (key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$')
);

create table if not exists public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_key)
);

create table if not exists public.user_roles (
  user_id uuid not null references public.profiles(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete restrict,
  is_primary boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

create unique index if not exists user_roles_one_primary_per_user
  on public.user_roles(user_id)
  where is_primary;

create index if not exists roles_rank_idx on public.roles(rank);
create index if not exists role_permissions_permission_idx on public.role_permissions(permission_key);
create index if not exists user_roles_role_id_idx on public.user_roles(role_id);

alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles enable row level security;

drop policy if exists "roles readable by authenticated" on public.roles;
create policy "roles readable by authenticated"
  on public.roles for select
  to authenticated
  using (true);

drop policy if exists "permissions readable by authenticated" on public.permissions;
create policy "permissions readable by authenticated"
  on public.permissions for select
  to authenticated
  using (true);

drop policy if exists "role_permissions readable by authenticated" on public.role_permissions;
create policy "role_permissions readable by authenticated"
  on public.role_permissions for select
  to authenticated
  using (true);

drop policy if exists "user_roles self or staff read" on public.user_roles;
create policy "user_roles self or staff read"
  on public.user_roles for select
  to authenticated
  using (user_id = auth.uid() or public.is_manager_or_admin(auth.uid()));

-- No direct client writes in Phase A. Future changes should go through audited RPC.

insert into public.roles (key, name, description, rank, is_system)
values
  ('owner', 'Владелец', 'Главный владелец клуба с максимальными правами.', 1000, true),
  ('administrator', 'Администратор', 'Администратор системы и клуба.', 900, true),
  ('manager', 'Управляющий', 'Управляющий сменой/операциями клуба.', 700, true),
  ('tech_admin', 'Технический администратор', 'Техническая поддержка и инфраструктура.', 600, true),
  ('staff', 'Персонал', 'Сотрудник клуба без административных прав.', 400, true),
  ('user', 'Пользователь', 'Обычный пользователь или гость.', 100, true)
on conflict (key) do update
set name = excluded.name,
    description = excluded.description,
    rank = excluded.rank,
    is_system = excluded.is_system,
    updated_at = now();

insert into public.permissions (key, description, category)
values
  ('admin.panel.view', 'Открывать админ-панель.', 'admin'),
  ('users.view', 'Просматривать пользователей.', 'users'),
  ('users.manage', 'Управлять пользовательскими профилями.', 'users'),
  ('users.manage_roles', 'Назначать роли пользователям.', 'users'),
  ('users.manage_admins', 'Управлять владельцами и администраторами.', 'users'),
  ('bans.manage', 'Выдавать и снимать баны.', 'sanctions'),
  ('mutes.manage', 'Выдавать и снимать мьюты.', 'sanctions'),
  ('chats.manage_all', 'Управлять всеми чатами.', 'chats'),
  ('chats.create_group', 'Создавать групповые чаты.', 'chats'),
  ('chats.manage_members', 'Управлять участниками чатов.', 'chats'),
  ('folders.manage_shared', 'Управлять общими и системными папками.', 'folders'),
  ('tasks.view_all', 'Просматривать все staff задачи.', 'tasks'),
  ('tasks.create', 'Создавать задачи.', 'tasks'),
  ('tasks.assign', 'Назначать и переназначать задачи.', 'tasks'),
  ('tasks.confirm', 'Подтверждать или отклонять выполнение задач.', 'tasks'),
  ('tasks.manage_all', 'Управлять всеми задачами.', 'tasks'),
  ('audit.view', 'Просматривать аудит.', 'audit'),
  ('settings.manage', 'Управлять настройками системы.', 'settings'),
  ('notifications.manage', 'Управлять системными уведомлениями.', 'notifications'),
  ('profile.view_private_fields', 'Просматривать приватные поля профиля.', 'profile'),
  ('phone.view', 'Просматривать телефоны пользователей.', 'profile'),
  ('phone.verify', 'Подтверждать телефоны пользователей.', 'profile')
on conflict (key) do update
set description = excluded.description,
    category = excluded.category;

with rp(role_key, permission_key) as (
  values
    ('owner', 'admin.panel.view'),
    ('owner', 'users.view'),
    ('owner', 'users.manage'),
    ('owner', 'users.manage_roles'),
    ('owner', 'users.manage_admins'),
    ('owner', 'bans.manage'),
    ('owner', 'mutes.manage'),
    ('owner', 'chats.manage_all'),
    ('owner', 'chats.create_group'),
    ('owner', 'chats.manage_members'),
    ('owner', 'folders.manage_shared'),
    ('owner', 'tasks.view_all'),
    ('owner', 'tasks.create'),
    ('owner', 'tasks.assign'),
    ('owner', 'tasks.confirm'),
    ('owner', 'tasks.manage_all'),
    ('owner', 'audit.view'),
    ('owner', 'settings.manage'),
    ('owner', 'notifications.manage'),
    ('owner', 'profile.view_private_fields'),
    ('owner', 'phone.view'),
    ('owner', 'phone.verify'),

    ('administrator', 'admin.panel.view'),
    ('administrator', 'users.view'),
    ('administrator', 'users.manage'),
    ('administrator', 'users.manage_roles'),
    ('administrator', 'bans.manage'),
    ('administrator', 'mutes.manage'),
    ('administrator', 'chats.manage_all'),
    ('administrator', 'chats.create_group'),
    ('administrator', 'chats.manage_members'),
    ('administrator', 'folders.manage_shared'),
    ('administrator', 'tasks.view_all'),
    ('administrator', 'tasks.create'),
    ('administrator', 'tasks.assign'),
    ('administrator', 'tasks.confirm'),
    ('administrator', 'tasks.manage_all'),
    ('administrator', 'audit.view'),
    ('administrator', 'settings.manage'),
    ('administrator', 'notifications.manage'),
    ('administrator', 'profile.view_private_fields'),
    ('administrator', 'phone.view'),
    ('administrator', 'phone.verify'),

    ('manager', 'admin.panel.view'),
    ('manager', 'users.view'),
    ('manager', 'users.manage'),
    ('manager', 'bans.manage'),
    ('manager', 'mutes.manage'),
    ('manager', 'chats.create_group'),
    ('manager', 'chats.manage_members'),
    ('manager', 'folders.manage_shared'),
    ('manager', 'tasks.view_all'),
    ('manager', 'tasks.create'),
    ('manager', 'tasks.assign'),
    ('manager', 'tasks.confirm'),
    ('manager', 'tasks.manage_all'),
    ('manager', 'profile.view_private_fields'),
    ('manager', 'phone.view'),

    ('tech_admin', 'admin.panel.view'),
    ('tech_admin', 'users.view'),
    ('tech_admin', 'chats.manage_all'),
    ('tech_admin', 'folders.manage_shared'),
    ('tech_admin', 'audit.view'),
    ('tech_admin', 'settings.manage'),
    ('tech_admin', 'profile.view_private_fields'),
    ('tech_admin', 'phone.view'),

    ('staff', 'chats.create_group'),
    ('staff', 'tasks.create')
)
insert into public.role_permissions (role_id, permission_key)
select r.id, rp.permission_key
from rp
join public.roles r on r.key = rp.role_key
join public.permissions p on p.key = rp.permission_key
on conflict do nothing;

create or replace function public.role_key_for_app_role(p_role public.app_role)
returns text
language sql
immutable
as $$
  select case p_role
    when 'admin'::public.app_role then 'administrator'
    when 'manager'::public.app_role then 'manager'
    else 'user'
  end
$$;

create or replace function public.current_role_key(uid uuid default auth.uid())
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select r.key
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      where ur.user_id = uid and ur.is_primary
      limit 1
    ),
    (
      select public.role_key_for_app_role(p.role)
      from public.profiles p
      where p.id = uid
    )
  )
$$;

create or replace function public.has_permission(uid uuid, p_permission_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.roles r
    join public.role_permissions rp on rp.role_id = r.id
    where r.key = public.current_role_key(uid)
      and rp.permission_key = p_permission_key
  )
$$;

create or replace function public.role_rank(uid uuid default auth.uid())
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select r.rank
    from public.roles r
    where r.key = public.current_role_key(uid)
  ), 0)
$$;

create or replace function public.can_manage_role(p_actor uuid, p_target_role_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.has_permission(p_actor, 'users.manage_roles')
    and public.role_rank(p_actor) > coalesce((select rank from public.roles where key = p_target_role_key), 100000)
    and (
      p_target_role_key not in ('owner', 'administrator')
      or public.has_permission(p_actor, 'users.manage_admins')
    )
$$;

-- Backfill primary role mapping from existing profiles.role.
insert into public.user_roles (user_id, role_id, is_primary)
select p.id, r.id, true
from public.profiles p
join public.roles r on r.key = public.role_key_for_app_role(p.role)
where not exists (
  select 1 from public.user_roles ur
  where ur.user_id = p.id and ur.is_primary
)
on conflict do nothing;

-- Keep user_roles primary mapping aligned when legacy profiles.role changes.
create or replace function public.sync_user_roles_from_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role_id uuid;
begin
  if new.role is not distinct from old.role then
    return new;
  end if;

  select id into v_role_id
  from public.roles
  where key = public.role_key_for_app_role(new.role);

  if v_role_id is null then
    return new;
  end if;

  update public.user_roles
     set is_primary = false,
         updated_at = now()
   where user_id = new.id and is_primary;

  insert into public.user_roles (user_id, role_id, is_primary)
  values (new.id, v_role_id, true)
  on conflict (user_id, role_id) do update
    set is_primary = true,
        updated_at = now();

  return new;
end;
$$;

drop trigger if exists trg_sync_user_roles_from_profile_role on public.profiles;
create trigger trg_sync_user_roles_from_profile_role
after update of role on public.profiles
for each row
execute function public.sync_user_roles_from_profile_role();

commit;

-- Verify SQL after manual apply:
--
-- select key, name, rank, is_system from public.roles order by rank desc;
-- select category, count(*) from public.permissions group by category order by category;
-- select p.role, r.key as mapped_role, count(*)
-- from public.profiles p
-- left join public.user_roles ur on ur.user_id = p.id and ur.is_primary
-- left join public.roles r on r.id = ur.role_id
-- group by p.role, r.key
-- order by p.role, r.key;
-- select public.has_permission(id, 'admin.panel.view') as can_admin_panel, role
-- from public.profiles
-- order by created_at;
--
-- Manual QA:
-- 1. Admin login: admin panel, users, tasks, audit still work.
-- 2. Manager login: manager-level users/tasks/sanctions still work.
-- 3. User login: admin panel remains unavailable.
-- 4. Change a user's legacy role in current admin UI, then verify user_roles primary role follows.
-- 5. Do not replace RLS/RPC with has_permission until a separate confirmed phase.
