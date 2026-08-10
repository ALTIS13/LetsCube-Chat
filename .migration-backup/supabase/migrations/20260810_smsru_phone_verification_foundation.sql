begin;

do $migration_guard$
begin
  if to_regclass('public.profile_contacts') is null
     or to_regclass('public.profiles') is null then
    raise exception 'phone verification foundation prerequisites are missing';
  end if;
end
$migration_guard$;

alter table public.profile_contacts
  add column if not exists phone_discoverable boolean not null default false;

create table if not exists public.phone_verification_policy (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  required_for_created_at_or_after timestamptz,
  enforce_data_access boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.phone_verification_policy (singleton, enabled, enforce_data_access)
values (true, false, false)
on conflict (singleton) do nothing;

create table if not exists public.phone_verification_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  phone_hmac text not null check (phone_hmac ~ '^[0-9a-f]{64}$'),
  status text not null default 'active'
    check (status in ('active', 'verified', 'cancelled', 'expired')),
  send_count integer not null default 0 check (send_count >= 0),
  last_sms_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists phone_verification_claims_active_phone_uidx
  on public.phone_verification_claims (phone_hmac)
  where status = 'active';
create unique index if not exists phone_verification_claims_active_user_uidx
  on public.phone_verification_claims (user_id)
  where status = 'active';
create index if not exists phone_verification_claims_expiry_idx
  on public.phone_verification_claims (expires_at)
  where status = 'active';

create table if not exists public.phone_verification_sms_events (
  webhook_id text primary key check (length(webhook_id) between 1 and 200),
  claim_id uuid not null references public.phone_verification_claims(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  phone_hmac text not null check (phone_hmac ~ '^[0-9a-f]{64}$'),
  result_category text not null default 'authorized',
  accepted boolean,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists phone_verification_sms_events_user_created_idx
  on public.phone_verification_sms_events (user_id, created_at desc);
create index if not exists phone_verification_sms_events_phone_created_idx
  on public.phone_verification_sms_events (phone_hmac, created_at desc);

alter table public.phone_verification_policy enable row level security;
alter table public.phone_verification_claims enable row level security;
alter table public.phone_verification_sms_events enable row level security;

revoke all on table public.phone_verification_policy from public, anon, authenticated;
revoke all on table public.phone_verification_claims from public, anon, authenticated;
revoke all on table public.phone_verification_sms_events from public, anon, authenticated;

create or replace function public.phone_verification_policy_read()
returns table (
  enabled boolean,
  required_for_created_at_or_after timestamptz,
  enforce_data_access boolean
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select policy.enabled, policy.required_for_created_at_or_after, policy.enforce_data_access
  from public.phone_verification_policy policy
  where policy.singleton;
$function$;

create or replace function public.phone_verification_claim_begin_internal(
  p_user_id uuid,
  p_phone_hmac text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_enabled boolean := false;
begin
  select policy.enabled into v_enabled
  from public.phone_verification_policy policy
  where policy.singleton;
  if not coalesce(v_enabled, false) then return 'disabled'; end if;
  if p_user_id is null or p_phone_hmac !~ '^[0-9a-f]{64}$' then return 'invalid'; end if;

  update public.phone_verification_claims
  set status = 'expired', updated_at = now()
  where status = 'active' and expires_at <= now();

  if exists (
    select 1 from public.phone_verification_claims claim
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

create or replace function public.phone_verification_claim_cancel_internal(p_user_id uuid)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $function$
  update public.phone_verification_claims
  set status = 'cancelled', updated_at = now()
  where user_id = p_user_id and status = 'active';
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
  v_user_hour_count integer := 0;
  v_user_day_count integer := 0;
  v_phone_hour_count integer := 0;
begin
  if exists (
    select 1 from public.phone_verification_sms_events event
    where event.webhook_id = p_webhook_id
  ) then
    return 'duplicate';
  end if;

  select claim.* into v_claim
  from public.phone_verification_claims claim
  where claim.user_id = p_user_id
    and claim.phone_hmac = p_phone_hmac
    and claim.status = 'active'
    and claim.expires_at > now()
  for update;
  if not found then return 'claim_missing'; end if;

  -- A concurrent retry can pass the first check before the original request
  -- commits, then wait on this claim lock. Re-check after acquiring the lock.
  if exists (
    select 1 from public.phone_verification_sms_events event
    where event.webhook_id = p_webhook_id
  ) then
    return 'duplicate';
  end if;

  if v_claim.last_sms_at is not null and v_claim.last_sms_at > now() - interval '60 seconds' then
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
  when unique_violation then return 'duplicate';
end
$function$;

create or replace function public.phone_verification_sms_event_finish(
  p_webhook_id text,
  p_result_category text,
  p_accepted boolean
)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $function$
  update public.phone_verification_sms_events
  set result_category = left(coalesce(p_result_category, 'unknown'), 80),
      accepted = p_accepted,
      finished_at = now()
  where webhook_id = p_webhook_id and finished_at is null;
$function$;

create or replace function public.profile_phone_set_discoverable(p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if auth.uid() is null then return false; end if;
  update public.profile_contacts
  set phone_discoverable = coalesce(p_enabled, false)
  where user_id = auth.uid() and phone_verified is true;
  return found;
end
$function$;

revoke all on function public.phone_verification_policy_read() from public, anon, authenticated, service_role;
revoke all on function public.phone_verification_claim_begin_internal(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.phone_verification_claim_cancel_internal(uuid) from public, anon, authenticated, service_role;
revoke all on function public.phone_verification_claim_authorize_sms(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.phone_verification_sms_event_finish(text, text, boolean) from public, anon, authenticated, service_role;
revoke all on function public.profile_phone_set_discoverable(boolean) from public, anon, authenticated, service_role;

grant execute on function public.phone_verification_policy_read() to service_role;
grant execute on function public.phone_verification_claim_begin_internal(uuid, text) to service_role;
grant execute on function public.phone_verification_claim_cancel_internal(uuid) to service_role;
grant execute on function public.phone_verification_claim_authorize_sms(uuid, text, text) to service_role;
grant execute on function public.phone_verification_sms_event_finish(text, text, boolean) to service_role;
grant execute on function public.profile_phone_set_discoverable(boolean) to authenticated;

comment on table public.phone_verification_claims is
  'Server-only HMAC phone claims. Raw phone numbers and OTP values are never stored here.';
comment on table public.phone_verification_sms_events is
  'Server-only idempotency and safe result categories for Send SMS Hook events.';

commit;
