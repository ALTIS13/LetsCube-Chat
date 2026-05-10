-- Default dynamic user role baseline for newly registered users.
--
-- Proposal only. Do not apply automatically from Codex.
--
-- Purpose:
-- - keep legacy profiles.role = 'user' as the fallback;
-- - ensure every normal profile also receives the dynamic global `user` role;
-- - backfill existing users that have no global role;
-- - preserve existing owner / tech_admin / admin / manager assignments;
-- - avoid granting role-management, user-management, audit, system or all-location
--   permissions to normal users.

begin;

-- Ensure the baseline role and its safe permissions exist. This is idempotent
-- and does not add administrative permissions.
insert into public.roles (key, name, description, scope, is_system, is_active)
values ('user', 'Пользователь', 'Базовая пользовательская роль.', 'global', true, true)
on conflict (key) do update
  set name = excluded.name,
      description = excluded.description,
      scope = excluded.scope,
      is_system = true,
      is_active = true;

insert into public.permissions (key, name, description, category)
values
  ('tasks.view', 'Просмотр задач', 'Видеть задачи в доступной области.', 'tasks'),
  ('chats.invite', 'Приглашение в чаты', 'Отправлять приглашения там, где политика чата это разрешает.', 'chats')
on conflict (key) do update
  set name = excluded.name,
      description = excluded.description,
      category = excluded.category;

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
  from public.roles r
  join public.permissions p on p.key in ('tasks.view', 'chats.invite')
 where r.key = 'user'
   and r.scope = 'global'
on conflict do nothing;

-- Backfill only profiles that do not have any dynamic global role yet. This
-- keeps explicit custom roles and critical assignments untouched.
insert into public.user_global_roles (user_id, role_id, assigned_by)
select p.id, r.id, null
  from public.profiles p
  join public.roles r on r.key = 'user' and r.scope = 'global' and r.is_active
 where p.role = 'user'::public.app_role
   and not exists (
     select 1
       from public.user_global_roles ugr
       join public.roles existing on existing.id = ugr.role_id
      where ugr.user_id = p.id
        and existing.scope = 'global'
   )
on conflict do nothing;

create or replace function public.assign_default_user_global_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_role_id uuid;
begin
  if new.role <> 'user'::public.app_role then
    return new;
  end if;

  select id into v_user_role_id
    from public.roles
   where key = 'user'
     and scope = 'global'
     and is_active
   limit 1;

  if v_user_role_id is null then
    return new;
  end if;

  insert into public.user_global_roles (user_id, role_id, assigned_by)
  values (new.id, v_user_role_id, null)
  on conflict do nothing;

  return new;
end $$;

drop trigger if exists trg_profiles_default_user_global_role on public.profiles;
create trigger trg_profiles_default_user_global_role
  after insert on public.profiles
  for each row execute function public.assign_default_user_global_role();

revoke all on function public.assign_default_user_global_role() from public, anon, authenticated;

commit;
