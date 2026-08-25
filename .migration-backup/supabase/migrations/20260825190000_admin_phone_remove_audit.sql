begin;

create or replace function public.admin_profile_phone_remove_internal(
  p_actor_id uuid,
  p_target_user_id uuid
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if p_actor_id is null or p_target_user_id is null then
    return 'invalid_user';
  end if;

  if not public.has_permission(p_actor_id, 'system.manage') then
    return 'disabled';
  end if;

  perform public.profile_phone_remove_internal(p_target_user_id);

  insert into public.audit_logs (actor_id, action, target_kind, target_id, diff)
  values (
    p_actor_id,
    'admin_phone_removed',
    'profile',
    p_target_user_id,
    jsonb_build_object('source', 'admin_user_panel')
  );

  return 'removed';
end
$function$;

revoke all on function public.admin_profile_phone_remove_internal(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_profile_phone_remove_internal(uuid, uuid)
  to service_role;

comment on function public.admin_profile_phone_remove_internal(uuid, uuid) is
  'Service-only audited phone removal for administrators with system.manage; no phone value is written to audit data.';

commit;
