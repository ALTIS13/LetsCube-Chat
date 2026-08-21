begin;

create or replace function public.phone_verification_admin_access_internal(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select p_user_id is not null
    and public.has_permission(p_user_id, 'system.manage');
$function$;

update public.phone_verification_claims claim
set status = 'cancelled',
    updated_at = now()
where claim.status = 'active'
  and not public.has_permission(claim.user_id, 'system.manage');

create or replace function public.phone_verification_claim_authorize_sms(
  p_user_id uuid,
  p_phone_hmac text,
  p_webhook_id text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_claim public.phone_verification_claims%rowtype;
  v_existing boolean;
  v_user_hour_count integer := 0;
  v_user_day_count integer := 0;
  v_phone_hour_count integer := 0;
begin
  if not public.has_permission(p_user_id, 'system.manage') then
    return 'disabled';
  end if;

  select event.accepted into v_existing
  from public.phone_verification_sms_events event
  where event.webhook_id = p_webhook_id;
  if found then
    return case when v_existing is true then 'duplicate_accepted' else 'duplicate_unconfirmed' end;
  end if;

  select claim.* into v_claim
  from public.phone_verification_claims claim
  where claim.user_id = p_user_id
    and claim.phone_hmac = p_phone_hmac
    and claim.status = 'active'
    and claim.expires_at > now()
  for update;
  if not found then return 'claim_missing'; end if;

  select event.accepted into v_existing
  from public.phone_verification_sms_events event
  where event.webhook_id = p_webhook_id;
  if found then
    return case when v_existing is true then 'duplicate_accepted' else 'duplicate_unconfirmed' end;
  end if;

  if v_claim.last_sms_at is not null and v_claim.last_sms_at > now() - interval '120 seconds' then
    return 'rate_limited';
  end if;

  select count(*) into v_user_hour_count
  from public.phone_verification_sms_events event
  where event.user_id = p_user_id
    and event.created_at > now() - interval '1 hour';
  if v_user_hour_count >= 5 then return 'rate_limited'; end if;

  select count(*) into v_user_day_count
  from public.phone_verification_sms_events event
  where event.user_id = p_user_id
    and event.created_at > now() - interval '24 hours';
  if v_user_day_count >= 10 then return 'rate_limited'; end if;

  select count(*) into v_phone_hour_count
  from public.phone_verification_sms_events event
  where event.phone_hmac = p_phone_hmac
    and event.created_at > now() - interval '1 hour';
  if v_phone_hour_count >= 5 then return 'rate_limited'; end if;

  insert into public.phone_verification_sms_events (
    webhook_id, claim_id, user_id, phone_hmac
  ) values (
    p_webhook_id, v_claim.id, p_user_id, p_phone_hmac
  );
  update public.phone_verification_claims
  set send_count = send_count + 1, last_sms_at = now(), updated_at = now()
  where id = v_claim.id;
  return 'authorized';
exception
  when unique_violation then
    select event.accepted into v_existing
    from public.phone_verification_sms_events event
    where event.webhook_id = p_webhook_id;
    return case when v_existing is true then 'duplicate_accepted' else 'duplicate_unconfirmed' end;
end
$function$;

revoke all on function public.phone_verification_admin_access_internal(uuid) from public, anon, authenticated, service_role;
grant execute on function public.phone_verification_admin_access_internal(uuid) to service_role;

revoke all on function public.phone_verification_claim_authorize_sms(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.phone_verification_claim_authorize_sms(uuid, text, text) to service_role;

comment on function public.phone_verification_admin_access_internal(uuid) is
  'Service-only authorization guard for administrator phone settings actions.';
comment on function public.phone_verification_claim_authorize_sms(uuid, text, text) is
  'Authorizes rate-limited OTP delivery only for users with system.manage.';

commit;
