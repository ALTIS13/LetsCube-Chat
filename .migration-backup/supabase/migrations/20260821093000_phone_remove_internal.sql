begin;

create or replace function public.profile_phone_remove_internal(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if p_user_id is null then
    raise exception 'invalid_user' using errcode = '22023';
  end if;

  update auth.users
  set phone = null,
      phone_confirmed_at = null,
      phone_change = '',
      phone_change_token = '',
      phone_change_sent_at = null,
      updated_at = now()
  where id = p_user_id;

  if not found then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;

  delete from auth.one_time_tokens
  where user_id = p_user_id
    and token_type = 'phone_change_token'::auth.one_time_token_type;

  delete from auth.identities
  where user_id = p_user_id
    and provider = 'phone';

  perform set_config('app.profile_contacts_bypass', 'on', true);

  update public.profile_contacts
  set phone = null,
      phone_verified = false,
      phone_verified_at = null,
      updated_at = now()
  where user_id = p_user_id;

  perform public.phone_verification_claim_cancel_internal(p_user_id);
end
$function$;

revoke all on function public.profile_phone_remove_internal(uuid) from public, anon, authenticated, service_role;
grant execute on function public.profile_phone_remove_internal(uuid) to service_role;

comment on function public.profile_phone_remove_internal(uuid) is
  'Server-only phone removal. Atomically clears Auth phone state, phone identity, private profile mirror and active OTP claim.';

commit;
