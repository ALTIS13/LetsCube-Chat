-- Admin profile/avatar permissions for dynamic roles.
--
-- Proposal only. Apply manually in Supabase SQL Editor.
--
-- Why:
-- Dynamic `tech_admin` / `owner` users are recognized by frontend permissions,
-- but older RLS/storage helpers still rely on legacy `profiles.role`.
-- This patch makes the shared admin helpers understand dynamic roles and adds
-- a narrow RPC for profile avatar updates from the admin users panel.

begin;

create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select uid is not null and (
    exists (
      select 1
      from public.profiles p
      where p.id = uid
        and p.role = 'admin'::public.app_role
    )
    or public.has_global_role(uid, 'owner')
    or public.has_global_role(uid, 'tech_admin')
    or public.has_global_role(uid, 'admin')
  )
$$;

create or replace function public.is_manager_or_admin(uid uuid default auth.uid())
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select uid is not null and (
    exists (
      select 1
      from public.profiles p
      where p.id = uid
        and p.role in ('admin'::public.app_role, 'manager'::public.app_role)
    )
    or public.has_global_role(uid, 'owner')
    or public.has_global_role(uid, 'tech_admin')
    or public.has_global_role(uid, 'admin')
    or public.has_global_role(uid, 'manager')
  )
$$;

grant execute on function public.is_admin(uuid) to authenticated, anon;
grant execute on function public.is_manager_or_admin(uuid) to authenticated, anon;

create or replace function public.admin_update_user_profile(
  p_user_id uuid,
  p_avatar_url text
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_target public.profiles%rowtype;
  v_updated public.profiles%rowtype;
  v_actor_critical boolean;
  v_target_critical boolean;
begin
  if v_actor is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select * into v_target
  from public.profiles
  where id = p_user_id;

  if not found then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;

  v_actor_critical :=
    public.has_global_role(v_actor, 'owner')
    or public.has_global_role(v_actor, 'tech_admin')
    or public.has_permission(v_actor, 'system.manage');

  v_target_critical :=
    public.has_global_role(p_user_id, 'owner')
    or public.has_global_role(p_user_id, 'tech_admin')
    or v_target.role = 'admin'::public.app_role;

  if v_actor <> p_user_id
     and not public.has_permission(v_actor, 'users.manage')
     and not public.has_permission(v_actor, 'media.moderate')
     and not public.has_permission(v_actor, 'system.manage') then
    raise exception 'insufficient_permission' using errcode = '42501';
  end if;

  if v_actor <> p_user_id
     and v_target_critical
     and not v_actor_critical then
    raise exception 'insufficient_permission' using errcode = '42501';
  end if;

  update public.profiles
     set avatar_url = p_avatar_url,
         updated_at = now()
   where id = p_user_id
   returning * into v_updated;

  return v_updated;
end
$$;

revoke all on function public.admin_update_user_profile(uuid, text) from public, anon;
grant execute on function public.admin_update_user_profile(uuid, text) to authenticated;

create or replace function public._kub_media_path_allowed(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path to public, storage
as $function$
declare
  v_parts text[] := storage.foldername(p_name);
  v_first text := v_parts[1];
  v_second text := v_parts[2];
  v_target public.profiles%rowtype;
  v_actor_critical boolean;
  v_uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if auth.uid() is null then
    return false;
  end if;

  -- Message, voice and generic attachments: {auth.uid()}/...
  if v_first = auth.uid()::text then
    return true;
  end if;

  -- Own profile avatar: avatars/{auth.uid()}/...
  if v_first = 'avatars' and v_second = auth.uid()::text then
    return true;
  end if;

  -- Admin-managed profile avatar: avatars/{target_user_id}/...
  if v_first = 'avatars'
     and coalesce(v_second, '') ~* v_uuid_re then
    select * into v_target
    from public.profiles
    where id = v_second::uuid;

    if not found then
      return false;
    end if;

    v_actor_critical :=
      public.has_global_role(auth.uid(), 'owner')
      or public.has_global_role(auth.uid(), 'tech_admin')
      or public.has_permission(auth.uid(), 'system.manage');

    return v_actor_critical
      or (
        (public.has_permission(auth.uid(), 'users.manage') or public.has_permission(auth.uid(), 'media.moderate'))
        and v_target.role <> 'admin'::public.app_role
        and not public.has_global_role(v_target.id, 'owner')
        and not public.has_global_role(v_target.id, 'tech_admin')
      );
  end if;

  -- Group/channel avatar: chat-avatars/{chat_id}/...
  if v_first = 'chat-avatars'
     and coalesce(v_second, '') ~* v_uuid_re then
    return public.is_chat_admin(v_second::uuid);
  end if;

  return false;
end
$function$;

revoke all on function public._kub_media_path_allowed(text) from public, anon;
grant execute on function public._kub_media_path_allowed(text) to authenticated;

commit;

-- Manual verification:
-- 1. select public.is_admin('<tech_admin_user_id>');
-- 2. select public.has_permission('<tech_admin_user_id>', 'users.manage');
-- 3. As tech_admin, upload a small file to avatars/{target_user_id}/...
-- 4. As tech_admin, call public.admin_update_user_profile(target, avatar_url).
-- 5. As ordinary user, both cross-user avatar upload and RPC call must fail.
