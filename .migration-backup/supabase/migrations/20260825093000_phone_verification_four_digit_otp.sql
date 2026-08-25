begin;

alter table public.phone_verification_claims
  add column if not exists otp_hmac text,
  add column if not exists otp_expires_at timestamptz,
  add column if not exists verify_attempts integer not null default 0;

do $constraints$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.phone_verification_claims'::regclass
      and conname = 'phone_verification_claims_otp_hmac_check'
  ) then
    alter table public.phone_verification_claims
      add constraint phone_verification_claims_otp_hmac_check
      check (otp_hmac is null or otp_hmac ~ '^[0-9a-f]{64}$');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.phone_verification_claims'::regclass
      and conname = 'phone_verification_claims_verify_attempts_check'
  ) then
    alter table public.phone_verification_claims
      add constraint phone_verification_claims_verify_attempts_check
      check (verify_attempts between 0 and 5);
  end if;
end
$constraints$;

update public.phone_verification_claims
set otp_hmac = null,
    otp_expires_at = null
where status <> 'active';

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
  set status = 'expired',
      otp_hmac = null,
      otp_expires_at = null,
      updated_at = now()
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

  if exists (
    select 1
    from public.phone_verification_sms_events event
    where event.user_id = p_user_id
      and event.phone_hmac = p_phone_hmac
      and event.created_at > now() - interval '120 seconds'
  ) then
    return 'rate_limited';
  end if;

  update public.phone_verification_claims
  set status = 'cancelled',
      otp_hmac = null,
      otp_expires_at = null,
      updated_at = now()
  where user_id = p_user_id and status = 'active';

  insert into public.phone_verification_claims (user_id, phone_hmac, expires_at)
  values (p_user_id, p_phone_hmac, now() + interval '15 minutes');
  return 'created';
exception
  when unique_violation then return 'phone_in_use';
end
$function$;

create or replace function public.phone_verification_claim_cancel_internal(p_user_id uuid)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $function$
  update public.phone_verification_claims
  set status = 'cancelled',
      otp_hmac = null,
      otp_expires_at = null,
      updated_at = now()
  where user_id = p_user_id and status = 'active';
$function$;

