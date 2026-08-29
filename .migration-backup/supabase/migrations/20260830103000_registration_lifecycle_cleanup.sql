-- Registration lifecycle cleanup proposal.
-- Do not apply automatically; review and deploy through the approved database process.

begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.registration_lifecycles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  signup_kind text not null check (signup_kind in ('public', 'invite')),
  invite_code_hash text null,
  created_at timestamptz not null default now(),
  eligible_at timestamptz not null,
  extension_used boolean not null default false,
  admin_hold_at timestamptz null,
  claim_token uuid null,
  claimed_at timestamptz null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error_code text null,
  updated_at timestamptz not null default now()
);

create table private.registration_cleanup_audit (
  id bigint generated always as identity primary key,
  user_reference uuid not null,
  action text not null check (action in ('reported', 'deleted', 'skipped', 'failed')),
  reason_code text not null,
  created_at timestamptz not null default now()
);

create index registration_lifecycles_due_idx
  on private.registration_lifecycles (eligible_at, claimed_at)
  where admin_hold_at is null;
create index registration_cleanup_audit_retention_idx
  on private.registration_cleanup_audit (created_at);

create or replace function public.registration_lifecycle_register_internal(
  p_user_id uuid,
  p_signup_kind text,
  p_invite_code_hash text default null
)
returns void
language plpgsql
security definer
set search_path = public, private, auth
as $$
declare
  v_created_at timestamptz;
  v_eligible_at timestamptz;
begin
  if p_signup_kind not in ('public', 'invite') then
    raise exception 'registration_kind_invalid' using errcode = '22023';
  end if;
  select created_at into strict v_created_at from auth.users where id = p_user_id;
  v_eligible_at := v_created_at + case when p_signup_kind = 'invite' then interval '7 days' else interval '72 hours' end;
  insert into private.registration_lifecycles(user_id, signup_kind, invite_code_hash, created_at, eligible_at)
  values (p_user_id, p_signup_kind, p_invite_code_hash, v_created_at, v_eligible_at)
  on conflict (user_id) do nothing;
end $$;

