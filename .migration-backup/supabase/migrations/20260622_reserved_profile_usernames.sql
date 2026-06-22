-- Purpose:
--   Reserve operational/admin-looking profile usernames so ordinary users
--   cannot impersonate platform/admin/service accounts through @handles.
--
-- Important:
--   This migration is safe to run manually on the production database.
--   It does not disable RLS and does not require service_role in frontend.
--
-- Product rule:
--   Reserved usernames are allowed only for real admins recognized by
--   public.is_admin(user_id), including dynamic owner/tech_admin/admin roles.

begin;

create or replace function public.profile_reserved_username_key(p_username text)
returns text
language sql
immutable
set search_path = public
as $$
  select regexp_replace(lower(coalesce(p_username, '')), '[^a-z0-9]+', '', 'g')
$$;

create or replace function public.profile_reserved_username_keys()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array[
    'admin',
    'administrator',
    'root',
    'owner',
    'techadmin',
    'sysadmin',
    'superadmin',
    'system',
    'support',
    'moderator',
    'mod',
    'staff',
    'official',
    'security',
    'letscube',
    'kub',
    'help',
    'notify',
    'noreply'
  ]::text[]
$$;

create or replace function public.enforce_profile_reserved_username(
  p_user_id uuid,
  p_username text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reserved_key text;
begin
  if p_user_id is null or p_username is null or btrim(p_username) = '' then
    return;
  end if;

  v_reserved_key := public.profile_reserved_username_key(p_username);

  if v_reserved_key = any(public.profile_reserved_username_keys())
     and not coalesce(public.is_admin(p_user_id), false) then
    raise exception 'reserved_username_requires_admin'
      using errcode = 'P0001',
            detail = 'Reserved profile username can only be used by administrators.';
  end if;
end
$$;

create or replace function public.profiles_reserved_username_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reserved_key text;
  v_is_admin_after_update boolean;
begin
  if new.id is null or new.username is null or btrim(new.username) = '' then
    return new;
  end if;

  v_reserved_key := public.profile_reserved_username_key(new.username);
  v_is_admin_after_update :=
    new.role::text = 'admin'
    or public.has_global_role(new.id, 'owner')
    or public.has_global_role(new.id, 'tech_admin')
    or public.has_global_role(new.id, 'admin');

  if v_reserved_key = any(public.profile_reserved_username_keys())
     and not coalesce(v_is_admin_after_update, false) then
    raise exception 'reserved_username_requires_admin'
      using errcode = 'P0001',
            detail = 'Reserved profile username can only be used by administrators.';
  end if;

  return new;
end
$$;

drop trigger if exists profiles_reserved_username_guard on public.profiles;
create trigger profiles_reserved_username_guard
  before insert or update of username, role on public.profiles
  for each row
  execute function public.profiles_reserved_username_guard();

do $$
begin
  if to_regclass('public.user_global_roles') is not null then
    create or replace function public.user_global_roles_reserved_username_guard()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
    as $fn$
    begin
      perform public.enforce_profile_reserved_username(coalesce(new.user_id, old.user_id), (
        select p.username
        from public.profiles p
        where p.id = coalesce(new.user_id, old.user_id)
      ));
      return coalesce(new, old);
    end
    $fn$;

    drop trigger if exists user_global_roles_reserved_username_guard on public.user_global_roles;
    create trigger user_global_roles_reserved_username_guard
      after insert or update or delete on public.user_global_roles
      for each row
      execute function public.user_global_roles_reserved_username_guard();
  end if;
end $$;

revoke all on function public.profile_reserved_username_key(text) from public, anon, authenticated;
revoke all on function public.profile_reserved_username_keys() from public, anon, authenticated;
revoke all on function public.enforce_profile_reserved_username(uuid, text) from public, anon, authenticated;
revoke all on function public.profiles_reserved_username_guard() from public, anon, authenticated;

do $$
begin
  if to_regprocedure('public.user_global_roles_reserved_username_guard()') is not null then
    revoke all on function public.user_global_roles_reserved_username_guard() from public, anon, authenticated;
  end if;
end $$;

commit;

-- Recommended one-time data cleanup before/after applying:
-- update public.profiles
-- set username = 'piska', updated_at = now()
-- where lower(username) = 'admin'
--   and not public.is_admin(id)
--   and not exists (
--     select 1 from public.profiles p2 where lower(p2.username) = 'piska'
--   );
--
-- Verify non-admin reserved handles:
-- select id, username
-- from public.profiles
-- where username is not null
--   and public.profile_reserved_username_key(username) = any(public.profile_reserved_username_keys())
--   and not public.is_admin(id);
--
-- Verify direct update is blocked:
-- begin;
-- update public.profiles
-- set username = 'Admin'
-- where id = '<non_admin_user_id>';
-- rollback;
--
-- Rollback:
-- drop trigger if exists profiles_reserved_username_guard on public.profiles;
-- drop trigger if exists user_global_roles_reserved_username_guard on public.user_global_roles;
-- drop function if exists public.user_global_roles_reserved_username_guard();
-- drop function if exists public.profiles_reserved_username_guard();
-- drop function if exists public.enforce_profile_reserved_username(uuid, text);
-- drop function if exists public.profile_reserved_username_keys();
-- drop function if exists public.profile_reserved_username_key(text);