create or replace function public.phone_verification_code_prepare_internal(
  p_user_id uuid,
  p_phone_hmac text,
  p_otp_hmac text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_claim public.phone_verification_claims%rowtype;
begin
  if not public.has_permission(p_user_id, 'system.manage') then
    return 'disabled';
  end if;
  if p_phone_hmac !~ '^[0-9a-f]{64}$' or p_otp_hmac !~ '^[0-9a-f]{64}$' then
    return 'invalid';
  end if;

  select claim.* into v_claim
  from public.phone_verification_claims claim
  where claim.user_id = p_user_id
    and claim.phone_hmac = p_phone_hmac
    and claim.status = 'active'
    and claim.expires_at > now()
  for update;

  if not found then return 'claim_missing'; end if;

  update public.phone_verification_claims
  set otp_hmac = p_otp_hmac,
      otp_expires_at = least(v_claim.expires_at, now() + interval '10 minutes'),
      verify_attempts = 0,
      updated_at = now()
  where id = v_claim.id;

  return 'prepared';
end
$function$;

create or replace function public.phone_verification_code_verify_internal(
  p_user_id uuid,
  p_phone_hmac text,
  p_otp_hmac text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_claim public.phone_verification_claims%rowtype;
  v_next_attempt integer;
begin
  if not public.has_permission(p_user_id, 'system.manage') then
    return 'disabled';
  end if;
  if p_phone_hmac !~ '^[0-9a-f]{64}$' or p_otp_hmac !~ '^[0-9a-f]{64}$' then
    return 'invalid';
  end if;

  select claim.* into v_claim
  from public.phone_verification_claims claim
  where claim.user_id = p_user_id
    and claim.phone_hmac = p_phone_hmac
    and claim.status = 'active'
  for update;

  if not found then return 'claim_missing'; end if;

  if v_claim.expires_at <= now()
     or v_claim.otp_expires_at is null
     or v_claim.otp_expires_at <= now() then
    update public.phone_verification_claims
    set status = 'expired', otp_hmac = null, otp_expires_at = null, updated_at = now()
    where id = v_claim.id;
    return 'expired';
  end if;

  if v_claim.verify_attempts >= 5 then
    update public.phone_verification_claims
    set status = 'cancelled', otp_hmac = null, otp_expires_at = null, updated_at = now()
    where id = v_claim.id;
    return 'attempts_exceeded';
  end if;

  if v_claim.otp_hmac is distinct from p_otp_hmac then
    v_next_attempt := v_claim.verify_attempts + 1;
    update public.phone_verification_claims
    set verify_attempts = v_next_attempt,
        status = case when v_next_attempt >= 5 then 'cancelled' else status end,
        otp_hmac = case when v_next_attempt >= 5 then null else otp_hmac end,
        otp_expires_at = case when v_next_attempt >= 5 then null else otp_expires_at end,
        updated_at = now()
    where id = v_claim.id;
    return case when v_next_attempt >= 5 then 'attempts_exceeded' else 'invalid_code' end;
  end if;

  return 'valid';
end
$function$;

create or replace function public.phone_verification_profile_finalize_internal(
  p_user_id uuid,
  p_phone_hmac text,
  p_otp_hmac text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  v_claim public.phone_verification_claims%rowtype;
  v_phone text;
  v_confirmed timestamptz;
begin
  if not public.has_permission(p_user_id, 'system.manage') then
    return 'disabled';
  end if;
  if p_phone_hmac !~ '^[0-9a-f]{64}$' or p_otp_hmac !~ '^[0-9a-f]{64}$' then
    return 'invalid';
  end if;

  select claim.* into v_claim
  from public.phone_verification_claims claim
  where claim.user_id = p_user_id
    and claim.phone_hmac = p_phone_hmac
    and claim.otp_hmac = p_otp_hmac
    and claim.status = 'active'
    and claim.expires_at > now()
    and claim.otp_expires_at > now()
  for update;

  if not found then return 'claim_missing'; end if;

  select phone, phone_confirmed_at
  into v_phone, v_confirmed
  from auth.users
  where id = p_user_id;

  if v_phone is null or v_confirmed is null then return 'auth_not_confirmed'; end if;

  perform set_config('app.profile_contacts_bypass', 'on', true);
  insert into public.profile_contacts (user_id, phone, phone_verified, phone_verified_at)
  values (p_user_id, public._normalize_phone_e164(v_phone), true, v_confirmed)
  on conflict (user_id) do update
    set phone = excluded.phone,
        phone_verified = true,
        phone_verified_at = excluded.phone_verified_at,
        updated_at = now();

  update public.phone_verification_claims
  set status = 'verified',
      otp_hmac = null,
      otp_expires_at = null,
      updated_at = now()
  where id = v_claim.id;

  return 'verified';
end
$function$;

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
  if not public.has_permission(p_user_id, 'system.manage') then return 'disabled'; end if;

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

  if exists (
    select 1
    from public.phone_verification_sms_events event
    where event.user_id = p_user_id
      and event.phone_hmac = p_phone_hmac
      and event.created_at > now() - interval '120 seconds'
  ) then return 'rate_limited'; end if;

  select count(*) into v_user_hour_count
  from public.phone_verification_sms_events event
  where event.user_id = p_user_id and event.created_at > now() - interval '1 hour';
  if v_user_hour_count >= 5 then return 'rate_limited'; end if;

  select count(*) into v_user_day_count
  from public.phone_verification_sms_events event
  where event.user_id = p_user_id and event.created_at > now() - interval '24 hours';
  if v_user_day_count >= 10 then return 'rate_limited'; end if;

  select count(*) into v_phone_hour_count
  from public.phone_verification_sms_events event
  where event.phone_hmac = p_phone_hmac and event.created_at > now() - interval '1 hour';
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

revoke all on function public.phone_verification_code_prepare_internal(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.phone_verification_code_verify_internal(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.phone_verification_profile_finalize_internal(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.phone_verification_claim_authorize_sms(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.phone_verification_claim_begin_internal(uuid, text) from public, anon, authenticated, service_role;

grant execute on function public.phone_verification_code_prepare_internal(uuid, text, text) to service_role;
grant execute on function public.phone_verification_code_verify_internal(uuid, text, text) to service_role;
grant execute on function public.phone_verification_profile_finalize_internal(uuid, text, text) to service_role;
grant execute on function public.phone_verification_claim_authorize_sms(uuid, text, text) to service_role;
grant execute on function public.phone_verification_claim_begin_internal(uuid, text) to service_role;

comment on function public.phone_verification_code_prepare_internal(uuid, text, text) is
  'Stores only a server-HMAC of the four-digit phone verification code for an active administrator claim.';
comment on function public.phone_verification_code_verify_internal(uuid, text, text) is
  'Verifies an expiring phone code with a five-attempt ceiling; callable only through the trusted gateway.';
comment on function public.phone_verification_profile_finalize_internal(uuid, text, text) is
  'Atomically consumes a valid phone code and mirrors the confirmed auth.users phone into the private profile contact row.';

commit;
