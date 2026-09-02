-- Phone verification returns to every authenticated user.
--
-- 20260820161957 had already enabled it for all accounts by flipping the policy
-- row, because the gates read that row. 20260821095000 and 20260821101000 then
-- restricted delivery to administrators by hardcoding a `system.manage` check
-- inside the gate functions, so the policy row stopped being consulted at all.
-- Flipping the row alone therefore no longer opens anything; the checks have to
-- go back to reading the policy.
--
-- This migration is deliberately narrow:
--   * it does NOT touch `enforce_data_access`, which stays false, so no existing
--     account loses access for being unverified;
--   * it does NOT set `required_for_created_at_or_after`, because nothing reads
--     that column for enforcement yet;
--   * it does NOT relax `phone_verification_admin_access_internal` or
--     `admin_profile_phone_remove_internal`, which stay administrator-only.
--
-- Rate limiting is unchanged and is what bounds delivery cost and abuse now that
-- the audience is every user: 120 seconds between sends per claim and per
-- user/phone pair, 5 messages per user per hour, 10 per user per day, and 5 per
-- phone number per hour, with webhook-id idempotency on top.

begin;

do $migration_guard$
begin
  if to_regclass('public.phone_verification_policy') is null then
    raise exception 'phone verification policy is missing';
  end if;

  if (select count(*) from public.phone_verification_policy where singleton) <> 1 then
    raise exception 'phone verification singleton policy is invalid';
  end if;

  if to_regclass('public.phone_verification_pilot_users') is null then
    raise exception 'phone verification pilot table is missing';
  end if;
end
$migration_guard$;

-- One predicate for "may this user start verification at all", so the two gates
-- below cannot drift apart the way they would if the check were inlined twice.
create or replace function public.phone_verification_available_internal(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select p_user_id is not null
    and (
      coalesce(
        (
          select policy.enabled
          from public.phone_verification_policy policy
          where policy.singleton
        ),
        false
      )
      or exists (
        select 1
        from public.phone_verification_pilot_users pilot
        where pilot.user_id = p_user_id
          and pilot.enabled
          and (pilot.expires_at is null or pilot.expires_at > pg_catalog.now())
      )
    );
$function$;

revoke all on function public.phone_verification_available_internal(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.phone_verification_available_internal(uuid) to service_role;

comment on function public.phone_verification_available_internal(uuid) is
  'True when the phone verification policy, or a pilot entry, opens verification for this user.';

-- Claim creation: the same body as the four-digit OTP version, with the
-- administrator check replaced by the policy check.
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

  if not public.phone_verification_available_internal(p_user_id) then
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

revoke all on function public.phone_verification_claim_begin_internal(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.phone_verification_claim_begin_internal(uuid, text) to service_role;

comment on function public.phone_verification_claim_begin_internal(uuid, text) is
  'Creates an OTP delivery claim for any user the phone verification policy allows.';

-- SMS authorization: the same body and the same rate limits, with the
-- administrator check replaced by the policy check.
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
  if not public.phone_verification_available_internal(p_user_id) then return 'disabled'; end if;

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

revoke all on function public.phone_verification_claim_authorize_sms(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.phone_verification_claim_authorize_sms(uuid, text, text) to service_role;

comment on function public.phone_verification_claim_authorize_sms(uuid, text, text) is
  'Authorizes rate-limited OTP delivery for any user the phone verification policy allows.';

update public.phone_verification_policy
set enabled = true,
    updated_at = now()
where singleton;

do $migration_verify$
begin
  if not exists (
    select 1
    from public.phone_verification_policy
    where singleton
      and enabled is true
      and enforce_data_access is false
  ) then
    raise exception 'phone verification was not opened safely';
  end if;

  -- The gates must consult the policy rather than a permission, or the row
  -- above is decorative again.
  if exists (
    select 1
    from pg_catalog.pg_proc proc
    join pg_catalog.pg_namespace ns on ns.oid = proc.pronamespace
    where ns.nspname = 'public'
      and proc.proname in (
        'phone_verification_claim_begin_internal',
        'phone_verification_claim_authorize_sms'
      )
      and proc.prosrc like '%system.manage%'
  ) then
    raise exception 'a phone verification gate still checks system.manage';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc proc
    join pg_catalog.pg_namespace ns on ns.oid = proc.pronamespace
    where ns.nspname = 'public'
      and proc.proname = 'admin_profile_phone_remove_internal'
      and proc.prosrc like '%system.manage%'
  ) then
    raise exception 'administrator phone removal lost its permission check';
  end if;
end
$migration_verify$;

commit;