revoke all on function public.registration_lifecycle_register_internal(uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function public.registration_lifecycle_register_internal(uuid,text,text) to service_role;

create or replace function public.registration_lifecycle_extend_by_email_internal(
  p_email text
)
returns boolean
language plpgsql
security definer
set search_path = public, private, auth
as $$
declare
  v_email text := lower(btrim(p_email));
begin
  if v_email is null or v_email = '' then
    return false;
  end if;

  update private.registration_lifecycles l
  set eligible_at = least(
        case when l.signup_kind = 'invite' then l.created_at + interval '14 days'
             else l.created_at + interval '7 days' end,
        greatest(l.eligible_at, now() + interval '72 hours')
      ),
      extension_used = true,
      updated_at = now()
  from auth.users u
  where u.id = l.user_id
    and lower(btrim(u.email)) = v_email
    and u.email_confirmed_at is null
    and u.phone_confirmed_at is null
    and not l.extension_used;

  return found;
end $$;

revoke all on function public.registration_lifecycle_extend_by_email_internal(text) from public, anon, authenticated, service_role;
grant execute on function public.registration_lifecycle_extend_by_email_internal(text) to service_role;

create or replace function public.registration_cleanup_claim(
  p_limit integer,
  p_claim_token uuid,
  p_now timestamptz
)
returns table(user_id uuid, signup_kind text)
language sql
security definer
set search_path = public, private, auth
as $$
  with due as (
    select l.user_id
    from private.registration_lifecycles l
    join auth.users u on u.id = l.user_id
    where p_claim_token is not null
      and p_now is not null
      and l.eligible_at <= p_now
      and l.admin_hold_at is null
      and (
        l.claim_token is null
        or l.claimed_at < p_now - interval '15 minutes'
      )
      and u.email_confirmed_at is null
      and u.phone_confirmed_at is null
      and u.last_sign_in_at is null
      and not exists (select 1 from public.messages m where m.user_id = u.id)
      and not exists (
        select 1 from public.tasks t
        where t.created_by = u.id or t.assignee_id = u.id
      )
      and not exists (
        select 1 from public.profile_contacts pc
        where pc.user_id = u.id and pc.phone_verified
      )
    order by l.eligible_at, l.user_id
    limit least(greatest(coalesce(p_limit, 0), 0), 100)
    for update skip locked
  ), claimed as (
    update private.registration_lifecycles l
    set claim_token = p_claim_token,
        claimed_at = p_now,
        attempt_count = l.attempt_count + 1,
        updated_at = p_now
    from due
    where l.user_id = due.user_id
    returning l.user_id, l.signup_kind
  )
  select claimed.user_id, claimed.signup_kind
  from claimed;
$$;

revoke all on function public.registration_cleanup_claim(integer,uuid,timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.registration_cleanup_claim(integer,uuid,timestamptz) to service_role;

create or replace function public.registration_cleanup_recheck(
  p_user_id uuid,
  p_claim_token uuid,
  p_now timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = public, private, auth
as $$
  select coalesce(exists (
    select 1
    from private.registration_lifecycles l
    join auth.users u on u.id = l.user_id
    where l.user_id = p_user_id
      and l.claim_token = p_claim_token
      and p_claim_token is not null
      and p_now is not null
      and l.eligible_at <= p_now
      and l.admin_hold_at is null
      and u.email_confirmed_at is null
      and u.phone_confirmed_at is null
      and u.last_sign_in_at is null
      and not exists (select 1 from public.messages m where m.user_id = u.id)
      and not exists (
        select 1 from public.tasks t
        where t.created_by = u.id or t.assignee_id = u.id
      )
      and not exists (
        select 1 from public.profile_contacts pc
        where pc.user_id = u.id and pc.phone_verified
      )
  ), false);
$$;

revoke all on function public.registration_cleanup_recheck(uuid,uuid,timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.registration_cleanup_recheck(uuid,uuid,timestamptz) to service_role;

create or replace function public.registration_cleanup_finish(
  p_user_id uuid,
  p_claim_token uuid,
  p_action text,
  p_reason_code text
)
returns void
language plpgsql
security definer
set search_path = public, private, auth
as $$
begin
  if p_action not in ('reported', 'deleted', 'skipped', 'failed') then
    raise exception 'registration_cleanup_action_invalid' using errcode = '22023';
  end if;
  if p_reason_code is null or p_reason_code !~ '^[a-z][a-z0-9_]{0,63}$' then
    raise exception 'registration_cleanup_reason_invalid' using errcode = '22023';
  end if;

  update private.registration_lifecycles l
  set claim_token = null,
      claimed_at = null,
      admin_hold_at = case
        when p_action = 'reported' then coalesce(l.admin_hold_at, now())
        else l.admin_hold_at
      end,
      last_error_code = case when p_action = 'failed' then p_reason_code else null end,
      updated_at = now()
  where l.user_id = p_user_id
    and l.claim_token = p_claim_token
    and p_claim_token is not null;

  if not found and p_action <> 'deleted' then
    raise exception 'registration_cleanup_claim_not_found' using errcode = 'P0002';
  end if;

  insert into private.registration_cleanup_audit(user_reference, action, reason_code)
  values (p_user_id, p_action, p_reason_code);
end $$;

revoke all on function public.registration_cleanup_finish(uuid,uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function public.registration_cleanup_finish(uuid,uuid,text,text) to service_role;

create or replace function public.registration_lifecycle_backfill_internal(
  p_limit integer,
  p_enabled_at timestamptz
)
returns integer
language plpgsql
security definer
set search_path = public, private, auth
as $$
declare
  v_inserted integer;
begin
  if p_enabled_at is null then
    raise exception 'registration_lifecycle_enabled_at_required' using errcode = '22023';
  end if;

  with candidates as (
    select u.id, u.created_at
    from auth.users u
    where u.email_confirmed_at is null
      and u.phone_confirmed_at is null
      and u.last_sign_in_at is null
      and not exists (
        select 1
        from private.registration_lifecycles l
        where l.user_id = u.id
      )
      and not exists (
        select 1
        from public.user_global_roles ugr
        join public.roles r on r.id = ugr.role_id
        where ugr.user_id = u.id
          and r.scope = 'global'
          and r.key in ('owner', 'tech_admin')
          and r.is_active
      )
    order by u.created_at, u.id
    limit least(greatest(coalesce(p_limit, 0), 0), 1000)
  )
  insert into private.registration_lifecycles(
    user_id,
    signup_kind,
    created_at,
    eligible_at
  )
  select
    candidates.id,
    'public',
    candidates.created_at,
    greatest(candidates.created_at + interval '72 hours', p_enabled_at + interval '24 hours')
  from candidates
  on conflict (user_id) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end $$;

revoke all on function public.registration_lifecycle_backfill_internal(integer,timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.registration_lifecycle_backfill_internal(integer,timestamptz) to service_role;

commit;
