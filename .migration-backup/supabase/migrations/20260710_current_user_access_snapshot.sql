-- Proposal only. Do not apply automatically.
-- Replaces frontend per-key permission fan-out with one self-scoped snapshot.

begin;

create or replace function public.current_user_access_snapshot()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_legacy_role public.app_role;
  v_global_role_keys jsonb := '[]'::jsonb;
  v_global_permission_keys jsonb := '[]'::jsonb;
  v_location_permissions jsonb := '{}'::jsonb;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  select p.role
    into v_legacy_role
    from public.profiles p
   where p.id = v_user_id;

  select coalesce(jsonb_agg(role_key order by role_key), '[]'::jsonb)
    into v_global_role_keys
    from (
      select distinct r.key as role_key
        from public.user_global_roles ugr
        join public.roles r on r.id = ugr.role_id
       where ugr.user_id = v_user_id
         and r.scope = 'global'
         and r.is_active
      union
      select v_legacy_role::text
       where v_legacy_role::text in ('admin', 'manager', 'user')
    ) role_keys;

  select coalesce(jsonb_agg(permission_key order by permission_key), '[]'::jsonb)
    into v_global_permission_keys
    from (
      select distinct p.key as permission_key
        from public.permissions p
       where (
         exists (
           select 1
             from public.user_global_roles ugr
             join public.roles r on r.id = ugr.role_id
            where ugr.user_id = v_user_id
              and r.scope = 'global'
              and r.is_active
              and r.key in ('owner', 'tech_admin')
         )
         or exists (
           select 1
             from public.user_global_roles ugr
             join public.roles r on r.id = ugr.role_id
             join public.role_permissions rp on rp.role_id = r.id
            where ugr.user_id = v_user_id
              and r.scope = 'global'
              and r.is_active
              and rp.permission_key = p.key
         )
         or public._legacy_role_has_permission(v_legacy_role, p.key)
       )
    ) permission_keys;

  select coalesce(jsonb_object_agg(location_id::text, permission_keys), '{}'::jsonb)
    into v_location_permissions
    from (
      select lm.location_id,
             coalesce(
               (
                 select jsonb_agg(permission_key order by permission_key)
                   from (
                     select distinct value #>> '{}' as permission_key
                       from jsonb_array_elements(v_global_permission_keys)
                     union
                     select distinct rp.permission_key
                       from public.roles effective
                       join public.role_permissions rp on rp.role_id = effective.id
                      where effective.scope = 'location'
                        and effective.is_active
                        and effective.key = coalesce(
                          assigned.key,
                          case lm.role
                            when 'owner' then 'location_owner'
                            when 'admin' then 'location_admin'
                            when 'manager' then 'location_manager'
                            when 'client' then 'location_client'
                            else 'location_staff'
                          end
                        )
                   ) combined_permissions
               ),
               '[]'::jsonb
             ) as permission_keys
        from public.location_members lm
        left join public.roles assigned
          on assigned.id = lm.role_id
         and assigned.scope = 'location'
       where lm.user_id = v_user_id
    ) locations;

  return jsonb_build_object(
    'global_role_keys', v_global_role_keys,
    'global_permission_keys', v_global_permission_keys,
    'location_permissions', v_location_permissions
  );
end;
$$;

revoke all on function public.current_user_access_snapshot() from public, anon, authenticated;
grant execute on function public.current_user_access_snapshot() to authenticated;

comment on function public.current_user_access_snapshot() is
  'Returns the authenticated user own global roles and global/location permission keys for client access gating.';

commit;

-- Manual verification after explicit apply:
-- 1. Anonymous REST RPC returns 401/403.
-- 2. Each QA role result matches has_permission/has_location_permission for
--    every active permission and assigned location.
-- 3. Browser startup issues one current_user_access_snapshot request instead
--    of per-key permission RPC calls.
