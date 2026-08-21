begin;

update public.phone_verification_policy
set enabled = false,
    updated_at = now()
where singleton;

create or replace function public.phone_verification_claim_begin_internal(
  p_user_id uuid,
  p_phone_hmac text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if p_user_id is null or p_phone_hmac !~ '^[0-9a-f]{64}$' then
    return 'invalid';
  end if;

  if not public.has_permission(p_user_id, 'system.manage') then
    return 'disabled';
  end if;

  update public.phone_verification_claims
  set status = 'expired', updated_at = now()
  where status = 'active' and expires_at <= now();

  if exists (
    select 1
    from public.phone_verification_claims claim
    where claim.status = 'active'
      and claim.phone_hmac = p_phone_hmac
      and claim.user_id <> p_user_id
  ) then
    return 'phone_in_use';
  end if;

  update public.phone_verification_claims
  set status = 'cancelled', updated_at = now()
  where user_id = p_user_id and status = 'active';

  insert into public.phone_verification_claims (user_id, phone_hmac, expires_at)
  values (p_user_id, p_phone_hmac, now() + interval '15 minutes');
  return 'created';
exception
  when unique_violation then return 'phone_in_use';
end
$function$;

revoke all on function public.phone_verification_claim_begin_internal(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.phone_verification_claim_begin_internal(uuid, text) to service_role;

comment on function public.phone_verification_claim_begin_internal(uuid, text) is
  'Creates an OTP delivery claim only for users with the global system.manage permission.';

commit;
